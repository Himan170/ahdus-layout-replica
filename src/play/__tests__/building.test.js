import { describe, it, expect } from 'vitest';
import {
  STAIR, STOREY_HEIGHT, floorsByElevation, levelForY, floorAbove, floorBelow,
  subtractRects, rectArea, coveredFraction, stairHeightAt, stairOpening, stairTop, supportHeight,
} from '../building';

const floors = {
  0: { id: 0, name: 'Ground Floor', elevation: 0 },
  1: { id: 1, name: 'Floor 1', elevation: 3.5 },
  2: { id: 2, name: 'Floor 2', elevation: 7 },
};

describe('floors', () => {
  it('sorts by elevation and finds neighbours', () => {
    expect(floorsByElevation(floors).map((f) => f.id)).toEqual([0, 1, 2]);
    expect(floorAbove(floors, 0).id).toBe(1);
    expect(floorAbove(floors, 2)).toBeNull();
    expect(floorBelow(floors, 1).id).toBe(0);
    expect(floorBelow(floors, 0)).toBeNull();
  });

  it('a height belongs to the highest floor at or below it (switching 1 m early)', () => {
    expect(levelForY(floors, 0)).toBe(0);
    expect(levelForY(floors, 2.4)).toBe(0);
    expect(levelForY(floors, 2.6)).toBe(1);   // near the top of the stairs
    expect(levelForY(floors, 3.52)).toBe(1);
    expect(levelForY(floors, 30)).toBe(2);
    expect(levelForY({ 0: { id: 0, elevation: 0 } }, 10)).toBe(0);
  });
});

describe('rectangles with openings', () => {
  const rect = { x0: 0, x1: 10, z0: 0, z1: 6 };

  it('a hole in the middle leaves 4 pieces covering everything else', () => {
    const hole = { x0: 4, x1: 6, z0: 2, z1: 4 };
    const pieces = subtractRects(rect, [hole]);
    expect(pieces).toHaveLength(4);
    const total = pieces.reduce((s, p) => s + rectArea(p), 0);
    expect(total).toBeCloseTo(rectArea(rect) - rectArea(hole));
  });

  it('a hole at the edge leaves fewer pieces; a hole outside changes nothing', () => {
    expect(subtractRects(rect, [{ x0: -1, x1: 2, z0: -1, z1: 7 }])).toEqual([{ x0: 2, x1: 10, z0: 0, z1: 6 }]);
    expect(subtractRects(rect, [{ x0: 20, x1: 22, z0: 0, z1: 1 }])).toEqual([rect]);
  });

  it('several holes: no overlap, exact area', () => {
    const holes = [{ x0: 1, x1: 2, z0: 1, z1: 2 }, { x0: 7, x1: 9, z0: 3, z1: 5 }];
    const pieces = subtractRects(rect, holes);
    const total = pieces.reduce((s, p) => s + rectArea(p), 0);
    expect(total).toBeCloseTo(60 - 1 - 4);
  });
});

describe('roofs', () => {
  const office = { x: 0, z: 0, width: 8, depth: 6 };
  it('measures how much of a room the floor above covers', () => {
    expect(coveredFraction(office, [])).toBe(0);
    expect(coveredFraction(office, [{ x: 0, z: 0, width: 8, depth: 6 }])).toBe(1);
    expect(coveredFraction(office, [{ x: -2, z: 0, width: 4, depth: 6 }])).toBeCloseTo(0.5);
    expect(coveredFraction(office, [{ x: 50, z: 0, width: 4, depth: 6 }])).toBe(0);
  });
});

describe('stairs', () => {
  const stair = { x: 0, z: 0, rotationY: 0, floor: 0 };

  it('climbs one storey from the -Z end to the +Z end, resting on the treads', () => {
    expect(STAIR.rise).toBe(STOREY_HEIGHT);
    const step = STAIR.rise / STAIR.steps;
    expect(stairHeightAt(stair, 0, -STAIR.length / 2)).toBeCloseTo(step / 2);  // half a step up on the first tread
    expect(stairHeightAt(stair, 0, 0)).toBeCloseTo(STAIR.rise / 2 + step / 2);
    expect(stairHeightAt(stair, 0, STAIR.length / 2)).toBeCloseTo(STAIR.rise); // top lands on the floor above
    expect(stairHeightAt(stair, 1, 0)).toBeNull();                            // beside the stairs
  });

  it('turned 90°, the climb goes along +X', () => {
    const turned = { ...stair, rotationY: Math.PI / 2 };
    expect(stairHeightAt(turned, STAIR.length / 2 - 0.01, 0)).toBeCloseTo(STAIR.rise, 1);
    expect(stairHeightAt(turned, -STAIR.length / 2 + 0.01, 0)).toBeLessThan(0.3);
    expect(stairTop(turned).x).toBeGreaterThan(STAIR.length / 2);
  });

  it('the opening covers the whole staircase, also when rotated', () => {
    const o = stairOpening(stair);
    expect(o.x1 - o.x0).toBeCloseTo(STAIR.width + 0.1);
    expect(o.z1 - o.z0).toBeCloseTo(STAIR.length + 0.1);
    const r = stairOpening({ ...stair, rotationY: Math.PI / 2 });
    expect(r.x1 - r.x0).toBeCloseTo(STAIR.length + 0.1);
  });
});

describe('where the character stands', () => {
  const ground = { id: 'g', floor: 0, x: 0, z: 0, width: 10, depth: 8 };
  const upper = { id: 'u', floor: 1, x: 0, z: 0, width: 10, depth: 8 };
  const stairs = [{ floor: 0, x: 3, z: 0, rotationY: 0 }];
  const ctx = { floors, rooms: [ground, upper], stairs };

  it('on the ground-floor room floor, not lifted onto the floor above', () => {
    expect(supportHeight({ ...ctx, x: -3, z: 0, y: 0.02 })).toBeCloseTo(0.02);
  });

  it('standing upstairs keeps you on the upper floor', () => {
    expect(supportHeight({ ...ctx, x: -3, z: 0, y: 3.52 })).toBeCloseTo(3.52);
  });

  it('walking up the stairs one step at a time ends on the upper floor', () => {
    let y = 0.02;
    for (let z = -STAIR.length / 2 - 0.3; z <= STAIR.length / 2 + 0.6; z += 0.1) {
      y = supportHeight({ ...ctx, x: 3, z, y });
    }
    expect(y).toBeCloseTo(3.52);
  });

  it('the stairwell opening in the upper floor does not hold you up', () => {
    // above the middle of the stairs, the upper floor has a hole: you stand on the stairs
    const h = supportHeight({ ...ctx, x: 3, z: 0, y: 3.6 });
    expect(h).toBeLessThan(3.0);
  });

  it('outside any room you stand on the ground', () => {
    expect(supportHeight({ ...ctx, x: 30, z: 0, y: 5 })).toBe(0);
  });
});
