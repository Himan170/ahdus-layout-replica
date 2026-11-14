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
/** v0.17.0: what the walker's collisions and camera test, around it (metres, sideways). */
export const NEAR_RADIUS = 8;
/** Looked again after walking this far, after this long, or when the scene's meshes or the layout change. */
export const NEAR_REFRESH_M = 1;
export const NEAR_REFRESH_MS = 500;
const NEAR_BELOW = 4;
const NEAR_ABOVE = 8;

/**
 * v0.17.0: the meshes near the walker. Babylon tests a move against EVERY mesh of the scene (~1,300 in a big
 * office, at each 0.1 m step and up to 3 times a step); only those near can be hit. A frame moves at most ~1.5 m
 * (6 m/s flying, a 0.25 s frame) and the list is made again after 1 m, so 8 m leaves room, also for the
 * third-person camera (≤ 5.4 m behind). Babylon still checks each mesh's own flags (enabled, checkCollisions).
 * @param {{ meshes: AbstractMesh[] }} scene
 * @param {{ exclude?: (m: AbstractMesh) => boolean }} [options]
 */
export function createNearbyMeshes(scene, { exclude } = {}) {
  let list = [];
  let set = new Set();
  let atX = Infinity;
  let atZ = Infinity;
  let atMs = -Infinity;
  let meshCount = -1;
  let key = null;
  return {
    get list() { return list; },
    has: (m) => set.has(m),
    /**
     * @param {{ x: number, y: number, z: number }} at  the walker's feet
     * @param {number} now  ms
     * @param {unknown} [layoutKey]  anything that changes when the layout does (a new key = look again)
     */
    refresh(at, now, layoutKey) {
      const moved = Math.hypot(at.x - atX, at.z - atZ);
      if (moved < NEAR_REFRESH_M && now - atMs < NEAR_REFRESH_MS && scene.meshes.length === meshCount &&
          layoutKey === key) return false;
      atX = at.x; atZ = at.z; atMs = now; meshCount = scene.meshes.length; key = layoutKey;
      const next = [];
      for (const m of scene.meshes) {
        if (exclude?.(m)) continue;
        // a mesh moved since its last frame: its box where it is now (frozen meshes return at once)
        m.computeWorldMatrix?.(true);
        const box = m.getBoundingInfo?.()?.boundingBox;
        if (!box) continue;
        const lo = box.minimumWorld;
        const hi = box.maximumWorld;
        // the distance from the walker to the mesh's box, sideways; and roughly this floor (± a storey)
        const dx = Math.max(lo.x - at.x, 0, at.x - hi.x);
        const dz = Math.max(lo.z - at.z, 0, at.z - hi.z);
        if (dx * dx + dz * dz > NEAR_RADIUS * NEAR_RADIUS) continue;
        if (hi.y < at.y - NEAR_BELOW || lo.y > at.y + NEAR_ABOVE) continue;
        next.push(m);
      }
      list = next;
      set = new Set(next);
      return true;
    },
  };
}

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
