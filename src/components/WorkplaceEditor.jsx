/**
 * WorkplaceEditor.jsx
 *
 * The workplace editor: store → mesh syncing, level visibility, and switching
 * between Workplace Studio (src/ui/, the planner tools) and Preview
 * (play/playController.js + PlayHUD). The Babylon scene and everything made
 * with it live in hooks/useStudioScene.js. The Studio's look lives in src/ui/;
 * this file wires it to the scene and to editorHistory. onFirstFrame is called once,
 * after the first frame of the built floor (App then hides its loading screen).
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';

import { storedRealisticLook, storeRealisticLook, setRealistic } from '../utils/realLook';
import { progressPercent } from '../play/buildSchedule';
import { setCameraView, flyTo as flyCamera } from '../engine/systems/CameraSystem';

// Phase 2 utilities
import {
  elevationOf, floorBelow,
  stairProblems, floorPosition, steepStairsText, floorHeight,
} from '../play/building';

// Phase 3 utilities
import { ASSET_TYPES } from '../utils/assetCatalog';

// Phase 4 — Zustand store + API
import {
  useWorkspaceStore,
} from '../store/workspaceStore';
import { createEditorHistory } from '../store/editorHistory';
import { startAutoSave, stopAutoSave, saveNow, renameLayout, listVersions } from '../services/apiService';
import { AHDUS_COMPANY, listDepartments } from '../services/ahdusBackend';
import { departmentChoices } from '../ui/roomDepartment';

// The scene lifecycle (scene, systems, builder, play controller, tools, pointer handlers)
import { useStudioScene } from '../hooks/useStudioScene';
// Store → scene: meshes, the floor being edited, the gizmo
import { useStoreMeshSync } from '../hooks/useStoreMeshSync';
// Keyboard shortcuts (keydown + wheel)
import { useStudioKeyboard } from '../hooks/useStudioKeyboard';
// File and layout actions (all layouts, export / import, copy, floor plan, photo)
import { useStudioFileActions } from '../hooks/useStudioFileActions';
// Inside AHDUS: the Publish dialog and button state, the leave warning, toasts
import { useAhdusPublish } from '../hooks/useAhdusPublish';
import { useAhdusSeats } from '../hooks/useAhdusSeats';
import SeatsBanner from '../ui/SeatsBanner';
import { isDesk, seatAtDesk, seatOfPerson, losingDeskText } from '../ui/seatFlow';
import { useLibraryDrop } from '../hooks/useLibraryDrop';

// Components
import PlayHUD from './PlayHUD';

// Workplace Studio UI
import StudioShell from '../ui/StudioShell';
import StudioHeader from '../ui/StudioHeader';
import BuildPanel from '../ui/BuildPanel';
import CanvasCard from '../ui/CanvasCard';
import RoomLabels, { storedRoomLabels, storeRoomLabels } from '../ui/RoomLabels';
import RoomHoverCard from '../ui/RoomHoverCard';
import MeasurementOverlay from '../ui/MeasurementOverlay';
import FloorPlanView from '../floorplan/FloorPlanView';
import SelectionToolbar from '../ui/SelectionToolbar';
import Inspector from '../ui/Inspector';
import StudioFooter from '../ui/StudioFooter';
import TabNotice from '../ui/TabNotice';
import ProposedLayoutBanner from '../ui/ProposedLayoutBanner';
import Toast from '../ui/Toast';
import { PublishDialog, LeaveDialog } from '../ui/PublishDialogs';
import Dialog from '../ui/Dialog';
import DropFootprint from '../ui/DropFootprint';
import CameraControls from '../ui/CameraControls';
import { turnCameraTo, zoomCamera, setPanMode } from '../utils/cameraControls';
import { usePhone } from '../ui/look';
import PhoneBar from '../ui/PhoneBar';
import { normaliseLayout } from '../store/layoutData';
import { watchFirstFrame } from '../ui/firstFrame';
import { isPhotoReconstructionOn } from '../services/reconstructionService';
import { isAhdusBackendOn } from '../services/backendFlags';
import { activeTile, toolHint, phoneIdleHint } from '../ui/tools';

import {
  openingData, openingPartner, openingCentre, resizeOpening, planRemoveOpening,
  planRoomResize, planWallThickness, planRoomTurn, planRoomCopy,
} from '../play/geometry';
import { FLOOR_BY_ROOM_TYPE } from '../utils/materialLibrary';
import { DEFAULT_HOTBAR } from '../play/hotbarItems';

// Team integration: how other modules connect to the layout (docs/TEAM_INTEGRATION.md)
import { layoutBridge } from '../integration/layoutBridge';
import { lockPointer } from '../utils/pointerLock';
import { anchorsForObject } from '../integration/anchorsFromStore';

const DEMO_MODULES = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demoModules');

// Shallow compare for Zustand selector stability
const shallow = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
};

export default function WorkplaceEditor({ onExit, onFirstFrame, people, departments }) {
  // Development only: lets the e2e test check the "could not be opened" card (e2e/save-smoke.mjs)
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.__ahdusCrashOnOpen) {
    throw new Error('Test crash (window.__ahdusCrashOnOpen is set)');
  }
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const lightsRef = useRef(null);

  // Room meshes of every floor (engine/systems/RoomSystem), made with the scene
  const roomSystemRef = useRef(null);

  // Item meshes of every floor (engine/systems/ObjectSystem), made with the scene
  const objectSystemRef = useRef(null);
  const characterSystemRef = useRef(null); // people at their desks (only when `people` is given)

  // Progressive loading (engine/systems/SceneBuilder): builds the rooms and items
  // in ~10 ms slices, the floor you are on first, so opening a big layout never
  // freezes the page. Every layout change goes through it too.
  const builderRef = useRef(null);
  // Shown as "Building your workplace… 40 %"; set only when the text would change
  const [buildProgress, setBuildProgress] = useState(null);

  // Phase 3 managers
  const placementManagerRef = useRef(null);
  const gizmoControllerRef = useRef(null);

  // Phase 4 — performance monitor
  const perfMonitorRef = useRef(null);

  // Play mode (character + hotbar building)
  const playRef = useRef(null);
  const siteEnvRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [playHud, setPlayHud] = useState(null);
  const [hotbar, setHotbar] = useState(DEFAULT_HOTBAR);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [interaction, setInteraction] = useState(null);
  const cardTimerRef = useRef(null);
  const [positionsVersion, setPositionsVersion] = useState(0); // bumps when the org-chart positions change
  const exitPlayRef = useRef(() => {});
  const heldItemRef = useRef(null);         // the hotbar item in the character's hand
  const [newFloorAsk, setNewFloorAsk] = useState(false); // Preview: N asked "copy rooms or empty?"

  // Faint outline of the floor below while building on an upper floor (both modes)
  const floorOutlineRef = useRef(null);
  const playBuildToolRef = useRef(false);   // Preview: holding a room / wall / stretch tool
  const updateFloorOutlineRef = useRef(() => {});

  // Undo / Redo — every layout change goes through this (see store/editorHistory.js)
  const [undoState, setUndoState] = useState({
    canUndo: false, canRedo: false, undoLabel: null, redoLabel: null,
  });
  const editorRef = useRef(null);
  if (!editorRef.current) editorRef.current = createEditorHistory(setUndoState);
  const editor = editorRef.current;

  // Phase 6 — Snap and environment local UI state
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapStep, setSnapStep] = useState(0.5);
  const [environment, setEnvironment] = useState('day'); // 'day' | 'night' | 'office'
  const snapRef = useRef({ enabled: true, step: 0.5 }); // read by the planner tools while dragging

  // Planner mouse tools (left toolbar → Build)
  const plannerToolsRef = useRef(null);
  const [plannerTool, setPlannerTool] = useState({ kind: 'select' });
  const [roomType, setRoomType] = useState('OFFICE');
  const [plannerHint, setPlannerHint] = useState(null);
  const [plannerMessage, setPlannerMessage] = useState(null); // { text, bad }
  const plannerMessageTimer = useRef(null);
  /** Short message in the footer after a change (red when something was blocked). */
  const showStudioMessage = useCallback((text, bad = false) => {
    clearTimeout(plannerMessageTimer.current);
    setPlannerMessage({ text, bad });
    plannerMessageTimer.current = setTimeout(() => setPlannerMessage(null), 3500);
  }, []);

  // Workplace Studio UI state
  const [openTray, setOpenTray] = useState(null);       // tool rail tile whose library is open
  const [layersOpen, setLayersOpen] = useState(false);  // Inspector shows the floor's outline
  const [showGrid, setShowGrid] = useState(false);      // off: grid only while a build tool is active
  const [realisticLook, setRealisticLook] = useState(storedRealisticLook); // Settings → Realistic look
  const [roomLabels, setRoomLabels] = useState(storedRoomLabels); // Settings → Room labels: 'names' | 'off'
  const [planView, setPlanView] = useState(false); // the canvas card's view: Plan (floor plan) instead of the 3D canvas
  const [announceText, setAnnounceText] = useState(''); // Screen reader live feedback (Task S3)
  const [sceneReady, setSceneReady] = useState(null);   // the scene, once created (for overlays)
  const [exportLoading, setExportLoading] = useState(false); // true while PNG/PDF is being generated
  const [measureMode, setMeasureMode] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [measureStart, setMeasureStart] = useState(null);
  const [measurePreview, setMeasurePreview] = useState(null);
  const [showWallLengths, setShowWallLengths] = useState(false);
  const [showRoomAreas, setShowRoomAreas] = useState(false);
  const measureModeRef = useRef(false);
  const measureStartRef = useRef(null);
  const measurementIdRef = useRef(0);

  // ─── Zustand state selectors ───
  const roomsMap = useWorkspaceStore((s) => s.rooms);
  const objectsMap = useWorkspaceStore((s) => s.objects);
  const currentFloor = useWorkspaceStore((s) => s.currentFloor);  // Phase 5
  const floorsMap = useWorkspaceStore((s) => s.floors);           // Phase 5
  const anchorData = useWorkspaceStore((s) => s.anchorData);      // links other modules saved on hook points

  // Filter rooms and objects by current floor
  const rooms = useMemo(
    () => Object.values(roomsMap).filter((r) => r.floor === currentFloor),
    [roomsMap, currentFloor]
  );
  const objects = useMemo(
    () => Object.values(objectsMap).filter((o) => o.floor === currentFloor),
    [objectsMap, currentFloor]
  );
  const floors = useMemo(() => Object.values(floorsMap).sort((a, b) => a.id - b.id), [floorsMap]);

  const selectedRoomId = useWorkspaceStore((s) => s.selectedRoomId);
  const selectedObjectId = useWorkspaceStore((s) => s.selectedObjectId);
  const placementMode = useWorkspaceStore((s) => s.placementMode);
  const gizmoMode = useWorkspaceStore((s) => s.gizmoMode) || 'position';
  const is3D = useWorkspaceStore((s) => s.is3D);
  const isDirty = useWorkspaceStore((s) => s.isDirty);
  const saveError = useWorkspaceStore((s) => s.saveError);
  const saveConflict = useWorkspaceStore((s) => s.saveConflict);   // another tab saved this layout
  const openElsewhere = useWorkspaceStore((s) => s.openElsewhere); // this layout is open in another tab too
  const storageNearlyFull = useWorkspaceStore((s) => s.storageNearlyFull);
  const syncStatus = useWorkspaceStore((s) => s.syncStatus);
  const pendingSyncCount = useWorkspaceStore((s) => s.pendingSyncCount);
  const selectedOpeningSel = useWorkspaceStore((s) => s.selectedOpening);
  const layoutName = useWorkspaceStore((s) => s.layoutName);
  const hasBackend = useWorkspaceStore((s) => !!(s.companyId && s.layoutId));
  const inAhdus = isAhdusBackendOn(); // Studio inside AHDUS: Back to AHDUS, Publish, no copies
  const phone = usePhone(); // a phone: bottom tool bar, library sheet, PhoneBar
  const [canvasTouched, setCanvasTouched] = useState(false); // a phone's "Drag to turn…" hint is gone for good

  // FPS is local — no need to put it in global store
  const fpsRef = useRef(0);
  const fpsDisplayRef = useRef(null);

  // ─── Zustand actions (stable references) ───
  const storeActions = useWorkspaceStore(
    (s) => ({
      // UI-only actions. Layout changes (add/update/delete rooms, objects,
      // floors) go through `editor` so they are undoable.
      selectRoom: s.selectRoom,
      selectObject: s.selectObject,
      setGizmoMode: s.setGizmoMode,
      setPlacementMode: s.setPlacementMode,
      setIs3D: s.setIs3D,
      selectFloor: s.selectFloor,
    }),
    shallow
  );

  /**
   * Add an object from a confirmed placement (click or drag-drop).
   * Keeps the ghost's height (scroll wheel / table-top stacking) and rotation (R key),
   * and assigns the room it was dropped in on the CURRENT floor.
   */
  const placeObject = (result) => {
    const store = useWorkspaceStore.getState();
    let roomId = null;
    for (const room of Object.values(store.rooms)) {
      if (room.floor !== store.currentFloor) continue;
      const halfW = room.width / 2;
      const halfD = room.depth / 2;
      if (
        result.x >= room.x - halfW && result.x <= room.x + halfW &&
        result.z >= room.z - halfD && result.z <= room.z + halfD
      ) {
        roomId = room.id;
        break;
      }
    }
    editor.addObject({
      assetType: result.assetType,
      category: ASSET_TYPES[result.assetType]?.category || 'Furniture',
      x: result.x,
      // the preview sits at a world height; objects store height above THEIR floor
      y: Math.max(0, result.y - elevationOf(store.floors, store.currentFloor)),
      z: result.z,
      rotationY: result.rotationY,
      floor: store.currentFloor,
      roomId,
    });
    // stairs that lead nowhere or don't fit their room: say so at once (the Inspector says it too)
    const stairProblem = result.assetType === 'STAIRCASE' && stairProblems(
      { x: result.x, z: result.z, rotationY: result.rotationY, floor: store.currentFloor },
      store.floors, Object.values(useWorkspaceStore.getState().rooms))[0];
    if (stairProblem) {
      showStudioMessage(stairProblem.text);
    } else if (result.assetType === 'STAIRCASE' && steepStairsText(floorHeight(store.floors, store.currentFloor))) {
      showStudioMessage(steepStairsText(floorHeight(store.floors, store.currentFloor)));
    }
  };

  // ─── Which storeys are visible (multi-storey buildings) ───
  // engine/systems/FloorSystem: planner (floors up to the one you edit, without
  // its roof), outside (all, with roofs) or inside (all, with ceilings: Preview)
  const floorSystemRef = useRef(null);
  const applyLevelVisibility = useCallback(() => floorSystemRef.current?.apply(), []);

  // ─── Start/stop auto-save on mount/unmount ───
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, []);

  // ─── Undo bursts (a run of + / −, a slider drag) end when the mouse is
  // released or the tool changes. After the release's own handlers, so the
  // last change of a drag still joins its undo step.
  useEffect(() => {
    let timer = null;
    const onPointerUp = () => { clearTimeout(timer); timer = setTimeout(() => editor.endBurst(), 0); };
    window.addEventListener('pointerup', onPointerUp, true);
    return () => { clearTimeout(timer); window.removeEventListener('pointerup', onPointerUp, true); };
  }, [editor]);
  useEffect(() => { editor.endBurst(); }, [editor, plannerTool, placementMode, selectedSlot, isPlaying]);

  // ─── Initialise Babylon Engine & Scene (hooks/useStudioScene.js) ───
  useStudioScene({
    canvasRef, sceneRef, cameraRef, lightsRef, siteEnvRef, roomSystemRef, objectSystemRef, floorSystemRef,
    characterSystemRef, builderRef, perfMonitorRef, playRef, placementManagerRef, plannerToolsRef, floorOutlineRef,
    gizmoControllerRef, cardTimerRef, exitPlayRef, playBuildToolRef, updateFloorOutlineRef, snapRef,
    isPlayingRef, measureModeRef, measureStartRef, measurementIdRef, fpsRef, fpsDisplayRef,
    plannerMessageTimer, setBuildProgress, setPlayHud, setSelectedSlot, setCatalogOpen, setNewFloorAsk,
    setInteraction, setPositionsVersion, setPlannerHint, setMeasurePreview, setMeasureStart, setMeasurements,
    setSceneReady, editor, showStudioMessage, placeObject, DEMO_MODULES,
  });

  // ─── Store → scene: meshes, the floor being edited, the gizmo (hooks/useStoreMeshSync.js) ───
  useStoreMeshSync({
    builderRef, floorSystemRef, cameraRef, gizmoControllerRef, objectSystemRef, roomsMap, objectsMap,
    floorsMap, selectedRoomId, currentFloor, sceneReady, isPlaying, applyLevelVisibility, selectedObjectId,
    objects, gizmoMode, buildProgress,
  });

  // ─── Play mode (character + hotbar) ───
  const handleEnterPlay = useCallback(() => {
    const play = playRef.current;
    if (!play || isPlayingRef.current) return;

    // Leave planner-only states
    const mgr = placementManagerRef.current;
    if (mgr?.isActive()) {
      mgr.cancelPlacement();
      storeActions.setPlacementMode(null);
    }
    gizmoControllerRef.current?.detach();
    storeActions.selectObject(null);
    storeActions.selectRoom(null);
    if (!useWorkspaceStore.getState().is3D) {
      // Play mode is always 3D: restore 3D lighting/camera first
      const camera = cameraRef.current;
      const lights = lightsRef.current;
      setCameraView({ scene: sceneRef.current, camera, lights }, '3d');
      storeActions.setIs3D(true);
    }

    setOpenTray(null);
    setLayersOpen(false);
    saveNow(); // switching modes is a natural moment to save what is pending
    isPlayingRef.current = true;
    play.activate();
    // Show the build grid only if the item in hand builds on the ground
    play.setTool(null);
    play.setTool(heldItemRef.current);
    setIsPlaying(true);
  }, [storeActions]);

  const handleExitPlay = useCallback(() => {
    const play = playRef.current;
    if (!play || !isPlayingRef.current) return;
    play.deactivate();
    saveNow();
    isPlayingRef.current = false;
    floorSystemRef.current?.setFloor(useWorkspaceStore.getState().currentFloor);
    setIsPlaying(false);
    setCatalogOpen(false);
    setNewFloorAsk(false);
    setPlayHud(null);
  }, [applyLevelVisibility]);
  exitPlayRef.current = handleExitPlay;

  // Put the selected hotbar item in the character's hand
  useEffect(() => {
    heldItemRef.current = hotbar[selectedSlot] ?? null;
    if (isPlayingRef.current) playRef.current?.setTool(heldItemRef.current);
  }, [hotbar, selectedSlot]);

  // Studio: the build grid shows while a build tool is active (or always, from Settings)
  useEffect(() => {
    if (isPlaying) return;
    siteEnvRef.current?.setBuildGrid(showGrid || plannerTool.kind !== 'select' || !!placementMode);
  }, [isPlaying, showGrid, plannerTool, placementMode, sceneReady]);

  const handleResumePlay = useCallback(() => {
    lockPointer(sceneRef.current?.getEngine().getRenderingCanvas());
  }, []);

  // Picking an item (or closing the catalog) goes straight back to playing
  const handleAssignToSlot = useCallback((item) => {
    setHotbar((bar) => bar.map((it, i) => (i === selectedSlot ? item : it)));
    setCatalogOpen(false);
    handleResumePlay();
  }, [selectedSlot, handleResumePlay]);

  const handleCloseCatalog = useCallback(() => {
    setCatalogOpen(false);
    handleResumePlay();
  }, [handleResumePlay]);

  // ─── 2D / 3D Toggle ───
  const handleToggleView = useCallback(() => {
    const camera = cameraRef.current;
    const lights = lightsRef.current;
    const scene = sceneRef.current;
    if (!camera || !lights || !scene) return;

    const store = useWorkspaceStore.getState();
    setCameraView({ scene, camera, lights }, store.is3D ? '2d' : '3d');
    storeActions.setIs3D(!store.is3D);
  }, [storeActions]);

  // ─── Planner build tools (left toolbar) ───
  const handleSetPlannerTool = useCallback((next) => {
    const mgr = placementManagerRef.current;
    if (mgr?.isActive()) {
      mgr.cancelPlacement();
      storeActions.setPlacementMode(null);
    }
    // Build tools act on rooms; don't leave the item gizmo in the way
    if (next.kind !== 'select') storeActions.selectObject(null);
    plannerToolsRef.current?.setTool(next);
    setPlannerTool(next);
  }, [storeActions]);

  const handleToggleMeasureMode = useCallback(() => {
    if (measureModeRef.current) {
      measureModeRef.current = false;
      measureStartRef.current = null;
      setMeasureMode(false);
      setMeasureStart(null);
      setMeasurePreview(null);
      return;
    }
    handleSetPlannerTool({ kind: 'select' });
    storeActions.selectObject(null);
    storeActions.selectRoom(null);
    if (useWorkspaceStore.getState().is3D) handleToggleView();
    measureStartRef.current = null;
    measureModeRef.current = true;
    setMeasureMode(true);
    setMeasureStart(null);
    setMeasurePreview(null);
  }, [handleSetPlannerTool, handleToggleView, storeActions]);

  const handleExitMeasureMode = useCallback(() => {
    measureModeRef.current = false;
    measureStartRef.current = null;
    setMeasureMode(false);
    setMeasureStart(null);
    setMeasurePreview(null);
  }, []);

  const handleClearMeasurements = useCallback(() => {
    measureStartRef.current = null;
    setMeasureStart(null);
    setMeasurePreview(null);
    setMeasurements([]);
  }, []);

  useEffect(() => {
    measureStartRef.current = null;
    setMeasureStart(null);
    setMeasurePreview(null);
  }, [currentFloor]);

  // Off in Preview (it has its own tools)
  useEffect(() => {
    plannerToolsRef.current?.setEnabled(!isPlaying);
  }, [isPlaying]);

  // Selecting a room shows "drag a wall to resize", a door its size handles; keep them current
  useEffect(() => {
    plannerToolsRef.current?.refresh();
  }, [selectedRoomId, selectedOpeningSel, currentFloor, roomsMap]);

  // ─── Doors and windows (selected in Studio) ───
  /** The selected door/window with its room, or null (also when it no longer exists). */
  const selectedOpening = useMemo(() => {
    if (!selectedOpeningSel) return null;
    const room = roomsMap[selectedOpeningSel.roomId];
    const data = room && openingData(room, selectedOpeningSel.kind, selectedOpeningSel.index);
    if (!data) return null;
    const sameFloor = Object.values(roomsMap).filter((r) => r.floor === room.floor);
    const partner = openingPartner(sameFloor, room, selectedOpeningSel.kind, selectedOpeningSel.index);
    return { ...selectedOpeningSel, room, data, partnerRoom: partner?.room ?? null };
  }, [selectedOpeningSel, roomsMap]);

  /**
   * Resize the selected door/window (Inspector). Returns the problem (and
   * keeps the old size) if the new size doesn't fit.
   */
  const handleResizeOpening = useCallback((change) => {
    const st = useWorkspaceStore.getState();
    const sel = st.selectedOpening;
    const room = sel && st.rooms[sel.roomId];
    if (!room) return null;
    const result = resizeOpening(
      Object.values(st.rooms).filter((r) => r.floor === room.floor), room, sel.kind, sel.index, change,
      { stairs: Object.values(st.objects).filter((o) => o.assetType === 'STAIRCASE') });
    if (result.problem) {
      showStudioMessage(result.problem, true);
      return result.problem;
    }
    editor.resizeOpening(result.list, { label: `Resize ${sel.kind}`, mergeKey: 'opening-fields' });
    return null;
  }, [editor, showStudioMessage]);

  const handleDeleteOpening = useCallback(() => {
    const st = useWorkspaceStore.getState();
    const sel = st.selectedOpening;
    const room = sel && st.rooms[sel.roomId];
    const data = room && openingData(room, sel.kind, sel.index);
    if (!data) return;
    const sameFloor = Object.values(st.rooms).filter((r) => r.floor === room.floor);
    editor.removeOpenings(planRemoveOpening(
      sameFloor, room, data.wall, openingCentre(room, data.wall, data.offset), sel.kind, sel.index));
    st.selectOpening(null);
    showStudioMessage(`Removed ${sel.kind}. Ctrl+Z to undo.`);
  }, [editor, showStudioMessage]);

  // ─── Floor below: its outline on the floor being built on ───
  updateFloorOutlineRef.current = () => {
    const outline = floorOutlineRef.current;
    if (!outline) return;
    const st = useWorkspaceStore.getState();
    const below = floorBelow(st.floors, st.currentFloor);
    const building = isPlayingRef.current
      ? playBuildToolRef.current
      : plannerTool.kind !== 'select' || !!st.selectedRoomId;
    if (!below || !building) { outline.hide(); return; }
    outline.show(Object.values(st.rooms).filter((r) => r.floor === below.id), elevationOf(st.floors, st.currentFloor));
  };
  useEffect(() => {
    updateFloorOutlineRef.current();
  }, [roomsMap, floorsMap, currentFloor, plannerTool, selectedRoomId, isPlaying, sceneReady]);

  // ─── Floors: add (empty or with the rooms below), height ───
  /** Add a floor on top; Studio switches to it. Returns its id. */
  const handleAddFloor = useCallback((copyRooms) => {
    const id = editor.addFloor({ copyRooms });
    if (id === null) return null;
    const st = useWorkspaceStore.getState();
    if (!isPlayingRef.current) st.selectFloor(id);
    const n = Object.values(st.rooms).filter((r) => r.floor === id).length;
    showStudioMessage(copyRooms
      ? `Added ${st.floors[id].name} with ${n} room${n === 1 ? '' : 's'} from below. Ctrl+Z to undo.`
      : `Added ${st.floors[id].name}. Ctrl+Z to undo.`);
    return id;
  }, [editor, showStudioMessage]);

  /** Floor menu: the floor's height (floor-to-floor). Returns the problem, or null. */
  const handleSetFloorHeight = useCallback((floorId, height) => {
    const plan = editor.setFloorHeight(floorId, height, { mergeKey: 'floor-height' });
    if (plan.problem) {
      showStudioMessage(plan.problem, true);
      return plan.problem;
    }
    const steep = steepStairsText(plan.height);
    if (steep) showStudioMessage(steep);
    return null;
  }, [editor, showStudioMessage]);

  /** Preview: the answer to "copy rooms or empty?" after N. Takes you to the new floor. */
  const handleNewFloorChoice = useCallback((copyRooms) => {
    setNewFloorAsk(false);
    const play = playRef.current;
    if (copyRooms === null || !play) { handleResumePlay(); return; }
    const id = handleAddFloor(copyRooms);
    if (id !== null) play.goToFloor(id);
    handleResumePlay();
  }, [handleAddFloor, handleResumePlay]);

  // ─── Rooms ───
  const handleDeleteRoom = useCallback((id) => {
    editor.deleteRoom(id);
  }, [editor]);

  const handleUpdateRoom = useCallback((id, patch, { typing = false } = {}) => {
    if ('departmentRef' in patch) {
      // the room's department (v0.14.9): a pick is one undo step, typing one step per burst
      editor.updateRoom(id, { departmentRef: patch.departmentRef }, { mergeKey: typing ? 'room-department' : undefined, label: 'Change department' });
      return;
    }
    // Typing a name / size merges into one undo step; changing the type is its own step
    const mergeKey = 'type' in patch ? undefined : 'room-fields';
    if ('wallHeight' in patch) {
      // Taller than the floor allows raises the floor (and the floors above)
      const room = useWorkspaceStore.getState().rooms[id];
      const plan = editor.setWallHeight(id, patch.wallHeight, { mergeKey: 'room-wall-height' });
      if (plan.problem) showStudioMessage(plan.problem, true);
      else if (plan.raised) {
        const steep = steepStairsText(plan.height);
        showStudioMessage(`${useWorkspaceStore.getState().floors[plan.floorId]?.name} is now ${plan.height.toFixed(1)} m high, to fit ${room?.name}${steep ? `. ${steep}` : ''}`);
      }
      return;
    }
    if ('wallThickness' in patch) {
      // Thicker walls take half of it from inside the room: rooms inside it and items may be in the way
      const state = useWorkspaceStore.getState();
      const room = state.rooms[id];
      const plan = planWallThickness(room, patch.wallThickness,
        Object.values(state.rooms).filter((other) => other.floor === room.floor), Object.values(state.objects),
        (o) => o.label || ASSET_TYPES[o.assetType]?.label || 'An item');
      if (plan.problem) showStudioMessage(plan.problem, true);
      else editor.updateRoom(id, { wallThickness: plan.thickness }, { mergeKey: 'room-wall-thickness', label: 'Change wall thickness' });
      return;
    }
    if ('width' in patch || 'depth' in patch) {
      const state = useWorkspaceStore.getState();
      const room = state.rooms[id];
      const plan = planRoomResize(
        room,
        patch.width ?? room.width,
        patch.depth ?? room.depth,
        Object.values(state.rooms).filter((other) => other.floor === room.floor),
      );
      if (plan.blocker) {
        showStudioMessage(`Would overlap ${plan.blocker.name}`, true);
        return;
      }
      // An edge that lands near a wall snaps onto it, which can move the centre a little
      patch = { ...patch, ...plan.rect };
    }
    editor.updateRoom(id, patch, { mergeKey });
  }, [editor, showStudioMessage]);

  // ─── AHDUS look: a room's Rotate, Duplicate and floor (selection bar, properties panel) ───
  const handleTurnRoom = useCallback((id) => {
    const st = useWorkspaceStore.getState();
    const room = st.rooms[id];
    if (!room) return;
    const plan = planRoomTurn(room, Object.values(st.rooms).filter((r) => r.floor === room.floor));
    if (plan.problem) { showStudioMessage(plan.problem, true); return; }
    editor.updateRoom(id, plan.patch, { label: 'Turn room' });
    showStudioMessage(`Turned ${room.name}. Its furniture stays where it is. Ctrl+Z to undo.`);
  }, [editor, showStudioMessage]);

  const handleDuplicateRoom = useCallback((id) => {
    const st = useWorkspaceStore.getState();
    const room = st.rooms[id];
    if (!room) return;
    const below = floorBelow(st.floors, room.floor);
    const rect = planRoomCopy(room, Object.values(st.rooms).filter((r) => r.floor === room.floor),
      below ? Object.values(st.rooms).filter((r) => r.floor === below.id) : null);
    if (!rect) { showStudioMessage('No free space next to it for a copy', true); return; }
    // Same type, size, walls and floor; no doors or windows (it may stand back to back with this one)
    editor.addRoom({
      type: room.type, color: room.color, wallHeight: room.wallHeight, wallThickness: room.wallThickness,
      ...(room.floorFinish ? { floorFinish: room.floorFinish } : {}), ...rect, floor: room.floor,
    });
    showStudioMessage(`Copied ${room.name}, without its doors and windows. Ctrl+Z to undo.`);
  }, [editor, showStudioMessage]);

  const handleSetFloorFinish = useCallback((id, kind) => {
    const room = useWorkspaceStore.getState().rooms[id];
    if (!room) return;
    // The room type's own floor is stored as 'default', so a new type brings its floor
    const floorFinish = kind === (FLOOR_BY_ROOM_TYPE[room.type] ?? 'wood') ? 'default' : kind;
    if ((room.floorFinish ?? 'default') === floorFinish) return;
    editor.updateRoom(id, { floorFinish }, { label: 'Change floor' });
  }, [editor]);

  // ─── Placing catalog items (furniture, stairs) ───
  const handleStartPlacement = useCallback((assetType) => {
    const mgr = placementManagerRef.current;
    if (!mgr) return;
    plannerToolsRef.current?.setTool({ kind: 'select' });
    setPlannerTool({ kind: 'select' });
    mgr.startPlacement(assetType);
    storeActions.setPlacementMode(assetType);
    storeActions.selectObject(null);
  }, [storeActions]);

  const handleCancelPlacement = useCallback(() => {
    const mgr = placementManagerRef.current;
    if (mgr) mgr.cancelPlacement();
    storeActions.setPlacementMode(null);
  }, [storeActions]);

  // ─── Build panel ───
  const handleSelectTool = useCallback(() => {
    handleSetPlannerTool({ kind: 'select' });
  }, [handleSetPlannerTool]);

  const handlePickOption = useCallback((option) => {
    if (option.disabled) return;
    if (option.place) {
      handleStartPlacement(option.place);
    } else if (option.tool) {
      if (option.tool.kind === 'room') setRoomType(option.tool.roomType);
      handleSetPlannerTool(option.tool);
    }
  }, [handleStartPlacement, handleSetPlannerTool]); // the library stays open

  // ─── The library: drag a tile onto the floor, click = the middle (hooks/useLibraryDrop.js) ───
  const libraryDrop = useLibraryDrop({
    sceneRef, cameraRef, canvasRef, placementManagerRef, editor, placeObject, snapRef,
    showStudioMessage, handleSetPlannerTool, handleStartPlacement,
  });
  const [templateAsk, setTemplateAsk] = useState(null); // a template whose "replace this layout?" is open
  const handleUseTemplate = useCallback(() => {
    const template = templateAsk;
    setTemplateAsk(null);
    if (!template) return;
    const res = editor.restoreVersion(normaliseLayout(JSON.parse(JSON.stringify(template.layout))));
    if (res?.problem) showStudioMessage(res.problem, true);
    else {
      showStudioMessage(`Started from the ${template.name} template. Ctrl+Z brings your layout back.`);
      setOpenTray(null);
    }
  }, [templateAsk, editor, showStudioMessage]);

  // ─── Camera: fit the floor, or fly to one thing ───
  const flyTo = useCallback((min, max) => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (camera && scene) flyCamera(camera, scene, { min, max });
  }, []);

  /** World box of a room or object mesh (enabled parts only). */
  const boundsOf = useCallback((node) => {
    if (!node) return null;
    const { min, max } = node.getHierarchyBoundingVectors(true, (m) => m.isEnabled());
    return min.x <= max.x ? { min, max } : null; // nothing enabled: ±MAX_VALUE
  }, []);

  const handleFitView = useCallback(() => {
    const st = useWorkspaceStore.getState();
    const onFloor = Object.values(st.rooms).filter((r) => r.floor === st.currentFloor);
    if (onFloor.length === 0) {
      flyTo({ x: -6, z: -6 }, { x: 6, z: 6 });
      return;
    }
    const min = { x: Math.min(...onFloor.map((r) => r.x - r.width / 2)), z: Math.min(...onFloor.map((r) => r.z - r.depth / 2)) };
    const max = { x: Math.max(...onFloor.map((r) => r.x + r.width / 2)), z: Math.max(...onFloor.map((r) => r.z + r.depth / 2)) };
    flyTo(min, max);
  }, [flyTo]);

  const handleSetView = useCallback((want3D) => {
    setPlanView(false);
    if (want3D !== useWorkspaceStore.getState().is3D) handleToggleView();
  }, [handleToggleView]);

  // Plan: the floor plan of this floor instead of the 3D canvas (the 3D tools stop)
  const handleSetPlan = useCallback(() => {
    handleExitMeasureMode();
    handleCancelPlacement();
    handleSetPlannerTool({ kind: 'select' });
    setOpenTray(null);
    setPlanView(true);
  }, [handleExitMeasureMode, handleCancelPlacement, handleSetPlannerTool]);

  // ─── AHDUS look: the camera card (ui/CameraControls) and its keys. Only the camera moves. ───
  const [panMode, setPanModeState] = useState(false);
  const cameraActions = useMemo(() => ({
    view: (which) => {
      if (which === 'top' && !useWorkspaceStore.getState().is3D) return; // the 2D view is the top view
      handleSetView(true); // Front and Side are 3D views
      turnCameraTo(cameraRef.current, sceneRef.current, which);
    },
    reset: () => {
      if (useWorkspaceStore.getState().is3D) turnCameraTo(cameraRef.current, sceneRef.current, 'home');
      handleFitView();
    },
    fit: handleFitView,
    zoom: (dir) => zoomCamera(cameraRef.current, sceneRef.current, dir),
    setPan: (on) => {
      setPanMode(cameraRef.current, on);
      setPanModeState(on);
      showStudioMessage(on ? 'Pan: drag to slide the view. Right-drag turns it.' : 'Orbit: drag to turn the view. Right-drag slides it.');
    },
  }), [handleSetView, handleFitView, showStudioMessage]);
  // A new scene has a new camera: keep the choice
  useEffect(() => { if (sceneReady) setPanMode(cameraRef.current, panMode); }, [sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const cameraKeyRef = useRef(null);
  cameraKeyRef.current = !planView ? (key) => {
    const act = {
      7: () => cameraActions.view('top'), 8: () => cameraActions.view('front'), 9: () => cameraActions.view('side'),
      h: cameraActions.reset, f: cameraActions.fit,
      '+': () => cameraActions.zoom(1), '=': () => cameraActions.zoom(1), '-': () => cameraActions.zoom(-1),
      o: () => cameraActions.setPan(false), p: () => cameraActions.setPan(true),
    }[key.toLowerCase()];
    if (!act) return false;
    act();
    return true;
  } : null;

  // ─── Selection ───
  const handleSelectObject = useCallback((id) => {
    storeActions.selectObject(id);
    storeActions.selectRoom(null);
  }, [storeActions]);

  /** Layers: select what was clicked and fly the camera to it */
  const handlePickLayer = useCallback(({ type, id }) => {
    if (type === 'room') {
      storeActions.selectRoom(id);
      storeActions.selectObject(null);
    } else {
      handleSelectObject(id);
    }
    const node = type === 'room' ? roomSystemRef.current?.getRoomMesh(id) : objectSystemRef.current?.getObjectMesh(id);
    const b = boundsOf(node);
    if (b) flyTo(b.min, b.max);
  }, [storeActions, handleSelectObject, boundsOf, flyTo]);

  const handleCloseInspector = useCallback(() => {
    storeActions.selectObject(null);
    storeActions.selectRoom(null);
    setLayersOpen(false);
  }, [storeActions]);

  const handleDeleteObject = useCallback((id) => {
    editor.deleteObject(id);
  }, [editor]);

  // Inspector sliders / typing: a burst of edits on one object = one undo step
  const handleUpdateObject = useCallback((id, patch) => {
    editor.updateObject(id, patch, { mergeKey: 'inspector', label: 'Edit properties' });
  }, [editor]);

  const handleToggleLock = useCallback((id) => {
    editor.toggleLock(id);
  }, [editor]);

  const handleSetGizmoMode = useCallback((mode) => {
    storeActions.setGizmoMode(mode);
    const ctrl = gizmoControllerRef.current;
    if (ctrl) ctrl.setMode(mode);
  }, [storeActions]);

  const handleDuplicateObject = useCallback((id) => {
    editor.duplicateObject(id);
  }, [editor]);

  // Phase 6: sync snap toggle to placementManager
  const handleSnapToggle = useCallback(() => {
    const mgr = placementManagerRef.current;
    const next = !snapEnabled;
    setSnapEnabled(next);
    snapRef.current.enabled = next;
    if (mgr) mgr.setSnapEnabled(next);
  }, [snapEnabled]);

  const handleSnapStepChange = useCallback((step) => {
    const mgr = placementManagerRef.current;
    const v = parseFloat(step);
    setSnapStep(v);
    snapRef.current.step = v;
    if (mgr) mgr.setSnapStep(v);
  }, []);

  // Settings → Realistic look (per browser): real models, photo textures, sky
  const handleRealisticLookToggle = useCallback(() => {
    setRealisticLook((on) => {
      const next = !on;
      storeRealisticLook(next);
      if (sceneRef.current) setRealistic(sceneRef.current, next);
      return next;
    });
  }, []);

  // Phase 6: environment lighting picker
  const handleEnvironmentChange = useCallback((env) => {
    setEnvironment(env);
    siteEnvRef.current?.setPreset(env);   // sky colour and fog
    const lights = lightsRef.current;
    if (!lights) return;
    const [hemi, sun] = env === 'night' ? [0.15, 0.3] : env === 'office' ? [0.6, 0.5] : [0.9, 0.8];
    lights.hemispheric.intensity = hemi;
    lights.directional.intensity = sun;
  }, []);

  // ─── Keyboard shortcuts (hooks/useStudioKeyboard.js) ───
  useStudioKeyboard({
    editor, handleCancelPlacement, handleSetGizmoMode, handleEnterPlay, handleSetPlannerTool,
    handleDeleteOpening, showStudioMessage, isPlayingRef, plannerToolsRef, measureModeRef, measureStartRef,
    placementManagerRef, snapRef, setMeasureMode, setMeasureStart, setMeasurePreview, setLayersOpen,
    setOpenTray, setAnnounceText, cameraKeyRef,
  });

  // ─── What the Studio shows ───
  const selectedObject = selectedObjectId ? objectsMap[selectedObjectId] ?? null : null;
  const selectedRoom = !selectedObject && selectedRoomId ? roomsMap[selectedRoomId] ?? null : null;
  // a selected staircase: why it can't be used as it stands (leads nowhere, doesn't fit its room)
  const stairWarnings = useMemo(
    () => (selectedObject?.assetType === 'STAIRCASE'
      ? stairProblems(selectedObject, floorsMap, Object.values(roomsMap)).map((p) => p.text) : []),
    [selectedObject, floorsMap, roomsMap],
  );

  // Accessibility (Task S3): Announce selection changes to screen readers
  useEffect(() => {
    if (selectedObject) {
      const def = ASSET_TYPES[selectedObject.assetType];
      const name = selectedObject.label || def?.label || selectedObject.assetType;
      setAnnounceText(`Selected ${name} at X ${(Number(selectedObject.x) || 0).toFixed(1)}, Z ${(Number(selectedObject.z) || 0).toFixed(1)} metres`);
    } else if (selectedRoom) {
      setAnnounceText(`Selected room ${selectedRoom.name}`);
    }
  }, [selectedObject, selectedRoom]);
  const inspectorMode = selectedObject ? 'object' : selectedRoom ? 'room'
    : selectedOpening ? 'opening' : layersOpen ? 'layers' : null;
  const floorName = floorsMap[currentFloor]?.name ?? '';
  const tile = activeTile(plannerTool, placementMode, ASSET_TYPES[placementMode]?.label);
  const hasAnyRoom = Object.keys(roomsMap).length > 0;
  const showEmpty = !hasAnyRoom && !openTray && plannerTool.kind === 'select' && !placementMode;

  const roomCounts = useMemo(() => {
    const counts = {};
    for (const r of Object.values(roomsMap)) counts[r.floor] = (counts[r.floor] ?? 0) + 1;
    return counts;
  }, [roomsMap]);

  // ─── Inside AHDUS: who sits at which desk (hooks/useAhdusSeats.js); toasts come from useAhdusPublish ───
  const toastRef = useRef(null);
  const allObjects = useMemo(() => Object.values(objectsMap), [objectsMap]);
  const seats = useAhdusSeats({
    enabled: inAhdus && hasBackend, objects: allObjects, phone,
    toast: (tone, text) => toastRef.current?.(tone, text),
  });
  // A room's Department choices (v0.14.9): inside AHDUS the company's (GET /api/teams/departments), else the ones
  // LayoutEditor's `departments` gives; none (or AHDUS can't be reached): the field is free text
  const [ahdusDepartments, setAhdusDepartments] = useState(null);
  useEffect(() => {
    if (!inAhdus || !hasBackend) return undefined;
    let live = true;
    listDepartments().then((r) => { if (live && r.ok) setAhdusDepartments(r.names); });
    return () => { live = false; };
  }, [inAhdus, hasBackend]);
  const departmentNames = useMemo(() => departmentChoices(inAhdus ? ahdusDepartments : departments),
    [inAhdus, ahdusDepartments, departments]);
  // People at their desks: inside AHDUS its seats, else only when some are passed in (LayoutEditor's `people`)
  const studioPeople = inAhdus ? seats.people : people;
  useEffect(() => {
    if (sceneReady) characterSystemRef.current?.setPeople(studioPeople ?? []);
  }, [sceneReady, studioPeople]);
  const seatPanel = seats.access !== 'none' && selectedObject && isDesk(selectedObject.assetType) ? {
    access: seats.access,
    seat: seatAtDesk(seats.seats, selectedObject.id),
    busy: seats.busy,
    onAssign: (person) => seats.assign(selectedObject.id, person),
    onRemove: () => seats.remove(selectedObject.id),
    search: seats.search,
    whereSits: (userId) => {
      const seat = seatOfPerson(seats.seats, userId);
      return seat ? `Sits at ${seats.label(seat.deskId)}` : null;
    },
  } : null;

  // Footer hint: a short message after a change, else what the tool says
  // (problems in red, sizes while dragging), else the tool's own hint
  const footerHint = (() => {
    if (seats.pickHint) return { text: seats.pickHint, tone: 'message' };
    if (libraryDrop.hint) return { text: libraryDrop.hint, tone: libraryDrop.hintBad ? 'bad' : 'message' };
    if (plannerMessage) return { text: plannerMessage.text, tone: plannerMessage.bad ? 'bad' : 'message' };
    if (!placementMode && plannerHint) {
      const line = [plannerHint.title, plannerHint.detail].filter(Boolean).join(' · ');
      if (plannerHint.bad) return { text: line, tone: 'bad' };
      if (plannerToolsRef.current?.isDragging() || plannerTool.kind === 'select') return { text: line, tone: 'hint' };
    }
    // A phone with nothing going on: how to move the view with fingers (not under a bottom sheet,
    // not once you have touched the view)
    if (phone && plannerTool.kind === 'select' && !placementMode) {
      return { text: phoneIdleHint({ sheetOpen: !!openTray || !!inspectorMode, touched: canvasTouched }), tone: 'hint' };
    }
    return { text: toolHint(plannerTool, placementMode), tone: 'hint' };
  })();

  const getSelectionBounds = useCallback(() => {
    if (selectedObjectId) return boundsOf(objectSystemRef.current?.getObjectMesh(selectedObjectId));
    if (selectedRoomId) return boundsOf(roomSystemRef.current?.getRoomMesh(selectedRoomId));
    return null;
  }, [selectedObjectId, selectedRoomId, boundsOf]);

  // Not saved (with the reason) / Saving… (a change waits for the debounced save) / Saved / Offline / Syncing
  const saveStatus = !hasBackend
    ? 'unsaved'
    : syncStatus === 'offline' || pendingSyncCount > 0
      ? 'offline'
      : syncStatus === 'syncing'
        ? 'syncing'
        : saveError
          ? 'unsaved'
          : isDirty
            ? 'saving'
            : 'saved';

  // ─── File and layout actions (hooks/useStudioFileActions.js) ───
  const {
    handleAllLayouts, handleReloadTheirs, handleExportLayout, handleImportLayout, handleSaveCopy,
    handleExportPng, handleExportPdf, handlePhotoReconstruct,
  } = useStudioFileActions({ onExit, editor, showStudioMessage, gizmoControllerRef, setExportLoading });

  // ─── Inside AHDUS: publish, leave, rename (hooks/useAhdusPublish.js) ───
  const ahdus = useAhdusPublish({ enabled: inAhdus && hasBackend, onLeave: handleAllLayouts });
  toastRef.current = ahdus.showToast;
  const { refresh: refreshSeats } = seats;
  useEffect(() => { if (ahdus.dialog === 'publish') refreshSeats(); }, [ahdus.dialog, refreshSeats]);
  const loadVersions = useCallback(
    () => listVersions(AHDUS_COMPANY, useWorkspaceStore.getState().layoutId),
    [],
  );

  // ─── Loading screen: tell App after the first frame of the built floor (ui/firstFrame.js) ───
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;
  const firstFrameSeen = useRef(false);
  useEffect(() => {
    if (!sceneReady || firstFrameSeen.current) return undefined;
    return watchFirstFrame(
      sceneReady,
      () => builderRef.current?.progress.currentFloorReady !== false,
      () => { firstFrameSeen.current = true; onFirstFrameRef.current?.(); },
    );
  }, [sceneReady]);

  // ─── Render ───
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announceText}
      </div>
      {inAhdus && <Toast toast={ahdus.toast} onClose={ahdus.closeToast} />}
      {ahdus.dialog === 'publish' && (
        <PublishDialog
          siteName={layoutName}
          state={ahdus.state}
          busy={ahdus.publishing}
          loadVersions={loadVersions}
          seatWarning={losingDeskText(seats.losing)}
          onCancel={ahdus.cancelDialog}
          onConfirm={ahdus.confirmPublish}
        />
      )}
      {seats.confirm && (
        <Dialog
          title={seats.confirm.plan.title}
          label="Who sits here"
          onCancel={seats.cancelAssign}
          actions={(
            <>
              <button className="ui-btn" onClick={seats.cancelAssign} disabled={seats.busy} data-autofocus>Cancel</button>
              <button className="ui-btn is-primary" onClick={seats.confirmAssign} disabled={seats.busy}>
                {seats.confirm.plan.confirmLabel}
              </button>
            </>
          )}
        >
          <p data-seat-question>{seats.confirm.plan.question}</p>
        </Dialog>
      )}
      {templateAsk && (
        <Dialog
          title={`Start from the ${templateAsk.name} template?`}
          label="Start from a template"
          onCancel={() => setTemplateAsk(null)}
          actions={(
            <>
              <button className="ui-btn" onClick={() => setTemplateAsk(null)} data-autofocus>Cancel</button>
              <button className="ui-btn is-primary" onClick={handleUseTemplate}>Replace this layout</button>
            </>
          )}
        >
          <p>Everything in this layout is replaced by the template. Ctrl+Z brings it back.</p>
        </Dialog>
      )}
      {ahdus.dialog === 'leave' && (
        <LeaveDialog
          state={ahdus.state}
          busy={ahdus.publishing}
          onStay={ahdus.cancelDialog}
          onPublish={ahdus.publishAndLeave}
          onLeave={ahdus.leaveAnyway}
        />
      )}
      <StudioShell
        preview={isPlaying}
        inspectorOpen={!!inspectorMode}
        banner={(
          <>
            {phone && (
              <PhoneBar
                saveStatus={saveStatus}
                saveError={hasBackend ? saveError : 'This layout has no place to save to'}
                publishState={ahdus.state}
                onPublish={inAhdus && hasBackend ? ahdus.openPublish : null}
                is3D={is3D}
                planView={planView}
                onSetView={handleSetView}
                onSetPlan={handleSetPlan}
              />
            )}
            <ProposedLayoutBanner editor={editor} onMessage={showStudioMessage} />
            {seats.access === 'manage' && (
              <SeatsBanner seats={seats.withoutDesk} busy={seats.busy} picking={seats.pickingFor}
                onAssignDesk={seats.startPickDesk} onRemove={seats.remove} />
            )}
          </>
        )}
      header={(
        <StudioHeader
          layoutName={layoutName}
          onRenameLayout={inAhdus ? ahdus.renameSite : (name) => renameLayout(name)}
          siteName={inAhdus}
          onAllLayouts={onExit ? (inAhdus ? ahdus.requestLeave : handleAllLayouts) : null}
          allLayoutsLabel={inAhdus ? 'Back to AHDUS' : 'All layouts'}
          onPublish={inAhdus && hasBackend ? ahdus.openPublish : null}
          publishState={ahdus.state}
          publishing={ahdus.publishing}
          saveStatus={saveStatus}
          saveError={hasBackend ? saveError : 'This layout has no place to save to'}
          undoState={undoState}
          onUndo={() => editor.undo()}
          onRedo={() => editor.redo()}
          editor={editor}
          onMessage={showStudioMessage}
          onPreview={handleEnterPlay}
          settings={{
            snapEnabled,
            onSnapToggle: handleSnapToggle,
            snapStep,
            onSnapStepChange: handleSnapStepChange,
            showGrid,
            onShowGridToggle: () => setShowGrid((v) => !v),
            environment,
            onEnvironmentChange: handleEnvironmentChange,
            fpsRef: fpsDisplayRef,
            realisticLook,
            onRealisticLookToggle: handleRealisticLookToggle,
            roomLabels,
            onRoomLabelsChange: (value) => { setRoomLabels(value); storeRoomLabels(value); },
            onExportLayout: hasBackend ? handleExportLayout : null,
            onImportLayout: handleImportLayout,
            importTitle: inAhdus ? 'Replace this workplace with a layout from a file (Ctrl+Z undoes it)' : undefined,
            onPhotoReconstruct: isPhotoReconstructionOn() ? handlePhotoReconstruct : null,
          }}
        />
      )}
      buildPanel={(
        <BuildPanel
          active={tile}
          openTray={openTray}
          onOpenTray={setOpenTray}
          onSelectTool={handleSelectTool}
          onPickOption={handlePickOption}
          layersOpen={inspectorMode === 'layers'}
          library={{
            activeOption: plannerTool.kind === 'room' ? (plannerTool.stamp ? plannerTool.roomType : null) : tile.option,
            draggingId: libraryDrop.drag?.tile.id ?? null,
            onTilePointerDown: libraryDrop.onTilePointerDown,
            onPlaceTile: libraryDrop.onPlaceTile,
            onPickOption: handlePickOption,
            drawing: plannerTool.kind === 'room' && !plannerTool.stamp,
            onDrawRoom: () => handlePickOption({ tool: { kind: 'room', roomType } }),
            onTemplate: setTemplateAsk,
            sheet: phone,
            onClose: () => setOpenTray(null),
          }}
          onToggleLayers={() => {
            if (selectedObject || selectedRoom || selectedOpening) {
              storeActions.selectObject(null);
              storeActions.selectRoom(null);
              setLayersOpen(true);
            } else {
              setLayersOpen((v) => !v);
            }
          }}
        />
      )}
      canvas={(
        <CanvasCard
          preview={isPlaying}
          is3D={is3D}
          onSetView={handleSetView}
          planView={planView}
          onSetPlan={handleSetPlan}
          showEmpty={showEmpty}
          onAddFirstRoom={() => setOpenTray('rooms')}
          phone={phone}
          camera={(
            <CameraControls
              compact={phone}
              onView={cameraActions.view}
              onReset={cameraActions.reset}
              onFit={cameraActions.fit}
              onZoom={cameraActions.zoom}
              pan={panMode}
              onSetPan={cameraActions.setPan}
            />
          )}
          footer={(
            <StudioFooter
              floors={floors}
              currentFloor={currentFloor}
              roomCounts={roomCounts}
              onSelectFloor={storeActions.selectFloor}
              onAddFloor={handleAddFloor}
              onSetFloorHeight={handleSetFloorHeight}
              onRenameFloor={(id, name) => editor.renameFloor(id, name)}
              onRemoveFloor={(id) => editor.removeFloor(id)}
              hint={footerHint}
            />
          )}
          onExportPng={!isPlaying ? handleExportPng : undefined}
          onExportPdf={!isPlaying ? handleExportPdf : undefined}
          exportDisabled={!hasAnyRoom || isPlaying}
          exportLoading={exportLoading}
          measureMode={measureMode}
          onToggleMeasure={handleToggleMeasureMode}
          onExitMeasure={handleExitMeasureMode}
          onClearMeasurements={handleClearMeasurements}
          hasMeasurements={measurements.length > 0 || !!measureStart}
          showWallLengths={showWallLengths}
          onToggleWallLengths={() => setShowWallLengths((visible) => !visible)}
          showRoomAreas={showRoomAreas}
          onToggleRoomAreas={() => setShowRoomAreas((visible) => !visible)}
        >
          <canvas
            ref={canvasRef}
            className={measureMode ? 'is-measuring' : ''}
            onPointerDown={phone && !canvasTouched ? () => setCanvasTouched(true) : undefined}
            style={{
              visibility: planView && !isPlaying ? 'hidden' : 'visible',
              pointerEvents: planView && !isPlaying ? 'none' : 'auto',
            }}
          />
          {planView && !isPlaying && (
            <FloorPlanView
              rooms={rooms}
              objects={objects}
              selectedRoomId={selectedRoomId}
              selectedObjectId={selectedObjectId}
              anchorData={anchorData}
              onSelectRoom={(id) => {
                storeActions.selectRoom(id);
                storeActions.selectObject(null);
              }}
              onSelectObject={(id) => {
                storeActions.selectObject(id);
                storeActions.selectRoom(null);
              }}
              snap={{ enabled: snapEnabled, step: snapStep }}
              ground={currentFloor === 0}
              onMoveObject={(id, to) => {
                // one undo step per drag, like the 3D gizmo
                editor.updateObject(id, to, { label: 'Move item' });
                editor.endBurst();
              }}
              onRotateObject={(id) => {
                const object = objectsMap[id];
                if (object && !object.isLocked) {
                  editor.updateObject(
                    id,
                    { rotationY: (Number(object.rotationY) || 0) + Math.PI / 2 },
                    { label: 'Rotate object' }
                  );
                }
              }}
              onRotateByAngle={(id, deltaRad) => {
                const object = objectsMap[id];
                if (object && !object.isLocked) {
                  editor.updateObject(
                    id,
                    { rotationY: (Number(object.rotationY) || 0) + deltaRad },
                    { label: 'Rotate object' }
                  );
                }
              }}
            />
          )}
          <DropFootprint drag={libraryDrop.drag} />
          {/* Not in Plan view: the plan is drawn from the store, so nothing there waits for the build */}
          {buildProgress && !buildProgress.allBuilt && !(planView && !isPlaying) && (
            <div
              role="status"
              className={`build-progress ${buildProgress.currentFloorReady ? 'is-rest' : 'is-start'}${isPlaying ? ' in-preview' : ''}`}
              data-build-progress={buildProgress.currentFloorReady ? 'rest' : 'start'}
            >
              {buildProgress.currentFloorReady ? 'Building the other floors…' : 'Building your workplace…'}{' '}
              {progressPercent(buildProgress)} %
            </div>
          )}
          <TabNotice
            conflict={saveConflict}
            conflictText={inAhdus ? saveError : null}
            openElsewhere={openElsewhere}
            storageNearlyFull={storageNearlyFull}
            onReload={handleReloadTheirs}
            onSaveCopy={inAhdus ? null : handleSaveCopy}
            onExport={hasBackend ? handleExportLayout : null}
          />
          <RoomLabels
            scene={sceneReady}
            rooms={rooms}
            elevation={elevationOf(floorsMap, currentFloor)}
            hidden={isPlaying || planView}
            showArea={showRoomAreas}
            showNames={roomLabels !== 'off'}
            selectedRoomId={selectedOpening ? null : selectedRoomId}
            selectedAsPill
          />
          <RoomHoverCard
            scene={sceneReady}
            rooms={rooms}
            floorId={currentFloor}
            is3D={is3D}
            hidden={isPlaying || planView}
            selectedRoomId={selectedOpening ? null : selectedRoomId}
            isBusy={() => measureModeRef.current || !!plannerToolsRef.current?.isDragging() ||
              !!placementManagerRef.current?.isActive()}
            pickPerson={studioPeople?.length ? (x, y) => characterSystemRef.current?.pickPerson(x, y) ?? null : null}
          />
          <MeasurementOverlay
            scene={sceneReady}
            rooms={rooms}
            objects={objects}
            elevation={elevationOf(floorsMap, currentFloor)}
            showWallLengths={showWallLengths}
            measurements={measurements}
            measureStart={measureStart}
            preview={measurePreview}
            currentFloor={currentFloor}
            hidden={isPlaying || planView}
          />
          {!isPlaying && !planView && (selectedObject || selectedRoom) && (
            <SelectionToolbar
              scene={sceneReady}
              getBounds={getSelectionBounds}
              targetKey={selectedObjectId ?? selectedRoomId}
              kind={selectedObject ? 'object' : 'room'}
              object={selectedObject}
              gizmoMode={gizmoMode}
              onGizmoMode={handleSetGizmoMode}
              onDuplicate={() => editor.duplicateObject(selectedObjectId)}
              onDelete={() => (selectedObject ? editor.deleteObject(selectedObjectId) : editor.deleteRoom(selectedRoomId))}
              onMoveRoom={() => showStudioMessage("Drag the room's floor to move it. Its furniture stays where it is.")}
              onTurnRoom={() => handleTurnRoom(selectedRoomId)}
              onDuplicateRoom={() => handleDuplicateRoom(selectedRoomId)}
              minTop={phone ? 120 : 8}
            />
          )}
          {isPlaying && (
            <PlayHUD
              hud={playHud}
              floorName={floorName}
              onFloorUp={() => playRef.current?.stepFloor(1)}
              onFloorDown={() => playRef.current?.stepFloor(-1)}
              onBackToEntrance={() => playRef.current?.backToEntrance()}
              newFloorAsk={newFloorAsk}
              copyFromName={floorsMap[currentFloor]?.name ?? ''}
              onNewFloorChoice={handleNewFloorChoice}
              hotbar={hotbar}
              selectedSlot={selectedSlot}
              onSelectSlot={setSelectedSlot}
              catalogOpen={catalogOpen}
              onOpenCatalog={() => {
                document.exitPointerLock?.();
                setCatalogOpen(true);
              }}
              onCloseCatalog={handleCloseCatalog}
              onAssign={handleAssignToSlot}
              onResume={handleResumePlay}
              onExitToStudio={handleExitPlay}
              interaction={interaction}
              demoModules={DEMO_MODULES}
            />
          )}
        </CanvasCard>
      )}
      inspector={(
        <Inspector
          mode={inspectorMode}
          object={selectedObject}
          stairWarnings={stairWarnings}
          room={selectedRoom}
          opening={selectedOpening}
          onResizeOpening={handleResizeOpening}
          onDeleteOpening={handleDeleteOpening}
          floorName={floorName}
          rooms={rooms}
          objects={objects}
          floors={floors}
          onClose={handleCloseInspector}
          onUpdateObject={handleUpdateObject}
          onDuplicate={handleDuplicateObject}
          onToggleLock={handleToggleLock}
          onDeleteObject={handleDeleteObject}
          onUpdateRoom={handleUpdateRoom}
          onRenameRoom={(id, name) => handleUpdateRoom(id, { name })}
          onDeleteRoom={handleDeleteRoom}
          hookPoints={selectedObject ? anchorsForObject(selectedObject, anchorData) : []}
          positions={positionsVersion >= 0 ? layoutBridge.getPositions() : []}
          onSetPositionRef={(anchorId, positionId, typing) =>
            editor.setAnchorData(anchorId, { positionRef: positionId }, {
              label: positionId ? 'Link position' : 'Remove position link',
              mergeKey: typing ? 'position-typing' : undefined,
            })}
          onPickLayer={handlePickLayer}
          onSetFloorFinish={handleSetFloorFinish}
          onSelectOpening={(o) => useWorkspaceStore.getState().selectOpening(o)}
          onAddOpening={() => { setOpenTray('doors'); handlePickOption({ tool: { kind: 'door' } }); }}
          onDuplicateRoom={handleDuplicateRoom}
          seatPanel={seatPanel}
          departmentChoices={departmentNames}
        />
      )}
    />
    </>
  );
}
