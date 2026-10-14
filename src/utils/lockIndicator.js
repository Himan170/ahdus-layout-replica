/**
 * lockIndicator.js
 *
 * Amber tint on locked objects.
 *
 * Uses a per-mesh OVERLAY instead of changing the material: furniture
 * materials are shared between all objects of the same kind, so tinting the
 * material would tint every desk in the building, not just the locked one.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

const LOCK_TINT = new Color3(0.96, 0.62, 0.04); // amber

function meshesOf(root) {
  return [root, ...root.getChildMeshes(false)].filter((m) => m.getTotalVertices?.() > 0);
}

export function applyLockVisual(rootMesh) {
  if (!rootMesh) return;
  for (const mesh of meshesOf(rootMesh)) {
    mesh.renderOverlay = true;
    mesh.overlayColor = LOCK_TINT;
    mesh.overlayAlpha = 0.22;
  }
}

export function removeLockVisual(rootMesh) {
  if (!rootMesh) return;
  for (const mesh of meshesOf(rootMesh)) {
    mesh.renderOverlay = false;
  }
}

export function isObjectLocked(objectData) {
  return objectData?.isLocked === true;
}
