/**
 * doorSwing.js (v0.18.1, PURE: no Babylon): room doors with a leaf, the same everywhere.
 *
 * - `floorDoors(rooms, floorId)`: one entry per DOORWAY (a door in a shared wall has a record in each room: it is ONE
 *   door), with where it is, which way it opens and its type. Plan view, the PNG / PDF export and the 3D leaves
 *   (DoorSystem) all read the swing from here, so they agree.
 * - Which way: a record's `swing` 'out' = out of its own room, 'in' (or none) = into it. A shared doorway uses the
 *   record that says (an emergency exit placed from a room is 'out' there, 'in' on the neighbour's record), else
 *   the record of the room whose id sorts first.
 * - `doorParts(door, open)`: the boxes of the leaf / leaves at `open` (0 closed … 1 open): swing doors turn 90°
 *   about their hinge (a double door from the middle), a sliding door's two panels slide apart along the wall.
 * - `createDoorAnimator()`: which doors open. Only for people who MOVE (the walker, Take me there, the tour, live
 *   people walking), at most `MAX_ANIMATED_DOORS` at once (the walker's first, then the nearest), a door closes
 *   `CLOSE_AFTER_S` after the last mover left, and someone standing in an open doorway holds it open.
 *   Studio shows every door half open (`STUDIO_OPEN`), so editors see the swing.
 * The walk map, routes and Check never look at any of this: a doorway is always walkable.
 */

import { roomOpenings, openingPartner, wallThicknessOf, sharedWallThickness } from './geometry.js';
import { styleOf } from './openingStyles.js';

export const MAX_ANIMATED_DOORS = 4;
/** A mover this close to a doorway (to the door's line, within its width + this) opens it. */
export const OPEN_RADIUS = 1.5;
/** Someone in the doorway itself (this close to its line, within its width) holds an open door open. */
export const HOLD_RADIUS = 0.7;
/** Faster than this (m/s) = moving; slower = standing (they only HOLD a door that is open). */
export const MOVING_SPEED = 0.25;
/** Faster than this between two frames is a jump, not walking (running 4.5, flying 6 m/s). */
export const JUMP_SPEED = 12;
export const OPEN_TIME_S = 0.5;
export const CLOSE_AFTER_S = 1;
/** Studio: every door half open (45°, a sliding door half way). */
export const STUDIO_OPEN = 0.5;

/** The door frame's jamb (roomBuilder FRAME_W): the leaf fills the opening between the jambs. */
export const JAMB = 0.07;
export const LEAF_T = 0.045;
const GAP = 0.005;

const ALONG_X = { north: true, south: true, east: false, west: false };
const INWARD = { north: [0, -1], south: [0, 1], east: [-1, 0], west: [1, 0] };

function wallLineValue(room, wall) {
  if (wall === 'north') return room.z + room.depth / 2;
  if (wall === 'south') return room.z - room.depth / 2;
  if (wall === 'east') return room.x + room.width / 2;
  return room.x - room.width / 2;
}

/** The record a shared doorway's swing comes from: the one that says, else the room whose id sorts first. */
function canonical(a, b) {
  if (!b) return a;
  if (a.record.swing && !b.record.swing) return a;
  if (b.record.swing && !a.record.swing) return b;
  if (a.record.swing === 'out') return a;
  if (b.record.swing === 'out') return b;
  return String(a.room.id) <= String(b.room.id) ? a : b;
}

/**
 * One doorway of a room's door record: where it is in world x / z (floor-relative y).
 * `a` = the hinge end (the lower offset end of the record's room), `b` = the other end, `along` = a → b,
 * `side` = the way the leaf turns (into the room for 'in', out of it for 'out'), `line` = the wall's centre line.
 */
