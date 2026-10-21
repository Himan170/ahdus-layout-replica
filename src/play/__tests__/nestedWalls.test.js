import { describe, it, expect } from 'vitest';
import {
  snapRoomRect, containerOf, roomContainedBy, roomWallSegments, wallPickTarget, planRoom, planRoomMove,
  planRoomResize, stretchRoom, planOpening, partnerWall, roomsStandingOnWall, outerRoomOfWall,
  WALL_THICKNESS, ROOM_SNAP,
} from '../geometry';

const T = WALL_THICKNESS;
// The case from Himan's screenshot: a big office with rooms inside it
const office = (extra = {}) => ({ id: 'office', name: 'Office 1', floor: 0, x: 0, z: 0, width: 16, depth: 10, doors: [], windows: [], ...extra });
const inner = (id, x, z, width, depth, extra = {}) => ({ id, name: id, floor: 0, x, z, width, depth, doors: [], windows: [], ...extra });
const edges = (r) => ({ west: r.x - r.width / 2, east: r.x + r.width / 2, south: r.z - r.depth / 2, north: r.z + r.depth / 2 });

describe('snapRoomRect: siblings inside one room snap back to back, like rooms outside', () => {
  it('a room drawn next to a sibling lands one wall thickness from it (and so shares that wall)', () => {
    const a = inner('a', -3, 0, 4, 4);                       // x -5..-1
    const { rect } = planRoom({ x: -0.8, z: -2 }, { x: 3, z: 2 }, [office(), a]);
    expect(edges(rect).west).toBeCloseTo(-1 + T);
    expect(roomContainedBy(office(), { ...rect, floor: 0 })).toBe(true);
  });

  it('never snaps an inner room to rooms outside its outer room (or to another room\'s inner rooms)', () => {
    const outside = { ...office(), id: 'outside', x: 16.15 };            // back to back with the office, x 8.15..24.15
    const other = inner('otherInner', 16.15, 0, 4, 4);                   // inside "outside"
    const rect = snapRoomRect({ x: 5.5, z: 0, width: 4, depth: 4, floor: 0 }, [office(), outside, other]);
    // east edge 7.5 is 0.5 from the office wall: no snap to the outside rooms' walls at 8.15 / 14.15
    expect(edges(rect).east).toBeCloseTo(7.5);
  });

  it('a top-level room never snaps to rooms inside another room', () => {
    const k = inner('k', 6, 0, 3, 3);                                    // inside the office, east edge 7.5
    const rect = snapRoomRect({ x: 10, z: 0, width: 4, depth: 4, floor: 0 }, [office(), k]); // west edge 8
    expect(edges(rect).west).toBeCloseTo(8 + T);                         // onto the office (8 + T), not onto k
  });
});

describe('snapRoomRect: onto the wall of the room it stands in', () => {
  it('an edge within ROOM_SNAP of the outer wall goes exactly onto its line', () => {
    const rect = snapRoomRect({ x: 5.8, z: 0, width: 4, depth: 4, floor: 0 }, [office()]); // east 7.8, wall at 8
    expect(edges(rect).east).toBeCloseTo(8);
    expect(edges(rect).west).toBeCloseTo(3.8);
    expect(roomContainedBy(office(), { ...rect, floor: 0 })).toBe(true);
  });

  it('an edge a little outside the outer wall comes back onto it', () => {
    const rect = snapRoomRect({ x: 6.2, z: 0, width: 4, depth: 4, floor: 0 }, [office()], { container: office() });
    expect(edges(rect).east).toBeCloseTo(8);
  });

  it('further than ROOM_SNAP: nothing moves', () => {
    const rect = snapRoomRect({ x: 8 - 2 - ROOM_SNAP - 0.05, z: 0, width: 4, depth: 4, floor: 0 }, [office()]);
    expect(edges(rect).east).toBeCloseTo(8 - ROOM_SNAP - 0.05);
  });

  it('moving a room keeps its size and lands it on the outer wall', () => {
    const r = inner('r', 0, 0, 4, 4);
    const plan = planRoomMove(r, 5.85, 0.2, [office(), r]);
    expect(plan.blocker).toBeNull();
    expect(plan.rect.x).toBeCloseTo(6);
    expect(plan.rect.z).toBeCloseTo(0.2);
    expect([plan.rect.width, plan.rect.depth]).toEqual([4, 4]);
  });

  it('Stretch snaps only the wall being dragged', () => {
    const r = inner('r', 0, 0, 4, 4);
    const out = stretchRoom(r, 'east', 7.8, { rooms: [office(), r] });
    expect(out.problem).toBeNull();
    expect(out.rect).toEqual({ x: 3, z: 0, width: 10, depth: 4 });
  });

  it('the Inspector size snaps the edges that move', () => {
    const r = inner('r', 6, 0, 3, 4);                                    // x 4.5..7.5
    const plan = planRoomResize(r, 3.6, 4, [office(), r]);              // x 4.2..7.8 → east onto 8
    expect(plan.blocker).toBeNull();
    expect(edges(plan.rect).east).toBeCloseTo(8);
    expect(edges(plan.rect).west).toBeCloseTo(4.2);
  });

  it('stretching the outer room to near a room inside makes it stand on the wall (and rooms inside may stay)', () => {
    const r = inner('r', 6, 0, 3, 4);                                    // east edge 7.5
    const out = stretchRoom(office(), 'east', 7.7, { rooms: [office(), r] });
    expect(out.problem).toBeNull();
    expect(edges(out.rect).east).toBeCloseTo(7.5);
    expect(stretchRoom(office(), 'east', 7, { rooms: [office(), r] }).problem).toBe('Would overlap r');
  });

  it('works on upper floors (other floors never count)', () => {
    const up = office({ floor: 1 });
    const ground = office({ id: 'ground' });
    const { rect, blocker } = planRoom({ x: 4, z: -2 }, { x: 7.8, z: 2 }, [up, ground].filter((r) => r.floor === 1), [ground]);
    expect(edges(rect).east).toBeCloseTo(8);
    expect(blocker).toBeNull();
    expect(containerOf({ ...rect, floor: 1 }, [up, ground])?.id).toBe('office');
  });
});

