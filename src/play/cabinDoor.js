/**
 * play/cabinDoor.js: PURE (v0.18.5). A private cabin's door must lead somewhere people can walk.
 *   cabinDoor(rect, rotationY): the door of a cabin placed turned (its visitors' side, local −Z)
 *   doorLeadsIn(room, rooms, objects, catalog): the floor in front of a door is open floor of the room
 *     the cabin stands in: not past its outer wall, not in another room, no furniture
 *   cabinFixes(room, layout, catalog): Check's ways out for a cabin nobody can walk to: turned in its
 *     place, else moved off the wall (and turned), each as one editor.turnRoom plan
 * Tested in play/__tests__/cabinDoor.test.js.
 */

import { CABIN_DOOR, groupOf } from './prefab';
import { prefabById } from '../catalog/manifest';
import {
  containerOf, roomsInside, itemInRoom, openingCentre, planRoomTurn, planRoomMove, wallThicknessOf,
} from './geometry';
import { itemFootprints, isSolidItem } from './navigation/walkMap';
import { rectsOverlap } from './turnedRect';

/** The floor in front of a door that must be open (m): deep enough to walk to it. */
export const DOOR_APPROACH = 1.0;
/** How far a cabin is moved off a wall, tried in turn (m). */
export const CABIN_SHIFTS = [1, 1.5, 2];

const EPS = 1e-6;
const QUARTER = Math.PI / 2;
const floorOf = (r) => r.floor ?? 0;
const r2 = (v) => Math.round(v * 100) / 100;
const OUT = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const ALONG_X = (wall) => wall === 'north' || wall === 'south';

/** 0 | 1 | 2 | 3 quarter turns (anchors' rotationY: +π/2 turns local −Z to world −X). */
const quarters = (rotationY) => ((Math.round((rotationY ?? 0) / QUARTER) % 4) + 4) % 4;

/**
 * The door of a cabin whose room is `rect` (already turned: width / depth swapped on a quarter turn),
 * placed at `rotationY`: in its visitors' wall, towards the end on the desk's right, as before v0.18.5.
 */
export function cabinDoor(rect, rotationY = 0) {
  const k = quarters(rotationY);
  const localWidth = k % 2 ? rect.depth : rect.width;
  const lx = r2(localWidth / 2 - 0.9); // the door's middle along its wall, in the cabin's own frame
  const [wall, offset] = [['south', lx], ['west', -lx], ['north', -lx], ['east', lx]][k];
  return { wall, offset: offset === 0 ? 0 : offset, width: CABIN_DOOR.width, height: CABIN_DOOR.height };
}

/** The open floor a door needs in front of it: an axis-aligned box outside its wall. */
function approach(room, door) {
  const c = openingCentre(room, door.wall, door.offset ?? 0);
  const n = OUT[door.wall];
  const t = wallThicknessOf(room) / 2;
  const half = (door.width ?? CABIN_DOOR.width) / 2 + 0.1;
  const near = t;
  const far = t + DOOR_APPROACH;
  if (ALONG_X(door.wall)) {
    const z0 = c.z + n.z * near;
    const z1 = c.z + n.z * far;
    return { x0: c.x - half, x1: c.x + half, z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }
  const x0 = c.x + n.x * near;
  const x1 = c.x + n.x * far;
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: c.z - half, z1: c.z + half };
}

const footprint = (r) => ({ x0: r.x - r.width / 2, x1: r.x + r.width / 2, z0: r.z - r.depth / 2, z1: r.z + r.depth / 2 });
const crosses = (a, b) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;
const holds = (outer, b) => b.x0 >= outer.x0 - 1e-3 && b.x1 <= outer.x1 + 1e-3 && b.z0 >= outer.z0 - 1e-3 && b.z1 <= outer.z1 + 1e-3;
const innerOf = (room) => {
  const t = wallThicknessOf(room) / 2;
  const f = footprint(room);
  return { x0: f.x0 + t, x1: f.x1 - t, z0: f.z0 + t, z1: f.z1 - t };
};

/**
 * Does some door of `room` open onto floor people can walk? In front of it (DOOR_APPROACH): inside the
 * room it stands in (none: the open floor), in no other room, no solid item (its own items don't count).
 */
