/**
 * useStudioScene.js
 *
 * Workplace Studio's scene lifecycle, moved as one piece out of WorkplaceEditor.jsx:
 * creates the Babylon scene (createLayoutScene), RoomSystem, ObjectSystem, FloorSystem,
 * SceneBuilder, the performance monitor, the play controller, the bridge context,
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
import { storedRealisticLook, whenLoaded, setRealistic } from '../utils/realLook';
import { RoomSystem } from '../engine/systems/RoomSystem';
import { ObjectSystem } from '../engine/systems/ObjectSystem';
import { FloorSystem } from '../engine/systems/FloorSystem';
import { SceneBuilder } from '../engine/systems/SceneBuilder';
import { progressPercent } from '../play/buildSchedule';
import { elevationOf } from '../play/building';
import { createFloorOutline } from '../utils/floorOutline';
import { createPlacementManager } from '../utils/placementManager';
import { createGizmoController } from '../utils/gizmoController';
import { useWorkspaceStore } from '../store/workspaceStore';
import { createPerformanceMonitor } from '../utils/performanceOptimiser';
import { createPlayController } from '../play/playController';
import { createPlannerTools } from '../planner/plannerTools';
import { layoutBridge } from '../integration/layoutBridge';
import { installStudioPointer } from './studioPointer';

export function useStudioScene({
  canvasRef, sceneRef, cameraRef, lightsRef, siteEnvRef, roomSystemRef, objectSystemRef, floorSystemRef,
  builderRef, perfMonitorRef, playRef, placementManagerRef, plannerToolsRef, floorOutlineRef,
  gizmoControllerRef, cardTimerRef, exitPlayRef, playBuildToolRef, updateFloorOutlineRef, snapRef,
  isPlayingRef, measureModeRef, measureStartRef, measurementIdRef, fpsRef, fpsDisplayRef, plannerMessageTimer,
  setBuildProgress, setPlayHud, setSelectedSlot, setCatalogOpen, setNewFloorAsk, setInteraction,
  setPositionsVersion, setPlannerHint, setMeasurePreview, setMeasureStart, setMeasurements, setSceneReady,
  editor, showStudioMessage, placeObject, DEMO_MODULES,
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

    // ── Pointer handlers (hooks/studioPointer.js) ──
    installStudioPointer({
      scene, camera, placementMgr, plannerTools,
      isPlayingRef, measureModeRef, measureStartRef, measurementIdRef,
      setMeasurePreview, setMeasureStart, setMeasurements, placeObject,
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
      play.dispose();
      placementMgr.dispose();
      plannerTools.dispose();
      floorOutline.dispose();
      floorOutlineRef.current = null;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a useRef passed in: clear the latest timer (as before the move)
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
}
