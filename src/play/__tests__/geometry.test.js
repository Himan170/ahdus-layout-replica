import { describe, it, expect } from 'vitest';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import {
  rectFromCorners, wallSegmentTransform, splitWall, roomWalls, openingOffsetFromHit,
  overlapsExisting, openingAt, findRoomAt, roomOpenings, WALL_THICKNESS,
  roomWallSegments, wallSegmentOpenings, wallPickTarget, touchingRooms, roomsToRebuild,
} from '../geometry';

describe('rectFromCorners', () => {
  it('works whichever corner is clicked first', () => {
    const r1 = rectFromCorners({ x: 0, z: 0 }, { x: 6, z: 4 });
    const r2 = rectFromCorners({ x: 6, z: 4 }, { x: 0, z: 0 });
    expect(r1).toEqual({ x: 3, z: 2, width: 6, depth: 4 });
    expect(r2).toEqual(r1);
  });
  it('grows a tiny drag to the minimum size, in the drag direction', () => {
    expect(rectFromCorners({ x: 2, z: 2 }, { x: 1.5, z: 2 })).toEqual({ x: 1.25, z: 2.75, width: 1.5, depth: 1.5 });
  });
});

describe('wallSegmentTransform', () => {
  it('stretches and rotates the 3 m wall asset so its ends land on the clicked points', () => {
    const a = { x: 1, z: 2 };
    const b = { x: 4, z: 6 }; // length 5
    const t = wallSegmentTransform(a, b);
    expect(t.length).toBeCloseTo(5);
    expect(t.scaleX).toBeCloseTo(5 / 3);

    // Local end of the asset is (+1.5, 0, 0); after scale+rotate+translate it must be b
    const m = Matrix.Scaling(t.scaleX, 1, 1)
      .multiply(Matrix.RotationY(t.rotationY))
      .multiply(Matrix.Translation(t.x, 0, t.z));
    const end = Vector3.TransformCoordinates(new Vector3(1.5, 0, 0), m);
    const start = Vector3.TransformCoordinates(new Vector3(-1.5, 0, 0), m);
    expect(end.x).toBeCloseTo(b.x); expect(end.z).toBeCloseTo(b.z);
    expect(start.x).toBeCloseTo(a.x); expect(start.z).toBeCloseTo(a.z);
  });
});

describe('roomWalls', () => {
  it('walls do not overlap at the corners', () => {
    const walls = roomWalls({ width: 6, depth: 4 });
    const north = walls.find((w) => w.name === 'north');
    const east = walls.find((w) => w.name === 'east');
    // east wall ends exactly where the north wall's inner face starts
    expect(east.cz + east.length / 2).toBeCloseTo(north.cz - WALL_THICKNESS / 2);
  });
});

describe('splitWall', () => {
  const area = (ps) => ps.reduce((s, p) => s + (p.u1 - p.u0) * (p.y1 - p.y0), 0);

  it('no openings → one piece', () => {
    expect(splitWall(6, 3, [])).toEqual([{ u0: -3, u1: 3, y0: 0, y1: 3 }]);
  });

  it('door → left, right and the part above the door', () => {
    const p = splitWall(6, 3, [{ offset: 0, width: 1, bottom: 0, top: 2.1 }]);
    expect(p).toHaveLength(3);
    expect(area(p)).toBeCloseTo(6 * 3 - 1 * 2.1);
  });

  it('window → also keeps the wall below the sill', () => {
    const p = splitWall(6, 3, [{ offset: 1, width: 1.4, bottom: 0.9, top: 2.1 }]);
    expect(p).toHaveLength(4);
    expect(area(p)).toBeCloseTo(18 - 1.4 * 1.2);
  });

  it('door and window on the same wall, in any order', () => {
    const p = splitWall(8, 3, [
      { offset: 2, width: 1.4, bottom: 0.9, top: 2.1 },
      { offset: -2, width: 1, bottom: 0, top: 2.1 },
    ]);
    expect(area(p)).toBeCloseTo(24 - 2.1 - 1.68);
    for (const piece of p) expect(piece.u1).toBeGreaterThan(piece.u0);
  });
});

