/**
 * useStudioScene.js
 *
 * Workplace Studio's scene lifecycle, moved as one piece out of WorkplaceEditor.jsx:
 * creates the Babylon scene (createLayoutScene), RoomSystem, ObjectSystem, FloorSystem,
 * CharacterSystem (people, only when WorkplaceEditor is given some), SceneBuilder, the performance monitor, the play controller, the bridge context,
 * the placement manager, planner tools, floor outline, gizmo controller, the pointer
 * handlers (installed by studioPointer.js) and the FPS counter, and disposes them all
 * in one cleanup (same order).
 *
 * WorkplaceEditor owns the refs and state; it passes them in under the same names
 * and keeps using the same refs. Runs once per mount (React StrictMode: mount →
 * unmount → mount). Call it where the effect was: effects run in declaration order.
 */

import { useEffect } from 'react';

import { createLayoutScene } from '../engine/systems/SceneSetup';
import { storedRealisticLook, whenLoaded, setRealistic, isRealistic, onLookChange } from '../utils/realLook';
import { RoomSystem } from '../engine/systems/RoomSystem';
import { ObjectSystem } from '../engine/systems/ObjectSystem';
import { FloorSystem } from '../engine/systems/FloorSystem';
import { CharacterSystem } from '../engine/systems/CharacterSystem';
import { SceneBuilder } from '../engine/systems/SceneBuilder';
import { progressPercent } from '../play/buildSchedule';
import { elevationOf } from '../play/building';
import { findRoomAt } from '../play/geometry';
import { createFloorOutline } from '../utils/floorOutline';
import { createPlacementManager } from '../utils/placementManager';
import { createGizmoController } from '../utils/gizmoController';
import { useWorkspaceStore } from '../store/workspaceStore';
import { createPerformanceMonitor } from '../utils/performanceOptimiser';
import { createPlayController } from '../play/playController';
import { nextSlot, EMPTY_HAND } from '../play/hotbarItems';
import { createPlannerTools } from '../planner/plannerTools';
import { layoutBridge } from '../integration/layoutBridge';
import { installStudioPointer } from './studioPointer';
import { studioWalkMaps } from './studioWalkMaps';
import { NavigationSystem } from '../engine/systems/NavigationSystem';
import { RouteLineSystem } from '../engine/systems/RouteLineSystem';
import { createFloorWalls } from '../play/floorWalls';
import { cachedLayoutState } from '../play/stateCache';

