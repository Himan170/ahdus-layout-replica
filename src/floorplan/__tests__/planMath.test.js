import { describe, it, expect } from 'vitest';
import {
  itemSize, itemContains, planDrop, roomWallPieces, wallSegmentEnds,
  toPlan, toWorld, screenToWorld, planAngle, planViewBox,
} from '../planMath';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { wallSegmentData } from '../../play/geometry';

const len = (s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);

describe('world ↔ plan ↔ screen', () => {
  it('north (+z) is up in the plan, as in the 2D view; toWorld undoes toPlan', () => {
    expect(toPlan({ x: 3, z: 4 })).toEqual({ x: 3, y: -4 });
    expect(toWorld(toPlan({ x: -2.5, z: 7 }))).toEqual({ x: -2.5, z: 7 });
  });

  it('a pointer goes through the inverse screen matrix to world metres', () => {
    // 50 px per metre, plan origin at pixel (100, 200)
    const inv = { a: 1 / 50, b: 0, c: 0, d: 1 / 50, e: -100 / 50, f: -200 / 50 };
    expect(screenToWorld(100, 200, inv)).toEqual({ x: 0, z: -0 });
    const p = screenToWorld(250, 100, inv);
    expect(p.x).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(2); // 2 m up the screen = 2 m north
  });

  it('planAngle: an item turned by r draws turned by r degrees (its local x axis stays on its long side)', () => {
    expect(planAngle(Math.PI / 2)).toBeCloseTo(90);
    expect(planAngle(undefined)).toBe(0);
    // local x axis in world (cos r, −sin r) → plan (cos r, sin r) = SVG rotate(r)
    const r = 0.7;
    const plan = toPlan({ x: Math.cos(r), z: -Math.sin(r) });
    expect(Math.atan2(plan.y, plan.x)).toBeCloseTo(r);
  });

  it('planViewBox holds every room and item with padding, and is null with nothing', () => {
    expect(planViewBox([], [])).toBeNull();
    const box = planViewBox([{ x: 0, z: 0, width: 6, depth: 4 }], [{ ...desk, x: 10, z: 10 }], 1);
    const t = ASSET_TYPES.DESK_STANDARD;
    expect(box.x).toBeCloseTo(-4);
    expect(box.width).toBeCloseTo(10 + t.defaultWidth / 2 + 3 + 2);
    expect(box.y).toBeCloseTo(-(10 + t.defaultDepth / 2) - 1); // the top is the most northern edge
    expect(box.height).toBeCloseTo(10 + t.defaultDepth / 2 + 2 + 2);
  });

  it('a door\'s swing arc turns the right way in the plan', () => {
    const { doors } = roomWallPieces({ x: 0, z: 0, width: 4, depth: 4, doors: [{ wall: 'south', offset: 0, width: 1 }] });
    // south wall, hinge at x −0.5: the leaf swings north (up the plan) from x +0.5: counter-clockwise on screen
    expect(doors[0].open).toEqual({ x: -0.5, z: -1 });
    expect(doors[0].sweep).toBe(0);
  });
});

describe('roomWallPieces: walls, doors and windows from the room data', () => {
  it('a room without openings has four whole walls', () => {
    const { walls, doors, windows } = roomWallPieces({ x: 0, z: 0, width: 6, depth: 4 });
    expect(walls.map(len).sort()).toEqual([4, 4, 6, 6]);
    expect(doors).toEqual([]);
    expect(windows).toEqual([]);
  });

  it('a door and a window cut gaps where roomOpenings puts them', () => {
    const room = {
      x: 10, z: 5, width: 6, depth: 4,
      doors: [{ wall: 'south', offset: 1, width: 1 }],
      windows: [{ wall: 'east', offset: -0.5, width: 1.2 }],
    };
    const { walls, doors, windows } = roomWallPieces(room);
    // south wall (z = 3) from x 7 to 13, door from 10.5 to 11.5
    const south = walls.filter((w) => w.a.z === 3 && w.b.z === 3).map((w) => [w.a.x, w.b.x]);
    expect(south).toEqual([[7, 10.5], [11.5, 13]]);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ a: { x: 10.5, z: 3 }, b: { x: 11.5, z: 3 }, width: 1 });
    expect(doors[0].open).toEqual({ x: 10.5, z: 4 }); // the leaf opens into the room
    // east wall (x = 13), window from z 3.9 to 5.1
    expect(windows).toHaveLength(1);
    expect(windows[0].a.x).toBe(13);
    expect(windows[0].a.z).toBeCloseTo(3.9);
    expect(windows[0].b.z).toBeCloseTo(5.1);
    expect(walls.map(len).reduce((a, b) => a + b, 0)).toBeCloseTo(20 - 1 - 1.2);
  });

  it('an opening sticking past a corner is cut at the corner', () => {
    const { walls } = roomWallPieces({ x: 0, z: 0, width: 4, depth: 4, doors: [{ wall: 'north', offset: 1.8, width: 1 }] });
    const north = walls.filter((w) => w.a.z === 2 && w.b.z === 2);
    expect(north.map(len)).toEqual([3.3]);
  });
});

