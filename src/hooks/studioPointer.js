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
import { itemOverFloorPoint, wallTargetOf } from '../utils/pickHelpers';
import { openingAt } from '../play/geometry';
import { distanceBetweenPoints } from '../utils/measurements';

export function installStudioPointer({
  scene, camera, placementMgr, plannerTools,
  isPlayingRef, measureModeRef, measureStartRef, measurementIdRef,
  setMeasurePreview, setMeasureStart, setMeasurements, placeObject,
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
}
