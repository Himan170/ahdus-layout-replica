/**
 * play/lifts.js (v0.18.3)
 *
 * PURE: lifts. A lift is not saved as such: it is the LIFT rooms (lift shafts) that share one rectangle on
 * different floors (within LIFT_MATCH m); the floors it serves are the floors that have one. Nothing else is
 * saved (like shared walls), so nothing can get out of step. Used by LiftSystem (the car, its doors, the
 * call buttons), routes (floorLinks: kind 'lift'), Find (the Lift facility), Check and Studio's Lift stops.
 * No Babylon. Tests: play/__tests__/lifts.test.js.
 */

import { elevationOf, floorsInOrder } from './building';
import { WALK_SPEED } from './speeds';

/** The room type of a lift shaft. */
export const LIFT_TYPE = 'LIFT';
/** Two shafts are one lift when their rectangles differ by at most this (m). */
export const LIFT_MATCH = 0.05;
/** A new lift shaft (m): the car inside is a little smaller. */
export const LIFT_SIZE = { width: 2.2, depth: 2.2 };
/** Its door: on the −Z side, 1.1 m wide. */
export const LIFT_DOOR = { wall: 'south', offset: 0, width: 1.1, height: 2.1 };
/** Riding: per floor travelled, doors opening / closing, waiting for the car (s). */
export const LIFT_FLOOR_SECONDS = 2.5;
export const LIFT_DOOR_SECONDS = 1;
export const LIFT_WAIT_SECONDS = 5;

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const isLift = (r) => r && String(r.type ?? '').toUpperCase() === LIFT_TYPE;
const same = (a, b) => Math.abs(a.x - b.x) <= LIFT_MATCH && Math.abs(a.z - b.z) <= LIFT_MATCH
  && Math.abs(a.width - b.width) <= LIFT_MATCH && Math.abs(a.depth - b.depth) <= LIFT_MATCH;

/**
 * The lifts of a layout: [{ id, rooms: { [floor]: room }, floors: [ids in order], x, z, width, depth }].
 * id = the id of the shaft on its lowest floor (stable while that one stays). A floor with two matching shafts
 * keeps the first. Lifts in the order of their lowest shaft's id.
 */
