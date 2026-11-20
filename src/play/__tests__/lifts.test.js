import { describe, it, expect } from 'vitest';
import {
  liftsOf, liftOfRoom, carSpot, rideSeconds, rideCost, planLiftStops, liftProblems,
  liftParts, liftAt, liftFollow, misalignedShafts, LIFT_TYPE, LIFT_MATCH, LIFT_WAIT_SECONDS, LIFT_DOOR_SECONDS, LIFT_FLOOR_SECONDS,
} from '../lifts';
import { WALK_SPEED } from '../speeds';

const floors3 = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
  2: { id: 2, name: 'Floor 2', height: 3.5 },
};
const shaft = (id, floor, over = {}) => ({
  id, type: LIFT_TYPE, name: 'Lift', floor, x: 4, z: 2, width: 2.2, depth: 2.2,
  doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [], ...over,
});
const office = (id, floor) => ({ id, type: 'OFFICE', floor, x: 0, z: 0, width: 10, depth: 8, doors: [], windows: [] });

describe('lift shafts follow each other (v0.18.3)', () => {
  const hall = (id, floor) => ({ ...office(id, floor), width: 16, depth: 12 });
  const rooms = () => [hall('o0', 0), hall('o1', 1), hall('o2', 2), shaft('a', 0), shaft('b', 1), shaft('c', 2)];

  it('moved on one floor: the shafts on its other floors get the same move, with what is in them', () => {
    const plant = { id: 'p', assetType: 'PLANT_LARGE', floor: 2, x: 4.5, z: 2.5 };
    const f = liftFollow(shaft('b', 1), { x: 3, z: 2.5 }, rooms(), [plant], floors3);
    expect(f.problem).toBeNull();
    expect(Object.fromEntries(f.rooms)).toEqual({ a: { x: 3, z: 2.5 }, c: { x: 3, z: 2.5 } });
    expect(f.objects).toEqual([['p', { x: 3.5, z: 3 }]]);
  });

  it('resized: the others get the same size (their items stay)', () => {
    const plant = { id: 'p', assetType: 'PLANT_LARGE', floor: 0, x: 4.5, z: 2.5 };
    const f = liftFollow(shaft('a', 0), { width: 2.6 }, rooms(), [plant], floors3);
    expect(Object.fromEntries(f.rooms)).toEqual({ b: { width: 2.6 }, c: { width: 2.6 } });
    expect(f.objects).toEqual([]);
  });

  it('refused, with the floor named, when another shaft is locked or would leave its room', () => {
    const locked = rooms().map((r) => (r.id === 'c' ? { ...r, isLocked: true } : r));
    expect(liftFollow(shaft('a', 0), { x: 3 }, locked, [], floors3).problem).toBe('The lift shaft on Floor 2 is locked. Unlock it to change the lift');
    // upstairs the office is smaller: the shaft there would stick out of it
    const small = rooms().map((r) => (r.id === 'o2' ? { ...r, width: 10, x: -1.5 } : r));
    expect(liftFollow(shaft('a', 0), { x: 3.5 }, small, [], floors3).problem).toMatch(/^The lift shaft on Floor 2 would overlap/);
  });

  it('a room that is no lift shaft, or a lone shaft: nothing follows', () => {
    expect(liftFollow(hall('o0', 0), { x: 3 }, rooms(), [], floors3)).toEqual({ problem: null, rooms: [], objects: [] });
    expect(liftFollow(shaft('a', 0), { x: 3 }, [shaft('a', 0)], [], floors3).rooms).toEqual([]);
  });

  it('Check: shafts that overlap on other floors without lining up, once per pair, by their nearest floors', () => {
    const off = [shaft('a', 0), shaft('b', 1), shaft('c', 2, { x: 4.6 })];
    const p = misalignedShafts(off, floors3);
    expect(p).toEqual([expect.objectContaining({ code: 'LIFT_MISALIGNED', floor: 2, roomId: 'c', otherId: 'b', severity: 'warning',
      text: "The lift shafts on Floor 1 and Floor 2 don't line up" })]);
    expect(liftProblems(off, floors3).map((x) => x.code)).toContain('LIFT_MISALIGNED');
    // lined up, or far apart (two lifts): nothing
    expect(misalignedShafts([shaft('a', 0), shaft('b', 1), shaft('c', 2)], floors3)).toEqual([]);
    expect(misalignedShafts([shaft('a', 0), shaft('b', 1, { x: 9 })], floors3)).toEqual([]);
  });
});

