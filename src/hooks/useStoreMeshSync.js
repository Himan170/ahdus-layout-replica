/**
 * useStoreMeshSync.js
 *
 * Keeps Workplace Studio's scene in step with the store, moved as one piece out of
 * WorkplaceEditor.jsx (after hooks/useStudioScene.js made the scene):
 * - room and item meshes for every floor: the scene's SceneBuilder starts on a new
 *   scene, else is asked to build what changed (+ the dev-only __ahdusRoomSync);
 * - the planner shows the floor being edited and points the camera at its height;
 * - the move / rotate / scale gizmo follows the selected object.
 *
 * WorkplaceEditor passes its refs and values in under the same names. Call it right
 * after useStudioScene: effects run in declaration order.
 */

import { useRef, useEffect } from 'react';

import { elevationOf } from '../play/building';
import { useWorkspaceStore } from '../store/workspaceStore';

export function useStoreMeshSync({
  builderRef, floorSystemRef, cameraRef, gizmoControllerRef, objectSystemRef, roomsMap, objectsMap, floorsMap,
  selectedRoomId, currentFloor, sceneReady, isPlaying, applyLevelVisibility, selectedObjectId, objects,
  gizmoMode, buildProgress,
}) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- builderRef is a useRef passed in (stable)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- floorSystemRef, cameraRef: useRefs passed in (stable)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- gizmoControllerRef, objectSystemRef: useRefs passed in (stable)
  }, [selectedObjectId, objects, gizmoMode, isPlaying, buildProgress?.allBuilt]); // a mesh built later gets its gizmo
}
