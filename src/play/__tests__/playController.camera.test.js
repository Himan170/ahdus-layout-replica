// The third-person camera's shoulder offset (v0.13.1): centred on a portrait phone, over the shoulder when wide.
import { describe, expect, it } from 'vitest';
import { shoulderOffset, thirdPersonCamera } from '../playController';

const FOV = 1.0; // playController's camera (vertical)
const CAM_DISTANCE = 3.8;
/** Half the width the camera sees at the character's distance (m). */
const halfWidth = (aspect) => Math.tan(FOV / 2) * aspect * CAM_DISTANCE;

describe('shoulderOffset', () => {
  it('a portrait phone (390 × 844) puts the character in the middle', () => {
    expect(shoulderOffset(390 / 844)).toBe(0);
    expect(shoulderOffset(0.75)).toBe(0);
  });

  it('desktop and landscape views keep the over-the-shoulder view (0.85 m)', () => {
    expect(shoulderOffset(1440 / 900)).toBeCloseTo(0.85);
    expect(shoulderOffset(16 / 9)).toBeCloseTo(0.85);
    expect(shoulderOffset(844 / 390)).toBeCloseTo(0.85);
  });

  it('in between it eases, and the character (0.3 m each side) always stays on screen', () => {
    let last = -1;
    for (let aspect = 0.4; aspect <= 2.5; aspect += 0.05) {
      const off = shoulderOffset(aspect);
      expect(off).toBeGreaterThanOrEqual(last);
      expect(off + 0.3).toBeLessThan(halfWidth(aspect));
      last = off;
    }
  });

  it('a view with no size yet (0, NaN) gets the default', () => {
    expect(shoulderOffset(0)).toBeCloseTo(0.85);
    expect(shoulderOffset(NaN)).toBeCloseTo(0.85);
  });
});

// v0.15.1: the third-person camera near walls (thirdPersonCamera, pure)
describe('thirdPersonCamera', () => {
  /** Walls as boxes { x0, x1, z0, z1, top }: the first hit along from → to (m), or null. */
  const caster = (walls) => (from, to) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z);
    let best = null;
    for (let i = 1; i <= 400; i++) {
      const t = i / 400;
      const p = { x: from.x + d.x * t, y: from.y + d.y * t, z: from.z + d.z * t };
      if (walls.some((w) => p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1 && p.y >= 0 && p.y <= w.top)) {
        best = t * len;
        break;
      }
    }
    return best;
  };
  const eye = { x: 0, y: 1.6, z: 0 };
  const right = { x: 1, y: 0, z: 0 }; // facing +Z
  const looking = (pitch) => ({ x: 0, y: Math.sin(pitch), z: Math.cos(pitch) });
  const base = { eye, right, distance: CAM_DISTANCE, up: 0.45 };

  it('(a) looking down beside a wall: the ceiling height comes first, so the ray finds the wall', () => {
    // A wall 1 m behind you, 2.88 m high; the ceiling is 2.76 m. Looking down, the wanted spot is high
    // above the wall's top: a ray to it passes over the wall, and lowering it afterwards put it behind.
    const wall = { x0: -10, x1: 10, z0: -1.1, z1: -1, top: 2.88 };
    const cam = thirdPersonCamera({ ...base, dir: looking(-0.9), shoulder: 0, ceiling: 2.76, cast: caster([wall]) });
    expect(cam.position.y).toBeLessThanOrEqual(2.76 + 1e-9);
    expect(cam.position.z).toBeGreaterThan(-1); // on your side of the wall
  });

  it('(a) with no wall the camera keeps its distance under the ceiling', () => {
    const cam = thirdPersonCamera({ ...base, dir: looking(-0.9), shoulder: 0, ceiling: 2.76, cast: caster([]) });
    expect(cam.position.y).toBeCloseTo(2.76);
    expect(cam.hideCharacter).toBe(false);
  });

  it('(b) the shoulder spot in a wall: the camera slides to the middle behind you, not in', () => {
    const wall = { x0: 0.5, x1: 0.6, z0: -10, z1: 10, top: 3 };
    const cam = thirdPersonCamera({ ...base, dir: looking(-0.1), shoulder: 0.85, ceiling: null, cast: caster([wall]) });
    expect(cam.position.x).toBeCloseTo(0);
    expect(cam.distance).toBeGreaterThan(3.5);
    expect(cam.hideCharacter).toBe(false);
  });

  it('(b) the middle blocked too: pulled in, in front of the wall', () => {
    const wall = { x0: -10, x1: 10, z0: -2.1, z1: -2, top: 3 };
    const cam = thirdPersonCamera({ ...base, dir: looking(-0.1), shoulder: 0.85, ceiling: null, cast: caster([wall]) });
    expect(cam.position.z).toBeGreaterThan(-2);
    expect(cam.position.x).toBeCloseTo(0);
  });

  it('(c) the character hides only when the camera is really inside it (under 0.5 m)', () => {
    const near = { x0: -10, x1: 10, z0: -0.7, z1: -0.6, top: 3 };
    const mid = { x0: -10, x1: 10, z0: -1.3, z1: -1.2, top: 3 };
    const dir = looking(-0.1);
    expect(thirdPersonCamera({ ...base, dir, shoulder: 0, ceiling: null, cast: caster([near]) }).hideCharacter).toBe(true);
    expect(thirdPersonCamera({ ...base, dir, shoulder: 0, ceiling: null, cast: caster([mid]) }).hideCharacter).toBe(false);
  });
});
