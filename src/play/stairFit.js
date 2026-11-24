/**
 * play/stairFit.js
 *
 * PURE (v0.17.4, "stairs that always work"): can a staircase be used where it stands, in plain
 * words (never coordinates), which floor is missing (Studio shades it), and the nearest spot in the
 * same room where it works (Studio's drop, Check's Fix it). Also the nearest spot for an item that
 * blocks a door.
 *
 *   stairFit(stair, layout, { catalog })        → { ok, problems: [{ code, text }], shade, room }
 *   stairProblems(stair, floors, rooms, extra)  → problems only (the Inspector, the message after placing)
 *   stairSpots(stair, layout, { catalog })      → a generator of { x, z, roomId }, nearest first
 *   findStairSpot(stair, layout, { catalog })   → the first of them, or null
 *   findItemSpot(item, layout, { catalog })     → { moves: [[id, { x, z, roomId }]] } | null
 *
 * A staircase needs STAIR_CLEAR (0.8 m) of free floor in front of its bottom step, in its own room,
 * and as much at the top landing, in the room it arrives in on the floor above: clear of walls (its
 * room's and those of the rooms beside or inside it) and of furniture. Its flight stays inside its
 * room, clear of furniture and of the space in front of every door (DOOR_CLEAR); the opening it cuts
 * in the floor above stays clear of furniture and of the doors there.
 *   NOWHERE     no floor above, or no room there where they arrive (building.stairNeedsRoomAbove)
 *   STICKS_OUT  the flight is not inside its room (or reaches into a wall)
 *   NO_STEP_ON  a wall closer than STAIR_CLEAR to the bottom step
 *   NO_LANDING  a wall closer than STAIR_CLEAR to the top step, on the floor above
 *   BLOCKS_DOOR the flight in front of a door, or the opening above in front of one
 *   IN_THE_WAY  furniture on the flight, at either end, or over the opening above
 * Layout = store shape (arrays or records, v1 field names). Shade = turned rectangles
 * { floor, x, z, hw, hd, rot } (play/turnedRect.js): the floor that is missing at either end.
 */

import { roomOpenings, openingCentre, wallThicknessOf } from './geometry';
import {
  floorAbove, rectContains, roomRect, stairSize, stairOpening, stairOpenings, stairNeedsRoomAbove, elevationOf,
  stairRects, stairEnds, alongEnd,
  STAIR_STEP_ON, DOOR_CLEAR, FLOOR_LIKE_TYPES, STAIRS_LEAD_NOWHERE,
} from './building';
import { itemFootprints, isSolidItem } from './navigation/walkMap';
import { deskSeat, isDesk } from './people';
import { rectsOverlap, farApart, boxOf, rectOfBox } from './turnedRect';

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (o) => o?.floor ?? o?.floorId ?? 0;

/** Free floor a staircase needs at its bottom step and at its top landing (m). */
export const STAIR_CLEAR = STAIR_STEP_ON;
/**
 * An item moved out of a door's way keeps this much floor free in front of it, on each side (m): more than
 * checkLayout's DOOR_FREE 0.5, so a body (0.64 m with its clearance) can walk up to the door from the side too.
 */
export const ITEM_DOOR_FREE = 1.0;
/** How the free floor is measured (m). */
const STEP = 0.05;
/** Edges this close count as touching, not overlapping (m). */
const TOL = 0.02;
/** Furniture must be this far into a zone to be in the way (m). */
const ITEM_TOL = 0.04;