export function liftsOf(rooms, floors) {
  const shafts = list(rooms).filter(isLift).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const order = floorOrder(floors, shafts);
  const groups = [];
  for (const r of shafts) {
    const g = groups.find((x) => same(x.ref, r));
    if (!g) groups.push({ ref: r, rooms: { [r.floor ?? 0]: r } });
    else if (!g.rooms[r.floor ?? 0]) g.rooms[r.floor ?? 0] = r;
  }
  return groups.map((g) => {
    const fl = Object.keys(g.rooms).map(Number).sort((a, b) => order(a) - order(b));
    const low = g.rooms[fl[0]];
    return { id: low.id, rooms: g.rooms, floors: fl, x: low.x, z: low.z, width: low.width, depth: low.depth };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Floor order (stacked in id order, as building.js): index of a floor id. */
function floorOrder(floors, shafts) {
  const ids = floors ? floorsInOrder(floors).map((f) => f.id) : [...new Set(shafts.map((r) => r.floor ?? 0))].sort((a, b) => a - b);
  return (id) => { const i = ids.indexOf(id); return i < 0 ? id : i; };
}

/** The lift a room is a shaft of (null: not a lift shaft). */
export function liftOfRoom(rooms, floors, room) {
  if (!isLift(room)) return null;
  return liftsOf(rooms, floors).find((l) => l.rooms[room.floor ?? 0]?.id === room.id) ?? null;
}

/** Where you stand in the car (world x, z): its middle. */
export function carSpot(lift) {
  return { x: lift.x, z: lift.z };
}

/** How long a ride between two floors takes (s), waiting for the car included. */
export function rideSeconds(lift, fromFloor, toFloor) {
  const a = lift.floors.indexOf(fromFloor);
  const b = lift.floors.indexOf(toFloor);
  const n = a < 0 || b < 0 ? 1 : Math.abs(a - b);
  return LIFT_WAIT_SECONDS + 2 * LIFT_DOOR_SECONDS + n * LIFT_FLOOR_SECONDS;
}

/** A route link's cost for a ride (m of walking: the time × the walking speed). */
export function rideCost(lift, fromFloor, toFloor) {
  return rideSeconds(lift, fromFloor, toFloor) * WALK_SPEED;
}

/** Vertical distance of a ride (m, world). */
export function rideRise(floors, fromFloor, toFloor) {
  return Math.abs(elevationOf(floors, toFloor) - elevationOf(floors, fromFloor));
}

/**
 * Studio's "Lift stops": the rooms to add / remove so that the lift of `shaft` stops at exactly `stops`
 * (floor ids). A new shaft copies the rectangle, the wall height (none: the floor's) and the door(s) of the
 * shaft it starts from. At least one stop stays (null: `stops` is empty or no floor of it exists).
 * @returns {{ add: object[], remove: string[] } | null}
 */
export function planLiftStops(rooms, floors, shaft, stops, newId) {
  const lift = liftOfRoom(rooms, floors, shaft);
  if (!lift) return null;
  const want = [...new Set((stops ?? []).map(Number))].filter((f) => floors?.[f]);
  if (!want.length) return null;
  const add = [];
  for (const f of want) {
    if (lift.rooms[f]) continue;
    add.push({
      id: newId(), type: LIFT_TYPE, name: shaft.name || 'Lift', floor: f,
      x: lift.x, z: lift.z, width: lift.width, depth: lift.depth,
      ...(shaft.wallThickness !== undefined ? { wallThickness: shaft.wallThickness } : {}),
      doors: (shaft.doors ?? []).map((d) => ({ ...d })), windows: [],
    });
  }
  const remove = lift.floors.filter((f) => !want.includes(f)).map((f) => lift.rooms[f].id);
  return { add, remove };
}

/**
 * Check my layout's lift problems: a lift that skips a floor between its stops (LIFT_GAP), a floor with
 * rooms that no lift stops at while the building has one (LIFT_FLOOR_NOT_SERVED), a shaft with no door
 * (LIFT_NO_DOOR). [{ code, floor, roomId, liftId, text, severity }]
 */
export function liftProblems(rooms, floors) {
  const lifts = liftsOf(rooms, floors);
  if (!lifts.length) return [];
  const ids = floorsInOrder(floors).map((f) => f.id);
  const out = [];
  const name = (f) => floors[f]?.name ?? `Floor ${f}`;
  for (const l of lifts) {
    const i0 = ids.indexOf(l.floors[0]);
    const i1 = ids.indexOf(l.floors.at(-1));
    for (let i = i0 + 1; i < i1; i++) {
      if (!l.rooms[ids[i]]) {
        out.push({ code: 'LIFT_GAP', floor: ids[i], liftId: l.id, roomId: l.id, severity: 'warning',
          text: `The lift skips ${name(ids[i])}` });
      }
    }
    for (const f of l.floors) {
      const r = l.rooms[f];
      if (!(r.doors ?? []).length) {
        out.push({ code: 'LIFT_NO_DOOR', floor: f, liftId: l.id, roomId: r.id, severity: 'error',
          text: `The lift shaft on ${name(f)} has no door` });
      }
    }
  }
  const served = new Set(lifts.flatMap((l) => l.floors));
  const roomsOn = (f) => list(rooms).some((r) => (r.floor ?? 0) === f && !isLift(r));
  for (const f of ids) {
    if (served.has(f) || !roomsOn(f)) continue;
    if (out.some((p) => p.code === 'LIFT_GAP' && p.floor === f)) continue; // said once
    out.push({ code: 'LIFT_FLOOR_NOT_SERVED', floor: f, liftId: lifts[0].id, roomId: lifts[0].id, severity: 'warning',
      text: `No lift stops at ${name(f)}` });
  }
  return out;
}

// ── The car and the call button (LiftSystem draws these boxes) ─────────────

const OUT = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** Car panels: this high (m, at most the shaft's wall height less 0.1). */
export const CAR_HEIGHT = 2.4;
/** The call button panel: this far beside the door's edge (m), at this height. */
export const CALL_BESIDE = 0.25;
export const CALL_HEIGHT = 1.1;

/**
 * The boxes of a lift on each floor it serves: [{ floor, roomId, part: 'steel' | 'metal' | 'light', role,
 * x, y, z, w, h, d }] (centre, y floor-relative, axis-aligned: w along X, d along Z). The car: a back panel on
 * the wall opposite its door, two side panels, a handrail, a ceiling light; outside: the call button panel
 * beside the door (role 'call', on the corridor side). A shaft with no door: the back panel on its north wall
 * and no call button.
 */
export function liftParts(lift) {
  const out = [];
  for (const f of lift.floors) {
    const r = lift.rooms[f];
    const t = Number.isFinite(r.wallThickness) ? r.wallThickness : 0.15;
    const hx = r.width / 2 - t / 2 - 0.03;
    const hz = r.depth / 2 - t / 2 - 0.03;
    const top = Math.min(CAR_HEIGHT, (r.wallHeight ?? 3.2) - 0.1);
    const door = (r.doors ?? [])[0];
    const doorWall = door?.wall ?? 'south';
    const back = OPPOSITE[doorWall];
    const push = (part, role, x, y, z, w, h, d) => out.push({ floor: f, roomId: r.id, part, role, x, y, z, w, h, d });
    const PANEL = 0.04;
    for (const wall of [back, ...(doorWall === 'north' || doorWall === 'south' ? ['east', 'west'] : ['north', 'south'])]) {
      const [ox, oz] = OUT[wall];
      const alongX = wall === 'north' || wall === 'south';
      const x = r.x + ox * (hx - PANEL / 2);
      const z = r.z + oz * (hz - PANEL / 2);
      push('steel', wall === back ? 'back' : 'side', x, top / 2, z, alongX ? 2 * hx : PANEL, top, alongX ? PANEL : 2 * hz);
      if (wall === back) {
        const rx = r.x + ox * (hx - 0.08);
        const rz = r.z + oz * (hz - 0.08);
        push('metal', 'rail', rx, 0.95, rz, alongX ? 2 * hx - 0.3 : 0.04, 0.04, alongX ? 0.04 : 2 * hz - 0.3);
      }
    }
    push('light', 'light', r.x, top - 0.02, r.z, 2 * hx - 0.5, 0.03, 2 * hz - 0.5);
    if (door) {
      const [ox, oz] = OUT[doorWall];
      const alongX = doorWall === 'north' || doorWall === 'south';
      const beside = (door.offset ?? 0) + (door.width ?? 1) / 2 + CALL_BESIDE;
      const line = alongX ? r.z + oz * (r.depth / 2 + t / 2 + 0.015) : r.x + ox * (r.width / 2 + t / 2 + 0.015);
      const x = alongX ? r.x + beside : line;
      const z = alongX ? line : r.z + beside;
      push('metal', 'call', x, CALL_HEIGHT, z, alongX ? 0.12 : 0.03, 0.2, alongX ? 0.03 : 0.12);
    }
  }
  return out;
}

/** The lift whose car holds (x, z) on `floor` (inside a served shaft), or null. */
export function liftAt(lifts, floor, x, z) {
  return lifts.find((l) => {
    const r = l.rooms[floor];
    return r && Math.abs(x - r.x) <= r.width / 2 && Math.abs(z - r.z) <= r.depth / 2;
  }) ?? null;
}
