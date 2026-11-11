/**
 * floorplan/planMath.js
 *
 * PURE maths for the floor plan (FloorPlanView): no React, no Babylon, no DOM.
 * The plan is drawn in world metres with north (+z) up, as in Studio's 2D view:
 * plan (SVG) x = world x, plan y = −world z (toPlan / toWorld).
 */

import { snap, roomOpenings, WALL_ASSET_LENGTH } from '../play/geometry';
import { placementHeight, canStandOn, floorOnlyText, FLOOR_LIKE_TYPES } from '../play/building';
import { carriedBy } from '../play/carry';
import { ASSET_TYPES } from '../utils/assetCatalog';

// ── World ↔ plan ↔ screen ─────────────────────────────────────────────────

/** World { x, z } → plan { x, y }. */
export function toPlan(p) {
  return { x: p.x, y: -p.z };
}

/** Plan { x, y } → world { x, z }. */
export function toWorld(q) {
  return { x: q.x, z: -q.y };
}

/**
 * A pointer position → world, through the SVG's inverse screen matrix
 * (svg.getScreenCTM().inverse(): { a, b, c, d, e, f }).
 */
export function screenToWorld(clientX, clientY, inv) {
  return toWorld({
    x: inv.a * clientX + inv.c * clientY + inv.e,
    y: inv.b * clientX + inv.d * clientY + inv.f,
  });
}

/** SVG rotate() angle in degrees for an item turned by rotationY (its local x axis is (cos r, −sin r) in x, z). */
export function planAngle(rotationY) {
  return ((Number(rotationY) || 0) * 180) / Math.PI;
}

/**
 * The viewBox that shows every room and item of the floor, `padding` metres
 * around them, in plan coordinates. @returns {{x,y,width,height}|null} null when there is nothing
 */