describe('openings', () => {
  const room = { x: 10, z: 0, width: 6, depth: 4, doors: [{ wall: 'north', offset: -1, width: 1 }], windows: [] };

  it('offset comes from where the user aimed, clamped inside the wall', () => {
    expect(openingOffsetFromHit(room, 'north', { x: 11.2, z: 2 }, 1)).toBeCloseTo(1.2);
    expect(openingOffsetFromHit(room, 'north', { x: 30, z: 2 }, 1)).toBeCloseTo(3 - 0.5 - 0.15);
    expect(openingOffsetFromHit({ ...room, depth: 1 }, 'east', { x: 13, z: 0 }, 1.4)).toBeNull();
  });

  it('detects overlap with an existing door', () => {
    expect(overlapsExisting(room, 'north', -0.5, 1)).toBe(true);
    expect(overlapsExisting(room, 'north', 1.5, 1)).toBe(false);
    expect(overlapsExisting(room, 'south', -1, 1)).toBe(false);
  });

  it('finds the opening the user is looking at', () => {
    expect(openingAt(room, 'north', { x: 9.2, z: 2 })).toMatchObject({ kind: 'door', index: 0 });
    expect(openingAt(room, 'north', { x: 12, z: 2 })).toBeNull();
  });

  it('roomOpenings fills defaults for old doors saved without width/height', () => {
    expect(roomOpenings({ doors: [{ wall: 'east' }] })[0]).toMatchObject({ offset: 0, width: 1, top: 2.1 });
  });
});

describe('findRoomAt', () => {
  const rooms = [
    { id: 'a', floor: 0, x: 0, z: 0, width: 4, depth: 4 },
    { id: 'b', floor: 1, x: 0, z: 0, width: 4, depth: 4 },
  ];
  it('respects the floor', () => {
    expect(findRoomAt(rooms, 1, 1, 1).id).toBe('b');
    expect(findRoomAt(rooms, 5, 5, 0)).toBeNull();
  });
});

import { snapRectToNeighbours, partnerWall, rectsOverlap } from '../geometry';

describe('neighbouring rooms', () => {
  const office = { id: 'a', floor: 0, x: 0, z: 0, width: 6, depth: 4 }; // x: -3..3

  it('a room drawn against a neighbour snaps back-to-back (one wall thickness apart)', () => {
    // user drew x 3..7 (touching the office's east wall at x=3)
    const r = snapRectToNeighbours({ x: 5, z: 0, width: 4, depth: 4 }, [office]);
    expect(r.x - r.width / 2).toBeCloseTo(3 + WALL_THICKNESS);
    expect(r.x + r.width / 2).toBeCloseTo(7);
    expect(rectsOverlap(r, office)).toBe(false);
  });

  it('leaves rooms that are far away alone', () => {
    const rect = { x: 10, z: 0, width: 4, depth: 4 };
    expect(snapRectToNeighbours(rect, [office])).toEqual(rect);
  });

  it('a door on the shared wall finds the neighbour wall behind it', () => {
    const meeting = { id: 'b', floor: 0, ...snapRectToNeighbours({ x: 5, z: 0, width: 4, depth: 4 }, [office]) };
    const p = partnerWall([office, meeting], office, 'east', { x: 3, z: 0.5 });
    expect(p).toMatchObject({ wallName: 'west' });
    expect(p.room.id).toBe('b');
    // not on another floor, and not outside the neighbour's extent
    expect(partnerWall([office, { ...meeting, floor: 1 }], office, 'east', { x: 3, z: 0.5 })).toBeNull();
    expect(partnerWall([office, meeting], office, 'north', { x: 0, z: 2 })).toBeNull();
  });

  it('detects overlapping rooms', () => {
    expect(rectsOverlap(office, { x: 2, z: 0, width: 4, depth: 4 })).toBe(true);
    expect(rectsOverlap(office, { x: 5, z: 0, width: 4, depth: 4 })).toBe(false);
  });
});