const insideBox = (a, b, tol) => a.x0 >= b.x0 - tol && a.x1 <= b.x1 + tol && a.z0 >= b.z0 - tol && a.z1 <= b.z1 + tol;
const overlapsBox = (a, b, tol) => a.x0 < b.x1 - tol && a.x1 > b.x0 + tol && a.z0 < b.z1 - tol && a.z1 > b.z0 + tol;
const grow = (b, t) => ({ x0: b.x0 - t, x1: b.x1 + t, z0: b.z0 - t, z1: b.z1 + t });
const clip = (a, b) => ({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) });
const isEmpty = (b) => b.x1 - b.x0 <= 1e-6 || b.z1 - b.z0 <= 1e-6;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** A rectangle in the staircase's own frame (across: ±hw, along the climb: lz0 to lz1) as a turned rectangle. */
/**
 * A rectangle along one end of a flight (building.stairEnds' frame): from `d0` to `d1` metres along the way
 * you climb there (negative: in front of a bottom step), `hw` across. v0.18.3: an L's ends turn.
 */
function endRect(end, d0, d1, hw) {
  const c = alongEnd(end, (d0 + d1) / 2);
  return { x: c.x, z: c.z, hw, hd: (d1 - d0) / 2, rot: end.rot };
}


function localRect(stair, lz0, lz1, hw) {
  const r = stair.rotationY ?? 0;
  const lz = (lz0 + lz1) / 2;
  return { x: stair.x + lz * Math.sin(r), z: stair.z + lz * Math.cos(r), hw, hd: (lz1 - lz0) / 2, rot: r };
}

const innerBox = (room) => grow(roomRect(room), -wallThicknessOf(room) / 2);
const area = (r) => r.width * r.depth;
/** Does room a hold room b (b inside a's rectangle, a bigger)? */
const holds = (a, b) => a !== b && area(a) > area(b) && insideBox(roomRect(b), roomRect(a), TOL);
const innermostAt = (rooms, x, z) => rooms.filter((r) => rectContains(roomRect(r), x, z)).sort((a, b) => area(a) - area(b))[0] ?? null;
/**
 * The room a staircase stands in (v0.18.3): the innermost room holding the point that is not a lift shaft. A lift
 * shaft is never a staircase's room: stairs dropped over one belong to the room around it (the shaft is then a
 * room in their way, and stairSpots looks for a spot in that room, clear of it), not "stick out of" the shaft.
 */
export const stairRoomAt = (rooms, x, z) => innermostAt(rooms.filter((r) => String(r.type ?? '').toUpperCase() !== 'LIFT'), x, z);
const roomName = (room) => String(room?.name ?? '').trim() || 'their room';

/**
 * What the fit of one layout needs, made once: rooms, furniture and staircases per floor, doors per
 * room. `ignore` = item ids that are not obstacles (the staircase itself, or the items moved together).
 */
function fitContext(layout, catalog = {}) {
  const rooms = list(layout?.rooms);
  const objects = list(layout?.objects);
  const floors = layout?.floors ?? {};
  const byFloor = new Map();
  const floorData = (f) => {
    if (!byFloor.has(f)) {
      const items = [];
      const stairs = [];
      for (const o of objects) {
        if (floorOf(o) !== f) continue;
        if (o.assetType === 'STAIRCASE') {
          for (const rect of stairRects(o)) stairs.push({ obj: o, rect }); // an L: its two arms
          continue;
        }
        if (!isSolidItem(o, catalog) || FLOOR_LIKE_TYPES.has(o.assetType)) continue;
        const name = o.assetType === 'WALL_SEGMENT' ? 'A wall' : (String(o.label ?? '').trim() || catalog[o.assetType]?.label || 'An item');
        for (const rect of itemFootprints(o, catalog)) items.push({ obj: o, rect, name });
      }
      byFloor.set(f, { rooms: rooms.filter((r) => floorOf(r) === f), items, stairs, doors: new Map() });
    }
    return byFloor.get(f);
  };
  return { rooms, objects, floors, catalog, floorData };
}

/**
 * The floor in front of the doors of `room` (and of the doors of the rooms inside or beside it that
 * open into it), as boxes inside the room: `depth` deep on each side of the door's wall.
 */
