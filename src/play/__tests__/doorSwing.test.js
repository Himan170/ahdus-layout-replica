// v0.18.1: door leaves. One door per doorway (A3), the swing the same in 3D and on plans, and the door budget (A5).
import { describe, it, expect } from 'vitest';
import {
  floorDoors, doorOf, drawsDoor, doorParts, leafLines, createDoorAnimator, nearDoor,
  MAX_ANIMATED_DOORS, OPEN_RADIUS, CLOSE_AFTER_S, OPEN_TIME_S,
} from '../doorSwing';
import { planOpening } from '../geometry';
import { roomWallPieces } from '../../floorplan/planMath';

// two rooms back to back: a (x −3 … 0) and b (x 0.15 … 3.15), the shared wall between them
const roomA = (extra = {}) => ({ id: 'a', floor: 0, x: -1.5, z: 0, width: 3, depth: 4, wallHeight: 3, doors: [], windows: [], ...extra });
const roomB = (extra = {}) => ({ id: 'b', floor: 0, x: 1.65, z: 0, width: 3, depth: 4, wallHeight: 3, doors: [], windows: [], ...extra });

/** Rooms with a door placed from `from` through the shared wall, as Studio places it. */
function shared(style, from = 'a') {
  const rooms = [roomA(), roomB()];
  const room = rooms.find((r) => r.id === from);
  const wall = from === 'a' ? 'east' : 'west';
  const plan = planOpening(rooms, room, wall, { x: from === 'a' ? 0 : 0.15, z: 0.5 }, 'door', style);
  expect(plan.problem).toBeNull();
  for (const o of plan.list) {
    const r = rooms.find((x) => x.id === o.roomId);
    const { roomId, kind, ...rec } = o;
    r.doors.push(rec);
  }
  return rooms;
}

