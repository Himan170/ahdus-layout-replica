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
 * @param {Function} [onMoveLive] — (meshId, { x, y, z }) while a move arrow is dragged (v0.15.2)
 * @returns {{ setMode, attachToMesh, detach, isAttached, isPointerOver, getMode, gizmoScene, dispose }}
 */
export function createGizmoController(scene, onTransformEnd, onMoveLive = null) {
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
  let fixedShape = false;      // a staircase: it moves on its floor and turns about Y only, no scale
  let liveObservers = [];      // [observable, observer] of the move arrows' drags (onMoveLive)

  /**
   * A staircase is drawn as it is walked on (building.stairDrawn): no scale gizmo, no tilting.
   * Nothing is moved up or down with the arrows (v0.15.0: items ended up floating or sunk in the
   * floor): an item stands on the floor or on a table top when it is dragged, and the
   * Inspector's Height field lifts it on purpose (a screen on a wall).
   */
  function applyLimits() {
    gizmoManager.scaleGizmoEnabled = currentMode === 'scale' && !fixedShape;
    const { positionGizmo, rotationGizmo } = gizmoManager.gizmos ?? {};
    if (positionGizmo) positionGizmo.yGizmo.isEnabled = false;
    if (rotationGizmo) {
      rotationGizmo.xGizmo.isEnabled = !fixedShape;
      rotationGizmo.zGizmo.isEnabled = !fixedShape;
    }
  }

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

    // While a move arrow is dragged: tell where the item is now (its chair follows, the Inspector's X / Z)
    const live = () => {
      if (!attachedMesh || !attachedObjectId || !onMoveLive) return;
      const p = attachedMesh.position;
      onMoveLive(attachedObjectId, { x: p.x, y: p.y, z: p.z });
    };
    // (never clear() this observable: the arrow's own observer on it is what moves the item)
    liveObservers.forEach(([observable, observer]) => observable.remove(observer));
    liveObservers = [];
    const move = gizmoManager.gizmos?.positionGizmo;
    for (const axis of [move?.xGizmo, move?.zGizmo]) {
      const observable = axis?.dragBehavior?.onDragObservable;
      if (observable) liveObservers.push([observable, observable.add(live)]);
    }

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
      applyLimits();
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
   * @param {{ fixedShape?: boolean }} [options] — fixedShape: a staircase (see applyLimits)
   */
  function attachToMesh(mesh, objectId, options = {}) {
    attachedMesh = mesh;
    attachedObjectId = objectId;
    fixedShape = !!options.fixedShape;

    if (currentMode) {
      gizmoManager.attachToMesh(mesh);
      applyLimits();
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

  // ── The nearest thing under the mouse wins (v0.15.0) ──
  // The gizmo is drawn on top of everything and Babylon gives it every press on its arrows,
  // even where they lie behind the item: the arrows start at the item's foot, so a small item
  // (a 0.2 m Desk Plant) is covered by them, and dragging it slid it along one arrow at its old
  // height instead of onto the desk. Now, where the item's own surface is nearer than the gizmo,
  // the gizmo ignores the mouse and the Select tool drags the item (onto the floor or a table
  // top); where an arrow or ring sticks out in front of the item, the gizmo still takes it.
  const layer = gizmoManager.utilityLayer;
  const isPartOfItem = (m) => !!attachedMesh && (m === attachedMesh || !!m.isDescendantOf?.(attachedMesh));

  /** The mouse is on the attached item, and the item is nearer than the gizmo there. */
  function itemInFront() {
    if (!attachedMesh || !currentMode || !layer) return false;
    const gizmoHit = layer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
    if (!gizmoHit?.hit) return false;
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m.isPickable && m.isEnabled());
    return !!hit?.hit && isPartOfItem(hit.pickedMesh) && hit.distance < gizmoHit.distance;
  }

  // Runs before the gizmo's own layer sees the event (top priority): a press there is the item's
  const preObserver = scene.onPrePointerObservable.add(() => {
    if (!layer || gizmoManager.isDragging) return; // a gizmo drag runs: leave it alone
    layer.pickingEnabled = !itemInFront();
  });
  scene.onPrePointerObservable.makeObserverTopPriority(preObserver);

  /**
   * Whether the mouse is on one of the gizmo's arrows / rings (or dragging one), in front of
   * the item: the Select tool's own item drag waits for it.
   */
  function isPointerOver() {
    if (!attachedMesh || !currentMode) return false;
    if (gizmoManager.isDragging) return true;
    return !!gizmoManager.isHovered && !itemInFront();
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
    scene.onPrePointerObservable.remove(preObserver);
    if (layer) layer.pickingEnabled = true;
    gizmoManager.dispose();
  }

  return {
    isDragging: () => !!gizmoManager.isDragging, // an arrow is dragged (the selection bar hides)
    setMode,
    attachToMesh,
    detach,
    isAttached,
    isPointerOver,
    getMode,
    /** The scene the arrows / rings are drawn in (tests pick it to find an arrow). */
    gizmoScene: () => layer?.utilityLayerScene ?? null,
    dispose,
  };
}