import { placeOpening } from '../geometry';

describe('placeOpening (doors between neighbouring rooms)', () => {
  const office = { id: 'a', name: 'Office 1', floor: 0, x: 0, z: 0, width: 6, depth: 6, doors: [], windows: [] };
  // Meeting room is shorter and only shares the lower part of the office's east wall
  const meeting = { id: 'b', name: 'Meeting 1', floor: 0, x: 3.15 + 2, z: -1, width: 4, depth: 4, doors: [], windows: [] };
  const rooms = [office, meeting];

  it('one opening position that fits both walls, even when aiming near the end of the shorter one', () => {
    const r = placeOpening(rooms, office, 'east', { x: 3, z: 0.9 }, 1);
    expect(r.problem).toBeUndefined();
    expect(r.partner.room.id).toBe('b');
    // same world position on both sides
    expect(office.z + r.offset).toBeCloseTo(meeting.z + r.partnerOffset);
    // and fully inside the meeting room's wall
    expect(Math.abs(r.partnerOffset)).toBeLessThanOrEqual(2 - 0.5 - 0.15 + 1e-9);
  });

  it('a wall with no neighbour behaves as before', () => {
    const r = placeOpening(rooms, office, 'west', { x: -3, z: 1 }, 1);
    expect(r).toEqual({ offset: 1, partner: null, partnerOffset: null });
  });

  it('refuses a spot that overlaps a window on either side', () => {
    const withWindow = { ...meeting, windows: [{ wall: 'west', offset: 0, width: 1.4 }] };
    const r = placeOpening([office, withWindow], office, 'east', { x: 3, z: -1 }, 1);
    expect(r.problem).toMatch(/Too close/);
  });

  it('aiming just past the end of the neighbour still counts (the door would overlap its wall)', () => {
    // meeting room's west wall runs z -3..1; aim at z 1.3 — a 1 m door there covers 0.8..1.8
    const r = placeOpening(rooms, office, 'east', { x: 3, z: 1.3 }, 1);
    expect(r.partner?.room.id).toBe('b');
    expect(meeting.z + r.partnerOffset).toBeLessThanOrEqual(1 - 0.5 - 0.15 + 1e-9);
  });

  it('aiming well past the neighbour gives an office-only door', () => {
    const r = placeOpening(rooms, office, 'east', { x: 3, z: 2.2 }, 1);
    expect(r.partner).toBeNull();
  });
});

