import { describe, it, expect } from 'vitest';
import {
  STOREY_HEIGHT, SLAB, DEFAULT_WALL_HEIGHT, MAX_STEP, STAIR,
  floorHeight, elevationOf, wallSpace, levelForY, floorPosition, fillsFloor,
  planWallHeight, planFloorHeight, copyRoomsUp, stairDims, stairDimsFor, stairHeightAt,
  supportHeight, stairNeedsRoomAbove, arrivalOnFloor, overhangArea, overhangs,
} from '../building';
import { planRoom, stretchRoom, snapRectToOutline } from '../geometry';
import { normaliseLayout } from '../../store/layoutData';

// Ground 4.3 m (walls 4 m), Floor 1 3.5 m, Floor 2 3.0 m
const floors = {
  0: { id: 0, name: 'Ground Floor', height: 4.3 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
  2: { id: 2, name: 'Floor 2', height: 3.0 },
};

describe('floor heights and derived elevations', () => {
  it('elevation = the heights of the floors below added up (never stored)', () => {
    expect(elevationOf(floors, 0)).toBe(0);
    expect(elevationOf(floors, 1)).toBeCloseTo(4.3);
    expect(elevationOf(floors, 2)).toBeCloseTo(7.8);
    expect(elevationOf(floors, 99)).toBe(0);
  });

  it('a floor without a height is a standard storey; walls fit under the slab', () => {
    expect(floorHeight({ 0: { id: 0 } }, 0)).toBe(STOREY_HEIGHT);
    expect(elevationOf({ 0: { id: 0 }, 1: { id: 1 } }, 1)).toBe(STOREY_HEIGHT);
    expect(wallSpace(floors, 0)).toBeCloseTo(4.0);
    expect(DEFAULT_WALL_HEIGHT).toBeCloseTo(STOREY_HEIGHT - SLAB);
  });

  it('raising a floor moves every floor above it (they follow by themselves)', () => {
    const taller = { ...floors, 0: { ...floors[0], height: 5 } };
    expect(elevationOf(taller, 1)).toBeCloseTo(5);
    expect(elevationOf(taller, 2)).toBeCloseTo(8.5);
  });

  it('floors stack in id order; which floor a height is on uses the real elevations', () => {
    expect(levelForY(floors, 3.2)).toBe(0);
    expect(levelForY(floors, 3.4)).toBe(1);    // 1 m before reaching 4.3
    expect(levelForY(floors, 4.32)).toBe(1);
    expect(levelForY(floors, 7.82)).toBe(2);
    expect(floorPosition(floors, 1)).toEqual({ index: 2, count: 3 });
  });
});

describe('wall heights keep the storeys closed', () => {
  const rooms = [
    { id: 'a', name: 'Office', floor: 0, wallHeight: 4.0 },
    { id: 'b', name: 'Meeting', floor: 0, wallHeight: 4.0 },
    { id: 'c', name: 'Store', floor: 0, wallHeight: 2.5 },          // made lower on purpose
    { id: 'u', name: 'Upstairs', floor: 1, wallHeight: 3.2 },
  ];

  it('walls fill their floor when they reach the slab above', () => {
    expect(fillsFloor(rooms[0], 4.3)).toBe(true);
    expect(fillsFloor(rooms[2], 4.3)).toBe(false);
  });

  it('lower walls: only that room changes, the floor stays', () => {
    const plan = planWallHeight(floors, rooms, rooms[0], 3.5);
    expect(plan).toMatchObject({ problem: null, raised: false, height: 4.3, rooms: [['a', 3.5]] });
  });

  it('higher than the floor allows: the floor grows to walls + slab, rooms that filled it follow', () => {
    const plan = planWallHeight(floors, rooms, rooms[0], 5);
    expect(plan.problem).toBeNull();
    expect(plan.raised).toBe(true);
    expect(plan.height).toBeCloseTo(5 + SLAB);
    expect(new Map(plan.rooms)).toEqual(new Map([['a', 5], ['b', 5]])); // the 2.5 m store stays low
  });

  it('a ground room with 4 m walls on a 3.5 m floor puts the floor above at 4.3 m', () => {
    const std = { 0: { id: 0, height: 3.5 }, 1: { id: 1, height: 3.5 } };
    const room = { id: 'g', floor: 0, wallHeight: 3.2 };
    const plan = planWallHeight(std, [room], room, 4);
    const after = { ...std, 0: { ...std[0], height: plan.height } };
    expect(elevationOf(after, 1)).toBeCloseTo(4.3);
    expect(elevationOf(after, 1) - SLAB).toBeCloseTo(0 + 4);   // the slab sits right on the walls: no gap
  });

  it('limits, and doors that would stick out of the wall', () => {
    expect(planWallHeight(floors, rooms, rooms[0], 1.5).problem).toMatch(/at least 2.0/);
    expect(planWallHeight(floors, rooms, rooms[0], 6.5).problem).toMatch(/at most 6.0/);
    const withDoor = { ...rooms[0], doors: [{ wall: 'north', offset: 0, width: 1, height: 2.1 }] };
    expect(planWallHeight(floors, [withDoor], withDoor, 2.1).problem).toMatch(/door in Office is too high/);
  });

  it('a floor height change: filling rooms follow, taller rooms shrink, low rooms stay', () => {
    const plan = planFloorHeight(floors, rooms, 0, 3.5);
    expect(new Map(plan.rooms)).toEqual(new Map([['a', 3.2], ['b', 3.2]]));
    const lower = planFloorHeight(floors, rooms, 0, 2.6);
    expect(new Map(lower.rooms)).toEqual(new Map([['a', 2.3], ['b', 2.3], ['c', 2.3]]));
    expect(planFloorHeight(floors, rooms, 0, 1.9).problem).toMatch(/Floors are/);
  });

  it('copying rooms up keeps footprints, types, wall heights, doors and windows', () => {
    const src = [{ id: 'r', floor: 0, type: 'OFFICE', color: '#fff', x: 1, z: 2, width: 6, depth: 4, wallHeight: 3.2,
      doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [{ wall: 'east', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] }];
    const [copy] = copyRoomsUp(src, 0, 1);
    expect(copy).toMatchObject({ floor: 1, type: 'OFFICE', x: 1, z: 2, width: 6, depth: 4, wallHeight: 3.2 });
    expect(copy.doors).toEqual(src[0].doors);
    expect(copy.doors).not.toBe(src[0].doors);
    expect(copy).not.toHaveProperty('id');
  });
});

describe('stairs climb the height of their floor', () => {
  it('steps are 0.18–0.2 m high, for any floor height', () => {
    for (const rise of [2.3, 3.0, 3.5, 4.3, 5.1, 6.3]) {
      const d = stairDims(rise);
      expect(rise / d.steps).toBeLessThanOrEqual(MAX_STEP + 1e-9);
      expect(rise / d.steps).toBeGreaterThanOrEqual(0.18);
    }
    expect(STAIR.steps).toBe(18);
    expect(stairDimsFor(floors, { floor: 0 }).rise).toBeCloseTo(4.3);
  });

  it('the top step lands exactly on the floor above', () => {
    const stair = { x: 0, z: 0, rotationY: 0, floor: 0 };
    const d = stairDimsFor(floors, stair);
    expect(stairHeightAt(stair, 0, d.length / 2, d)).toBeCloseTo(elevationOf(floors, 1));
  });

  it('walking up stairs from a 4.3 m floor ends on the floor above', () => {
    const rooms = [
      { id: 'g', floor: 0, x: 0, z: 0, width: 10, depth: 8, wallHeight: 4 },
      { id: 'u', floor: 1, x: 0, z: 0, width: 10, depth: 8, wallHeight: 3.2 },
    ];
    const stairs = [{ floor: 0, x: 3, z: 0, rotationY: 0 }];
    let y = 0.02;
    for (let z = -2.3; z <= 2.6; z += 0.1) y = supportHeight({ x: 3, z, y, floors, rooms, stairs });
    expect(y).toBeCloseTo(4.32);
  });

  it('stairs need a room on the floor above where they arrive', () => {
    const stair = { x: 0, z: 0, rotationY: 0, floor: 0 };
    expect(stairNeedsRoomAbove(stair, { 0: { id: 0 } }, [])).toBe(true);                 // no floor above
    expect(stairNeedsRoomAbove(stair, floors, [])).toBe(true);                           // nothing built there
    expect(stairNeedsRoomAbove(stair, floors, [{ floor: 1, x: 0, z: 0, width: 8, depth: 8 }])).toBe(false);
  });
});

describe('going to another floor (Page Up / Page Down)', () => {
  const rooms = [{ id: 'u', floor: 1, x: 0, z: 0, width: 6, depth: 6 }];
  it('stands on a room there, else flies at that height; the ground floor has the ground', () => {
    const on = arrivalOnFloor({ x: 0, z: 0, floorId: 1, floors, rooms });
    expect(on.fly).toBe(false);
    expect(on.y).toBeCloseTo(4.32);
    const off = arrivalOnFloor({ x: 20, z: 0, floorId: 1, floors, rooms });
    expect(off.fly).toBe(true);
    expect(off.y).toBeCloseTo(4.32);
    expect(arrivalOnFloor({ x: 20, z: 0, floorId: 0, floors, rooms })).toEqual({ y: 0, fly: false });
  });
  it('over the stairwell there is no floor to stand on', () => {
    const stairs = [{ floor: 0, x: 0, z: 0, rotationY: 0 }];
    expect(arrivalOnFloor({ x: 0, z: 0, floorId: 1, floors, rooms, stairs }).fly).toBe(true);
  });
});

describe('rooms line up between floors', () => {
  const below = [{ id: 'g', floor: 0, x: 0, z: 0, width: 8, depth: 6 }];   // x -4..4, z -3..3

  it('edges within 0.3 m of a wall below snap onto it', () => {
    const r = snapRectToOutline({ x: 0.1, z: 0.05, width: 8.4, depth: 6.3 }, below); // x -4.1..4.3, z -3.1..3.2
    expect(r).toEqual({ x: 0, z: 0, width: 8, depth: 6 });
    const far = snapRectToOutline({ x: 0, z: 0, width: 9, depth: 6 }, below);         // 0.5 m out: no snap
    expect(far.width).toBe(9);
  });

  it('drawing a room on Floor 1 lines up with the room below, and warns when it overhangs', () => {
    const aligned = planRoom({ x: -4.2, z: -3.2 }, { x: 4.2, z: 3.1 }, [], below);
    expect(aligned.rect).toEqual({ x: 0, z: 0, width: 8, depth: 6 });
    expect(aligned.overhang).toBe(false);
    const sticking = planRoom({ x: -4, z: -3 }, { x: 7, z: 3 }, [], below);
    expect(sticking.overhang).toBe(true);
    expect(overhangArea(sticking.rect, below)).toBeCloseTo((3 - 0.075) * 6); // the wall below holds up its own half
    expect(planRoom({ x: -4, z: -3 }, { x: 7, z: 3 }, []).overhang).toBe(false);     // ground floor: never
  });

  it('a room over two back-to-back rooms does not overhang the gap between their walls', () => {
    const pair = [{ x: -2.075, z: 0, width: 4, depth: 6 }, { x: 2.075, z: 0, width: 4, depth: 6 }];
    expect(overhangs({ x: 0, z: 0, width: 8.15, depth: 6 }, pair)).toBe(false);
  });

  it('stretching a wall on Floor 1 snaps it over the wall below', () => {
    const upper = { id: 'u', name: 'Up', floor: 1, x: 0, z: 0, width: 6, depth: 6, doors: [], windows: [] }; // x -3..3
    const r = stretchRoom(upper, 'east', 3.8, { below });
    expect(r.rect.x + r.rect.width / 2).toBeCloseTo(4);
    expect(r.overhang).toBe(false);
  });
});

describe('old saves get floor heights', () => {
  it('floors keep their place; walls that met the old 0.5 m slab meet the new 0.3 m one', () => {
    const n = normaliseLayout({
      floors: { 0: { id: 0, name: 'Ground Floor', elevation: 0 }, 1: { id: 1, name: 'Floor 1', elevation: 3.5 } },
      rooms: [
        { id: 'room_1', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3 },
        { id: 'room_2', floor: 1, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3 },
      ],
    });
    expect(n.floors[0]).toEqual({ id: 0, name: 'Ground Floor', height: 3.5 });
    expect(n.floors[1]).not.toHaveProperty('elevation');
    expect(elevationOf(n.floors, 1)).toBe(3.5);
    expect(n.rooms.map((r) => r.wallHeight)).toEqual([3.2, 3.2]);
  });

  it('walls taller than their storey raise it (no walls poking into the floor above)', () => {
    const n = normaliseLayout({
      floors: [{ id: 0, elevation: 0 }, { id: 1, elevation: 3.5 }],
      rooms: [{ id: 'room_1', floor: 0, wallHeight: 4 }, { id: 'room_2', floor: 0, wallHeight: 2.5 }],
    });
    expect(n.floors[0].height).toBeCloseTo(4.3);
    expect(elevationOf(n.floors, 1)).toBeCloseTo(4.3);
    expect(n.rooms.map((r) => r.wallHeight)).toEqual([4, 2.5]);
  });

  it('saves with floor heights load as they are', () => {
    const n = normaliseLayout({
      floors: { 0: { id: 0, name: 'G', height: 4.3 }, 1: { id: 1, name: 'F1', height: 3.5 } },
      rooms: [{ id: 'room_1', floor: 0, wallHeight: 4 }, { id: 'room_2', floor: 1 }],
    });
    expect(n.floors).toEqual({ 0: { id: 0, name: 'G', height: 4.3 }, 1: { id: 1, name: 'F1', height: 3.5 } });
    expect(n.rooms[1].wallHeight).toBeCloseTo(3.2);   // missing: fills its floor
  });
});
