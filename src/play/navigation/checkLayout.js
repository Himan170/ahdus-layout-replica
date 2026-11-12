/**
 * play/navigation/checkLayout.js
 *
 * PURE (no Babylon): "Check my layout" (v0.15.3). What the engine already knows about a layout
 * that can't work (a room with no door, a desk nobody can walk to, furniture in a wall) as a list
 * Studio shows to the person building. Nothing here changes the layout, and nothing blocks saving.
 *
 *   checkLayout(layout, { catalog, maps }) → { problems, ms }
 *   problem = { key, kind, severity, message, ids, floorId, roomId?, objectId? }
 *     key       stable while the same things are wrong (kind + the ids it is about): "Ignore" keeps it
 *     severity  'error' (it can't be used) | 'warning' (it looks wrong) | 'info' (a note, not counted)
 *     roomId / objectId   what a click selects
 *
 * It reuses the walk map (walkMap.js: what the body can stand on), the walkable areas and the
 * stairs between floors (route.js), the entrance (entrance.js) and building.stairProblems.
 */

import { roomOpenings, openingCentre, wallThicknessOf } from '../geometry';
import { floorsInOrder, stairProblems, FLOOR_LIKE_TYPES } from '../building';
import { deskSeat, isDesk } from '../people';
import {
  createWalkMapCache, wallObstacles, itemFootprints, isSolidItem, groundFloorId, FREE,
} from './walkMap';
import { entranceSpawn, outsideDoors, nearestFree } from './entrance';
import { floorLinks, areaOf, roomHasDoor, roomAt } from './route';
import { WALL_ITEM_TYPES, isWallItem, isOnWall, wallPieces } from '../wallMount';

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;

/** The kinds of problem. */
export const CHECK_KINDS = {
  NO_ENTRANCE: 'NO_ENTRANCE',
  ROOM_NO_DOOR: 'ROOM_NO_DOOR',
  FLOOR_UNREACHABLE: 'FLOOR_UNREACHABLE',
  ROOM_UNREACHABLE: 'ROOM_UNREACHABLE',
  DESK_UNREACHABLE: 'DESK_UNREACHABLE',
  ITEMS_OVERLAP: 'ITEMS_OVERLAP',
  ITEM_IN_WALL: 'ITEM_IN_WALL',
  ITEM_OUTSIDE: 'ITEM_OUTSIDE',
  DOOR_BLOCKED: 'DOOR_BLOCKED',
  WINDOW_BLOCKED: 'WINDOW_BLOCKED',
  STAIRS: 'STAIRS',
  WALL_ITEM_OFF_WALL: 'WALL_ITEM_OFF_WALL', // v0.15.6: a TV, a clock… that doesn't hang on a wall
};

/** Worst first. */
export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/** Building parts drawn as items (a wall from the Wall tool, a door cut into it): they touch each other and walls. */
const BUILDING_PARTS = new Set(['WALL_SEGMENT', 'DOOR_SINGLE', 'WINDOW_FRAME', 'GLASS_PARTITION', 'COLUMN']);
/** Things that hang on a wall or stand against it: touching the wall is how they are meant to be. */
const WALL_HUNG = new Set([...WALL_ITEM_TYPES, 'FIRST_AID']);
const isChair = (type) => /^CHAIR|LOUNGE_CHAIR/.test(type ?? '');
const isTable = (type) => isDesk(type) || /^TABLE/.test(type ?? '');

/** Two footprints must be this far into each other to count (m): things pushed together are fine. */
export const OVERLAP_TOLERANCE = 0.06;
/** An item whose foot is this far up another one (a fraction of its height) stands on it. */
export const STANDS_ON = 0.6;
/** A door needs this much free floor on each side of its wall (m). */
export const DOOR_FREE = 0.5;
/** A window is "blocked" by something taller than its sill by this much, this close in front of it (m). */
export const WINDOW_OVER_SILL = 0.3;
export const WINDOW_FRONT = 0.4;
/** A desk can be walked to when the body fits within this distance of it, in its own room (m). */
export const DESK_REACH = 1.0;

// ── Rectangles (turned: { x, z, hw, hd, rot }, Babylon's rotationY) ──────

const axesOf = (r) => {
  const c = Math.cos(r.rot ?? 0);
  const s = Math.sin(r.rot ?? 0);
  return [{ x: c, z: -s }, { x: s, z: c }]; // local +X, local +Z
};