describe('shared physical wall geometry', () => {
  const westRoom = { id: 'a', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3 };
  const eastRoom = { id: 'b', floor: 0, x: 5.15, z: 0, width: 4, depth: 4, wallHeight: 3.5 };

  it('emits one 0.15 m wall at the midpoint of back-to-back boundaries', () => {
    const owned = roomWallSegments(westRoom, 'east', [westRoom, eastRoom]).filter((s) => s.shared);
    const partner = roomWallSegments(eastRoom, 'west', [westRoom, eastRoom]).filter((s) => s.shared);
    expect(owned).toHaveLength(1);
    expect(partner).toHaveLength(0);
    expect(owned[0]).toMatchObject({
      worldValue: 3 + WALL_THICKNESS / 2,
      thickness: WALL_THICKNESS,
      axis: 'x',
      partnerRoom: eastRoom,
    });
    expect(owned[0].u1 - owned[0].u0).toBeCloseTo(4 - WALL_THICKNESS);
  });

  it('shares only the overlapping portion of a partial boundary', () => {
    const shortRoom = { ...eastRoom, z: -1, depth: 2 };
    const shared = roomWallSegments(westRoom, 'east', [westRoom, shortRoom]).filter((s) => s.shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].u0).toBeCloseTo(-1 - (2 - WALL_THICKNESS) / 2);
    expect(shared[0].u1).toBeCloseTo(-1 + (2 - WALL_THICKNESS) / 2);
    expect(shared[0].u1 - shared[0].u0).toBeCloseTo(2 - WALL_THICKNESS);
  });

  it('does not share walls across floors or across a nearby but unsnapped gap', () => {
    expect(roomWallSegments(westRoom, 'east', [westRoom, { ...eastRoom, floor: 1 }])
      .some((s) => s.shared)).toBe(false);
    expect(roomWallSegments(westRoom, 'east', [westRoom, { ...eastRoom, x: 5.1 }])
      .some((s) => s.shared)).toBe(false);
  });

  it('deduplicates paired doors and keeps the doorway clear through the shared wall', () => {
    const a = { ...westRoom, doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] };
    const b = { ...eastRoom, doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] };
    const segment = roomWallSegments(a, 'east', [a, b]).find((s) => s.shared);
    const openings = wallSegmentOpenings(a, 'east', segment);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ kind: 'door', offset: 0.25, bottom: 0, top: 2.1 });
    const pieces = splitWall(segment.u1 - segment.u0, 3.5, openings.map((o) => ({
      ...o, offset: o.offset - (segment.u0 + segment.u1) / 2,
    })));
    const localDoorCentre = 0.25 - (segment.u0 + segment.u1) / 2;
    expect(pieces.some((p) =>
      localDoorCentre > p.u0 && localDoorCentre < p.u1 && p.y0 < 1 && p.y1 > 1,
    )).toBe(false);
  });

  it('keeps a window from either room at its shared-wall world position and sill', () => {
    const a = { ...westRoom, windows: [] };
    const b = { ...eastRoom, windows: [{ wall: 'west', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }] };
    const segment = roomWallSegments(a, 'east', [a, b]).find((s) => s.shared);
    expect(wallSegmentOpenings(a, 'east', segment)).toMatchObject([
      { kind: 'window', offset: 0.5, width: 1.4, bottom: 0.9, top: 2.1, roomId: 'b', sourceWall: 'west' },
    ]);
  });

  it('recomputes boundaries when a room moves or resizes', () => {
    const moved = { ...eastRoom, x: 6.15 };
    expect(roomWallSegments(westRoom, 'east', [westRoom, moved]).some((s) => s.shared)).toBe(false);
    const resizedWest = { ...westRoom, width: 7 };
    const resizedEast = { ...eastRoom, x: 5.65 };
    const shared = roomWallSegments(resizedWest, 'east', [resizedWest, resizedEast]).find((s) => s.shared);
    expect(shared.worldValue).toBeCloseTo(3.575);
  });

  it('restores a complete external wall when the neighbour is removed', () => {
    const external = roomWallSegments(westRoom, 'east', [westRoom]);
    expect(external).toEqual([{
      u0: -(westRoom.depth - WALL_THICKNESS) / 2,
      u1: (westRoom.depth - WALL_THICKNESS) / 2,
      crossOffset: 0,
      shared: false,
    }]);
  });
});

describe('wallPickTarget: a shared wall means the room on the side it is hit from', () => {
  // West room x -3..3, east room x 3.15..7.15: the shared wall's centre line is x = 3.075
  const westSide = { x: 2.95, z: 0 };
  const eastSide = { x: 3.2, z: 0 };

  it.each([
    ['the west room builds it', { roomId: 'west', wallName: 'east', sharedWith: 'east', sharedWall: 'west', sharedAt: 3.075 }],
    ['the east room builds it', { roomId: 'east', wallName: 'west', sharedWith: 'west', sharedWall: 'east', sharedAt: 3.075 }],
  ])('either owner (%s)', (_, meta) => {
    expect(wallPickTarget(meta, westSide)).toEqual({ roomId: 'west', wallName: 'east' });
    expect(wallPickTarget(meta, eastSide)).toEqual({ roomId: 'east', wallName: 'west' });
  });

  it('works on north / south walls too', () => {
    // south room z -4..0, north room z 0.15..4.15: centre line z = 0.075
    const meta = { roomId: 'north', wallName: 'south', sharedWith: 'south', sharedWall: 'north', sharedAt: 0.075 };
    expect(wallPickTarget(meta, { x: 1, z: 0.5 })).toEqual({ roomId: 'north', wallName: 'south' });
    expect(wallPickTarget(meta, { x: 1, z: -0.5 })).toEqual({ roomId: 'south', wallName: 'north' });
  });

  it("a room's own wall (or no side known) is just that wall", () => {
    expect(wallPickTarget({ roomId: 'west', wallName: 'east' }, eastSide)).toEqual({ roomId: 'west', wallName: 'east' });
    const meta = { roomId: 'east', wallName: 'west', sharedWith: 'west', sharedWall: 'east', sharedAt: 3.075 };
    expect(wallPickTarget(meta, null)).toEqual({ roomId: 'east', wallName: 'west' });
  });
});