export function doorOf(rooms, room, index) {
  const record = (room.doors ?? [])[index];
  if (!record) return null;
  const o = roomOpenings(room).find((p) => p.kind === 'door' && p.index === index);
  if (!o) return null;
  const partner = openingPartner(rooms, room, 'door', index);
  const mine = { room, index, record };
  const theirs = partner ? { room: partner.room, index: partner.index, record: (partner.room.doors ?? [])[partner.index] } : null;
  const c = canonical(mine, theirs);
  const other = c === mine ? theirs : mine;
  const co = c === mine ? o : roomOpenings(c.room).find((p) => p.kind === 'door' && p.index === c.index);
  const wall = co.wall;
  const alongX = ALONG_X[wall];
  const lineOwn = wallLineValue(c.room, wall);
  const line = other ? (lineOwn + wallLineValue(other.room, otherWall(wall))) / 2 : lineOwn;
  const thickness = other ? sharedWallThickness(c.room, other.room) : wallThicknessOf(c.room);
  const centreU = (alongX ? c.room.x : c.room.z) + co.offset;
  const half = co.width / 2;
  const point = (u) => (alongX ? { x: u, z: line } : { x: line, z: u });
  const [ix, iz] = INWARD[wall];
  const out = c.record.swing === 'out';
  // v0.18.3: a lift shaft's door is the lift's (two steel panels sliding apart), whatever its record says
  const style = c.room.type === 'LIFT' || other?.room.type === 'LIFT' ? 'lift' : styleOf('door', c.record);
  return {
    key: `${c.room.id}:${c.index}`,
    roomId: c.room.id,
    index: c.index,
    otherRoomId: other?.room.id ?? null,
    floor: c.room.floor ?? 0,
    wall,
    style,
    swing: out ? 'out' : 'in',
    width: co.width,
    height: co.top,
    thickness,
    a: point(centreU - half),
    b: point(centreU + half),
    centre: point(centreU),
    along: alongX ? { x: 1, z: 0 } : { x: 0, z: 1 },
    side: out ? { x: -ix + 0, z: -iz + 0 } : { x: ix, z: iz }, // (+ 0: no −0)
  };
}

const otherWall = (w) => ({ north: 'south', south: 'north', east: 'west', west: 'east' })[w];

/** Every doorway on a floor, once (a shared door's two records are one entry). */
export function floorDoors(rooms, floorId) {
  const list = Object.values(rooms ?? {}).filter((r) => (r.floor ?? 0) === floorId);
  const seen = new Map();
  for (const room of list) {
    (room.doors ?? []).forEach((_, index) => {
      const d = doorOf(list, room, index);
      if (d && !seen.has(d.key)) seen.set(d.key, d);
    });
  }
  return [...seen.values()];
}

/** Every doorway of the layout, by floor id. */
export function layoutDoors(rooms) {
  const floors = new Set(Object.values(rooms ?? {}).map((r) => r.floor ?? 0));
  return [...floors].flatMap((f) => floorDoors(rooms, f));
}

/** Does this room draw the doorway (Plan view, the export)? The room its swing comes from does, once. */
export function drawsDoor(rooms, room, index) {
  const d = doorOf(rooms, room, index);
  return !d || d.roomId === room.id;
}

/** cos / sin of a leaf turned t × 90° (exact when shut or wide open). */
const turn = (t) => (t <= 0 ? [1, 0] : t >= 1 ? [0, 1] : [Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2)]);

/** The smoothstep of the open amount: how far the leaf has turned / slid. */
export const eased = (t) => { const v = Math.min(1, Math.max(0, t)); return v * v * (3 - 2 * v); };

/**
 * Leaves of a door: [{ hinge, dir (closed), width }]; a double door has two, meeting in the middle. In 3D they fill
 * the opening between the jambs; on a plan (`plan`) the whole opening, as plans draw doors.
 */
function leaves(door, plan = false) {
  const inset = plan ? 0 : JAMB + GAP;
  const span = door.width - 2 * inset;
  const { a, b, along } = door;
  const h0 = { x: a.x + along.x * inset, z: a.z + along.z * inset };
  if (door.style === 'double-glass') {
    const h1 = { x: b.x - along.x * inset, z: b.z - along.z * inset };
    const w = span / 2 - (plan ? 0 : GAP);
    return [{ hinge: h0, dir: { ...along }, width: w }, { hinge: h1, dir: { x: -along.x, z: -along.z }, width: w }];
  }
  return [{ hinge: h0, dir: { ...along }, width: span }];
}

/** The leaf's face sits on the swing side of the wall, so it turns clear of the jambs. */
function faceOffset(door) {
  return Math.max(0, door.thickness / 2 - LEAF_T / 2 - 0.01);
}

/**
 * Where a door's leaves are at `open` (0 … 1), on a plan: [{ from (hinge), to, closed (where `to` is when shut) }],
 * across the whole opening. Plan view and the export draw the open leaf (open = 1) and its arc; a sliding door's
 * panels stay along the wall.
 */