describe('one door per doorway (A3)', () => {
  it('a door in a shared wall is ONE door, drawn by one room', () => {
    const rooms = shared('wood');
    expect(rooms[0].doors).toHaveLength(1);
    expect(rooms[1].doors).toHaveLength(1);
    const doors = floorDoors(rooms, 0);
    expect(doors).toHaveLength(1);
    expect(doors[0].otherRoomId).toBe('b');
    expect(doors[0].centre.x).toBeCloseTo(0.075, 5); // on the shared wall's centre line
    expect([drawsDoor(rooms, rooms[0], 0), drawsDoor(rooms, rooms[1], 0)].filter(Boolean)).toHaveLength(1);
  });

  it("an emergency exit swings OUT of the room it was placed from, even when the neighbour's id sorts first", () => {
    const rooms = shared('exit', 'b'); // b places it; a builds the shared wall (its id sorts first)
    const d = doorOf(rooms, rooms[0], 0);
    expect(d.roomId).toBe('b');
    expect(d.swing).toBe('out');
    expect(d.side).toEqual({ x: -1, z: 0 }); // out of b (b is east of the wall): towards −x
    expect(doorOf(rooms, rooms[1], 0).key).toBe(d.key);
  });

  it('a plain door opens into the room whose id sorts first; on its own wall into its room', () => {
    const rooms = shared('glass', 'b');
    expect(doorOf(rooms, rooms[1], 0).roomId).toBe('a');
    expect(doorOf(rooms, rooms[1], 0).side).toEqual({ x: -1, z: 0 }); // into a
    const lone = roomA({ doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
    expect(doorOf([lone], lone, 0).side).toEqual({ x: 0, z: 1 });
  });

  it('Plan view draws the same swing as the 3D leaves: once, out of the room for an exit', () => {
    const rooms = shared('exit', 'b');
    const fromA = roomWallPieces(rooms[0], rooms);
    const fromB = roomWallPieces(rooms[1], rooms);
    expect(fromA.doors).toHaveLength(0);
    expect(fromB.doors).toHaveLength(1);
    const arc = fromB.doors[0];
    expect(arc.open.x).toBeLessThan(arc.hinge.x); // swung into a, out of b
    // the 3D leaf fully open points the same way
    const d = doorOf(rooms, rooms[1], 0);
    const leaf = doorParts(d, 1).find((p) => p.part === 'steel');
    expect(leaf.x).toBeLessThan(d.centre.x);
  });

  it('a double door has two leaves from the middle; a sliding door slides along the wall', () => {
    const lone = roomA({ width: 6, doors: [{ wall: 'south', offset: 0, width: 1.8, height: 2.1, style: 'double-glass' }] });
    const d = doorOf([lone], lone, 0);
    expect(leafLines(d, 1)).toHaveLength(2);
    expect(doorParts(d, 0).filter((p) => p.part === 'glass')).toHaveLength(2);
    const slide = roomA({ width: 6, doors: [{ wall: 'south', offset: 0, width: 1.8, height: 2.1, style: 'sliding-glass' }] });
    const s = doorOf([slide], slide, 0);
    const shut = doorParts(s, 0).filter((p) => p.part === 'glass');
    const open = doorParts(s, 1).filter((p) => p.part === 'glass');
    expect(shut.map((p) => p.z)).toEqual(open.map((p) => p.z)); // along the wall, never into the doorway
    expect(Math.abs(open[0].x - shut[0].x)).toBeGreaterThan(0.8); // slid a panel's width
    expect(Math.min(...open.map((p) => Math.abs(p.x - s.centre.x)))).toBeGreaterThan(0.8); // the doorway clear
  });

  it('a wooden leaf shut lies in the wall, open stands across it on the swing side', () => {
    const lone = roomA({ doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
    const d = doorOf([lone], lone, 0);
    const shut = doorParts(d, 0).find((p) => p.part === 'wood');
    const open = doorParts(d, 1).find((p) => p.part === 'wood');
    expect(shut.rotY).toBeCloseTo(0, 5);
    expect(Math.abs(open.rotY)).toBeCloseTo(Math.PI / 2, 5);
    expect(open.z).toBeGreaterThan(d.centre.z + 0.3); // into the room (south wall: +z)
  });
});

describe('who opens a door (A5)', () => {
  const lone = roomA({ width: 20, doors: [0, 3, 6, 9, 12, 15].map((u) => ({ wall: 'south', offset: u - 8, width: 1, height: 2.1 })) });
  const doors = floorDoors([lone], 0);
  const at = (d, dz = -0.8) => ({ x: d.centre.x, z: d.centre.z + dz });
  const run = (anim, people, seconds) => { let open; for (let t = 0; t < seconds; t += 0.05) open = anim.update(0.05, doors, people); return open; };

  it('nobody moving: no door opens, however many people stand around (seated people are never passed)', () => {
    const anim = createDoorAnimator();
    const still = doors.map((d, i) => ({ id: `p${i}`, ...at(d), floor: 0 }));
    expect(run(anim, still, 2).size).toBe(0);
    expect(anim.animated).toBe(0);
  });

  it('a walker coming near opens it, it closes behind them', () => {
    const anim = createDoorAnimator();
    const d = doors[0];
    let open;
    for (let t = 0, z = d.centre.z - 4; t < 3; t += 0.05, z += 0.05) open = anim.update(0.05, doors, [{ id: 'me', x: d.centre.x, z, floor: 0, local: true }]);
    expect(open.get(d.key)).toBe(1);
    // walked on, 5 m past it: shut again after CLOSE_AFTER_S + OPEN_TIME_S
    const far = { id: 'me', x: d.centre.x, z: d.centre.z + 5, floor: 0, local: true };
    expect(run(anim, [far], CLOSE_AFTER_S + OPEN_TIME_S + 0.2).has(d.key)).toBe(false);
  });

  it('someone stopping in an open doorway holds it open', () => {
    const anim = createDoorAnimator();
    const d = doors[0];
    for (let t = 0, z = d.centre.z - 2; t < 2; t += 0.05, z = Math.min(d.centre.z, z + 0.05)) {
      anim.update(0.05, doors, [{ id: 'me', x: d.centre.x, z, floor: 0 }]);
    }
    expect(nearDoor(d, { x: d.centre.x, z: d.centre.z }).inDoorway).toBe(true);
    const open = run(anim, [{ id: 'me', x: d.centre.x, z: d.centre.z, floor: 0 }], 5);
    expect(open.get(d.key)).toBe(1);
  });

  it(`never more than ${MAX_ANIMATED_DOORS} doors at once, the walker's first; someone upstairs opens nothing here`, () => {
    const anim = createDoorAnimator();
    const step = () => doors.map((d, i) => ({ id: `p${i}`, x: d.centre.x, z: d.centre.z - 1 + 0.1 * i, floor: 0, local: i === 5, speed: 1.2 }));
    let open;
    for (let k = 0; k < 40; k++) {
      open = anim.update(0.05, doors, [...step(), { id: 'up', x: doors[0].centre.x, z: doors[0].centre.z, floor: 1, speed: 1.2 }]);
      expect(anim.animated).toBeLessThanOrEqual(MAX_ANIMATED_DOORS);
    }
    expect(open.size).toBe(MAX_ANIMATED_DOORS);
    expect(open.get(doors[5].key)).toBe(1);
  });

  it(`a mover only opens doors within ${OPEN_RADIUS} m`, () => {
    const anim = createDoorAnimator();
    const d = doors[0];
    const open = run(anim, [{ id: 'me', x: d.centre.x, z: d.centre.z - OPEN_RADIUS - 0.4, floor: 0, speed: 1.2 }], 1);
    expect(open.size).toBe(0);
  });
});