describe('wallSegmentEnds: a free-standing wall item', () => {
  it('gives back the two points the wall was drawn between (inverse of wallSegmentData)', () => {
    const a = { x: 1, z: 2 };
    const b = { x: 4, z: 6 };
    const { data } = wallSegmentData(a, b, []);
    const ends = wallSegmentEnds(data);
    expect(ends.a.x).toBeCloseTo(a.x);
    expect(ends.a.z).toBeCloseTo(a.z);
    expect(ends.b.x).toBeCloseTo(b.x);
    expect(ends.b.z).toBeCloseTo(b.z);
  });

  it('is null for other items', () => {
    expect(wallSegmentEnds({ assetType: 'DESK_STANDARD', x: 0, z: 0 })).toBeNull();
  });
});

const desk = { id: 'desk', assetType: 'DESK_STANDARD', x: 0, y: 0, z: 0, rotationY: 0 };
const deskTop = ASSET_TYPES.DESK_STANDARD.defaultHeight;
const room = { id: 'r', x: 0, z: 0, width: 6, depth: 4 };

describe('planDrop: moving an item in the plan follows Studio\'s rules', () => {
  it('snaps to the snap step (and not when snapping is off)', () => {
    const chair = { id: 'c', assetType: 'CHAIR_OFFICE', x: 2, y: 0, z: 1 };
    expect(planDrop(chair, { x: 2.26, z: -1.2 }, { rooms: [room], snap: { enabled: true, step: 0.5 } }))
      .toMatchObject({ x: 2.5, z: -1 });
    expect(planDrop(chair, { x: 2.26, z: -1.2 }, { rooms: [room], snap: { enabled: false, step: 0.5 } }))
      .toMatchObject({ x: 2.26, z: -1.2 });
  });

  it('a locked item does not move', () => {
    expect(planDrop({ ...desk, isLocked: true }, { x: 1, z: 1 }, {})).toBeNull();
  });

  it('dropped on a desk it sits on the desk top; else on the floor (placementHeight)', () => {
    const laptop = { id: 'm', assetType: 'LAPTOP', x: 3, y: 0, z: 3 };
    expect(planDrop(laptop, { x: 0.1, z: 0 }, { objects: [desk, laptop], rooms: [room] }).y).toBeCloseTo(deskTop);
    expect(planDrop(laptop, { x: 2.5, z: 1.5 }, { objects: [desk, laptop], rooms: [room] }).y).toBeCloseTo(0.02);
  });

  it('on the ground floor, outside every room, it stands on the ground', () => {
    const chair = { id: 'c', assetType: 'CHAIR_OFFICE', x: 0, y: 0, z: 0 };
    expect(planDrop(chair, { x: 20, z: 20 }, { rooms: [room], ground: true }).y).toBe(0);
    expect(planDrop(chair, { x: 20, z: 20 }, { rooms: [room], ground: false }).y).toBeCloseTo(0.02);
  });

  it('never stacks an item on itself', () => {
    expect(planDrop(desk, { x: 0, z: 0 }, { objects: [desk], rooms: [room] }).y).toBeCloseTo(0.02);
  });
});

describe('item footprints', () => {
  it('size = catalogue size × scale', () => {
    const t = ASSET_TYPES.DESK_STANDARD;
    expect(itemSize({ ...desk, scaleX: 2 })).toEqual({ width: t.defaultWidth * 2, depth: t.defaultDepth, height: t.defaultHeight });
  });

  it('a turned item covers the turned rectangle', () => {
    const long = { ...desk, scaleX: 3 }; // about 4 m wide, 0.7 m deep
    const half = itemSize(long).width / 2 - 0.1;
    expect(itemContains(long, { x: half, z: 0 })).toBe(true);
    expect(itemContains(long, { x: 0, z: half })).toBe(false);
    const turned = { ...long, rotationY: Math.PI / 2 }; // local x along (0, −1)
    expect(itemContains(turned, { x: 0, z: -half })).toBe(true);
    expect(itemContains(turned, { x: half, z: 0 })).toBe(false);
  });
});