function doorZones(ctx, f, room, depth = DOOR_CLEAR) {
  const data = ctx.floorData(f);
  const key = `${room.id}:${depth}`;
  if (data.doors.has(key)) return data.doors.get(key);
  const outer = grow(roomRect(room), 0.35);
  const inner = innerBox(room);
  const out = [];
  for (const r of data.rooms) {
    const T = wallThicknessOf(r) / 2;
    for (const o of roomOpenings(r)) {
      if (o.kind !== 'door') continue;
      const c = openingCentre(r, o.wall, o.offset);
      if (!rectContains(outer, c.x, c.z)) continue;
      const half = o.width / 2;
      const alongX = o.wall === 'north' || o.wall === 'south';
      const zone = alongX
        ? { x0: c.x - half, x1: c.x + half, z0: c.z - T - depth, z1: c.z + T + depth }
        : { x0: c.x - T - depth, x1: c.x + T + depth, z0: c.z - half, z1: c.z + half };
      const inside = clip(zone, inner);
      if (!isEmpty(inside)) out.push({ ...inside, room: r }); // whose door (v0.18.3: a lift shaft's, inside the room)
    }
  }
  data.doors.set(key, out);
  return out;
}

/** Is a box clear of walls, standing in `host` (null: outside every room)? Walls of the other rooms there count too. */
function wallsClear(ctx, f, box, host) {
  return wallBlocker(ctx, f, box, host) === null;
}

/** What stops `box` (on floor f, in room `host`): host itself (its walls), another room (its walls), or null. */
function wallBlocker(ctx, f, box, host) {
  if (host && !insideBox(box, innerBox(host), TOL)) return host;
  for (const r of ctx.floorData(f).rooms) {
    if (r === host || (host && holds(r, host))) continue;
    if (overlapsBox(box, grow(roomRect(r), wallThicknessOf(r) / 2), TOL)) return r;
  }
  return null;
}

/** The first piece of furniture (or other staircase) on floor f in a turned rectangle, or null. */
function blockerIn(ctx, f, rect, ignore) {
  const data = ctx.floorData(f);
  for (const it of data.items) {
    if (ignore.has(it.obj.id) || farApart(it.rect, rect)) continue;
    if (rectsOverlap(it.rect, rect, ITEM_TOL)) return it.name;
  }
  for (const s of data.stairs) {
    if (ignore.has(s.obj.id) || farApart(s.rect, rect)) continue;
    if (rectsOverlap(s.rect, rect, ITEM_TOL)) return 'Other stairs';
  }
  return null;
}

/**
 * How much of an end zone is free, from the step outwards: zoneAt(k) = the zone k m deep.
 * → { free, by: 'wall' | 'item' | null, item }
 */
function freeDepth(ctx, f, host, zoneAt, ignore) {
  const wallOk = (k) => wallsClear(ctx, f, boxOf(zoneAt(k)), host);
  const itemAt = (k) => blockerIn(ctx, f, zoneAt(k), ignore);
  const full = { wall: wallOk(STAIR_CLEAR), item: itemAt(STAIR_CLEAR) };
  if (full.wall && !full.item) return { free: STAIR_CLEAR, by: null, item: null };
  let free = 0;
  for (let n = Math.round(STAIR_CLEAR / STEP) - 1; n > 0; n -= 1) {
    const k = n * STEP;
    if (wallOk(k) && !itemAt(k)) { free = k; break; }
  }
  // a wall that close wins: moving the furniture would not be enough
  return full.wall ? { free, by: 'item', item: full.item } : { free, by: 'wall', item: null };
}

