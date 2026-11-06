/**
 * play/navigation/entrance.js
 *
 * PURE: where a walkthrough starts (entranceSpawn), and the nearest spot where
 * the walking body fits (nearestFree). Always on the ground floor, in this order:
 *   1. a SPAWN_POINT on the ground floor (if the body doesn't fit there: the
 *      nearest free spot to it), facing the way it faces;
 *   2. the main entrance: a door of the ground floor that leads outside (its
 *      wall has no other room behind it, its room isn't inside another room).
 *      A reception's door first, then the widest. You stand 3 m outside it,
 *      facing it;
 *   3. no door leads outside: 3 m outside the middle of the building's −Z side,
 *      facing the building;
 *   4. no rooms at all: (0, −8), facing +Z (as before).
 * Then nearestFree on the walk map (walkMap.js): never in a wall or a solid item.
 * No Babylon. Tests: navigation/__tests__/entrance.test.js.
 */

import { roomWalls, roomWallSegments, roomContainedBy, wallThicknessOf, roomOpenings } from '../geometry';
import { buildWalkMap, groundFloorId, FREE, STAIRS, VOID, CLEARANCE, SKIRTING_OUT } from './walkMap';

/** You start this far outside the main entrance (m). */
export const ENTRANCE_DISTANCE = 3;
/** nearestFree looks this far (m). */
export const SEARCH_RADIUS = 6;
/** In front of a door this far must be no room, or it doesn't lead outside. */
const OUTSIDE_PROBE = 1;

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;

