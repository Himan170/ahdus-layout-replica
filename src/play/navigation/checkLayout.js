/**
 * play/navigation/checkLayout.js
 *
 * PURE (no Babylon): "Check my layout" (v0.15.3). What the engine already knows about a layout
 * that can't work (a room with no door, a desk nobody can walk to, furniture in a wall) as a list
 * Studio shows to the person building. Nothing here changes the layout, and nothing blocks saving.
 *
 *   checkLayout(layout, { catalog, maps, fixes }) → { problems, ms }
 *   problem = { key, kind, severity, message, ids, floorId, roomId?, objectId?, blocksWalking?, fix? }
 *     key       stable while the same things are wrong (kind + the ids it is about): "Ignore" keeps it
 *     severity  'error' (it can't be used) | 'warning' (it looks wrong) | 'info' (a note, not counted)
 *     roomId / objectId   what a click selects
 *     blocksWalking  (v0.17.4) people can't walk somewhere because of it: Publish lists it even when ignored
 *     fix       (v0.17.4) "Fix it": { moves: [[objectId, patch]], label } = one editor.moveObjects
 *               (v0.18.5) a cabin nobody can walk into: { room: { id, patch, rooms, objects }, label } = one
 *               editor.turnRoom (turned, or moved off the wall its door faces)
 *               (fixes: false = none: checking a layout with the fixes applied)
 *
 * It reuses the walk map (walkMap.js: what the body can stand on), the walkable areas and the
 * stairs between floors (route.js), the entrance (entrance.js) and play/stairFit.js.
 */

import { roomOpenings, openingCentre, wallThicknessOf } from '../geometry';
import { floorsInOrder, FLOOR_LIKE_TYPES } from '../building';
import { stairFit, stairSpots, findItemSpot } from '../stairFit';
import { rectsOverlap, reachOf, farApart, distanceTo, boxOf } from '../turnedRect';
import { deskSeat, isDesk } from '../people';
import {
  createWalkMapCache, wallObstacles, itemFootprints, isSolidItem, groundFloorId, FREE,
} from './walkMap';
import { entranceSpawn, outsideDoors, nearestFree } from './entrance';
import { floorLinks, areaOf, roomHasDoor, roomAt } from './route';
import { WALL_ITEM_TYPES, isWallItem, isOnWall, wallPieces } from '../wallMount';
import { groupOf } from '../prefab';
import { prefabById } from '../../catalog/manifest';
import { narrowAisles, AISLE_MIN, metres } from '../aisles';
import { liftProblems } from '../lifts';
import { cabinFixes, isCabin } from '../cabinDoor';

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
  AISLE_NARROW: 'AISLE_NARROW', // v0.18.0: less than 0.9 m beside a workstation cluster or desk row
  LIFT: 'LIFT', // v0.18.3: a lift that skips a floor, a floor no lift stops at (code LIFT_GAP / LIFT_FLOOR_NOT_SERVED)
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

// Turned rectangles ({ x, z, hw, hd, rot }, Babylon's rotationY): play/turnedRect.js
export { rectsOverlap };
const far = farApart;

