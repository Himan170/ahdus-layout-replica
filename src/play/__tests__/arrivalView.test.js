import { describe, it, expect } from 'vitest';
import { arrivalCamera, segmentDistance, BODY_CLEAR, HEAD_CLEAR, MIN_DISTANCE, SPOTS_WIDE } from '../arrivalView.js';

const eye = { x: 0, y: 1.62, z: 0 };
const feetY = 0;
// Kavya 1.5 m in front (facing +z), at chest height
const target = { x: 0, y: 1.3, z: 1.5 };
const open = () => null;
/** ≥ 1: the line from pos to the place misses the torso (feet to shoulders) and the head. */
const body = (pos) => Math.min(
  segmentDistance(pos, target, { x: 0, y: 0.1, z: 0 }, { x: 0, y: 1.47, z: 0 }) / BODY_CLEAR,
  segmentDistance(pos, target, { x: 0, y: 1.67, z: 0 }, { x: 0, y: 1.67, z: 0 }) / HEAD_CLEAR,
);

describe('segmentDistance', () => {
  it('crossing, parallel, and end-point cases', () => {
    expect(segmentDistance({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 1 }, { x: 0, y: 1, z: 1 })).toBeCloseTo(1);
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 })).toBeCloseTo(2);
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })).toBeCloseTo(2);
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, { x: 0, y: 5, z: 0 })).toBeCloseTo(3);
  });
});

describe('arrivalCamera (v0.17.1)', () => {
  it('open room: the first spot, over the right shoulder, raised, behind you; the line to the place misses your body', () => {
    const cam = arrivalCamera({ eye, feetY, target, cast: open });
    expect(cam.spot).toBe(0);
    expect(cam.hideCharacter).toBe(false);
    expect(cam.position.x).toBeGreaterThan(0.5); // to your right
    expect(cam.position.z).toBeLessThan(-1); // behind
    expect(cam.position.y).toBeGreaterThan(eye.y); // higher
    expect(body(cam.position)).toBeGreaterThanOrEqual(1);
  });

  it('the usual camera straight behind you would be covered: that is what it avoids', () => {
    const behind = { x: 0, y: 2.07, z: -3.8 };
    expect(body(behind)).toBeLessThan(1);
  });

  it('a wall close on your right: the left shoulder', () => {
    // anything going right of x = 0.4 hits the wall
    const cast = (from, to) => {
      if (to.x <= 0.4) return null;
      const t = (0.4 - from.x) / (to.x - from.x);
      return t >= 0 && t <= 1 ? t * Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) : null;
    };
    const cam = arrivalCamera({ eye, feetY, target, cast });
    expect(cam.position.x).toBeLessThan(0);
    expect(cam.hideCharacter).toBe(false);
    expect(body(cam.position)).toBeGreaterThanOrEqual(1);
  });

  it('the ceiling caps it; something between the camera and the place rules that spot out', () => {
    const low = arrivalCamera({ eye, feetY, target, ceiling: 2.0, cast: open });
    expect(low.position.y).toBeLessThanOrEqual(2.0);
    // a pillar between the first spot and Kavya: every ray from x > 0 towards her is blocked
    const cast = (from, to) => (from.x > 0.3 && to.z > from.z ? 0.5 : null);
    const cam = arrivalCamera({ eye, feetY, target, cast });
    expect(cam.position.x).toBeLessThan(0.3);
    expect(cam.spot).not.toBe(0);
  });

  it('a portrait phone keeps its spots nearer the middle', () => {
    const wide = arrivalCamera({ eye, feetY, target, cast: open });
    const narrow = arrivalCamera({ eye, feetY, target, narrow: true, cast: open });
    expect(Math.abs(narrow.position.x)).toBeLessThan(Math.abs(wide.position.x));
    expect(body(narrow.position)).toBeGreaterThanOrEqual(1);
  });

  it('walls all round (every spot pulled right in): your character is hidden, so it never covers the place', () => {
    const cast = () => 0.2;
    const cam = arrivalCamera({ eye, feetY, target, cast });
    expect(cam.hideCharacter).toBe(true);
  });

  it('every wide spot is at least MIN_DISTANCE from the eye in an open room', () => {
    for (const s of SPOTS_WIDE) expect(Math.hypot(s.side, s.back, s.up)).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });
});