/** The fit of one staircase, with a context made once (fitContext). */
function fitWith(ctx, stair) {
  const f = floorOf(stair);
  const ignore = new Set([stair.id]);
  const { width, length } = stairSize(stair);
  const ends = stairEnds(stair, { width, length });
  const WB = ends.bottom.hw; // half the flight's width at each end (an L's ends turn, v0.18.3)
  const WT = ends.top.hw;
  const problems = [];
  const shade = [];
  const have = new Set();
  const add = (code, text) => { if (!have.has(code)) { have.add(code); problems.push({ code, text }); } };
  const above = floorAbove(ctx.floors, f);
  const aboveName = above?.name || 'the floor above';

  // ── where they arrive ──
  // (a room above that holds the top step, with its wall right there: "no room to step off", not "build a room")
  const topEnd = endRect(ends.top, -0.05, -0.05, 0);
  const againstWall = above && stairNeedsRoomAbove(stair, ctx.floors, ctx.rooms) &&
    !!stairRoomAt(ctx.floorData(above.id).rooms, topEnd.x, topEnd.z);
  const nowhere = !againstWall && stairNeedsRoomAbove(stair, ctx.floors, ctx.rooms);
  if (nowhere) {
    add('NOWHERE', above
      ? `${STAIRS_LEAD_NOWHERE}: build a room on ${aboveName} where they arrive`
      : `${STAIRS_LEAD_NOWHERE}: there is no floor above. Add one, with a room where they arrive`);
    if (above) shade.push({ floor: above.id, ...endRect(ends.top, 0, STAIR_CLEAR, WT) });
  }

  // ── its own room, on its floor ──
  const room = stairRoomAt(ctx.floorData(f).rooms, stair.x, stair.z);
  const name = roomName(room);
  const flights = stairRects(stair, { width, length });
  // v0.18.6: each arm on its own (an L's empty corner is floor, not stairs: a room may stand there)
  const wall = room ? flights.map((fl) => wallBlocker(ctx, f, boxOf(fl), room)).find(Boolean) ?? null : null;
  if (wall) {
    // its own room's walls, or a room inside it (a lift shaft, a cabin) standing where the stairs go
    add('STICKS_OUT', wall === room ? `The stairs stick out of ${name}` : `The stairs run into ${roomName(wall)}`);
  } else {
    const bottom = freeDepth(ctx, f, room, (k) => endRect(ends.bottom, -k, 0, WB), ignore);
    if (bottom.free < STAIR_CLEAR) {
      shade.push({ floor: f, ...endRect(ends.bottom, -STAIR_CLEAR, -bottom.free, WB) });
      if (bottom.by === 'wall') {
        add('NO_STEP_ON', `The stairs are too close to the wall${room ? ` of ${name}` : ''}: there is no room to step onto them`);
      } else {
        add('IN_THE_WAY', `${bottom.item} is in the way at the bottom of the stairs`);
      }
    }
  }
  if (room) {
    const door = doorZones(ctx, f, room).find((z) => flights.some((fl) => overlapsBox(boxOf(fl), z, TOL)));
    if (door) {
      add('BLOCKS_DOOR', door.room && door.room !== room ? `The stairs block the door of ${roomName(door.room)}` : `The stairs block a door of ${name}`);
      shade.push({ floor: f, ...rectOfBox(door) });
    }
  }
  const onFlight = flights.map((fl) => blockerIn(ctx, f, fl, ignore)).find(Boolean);
  if (onFlight) add('IN_THE_WAY', `${onFlight} stands on the stairs`);

  // ── the floor above: the landing and the opening ──
  if (above && !nowhere) {
    const arrive = endRect(ends.top, 0.6, 0.6, 0); // building.stairTop
    const landingRoom = stairRoomAt(ctx.floorData(above.id).rooms, arrive.x, arrive.z)
      ?? stairRoomAt(ctx.floorData(above.id).rooms, topEnd.x, topEnd.z);
    const top = freeDepth(ctx, above.id, landingRoom, (k) => endRect(ends.top, 0, k, WT), ignore);
    if (top.free < STAIR_CLEAR) {
      shade.push({ floor: above.id, ...endRect(ends.top, top.free, STAIR_CLEAR, WT) });
      if (top.by === 'wall') {
        add('NO_LANDING', `The stairs end too close to a wall on ${aboveName}: there is no room to step off at the top`);
      } else {
        add('IN_THE_WAY', `${top.item} on ${aboveName} is in the way at the top of the stairs`);
      }
    }
  }
  if (above) {
    const holes = stairOpenings(stair, { width, length }, 0.05);
    const holeRoom = stairRoomAt(ctx.floorData(above.id).rooms, stair.x, stair.z);
    const door = holeRoom && doorZones(ctx, above.id, holeRoom).find((z) => holes.some((hole) => overlapsBox(hole, z, TOL)));
    if (door) {
      add('BLOCKS_DOOR', `The opening for the stairs on ${aboveName} is in front of a door`);
      shade.push({ floor: above.id, ...rectOfBox(door) });
    }
    const over = holes.map((hole) => blockerIn(ctx, above.id, rectOfBox(hole), ignore)).find(Boolean);
    if (over) add('IN_THE_WAY', `${over} on ${aboveName} stands over the opening for the stairs`);
  }
  return { ok: problems.length === 0, problems, shade, room };
}