export function planViewBox(rooms = [], objects = [], padding = 2) {
  const boxes = [
    ...rooms.map((r) => ({ x: r.x, z: r.z, hw: r.width / 2, hd: r.depth / 2 })),
    ...objects.map((o) => {
      const { width, depth } = itemSize(o);
      const r = Number(o.rotationY) || 0;
      const c = Math.abs(Math.cos(r));
      const s = Math.abs(Math.sin(r));
      return { x: Number(o.x) || 0, z: Number(o.z) || 0, hw: (c * width + s * depth) / 2, hd: (s * width + c * depth) / 2 };
    }),
  ].filter((b) => [b.x, b.z, b.hw, b.hd].every(Number.isFinite));
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b.x - b.hw));
  const maxX = Math.max(...boxes.map((b) => b.x + b.hw));
  const minZ = Math.min(...boxes.map((b) => b.z - b.hd));
  const maxZ = Math.max(...boxes.map((b) => b.z + b.hd));
  return {
    x: minX - padding,
    y: -maxZ - padding,
    width: Math.max(maxX - minX, 1) + padding * 2,
    height: Math.max(maxZ - minZ, 1) + padding * 2,
  };
}

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
 *          points in world metres; sweep = SVG arc sweep flag from b to open, in plan coordinates
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
        // plan y = −z mirrors the turn: a clockwise turn in x, z is counter-clockwise in the plan
        doors.push({ a, b, hinge: a, open, width, sweep: v1.x * v2.z - v1.z * v2.x < 0 ? 1 : 0 });
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
 * The items that move with `object` (from the data alone: the plan has no meshes): its chair
 * (a desk; carry.carriedBy) and what stands on it (its foot at the item's top, inside its outline).
 * @returns {object[]}
 */
export function planCarried(object, objects = []) {
  const top = (Number(object.y) || 0) + itemSize(object).height;
  const riders = objects.filter((o) => o.id !== object.id && (o.floor ?? 0) === (object.floor ?? 0) &&
    Math.abs((Number(o.y) || 0) - top) < 0.2 && itemContains(object, { x: Number(o.x) || 0, z: Number(o.z) || 0 }));
  return carriedBy(object, objects, riders).map((c) => c.item);
}

/**
 * Where an item dragged in the plan ends up, by Studio's rules: the same snap
 * step as the 3D tools, and the height from placementHeight: on top of the
 * highest other item under it (a monitor on a desk), else on the floor.
 * @param {object} object   the item being moved (store data: y relative to its floor)
 * @param {{x:number,z:number}} point  where it was dropped (world metres)
 * @param {{ objects?: object[], rooms?: object[], snap?: { enabled:boolean, step:number }, ground?: boolean, ignore?: string[] }} ctx
 *        objects / rooms of the same floor; ground: this is the ground floor (outside rooms = the ground);
 *        ignore: more item ids that are no surface (what moves with it is left out by itself: planCarried)
 * @returns {{ x:number, y:number, z:number } | { problem: string } | null}  null for a locked item (it does not
 *          move); { problem } for a floor-only item over a table top (it does not move either)
 */
export function planDrop(object, point, { objects = [], rooms = [], snap: snapping, ground = false, ignore = [] } = {}) {
  if (!object || object.isLocked) return null;
  const s = snapping?.enabled && snapping.step > 0 ? snapping.step : 0;
  const x = s ? snap(point.x, s) : point.x;
  const z = s ? snap(point.z, s) : point.z;
  const at = { x, z };

  // What moves with it is no surface for it: a desk dragged onto the spot where its own chair
  // stood ended up on that chair (1.10 m up)
  const moving = new Set([object.id, ...ignore, ...planCarried(object, objects).map((o) => o.id)]);
  let top = null;
  let under = null; // the item it would stand on
  for (const other of objects) {
    if (moving.has(other.id) || !itemContains(other, at)) continue;
    // a rug or a floor marker lies on the floor: what is dropped there stands on the floor
    if (FLOOR_LIKE_TYPES.has(other.assetType) && !(Number(other.y) > 0.1)) continue;
    const t = (Number(other.y) || 0) + itemSize(other).height;
    if (top === null || t > top) { top = t; under = other; }
  }
  const surface = top !== null ? 'object'
    : ground && !rooms.some((r) => roomContainsPoint(r, at)) ? 'ground' : 'floor';
  // a floor-only item (a Large Plant) can't go on a table top: it does not move, and says why
  if (!canStandOn(object.assetType, surface, under?.assetType)) {
    return { problem: floorOnlyText(object.label || ASSET_TYPES[object.assetType]?.label) };
  }
  // y in the store is relative to the floor: work at elevation 0
  const h = placementHeight({ surface, normalY: 1, pointY: top ?? 0, elevation: 0 });
  return { x, y: h.y, z };
}

// ── Zoom, pan and dimensions ──────────────────────────────────────────────

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

/** Clamps a zoom level between MIN_ZOOM and MAX_ZOOM. */
export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z) || 1));
}

/**
 * Calculates the dynamic viewBox in plan coordinates given the base view box,
 * zoom scale, and pan offsets.
 * @returns {{ x: number, y: number, width: number, height: number, viewBoxStr: string }}
 */
export function zoomViewBox(baseView, zoom = 1, pan = { x: 0, y: 0 }) {
  if (!baseView) return null;
  const z = clampZoom(zoom);
  const w = baseView.width / z;
  const h = baseView.height / z;
  const cx = baseView.x + baseView.width / 2 + (pan?.x || 0);
  const cy = baseView.y + baseView.height / 2 + (pan?.y || 0);
  const x = cx - w / 2;
  const y = cy - h / 2;
  return {
    x,
    y,
    width: w,
    height: h,
    viewBoxStr: `${x} ${y} ${w} ${h}`,
  };
}

/**
 * Zoom towards a cursor point in plan coordinates.
 * Returns the new pan { x, y } such that cursorPlan remains under the cursor.
 */
