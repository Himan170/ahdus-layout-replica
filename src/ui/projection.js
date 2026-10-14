/**
 * ui/projection.js
 *
 * World → canvas pixel positions for HTML overlays drawn over the 3D view
 * (room labels, the floating selection toolbar). Call after a render, when
 * the scene's transform matrix is current.
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';

const tmp = new Vector3();

/** @returns {{ x: number, y: number, visible: boolean }} CSS pixels inside the canvas */
export function projectPoint(scene, x, y, z) {
  const engine = scene.getEngine();
  const camera = scene.activeCamera;
  const canvas = engine.getRenderingCanvas();
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  if (!camera || !canvas || !w || !h) return { x: 0, y: 0, visible: false };
  tmp.set(x, y, z);
  const v = Vector3.Project(tmp, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  return {
    x: v.x * (canvas.clientWidth / w),
    y: v.y * (canvas.clientHeight / h),
    visible: v.z >= 0 && v.z <= 1,
  };
}

/**
 * Screen rectangle of a world-space box.
 * @returns {{ left, right, top, bottom, visible }} CSS pixels inside the canvas
 */
export function projectBox(scene, min, max) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, visible = false;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const p = projectPoint(scene, x, y, z);
        if (!p.visible) continue;
        visible = true;
        left = Math.min(left, p.x); right = Math.max(right, p.x);
        top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
      }
    }
  }
  return { left, right, top, bottom, visible };
}