/**
 * Can this staircase be used where it stands?
 * @param {object} stair  { id?, x, z, rotationY, floor, scaleX?, scaleZ? }
 * @param {{ rooms, objects?, floors }} layout
 * @param {{ catalog?: object }} [options]
 */
export function stairFit(stair, layout, { catalog } = {}) {
  return fitWith(fitContext(layout, catalog), stair);
}

/**
 * What Studio shows while a staircase is placed or dragged: ok, the first problem's words, and the
 * floor it misses as red patches at world height (`zones`: { x, y, z, hw, hd, rot }).
 */
export function stairPreview(stair, layout, { catalog } = {}) {
  const fit = stairFit(stair, layout, { catalog });
  const floors = layout?.floors ?? {};
  return {
    ok: fit.ok,
    text: fit.problems[0]?.text ?? null,
    zones: fit.shade.map((s) => ({ ...s, y: elevationOf(floors, s.floor) })),
  };
}

/** Only the problems (`extra.objects`: furniture counts too). The Inspector and the message after placing. */
export function stairProblems(stair, floors, rooms, { objects = [], catalog } = {}) {
  return stairFit(stair, { floors, rooms, objects }, { catalog }).problems;
}

/**
 * How near (m) a side of a staircase snaps flush to a wall when it is placed, dragged, moved by the arrow keys or the
 * move arrows, or turned (v0.18.8: 0.5, was 0.35; Himan's L stood 0.2–0.3 m off two walls). Hold Alt for none.
 */
export const STAIR_WALL_SNAP = 0.5;

/** The axis-aligned box around a staircase as drawn and walked (an L: both arms, never the straight 1.2 × 4 m one). */
export function stairBox(stair) {
  return stairRects(stair).map(boxOf).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
  }));
}

const quarterTurned = (rot) => Math.abs((rot ?? 0) - Math.round((rot ?? 0) / (Math.PI / 2)) * (Math.PI / 2)) <= 1e-3;

/**
 * v0.18.6 (audit 4a), v0.18.8: a SIDE of a staircase (never an end: those need STAIR_CLEAR of floor) within
 * `tolerance` of a wall's face goes flush against it: no overlap, no gap. The walls: its room's inner faces (its wall
 * thickness counted), the outer faces of the rooms inside that room, and Wall-tool walls (`objects`' WALL_SEGMENTs,
 * their size from `catalog`)
 * along X / Z. Its outline is its real one (stairRects: an L's two arms, the landing's outer sides included). Only for
 * stairs turned in quarter turns.
 *   motion: { x, z } of the move that brought it here (the arrow keys, the move arrows): an axis it moved along
 *           only snaps further the same way, never back (moving stairs AWAY from a wall leaves them there).
 * → { x, z, snapped: { x, z }, guides: [{ ax, az, bx, bz, kind: 'wall' }] } (dragSnap's guide lines along the faces).
 */
