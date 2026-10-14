/**
 * gizmoController.js
 *
 * Wraps Babylon.js GizmoManager to provide move/rotate/scale controls
 * for placed objects. Syncs transforms back to the ObjectStore on drag end.
 *
 * Modes:
 *   - 'position': PositionGizmo (translate XYZ)
 *   - 'rotation': RotationGizmo (rotate XYZ)
 *   - 'scale':    ScaleGizmo (scale XYZ)
 *   - null:       No gizmo visible
 *
 * Phase 3 — Object Placement & Editor Controls
 */

import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager';
import '@babylonjs/core/Gizmos/positionGizmo';
import '@babylonjs/core/Gizmos/rotationGizmo';
import '@babylonjs/core/Gizmos/scaleGizmo';
import '@babylonjs/core/Gizmos/boundingBoxGizmo';

/**
 * Creates a gizmo controller bound to a scene.
 *
 * @param {BABYLON.Scene} scene
 * @param {Function} onTransformEnd — (meshId, { x, y, z, rotationX, ... }) called after drag
 * @returns {{ setMode, attachToMesh, detach, isAttached, getMode, dispose }}
 */
export function createGizmoController(scene, onTransformEnd) {
  const gizmoManager = new GizmoManager(scene);

  // Start with all gizmos off
  gizmoManager.positionGizmoEnabled = false;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.scaleGizmoEnabled = false;
  gizmoManager.boundingBoxGizmoEnabled = false;

  // Don't let gizmo manager handle picking — we do that ourselves
  gizmoManager.usePointerToAttachGizmos = false;

  let currentMode = null;      // 'position' | 'rotation' | 'scale' | null
  let attachedMesh = null;
  let attachedObjectId = null;

  // ── Drag-end sync ──

  /**
   * Wire up drag-end observers on the active gizmo so we push
   * the final transform back to the store.
   */
  function syncOnDragEnd() {
    if (!attachedMesh || !attachedObjectId) return;

    const syncTransform = () => {
      if (!attachedMesh || !attachedObjectId) return;
      const pos = attachedMesh.position;
      const rot = attachedMesh.rotation;
      const scl = attachedMesh.scaling;

      onTransformEnd(attachedObjectId, {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        rotationX: rot.x,
        rotationY: rot.y,
        rotationZ: rot.z,
        scaleX: scl.x,
        scaleY: scl.y,
        scaleZ: scl.z,
      });
    };

    // Each gizmo sub-type exposes onDragEndObservable
    const attachDragEnd = (gizmo) => {
      if (!gizmo) return;
      // Position/Scale gizmo has xGizmo/yGizmo/zGizmo children
      if (gizmo.xGizmo) {
        gizmo.xGizmo.dragBehavior?.onDragEndObservable?.clear();
        gizmo.yGizmo.dragBehavior?.onDragEndObservable?.clear();
        gizmo.zGizmo.dragBehavior?.onDragEndObservable?.clear();
        gizmo.xGizmo.dragBehavior?.onDragEndObservable?.add(syncTransform);
        gizmo.yGizmo.dragBehavior?.onDragEndObservable?.add(syncTransform);
        gizmo.zGizmo.dragBehavior?.onDragEndObservable?.add(syncTransform);
      }
    };

    if (gizmoManager.gizmos) {
      attachDragEnd(gizmoManager.gizmos.positionGizmo);
      attachDragEnd(gizmoManager.gizmos.rotationGizmo);
      attachDragEnd(gizmoManager.gizmos.scaleGizmo);
    }
  }

  // ── Public API ──

  /**
   * Set the gizmo mode.
   * @param {'position'|'rotation'|'scale'|null} mode
   */
  function setMode(mode) {
    currentMode = mode;

    gizmoManager.positionGizmoEnabled = mode === 'position';
    gizmoManager.rotationGizmoEnabled = mode === 'rotation';
    gizmoManager.scaleGizmoEnabled = mode === 'scale';

    // Re-attach if we already have a mesh
    if (attachedMesh && mode) {
      gizmoManager.attachToMesh(attachedMesh);
      syncOnDragEnd();
    } else if (!mode) {
      gizmoManager.attachToMesh(null);
    }
  }

  /**
   * Attach gizmo to a specific mesh by its object ID.
   *
   * @param {BABYLON.Mesh} mesh — the root mesh of the object
   * @param {string} objectId — ObjectStore ID for sync
   */
  function attachToMesh(mesh, objectId) {
    attachedMesh = mesh;
    attachedObjectId = objectId;

    if (currentMode) {
      gizmoManager.attachToMesh(mesh);
      syncOnDragEnd();
    }
  }

  /**
   * Detach gizmo from any mesh.
   */
  function detach() {
    gizmoManager.attachToMesh(null);
    attachedMesh = null;
    attachedObjectId = null;
  }

  /**
   * Whether gizmo is currently attached to a mesh.
   */
  function isAttached() {
    return attachedMesh !== null;
  }

  /**
   * Current gizmo mode.
   */
  function getMode() {
    return currentMode;
  }

  /**
   * Dispose gizmo manager and all its gizmos.
   */
  function dispose() {
    detach();
    gizmoManager.dispose();
  }

  return {
    setMode,
    attachToMesh,
    detach,
    isAttached,
    getMode,
    dispose,
  };
}
