/**
 * store/layoutData.js
 *
 * Pure helpers for SAVED layouts (no store, no Babylon; unit-tested):
 *   normaliseLayout(data)  any save, old or new → the shape the store expects.
 *                          Fills defaults for fields older versions of the app
 *                          didn't write (floors, floor heights, anchorData, door
 *                          and window sizes, ...). Never throws on missing fields.
 *   layoutSummary(data)    what the layout list shows: name, rooms, floors, last edit.
 *
 * Field names stay v1 (floor, isLocked, scaleX, ...): see CLAUDE.md rule 2.
 */

import { STOREY_HEIGHT, SLAB, MIN_FLOOR_HEIGHT, MAX_FLOOR_HEIGHT } from '../play/building';
import { DOOR_DEFAULTS, WINDOW_DEFAULTS } from '../play/geometry';

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** rooms/objects were saved as arrays; accept a { id: record } map too. */
const asList = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const WALLS = new Set(['north', 'south', 'east', 'west']);

function normaliseOpening(o, kind) {
  const d = kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  const out = {
    ...o,
    wall: WALLS.has(o?.wall) ? o.wall : 'north',
    offset: num(o?.offset, 0),
    width: num(o?.width, d.width),
    height: num(o?.height, d.height),
  };
  if (kind === 'window') out.sill = num(o?.sill, d.sill);
  return out;
}

function normaliseRoom(r, i) {
  const { isSelected: _sel, ...rest } = r;
  return {
    type: 'OFFICE',
    name: `Room ${i + 1}`,
    color: '#4a7dff',
    ...rest,
    id: String(r.id ?? `room_${i + 1}`),
    floor: num(r.floor, 0),
    x: num(r.x, 0),
    z: num(r.z, 0),
    width: num(r.width, 4),
    depth: num(r.depth, 4),
    wallHeight: num(r.wallHeight, undefined), // filled in with the floors (normaliseFloors)
    doors: asList(r.doors).filter(Boolean).map((o) => normaliseOpening(o, 'door')),
    windows: asList(r.windows).filter(Boolean).map((o) => normaliseOpening(o, 'window')),
  };
}

function normaliseObject(o, i) {
  const { isSelected: _sel, ...rest } = o;
  return {
    category: 'Furniture',
    roomId: null,
    label: '',
    department: '',
    metadata: {},
    ...rest,
    id: String(o.id ?? `obj_${i + 1}`),
    assetType: o.assetType ?? 'DESK_STANDARD',
    floor: num(o.floor, 0),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    rotationX: num(o.rotationX, 0),
    rotationY: num(o.rotationY, 0),
    rotationZ: num(o.rotationZ, 0),
    scaleX: num(o.scaleX, 1),
    scaleY: num(o.scaleY, 1),
    scaleZ: num(o.scaleZ, 1),
    isLocked: !!o.isLocked,
  };
}

/** The slab older versions of the app drew between storeys (3 m walls + 0.5 m = 3.5 m). */
const OLD_SLAB = 0.5;
const cm = (v) => Math.round(v * 100) / 100;

/**
 * Floors: saved as { id: floor } (or an array). Every floor a room or item is
 * on must exist, and the ground floor always does. Each floor gets a height
 * (floor-to-floor); its elevation is never stored (building.elevationOf).
 *
 * Saves from before floor heights stored an elevation per floor instead. Those
 * floors keep their place: height = distance to the next floor up. Their
 * rooms whose walls met the old 0.5 m slab still meet the new SLAB (walls grow
 * by 0.2 m). Afterwards every floor is at least as tall as its tallest walls
 * + SLAB, so no walls poke into the floor above. Changes `rooms` in place.
 */
function floorRenumberMap(saved, rooms, objects) {
  const explicitFloors = asList(saved).filter((f) => f && typeof f === 'object' && f.id !== undefined);
  if (!explicitFloors.length) return new Map();

  const ids = new Set();
  for (const f of explicitFloors) {
    const id = num(Number(f.id), null);
    if (id !== null && Number.isFinite(id)) ids.add(id);
  }
  for (const r of rooms) {
    const id = num(Number(r.floor), null);
    if (id !== null && Number.isFinite(id)) ids.add(id);
  }
  for (const o of objects) {
    const id = num(Number(o.floor), null);
    if (id !== null && Number.isFinite(id)) ids.add(id);
  }

  const sorted = [...ids].sort((a, b) => a - b);
  if (!sorted.length) return new Map();
  const remap = new Map();
  sorted.forEach((oldId, index) => remap.set(oldId, index));
  return remap;
}