export function snapStairToWall(stair, rooms, { tolerance = STAIR_WALL_SNAP, motion = null, objects = [], catalog = {} } = {}) {
  const none = { x: stair.x, z: stair.z, snapped: { x: false, z: false }, guides: [] };
  if (!quarterTurned(stair.rotationY)) return none;
  const f = floorOf(stair);
  const here = list(rooms).filter((r) => floorOf(r) === f);
  const host = stairRoomAt(here, stair.x, stair.z);
  if (!host) return none;
  const box = stairBox(stair);
  const ends = stairEnds(stair);
  const isEnd = (axis, v) => [ends.bottom, ends.top].some((e) => Math.abs(e[axis] - v) < 0.02);
  const inner = innerBox(host);
  // what stands in its room: the rooms inside it (grown by half their wall) and Wall-tool walls, as boxes
  const solids = here.filter((r) => holds(host, r)).map((r) => grow(roomRect(r), wallThicknessOf(r) / 2));
  for (const o of list(objects)) {
    if (o?.assetType !== 'WALL_SEGMENT' || floorOf(o) !== f || !quarterTurned(o.rotationY)) continue;
    for (const r of itemFootprints(o, catalog)) {
      const b = boxOf(r);
      if (overlapsBox(b, inner, 0)) solids.push(b);
    }
  }
  const best = (axis) => {
    const lo = axis === 'x' ? 'x0' : 'z0';
    const hi = axis === 'x' ? 'x1' : 'z1';
    const across = axis === 'x' ? ['z0', 'z1'] : ['x0', 'x1'];
    const way = Math.sign(motion?.[axis] ?? 0);
    let move = null;
    const offer = (d, at, from, to) => {
      if (Math.abs(d) > tolerance + 1e-9) return;
      if (way !== 0 && Math.abs(d) > 1e-6 && Math.sign(d) !== way) return; // never back against the move
      if (move === null || Math.abs(d) < Math.abs(move.d)) move = { d, at, from, to };
    };
    const beside = (g) => g[across[0]] < box[across[1]] && g[across[1]] > box[across[0]];
    if (!isEnd(axis, box[lo])) {
      offer(inner[lo] - box[lo], inner[lo], inner[across[0]], inner[across[1]]);
      for (const g of solids) if (beside(g) && g[hi] <= box[lo] + tolerance) offer(g[hi] - box[lo], g[hi], g[across[0]], g[across[1]]);
    }
    if (!isEnd(axis, box[hi])) {
      offer(inner[hi] - box[hi], inner[hi], inner[across[0]], inner[across[1]]);
      for (const g of solids) if (beside(g) && g[lo] >= box[hi] - tolerance) offer(g[lo] - box[hi], g[lo], g[across[0]], g[across[1]]);
    }
    return move;
  };
  const mx = best('x');
  const mz = best('z');
  const guides = [];
  // the guide runs along the face, over the length of the stairs (and 0.4 m past them, within the wall)
  const span = (from, to, a, b) => [Math.max(from, a - 0.4), Math.min(to, b + 0.4)];
  if (mx) { const [a, b] = span(mx.from, mx.to, box.z0 + (mz?.d ?? 0), box.z1 + (mz?.d ?? 0)); guides.push({ ax: r3(mx.at), az: r3(a), bx: r3(mx.at), bz: r3(b), kind: 'wall' }); }
  if (mz) { const [a, b] = span(mz.from, mz.to, box.x0 + (mx?.d ?? 0), box.x1 + (mx?.d ?? 0)); guides.push({ ax: r3(a), az: r3(mz.at), bx: r3(b), bz: r3(mz.at), kind: 'wall' }); }
  return {
    x: mx ? r3(stair.x + mx.d) : stair.x,
    z: mz ? r3(stair.z + mz.d) : stair.z,
    snapped: { x: !!mx, z: !!mz },
    guides,
  };
}

/** v0.18.11: each band's sorted ring, made once (they never change; ~25,000 points sorted on every search before). */
const rings = new Map();
function ringOf(from, to, step) {
  const key = `${from}|${to}|${step}`;
  let ring = rings.get(key);
  if (!ring) {
    const n = Math.ceil(to / step);
    ring = [];
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const d = Math.hypot(i * step, j * step);
        if (d > from + 1e-9 && d <= to + 1e-9) ring.push(Object.freeze([i * step, j * step, d]));
      }
    }
    ring.sort((a, b) => a[2] - b[2] || Math.abs(a[1]) - Math.abs(b[1]));
    Object.freeze(ring);
    rings.set(key, ring);
  }
  return ring;
}

