/**
 * WorkplaceEditor.jsx
 *
 * The workplace editor: Babylon scene setup, store → mesh syncing, level
 * visibility, and switching between Workplace Studio (src/ui/, the planner
 * tools) and Preview (play/playController.js + PlayHUD). The Studio's look
 * lives in src/ui/; this file wires it to the scene and to editorHistory.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { Matrix } from '@babylonjs/core/Maths/math.vector';

// Engine, scene, camera, lights and site: shared with the embeddable engine
import { createLayoutScene } from '../engine/systems/SceneSetup';
import { storedRealisticLook, storeRealisticLook, whenLoaded, setRealistic } from '../utils/realLook';
import { RoomSystem } from '../engine/systems/RoomSystem';
import { ObjectSystem } from '../engine/systems/ObjectSystem';
import { FloorSystem } from '../engine/systems/FloorSystem';
import { SceneBuilder } from '../engine/systems/SceneBuilder';
import { progressPercent } from '../play/buildSchedule';
import { setCameraView, flyTo as flyCamera } from '../engine/systems/CameraSystem';

// Phase 2 utilities
import { ROOM_TYPES } from '../utils/roomStore';
import {
  elevationOf, floorBelow,
  stairNeedsRoomAbove, floorPosition,
} from '../play/building';
import { createFloorOutline } from '../utils/floorOutline';

// Phase 3 utilities
import { ASSET_TYPES } from '../utils/assetCatalog';
import { createPlacementManager } from '../utils/placementManager';
import { createGizmoController } from '../utils/gizmoController';

// Phase 4 — Zustand store + API
import {
  useWorkspaceStore,
} from '../store/workspaceStore';
import { createEditorHistory } from '../store/editorHistory';
import {
  startAutoSave, stopAutoSave, saveNow, renameLayout, reloadLayout, saveAsCopy, exportLayout, importLayout,
} from '../services/apiService';
import { downloadText } from '../ui/download';
import { exportFloorPlanAsPng, exportFloorPlanAsPdf } from '../utils/floorPlanExporter';

// Phase 4 — Performance optimisation
import { createPerformanceMonitor } from '../utils/performanceOptimiser';

// Components
import PlayHUD from './PlayHUD';

// Workplace Studio UI (UI_SPEC.md)
import StudioShell from '../ui/StudioShell';
import StudioHeader from '../ui/StudioHeader';
import BuildPanel from '../ui/BuildPanel';
import CanvasCard from '../ui/CanvasCard';
import RoomLabels from '../ui/RoomLabels';
import MeasurementOverlay from '../ui/MeasurementOverlay';
import FloorPlanView from '../floorplan/FloorPlanView';
import SelectionToolbar from '../ui/SelectionToolbar';
import Inspector from '../ui/Inspector';
import StudioFooter from '../ui/StudioFooter';
import TabNotice from '../ui/TabNotice';
import ProposedLayoutBanner from '../ui/ProposedLayoutBanner';
import {
  uploadReconstructionPhoto,
  requestPhotoAnalysis,
  stageProposedLayout,
} from '../services/reconstructionService';
import { STUDIO_TOOLS, activeTile, toolHint } from '../ui/tools';

// Play mode — walk around as a character and build (replaces the old walkthrough)
import { createPlayController } from '../play/playController';
// Planner mouse tools: draw rooms/walls, doors/windows, drag walls (same maths as Build mode)
import { createPlannerTools } from '../planner/plannerTools';
import { itemOverFloorPoint, wallTargetOf } from '../utils/pickHelpers';
import {
  openingData, openingPartner, openingCentre, openingAt, resizeOpening, planRemoveOpening,
  planRoomResize,
} from '../play/geometry';
import { DEFAULT_HOTBAR } from '../play/hotbarItems';
import { distanceBetweenPoints } from '../utils/measurements';

// Team integration: how other modules connect to the layout (docs/TEAM_INTEGRATION.md)
import { layoutBridge } from '../integration/layoutBridge';
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

export default function WorkplaceEditor({ onExit }) {
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
  const [openTray, setOpenTray] = useState(null);       // Build tile whose options tray is open
  const [layersOpen, setLayersOpen] = useState(false);  // Inspector shows the floor's outline
  const [showGrid, setShowGrid] = useState(false);      // off: grid only while a build tool is active
  const [realisticLook, setRealisticLook] = useState(storedRealisticLook); // Settings → Realistic look
  const [nameFocusToken, setNameFocusToken] = useState(0); // "Rename" focuses the Inspector's name box
  const [planView, setPlanView] = useState(false); // the canvas card's view: Plan (floor plan) instead of the 3D canvas
  const [announceText, setAnnounceText] = useState(''); // Screen reader live feedback (Task S3)
  const [sceneReady, setSceneReady] = useState(null);   // the scene, once created (for overlays)
  const [exportLoading, setExportLoading] = useState(false); // true while PNG/PDF is being generated
  const [measureMode, setMeasureMode] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [measureStart, setMeasureStart] = useState(null);
  const [measurePreview, setMeasurePreview] = useState(null);
  const [showWallLengths, setShowWallLengths] = useState(true);
  const [showRoomAreas, setShowRoomAreas] = useState(true);
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
    if (result.assetType === 'STAIRCASE' && stairNeedsRoomAbove(
      { x: result.x, z: result.z, rotationY: result.rotationY, floor: store.currentFloor },
      store.floors, Object.values(useWorkspaceStore.getState().rooms))) {
      showStudioMessage('Build a room above to use these stairs');
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

  // ─── Initialise Babylon Engine & Scene ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Engine, scene, camera, lights, sky / grass / paving, render loop, resizing.
    // Studio and Preview share the real-world look; the build grid shows only
    // while a build tool is active (see below)
    const layoutScene = createLayoutScene(canvas, { quality: storedRealisticLook() ? 'high' : 'low' });
    const { engine, scene, camera, lights, siteEnv } = layoutScene;
    sceneRef.current = scene;
    cameraRef.current = camera;
    lightsRef.current = lights;
    siteEnvRef.current = siteEnv;
    const roomSystem = new RoomSystem(scene, { shadowGenerator: lights.shadowGenerator });
    roomSystemRef.current = roomSystem;
    const objectSystem = new ObjectSystem(scene, { shadowGenerator: lights.shadowGenerator });
    objectSystemRef.current = objectSystem;
    const floorSystem = new FloorSystem(roomSystem, objectSystem, () => useWorkspaceStore.getState());
    floorSystemRef.current = floorSystem;
    let shownProgress = '';
    const builder = new SceneBuilder({
      rooms: roomSystem,
      objects: objectSystem,
      floors: floorSystem,
      getLayout: () => useWorkspaceStore.getState(),
      onProgress: (progress) => {
        // No frames until the floor you are on is built (it then shows at once)
        layoutScene.holdRendering(!progress.currentFloorReady);
        // A low FPS while building says nothing about rendering: don't lower the resolution then
        perfMonitorRef.current?.setEnabled(progress.allBuilt);
        const key = `${progressPercent(progress)}|${progress.currentFloorReady}|${progress.allBuilt}`;
        if (key === shownProgress) return;
        shownProgress = key;
        setBuildProgress(progress);
      },
    });
    builderRef.current = builder;
    // Dev only (e2e): wait for the build (__ahdusBuild.whenBuilt()), see how far it is
    if (import.meta.env.DEV) window.__ahdusBuild = builder;

    // ── Phase 4: Performance monitor ──
    const perfMonitor = createPerformanceMonitor(engine);
    perfMonitorRef.current = perfMonitor;

    const play = createPlayController(scene, canvas, {
      getState: () => {
        const st = useWorkspaceStore.getState();
        return {
          rooms: Object.values(st.rooms),
          objects: Object.values(st.objects),
          currentFloor: st.currentFloor,
          floors: st.floors,
        };
      },
      actions: {
        addObject: (d) => editor.addObject(d),
        updateObject: (id, patch, opts) => editor.updateObject(id, patch, opts),
        deleteObject: (id) => editor.deleteObject(id),
        toggleLock: (id) => editor.toggleLock(id),
        addRoom: (d) => editor.addRoom(d),
        deleteRoom: (id) => editor.deleteRoom(id),
        updateRoom: (id, patch, opts) => editor.updateRoom(id, patch, opts),
        setWallHeight: (id, h, opts) => editor.setWallHeight(id, h, opts),
        addFloor: (opts) => editor.addFloor(opts),
        addOpenings: (list) => editor.addOpenings(list),
        removeOpenings: (list) => editor.removeOpenings(list),
        resizeOpening: (list, opts) => editor.resizeOpening(list, opts),
      },
      getObjectMesh: (id) => objectSystem.getObjectMesh(id),
      onHud: setPlayHud,
      onSlotKey: (i) => setSelectedSlot(i),
      onSlotScroll: (d) => setSelectedSlot((cur) => (cur + d + 9) % 9),
      onCatalog: () => {
        setCatalogOpen((open) => {
          if (!open && document.pointerLockElement) document.exitPointerLock?.();
          return !open;
        });
      },
      onExit: () => exitPlayRef.current(),
      // ── Team integration: E and rooms become events other modules listen to ──
      // (described from Studio's own layout, even with a viewer open on the page)
      describeInteraction: (raw) => layoutBridge._prompt(raw, bridgeContext),
      onInteract: (raw) => layoutBridge._interact(raw, bridgeContext),
      onRoomChange: (from, to) => {
        if (from) {
          layoutBridge._emit('exitRoom', {
            roomId: from.id, room: layoutBridge._roomView(from.id, bridgeContext), floorId: from.floor, toRoomId: to?.id ?? null,
          });
        }
        if (to) {
          layoutBridge._emit('enterRoom', {
            roomId: to.id, room: layoutBridge._roomView(to.id, bridgeContext), floorId: to.floor, fromRoomId: from?.id ?? null,
          });
        }
      },
      onBuildToolChange: (isBuildTool) => {
        siteEnv.setBuildGrid(isBuildTool);
        playBuildToolRef.current = isBuildTool;
        updateFloorOutlineRef.current();
      },
      // N on the top floor: ask "Copy rooms from below" or "Empty floor" (mouse released for the card)
      onAskNewFloor: () => {
        document.exitPointerLock?.();
        setNewFloorAsk(true);
      },
      // Multi-storey: the floor you are on follows your character, and what is
      // shown depends on whether you are inside a room or outside the building
      onLevelChange: (floorId) => {
        const st = useWorkspaceStore.getState();
        if (st.currentFloor !== floorId) st.selectFloor(floorId);
        updateFloorOutlineRef.current();
      },
      onViewChange: ({ inside, level }) => {
        floorSystem.setView({ mode: inside ? 'inside' : 'outside', level });
      },
      shadowGenerator: lights.shadowGenerator,
    });
    playRef.current = play;

    // Connect the bridge so other modules can read the layout and react to events
    function showCard({ title, body, text, duration = 6000 }) {
      clearTimeout(cardTimerRef.current);
      setInteraction({ title, text: body ?? text ?? '' });
      // Development only: lets tests check cards without racing their timer
      if (import.meta.env.DEV) (window.__ahdusCards ??= []).push({ title, text: body ?? text ?? '' });
      cardTimerRef.current = setTimeout(() => setInteraction(null), duration);
    }
    const bridgeContext = {
      mode: 'edit', // Studio edits the app's store (no `store`: the default)
      editor,
      scene,
      play,
      showCard,
      onPositionsChange: () => setPositionsVersion((v) => v + 1),
    };
    layoutBridge._attach(bridgeContext);
    let uninstallDemo = null;
    let disposed = false;
    if (DEMO_MODULES) {
      import('../integration/demoModules').then((m) => {
        if (!disposed) uninstallDemo = m.installDemoModules(layoutBridge);
      });
    }

    // Development only: lets the browser test drive Play mode precisely
    if (import.meta.env.DEV) {
      window.ahdus = layoutBridge; // try it in the browser console: ahdus.getAnchors()
      window.__ahdusPlay = play;
      window.__ahdusScene = scene;
      window.__ahdusStore = useWorkspaceStore;
      // the realistic look: whenLoaded() waits for the models / textures being loaded
      window.__ahdusAssets = { whenLoaded: () => whenLoaded(scene), setRealistic: (on) => setRealistic(scene, on) };
    }

    // ── Phase 3: Create managers ──
    const placementMgr = createPlacementManager(scene, { snapEnabled: true, snapStep: 0.5 });
    placementManagerRef.current = placementMgr;
    // Place only on the storey being edited (not on the ground under an upper floor)
    placementMgr.setPickFilter((mesh) => {
      const st = useWorkspaceStore.getState();
      if (mesh.name === 'ground') return elevationOf(st.floors, st.currentFloor) === 0;
      const fid = mesh.metadata?.floorId;
      return fid === undefined || fid === st.currentFloor;
    });
    placementMgr.setElevationSource(() => {
      const st = useWorkspaceStore.getState();
      return elevationOf(st.floors, st.currentFloor);
    });

    const plannerTools = createPlannerTools(scene, canvas, {
      getCamera: () => cameraRef.current,
      getState: () => useWorkspaceStore.getState(),
      actions: {
        addRoom: (d) => editor.addRoom(d),
        updateRoom: (id, patch, opts) => editor.updateRoom(id, patch, opts),
        setWallHeight: (id, h, opts) => editor.setWallHeight(id, h, opts),
        addObject: (d) => {
          editor.addObject(d);
          // Keep drawing: a selected wall would put its gizmo in the way of the next one
          useWorkspaceStore.getState().selectObject(null);
        },
        addOpenings: (list) => editor.addOpenings(list),
        removeOpenings: (list) => editor.removeOpenings(list),
        resizeOpening: (list, opts) => editor.resizeOpening(list, opts),
      },
      getSnapStep: () => (snapRef.current.enabled ? snapRef.current.step : 0),
      onHint: setPlannerHint,
      onMessage: (text, bad) => showStudioMessage(text, bad),
    });
    plannerToolsRef.current = plannerTools;
    const floorOutline = createFloorOutline(scene);
    floorOutlineRef.current = floorOutline;

    const gizmoCtrl = createGizmoController(scene, (objectId, transform) => {
      // Gizmo reports once per drag (on drag end) → one undo step per drag.
      // The mesh is at a world height; the object stores height above its floor.
      const st = useWorkspaceStore.getState();
      const elev = elevationOf(st.floors, st.objects[objectId]?.floor ?? 0);
      editor.updateObject(objectId, { ...transform, y: transform.y - elev }, { label: 'Move / rotate / scale' });
    });
    gizmoControllerRef.current = gizmoCtrl;
    gizmoCtrl.setMode('position'); // default to position gizmo

    // ── Pointer handlers ──

    const pointOnCurrentFloor = () => {
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
      const floorY = elevationOf(
        useWorkspaceStore.getState().floors,
        useWorkspaceStore.getState().currentFloor,
      );
      if (Math.abs(ray.direction.y) < 1e-8) return null;
      const distance = (floorY - ray.origin.y) / ray.direction.y;
      if (!Number.isFinite(distance) || distance < 0) return null;
      const point = {
        x: ray.origin.x + ray.direction.x * distance,
        z: ray.origin.z + ray.direction.z * distance,
      };
      return [point.x, point.z].every(Number.isFinite) ? point : null;
    };

    // Pointer move: update placement ghost position, or the planner tool's preview
    scene.onPointerMove = () => {
      if (isPlayingRef.current) return;
      if (measureModeRef.current) {
        const point = pointOnCurrentFloor();
        const start = measureStartRef.current;
        const length = start && point ? distanceBetweenPoints(start, point) : null;
        setMeasurePreview(start && point && length !== null ? { a: start, b: point, length } : null);
        return;
      }
      if (placementMgr.isActive()) {
        placementMgr.updatePointer(scene.pointerX, scene.pointerY);
      } else {
        plannerTools.pointerMove();
      }
    };

    // Pointer down: placement click or selection
    scene.onPointerDown = (_evt, pickResult) => {
      if (isPlayingRef.current) return; // Play mode handles its own clicks
      const store = useWorkspaceStore.getState();

      if (measureModeRef.current) {
        if (_evt.button !== 0) return;
        const point = pointOnCurrentFloor();
        if (!point) return;
        const start = measureStartRef.current;
        if (!start) {
          measureStartRef.current = point;
          setMeasureStart(point);
        } else {
          const length = distanceBetweenPoints(start, point);
          if (length !== null) {
            setMeasurements((current) => [...current, {
              id: ++measurementIdRef.current,
              a: start,
              b: point,
              length,
              floor: store.currentFloor,
            }]);
          }
          measureStartRef.current = null;
          setMeasureStart(null);
        }
        setMeasurePreview(null);
        return;
      }

      // If in placement mode, try to confirm placement
      if (placementMgr.isActive()) {
        const result = placementMgr.confirmPlacement();
        if (result) {
          placeObject(result);
          store.setPlacementMode(null);
        }
        return; // don't fall through to selection
      }

      // Planner build tools (draw room / wall, door, window, drag a wall)
      if (plannerTools.pointerDown(_evt)) return;
      if (plannerTools.getTool().kind !== 'select') return; // build tools don't select

      // Otherwise: selection
      if (pickResult.hit && pickResult.pickedMesh) {
        let meta = pickResult.pickedMesh.metadata;
        // Clicking the floor under a desk (between its legs) selects the desk, as in Build mode
        if (pickResult.pickedMesh.name === 'ground' || meta?.part === 'floor') {
          const underId = itemOverFloorPoint(scene, pickResult.pickedPoint, (mesh) =>
            (mesh.metadata?.floorId ?? mesh.parent?.metadata?.floorId) === store.currentFloor);
          if (underId) meta = { objectId: underId };
        }

        // A wall shared by two rooms: the room on the side you clicked it from
        if (meta?.part === 'wall') {
          meta = { ...meta, ...wallTargetOf(pickResult, store.is3D ? camera.position : null) };
        }

        // 2D view: from above you see the wall over a door, not the door. Clicking it selects the door.
        if (meta?.part === 'wall' && !store.is3D) {
          const wallRoom = store.rooms[meta.roomId];
          const o = wallRoom && openingAt(wallRoom, meta.wallName, pickResult.pickedPoint);
          if (o) meta = { ...meta, part: o.kind, openingKind: o.kind, openingIndex: o.index };
        }

        if (meta?.part === 'door' || meta?.part === 'window') {
          // Clicked a door or window (its frame, or the doorway itself)
          store.selectOpening({ roomId: meta.roomId, kind: meta.openingKind, index: meta.openingIndex });
        } else if (meta?.objectId) {
          // Clicked an object
          store.selectObject(meta.objectId);
          store.selectRoom(null);
        } else if (meta?.roomId) {
          // Clicked a room
          store.selectRoom(meta.roomId);
          store.selectObject(null);
        } else {
          // Clicked ground — deselect all
          store.selectRoom(null);
          store.selectObject(null);
        }
      }
    };

    // FPS counter (updates DOM directly to avoid React re-renders)
    const fpsInterval = setInterval(() => {
      fpsRef.current = Math.round(engine.getFps());
      if (fpsDisplayRef.current) {
        fpsDisplayRef.current.textContent = `${fpsRef.current} FPS`;
      }
    }, 500);

    setSceneReady(scene);

    return () => {
      disposed = true;
      setSceneReady(null);
      uninstallDemo?.();
      layoutBridge._detach(bridgeContext);
      clearTimeout(cardTimerRef.current);
      clearInterval(fpsInterval);
      perfMonitor.dispose();
      play.dispose();
      placementMgr.dispose();
      plannerTools.dispose();
      floorOutline.dispose();
      floorOutlineRef.current = null;
      clearTimeout(plannerMessageTimer.current);
      gizmoCtrl.dispose();
      builder.dispose();
      builderRef.current = null;
      layoutScene.dispose();
      // The scene took every room/item mesh with it. Forget them, or the next
      // scene (React StrictMode mounts twice; Vite hot reload) would reuse
      // disposed meshes: their metadata is null and the sync below crashed
      // ("Cannot read properties of null (reading '_geometryKey')").
      roomSystemRef.current = null;
      objectSystemRef.current = null;
      floorSystemRef.current = null;
    };
  }, []);

  // ─── Room and item meshes for EVERY floor (each at its own height) ───
  // The first run builds the opened layout in slices; after that a change is
  // built at once (or in slices again if it brings many new rooms / items,
  // e.g. a restored version). The builder reads the store itself.
  const startedBuilder = useRef(null); // a new scene (StrictMode's second mount) has a new builder
  useEffect(() => {
    const builder = builderRef.current;
    if (!builder) return;
    if (startedBuilder.current !== builder) {
      startedBuilder.current = builder;
      builder.start();
    } else {
      builder.request();
    }
    // Dev only (e2e/perf-smoke.mjs): how many rooms the last sync that built any rebuilt, and how long it took
    if (import.meta.env.DEV && builder.lastRoomSync) window.__ahdusRoomSync = builder.lastRoomSync;
  }, [roomsMap, objectsMap, floorsMap, selectedRoomId, currentFloor, sceneReady]);

  // ─── Planner: show the floor being edited, and point the camera at its height ───
  useEffect(() => {
    if (isPlaying) return;
    floorSystemRef.current?.setFloor(currentFloor);
    const camera = cameraRef.current;
    if (camera) {
      const elev = elevationOf(useWorkspaceStore.getState().floors, currentFloor);
      camera.target.y = elev;
    }
  }, [currentFloor, isPlaying, floorsMap, applyLevelVisibility]);

  // ─── Attach gizmo to selected object ───
  useEffect(() => {
    const gizmoCtrl = gizmoControllerRef.current;
    if (!gizmoCtrl) return;

    // The move/rotate/scale gizmo is a planner tool; never show it in Play mode
    if (selectedObjectId && !isPlaying) {
      const mesh = objectSystemRef.current?.getObjectMesh(selectedObjectId);
      const objData = objects.find((o) => o.id === selectedObjectId);

      if (mesh && objData && !objData.isLocked) {
        gizmoCtrl.attachToMesh(mesh, selectedObjectId);
      } else {
        gizmoCtrl.detach();
      }
    } else {
      gizmoCtrl.detach();
    }
  }, [selectedObjectId, objects, gizmoMode, isPlaying, buildProgress?.allBuilt]); // a mesh built later gets its gizmo

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
    sceneRef.current?.getEngine().getRenderingCanvas()?.requestPointerLock?.();
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

  const handleUpdateRoom = useCallback((id, patch) => {
    // Typing a name / size merges into one undo step; changing the type is its own step
    const mergeKey = 'type' in patch ? undefined : 'room-fields';
    if ('wallHeight' in patch) {
      // Taller than the floor allows raises the floor (and the floors above)
      const room = useWorkspaceStore.getState().rooms[id];
      const plan = editor.setWallHeight(id, patch.wallHeight, { mergeKey: 'room-wall-height' });
      if (plan.problem) showStudioMessage(plan.problem, true);
      else if (plan.raised) {
        showStudioMessage(`${useWorkspaceStore.getState().floors[plan.floorId]?.name} is now ${plan.height.toFixed(1)} m high, to fit ${room?.name}`);
      }
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

  const handleChangeRoomType = useCallback((id, type) => {
    editor.updateRoom(id, { type, color: ROOM_TYPES[type]?.color }, { label: 'Change room type' });
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
    setOpenTray(null);
  }, [handleStartPlacement, handleSetPlannerTool]);

  const handlePickFurniture = useCallback((assetType) => {
    handleStartPlacement(assetType);
    setOpenTray(null);
  }, [handleStartPlacement]);

  // Dragging a furniture card onto the canvas arms placement; the drop (or the
  // next click) puts it down
  const handleDragFurniture = useCallback((assetType, e) => {
    e.dataTransfer.setData('assetType', assetType);
    e.dataTransfer.effectAllowed = 'copy';
    storeActions.setPlacementMode(assetType);
  }, [storeActions]);

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

  // Phase 6: canvas drag-over + drop for drag-from-sidebar placement
  const handleCanvasDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback((e) => {
    e.preventDefault();
    const assetType = e.dataTransfer.getData('assetType');
    if (!assetType) return;
    const mgr = placementManagerRef.current;
    if (!mgr) return;
    // Arm placement; the pointer-move handler positions the ghost and the
    // next click confirms it (same path as clicking an asset card).
    plannerToolsRef.current?.setTool({ kind: 'select' });
    setPlannerTool({ kind: 'select' });
    mgr.startPlacement(assetType);
    storeActions.setPlacementMode(assetType);
    storeActions.selectObject(null);
    setOpenTray(null);
  }, [storeActions]);

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const store = useWorkspaceStore.getState();

      // In Play mode only undo/redo is handled here (the play controller does the rest)
      if (isPlayingRef.current) {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
          e.preventDefault();
          if (k === 'y' || e.shiftKey) editor.redo();
          else editor.undo();
        }
        return;
      }

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          handleEnterPlay();
          break;

        case 'Escape': {
          // Cancel placement or a drag, then leave the build tool, then deselect
          const tools = plannerToolsRef.current;
          if (measureModeRef.current) {
            measureModeRef.current = false;
            measureStartRef.current = null;
            setMeasureMode(false);
            setMeasureStart(null);
            setMeasurePreview(null);
          } else if (placementManagerRef.current?.isActive()) {
            handleCancelPlacement();
          } else if (tools?.isDragging()) {
            tools.cancel();
          } else if (tools && tools.getTool().kind !== 'select') {
            handleSetPlannerTool({ kind: 'select' });
          } else {
            store.selectObject(null);
            store.selectRoom(null);
            setLayersOpen(false);
          }
          break;
        }

        case '1': case '2': case '3': case '4': case '5': case '6': {
          // Build panel tiles: 1 = Select, 2–6 open a tile's options
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          const tile = STUDIO_TOOLS[Number(e.key) - 1];
          if (tile.id === 'select') {
            setOpenTray(null);
            handleSetPlannerTool({ kind: 'select' });
          } else {
            setOpenTray((cur) => (cur === tile.id ? null : tile.id));
          }
          break;
        }

        case 'Delete':
        case 'Backspace':
          // Delete selected object
          if (store.selectedOpening) {
            handleDeleteOpening();
          } else if (store.selectedObjectId) {
            const obj = store.objects[store.selectedObjectId];
            if (obj && !obj.isLocked) {
              editor.deleteObject(store.selectedObjectId);
            }
          } else if (store.selectedRoomId) {
            editor.deleteRoom(store.selectedRoomId);
          }
          break;

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Accessibility (Task S3): Arrow keys move the selected object on the grid
          if (!store.selectedObjectId) break;
          const obj = store.objects[store.selectedObjectId];
          if (!obj) break;
          e.preventDefault();
          e.stopPropagation();

          if (obj.isLocked) {
            showStudioMessage('Item is locked and cannot be moved', true);
            setAnnounceText('Item is locked and cannot be moved');
            break;
          }

          const baseStep = snapRef.current?.enabled && snapRef.current?.step > 0 ? snapRef.current.step : 0.25;
          const step = e.shiftKey ? 1.0 : e.altKey ? 0.05 : baseStep;

          let dx = 0;
          let dz = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;
          if (e.key === 'ArrowUp') dz = -step;
          if (e.key === 'ArrowDown') dz = step;

          const newX = Math.round(((Number(obj.x) || 0) + dx) * 1000) / 1000;
          const newZ = Math.round(((Number(obj.z) || 0) + dz) * 1000) / 1000;

          editor.updateObject(
            store.selectedObjectId,
            { x: newX, z: newZ },
            { label: 'Move item (keyboard)' }
          );
          setAnnounceText(`Moved ${obj.label || obj.assetType} to X ${newX}, Z ${newZ}`);
          break;
        }

        case 'w':
        case 'W':
          handleSetGizmoMode('position');
          break;

        case 'e':
        case 'E':
          handleSetGizmoMode('rotation');
          break;

        case 'r':
        case 'R':
          // During placement: rotate preview 45°. Otherwise: scale gizmo.
          if (placementManagerRef.current?.isActive()) {
            placementManagerRef.current.rotatePreview();
          } else {
            handleSetGizmoMode('scale');
          }
          break;

        case 'l':
        case 'L':
          // Toggle lock on selected object
          if (store.selectedObjectId) {
            editor.toggleLock(store.selectedObjectId);
          }
          break;

        case 'z':
        case 'Z':
          // Ctrl+Z = Undo, Ctrl+Shift+Z = Redo
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) editor.redo();
            else editor.undo();
          }
          break;

        case 'y':
        case 'Y':
          // Ctrl+Y = Redo
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            editor.redo();
          }
          break;

        case 'd':
        case 'D':
          // Ctrl+D = Duplicate selected object
          if ((e.ctrlKey || e.metaKey) && store.selectedObjectId) {
            e.preventDefault();
            editor.duplicateObject(store.selectedObjectId);
          }
          break;

        default:
          break;
      }
    };

    // Scroll wheel: adjust height of ghost during placement
    const handleWheel = (e) => {
      if (isPlayingRef.current) return;
      const mgr = placementManagerRef.current;
      if (mgr?.isActive()) {
        e.preventDefault();
        mgr.adjustHeight(e.deltaY > 0 ? -1 : 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [editor, handleCancelPlacement, handleSetGizmoMode, handleEnterPlay, handleSetPlannerTool, handleDeleteOpening, showStudioMessage]);

  // ─── What the Studio shows ───
  const selectedObject = selectedObjectId ? objectsMap[selectedObjectId] ?? null : null;
  const selectedRoom = !selectedObject && selectedRoomId ? roomsMap[selectedRoomId] ?? null : null;

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

  // Footer hint: a short message after a change, else what the tool says
  // (problems in red, sizes while dragging), else the tool's own hint
  const footerHint = (() => {
    if (plannerMessage) return { text: plannerMessage.text, tone: plannerMessage.bad ? 'bad' : 'message' };
    if (!placementMode && plannerHint) {
      const line = [plannerHint.title, plannerHint.detail].filter(Boolean).join(' · ');
      if (plannerHint.bad) return { text: line, tone: 'bad' };
      if (plannerToolsRef.current?.isDragging() || plannerTool.kind === 'select') return { text: line, tone: 'hint' };
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

  const handleAllLayouts = useCallback(async () => {
    const result = await saveNow();
    if (!result.ok && !window.confirm(`Your last changes could not be saved: ${result.error}.\nLeave anyway?`)) return;
    useWorkspaceStore.getState().resetWorkspace();
    onExit();
  }, [onExit]);

  // Another tab saved this layout: load theirs (our undo steps describe the old
  // layout, so they go), or keep ours as a new layout.
  const handleReloadTheirs = useCallback(async () => {
    gizmoControllerRef.current?.detach();
    if (await reloadLayout()) editor.clear();
    else showStudioMessage('This layout was deleted in another tab', true);
  }, [editor, showStudioMessage]);
  // Backup until there is a server: this layout as a file, or a file added to the layouts
  const handleExportLayout = useCallback(async () => {
    const { companyId, layoutId } = useWorkspaceStore.getState();
    try {
      const { fileName, text } = await exportLayout(companyId, layoutId);
      downloadText(fileName, text);
      showStudioMessage(`Downloaded ${fileName}`);
    } catch (err) {
      showStudioMessage(err.message, true);
    }
  }, [showStudioMessage]);
  const handleImportLayout = useCallback(async (file) => {
    try {
      const { name } = await importLayout(useWorkspaceStore.getState().companyId, await file.text());
      showStudioMessage(`Added "${name}" to your layouts`);
    } catch (err) {
      showStudioMessage(err.message, true);
    }
  }, [showStudioMessage]);
  const handleSaveCopy = useCallback(async () => {
    const result = await saveAsCopy();
    if (result.ok) showStudioMessage(`Saved as "${useWorkspaceStore.getState().layoutName}"`);
  }, [showStudioMessage]);

  // ─── Floor plan export (PNG / PDF) ───
  const handleExportPng = useCallback(async () => {
    const { rooms, objects, floors, currentFloor } = useWorkspaceStore.getState();
    const floorName = floors[currentFloor]?.name ?? `Floor ${currentFloor}`;
    setExportLoading(true);
    const result = await exportFloorPlanAsPng({ rooms, objects, floors, floorId: currentFloor, floorName });
    setExportLoading(false);
    if (!result.ok) showStudioMessage(result.error, true);
    else showStudioMessage(`Exported ${floorName} as PNG`);
  }, [showStudioMessage]);

  const handleExportPdf = useCallback(async () => {
    const { rooms, objects, floors, currentFloor } = useWorkspaceStore.getState();
    const floorName = floors[currentFloor]?.name ?? `Floor ${currentFloor}`;
    setExportLoading(true);
    const result = await exportFloorPlanAsPdf({ rooms, objects, floors, floorId: currentFloor, floorName });
    setExportLoading(false);
    if (!result.ok) showStudioMessage(result.error, true);
    else showStudioMessage(`Exported ${floorName} as PDF`);
  }, [showStudioMessage]);

  const handlePhotoReconstruct = useCallback(async (file) => {
    const { companyId, layoutId, setReconstructing, setProposedLayout } = useWorkspaceStore.getState();
    if (!companyId || !layoutId) {
      showStudioMessage('Please open a company workspace first', true);
      return;
    }
    setReconstructing(true);
    showStudioMessage('Uploading photo to tenant storage…');
    const uploadRes = await uploadReconstructionPhoto(file, { companyId, layoutId });
    if (!uploadRes.ok) {
      setReconstructing(false, uploadRes.error);
      showStudioMessage(`Upload failed: ${uploadRes.error}`, true);
      return;
    }

    showStudioMessage('Analyzing photo with AI reconstruction…');
    const analysisRes = await requestPhotoAnalysis(uploadRes.photoUrl, { companyId, layoutId });
    if (!analysisRes.ok) {
      setReconstructing(false, analysisRes.error);
      showStudioMessage(`AI reconstruction failed: ${analysisRes.error}`, true);
      return;
    }

    const stageRes = await stageProposedLayout({
      companyId,
      layoutId,
      photoUrl: uploadRes.photoUrl,
      proposedLayout: analysisRes.proposedLayout,
      detectionStats: analysisRes.detectionStats,
    });

    setProposedLayout({
      proposalId: stageRes.proposalId || null,
      photoUrl: uploadRes.photoUrl,
      layout: analysisRes.proposedLayout,
      detectionStats: analysisRes.detectionStats,
      stagedAt: new Date().toISOString(),
    });
    showStudioMessage('AI Proposed layout ready for your review');
  }, [showStudioMessage]);

  // ─── Render ───
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announceText}
      </div>
      <StudioShell
        preview={isPlaying}
        inspectorOpen={!!inspectorMode}
        banner={<ProposedLayoutBanner editor={editor} onMessage={showStudioMessage} />}
      header={(
        <StudioHeader
          layoutName={layoutName}
          onRenameLayout={(name) => renameLayout(name)}
          onAllLayouts={onExit ? handleAllLayouts : null}
          saveStatus={saveStatus}
          saveError={hasBackend ? saveError : 'This layout has no place to save to'}
          undoState={undoState}
          onUndo={() => editor.undo()}
          onRedo={() => editor.redo()}
          editor={editor}
          onMessage={showStudioMessage}
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
            onExportLayout: hasBackend ? handleExportLayout : null,
            onImportLayout: handleImportLayout,
            onPhotoReconstruct: handlePhotoReconstruct,
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
          onPickFurniture={handlePickFurniture}
          onDragFurniture={handleDragFurniture}
          placementAsset={placementMode}
          layersOpen={inspectorMode === 'layers'}
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
          onFitView={handleFitView}
          showEmpty={showEmpty}
          onAddFirstRoom={() => setOpenTray('rooms')}
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
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
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
            openElsewhere={openElsewhere}
            storageNearlyFull={storageNearlyFull}
            onReload={handleReloadTheirs}
            onSaveCopy={handleSaveCopy}
            onExport={hasBackend ? handleExportLayout : null}
          />
          <RoomLabels
            scene={sceneReady}
            rooms={rooms}
            elevation={elevationOf(floorsMap, currentFloor)}
            hidden={isPlaying || planView}
            showArea={showRoomAreas}
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
              room={selectedRoom}
              gizmoMode={gizmoMode}
              onGizmoMode={handleSetGizmoMode}
              onDuplicate={() => editor.duplicateObject(selectedObjectId)}
              onToggleLock={() => editor.toggleLock(selectedObjectId)}
              onDelete={() => (selectedObject ? editor.deleteObject(selectedObjectId) : editor.deleteRoom(selectedRoomId))}
              onRename={() => setNameFocusToken((t) => t + 1)}
              onChangeType={(type) => handleChangeRoomType(selectedRoomId, type)}
            />
          )}
          {isPlaying && (
            <PlayHUD
              hud={playHud}
              floorName={floorName}
              onFloorUp={() => playRef.current?.stepFloor(1)}
              onFloorDown={() => playRef.current?.stepFloor(-1)}
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
          nameFocusToken={nameFocusToken}
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
          onPreview={handleEnterPlay}
        />
      )}
    />
    </>
  );
}