/** The axis-aligned box around an item's rectangles (none: a box nothing touches). */
function itemBox(rects) {
  const u = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const r of rects) {
    const b = boxOf(r);
    u.x0 = Math.min(u.x0, b.x0); u.x1 = Math.max(u.x1, b.x1);
    u.z0 = Math.min(u.z0, b.z0); u.z1 = Math.max(u.z1, b.z1);
  }
  return u;
}

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
      const clusters = new Map(); // v0.18.0: a cluster's lost seats are ONE line, naming the cluster
      for (const desk of itemsOn.get(id) ?? []) {
        if (!isDesk(desk.assetType)) continue;
        const room = roomAt(safe, id, desk.x ?? 0, desk.z ?? 0);
        if (room ? closedRooms.has(room.id) : id !== ground) continue; // its room is listed / it is outside the rooms upstairs
        const rects = fp(desk);
        const reach = Math.max(...rects.map(reachOf)) + DESK_REACH;
        const near = (x, z) => rects.some((r) => distanceTo(r, x, z) <= DESK_REACH) &&
          (roomAt(safe, id, x, z)?.id ?? null) === (room?.id ?? null);
        if (!reachableIn(id, desk.x - reach, desk.x + reach, desk.z - reach, desk.z + reach, near, 1)) {
          const group = groupOf(desk);
          const prefab = group && prefabById(group.prefab);
          if (prefab) {
            if (!clusters.has(group.id)) clusters.set(group.id, { prefab, room, desks: [] });
            clusters.get(group.id).desks.push(desk);
            continue;
          }
          add(CHECK_KINDS.DESK_UNREACHABLE, 'error',
            `Nobody can walk to ${itemName(desk)}${room ? ` in ${roomName(room)}` : ''}`, [desk.id], id, { objectId: desk.id });
        }
      }
      for (const [groupId, { prefab, room, desks }] of clusters) {
        const members = (itemsOn.get(id) ?? []).filter((o) => groupOf(o)?.id === groupId);
        const seats = members.filter((o) => groupOf(o).role === 'desk').length;
        const which = desks.length >= seats ? (seats === 1 ? 'its seat' : 'its seats') : desks.length === 1 ? 'one of its seats' : `${desks.length} of its seats`;
        add(CHECK_KINDS.DESK_UNREACHABLE, 'error',
          `The ${prefab.label.toLowerCase()}${room ? ` in ${roomName(room)}` : ''} leaves no way to ${which}`,
          members.map((o) => o.id), id, { objectId: desks[0].id, groupId, groupLabel: prefab.label, cluster: true });
      }
    }
  }

  // ── 5. Furniture: in each other, in a wall, outside every room (upstairs) ──
  for (const id of floorIds) {
    const here = roomsOn.get(id) ?? [];
    const items = (itemsOn.get(id) ?? []).filter((o) => isSolidItem(o, catalog) && !FLOOR_LIKE_TYPES.has(o.assetType));
    const furniture = items.filter((o) => !BUILDING_PARTS.has(o.assetType));
    const all = itemsOn.get(id) ?? [];

    // in each other. v0.18.6 (audit 7): what can't touch is skipped by the boxes the items really cover (scaled and
    // turned); a 6 m distance between centres used to skip two enlarged meeting tables lying in each other
    const boxes = furniture.map((o) => itemBox(fp(o)));
    for (let i = 0; i < furniture.length; i++) {
      const a = furniture[i];
      const ra = fp(a);
      const ba = boxes[i];
      const a0 = a.y ?? 0;
      const a1 = a0 + heightOf(a);
      for (let j = i + 1; j < furniture.length; j++) {
        const b = furniture[j];
        const bb = boxes[j];
        if (bb.x0 >= ba.x1 || bb.x1 <= ba.x0 || bb.z0 >= ba.z1 || bb.z1 <= ba.z0) continue;
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
            // v0.18.0: a cluster blocks it as a whole, named once ("6-person cluster blocks a door of …")
            const group = groupOf(item);
            const prefab = group && prefabById(group.prefab);
            if (prefab) {
              if (blockers.has(group.id)) continue;
              blockers.add(group.id);
              const members = all.filter((o) => groupOf(o)?.id === group.id);
              const doors = (room.doors ?? []).length;
              add(CHECK_KINDS.DOOR_BLOCKED, 'warning', `The ${prefab.label.toLowerCase()} blocks ${doors === 1 ? 'the' : 'a'} door of ${roomName(room)}`,
                members.map((o) => o.id), id, { objectId: item.id, doorAt: c, groupId: group.id, groupLabel: prefab.label });
              continue;
            }
            blockers.add(item.id);
            add(CHECK_KINDS.DOOR_BLOCKED, 'warning', `${itemName(item)} blocks a door of ${roomName(room)}`,
              [item.id], id, { objectId: item.id, doorAt: c });
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

  // ── 6b. Aisles beside workstation clusters and desk rows (v0.18.0, play/aisles.js) ──
  const aisles = narrowAisles(safe, catalog);
  // a cluster whose seats can't be reached says why in its own line ("…: only 0.6 m to the wall"), and
  // that aisle is not listed again
  const folded = new Set();
  for (const p of problems) {
    if (!p.cluster) continue;
    const cause = aisles.filter((a) => a.floor === p.floorId && a.sides?.[p.groupId]).sort((a, b) => a.gap - b.gap)[0];
    if (!cause) continue;
    folded.add(cause);
    p.message += `: only ${metres(cause.gap)} to ${cause.sides[p.groupId]}`;
  }
  for (const a of aisles) {
    if (folded.has(a)) continue;
    add(CHECK_KINDS.AISLE_NARROW, 'warning', a.message, a.ids, a.floor, { objectId: a.objectId, gap: a.gap, sides: a.sides, groups: a.groups });
  }

  // ── 7. Stairs (play/stairFit.js: the same words as the Inspector). Stairs nobody can use are errors ──
  for (const stair of objects) {
    if (stair.assetType !== 'STAIRCASE') continue;
    for (const p of stairFit(stair, safe, { catalog }).problems) {
      problems.push({
        key: `${CHECK_KINDS.STAIRS}_${p.code}:${stair.id}`,
        kind: CHECK_KINDS.STAIRS,
        code: p.code,
        severity: 'error',
        message: p.text,
        ids: [stair.id],
        floorId: floorOf(stair),
        objectId: stair.id,
      });
    }
  }

  // ── 8. Lifts (v0.18.3, play/lifts.js). A shaft with no door is already ROOM_NO_DOOR above ──
  for (const p of liftProblems(rooms, floors, objects)) {
    if (p.code === 'LIFT_NO_DOOR') continue;
    problems.push({
      key: `${CHECK_KINDS.LIFT}_${p.code}:${p.liftId}:${p.floor}`, kind: CHECK_KINDS.LIFT, code: p.code, severity: p.severity,
      message: p.text, ids: p.otherId ? [p.roomId, p.otherId] : [p.roomId], floorId: p.floor, roomId: p.roomId,
      // v0.18.4: Fix it = a lift stop there (editor.setLiftStops), when its spot on that floor is free
      ...(p.stop ? { fix: { liftStops: { roomId: p.stop.roomId, stops: p.stop.stops }, label: `Add a lift stop on ${floors[p.floor]?.name ?? 'that floor'}` } } : {}),
    });
  }

  // one line per key (two parts of an L-shaped desk in one wall), floor by floor, the worst first
  const seen = new Set();
  let unique = problems.filter((p) => !seen.has(p.key) && seen.add(p.key));
  for (const p of unique) if (blocksWalking(p)) p.blocksWalking = true;
  if (options.fixes !== false) {
    // v0.18.0: what a cluster's move clears is said once, in that cluster's own line
    const absorbed = addFixes(unique, safe, { catalog, floorIds, check: checkLayout });
    if (absorbed.size) unique = unique.filter((p) => !absorbed.has(p));
    addCabinFixes(unique, safe, { catalog, check: checkLayout });
  }
  unique.sort((a, b) => (order.get(a.floorId) ?? 0) - (order.get(b.floorId) ?? 0) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.message.localeCompare(b.message));
  return { problems: unique, ms: now() - t0 };
}

// ── Fix it (v0.17.4) ─────────────────────────────────────────────────────

/** Problems that stop people walking somewhere: Publish lists them even when ignored. */
const WALKING_KINDS = new Set([
  CHECK_KINDS.NO_ENTRANCE, CHECK_KINDS.ROOM_NO_DOOR, CHECK_KINDS.FLOOR_UNREACHABLE,
  CHECK_KINDS.ROOM_UNREACHABLE, CHECK_KINDS.DESK_UNREACHABLE, CHECK_KINDS.STAIRS,
]);
export function blocksWalking(p) {
  return !!p && (WALKING_KINDS.has(p.kind) || p.blocksWalking === true);
}

/**
 * Give the problems a staircase or an item can fix by moving a `fix`: { moves: [[id, patch]], label }
 * for one editor.moveObjects (one undo step). Stairs move to the nearest spot where they work
 * (stairFit.stairSpots), an item that blocks a door to the nearest spot where it blocks nothing
 * (stairFit.findItemSpot). "Nobody can walk to …" gets the moves of the stairs and door blockers
 * around it, but only when checking the layout with them moved shows it gone.
 */
function addFixes(problems, layout, { catalog, floorIds, check }) {
  const objects = list(layout.objects);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const culprits = []; // { problem, moves }
  const stairsDone = new Map();
  for (const p of problems) {
    const obj = byId.get(p.objectId);
    if (!obj || obj.isLocked) continue;
    if (p.kind === CHECK_KINDS.STAIRS) {
      if (!stairsDone.has(obj.id)) {
        let spot = null;
        for (const s of stairSpots(obj, layout, { catalog })) {
          if (s.x !== obj.x || s.z !== obj.z) { spot = s; break; }
        }
        stairsDone.set(obj.id, spot ? { moves: [[obj.id, { x: spot.x, z: spot.z, roomId: spot.roomId }]], label: 'Move the stairs' } : null);
      }
      const fix = stairsDone.get(obj.id);
      if (fix) { p.fix = fix; culprits.push({ problem: p, obj, moves: fix.moves }); }
    } else if (p.kind === CHECK_KINDS.DOOR_BLOCKED || p.cluster) {
      // v0.18.0: a cluster moves as a whole (none of it locked); its lost seats: to a spot with aisles round it
      const members = p.groupId ? objects.filter((o) => p.ids.includes(o.id)) : null;
      if (members?.some((o) => o.isLocked)) continue;
      const spot = findItemSpot(obj, layout, { catalog, members, clearance: p.cluster ? AISLE_MIN : 0 });
      if (spot && spot.moves.some(([id, at]) => at.x !== byId.get(id)?.x || at.z !== byId.get(id)?.z)) {
        const name = p.groupLabel ? `the ${p.groupLabel.toLowerCase()}` : String(obj.label ?? '').trim() || catalog[obj.assetType]?.label || 'the item';
        p.fix = { moves: spot.moves, label: `Move ${name}` };
        culprits.push({ problem: p, obj, moves: spot.moves });
      }
    }
  }
  const lost = problems.filter((p) => [CHECK_KINDS.ROOM_UNREACHABLE, CHECK_KINDS.DESK_UNREACHABLE, CHECK_KINDS.FLOOR_UNREACHABLE].includes(p.kind));
  // v0.18.0: a cluster whose move makes desks, a room or its own seats reachable again takes those lines into
  // its own ("The 6-person cluster blocks the door of Open Office"): one line per cluster, an error then
  const absorbed = new Set();
  const withMoves = (moves) => {
    const m = new Map(moves);
    return { ...layout, objects: objects.map((o) => (m.has(o.id) ? { ...o, ...m.get(o.id) } : o)) };
  };
  // a cluster beside an aisle too narrow to walk (in front of a door, say) may be what shuts people out
  const tried = new Set(culprits.map((c) => c.problem.groupId).filter(Boolean));
  const aisleCulprits = [];
  if (lost.some((p) => p.kind !== CHECK_KINDS.FLOOR_UNREACHABLE)) {
    for (const p of problems) {
      if (p.kind !== CHECK_KINDS.AISLE_NARROW) continue;
      for (const gid of p.groups ?? []) {
        if (tried.has(gid)) continue;
        tried.add(gid);
        const members = objects.filter((o) => groupOf(o)?.id === gid);
        const obj = members.find((o) => groupOf(o).role === 'desk') ?? members[0];
        if (!obj || members.some((o) => o.isLocked)) continue;
        const spot = findItemSpot(obj, layout, { catalog, members, clearance: AISLE_MIN });
        if (spot) aisleCulprits.push({ problem: p, obj, moves: spot.moves, groupId: gid });
      }
    }
  }
  const ordered = [...culprits.filter((c) => c.problem.groupId)
    .sort((a, b) => (a.problem.kind === CHECK_KINDS.DOOR_BLOCKED ? 0 : 1) - (b.problem.kind === CHECK_KINDS.DOOR_BLOCKED ? 0 : 1)),
  ...aisleCulprits];
  for (const c of ordered) {
    if (absorbed.has(c.problem) || (c.groupId && c.problem.fix)) continue;
    const near = (p) => p.kind !== CHECK_KINDS.FLOOR_UNREACHABLE && p.floorId === floorOf(c.obj);
    const mine = lost.filter((p) => p !== c.problem && !absorbed.has(p) && near(p));
    if (!mine.length && !c.problem.cluster) continue;
    const still = new Set(check(withMoves(c.moves), { catalog, fixes: false }).problems.map((p) => p.key));
    if (c.problem.cluster && still.has(c.problem.key)) {
      // moving it doesn't give its seats a way in: no Fix it of its own
      delete c.problem.fix;
      culprits.splice(culprits.indexOf(c), 1);
      continue;
    }
    const cleared = mine.filter((p) => !still.has(p.key));
    if (c.groupId) {
      // an aisle's cluster: its line becomes the cause ("…blocks the door of Open Office: only 0.6 m to the wall")
      if (!cleared.length) continue;
      const prefab = prefabById(groupOf(c.obj).prefab);
      const label = prefab.label.toLowerCase();
      const why = `only ${metres(c.problem.gap)} to ${c.problem.sides[c.groupId]}`;
      const shut = cleared.find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE);
      const room = shut && list(layout.rooms).find((r) => r.id === shut.roomId);
      c.problem.kind = room ? CHECK_KINDS.DOOR_BLOCKED : CHECK_KINDS.DESK_UNREACHABLE;
      c.problem.message = room
        ? `The ${label} blocks ${(room.doors ?? []).length === 1 ? 'the' : 'a'} door of ${roomName(room)}: ${why}`
        : `The ${label} leaves no way to the seats around it: ${why}`;
      c.problem.ids = objects.filter((o) => groupOf(o)?.id === c.groupId).map((o) => o.id);
      c.problem.objectId = c.obj.id;
      c.problem.groupId = c.groupId;
      c.problem.groupLabel = prefab.label;
      c.problem.fix = { moves: c.moves, label: `Move the ${label}` };
      culprits.push(c);
    }
    for (const p of cleared) {
      absorbed.add(p);
      c.problem.severity = 'error';
      c.problem.blocksWalking = true;
    }
  }
  const open = lost.filter((p) => !absorbed.has(p) && !(p.cluster && p.fix));
  // "Nobody can walk to …": the stairs and door blockers near it (FLOOR_UNREACHABLE: the stairs below it)
  const rooms = list(layout.rooms);
  const nextFloor = (id) => floorIds[floorIds.indexOf(id) + 1] ?? null;
  const near = (p, c) => {
    const isStairs = c.problem.kind === CHECK_KINDS.STAIRS;
    const f = floorOf(c.obj);
    if (p.kind === CHECK_KINDS.FLOOR_UNREACHABLE) return isStairs && floorIds.indexOf(f) < floorIds.indexOf(p.floorId);
    // stairs count on their floor and on the floor they arrive on
    if (f !== p.floorId && !(isStairs && nextFloor(f) === p.floorId)) return false;
    const target = p.roomId ? rooms.find((r) => r.id === p.roomId) : byId.get(p.objectId);
    const room = p.roomId ? target : target && roomAt(layout, p.floorId, target.x ?? 0, target.z ?? 0);
    if (!room) return true;
    const at = c.problem.doorAt ?? { x: c.obj.x ?? 0, z: c.obj.z ?? 0 };
    const pad = isStairs ? 3 : 0.6; // a flight is 4 m long: its ends reach that far from its middle
    return Math.abs(at.x - room.x) <= room.width / 2 + pad && Math.abs(at.z - room.z) <= room.depth / 2 + pad;
  };
  const plans = open.map((p) => ({ p, from: culprits.filter((c) => c.problem !== p && near(p, c)) })).filter((x) => x.from.length);
  if (!plans.length) return absorbed;
  // one check with every culprit moved tells which of them fix what
  const moved = new Map();
  for (const { from } of plans) for (const c of from) for (const [id, patch] of c.moves) moved.set(id, patch);
  const after = check({ ...layout, objects: objects.map((o) => (moved.has(o.id) ? { ...o, ...moved.get(o.id) } : o)) },
    { catalog, fixes: false }).problems;
  const still = new Set(after.map((p) => p.key));
  for (const { p, from } of plans) {
    if (still.has(p.key)) continue;
    const moves = new Map();
    for (const c of from) for (const [id, patch] of c.moves) moves.set(id, patch);
    p.fix = { moves: [...moves], label: from.every((c) => c.problem.kind === CHECK_KINDS.STAIRS) ? 'Move the stairs' : 'Move what blocks the way' };
  }
  return absorbed;
}

/** A cabin's ways out tried by a re-check, at most this many (each re-check is a whole Check). */
const CABIN_TRIES = 3;

/**
 * v0.18.5: "Nobody can walk to Cabin" with nothing else to move: the cabin turned, or moved off the wall
 * its door faces (play/cabinDoor.js), the first way the re-check shows clears it.
 */
function addCabinFixes(problems, layout, { catalog, check }) {
  for (const p of problems) {
    if (p.kind !== CHECK_KINDS.ROOM_UNREACHABLE || p.fix) continue;
    const room = layout.rooms.find((r) => r.id === p.roomId);
    if (!room || !isCabin(room, layout.objects)) continue;
    for (const way of cabinFixes(room, layout, catalog).slice(0, CABIN_TRIES)) {
      const { id, patch, rooms = [], objects = [] } = way.room;
      const rp = new Map([[id, patch], ...rooms]);
      const op = new Map(objects);
      const after = {
        ...layout,
        rooms: layout.rooms.map((r) => (rp.has(r.id) ? { ...r, ...rp.get(r.id) } : r)),
        objects: layout.objects.map((o) => (op.has(o.id) ? { ...o, ...op.get(o.id) } : o)),
      };
      if (check(after, { catalog, fixes: false }).problems.some((q) => q.key === p.key)) continue;
      p.fix = way;
      break;
    }
  }
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

/**
 * What the Publish dialog lists (v0.17.4): the problems that stop people walking somewhere, the
 * ignored ones too (marked `ignored`), worst first as checkLayout sorted them.
 */
export function walkingProblems(problems = [], ignored = []) {
  const hidden = new Set(ignored ?? []);
  return problems.filter(blocksWalking).map((p) => (hidden.has(p.key) ? { ...p, ignored: true } : p));
}

/**
 * v0.18.0: problems that one move fixes together (the stairs that can't be used AND the room nobody can
 * reach because of them): their Fix it moves the same items. → [{ key, keys, count, fix }] for every item
 * (or set of items) behind 2 or more problems, the most first; `fix` = one moveObjects for all of them.
 */
export function sharedFixes(problems = []) {
  const byItems = new Map();
  for (const p of problems) {
    if (!p.fix?.moves?.length) continue;
    const key = p.fix.moves.map(([id]) => id).sort().join('|');
    if (!byItems.has(key)) byItems.set(key, []);
    byItems.get(key).push(p);
  }
  const out = [];
  for (const [key, list] of byItems) {
    if (list.length < 2) continue;
    const moves = new Map();
    for (const p of list) for (const [id, patch] of p.fix.moves) if (!moves.has(id)) moves.set(id, patch);
    out.push({ key, keys: list.map((p) => p.key), count: list.length, fix: { moves: [...moves], label: list[0].fix.label } });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** "No problems" / "1 problem" / "12 problems". */
export function countText(count) {
  return count === 0 ? 'No problems' : `${count} problem${count === 1 ? '' : 's'}`;
}