/** Offsets from (0, 0), nearest first: every 5 cm within 2 m, 10 cm within 6 m, 25 cm beyond (up to `radius`). */
function* offsets(radius) {
  const bands = [[0, 2, 0.05], [2, 6, 0.1], [6, radius, 0.25]];
  for (const [from, to, step] of bands) {
    if (to <= from) continue;
    yield* ringOf(from, to, step);
  }
}

/**
 * Spots where the staircase works, nearest first: same floor, same turn, its middle in the same
 * room (the innermost one holding it now; outside the rooms: outside them). The spot it stands on
 * comes first when it already works.
 * @param {{ catalog?: object, radius?: number }} [options]  radius: how far to look outside the rooms (m)
 */
export function* stairSpots(stair, layout, { catalog, radius = 12 } = {}) {
  const ctx = fitContext(layout, catalog);
  const f = floorOf(stair);
  const rooms = ctx.floorData(f).rooms;
  const room = stairRoomAt(rooms, stair.x, stair.z);
  const { width, length } = stairSize(stair);
  const half = boxOf(localRect(stair, -length / 2, length / 2, width / 2));
  const hx = (half.x1 - half.x0) / 2;
  const hz = (half.z1 - half.z0) / 2;
  const range = room ? grow(innerBox(room), 0) : grow({ x0: stair.x, x1: stair.x, z0: stair.z, z1: stair.z }, radius);
  const x0 = range.x0 + (room ? hx : 0);
  const x1 = range.x1 - (room ? hx : 0);
  const z0 = range.z0 + (room ? hz : 0);
  const z1 = range.z1 - (room ? hz : 0);
  if (x0 > x1 + TOL || z0 > z1 + TOL) return;
  const sameRoom = (x, z) => (stairRoomAt(rooms, x, z)?.id ?? null) === (room?.id ?? null);
  for (const [dx, dz] of [[0, 0], ...offsets(radius)]) {
    const x = r3(stair.x + dx);
    const z = r3(stair.z + dz);
    if (x < x0 - TOL || x > x1 + TOL || z < z0 - TOL || z > z1 + TOL || !sameRoom(x, z)) continue;
    if (fitWith(ctx, { ...stair, x, z }).ok) yield { x, z, roomId: room?.id ?? null };
  }
}

/** The nearest spot where the staircase works (stairSpots' first), or null when there is none in its room. */
export function findStairSpot(stair, layout, options = {}) {
  return stairSpots(stair, layout, options).next().value ?? null;
}

/** Items standing on `item` (a monitor on a desk): their foot near its top, their middle over it. */
function ridersOf(item, objects, catalog) {
  const top = (item.y ?? 0) + (catalog[item.assetType]?.defaultHeight ?? 1) * Math.abs(item.scaleY ?? 1);
  const rects = itemFootprints(item, catalog);
  return objects.filter((o) => o.id !== item.id && floorOf(o) === floorOf(item) && !o.isLocked &&
    Math.abs((o.y ?? 0) - top) < 0.15 && rects.some((r) => rectsOverlap(r, { x: o.x ?? 0, z: o.z ?? 0, hw: 0.01, hd: 0.01, rot: 0 })));
}

/**
 * The nearest spot for an item (and its chair, and what stands on it) where it blocks no door and no
 * stairs, inside its room, clear of the walls and of other furniture. Same floor, same turn.
 * v0.18.0: `members` = a whole saved group (a workstation cluster) moved together, with what stands on them.
 * @returns {{ moves: [string, { x, z, roomId }][] } | null}
 */