/** Outward unit normal of a room's wall (north = +Z). */
const NORMAL = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** The yaw (0 = facing +Z, as playController) that looks from `from` to `to`. */
export function facingYaw(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * Is a point inside any of these rooms (on a wall counts as inside), or closer to one than `margin`?
 * With margin = CLEARANCE: the whole walking body is outside every room (not in a doorway).
 */
export function insideAnyRoom(rooms, x, z, margin = 0) {
  return rooms.some((r) => {
    const t = wallThicknessOf(r) / 2 + SKIRTING_OUT;
    const dx = Math.max(Math.abs(x - r.x) - r.width / 2 - t, 0);
    const dz = Math.max(Math.abs(z - r.z) - r.depth / 2 - t, 0);
    return dx === 0 && dz === 0 ? true : Math.hypot(dx, dz) < margin;
  });
}

/**
 * The doors of a floor that lead outside: on a part of their room's wall that
 * no other room shares (roomWallSegments: not shared, not standing on an
 * outer room's wall), their room not inside another room, and no room right
 * in front of them.
 * @returns {{ roomId, room, wall, index, width, x, z, normal: {x,z} }[]}
 */
export function outsideDoors(layout, floorId = groundFloorId(layout.floors)) {
  const rooms = list(layout.rooms).filter((r) => floorOf(r) === floorId);
  const out = [];
  for (const room of rooms) {
    if (rooms.some((o) => o.id !== room.id && roomContainedBy(o, room))) continue; // inside another room
    for (const door of roomOpenings(room).filter((o) => o.kind === 'door')) {
      const wall = roomWalls(room).find((w) => w.name === door.wall);
      if (!wall) continue;
      const along = wall.alongX ? 'x' : 'z';
      // its own (not shared) piece of wall must hold the whole door
      const plain = roomWallSegments(room, door.wall, rooms).some((s) => !s.shared &&
        s.u0 <= door.offset - door.width / 2 + 1e-6 && s.u1 >= door.offset + door.width / 2 - 1e-6);
      if (!plain) continue;
      const n = NORMAL[door.wall];
      const centre = along === 'x'
        ? { x: room.x + door.offset, z: room.z + (door.wall === 'north' ? 1 : -1) * room.depth / 2 }
        : { x: room.x + (door.wall === 'east' ? 1 : -1) * room.width / 2, z: room.z + door.offset };
      const probe = OUTSIDE_PROBE + wallThicknessOf(room) / 2;
      if (insideAnyRoom(rooms, centre.x + n.x * probe, centre.z + n.z * probe)) continue; // another room in front
      out.push({
        roomId: room.id, room, wall: door.wall, index: door.index, width: door.width, ...centre, normal: n,
      });
    }
  }
  return out;
}

/**
 * The main entrance of a floor: a reception's outside door first, then the
 * widest outside door (ties: the one furthest −Z, then −X). null: no door leads outside.
 */
export function mainEntrance(layout, floorId) {
  const doors = outsideDoors(layout, floorId);
  if (!doors.length) return null;
  const rank = (d) => (d.room.type === 'RECEPTION' ? 1 : 0);
  return [...doors].sort((a, b) => rank(b) - rank(a) || b.width - a.width || a.z - b.z || a.x - b.x)[0];
}

/**
 * The nearest cell centre of the walk map where the body fits (FREE; `values`
 * to accept others, e.g. [FREE, STAIRS], or anything not BLOCKED), within
 * `maxDistance`, for which `accept(x, z)` holds. The point itself if its cell
 * is already fine (its cell centre). null: none.
 * @param {import('./walkMap').WalkMap} map
 */
export function nearestFree(map, x, z, { maxDistance = SEARCH_RADIUS, values = [FREE], accept = null } = {}) {
  const ok = new Uint8Array(4);
  for (const v of values) ok[v] = 1;
  const { cell, cols, rows, x0, z0, cells } = map;
  const ci = Math.floor((x - x0) / cell);
  const cj = Math.floor((z - z0) / cell);
  const reach = Math.ceil(maxDistance / cell);
  let best = null;
  let bestD = maxDistance * maxDistance + 1e-9;
  for (let j = Math.max(0, cj - reach); j <= Math.min(rows - 1, cj + reach); j++) {
    const pz = z0 + (j + 0.5) * cell;
    const dz = pz - z;
    if (dz * dz > bestD) continue;
    for (let i = Math.max(0, ci - reach); i <= Math.min(cols - 1, ci + reach); i++) {
      if (!ok[cells[j * cols + i]]) continue;
      const px = x0 + (i + 0.5) * cell;
      const d = (px - x) * (px - x) + dz * dz;
      if (d >= bestD) continue;
      if (accept && !accept(px, pz)) continue;
      bestD = d;
      best = { x: px, z: pz };
    }
  }
  // outside the map (ground floor: further than the street) nothing is in the way: only VOID allowed there
  if (!best && ok[VOID] && map.at(x, z) === VOID) return { x, z, distance: 0 };
  return best && { ...best, distance: Math.sqrt(bestD) };
}

/** Anything but a wall or a solid item (flying, or a VOID spot you'll fall from). */
export const NOT_BLOCKED = [FREE, STAIRS, VOID];

/**
 * Where the walkthrough starts: always on the ground floor (see the header).
 * @param {{ rooms, objects, floors }} layout  store shape (v1 field names)
 * @param {{ catalog?: object, map?: object, maps?: { get(layout, floorId) } }} [options]
 *   map: the ground floor's walk map, maps: a createWalkMapCache (else one is built)
 * @returns {{ x:number, z:number, yaw:number, floor:number,
 *   source: 'spawnPoint' | 'entrance' | 'buildingSide' | 'origin', moved: boolean, door?: object }}
 *   moved: the spot was taken by a wall or furniture, so it is the nearest free spot instead
 */
export function entranceSpawn(layout, options = {}) {
  const floors = layout.floors ?? {};
  const floor = groundFloorId(floors);
  const map = options.map ?? options.maps?.get(layout, floor) ?? buildWalkMap(layout, floor, { catalog: options.catalog });
  const rooms = list(layout.rooms).filter((r) => floorOf(r) === floor);
  const outside = (x, z) => !insideAnyRoom(rooms, x, z, CLEARANCE); // the whole body outside

  /** The body fits at (x, z), else the nearest spot where it does (preferring `accept`). */
  const settle = (x, z, accept) => {
    if (map.isFree(x, z) && (!accept || accept(x, z))) return { x, z, moved: false };
    const spot = (accept && nearestFree(map, x, z, { accept })) || nearestFree(map, x, z)
      || nearestFree(map, x, z, { maxDistance: SEARCH_RADIUS * 4 });
    return spot ? { x: spot.x, z: spot.z, moved: true } : { x, z, moved: false };
  };

  // 1. A spawn point on the ground floor
  const spawn = list(layout.objects).find((o) => o.assetType === 'SPAWN_POINT' && floorOf(o) === floor);
  if (spawn) {
    const at = settle(spawn.x ?? 0, spawn.z ?? 0, null);
    return { x: at.x, z: at.z, yaw: spawn.rotationY ?? 0, floor, source: 'spawnPoint', moved: at.moved };
  }

  // 2. The main entrance: 3 m outside it, facing it
  const door = mainEntrance(layout, floor);
  if (door) {
    const out = ENTRANCE_DISTANCE + wallThicknessOf(door.room) / 2;
    const at = settle(door.x + door.normal.x * out, door.z + door.normal.z * out, outside);
    return { x: at.x, z: at.z, yaw: facingYaw(at, door), floor, source: 'entrance', moved: at.moved, door };
  }

  // 3. No door leads outside: the middle of the building's −Z side
  if (rooms.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.x - r.width / 2);
      x1 = Math.max(x1, r.x + r.width / 2);
      z0 = Math.min(z0, r.z - r.depth / 2 - wallThicknessOf(r) / 2);
    }
    const face = { x: (x0 + x1) / 2, z: z0 };
    const at = settle(face.x, face.z - ENTRANCE_DISTANCE, outside);
    // facing the building straight on (+Z), unless moved aside: then towards the middle of that side
    return { x: at.x, z: at.z, yaw: at.moved ? facingYaw(at, face) : 0, floor, source: 'buildingSide', moved: at.moved };
  }

  // 4. No rooms
  const at = settle(0, -8, null);
  return { x: at.x, z: at.z, yaw: 0, floor, source: 'origin', moved: at.moved };
}
