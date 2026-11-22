/**
 * studioPointer.js
 *
 * Workplace Studio's pointer handlers, moved as one piece out of hooks/useStudioScene.js:
 * the point on the current floor under the pointer, scene.onPointerMove (measure preview,
 * placement ghost, planner tool preview) and scene.onPointerDown (measure clicks, placing,
 * planner build tools, selection).
 *
 * installStudioPointer is called inside useStudioScene's effect, where the handlers were;
 * the scene's cleanup stays there (disposing the scene drops its handlers).
 */

import { Matrix } from '@babylonjs/core/Maths/math.vector';

import { elevationOf } from '../play/building';
import { useWorkspaceStore } from '../store/workspaceStore';
import { itemOverFloorPoint, wallTargetOf, hitIsGlass } from '../utils/pickHelpers';
import { pickCandidates, nextPick, isSameSpot } from '../play/pickCycle';
import { openingAt } from '../play/geometry';
import { selectionFor } from '../play/prefab';
import { distanceBetweenPoints } from '../utils/measurements';

export function installStudioPointer({
  scene, camera, placementMgr, plannerTools,
  isPlayingRef, measureModeRef, measureStartRef, measurementIdRef,
  setMeasurePreview, setMeasureStart, setMeasurements, placeObject, showStudioMessage = () => {},
  onHoverItem = () => {}, // v0.18.9: (id | null) the item under the mouse, for its hover outline
}) {
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

  // v0.18.9: what a click selects, from everything under the mouse (play/pickCycle.js)
  let lastClick = null;
  const candidatesHere = (store) => {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
    const raw = (scene.multiPickWithRay(ray, (m) => m.isPickable && m.isEnabled() && m.isVisible !== false && !m.metadata?.pickPane
      && !plannerTools.ownsMesh?.(m)) ?? []).filter((h) => h.hit && h.pickedMesh);
    raw.sort((a, b) => a.distance - b.distance);
    const floor = store.currentFloor;
    const eye = store.is3D ? camera.position : null;
    const hits = [];
    for (const h of raw) {
      const m = h.pickedMesh;
      const meta = m.metadata ?? {};
      const objectId = meta.objectId ?? m.parent?.metadata?.objectId ?? null;
      if (objectId) { hits.push({ objectId }); continue; }
      if (m.name === 'ground') {
        const under = itemOverFloorPoint(scene, h.pickedPoint, (mesh) => (mesh.metadata?.floorId ?? mesh.parent?.metadata?.floorId) === floor);
        if (under) hits.push({ objectId: under });
        hits.push({ ground: true });
        break;
      }
      if (!meta.roomId) continue;
      const room = store.rooms[meta.roomId];
      if ((room?.floor ?? 0) !== floor) { hits.push({ ground: true }); break; } // another floor: nothing further
      if (meta.part === 'floor') {
        // the floor between a desk's legs is the desk
        const under = itemOverFloorPoint(scene, h.pickedPoint, (mesh) => (mesh.metadata?.floorId ?? mesh.parent?.metadata?.floorId) === floor);
        if (under) hits.push({ objectId: under });
        hits.push({ roomId: meta.roomId, part: 'floor' });
      } else if (meta.part === 'wall') {
        hits.push({ roomId: wallTargetOf(h, eye).roomId ?? meta.roomId, part: 'wall', glass: hitIsGlass(h) });
      }
    }
    return pickCandidates(hits, store.objects, { floor });
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
      onHoverItem(null);
    } else {
      plannerTools.pointerMove();
      onHoverItem(plannerTools.hoveredItem?.() ?? null);
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

    // v0.18.2: only the main button places, builds or selects. A right / middle press turns or pans the
    // camera; it may still cancel a drag in progress (plannerTools), never confirm an armed item or select.
    if (_evt.button !== 0) {
      plannerTools.pointerDown(_evt);
      return;
    }

    // If in placement mode, try to confirm placement
    if (placementMgr.isActive()) {
      // A tap on a touch screen has no pointer move before it: aim the ghost at the tap first
      placementMgr.updatePointer(scene.pointerX, scene.pointerY);
      const result = placementMgr.confirmPlacement();
      if (result) {
        placeObject(result);
        store.setPlacementMode(null);
      } else if (placementMgr.getProblem?.()) {
        showStudioMessage(placementMgr.getProblem(), true);
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
      } else if (meta?.objectId && store.selectedObjectIds.includes(meta.objectId)) {
        // An item of the selected group (v0.15.5): the group stays (a drag moves it; plannerTools
        // selects just this item when the press turns out to be a click)
      } else {
        // v0.18.9 (play/pickCycle.js): everything under the mouse, furniture → wall → room; a second click on the
        // same spot selects the next one. The second press of a double-click changes nothing (F / fly to it).
        if ((_evt?.detail ?? 1) >= 2) return;
        const now = { x: scene.pointerX, y: scene.pointerY, t: performance.now() };
        const current = store.selectedObjectId ? { kind: 'object', id: store.selectedObjectId }
          : store.selectedRoomId ? { kind: 'room', id: store.selectedRoomId } : null;
        // the next one only while the selection is still what the last click there chose (else: from the top)
        const sameSpot = isSameSpot(lastClick, now) && !!current && lastClick?.pick?.kind === current.kind
          && lastClick.pick.id === current.id;
        const pick = nextPick(candidatesHere(store), current, { sameSpot });
        lastClick = { ...now, pick };
        if (pick?.kind === 'object') {
          // v0.18.0: an item of a saved group (a cluster) selects the group, Alt+click just it
          const obj = store.objects[pick.id];
          const ids = obj ? selectionFor(store.objects, obj, { alone: !!_evt?.altKey }) : [pick.id];
          if (ids.length > 1) store.setObjectSelection(ids);
          else store.selectObject(pick.id);
          store.selectRoom(null);
        } else if (pick?.kind === 'room') {
          store.selectRoom(pick.id);
          store.selectObject(null);
        } else {
          // Clicked the ground: deselect all
          store.selectRoom(null);
          store.selectObject(null);
        }
      }
    }
  };
}
