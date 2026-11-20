/**
 * play/prefabDrop.js: PURE (v0.18.0). Where a prefab from the library lands, and what it becomes.
 *   planPrefabDrop: the outline at a point on the floor, and why it can't go there (overlaps a desk,
 *     crosses a wall, too big for its room; a cabin: its room overlaps another one)
 *   prefabPlacement: the store data to add in ONE undo step (editor.placePrefab): the items with their
 *     room, and a cabin's room with its door
 * v0.18.5: a cabin turns (a quarter at a time) so its door opens onto open floor, never onto a wall
 * Tested in play/__tests__/prefabDrop.test.js.
 */

import { layoutPrefab, prefabItems, prefabOutline } from './prefab';
import { cabinDoor, doorLeadsIn } from './cabinDoor';
import { planRoomAt, wallThicknessOf } from './geometry';
import { itemFootprints, isSolidItem } from './navigation/walkMap';
import { rectsOverlap, boxOf } from './turnedRect';
import { dropAisle, groupOutline, AISLE_LAYOUTS } from './aisles';

const EPS = 1e-6;
const floorOf = (o) => o.floor ?? 0;
const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
const nameOf = (obj, catalog) => obj.label || catalog[obj.assetType]?.label || 'an item';

/** The innermost room on `floor` whose footprint holds the point, or null. */
export function roomHolding(rooms, floor, x, z) {
  let best = null;
  for (const r of rooms) {
    if (floorOf(r) !== floor) continue;
    if (Math.abs(x - r.x) > r.width / 2 + EPS || Math.abs(z - r.z) > r.depth / 2 + EPS) continue;
    if (!best || r.width * r.depth < best.width * best.depth) best = r;
  }
  return best;
}

/** A room's floor inside its walls, as an axis-aligned box. */
function innerBox(room) {
  const t = wallThicknessOf(room) / 2;
  return { x0: room.x - room.width / 2 + t, x1: room.x + room.width / 2 - t, z0: room.z - room.depth / 2 + t, z1: room.z + room.depth / 2 - t };
}
const boxInside = (b, outer) => b.x0 >= outer.x0 - 1e-3 && b.x1 <= outer.x1 + 1e-3 && b.z0 >= outer.z0 - 1e-3 && b.z1 <= outer.z1 + 1e-3;
const boxesCross = (a, b) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;

/**
 * A prefab dropped with its middle at `point` on the floor being edited.
 * @param {object} prefab  catalog/manifest.js PREFABS entry
 * @param {{ rooms: object[], objects: object[], floor: number }} layout  rooms and items (all floors are fine)
 * @param {{ params?, snapStep?, rotationY?, catalog }} opts  rotationY: as given; a cabin without one turns
 *   its door to open floor (play/cabinDoor.js), the first of 0, 180°, 90°, −90° that has it
 * @returns {{ at, rect: { x, z, width, depth }, outline, room: object|null, problem: string|null }}
 *   room: a cabin's room rectangle (planRoomAt: snapped like a drawn room)
 *   warning: it can go there, but leaves an aisle under 0.9 m (play/aisles.js), else null
 */
export function planPrefabDrop(prefab, point, layout, { params = {}, snapStep = 0, rotationY, catalog }) {
  const { room: cabin } = layoutPrefab(prefab, params, catalog);
  if (!cabin || rotationY !== undefined) return planAt(prefab, point, layout, { params, snapStep, rotationY: rotationY ?? 0, catalog });
  // v0.18.5: the cabin turned so its door leads in; none does: as it was (Check says so)
  const tries = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((rot) => planAt(prefab, point, layout, { params, snapStep, rotationY: rot, catalog }));
  const rooms = layout.rooms.filter((r) => floorOf(r) === layout.floor);
  const objects = layout.objects.filter((o) => floorOf(o) === layout.floor);
  const opens = (t) => {
    const room = { id: '__cabin', floor: layout.floor, ...t.room, doors: [cabinDoor(t.room, t.at.rotationY)] };
    return doorLeadsIn(room, [...rooms, room], objects, catalog);
  };
  return tries.find((t) => !t.problem && opens(t)) ?? tries.find((t) => !t.problem) ?? tries[0];
}