describe('roomContainedBy: standing on the outer wall', () => {
  it('touching a side is inside; walls partly in each other or sticking out are not', () => {
    expect(roomContainedBy(office(), inner('r', 6, 0, 4, 4))).toBe(true);        // east 8: on the wall
    expect(roomContainedBy(office(), inner('r', 5.85, 0, 4, 4))).toBe(true);     // 0.15 in: clear
    expect(roomContainedBy(office(), inner('r', 5.95, 0, 4, 4))).toBe(false);    // 0.05 in: walls in each other
    expect(roomContainedBy(office(), inner('r', 6.5, 0, 4, 4))).toBe(false);     // sticks out
    expect(roomContainedBy(office(), inner('strip', 0, 3, 16, 4))).toBe(true);   // wall to wall
    expect(roomContainedBy(office(), office({ id: 'copy' }))).toBe(false);      // the same rectangle
  });
});

/** The office with A and B side by side inside it, B standing on the office's east and north walls. */
function layout(ids = ['a', 'b']) {
  const a = inner(ids[0], 2, 2, 4, 6);                                 // x 0..4, z -1..5
  const b = inner(ids[1], 4 + T + 1.925, 2, 3.85, 6);                  // x 4.15..8 (east wall), z -1..5 (north wall)
  return { o: office(), a, b, rooms: [office(), a, b] };
}

