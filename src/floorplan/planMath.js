/**
 * floorplan/planMath.js
 *
 * PURE maths for the floor plan (FloorPlanView): no React, no Babylon, no DOM.
 * The plan is drawn in world metres: SVG x = world x, SVG y = world z.
 */

import { snap, roomOpenings, WALL_ASSET_LENGTH } from '../play/geometry';
import { placementHeight } from '../play/building';
import { ASSET_TYPES } from '../utils/assetCatalog';

// ── Walls, doors, windows ─────────────────────────────────────────────────

/** A room's four walls: the line along its edge and the way into the room. */
function roomEdges(room) {
  const x0 = room.x - room.width / 2;
  const x1 = room.x + room.width / 2;
  const z0 = room.z - room.depth / 2;
  const z1 = room.z + room.depth / 2;
  // offsets along a wall are measured from the room's centre (geometry.openingOffsetFromHit)
  return {
    north: { at: (u) => ({ x: room.x + u, z: z1 }), half: room.width / 2, inward: { x: 0, z: -1 }, from: { x: x0, z: z1 }, to: { x: x1, z: z1 } },
    south: { at: (u) => ({ x: room.x + u, z: z0 }), half: room.width / 2, inward: { x: 0, z: 1 }, from: { x: x0, z: z0 }, to: { x: x1, z: z0 } },
    east: { at: (u) => ({ x: x1, z: room.z + u }), half: room.depth / 2, inward: { x: -1, z: 0 }, from: { x: x1, z: z0 }, to: { x: x1, z: z1 } },
    west: { at: (u) => ({ x: x0, z: room.z + u }), half: room.depth / 2, inward: { x: 1, z: 0 }, from: { x: x0, z: z0 }, to: { x: x0, z: z1 } },
  };
}

/**
 * A room's walls as plan lines, cut where its doors and windows are
 * (geometry.roomOpenings: the same data the 3D walls are built from).
 * Doors come with their swing: the leaf opens into the room from `hinge`.
 * @returns {{ walls: Array<{a,b}>, doors: Array<{a,b,hinge,open,sweep,width}>, windows: Array<{a,b}> }}
 *          points in world metres; sweep = SVG arc sweep flag from b to open
 */
export function roomWallPieces(room) {
  const edges = roomEdges(room);
  const walls = [];
  const doors = [];
  const windows = [];
  for (const [name, edge] of Object.entries(edges)) {
    const spans = roomOpenings(room)
      .filter((o) => o.wall === name)
      .map((o) => ({ o, u0: Math.max(-edge.half, o.offset - o.width / 2), u1: Math.min(edge.half, o.offset + o.width / 2) }))
      .filter((s) => s.u1 > s.u0)
      .sort((p, q) => p.u0 - q.u0);
    let u = -edge.half;
    for (const s of spans) {
      if (s.u0 > u) walls.push({ a: edge.at(u), b: edge.at(s.u0) });
      u = Math.max(u, s.u1);
      const a = edge.at(s.u0);
      const b = edge.at(s.u1);
      if (s.o.kind === 'window') {
        windows.push({ a, b });
      } else {
        const width = s.u1 - s.u0;
        const open = { x: a.x + edge.inward.x * width, z: a.z + edge.inward.z * width };
        const v1 = { x: b.x - a.x, z: b.z - a.z };
        const v2 = { x: open.x - a.x, z: open.z - a.z };
        doors.push({ a, b, hinge: a, open, width, sweep: v1.x * v2.z - v1.z * v2.x > 0 ? 1 : 0 });
      }
    }
    if (u < edge.half) walls.push({ a: edge.at(u), b: edge.at(edge.half) });
  }
  return { walls, doors, windows };
}

/**
 * The two ends of a free-standing wall (a WALL_SEGMENT item): the inverse of
 * geometry.wallSegmentData. @returns {{a,b}|null}
 */
export function wallSegmentEnds(object) {
  if (object?.assetType !== 'WALL_SEGMENT') return null;
  const half = (WALL_ASSET_LENGTH * (Number(object.scaleX) || 1)) / 2;
  const r = Number(object.rotationY) || 0;
  const dx = Math.cos(r) * half;
  const dz = -Math.sin(r) * half;
  const x = Number(object.x) || 0;
  const z = Number(object.z) || 0;
  return { a: { x: x - dx, z: z - dz }, b: { x: x + dx, z: z + dz } };
}

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