function planAt(prefab, point, layout, { params, snapStep, rotationY, catalog }) {
  const { width, depth, room: cabin } = layoutPrefab(prefab, params, catalog);
  const quarter = Math.abs(Math.sin(rotationY)) > 0.7; // a cabin's room turned a quarter: width and depth swap
  const rooms = layout.rooms.filter((r) => floorOf(r) === layout.floor);
  let at = { x: snap(point.x, snapStep), z: snap(point.z, snapStep), rotationY, floor: layout.floor };
  let roomRect = null;
  let problem = null;
  if (cabin) {
    const plan = planRoomAt({ x: at.x, z: at.z }, quarter ? cabin.depth : cabin.width, quarter ? cabin.width : cabin.depth, rooms, null);
    roomRect = plan.rect;
    at = { ...at, x: plan.rect.x, z: plan.rect.z };
    if (plan.blocker) problem = `Overlaps ${plan.blocker.name}`;
  }
  const outline = prefabOutline(prefab, params, catalog, at);
  const box = boxOf(outline);
  if (!problem && !cabin) {
    const home = roomHolding(rooms, layout.floor, at.x, at.z);
    if (home && !boxInside(box, innerBox(home))) problem = `Too big for ${home.name} here`;
    if (!problem) {
      // no wall through it: a room it reaches into without lying wholly inside it (its own room's
      // outer rooms hold it, so they don't count)
      const footprint = (r) => ({ x0: r.x - r.width / 2, x1: r.x + r.width / 2, z0: r.z - r.depth / 2, z1: r.z + r.depth / 2 });
      const crossed = rooms.find((r) => r !== home && boxesCross(box, footprint(r)) && !boxInside(box, footprint(r)));
      if (crossed) problem = `Crosses the wall of ${crossed.name}`;
    }
  }
  if (!problem) {
    const items = layout.objects.filter((o) => floorOf(o) === layout.floor && isSolidItem(o, catalog));
    const hit = items.find((o) => itemFootprints(o, catalog).some((fp) => rectsOverlap(fp, outline, 0.02)));
    if (hit) problem = `Overlaps ${nameOf(hit, catalog)}`;
  }
  // measured as Check measures it (the members' own footprints), so the hint and Check give the same number
  let warning = null;
  if (!problem && AISLE_LAYOUTS.has(prefab.layout)) {
    let n = 0;
    const members = prefabItems(prefab, params, catalog, at, { groupId: 'drop', idFor: () => `drop_${++n}` });
    warning = dropAisle(groupOutline(prefab, members, catalog) ?? outline, layout, layout.floor, catalog)?.text ?? null;
  }
  return { at, rect: { x: at.x, z: at.z, width: quarter ? depth : width, depth: quarter ? width : depth }, outline, room: roomRect, problem, warning };
}

/**
 * The store data of a prefab placed at `at`: { room, objects } for editor.placePrefab. Every item gets its
 * room (the cabin's own room, else the innermost room holding it) and its category.
 * @param {{ groupId: string, newId: () => string, roomId?: string }} ids  roomId: a cabin's new room id
 */
export function prefabPlacement(prefab, params, catalog, at, rooms, { groupId, newId, roomId = null, roomRect = null }) {
  const { room: cabin } = layoutPrefab(prefab, params, catalog);
  let room = null;
  if (cabin) {
    const quarter = Math.abs(Math.sin(at.rotationY ?? 0)) > 0.7;
    const rect = roomRect ?? { x: at.x, z: at.z, width: quarter ? cabin.depth : cabin.width, depth: quarter ? cabin.width : cabin.depth };
    room = {
      id: roomId,
      type: cabin.type,
      name: cabin.name,
      floor: at.floor ?? 0,
      ...rect,
      // the door in the front wall (the visitors' side, local −Z), towards the desk's right end; turned with it
      doors: [cabinDoor(rect, at.rotationY ?? 0)],
      windows: [],
    };
  }
  const objects = prefabItems(prefab, params, catalog, at, { groupId, idFor: () => newId() }).map((o) => ({
    ...o,
    category: catalog[o.assetType]?.category || 'Furniture',
    roomId: room ? room.id : roomHolding(rooms, floorOf(o), o.x, o.z)?.id ?? null,
  }));
  return { room, objects };
}