export function doorLeadsIn(room, rooms, objects, catalog) {
  const floor = floorOf(room);
  const own = new Set([room.id, ...roomsInside(room, rooms).map((r) => r.id)]);
  const others = rooms.filter((r) => floorOf(r) === floor && !own.has(r.id));
  const home = containerOf(room, others);
  const solid = objects.filter((o) => floorOf(o) === floor && !itemInRoom(room, o) && isSolidItem(o, catalog));
  return (room.doors ?? []).some((door) => {
    const box = approach(room, door);
    if (home && !holds(innerOf(home), box)) return false;
    if (others.some((r) => r !== home && crosses(box, footprint(r)))) return false;
    const rect = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2, hw: (box.x1 - box.x0) / 2, hd: (box.z1 - box.z0) / 2, rot: 0 };
    return !solid.some((o) => itemFootprints(o, catalog).some((fp) => rectsOverlap(fp, rect, 0.02)));
  });
}

/** A cabin: its type, or a private-cabin prefab standing in it. */
export function isCabin(room, objects) {
  if (room?.type === 'CABIN') return true;
  return objects.some((o) => itemInRoom(room, o) && prefabById(groupOf(o)?.prefab)?.layout === 'cabin');
}

/**
 * The room turned `k` quarter turns in its place (planRoomTurn, again and again), then moved by (dx, dz)
 * (planRoomMove: snapped, kept inside the room it stands in): the plan for editor.turnRoom
 * { patch, rooms, objects } and the layout after it, or null when it can't.
 */
function turnAndMove(room, rooms, objects, k, dx = 0, dz = 0) {
  let r = room;
  const roomPatch = {};
  const inner = new Map();
  const items = new Map();
  const merge = (map, list) => { for (const [id, p] of list) map.set(id, { ...map.get(id), ...p }); };
  const now = () => ({
    rooms: rooms.map((x) => (x.id === room.id ? r : inner.has(x.id) ? { ...x, ...inner.get(x.id) } : x)),
    objects: objects.map((o) => (items.has(o.id) ? { ...o, ...items.get(o.id) } : o)),
  });
  for (let i = 0; i < k; i++) {
    const s = now();
    const plan = planRoomTurn(r, s.rooms, s.objects);
    if (plan.problem) return null;
    Object.assign(roomPatch, plan.patch);
    r = { ...r, ...plan.patch };
    merge(inner, plan.rooms);
    merge(items, plan.objects);
  }
  if (dx || dz) {
    const s = now();
    const plan = planRoomMove(r, r.x + dx, r.z + dz, s.rooms, s.objects);
    if (plan.blocker || (Math.abs(plan.dx) < 0.05 && Math.abs(plan.dz) < 0.05)) return null;
    Object.assign(roomPatch, { x: plan.rect.x, z: plan.rect.z });
    r = { ...r, x: plan.rect.x, z: plan.rect.z };
    merge(inner, plan.rooms);
    merge(items, plan.objects);
  }
  return { fix: { id: room.id, patch: roomPatch, rooms: [...inner], objects: [...items] }, after: now(), room: r };
}

/**
 * Ways to give a cabin nobody can walk to a door that leads somewhere: turned in its place (90°, 180°,
 * 270°), else moved off the wall its door faces (CABIN_SHIFTS) as it is or turned. Only those whose door
 * opens onto free floor (doorLeadsIn), best first; nothing while it, a room in it or an item in it is
 * locked. Check keeps the first one its re-check clears.
 * @returns {{ label: string, room: { id, patch, rooms, objects } }[]}
 */
export function cabinFixes(room, layout, catalog) {
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : Object.values(layout.rooms ?? {});
  const objects = Array.isArray(layout.objects) ? layout.objects : Object.values(layout.objects ?? {});
  if (!room || room.isLocked || !(room.doors ?? []).length) return [];
  if (roomsInside(room, rooms).some((r) => r.isLocked) || objects.some((o) => o.isLocked && itemInRoom(room, o))) return [];
  const out = [];
  const keep = (plan, label) => {
    if (plan && doorLeadsIn(plan.room, plan.after.rooms, plan.after.objects, catalog)) out.push({ label, room: plan.fix });
  };
  for (const k of [1, 2, 3]) keep(turnAndMove(room, rooms, objects, k), 'Turn the cabin');
  for (const k of [0, 1, 2, 3]) {
    // off the wall in front of its door (after the turn): away from it
    const turned = k ? turnAndMove(room, rooms, objects, k) : { room };
    if (!turned) continue;
    const n = OUT[turned.room.doors?.[0]?.wall] ?? null;
    if (!n) continue;
    for (const d of CABIN_SHIFTS) keep(turnAndMove(room, rooms, objects, k, -n.x * d, -n.z * d), 'Move the cabin');
  }
  return out;
}
