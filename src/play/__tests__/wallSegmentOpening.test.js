import { describe, it, expect } from 'vitest';
import {
  planWallSegmentOpening, wallSegmentData, wallSegmentLine, moveOpening, openingData,
  WALL_ASSET_LENGTH, WALL_ASSET_HEIGHT,
} from '../geometry';

// A 6 m wall along X from (-3, 0) to (3, 0), as the Wall tool saves it
const wallAlongX = (extra = {}) => ({
  id: 'w1', name: 'Wall 1', floor: 0, category: 'Architecture',
  ...wallSegmentData({ x: -3, z: 0 }, { x: 3, z: 0 }, []).data,
  ...extra,
});
const ends = (piece) => {
  const l = wallSegmentLine(piece);
  return [l.x - l.ux * l.length / 2, l.x + l.ux * l.length / 2].map((v) => Math.round(v * 100) / 100).sort((a, b) => a - b);
};

describe('planWallSegmentOpening: a door in a free-standing wall', () => {
  it('cuts the wall where you aim: two side pieces, the part above the door, the door', () => {
    const plan = planWallSegmentOpening(wallAlongX(), { x: 1, z: 0.05 }, 'door');
    expect(plan.problem).toBeNull();
    expect(plan.remove).toBe('w1');
    expect(plan.along).toBeCloseTo(1);
    const walls = plan.add.filter((o) => o.assetType === 'WALL_SEGMENT');
    const door = plan.add.find((o) => o.assetType === 'DOOR_SINGLE');
    expect(walls).toHaveLength(3);
    expect(ends(walls[0])).toEqual([-3, 0.5]);
    expect(ends(walls[1])).toEqual([1.5, 3]);
    // above the door: from 2.2 m to the top of the wall, over the door's width
    expect(ends(walls[2])).toEqual([0.5, 1.5]);
    expect(walls[2].y).toBeCloseTo(2.2);
    expect(walls[2].scaleY * WALL_ASSET_HEIGHT).toBeCloseTo(WALL_ASSET_HEIGHT - 2.2);
    expect(door).toMatchObject({ x: 1, y: 0, floor: 0 });
    expect(door.z).toBeCloseTo(0);
    expect(door.rotationY).toBeCloseTo(0);
    // the pieces keep the wall's floor and category, never its id
    walls.forEach((w) => {
      expect(w).toMatchObject({ floor: 0, category: 'Architecture' });
      expect(w.rotationY).toBeCloseTo(0);
      expect(w.id).toBeUndefined();
    });
    expect(walls[0].label).toBe('Wall 3.5 m');
  });

  it('stays clear of the ends of the wall', () => {
    const plan = planWallSegmentOpening(wallAlongX(), { x: 9, z: 0 }, 'door');
    expect(plan.problem).toBeNull();
    expect(plan.along).toBeCloseTo(3 - 0.5 - 0.15);
  });

  it('works on a turned wall (along Z)', () => {
    const wall = { id: 'w2', floor: 1, ...wallSegmentData({ x: 2, z: -2 }, { x: 2, z: 4 }, []).data };
    const plan = planWallSegmentOpening(wall, { x: 2.1, z: 0 }, 'door');
    expect(plan.problem).toBeNull();
    const door = plan.add.find((o) => o.assetType === 'DOOR_SINGLE');
    expect(door.x).toBeCloseTo(2);
    expect(door.z).toBeCloseTo(0);
    expect(door.rotationY).toBeCloseTo(wall.rotationY);
    expect(door.floor).toBe(1);
    const lengths = plan.add.filter((o) => o.assetType === 'WALL_SEGMENT' && o.y === 0)
      .map((o) => Math.round(o.scaleX * WALL_ASSET_LENGTH * 10) / 10).sort();
    expect(lengths).toEqual([1.5, 3.5]);
  });

  it('a window: pieces at the sides, below and above it', () => {
    const plan = planWallSegmentOpening(wallAlongX(), { x: 0, z: 0 }, 'window');
    expect(plan.problem).toBeNull();
    const walls = plan.add.filter((o) => o.assetType === 'WALL_SEGMENT');
    expect(walls).toHaveLength(4);
    const below = walls.find((w) => w.y === 0 && ends(w)[0] === -0.7);
    expect(below.scaleY * WALL_ASSET_HEIGHT).toBeCloseTo(0.9);
    const above = walls.find((w) => w.y > 2);
    expect(above.y).toBeCloseTo(2.1);
    const win = plan.add.find((o) => o.assetType === 'WINDOW_FRAME');
    expect(win.x).toBeCloseTo(0);
    expect(win.y).toBeCloseTo(0.9);
  });

  it('says why when it can not', () => {
    const short = { id: 'w3', ...wallSegmentData({ x: 0, z: 0 }, { x: 1, z: 0 }, []).data };
    expect(planWallSegmentOpening(short, { x: 0.5, z: 0 }, 'door').problem).toBe('This wall is too short for a door');
    expect(planWallSegmentOpening(wallAlongX({ scaleY: 0.5 }), { x: 0, z: 0 }, 'door').problem).toBe('This wall is too low for a door');
    expect(planWallSegmentOpening(wallAlongX({ isLocked: true }), { x: 0, z: 0 }, 'door').problem).toMatch(/locked/);
    expect(planWallSegmentOpening({ id: 'd', assetType: 'DESK_STANDARD' }, { x: 0, z: 0 }, 'door').problem).toBe('Point at a wall');
  });

  it('keeps a name the user gave the wall', () => {
    const plan = planWallSegmentOpening(wallAlongX({ label: 'Glass side' }), { x: 0, z: 0 }, 'door');
    expect(plan.add.filter((o) => o.assetType === 'WALL_SEGMENT').every((w) => w.label === 'Glass side')).toBe(true);
  });
});