describe('lifts (v0.18.3)', () => {
  it('shafts with one rectangle on several floors are one lift, its floors in order', () => {
    const rooms = [shaft('b', 2), shaft('a', 0), shaft('c', 1, { x: 4 + LIFT_MATCH / 2 })];
    const lifts = liftsOf(rooms, floors3);
    expect(lifts).toHaveLength(1);
    expect(lifts[0].id).toBe('a');
    expect(lifts[0].floors).toEqual([0, 1, 2]);
    expect(carSpot(lifts[0])).toEqual({ x: 4, z: 2 });
  });

  it('a shaft somewhere else is another lift; other rooms are no lift', () => {
    const rooms = [shaft('a', 0), shaft('b', 1, { x: 9 }), office('o', 0)];
    const lifts = liftsOf(rooms, floors3);
    expect(lifts.map((l) => l.floors)).toEqual([[0], [1]]);
    expect(liftOfRoom(rooms, floors3, rooms[2])).toBeNull();
    expect(liftOfRoom(rooms, floors3, rooms[1]).id).toBe('b');
  });

  it('a floor with two matching shafts keeps the first', () => {
    const lifts = liftsOf([shaft('a', 0), shaft('a2', 0), shaft('b', 1)], floors3);
    expect(lifts).toHaveLength(1);
    expect(lifts[0].rooms[0].id).toBe('a');
  });

  it('a ride takes the wait, the doors and each floor; its cost is that time walked', () => {
    const [lift] = liftsOf([shaft('a', 0), shaft('b', 1), shaft('c', 2)], floors3);
    const one = rideSeconds(lift, 0, 1);
    const two = rideSeconds(lift, 0, 2);
    expect(one).toBeCloseTo(LIFT_WAIT_SECONDS + 2 * LIFT_DOOR_SECONDS + LIFT_FLOOR_SECONDS);
    expect(two - one).toBeCloseTo(LIFT_FLOOR_SECONDS);
    expect(rideCost(lift, 2, 0)).toBeCloseTo(two * WALK_SPEED);
  });

  it('Lift stops adds the shaft (rectangle, doors) and removes it, never every stop', () => {
    const rooms = [shaft('a', 0), shaft('b', 1)];
    let n = 0;
    const plan = planLiftStops(rooms, floors3, rooms[0], [0, 2], () => `new${++n}`);
    expect(plan.remove).toEqual(['b']);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]).toMatchObject({ id: 'new1', type: LIFT_TYPE, floor: 2, x: 4, z: 2, width: 2.2, depth: 2.2 });
    expect(plan.add[0].doors).toEqual(rooms[0].doors);
    expect(plan.add[0].doors[0]).not.toBe(rooms[0].doors[0]);
    expect(planLiftStops(rooms, floors3, rooms[0], [], () => 'x')).toBeNull();
    expect(planLiftStops(rooms, floors3, office('o', 0), [0], () => 'x')).toBeNull();
    expect(planLiftStops(rooms, floors3, rooms[0], [7], () => 'x')).toBeNull();
  });

  it('Check: a skipped floor, a floor with no stop, a shaft with no door', () => {
    const rooms = [shaft('a', 0), shaft('c', 2, { doors: [] }), office('o0', 0), office('o1', 1), office('o2', 2)];
    const p = liftProblems(rooms, floors3);
    expect(p.map((x) => x.code).sort()).toEqual(['LIFT_GAP', 'LIFT_NO_DOOR']);
    expect(p.find((x) => x.code === 'LIFT_GAP')).toMatchObject({ floor: 1, text: 'The lift skips Floor 1' });
    expect(p.find((x) => x.code === 'LIFT_NO_DOOR')).toMatchObject({ floor: 2, roomId: 'c', severity: 'error' });

    const two = [shaft('a', 0), shaft('b', 1), office('o0', 0), office('o2', 2)];
    const q = liftProblems(two, floors3);
    expect(q).toEqual([expect.objectContaining({ code: 'LIFT_FLOOR_NOT_SERVED', floor: 2, text: "Floor 2 has no lift stop: people who can't use stairs can't get there" })]);
    // an empty floor needs no stop; no lift at all: nothing to say
    expect(liftProblems([shaft('a', 0), shaft('b', 1), office('o0', 0)], floors3)).toEqual([]);
    expect(liftProblems([office('o0', 0), office('o1', 1)], floors3)).toEqual([]);
  });

  it('the car: a back panel opposite the door, two sides, a rail, a light; the call button outside', () => {
    const [lift] = liftsOf([shaft('a', 0), shaft('b', 1)], floors3);
    const parts = liftParts(lift);
    expect(parts).toHaveLength(12);
    const f0 = parts.filter((p) => p.floor === 0);
    expect(f0.map((p) => p.role).sort()).toEqual(['back', 'call', 'light', 'rail', 'side', 'side']);
    const back = f0.find((p) => p.role === 'back');
    expect(back.z).toBeGreaterThan(2); // the door is on the south (−Z) side: the back on the north
    const call = f0.find((p) => p.role === 'call');
    expect(call.z).toBeLessThan(2 - 1.1); // outside the south wall
    expect(Math.abs(call.x - 4)).toBeGreaterThan(0.55); // beside the door, not in it
    // a door on the east wall: the back panel on the west
    const [east] = liftsOf([shaft('e', 0, { doors: [{ wall: 'east', offset: 0, width: 1.1, height: 2.1 }] })], floors3);
    expect(liftParts(east).find((p) => p.role === 'back').x).toBeLessThan(4);
  });

  it('liftAt: the lift whose car holds the point on that floor', () => {
    const lifts = liftsOf([shaft('a', 0), shaft('b', 1)], floors3);
    expect(liftAt(lifts, 0, 4.5, 2.5).id).toBe('a');
    expect(liftAt(lifts, 2, 4, 2)).toBeNull();
    expect(liftAt(lifts, 0, 8, 2)).toBeNull();
  });
});
