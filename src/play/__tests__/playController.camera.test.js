// The third-person camera's shoulder offset (v0.13.1): centred on a portrait phone, over the shoulder when wide.
import { describe, expect, it } from 'vitest';
import { SHOULDER_EASE_S, easeShoulder, shoulderOffset, thirdPersonCamera } from '../playController';

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

  it('(a) a wall behind and a high camera (the tour stop view): pulled in, it keeps its height', () => {
    // 2 m behind you, looking down 0.36 rad, 5.4 m back and 1.25 m up: the ray hits the wall high up.
    // Lowering the spot to the ceiling BEFORE the ray made the pulled-in camera sit only ~0.4 m over the eyes.
    const eye15 = { x: 0, y: 1.5, z: 0 };
    const wall = { x0: -10, x1: 10, z0: -2.1, z1: -2, top: 3 };
    const cam = thirdPersonCamera({ eye: eye15, right, distance: 5.4, up: 1.25, dir: looking(-0.36), shoulder: 0,
      ceiling: 2.76, cast: caster([wall]) });
    expect(cam.position.z).toBeGreaterThan(-2);
    expect(cam.position.y).toBeLessThanOrEqual(2.76 + 1e-9);
    expect(cam.position.y - eye15.y).toBeGreaterThan(0.9);
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

  it('(b) it says where the offset should go: 0 by a wall, the full offset in the open', () => {
    const wall = { x0: 0.5, x1: 0.6, z0: -10, z1: 10, top: 3 };
    const dir = looking(-0.1);
    expect(thirdPersonCamera({ ...base, dir, shoulder: 0.85, ceiling: null, cast: caster([wall]) }).wantShoulder).toBe(0);
    expect(thirdPersonCamera({ ...base, dir, shoulder: 0.85, ceiling: null, cast: caster([]) }).wantShoulder).toBe(0.85);
  });

  it('(b) while it slides the camera stands at the offset it has now (shoulderNow)', () => {
    const wall = { x0: 0.5, x1: 0.6, z0: -10, z1: 10, top: 3 };
    const cam = thirdPersonCamera({ ...base, dir: looking(-0.1), shoulder: 0.85, shoulderNow: 0.3, ceiling: null, cast: caster([wall]) });
    expect(cam.position.x).toBeCloseTo(0.3);
    expect(cam.wantShoulder).toBe(0);
  });
});

// v0.15.1: the slide to behind the head (and back) eases over about 0.25 s instead of jumping
describe('easeShoulder', () => {
  const slide = (from, to, fps) => {
    let s = from; let t = 0; const seen = [s];
    while (s !== to && t < 2) { s = easeShoulder(s, to, 1 / fps, 0.85); t += 1 / fps; seen.push(s); }
    return { t, seen };
  };

  it('to the middle and back each take about 0.25 s, both ways, at 60 and 30 fps', () => {
    for (const fps of [60, 30]) {
      for (const [from, to] of [[0.85, 0], [0, 0.85]]) {
        const { t, seen } = slide(from, to, fps);
        expect(t).toBeGreaterThan(SHOULDER_EASE_S - 2 / fps);
        expect(t).toBeLessThan(SHOULDER_EASE_S + 2 / fps);
        // a steady slide: never further than its target, every step the same way
        for (let i = 1; i < seen.length; i++) {
          expect(Math.abs(seen[i] - to)).toBeLessThanOrEqual(Math.abs(seen[i - 1] - to) + 1e-12);
        }
      }
    }
  });

  it('no jump: one 60 fps frame moves it at most a quarter of the way', () => {
    expect(easeShoulder(0.85, 0, 1 / 60, 0.85)).toBeGreaterThan(0.85 * 0.75);
  });

  it('a slow frame (0.25 s, the controller cap) gets there; none yet = the target at once', () => {
    expect(easeShoulder(0.85, 0, 0.25, 0.85)).toBe(0);
    expect(easeShoulder(null, 0.85, 1 / 60, 0.85)).toBe(0.85);
  });

  it('turning back halfway goes back from where it is (no jump)', () => {
    const half = easeShoulder(0.85, 0, 0.125, 0.85);
    expect(half).toBeCloseTo(0.425);
    expect(easeShoulder(half, 0.85, 1 / 60, 0.85)).toBeGreaterThan(half);
    expect(easeShoulder(half, 0.85, 1 / 60, 0.85) - half).toBeLessThan(0.1);
  });
});