/** Do two turned rectangles overlap by more than `tol` (each shrunk by tol / 2)? Separating axes. */
export function rectsOverlap(a, b, tol = 0) {
  const t = tol / 2;
  const ra = { ...a, hw: a.hw - t, hd: a.hd - t };
  const rb = { ...b, hw: b.hw - t, hd: b.hd - t };
  if (ra.hw <= 0 || ra.hd <= 0 || rb.hw <= 0 || rb.hd <= 0) return false;
  const [ax, az] = axesOf(ra);
  const [bx, bz] = axesOf(rb);
  const dx = rb.x - ra.x;
  const dz = rb.z - ra.z;
  for (const n of [ax, az, bx, bz]) {
    const reachA = ra.hw * Math.abs(ax.x * n.x + ax.z * n.z) + ra.hd * Math.abs(az.x * n.x + az.z * n.z);
    const reachB = rb.hw * Math.abs(bx.x * n.x + bx.z * n.z) + rb.hd * Math.abs(bz.x * n.x + bz.z * n.z);
    if (Math.abs(dx * n.x + dz * n.z) >= reachA + reachB) return false;
  }
  return true;
}

/** How far a turned rectangle reaches from its centre (a circle around it: a quick "can't touch" test). */
const reachOf = (r) => Math.hypot(r.hw, r.hd);
const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) > reachOf(a) + reachOf(b);

// ── Names ────────────────────────────────────────────────────────────────

const roomName = (room) => String(room?.name ?? '').trim() || 'A room';
const floorName = (floors, id) => floors[id]?.name || `Floor ${id}`;

/**
 * Check a layout.
 * @param {{ rooms, objects, floors }} layout  store shape (arrays or records; v1 field names)
 * @param {{ catalog?: object, maps?: { get(layout, floorId) }, now?: () => number }} [options]
 *   catalog: ASSET_TYPES (sizes, labels, solid or not); maps: a createWalkMapCache to reuse
 * @returns {{ problems: object[], ms: number }}
 */
