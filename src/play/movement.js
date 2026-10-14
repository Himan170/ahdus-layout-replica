/**
 * play/movement.js
 *
 * Move the player's collider with collisions, in small steps.
 *
 * Why steps: on a slow computer one frame can be 0.25 s, which at running speed
 * is ~2 m — further than a wall is thick, so one big move could skip a wall.
 *
 * Why computeWorldMatrix(true): Babylon caches a mesh's world position once per
 * frame. moveWithCollisions reads that cache, so without forcing a refresh every
 * step after the first would test collisions from the START of the frame and the
 * player would walk straight through walls.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export const MAX_STEP = 0.1; // metres per collision step (less than a wall's thickness)

/**
 * @param {AbstractMesh} collider  mesh with ellipsoid / ellipsoidOffset set
 * @param {number} dx  horizontal displacement this frame (X)
 * @param {number} dz  horizontal displacement this frame (Z)
 * @param {() => void} [afterStep]  called after every small step, e.g. to step
 *   up onto the next stair. Doing that once per FRAME fails on slow computers:
 *   one frame can cover a metre, and the stairs are then too far above the feet.
 */
export function moveWithSteps(collider, dx, dz, afterStep) {
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return;
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  const step = new Vector3(dx / steps, 0, dz / steps);
  for (let i = 0; i < steps; i++) {
    collider.computeWorldMatrix(true);
    collider.moveWithCollisions(step);
    afterStep?.();
  }
  collider.computeWorldMatrix(true);
}