// A 6 × 4 m office with a door in the middle of its north wall (x = 0, z = 2)
const office = (extra = {}) => ({
  id: 'r1', name: 'Office', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3,
  doors: [{ wall: 'north', offset: 0, width: 1.0, height: 2.1 }],
  windows: [{ wall: 'north', offset: 2, width: 1.0, height: 1.2, sill: 0.9 }],
  ...extra,
});

describe('moveOpening: slide a door along its wall', () => {
  it('moves it to the offset asked for', () => {
    const r = moveOpening([office()], office(), 'door', 0, -1.2);
    expect(r.problem).toBeNull();
    expect(r.list).toEqual([{ roomId: 'r1', kind: 'door', index: 0, patch: { offset: -1.2 } }]);
  });

  it('stops at the corner instead of refusing', () => {
    const r = moveOpening([office()], office(), 'door', 0, -10);
    expect(r.problem).toBeNull();
    expect(r.offset).toBeCloseTo(-3 + 0.1 + 0.5);
  });

  it('is refused next to another opening', () => {
    const r = moveOpening([office()], office(), 'door', 0, 1.6);
    expect(r.problem).toMatch(/Too close to the window/);
    expect(r.list).toEqual([]);
  });

  it('moves the same door in the room back to back with it', () => {
    const a = office({ windows: [] });
    const b = { id: 'r2', name: 'Meeting', floor: 0, x: 0, z: 4, width: 6, depth: 4, wallHeight: 3,
      doors: [{ wall: 'south', offset: 0, width: 1.0, height: 2.1 }], windows: [] };
    const r = moveOpening([a, b], a, 'door', 0, 1);
    expect(r.problem).toBeNull();
    expect(r.list).toEqual([
      { roomId: 'r1', kind: 'door', index: 0, patch: { offset: 1 } },
      { roomId: 'r2', kind: 'door', index: 0, patch: { offset: 1 } },
    ]);
    expect(openingData(a, 'door', 0).offset).toBe(0); // pure: the rooms are not changed
  });
});