export function leafLines(door, open = 1) {
  const t = eased(open);
  if (door.style === 'sliding-glass' || door.style === 'lift') {
    return slidingPanels(door, open).map((p) => ({ from: p.from, to: p.to }));
  }
  const [cos, sin] = turn(t);
  return leaves(door, true).map(({ hinge, dir, width }) => {
    const d = { x: dir.x * cos + door.side.x * sin, z: dir.z * cos + door.side.z * sin };
    return { from: hinge, to: { x: hinge.x + d.x * width, z: hinge.z + d.z * width }, closed: { x: hinge.x + dir.x * width, z: hinge.z + dir.z * width } };
  });
}

/** A sliding door's two panels: each half the opening (+ a 5 cm overlap), sliding apart along the swing face. */
function slidingPanels(door, open) {
  const t = eased(open);
  const span = door.width - 2 * JAMB;
  const w = span / 2 + 0.025;
  const off = door.thickness / 2 + 0.03;
  const { along, side, centre } = door;
  const base = { x: centre.x + side.x * off, z: centre.z + side.z * off };
  return [-1, 1].map((s) => {
    const mid = (w / 2 - 0.0125 + t * w) * s;
    const c = { x: base.x + along.x * mid, z: base.z + along.z * mid };
    return { centre: c, width: w, from: { x: c.x - along.x * w / 2, z: c.z - along.z * w / 2 }, to: { x: c.x + along.x * w / 2, z: c.z + along.z * w / 2 } };
  });
}

/** Babylon's rotation.y that turns a box's local +X onto (dx, dz). */
const yawOf = (dx, dz) => Math.atan2(-dz, dx);

/**
 * The 3D boxes of a door at `open`: [{ part, x, y, z, w, h, d, rotY }] (centre, floor-relative y; w along the
 * leaf, d its thickness). part: 'wood' | 'steel' | 'glass' | 'metal' (DoorSystem's four materials).
 */
export function doorParts(door, open) {
  const top = door.height - JAMB - GAP;
  const boxes = [];
  const push = (part, c, y, w, h, d, rotY) => boxes.push({ part, x: c.x, y, z: c.z, w, h, d, rotY });
  if (door.style === 'sliding-glass') {
    const rot = yawOf(door.along.x, door.along.z);
    for (const p of slidingPanels(door, open)) {
      glassLeaf(push, p.centre, door.along, p.width, top, rot);
    }
    return boxes;
  }
  if (door.style === 'lift') {
    const rot = yawOf(door.along.x, door.along.z);
    for (const p of slidingPanels(door, open)) push('steel', p.centre, top / 2, p.width, top, LEAF_T, rot);
    return boxes;
  }
  const t = eased(open);
  const [cos, sin] = turn(t);
  const off = faceOffset(door);
  for (const leaf of leaves(door)) {
    const d = { x: leaf.dir.x * cos + door.side.x * sin, z: leaf.dir.z * cos + door.side.z * sin };
    const hinge = { x: leaf.hinge.x + door.side.x * off, z: leaf.hinge.z + door.side.z * off };
    const c = { x: hinge.x + d.x * leaf.width / 2, z: hinge.z + d.z * leaf.width / 2 };
    const rot = yawOf(d.x, d.z);
    const handleAt = { x: hinge.x + d.x * (leaf.width - 0.09), z: hinge.z + d.z * (leaf.width - 0.09) };
    if (door.style === 'glass' || door.style === 'double-glass') {
      glassLeaf(push, c, d, leaf.width, top, rot);
      push('metal', handleAt, 1.0, 0.03, 0.7, LEAF_T + 0.1, rot);
    } else if (door.style === 'exit') {
      push('steel', c, top / 2, leaf.width, top, LEAF_T, rot);
      // the push bar across it (both faces)
      push('metal', c, 1.0, leaf.width * 0.8, 0.06, LEAF_T + 0.12, rot);
    } else {
      push('wood', c, top / 2, leaf.width, top, LEAF_T, rot);
      push('metal', handleAt, 1.0, 0.12, 0.03, LEAF_T + 0.1, rot);
    }
  }
  return boxes;
}

/** A glass leaf: a metal frame (two stiles, top and bottom rails) and its pane. */
function glassLeaf(push, c, dir, width, top, rot) {
  const stile = 0.05;
  const rail = 0.1;
  const along = (u) => ({ x: c.x + dir.x * u, z: c.z + dir.z * u });
  push('metal', along(-width / 2 + stile / 2), top / 2, stile, top, LEAF_T, rot);
  push('metal', along(width / 2 - stile / 2), top / 2, stile, top, LEAF_T, rot);
  push('metal', c, rail / 2, width, rail, LEAF_T, rot);
  push('metal', c, top - stile / 2, width, stile, LEAF_T, rot);
  push('glass', c, (rail + top - stile) / 2, width - 2 * stile, top - rail - stile, 0.012, rot);
}

