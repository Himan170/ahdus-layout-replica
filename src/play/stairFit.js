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
  floorAbove, rectContains, roomRect, stairSize, stairOpening, stairNeedsRoomAbove, elevationOf,
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
          const { width, length } = stairSize(o);
          stairs.push({ obj: o, rect: localRect(o, -length / 2, length / 2, width / 2) });
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
      if (!isEmpty(inside)) out.push(inside);
    }
  }
  data.doors.set(key, out);
  return out;
}

/** Is a box clear of walls, standing in `host` (null: outside every room)? Walls of the other rooms there count too. */
function wallsClear(ctx, f, box, host) {
  if (host && !insideBox(box, innerBox(host), TOL)) return false;
  for (const r of ctx.floorData(f).rooms) {
    if (r === host || (host && holds(r, host))) continue;
    if (overlapsBox(box, grow(roomRect(r), wallThicknessOf(r) / 2), TOL)) return false;
  }
  return true;
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
  const W = width / 2;
  const L = length / 2;
  const problems = [];
  const shade = [];
  const have = new Set();
  const add = (code, text) => { if (!have.has(code)) { have.add(code); problems.push({ code, text }); } };
  const above = floorAbove(ctx.floors, f);
  const aboveName = above?.name || 'the floor above';

  // ── where they arrive ──
  // (a room above that holds the top step, with its wall right there: "no room to step off", not "build a room")
  const topEnd = localRect(stair, L - 0.05, L - 0.05, 0);
  const againstWall = above && stairNeedsRoomAbove(stair, ctx.floors, ctx.rooms) &&
    !!innermostAt(ctx.floorData(above.id).rooms, topEnd.x, topEnd.z);
  const nowhere = !againstWall && stairNeedsRoomAbove(stair, ctx.floors, ctx.rooms);
  if (nowhere) {
    add('NOWHERE', above
      ? `${STAIRS_LEAD_NOWHERE}: build a room on ${aboveName} where they arrive`
      : `${STAIRS_LEAD_NOWHERE}: there is no floor above. Add one, with a room where they arrive`);
    if (above) shade.push({ floor: above.id, ...localRect(stair, L, L + STAIR_CLEAR, W) });
  }

  // ── its own room, on its floor ──
  const room = innermostAt(ctx.floorData(f).rooms, stair.x, stair.z);
  const name = roomName(room);
  const flight = localRect(stair, -L, L, W);
  const flightBox = boxOf(flight);
  if (room && !wallsClear(ctx, f, flightBox, room)) {
    add('STICKS_OUT', `The stairs stick out of ${name}`);
  } else {
    const bottom = freeDepth(ctx, f, room, (k) => localRect(stair, -L - k, -L, W), ignore);
    if (bottom.free < STAIR_CLEAR) {
      shade.push({ floor: f, ...localRect(stair, -L - STAIR_CLEAR, -L - bottom.free, W) });
      if (bottom.by === 'wall') {
        add('NO_STEP_ON', `The stairs are too close to the wall${room ? ` of ${name}` : ''}: there is no room to step onto them`);
      } else {
        add('IN_THE_WAY', `${bottom.item} is in the way at the bottom of the stairs`);
      }
    }
  }
  if (room) {
    const door = doorZones(ctx, f, room).find((z) => overlapsBox(flightBox, z, TOL));
    if (door) {
      add('BLOCKS_DOOR', `The stairs block a door of ${name}`);
      shade.push({ floor: f, ...rectOfBox(door) });
    }
  }
  const onFlight = blockerIn(ctx, f, flight, ignore);
  if (onFlight) add('IN_THE_WAY', `${onFlight} stands on the stairs`);

  // ── the floor above: the landing and the opening ──
  if (above && !nowhere) {
    const arrive = localRect(stair, L + 0.6, L + 0.6, 0); // building.stairTop
    const landingRoom = innermostAt(ctx.floorData(above.id).rooms, arrive.x, arrive.z)
      ?? innermostAt(ctx.floorData(above.id).rooms, topEnd.x, topEnd.z);
    const top = freeDepth(ctx, above.id, landingRoom, (k) => localRect(stair, L, L + k, W), ignore);
    if (top.free < STAIR_CLEAR) {
      shade.push({ floor: above.id, ...localRect(stair, L + top.free, L + STAIR_CLEAR, W) });
      if (top.by === 'wall') {
        add('NO_LANDING', `The stairs end too close to a wall on ${aboveName}: there is no room to step off at the top`);
      } else {
        add('IN_THE_WAY', `${top.item} on ${aboveName} is in the way at the top of the stairs`);
      }
    }
  }
  if (above) {
    const hole = stairOpening(stair, { width, length }, 0.05);
    const holeRoom = innermostAt(ctx.floorData(above.id).rooms, stair.x, stair.z);
    const door = holeRoom && doorZones(ctx, above.id, holeRoom).find((z) => overlapsBox(hole, z, TOL));
    if (door) {
      add('BLOCKS_DOOR', `The opening for the stairs on ${aboveName} is in front of a door`);
      shade.push({ floor: above.id, ...rectOfBox(door) });
    }
    const over = blockerIn(ctx, above.id, rectOfBox(hole), ignore);
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

/** Offsets from (0, 0), nearest first: every 5 cm within 2 m, 10 cm within 6 m, 25 cm beyond (up to `radius`). */
function* offsets(radius) {
  const bands = [[0, 2, 0.05], [2, 6, 0.1], [6, radius, 0.25]];
  for (const [from, to, step] of bands) {
    if (to <= from) continue;
    const n = Math.ceil(to / step);
    const ring = [];
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const d = Math.hypot(i * step, j * step);
        if (d > from + 1e-9 && d <= to + 1e-9) ring.push([i * step, j * step, d]);
      }
    }
    ring.sort((a, b) => a[2] - b[2] || Math.abs(a[1]) - Math.abs(b[1]));
    for (const p of ring) yield p;
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
  const room = innermostAt(rooms, stair.x, stair.z);
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
  const sameRoom = (x, z) => (innermostAt(rooms, x, z)?.id ?? null) === (room?.id ?? null);
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
 * @returns {{ moves: [string, { x, z, roomId }][] } | null}
 */
export function findItemSpot(item, layout, { catalog = {}, radius = 8 } = {}) {
  if (!item) return null;
  const ctx = fitContext(layout, catalog);
  const f = floorOf(item);
  const rooms = ctx.floorData(f).rooms;
  const objects = ctx.objects;
  const group = [item, ...ridersOf(item, objects, catalog)];
  const chair = isDesk(item.assetType) ? deskSeat(item, objects) : null;
  if (chair && !chair.isLocked && !group.includes(chair)) group.push(chair);
  const ignore = new Set(group.map((o) => o.id));
  const room = innermostAt(rooms, item.x ?? 0, item.z ?? 0);
  // floor that must stay free: in front of doors, the stairs and both their ends (from this floor, and arriving here)
  const doors = room ? doorZones(ctx, f, room, ITEM_DOOR_FREE) : [];
  const stairZones = [];
  for (const s of ctx.objects) {
    if (s.assetType !== 'STAIRCASE') continue;
    const { width, length } = stairSize(s);
    if (floorOf(s) === f) stairZones.push(localRect(s, -length / 2 - STAIR_CLEAR, length / 2, width / 2));
    else if (floorAbove(ctx.floors, floorOf(s))?.id === f) {
      stairZones.push(rectOfBox(stairOpening(s, { width, length }, 0.05)));
      stairZones.push(localRect(s, length / 2, length / 2 + STAIR_CLEAR, width / 2));
    }
  }
  const solid = group.filter((o) => isSolidItem(o, catalog) && !FLOOR_LIKE_TYPES.has(o.assetType))
    .map((o) => ({ o, rects: itemFootprints(o, catalog) }));
  const fits = (dx, dz) => {
    for (const { rects } of solid) {
      for (const r0 of rects) {
        const r = { ...r0, x: r0.x + dx, z: r0.z + dz };
        const b = boxOf(r);
        if (!wallsClear(ctx, f, b, room)) return false;
        if (doors.some((z) => overlapsBox(b, z, ITEM_TOL))) return false;
        if (stairZones.some((z) => !farApart(z, r) && rectsOverlap(z, r, ITEM_TOL))) return false;
        if (blockerIn(ctx, f, r, ignore)) return false;
      }
    }
    return true;
  };
  const sameRoom = (x, z) => (innermostAt(rooms, x, z)?.id ?? null) === (room?.id ?? null);
  for (const [dx, dz] of offsets(radius)) {
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
