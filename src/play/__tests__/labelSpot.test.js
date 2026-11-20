// v0.18.3 review: the Hall's label sat on the lift shaft in its middle (and hid the shaft's own label). A room with
// rooms inside it puts its label at the free spot nearest its middle; other rooms keep theirs in the middle.
import { describe, expect, it } from 'vitest';
import { LABEL_CLEAR, labelSpot } from '../geometry';

const hall = { id: 'hall', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 16, depth: 12 };
const shaft = { id: 'lift', type: 'LIFT', floor: 0, x: 0, z: 0, width: 2.2, depth: 2.2 };
const boxGap = (spot, size, r) => {
  const ex = Math.abs(spot.x - r.x) - (size.w / 2 + r.width / 2);
  const ez = Math.abs(spot.z - r.z) - (size.d / 2 + r.depth / 2);
  return Math.max(ex, ez);
};

describe('labelSpot (v0.18.3)', () => {
  it('a room with nothing inside: its middle', () => {
    expect(labelSpot(hall, [hall])).toEqual({ x: 0, z: 0, moved: false });
  });

  it('a lift shaft in the middle of the hall: the label moves just clear of it, inside the hall', () => {
    const size = { w: 2, d: 0.7 };
    const spot = labelSpot(hall, [hall, shaft], size);
    expect(spot.moved).toBe(true);
    expect(boxGap(spot, size, shaft)).toBeGreaterThanOrEqual(LABEL_CLEAR - 1e-9);
    expect(Math.abs(spot.x) + size.w / 2).toBeLessThan(8);
    expect(Math.abs(spot.z) + size.d / 2).toBeLessThan(6);
    // the nearest free spot: just above or below the shaft (2.2 / 2 + 0.35 + 0.3 ≈ 1.75 m), not far away
    expect(Math.hypot(spot.x, spot.z)).toBeLessThan(2);
  });

  it('a room inside away from the middle changes nothing', () => {
    const corner = { ...shaft, x: 6, z: 4.5 };
    expect(labelSpot(hall, [hall, corner])).toEqual({ x: 0, z: 0, moved: false });
  });

  it('the shaft itself keeps its middle; rooms on other floors are not inside', () => {
    expect(labelSpot(shaft, [hall, shaft])).toEqual({ x: 0, z: 0, moved: false });
    expect(labelSpot(hall, [hall, { ...shaft, floor: 1 }])).toEqual({ x: 0, z: 0, moved: false });
  });

  it('no free spot anywhere: the spot furthest from the rooms inside', () => {
    const small = { id: 's', floor: 0, x: 0, z: 0, width: 4, depth: 3 };
    const inner = { id: 'i', floor: 0, x: -0.5, z: 0, width: 2.6, depth: 2.4 };
    const spot = labelSpot(small, [small, inner], { w: 2, d: 0.7 });
    expect(spot.moved).toBe(true);
    // the inner room fills the middle: the label overlaps it least at the top or bottom edge of the room
    expect(Math.abs(spot.z)).toBeGreaterThan(0.9);
    expect(Math.abs(spot.z) + 0.35).toBeLessThan(1.5);
  });
});