export function checkLayout(layout, options = {}) {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  const catalog = options.catalog ?? {};
  const maps = options.maps ?? createWalkMapCache({ catalog });
  const rooms = list(layout?.rooms);
  const objects = list(layout?.objects);
  const floors = layout?.floors ?? {};
  const safe = { rooms, objects, floors };
  const problems = [];
  if (!rooms.length) return { problems, ms: now() - t0 };

  const ground = groundFloorId(floors);
  const floorIds = floorsInOrder(floors).map((f) => f.id);
  if (!floorIds.length) floorIds.push(ground);
  const order = new Map(floorIds.map((id, i) => [id, i]));
  const roomsOn = new Map(floorIds.map((id) => [id, rooms.filter((r) => floorOf(r) === id)]));
  const itemsOn = new Map(floorIds.map((id) => [id, objects.filter((o) => floorOf(o) === id)]));
  const itemName = (o) => String(o?.label ?? '').trim() || catalog[o?.assetType]?.label || 'An item';
  const heightOf = (o) => (catalog[o.assetType]?.defaultHeight ?? 1) * Math.abs(o.scaleY ?? 1);
  const footprints = new Map(); // item id → its rectangles
  const fp = (o) => {
    if (!footprints.has(o.id)) footprints.set(o.id, itemFootprints(o, catalog));
    return footprints.get(o.id);
  };
  const add = (kind, severity, message, ids, floorId, select = {}) => {
    problems.push({ key: `${kind}:${[...ids].sort().join('|')}`, kind, severity, message, ids, floorId, ...select });
  };

  // ── 1. A way in: a door to the outside ──
  const entrance = (roomsOn.get(ground) ?? []).length > 0 && outsideDoors(safe, ground).length > 0;
  if ((roomsOn.get(ground) ?? []).length > 0 && !entrance) {
    add(CHECK_KINDS.NO_ENTRANCE, 'error', 'No door leads outside: nobody can walk in', ['building'], ground);
  }

  // ── 2. Where can you walk to from the entrance? Walkable areas joined by the stairs ──
  const links = floorLinks(safe, { maps, catalog });
  const reached = new Map(floorIds.map((id) => [id, new Set()])); // floor → area labels
  if (entrance) {
    const spawn = entranceSpawn(safe, { maps, catalog });
    const start = maps.get(safe, ground);
    let label = areaOf(start, spawn.x, spawn.z);
    if (label < 0) {
      const spot = nearestFree(start, spawn.x, spawn.z, { maxDistance: 3 });
      if (spot) label = areaOf(start, spot.x, spot.z);
    }
    const queue = [];
    const visit = (floor, l) => {
      if (l < 0 || !reached.has(floor) || reached.get(floor).has(l)) return;
      reached.get(floor).add(l);
      queue.push([floor, l]);
    };
    visit(ground, label);
    while (queue.length) {
      const [floor, l] = queue.shift();
      for (const link of links) {
        for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) {
          if (a.floor === floor && areaOf(maps.get(safe, floor), a.x, a.z) === l) {
            visit(b.floor, areaOf(maps.get(safe, b.floor), b.x, b.z));
          }
        }
      }
    }
  }
  /** Is a free, reachable cell inside this box (and accepted)? Cells are sampled every `step` cells. */
  const reachableIn = (floor, x0, x1, z0, z1, accept = null, step = 2) => {
    const map = maps.get(safe, floor);
    const labels = reached.get(floor);
    if (!labels?.size) return false;
    const stride = map.cell * step;
    for (let z = z0; z <= z1; z += stride) {
      for (let x = x0; x <= x1; x += stride) {
        if (map.at(x, z) !== FREE || !labels.has(areaOf(map, x, z))) continue;
        if (!accept || accept(x, z)) return true;
      }
    }
    return false;
  };

  // ── 3. Rooms: no door, or nobody can walk to them ──
  const closedRooms = new Set(); // rooms already reported: their desks are not listed one by one
  const lostFloors = new Set();
  for (const id of floorIds) {
    const here = roomsOn.get(id) ?? [];
    if (!here.length) continue;
    if (entrance && id !== ground && !reached.get(id).size) {
      // nothing on this floor can be walked to: one line for the floor, not one per room
      lostFloors.add(id);
      add(CHECK_KINDS.FLOOR_UNREACHABLE, 'error', `Nobody can walk to ${floorName(floors, id)}: no stairs lead there`, [`floor:${id}`], id);
    }
    for (const room of here) {
      const T = wallThicknessOf(room) / 2;
      const inside = () => reachableIn(id, room.x - room.width / 2 + T, room.x + room.width / 2 - T,
        room.z - room.depth / 2 + T, room.z + room.depth / 2 - T, null, Math.max(2, Math.round(Math.min(room.width, room.depth) / 8 / 0.1)));
      if (!roomHasDoor(room, here)) {
        // (stairs arriving inside it are a way in too)
        if (entrance && !lostFloors.has(id) && inside()) continue;
        closedRooms.add(room.id);
        add(CHECK_KINDS.ROOM_NO_DOOR, 'error', `${roomName(room)} has no door`, [room.id], id, { roomId: room.id });
        continue;
      }
      if (!entrance || lostFloors.has(id)) continue;
      if (!inside()) {
        closedRooms.add(room.id);
        add(CHECK_KINDS.ROOM_UNREACHABLE, 'error', `Nobody can walk to ${roomName(room)}: something blocks the way`, [room.id], id, { roomId: room.id });
      }
    }
  }

  // ── 4. Desks nobody can walk to (in rooms that can be reached) ──
  if (entrance) {
    for (const id of floorIds) {
      if (lostFloors.has(id)) continue;
      for (const desk of itemsOn.get(id) ?? []) {
        if (!isDesk(desk.assetType)) continue;
        const room = roomAt(safe, id, desk.x ?? 0, desk.z ?? 0);
        if (room ? closedRooms.has(room.id) : id !== ground) continue; // its room is listed / it is outside the rooms upstairs
        const rects = fp(desk);
        const reach = Math.max(...rects.map(reachOf)) + DESK_REACH;
        const near = (x, z) => rects.some((r) => distanceTo(r, x, z) <= DESK_REACH) &&
          (roomAt(safe, id, x, z)?.id ?? null) === (room?.id ?? null);
        if (!reachableIn(id, desk.x - reach, desk.x + reach, desk.z - reach, desk.z + reach, near, 1)) {
          add(CHECK_KINDS.DESK_UNREACHABLE, 'error',
            `Nobody can walk to ${itemName(desk)}${room ? ` in ${roomName(room)}` : ''}`, [desk.id], id, { objectId: desk.id });
        }
      }
    }
  }

  // ── 5. Furniture: in each other, in a wall, outside every room (upstairs) ──
  for (const id of floorIds) {
    const here = roomsOn.get(id) ?? [];
    const items = (itemsOn.get(id) ?? []).filter((o) => isSolidItem(o, catalog) && !FLOOR_LIKE_TYPES.has(o.assetType));
    const furniture = items.filter((o) => !BUILDING_PARTS.has(o.assetType));
    const all = itemsOn.get(id) ?? [];

    // in each other
    for (let i = 0; i < furniture.length; i++) {
      const a = furniture[i];
      const ra = fp(a);
      const a0 = a.y ?? 0;
      const a1 = a0 + heightOf(a);
      for (let j = i + 1; j < furniture.length; j++) {
        const b = furniture[j];
        if (Math.abs((a.x ?? 0) - (b.x ?? 0)) > 6 || Math.abs((a.z ?? 0) - (b.z ?? 0)) > 6) continue;
        // one on top of the other (a monitor on a desk), or one above the other: not in each other
        const b0 = b.y ?? 0;
        if (Math.min(a1, b0 + heightOf(b)) - Math.max(a0, b0) <= 0.05) continue;
        // …or standing on it where its real top is a little lower than the catalogue's height
        // (a monitor on an L-shaped desk): a foot in the upper part of the other one is "on", not "in"
        if (b0 >= a0 + STANDS_ON * heightOf(a) || a0 >= b0 + STANDS_ON * heightOf(b)) continue;
        // a chair pushed under a desk or a table is where it belongs
        if ((isChair(a.assetType) && isTable(b.assetType)) || (isChair(b.assetType) && isTable(a.assetType))) continue;
        const rb = fp(b);
        if (!ra.some((p) => rb.some((q) => !far(p, q) && rectsOverlap(p, q, OVERLAP_TOLERANCE * 2)))) continue;
        add(CHECK_KINDS.ITEMS_OVERLAP, 'warning', `${itemName(a)} overlaps ${itemName(b)}`, [a.id, b.id], id, { objectId: a.id });
      }
    }

    // in a wall: a room's wall, or a wall drawn with the Wall tool
    const walls = [
      ...wallObstacles(here).map((w) => ({ ...w, name: roomName(here.find((r) => r.id === w.roomId)) })),
      ...all.filter((o) => o.assetType === 'WALL_SEGMENT').flatMap((o) => fp(o).map((r) => ({ ...r, name: null }))),
    ];
    for (const item of furniture) {
      if (WALL_HUNG.has(item.assetType)) continue;
      const rects = fp(item);
      const wall = walls.find((w) => rects.some((r) => !far(r, w) && rectsOverlap(r, w, OVERLAP_TOLERANCE * 2)));
      if (!wall) continue;
      add(CHECK_KINDS.ITEM_IN_WALL, 'warning',
        `${itemName(item)} stands in ${wall.name ? `a wall of ${wall.name}` : 'a wall'}`, [item.id], id, { objectId: item.id });
    }

    // a wall item (play/wallMount.js) that doesn't hang on a wall: on the floor, or off its wall (v0.15.6)
    const wallItems = all.filter((o) => isWallItem(o.assetType));
    if (wallItems.length) {
      const pieces = wallPieces(here, all);
      for (const item of wallItems) {
        if (isOnWall(item, pieces, { catalog })) continue;
        add(CHECK_KINDS.WALL_ITEM_OFF_WALL, 'warning', `${itemName(item)} is not on a wall: select it, then Mount on wall`,
          [item.id], id, { objectId: item.id });
      }
    }

    // outside every room, on an upper floor: it floats in the air (the ground floor has the ground)
    if (id !== ground) {
      for (const item of all) {
        if (item.assetType === 'STAIRCASE' || catalog[item.assetType]?.category === 'Marker') continue;
        if (roomAt(safe, id, item.x ?? 0, item.z ?? 0)) continue;
        add(CHECK_KINDS.ITEM_OUTSIDE, 'warning', `${itemName(item)} on ${floorName(floors, id)} is outside every room`, [item.id], id, { objectId: item.id });
      }
    }

    // ── 6. Doors and windows with furniture in front ──
    const seenDoors = new Set();
    const blockers = new Set(); // an item in a door between two rooms is listed once, not once per room
    for (const room of here) {
      const T = wallThicknessOf(room);
      for (const o of roomOpenings(room)) {
        const c = openingCentre(room, o.wall, o.offset);
        const alongX = o.wall === 'north' || o.wall === 'south';
        if (o.kind === 'door') {
          // a door between two rooms is stored on both: once is enough
          const at = `${Math.round(c.x * 20)}:${Math.round(c.z * 20)}`;
          if (seenDoors.has(at)) continue;
          seenDoors.add(at);
          const across = T / 2 + DOOR_FREE;
          const zone = { x: c.x, z: c.z, hw: alongX ? o.width / 2 - 0.05 : across, hd: alongX ? across : o.width / 2 - 0.05, rot: 0 };
          for (const item of furniture) {
            if (blockers.has(item.id) || !fp(item).some((r) => !far(r, zone) && rectsOverlap(r, zone, 0.04))) continue;
            blockers.add(item.id);
            add(CHECK_KINDS.DOOR_BLOCKED, 'warning', `${itemName(item)} blocks a door of ${roomName(room)}`,
              [item.id], id, { objectId: item.id });
          }
        } else {
          // inside the room, right in front of the window, taller than its sill
          const sign = o.wall === 'north' || o.wall === 'east' ? -1 : 1; // towards the room's middle
          const mid = T / 2 + WINDOW_FRONT / 2;
          const zone = {
            x: c.x + (alongX ? 0 : sign * mid), z: c.z + (alongX ? sign * mid : 0),
            hw: alongX ? o.width / 2 - 0.1 : WINDOW_FRONT / 2, hd: alongX ? WINDOW_FRONT / 2 : o.width / 2 - 0.1, rot: 0,
          };
          for (const item of furniture) {
            if (WALL_HUNG.has(item.assetType)) continue;
            if ((item.y ?? 0) + heightOf(item) < o.bottom + WINDOW_OVER_SILL) continue;
            if (!fp(item).some((r) => !far(r, zone) && rectsOverlap(r, zone, 0.04))) continue;
            add(CHECK_KINDS.WINDOW_BLOCKED, 'info', `${itemName(item)} stands in front of a window of ${roomName(room)}`,
              [item.id], id, { objectId: item.id });
          }
        }
      }
    }
  }

  // ── 7. Stairs (building.stairProblems: the same texts as the Inspector) ──
  for (const stair of objects) {
    if (stair.assetType !== 'STAIRCASE') continue;
    for (const p of stairProblems(stair, floors, rooms)) {
      problems.push({
        key: `${CHECK_KINDS.STAIRS}_${p.code}:${stair.id}`,
        kind: CHECK_KINDS.STAIRS,
        code: p.code,
        severity: p.code === 'NOWHERE' ? 'error' : 'warning',
        message: p.text,
        ids: [stair.id],
        floorId: floorOf(stair),
        objectId: stair.id,
      });
    }
  }

  // one line per key (two parts of an L-shaped desk in one wall), floor by floor, the worst first
  const seen = new Set();
  const unique = problems.filter((p) => !seen.has(p.key) && seen.add(p.key));
  unique.sort((a, b) => (order.get(a.floorId) ?? 0) - (order.get(b.floorId) ?? 0) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.message.localeCompare(b.message));
  return { problems: unique, ms: now() - t0 };
}