export function findItemSpot(item, layout, options = {}) {
  const steps = findItemSpotSteps(item, layout, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Spots tried per step (findItemSpotSteps). */
const SPOTS_PER_STEP = 50;

/**
 * findItemSpot in steps (v0.18.11): a generator that yields after its setup and every SPOTS_PER_STEP spots tried, and
 * returns the same answer. Check my layout's Fix it runs it in its idle slices (on a slow laptop one search was
 * one ~230 ms piece).
 */
export function* findItemSpotSteps(item, layout, { catalog = {}, radius = 8, members = null, clearance = 0 } = {}) {
  if (!item) return null;
  const ctx = fitContext(layout, catalog);
  const f = floorOf(item);
  const rooms = ctx.floorData(f).rooms;
  const objects = ctx.objects;
  const group = members ? [...members] : [item, ...ridersOf(item, objects, catalog)];
  if (members) {
    for (const m of members) for (const r of ridersOf(m, objects, catalog)) if (!group.some((g) => g.id === r.id)) group.push(r);
  }
  const chair = !members && isDesk(item.assetType) ? deskSeat(item, objects) : null;
  if (chair && !chair.isLocked && !group.includes(chair)) group.push(chair);
  const ignore = new Set(group.map((o) => o.id));
  const room = innermostAt(rooms, item.x ?? 0, item.z ?? 0);
  // floor that must stay free: in front of doors, the stairs and both their ends (from this floor, and arriving here)
  const doors = room ? doorZones(ctx, f, room, ITEM_DOOR_FREE) : [];
  const stairZones = [];
  for (const s of ctx.objects) {
    if (s.assetType !== 'STAIRCASE') continue;
    const { width, length } = stairSize(s);
    const ends = stairEnds(s, { width, length });
    if (floorOf(s) === f) {
      // the flight (an L: its arms) and the floor in front of its bottom step
      stairZones.push(...stairRects(s, { width, length }), endRect(ends.bottom, -STAIR_CLEAR, 0, ends.bottom.hw));
    } else if (floorAbove(ctx.floors, floorOf(s))?.id === f) {
      for (const hole of stairOpenings(s, { width, length }, 0.05)) stairZones.push(rectOfBox(hole));
      stairZones.push(endRect(ends.top, 0, STAIR_CLEAR, ends.top.hw));
    }
  }
  const solid = group.filter((o) => isSolidItem(o, catalog) && !FLOOR_LIKE_TYPES.has(o.assetType))
    .map((o) => ({ o, rects: itemFootprints(o, catalog) }));
  const fits = (dx, dz) => {
    for (const { rects } of solid) {
      for (const r0 of rects) {
        const r = { ...r0, x: r0.x + dx, z: r0.z + dz };
        const b = boxOf(r);
        // v0.18.0: `clearance` = room to walk round it (a cluster's aisle) from walls and other furniture
        const wide = clearance > 0 ? { ...r, hw: r.hw + clearance, hd: r.hd + clearance } : r;
        if (!wallsClear(ctx, f, clearance > 0 ? boxOf(wide) : b, room)) return false;
        if (doors.some((z) => overlapsBox(b, z, ITEM_TOL))) return false;
        if (stairZones.some((z) => !farApart(z, r) && rectsOverlap(z, r, ITEM_TOL))) return false;
        if (blockerIn(ctx, f, wide, ignore)) return false;
      }
    }
    return true;
  };
  const sameRoom = (x, z) => (innermostAt(rooms, x, z)?.id ?? null) === (room?.id ?? null);
  yield 'itemSpot';
  let tried = 0;
  for (const [dx, dz] of offsets(radius)) {
    if (++tried % SPOTS_PER_STEP === 0) yield 'itemSpot';
    if (!sameRoom((item.x ?? 0) + dx, (item.z ?? 0) + dz) || !fits(dx, dz)) continue;
    return {
      moves: group.map((o) => {
        const x = r3((o.x ?? 0) + dx);
        const z = r3((o.z ?? 0) + dz);
        return [o.id, { x, z, roomId: innermostAt(rooms, x, z)?.id ?? null }];
      }),
    };
  }
  return null;
}