export function zoomTowards(cursorPlan, baseView, currentZoom, targetZoom, currentPan) {
  const z0 = clampZoom(currentZoom);
  const z1 = clampZoom(targetZoom);
  if (z0 === z1 || !baseView) return currentPan;

  const cx0 = baseView.x + baseView.width / 2 + (currentPan?.x || 0);
  const cy0 = baseView.y + baseView.height / 2 + (currentPan?.y || 0);

  const ratio = z0 / z1;
  const cx1 = cursorPlan.x - (cursorPlan.x - cx0) * ratio;
  const cy1 = cursorPlan.y - (cursorPlan.y - cy0) * ratio;

  return {
    x: cx1 - (baseView.x + baseView.width / 2),
    y: cy1 - (baseView.y + baseView.height / 2),
  };
}

/** Dimension annotation lines for a room (plan coordinates). */
export function roomDimensionLines(room, offset = 0.4) {
  const c = toPlan(room);
  const w = Number(room.width);
  const d = Number(room.depth);
  const halfW = w / 2;
  const halfD = d / 2;

  // Top (North) dimension: width
  const topY = c.y - halfD - offset;
  const top = {
    x1: c.x - halfW,
    y1: topY,
    x2: c.x + halfW,
    y2: topY,
    textX: c.x,
    textY: topY - 0.15,
    label: `${w.toFixed(1)} m`,
    tick1: { x1: c.x - halfW, y1: topY - 0.15, x2: c.x - halfW, y2: topY + 0.15 },
    tick2: { x1: c.x + halfW, y1: topY - 0.15, x2: c.x + halfW, y2: topY + 0.15 },
  };

  // Right (East) dimension: depth
  const rightX = c.x + halfW + offset;
  const right = {
    x1: rightX,
    y1: c.y - halfD,
    x2: rightX,
    y2: c.y + halfD,
    textX: rightX + 0.18,
    textY: c.y,
    label: `${d.toFixed(1)} m`,
    tick1: { x1: rightX - 0.15, y1: c.y - halfD, x2: rightX + 0.15, y2: c.y - halfD },
    tick2: { x1: rightX - 0.15, y1: c.y + halfD, x2: rightX + 0.15, y2: c.y + halfD },
  };

  return { top, right };
}

/** About how wide one character of the label font is, in font sizes (Inter, semibold: a little generous). */
export const LABEL_CHAR_WIDTH = 0.6;

/**
 * A room's name label in the plan (v0.15.5): as big as before where it fits, smaller to fit
 * the room's width (88 % of it), and cut with "…" when even `minFont` is too wide.
 * → { text, full, fontSize, sizeFontSize, truncated }
 */
export function roomLabelFit(name, width, depth, { fill = 0.88, minFont = 0.14 } = {}) {
  const full = String(name ?? '').trim() || 'Room';
  const w = Math.max(0, Number(width) || 0);
  const d = Math.max(0, Number(depth) || 0);
  const maxFont = Math.max(0.12, Math.min(w, d) * 0.12);
  const room = w * fill;
  const widthAt = (text, font) => text.length * LABEL_CHAR_WIDTH * font;
  const floorFont = Math.min(minFont, maxFont);
  let fontSize = Math.min(maxFont, room / (full.length * LABEL_CHAR_WIDTH));
  let text = full;
  if (!(fontSize >= floorFont)) {
    fontSize = floorFont;
    const chars = Math.max(1, Math.floor(room / (LABEL_CHAR_WIDTH * fontSize)) - 1);
    text = chars >= full.length ? full : `${full.slice(0, chars).trimEnd()}…`;
  }
  const sizeFontSize = Math.max(0.09, Math.min(fontSize * 0.7, Math.min(w, d) * 0.08));
  return { text, full, fontSize, sizeFontSize, truncated: text !== full, fits: widthAt(text, fontSize) <= room + 1e-9 };
}

export const ANCHOR_COLORS = {
  workstation: '#2563eb',
  seat: '#6366f1',
  reception: '#10b981',
  machine: '#f59e0b',
  spawn: '#8b5cf6',
  'info-point': '#0ea5e9',
};

export const ANCHOR_BADGE_SYMBOLS = {
  workstation: 'W',
  seat: 'S',
  reception: 'R',
  machine: 'M',
  spawn: 'P',
  'info-point': 'i',
};