describe('roomWallSegments: one wall between siblings and against the outer wall', () => {
  for (const ids of [['a', 'b'], ['b', 'a'], ['0-first', 'z-last'], ['z-last', '0-first']]) {
    it(`siblings share one wall, whichever id sorts first (${ids.join(', ')})`, () => {
      const { a, b, rooms } = layout(ids);
      const fromA = roomWallSegments(a, 'east', rooms).filter((s) => s.shared);
      const fromB = roomWallSegments(b, 'west', rooms).filter((s) => s.shared);
      expect(fromA.length + fromB.length).toBe(1);                     // built once
      const piece = [...fromA, ...fromB][0];
      expect(piece.worldValue).toBeCloseTo(4 + T / 2);
      expect(piece.partnerWall).toBe(fromA.length ? 'west' : 'east');
    });

    it(`against the outer wall there is one wall: the inner room builds it, the office not (${ids.join(', ')})`, () => {
      const { o, b, rooms } = layout(ids);
      // the office's east wall leaves out B's stretch (z -1+T/2 .. 5-T/2)
      const officeEast = roomWallSegments(o, 'east', rooms);
      const covered = officeEast.filter((s) => s.u1 > -1 + T / 2 + 1e-6 && s.u0 < 5 - T / 2 - 1e-6);
      expect(covered).toEqual([]);
      // B builds it, on the office's line, full thickness, shared with the office
      const bEast = roomWallSegments(b, 'east', rooms);
      expect(bEast).toHaveLength(1);
      expect(bEast[0]).toMatchObject({ shared: true, sameSide: true, crossOffset: 0, partnerWall: 'east' });
      expect(bEast[0].partnerRoom.id).toBe('office');
      expect(bEast[0].worldValue).toBeCloseTo(8);
      // the north side too
      const bNorth = roomWallSegments(b, 'north', rooms);
      expect(bNorth.every((s) => s.sameSide)).toBe(true);
      expect(roomWallSegments(o, 'north', rooms).some((s) => s.u1 > 4.15 - T / 2 + 1e-6 && s.u0 < 8 + T / 2 - 1e-6)).toBe(false);
    });
  }

  it('the inner room\'s other walls stop at the outer wall\'s inside face (no faces in the same place)', () => {
    const { b, rooms } = layout();
    const south = roomWallSegments(b, 'south', rooms);
    const end = Math.max(...south.map((s) => s.u1)) + b.x;
    expect(end).toBeCloseTo(8 - T / 2);
  });

  it('a room 0.15 m in from the wall (an old save) keeps its own wall: nothing changes for it', () => {
    const old = inner('old', 5.85, 0, 4, 4);
    const segs = roomWallSegments(old, 'east', [office(), old]);
    expect(segs.every((s) => !s.shared)).toBe(true);
    expect(roomWallSegments(office(), 'east', [office(), old]).every((s) => !s.shared)).toBe(true);
  });

  it('the outer room\'s wall back to back with a neighbour: where a room inside stands on it, that room shares it with the neighbour', () => {
    const { o, b } = layout();
    const next = { ...office(), id: 'next', x: 16 + T };                // west edge 8.15: back to back with the office
    const rooms = [o, b, next];
    const nextWest = roomWallSegments(next, 'west', rooms).filter((s) => s.shared);
    const bEast = roomWallSegments(b, 'east', rooms).filter((s) => s.shared && !s.sameSide);
    const officeEast = roomWallSegments(o, 'east', rooms).filter((s) => s.shared);
    expect(bEast.map((s) => s.partnerRoom.id)).toEqual(['next']);       // B ↔ next, where B stands ('b' sorts first: B builds it)
    expect(officeEast.every((s) => s.partnerRoom.id === 'next')).toBe(true);
    // each stretch of the wall is built once
    const spans = [
      ...nextWest.map((s) => [s.u0 + next.z, s.u1 + next.z]),
      ...bEast.map((s) => [s.u0 + b.z, s.u1 + b.z]),
      ...officeEast.map((s) => [s.u0 + o.z, s.u1 + o.z]),
    ].sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1] - 1e-6);
  });
});

describe('doors and picks on a wall an inner room stands on', () => {
  it('a door through it is stored on both rooms, from inside or from outside', () => {
    const { o, b, rooms } = layout();
    const fromInside = planOpening(rooms, b, 'east', { x: 8, z: 2 }, 'door');
    expect(fromInside.problem).toBeNull();
    expect(fromInside.list.map((d) => [d.roomId, d.wall])).toEqual([['b', 'east'], ['office', 'east']]);
    const fromOutside = planOpening(rooms, o, 'east', { x: 8, z: 2 }, 'door');
    expect(fromOutside.list.map((d) => [d.roomId, d.wall])).toEqual([['office', 'east'], ['b', 'east']]);
    expect(fromInside.list[1].offset).toBeCloseTo(2 - o.z);              // the same spot on the office's wall
    // outside B's stretch the office's wall has no partner
    expect(partnerWall(rooms, o, 'east', { x: 8, z: -3 }, 1)).toBeNull();
  });

  it('picks: from inside it is the inner room\'s wall, from outside the outer room\'s', () => {
    const meta = { roomId: 'b', wallName: 'east', sharedWith: 'office', sharedWall: 'east', sharedAt: 8, sameSide: true, innerRoom: 'b', outerRoom: 'office' };
    expect(wallPickTarget(meta, { x: 7.9, z: 2 })).toEqual({ roomId: 'b', wallName: 'east' });
    expect(wallPickTarget(meta, { x: 8.1, z: 2 })).toEqual({ roomId: 'office', wallName: 'east' });
    // a door of the office drawn in that piece (roomId: office) means the same
    expect(wallPickTarget({ ...meta, roomId: 'office', sharedWith: 'b' }, { x: 7.9, z: 2 })).toEqual({ roomId: 'b', wallName: 'east' });
  });

  it('roomsStandingOnWall / outerRoomOfWall', () => {
    const { o, b, rooms } = layout();
    expect(roomsStandingOnWall(o, 'east', rooms).map((r) => r.id)).toEqual(['b']);
    expect(outerRoomOfWall(b, 'north', rooms)?.id).toBe('office');
    expect(outerRoomOfWall(b, 'west', rooms)).toBeNull();
  });
});