export function useStudioScene({
  canvasRef, sceneRef, cameraRef, lightsRef, siteEnvRef, roomSystemRef, objectSystemRef, floorSystemRef, characterSystemRef,
  builderRef, perfMonitorRef, playRef, placementManagerRef, plannerToolsRef, floorOutlineRef,
  gizmoControllerRef, cardTimerRef, exitPlayRef, playBuildToolRef, updateFloorOutlineRef, snapRef,
  isPlayingRef, measureModeRef, measureStartRef, measurementIdRef, fpsRef, fpsDisplayRef, plannerMessageTimer,
  setBuildProgress, setPlayHud, setSelectedSlot, setCatalogOpen, setNewFloorAsk, setInteraction,
  setPositionsVersion, setPlannerHint, setMeasurePreview, setMeasureStart, setMeasurements, setSceneReady,
  editor, showStudioMessage, placeObject, DEMO_MODULES, pauseRenderingRef,
}) {
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
    if (pauseRenderingRef) pauseRenderingRef.current = layoutScene.pauseRendering; // Plan view (v0.15.5)
    cameraRef.current = camera;
    lightsRef.current = lights;
    siteEnvRef.current = siteEnv;
    const roomSystem = new RoomSystem(scene, { shadowGenerator: lights.shadowGenerator });
    roomSystemRef.current = roomSystem;
    const objectSystem = new ObjectSystem(scene, { shadowGenerator: lights.shadowGenerator });
    objectSystemRef.current = objectSystem;
    const floorSystem = new FloorSystem(roomSystem, objectSystem, () => useWorkspaceStore.getState());
    floorSystemRef.current = floorSystem;
    // People at their desks: nothing is drawn until WorkplaceEditor gets `people`; none with the simple look
    const characters = new CharacterSystem(scene, {
      getLayout: () => useWorkspaceStore.getState(),
      getObjectMesh: (id) => objectSystem.getObjectMesh(id),
    });
    characters.setEnabled(isRealistic(scene));
    const offLook = onLookChange(scene, (on) => characters.setEnabled(on));
    characterSystemRef.current = characters;
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

    // ── Walk through: a click on the floor walks there (v0.15.2), with the viewer's own route code ──
    // (the walk maps, the route, the follower and the line of engine/systems/NavigationSystem)
    let routeLine = null;
    let play = null;
    const navigation = new NavigationSystem({
      walkMaps: studioWalkMaps,
      getLayout: () => useWorkspaceStore.getState(),
      getWalker: () => {
        if (!play?.isActive()) return null;
        const p = play.getPosition();
        return { x: p.x, z: p.z, floor: play.getLevel() };
      },
      // Studio has no search: nothing is flown to or outlined by a walk
      focusOn: () => false,
      highlight: () => {},
      clearHighlights: () => {},
      startWalking: () => (play?.isActive() ? play : null),
      routeLine: () => (routeLine ??= new RouteLineSystem(scene)),
      emit: (event) => {
        // no route ("No walking route to …: it has no door"), or stuck on the way ("Can't get past here")
        if (event.state === 'failed') play?.say(event.message ?? 'No way to walk there', 2500);
      },
    });
    /** A click with an empty hand: a machine's action when it is in reach (as E), else walk there. */
    const walkClick = (click) => {
      if (click.target && layoutBridge._prompt(click.target, bridgeContext)?.handled) {
        layoutBridge._interact(click.target, bridgeContext);
        return;
      }
      if (!click.walkTo) return;
      const to = click.walkTo;
      navigation.routeTo({ x: to.x, z: to.z, floor: to.floor }, { walk: 'auto', source: 'click' });
    };

    play = createPlayController(scene, canvas, {
      // v0.15.2: the viewer's easy controls. Drag to look (the mouse stays), everything aimed at the mouse
      look: 'drag',
      walkMaps: navigation.walkMaps,
      onPointClick: walkClick,
      onEmptyHand: () => setSelectedSlot(EMPTY_HAND),
      onDeactivate: () => { navigation.stop(); },
      getState: cachedLayoutState(() => useWorkspaceStore.getState()), // v0.17.0: arrays only when the layout changes
      actions: {
        addObject: (d) => editor.addObject(d),
        updateObject: (id, patch, opts) => editor.updateObject(id, patch, opts),
        moveObjects: (moves, opts) => editor.moveObjects(moves, opts),
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
        replaceObjects: (ids, list, opts) => editor.replaceObjects(ids, list, opts),
      },
      getObjectMesh: (id) => objectSystem.getObjectMesh(id),
      onHud: setPlayHud,
      // the number of the item you hold puts it away again (an empty hand: clicks walk)
      onSlotKey: (i) => setSelectedSlot((cur) => (cur === i ? EMPTY_HAND : i)),
      onSlotScroll: (d) => setSelectedSlot((cur) => nextSlot(cur, d)),
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
      window.__ahdusCharacters = characters; // e2e: setPeople(list), whenSettled(), fullCount
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
    // v0.15.6: wall items hang on the walls of the floor being edited
    const floorWalls = createFloorWalls();
    placementMgr.setWallSource(() => {
      const st = useWorkspaceStore.getState();
      return floorWalls(st, st.currentFloor);
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
        moveObjects: (moves, opts) => editor.moveObjects(moves, opts),
        moveRoom: (id, plan, opts) => editor.moveRoom(id, plan, opts),
        replaceObjects: (ids, list, opts) => {
          editor.replaceObjects(ids, list, opts);
          useWorkspaceStore.getState().selectObject(null);
        },
      },
      getSnapStep: () => (snapRef.current.enabled ? snapRef.current.step : 0),
      getObjectMesh: (id) => objectSystem.getObjectMesh(id),
      isOverGizmo: () => !!gizmoControllerRef.current?.isPointerOver(),
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
      const floor = st.objects[objectId]?.floor ?? 0;
      const elev = elevationOf(st.floors, floor);
      // the chair and the riders followed the arrow as meshes: back first, the move below takes them for real
      plannerToolsRef.current?.endCarryPreview();
      // the room it stands in now (moved into another room: that one)
      const room = findRoomAt(Object.values(st.rooms), transform.x, transform.z, floor);
      const patch = { ...transform, y: transform.y - elev, roomId: room?.id ?? null };
      // a desk takes its chair and what stands on it along (one undo step)
      if (!plannerToolsRef.current?.moveItem(objectId, patch, { label: 'Move / rotate / scale' })) {
        editor.updateObject(objectId, patch, { label: 'Move / rotate / scale' });
      }
    }, (objectId, at) => {
      // v0.15.2: while an arrow is dragged the chair follows live, and the Inspector's X / Z
      plannerToolsRef.current?.carryPreview(objectId, at);
    });
    gizmoControllerRef.current = gizmoCtrl;
    if (import.meta.env.DEV) window.__ahdusGizmo = gizmoCtrl; // e2e: gizmoScene() (the arrows), isPointerOver()
    gizmoCtrl.setMode(null); // v0.15.1: the arrows show only after Move (W); dragging moves an item

    // ── Pointer handlers (hooks/studioPointer.js) ──
    installStudioPointer({
      scene, camera, placementMgr, plannerTools,
      isPlayingRef, measureModeRef, measureStartRef, measurementIdRef,
      setMeasurePreview, setMeasureStart, setMeasurements, placeObject, showStudioMessage,
    });

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
      navigation.stop();
      play.dispose();
      routeLine?.dispose();
      placementMgr.dispose();
      plannerTools.dispose();
      floorOutline.dispose();
      floorOutlineRef.current = null;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a useRef passed in: clear the latest timer (as before the move)
      clearTimeout(plannerMessageTimer.current);
      gizmoCtrl.dispose();
      builder.dispose();
      builderRef.current = null;
      offLook();
      characters.dispose();
      characterSystemRef.current = null;
      if (pauseRenderingRef) pauseRenderingRef.current = null;
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
}