function normaliseFloors(saved, rooms, objects, remap = new Map()) {
  const floors = {};
  const oldStyle = new Set();
  for (const f of asList(saved)) {
    if (!f || typeof f !== 'object') continue;
    const oldId = num(Number(f.id), null);
    if (oldId === null) continue;
    const id = remap.get(oldId) ?? oldId;
    const { elevation: _elevation, ...rest } = f;
    floors[id] = {
      ...rest,
      id,
      name: typeof f.name === 'string' && f.name ? f.name : id === 0 ? 'Ground Floor' : `Floor ${id}`,
    };
    if (!(num(f.height, 0) > 0)) {
      oldStyle.add(id);
      floors[id].oldElevation = num(f.elevation, oldId * STOREY_HEIGHT);
    }
  }
  const implicitIds = remap.size
    ? [...new Set(Array.from(remap.values()).sort((a, b) => a - b))]
    : [0, ...rooms.map((r) => r.floor), ...objects.map((o) => o.floor)];
  for (const id of [...new Set(implicitIds.map((v) => Number.isFinite(v) ? v : 0))]) {
    if (!floors[id]) {
      floors[id] = { id, name: id === 0 ? 'Ground Floor' : `Floor ${id}`, oldElevation: id * STOREY_HEIGHT };
      oldStyle.add(id);
    }
  }

  const sorted = Object.values(floors).sort((a, b) => a.id - b.id);
  sorted.forEach((f, i) => {
    if (oldStyle.has(f.id)) {
      const next = sorted[i + 1];
      const gap = next && oldStyle.has(next.id) ? next.oldElevation - f.oldElevation : NaN;
      f.height = gap >= MIN_FLOOR_HEIGHT && gap <= MAX_FLOOR_HEIGHT ? cm(gap) : STOREY_HEIGHT;
      // Walls that met the old slab fill the floor (missing wallHeight = the old 3 m default)
      for (const r of rooms) {
        if (r.floor !== f.id) continue;
        const wh = r.wallHeight ?? 3;
        r.wallHeight = Math.abs(wh - (f.height - OLD_SLAB)) < 0.005 ? cm(f.height - SLAB) : wh;
      }
    } else {
      f.height = num(f.height, STOREY_HEIGHT);
      for (const r of rooms) {
        if (r.floor === f.id && r.wallHeight === undefined) r.wallHeight = cm(f.height - SLAB);
      }
    }
    delete f.oldElevation;
    const tallest = Math.max(0, ...rooms.filter((r) => r.floor === f.id).map((r) => r.wallHeight));
    f.height = cm(Math.min(MAX_FLOOR_HEIGHT, Math.max(f.height, MIN_FLOOR_HEIGHT, tallest + SLAB)));
  });
  return floors;
}

/**
 * @param {object} data  a saved layout (any version) or null
 * @returns {{ layoutName: string, layoutVersion: number, floors: object,
 *             rooms: object[], objects: object[], anchorData: object }}
 */
export function normaliseLayout(data) {
  const src = data && typeof data === 'object' ? data : {};
  const rooms = asList(src.rooms).filter((r) => r && typeof r === 'object').map(normaliseRoom);
  const objects = asList(src.objects).filter((o) => o && typeof o === 'object').map(normaliseObject);
  const floorMap = floorRenumberMap(src.floors, rooms, objects);

  if (floorMap.size) {
    for (const r of rooms) {
      const oldFloor = num(Number(r.floor), null);
      if (oldFloor !== null && Number.isFinite(oldFloor)) r.floor = floorMap.get(oldFloor) ?? 0;
    }
    for (const o of objects) {
      const oldFloor = num(Number(o.floor), null);
      if (oldFloor !== null && Number.isFinite(oldFloor)) o.floor = floorMap.get(oldFloor) ?? 0;
    }
  }

  const floors = normaliseFloors(src.floors, rooms, objects, floorMap);

  const anchorData = src.anchorData && typeof src.anchorData === 'object' && !Array.isArray(src.anchorData)
    ? src.anchorData : {};

  return {
    layoutName: typeof src.layoutName === 'string' && src.layoutName.trim() ? src.layoutName : 'Untitled Layout',
    layoutVersion: num(src.layoutVersion, 1),
    floors,
    rooms,
    objects,
    anchorData,
  };
}

/**
 * What the layout list shows for one saved layout.
 * @returns {{ id, name, rooms: number, floors: number, updatedAt: string|null }}
 */
export function layoutSummary(id, data) {
  const n = normaliseLayout(data);
  return {
    id,
    name: n.layoutName,
    rooms: n.rooms.length,
    floors: Object.keys(n.floors).length,
    updatedAt: data?.savedAt ?? data?.exportedAt ?? null,
  };
}