describe('roomsToRebuild: a change rebuilds the room and the rooms touching it', () => {
  // 4 × 3 offices back to back (shared walls), like the perf probe, plus one far away
  const grid = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      grid.push({ id: `r${i}${j}`, floor: 0, x: i * 6.15, z: j * 5.15, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [] });
    }
  }
  const far = { id: 'far', floor: 0, x: 60, z: 0, width: 4, depth: 4, wallHeight: 3.2, doors: [], windows: [] };
  const upstairs = { id: 'up', floor: 1, x: 6.15, z: 5.15, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [] };
  const before = [...grid, far, upstairs];
  const change = (id, patch) => before.map((r) => (r.id === id ? { ...r, ...patch } : r));
  const sorted = (set) => [...set].sort();
  const around = (i, j) => grid
    .filter((r) => Math.abs(Number(r.id[1]) - i) <= 1 && Math.abs(Number(r.id[2]) - j) <= 1)
    .map((r) => r.id).sort();

  it('touching = back to back or corner to corner on the same floor, not further', () => {
    const middle = grid.find((r) => r.id === 'r11');
    expect(touchingRooms(middle, before).map((r) => r.id).sort()).toEqual(around(1, 1).filter((id) => id !== 'r11'));
    expect(touchingRooms(far, before)).toEqual([]);
  });

  it('nothing changed: nothing to rebuild', () => {
    expect(roomsToRebuild(before, before.map((r) => ({ ...r })))).toEqual(new Set());
  });

  it('resizing a room rebuilds it and its neighbours, not the rest of the floor', () => {
    expect(sorted(roomsToRebuild(before, change('r11', { width: 5.5 })))).toEqual(around(1, 1));
  });

  it('moving a room rebuilds the rooms by its old place and by its new one', () => {
    const moved = change('r00', { x: 3 * 6.15 + 6.15, z: 0 }); // from the west end to past the east end
    expect(sorted(roomsToRebuild(before, moved))).toEqual(['r00', 'r01', 'r10', 'r11', 'r30', 'r31']);
  });

  it('a new door in a room rebuilds its neighbours too (it may cut a shared wall)', () => {
    const withDoor = change('r22', { doors: [{ wall: 'west', offset: 0, width: 0.9, height: 2.1 }] });
    expect(sorted(roomsToRebuild(before, withDoor))).toEqual(around(2, 2));
  });

  it('adding or removing a room rebuilds it (if added) and the rooms it touches', () => {
    const added = { id: 'new', floor: 0, x: 4 * 6.15, z: 5.15, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [] };
    expect(sorted(roomsToRebuild(before, [...before, added]))).toEqual(['new', 'r30', 'r31', 'r32']);
    expect(sorted(roomsToRebuild(before, before.filter((r) => r.id !== 'r32')))).toEqual(['r21', 'r22', 'r31']);
  });

  it('rooms on other floors are not rebuilt, and a room moved to another floor is', () => {
    expect(roomsToRebuild(before, change('r11', { width: 5.5 })).has('up')).toBe(false);
    expect(sorted(roomsToRebuild(before, change('far', { floor: 1 })))).toEqual(['far']);
  });
});
