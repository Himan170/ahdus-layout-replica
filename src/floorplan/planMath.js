/**
 * floorplan/planMath.js
 *
 * PURE maths for the floor plan (FloorPlanView): no React, no Babylon, no DOM.
 * The plan is drawn in world metres: SVG x = world x, SVG y = world z.
 */

import { snap } from '../play/geometry';
import { placementHeight } from '../play/building';
import { ASSET_TYPES } from '../utils/assetCatalog';

// ── Items ─────────────────────────────────────────────────────────────────

/** An item's size on the floor and its height, in metres (catalogue size × scale). */
export function itemSize(object) {
  const type = ASSET_TYPES[object?.assetType] ?? {};
  return {
    width: (Number(type.defaultWidth) || 0.8) * (Number(object?.scaleX) || 1),
    depth: (Number(type.defaultDepth) || 0.8) * (Number(object?.scaleZ) || 1),
    height: (Number(type.defaultHeight) || 0.8) * (Number(object?.scaleY) || 1),
  };
}

/**
 * Is a world point on an item's footprint? The item is turned by rotationY
 * (Babylon: its local x axis points along (cos r, −sin r) in x, z).
 */
export function itemContains(object, point) {
  const { width, depth } = itemSize(object);
  const r = Number(object.rotationY) || 0;
  const dx = point.x - (Number(object.x) || 0);
  const dz = point.z - (Number(object.z) || 0);
  const lx = dx * Math.cos(r) - dz * Math.sin(r);
  const lz = dx * Math.sin(r) + dz * Math.cos(r);
  return Math.abs(lx) <= width / 2 && Math.abs(lz) <= depth / 2;
}

/** True if a point is inside a room's rectangle. */
export function roomContainsPoint(room, point) {
  return Math.abs(point.x - room.x) <= room.width / 2 && Math.abs(point.z - room.z) <= room.depth / 2;
}

/**
 * Where an item dragged in the plan ends up, by Studio's rules: the same snap
 * step as the 3D tools, and the height from placementHeight: on top of the
 * highest other item under it (a monitor on a desk), else on the floor.
 * @param {object} object   the item being moved (store data: y relative to its floor)
 * @param {{x:number,z:number}} point  where it was dropped (world metres)
 * @param {{ objects?: object[], rooms?: object[], snap?: { enabled:boolean, step:number }, ground?: boolean }} ctx
 *        objects / rooms of the same floor; ground: this is the ground floor (outside rooms = the ground)
 * @returns {{ x:number, y:number, z:number } | null}  null for a locked item (it does not move)
 */
export function planDrop(object, point, { objects = [], rooms = [], snap: snapping, ground = false } = {}) {
  if (!object || object.isLocked) return null;
  const s = snapping?.enabled && snapping.step > 0 ? snapping.step : 0;
  const x = s ? snap(point.x, s) : point.x;
  const z = s ? snap(point.z, s) : point.z;
  const at = { x, z };

  let top = null;
  for (const other of objects) {
    if (other.id === object.id || !itemContains(other, at)) continue;
    const t = (Number(other.y) || 0) + itemSize(other).height;
    if (top === null || t > top) top = t;
  }
  const surface = top !== null ? 'object'
    : ground && !rooms.some((r) => roomContainsPoint(r, at)) ? 'ground' : 'floor';
  // y in the store is relative to the floor: work at elevation 0
  const h = placementHeight({ surface, normalY: 1, pointY: top ?? 0, elevation: 0 });
  return { x, y: h.y, z };
}