/** Distance from a point to a door's opening, and whether it is in the doorway itself. */
export function nearDoor(door, p) {
  const ux = door.along.x;
  const uz = door.along.z;
  const rx = p.x - door.centre.x;
  const rz = p.z - door.centre.z;
  const along = rx * ux + rz * uz;
  const across = Math.abs(rx * -uz + rz * ux);
  const beyond = Math.max(0, Math.abs(along) - door.width / 2);
  return { distance: Math.hypot(beyond, across), inDoorway: beyond === 0 && across <= HOLD_RADIUS };
}

/**
 * Which doors open, per frame. `update(dt, doors, people)` with people = [{ id, x, z, floor, local?, speed? }]
 * (only people who walk: never the seated ones; `speed` in m/s, else worked out from their last position).
 * Returns Map key → open amount (0 … 1) for every door that is not shut; the rest are closed.
 */
export function createDoorAnimator({ max = MAX_ANIMATED_DOORS, openTime = OPEN_TIME_S, closeAfter = CLOSE_AFTER_S } = {}) {
  const state = new Map(); // key → { open, wantedAgo }
  const last = new Map(); // person id → { x, z, speed }
  return {
    update(dt, doors, people) {
      const step = Math.max(0, Math.min(0.25, dt));
      const moving = [];
      const seen = new Set();
      for (const p of people ?? []) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        seen.add(p.id);
        const was = last.get(p.id);
        let speed = p.speed;
        if (!Number.isFinite(speed)) {
          const v = was && step > 0 ? Math.hypot(p.x - was.x, p.z - was.z) / step : 0;
          // faster than anyone walks, runs or flies = a jump (setPose, Back to entrance, a fade, a live snap): standing
          speed = !was || v > JUMP_SPEED ? 0 : was.speed + (v - was.speed) * Math.min(1, step / 0.2);
        }
        last.set(p.id, { x: p.x, z: p.z, speed });
        moving.push({ ...p, speed, moves: speed > MOVING_SPEED });
      }
      for (const id of [...last.keys()]) if (!seen.has(id)) last.delete(id);
      // wanted: a door near someone moving, or a door already open with someone in its doorway
      const want = [];
      for (const door of doors) {
        let best = null;
        for (const p of moving) {
          if (p.floor !== door.floor) continue;
          const n = nearDoor(door, p);
          const open = (state.get(door.key)?.open ?? 0) > 0;
          if ((p.moves && n.distance <= OPEN_RADIUS) || (open && n.inDoorway)) {
            const rank = (p.local ? 0 : 1000) + n.distance;
            if (!best || rank < best) best = rank;
          }
        }
        if (best != null) want.push({ door, rank: best });
      }
      want.sort((x, y) => x.rank - y.rank);
      const wanted = new Set(want.slice(0, max).map((w) => w.door.key));
      // a wanted door over the cap of doors not shut: the least open one that nobody wants snaps shut
      for (const key of wanted) {
        if (state.has(key)) continue;
        const busy = [...state.keys()];
        if (busy.length >= max) {
          const idle = busy.filter((k) => !wanted.has(k)).sort((p, q) => state.get(p).open - state.get(q).open)[0];
          if (idle == null) continue;
          state.delete(idle);
        }
        state.set(key, { open: 0, wantedAgo: 0 });
      }
      const keys = new Set(doors.map((d) => d.key));
      for (const [key, s] of state) {
        if (!keys.has(key)) { state.delete(key); continue; }
        s.wantedAgo = wanted.has(key) ? 0 : s.wantedAgo + step;
        const target = s.wantedAgo < closeAfter ? 1 : 0;
        s.open = target === 1 ? Math.min(1, s.open + step / openTime) : Math.max(0, s.open - step / openTime);
        if (s.open > 1 - 1e-6) s.open = 1;
        if (s.open < 1e-6) s.open = 0;
        if (s.open <= 0 && target === 0) state.delete(key);
      }
      return new Map([...state].map(([k, s]) => [k, s.open]));
    },
    /** Doors not shut now (opening, open or closing). */
    get animated() { return state.size; },
    reset() { state.clear(); last.clear(); },
  };
}