/** Distance from a point to a turned rectangle (0 inside). */
function distanceTo(rect, x, z) {
  const c = Math.cos(rect.rot ?? 0);
  const s = Math.sin(rect.rot ?? 0);
  const dx = x - rect.x;
  const dz = z - rect.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.hypot(Math.max(Math.abs(lx) - rect.hw, 0), Math.max(Math.abs(lz) - rect.hd, 0));
}

// ── What Studio shows ────────────────────────────────────────────────────

/**
 * The list for the panel: problems not ignored, grouped by floor (in floor order), the ignored
 * ones apart, and the number in the badge (errors and warnings not ignored; notes don't count).
 * Ignored keys that no longer match a problem are simply not shown.
 * @param {object[]} problems  checkLayout's
 * @param {string[]} ignored   the layout's ignoredChecks
 * @param {Record<string, { id: number, name: string }>} floors
 * @returns {{ count: number, groups: { floorId, name, problems: object[] }[], ignored: object[], total: number }}
 */
export function checkSummary(problems = [], ignored = [], floors = {}) {
  const hidden = new Set(ignored ?? []);
  const shown = problems.filter((p) => !hidden.has(p.key));
  const groups = [];
  for (const p of shown) {
    let g = groups.find((x) => x.floorId === p.floorId);
    if (!g) {
      g = { floorId: p.floorId, name: floorName(floors, p.floorId), problems: [] };
      groups.push(g);
    }
    g.problems.push(p);
  }
  return {
    count: shown.filter((p) => p.severity !== 'info').length,
    groups,
    ignored: problems.filter((p) => hidden.has(p.key)),
    total: problems.length,
  };
}

/** The ignored keys after "Ignore" / "Show again" on one problem (no key twice, order kept). */
export function toggleIgnored(ignored = [], key, on) {
  const rest = (ignored ?? []).filter((k) => k !== key);
  return on ? [...rest, key] : rest;
}

/** Ignored keys that still match a problem: the others are dropped when the list is next changed. */
export function liveIgnored(ignored = [], problems = []) {
  const keys = new Set(problems.map((p) => p.key));
  return (ignored ?? []).filter((k) => keys.has(k));
}

/** "No problems" / "1 problem" / "12 problems". */
export function countText(count) {
  return count === 0 ? 'No problems' : `${count} problem${count === 1 ? '' : 's'}`;
}
