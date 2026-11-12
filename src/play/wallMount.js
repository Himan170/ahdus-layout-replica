/**
 * play/wallMount.js (v0.15.6)
 *
 * PURE: things that hang on a wall (a TV, a whiteboard, a clock, an exit sign…). One rule for Studio's
 * library and drag, Plan view and Walk through: the item goes onto the nearest wall face, its back against
 * it, facing away from it (into the room), at its own height (WALL_ITEMS), sliding along the wall. It is
 * always fully backed by wall: never in or through a wall, never across a door or a window (an exit sign
 * goes ABOVE a door: the wall over the door backs it). Nothing new is saved: the item's x, z, y and
 * rotationY are where it hangs, so a hung item is found again from those (isOnWall).
 *
 * The walls are the ones roomBuilder builds (roomWallSegments: shared walls once, cut by the doors and
 * windows of both rooms) plus the walls drawn with the Wall tool (WALL_SEGMENT items, at any angle).
 * Heights are relative to the floor (as the store keeps an item's y).
 * Babylon turns an item's local +Z to (sin θ, cos θ): an item faces n when θ = atan2(n.x, n.z). The
 * primitive models stand on y = 0 with their back at −depth / 2 (`back` where that is not so).
 */

import {
  roomWalls, roomWallSegments, wallSegmentOpenings, splitWall, wallThicknessOf,
  WALL_ASSET_HEIGHT, WALL_ASSET_LENGTH,
} from './geometry';

/** A wall drawn with the Wall tool (WALL_SEGMENT) is this thick at scale 1, as its model is (assetCatalog). */
const WALL_ITEM_THICKNESS = 0.2;

/**
 * The items that hang on a wall, and where. `centre`: the height of the item's middle above the floor (m).
 * `aboveDoor`: an exit sign, `EXIT_GAP` over the door or window under it, else at `bottom`.
 * `back`: how far behind its origin the model's back is, when not depth / 2.
 */
export const WALL_ITEMS = {
  WHITEBOARD: { centre: 1.35 },
  TV_DISPLAY: { centre: 1.4 },
  PROJECTOR_SCREEN: { centre: 1.6, back: 0.04 },
  EMERGENCY_EXIT: { aboveDoor: true, bottom: 2.2 },
  FIRE_EXTINGUISHER: { centre: 1.0 },
  WALL_CLOCK: { centre: 2.0 },
  WALL_SHELF: { centre: 1.5 },
  AC_UNIT: { centre: 2.3 },
};
export const WALL_ITEM_TYPES = new Set(Object.keys(WALL_ITEMS));
export const isWallItem = (type) => WALL_ITEM_TYPES.has(type);

/** An exit sign hangs this far over the top of the door (or window) under it (m). */
export const EXIT_GAP = 0.1;
/** A wall item whose foot is at least this high hangs (it is not a floor obstacle); lower = it stands on the floor. */
export const OFF_FLOOR = 0.3;
/** A placed or dragged wall item looks for a wall this far from the mouse at most (m); further: it stands on the floor. */
export const SNAP_DISTANCE = 3;
/** Kept between the item's back and the wall (m): no flicker of two faces in one place. */
export const MOUNT_GAP = 0.005;
/** Kept below the top of the wall (m). */
export const TOP_GAP = 0.05;
/** How far a hung item may be off its wall and still count as on it (m). */
export const ON_WALL_TOLERANCE = 0.06;
/** A position along a wall is rounded to this (m). */
export const ALONG_STEP = 0.05;

const EPS = 1e-6;
const SAME_LINE = 0.01; // two faces this close (m) and parallel are one face

/** Does it hang (foot off the floor), so it is no floor obstacle? A floor-standing one still is. */
export function hangsOnWall(obj) {
  return isWallItem(obj?.assetType) && (Number(obj.y) || 0) >= OFF_FLOOR - EPS;
}

/** The item's size (m): catalogue size × scale. */
function sizeOf(obj, catalog) {
  const def = catalog?.[obj.assetType] ?? {};
  const spec = WALL_ITEMS[obj.assetType] ?? {};
  const sx = Math.abs(obj.scaleX ?? 1) || 1;
  const sy = Math.abs(obj.scaleY ?? 1) || 1;
  const sz = Math.abs(obj.scaleZ ?? 1) || 1;
  const depth = (def.defaultDepth ?? 0.1) * sz;
  return {
    width: (def.defaultWidth ?? 0.5) * sx,
    height: (def.defaultHeight ?? 0.5) * sy,
    depth,
    back: spec.back !== undefined ? spec.back * sz : depth / 2,
  };
}

// ── The walls ────────────────────────────────────────────────────────────

/**
 * The wall pieces of one floor as built, cut around every door and window:
 * [{ ax, az, bx, bz, thickness, y0, y1, roomId? , objectId? }] (the centre line from a to b).
 * @param {object[]} rooms    the floor's rooms (store shape)
 * @param {object[]} objects  the floor's items (only WALL_SEGMENT is used)
 */
export function wallPieces(rooms = [], objects = []) {
  const out = [];
  for (const room of rooms) {
    const T = wallThicknessOf(room);
    for (const wall of roomWalls(room)) {
      for (const segment of roomWallSegments(room, wall.name, rooms)) {
        const centre = (segment.u0 + segment.u1) / 2;
        const length = segment.u1 - segment.u0;
        const thickness = segment.shared ? segment.thickness : T;
        const holes = wallSegmentOpenings(room, wall.name, segment).map((o) => ({ ...o, offset: o.offset - centre }));
        const cx = room.x + wall.cx + (wall.alongX ? 0 : segment.crossOffset);
        const cz = room.z + wall.cz + (wall.alongX ? segment.crossOffset : 0);
        const height = room.wallHeight ?? 3;
        for (const p of splitWall(length, height, holes)) {
          const u0 = p.u0 + centre;
          const u1 = p.u1 + centre;
          out.push(wall.alongX
            ? { ax: cx + u0, az: cz, bx: cx + u1, bz: cz, thickness, y0: p.y0, y1: p.y1, roomId: room.id }
            : { ax: cx, az: cz + u0, bx: cx, bz: cz + u1, thickness, y0: p.y0, y1: p.y1, roomId: room.id });
        }
      }
    }
  }
  for (const o of objects) {
    if (o.assetType !== 'WALL_SEGMENT') continue;
    const half = (WALL_ASSET_LENGTH * (Math.abs(Number(o.scaleX)) || 1)) / 2;
    const r = Number(o.rotationY) || 0;
    const dx = Math.cos(r) * half;
    const dz = -Math.sin(r) * half;
    const x = Number(o.x) || 0;
    const z = Number(o.z) || 0;
    const y0 = Number(o.y) || 0;
    out.push({
      ax: x - dx, az: z - dz, bx: x + dx, bz: z + dz,
      thickness: WALL_ITEM_THICKNESS * (Math.abs(Number(o.scaleZ)) || 1),
      y0, y1: y0 + WALL_ASSET_HEIGHT * (Math.abs(Number(o.scaleY)) || 1), objectId: o.id,
    });
  }
  return out;
}

/**
 * The faces of the walls, the parallel pieces of one line together: [{ nx, nz (into the space in front),
 * ux, uz (along), c (n · a point on it), spans: [{ s0, s1, y0, y1 }] (along u), pieces }].
 */
const facesCache = new WeakMap();
export function wallFaces(pieces) {
  const cached = facesCache.get(pieces);
  if (cached) return cached;
  const faces = [];
  for (const piece of pieces) {
    const len = Math.hypot(piece.bx - piece.ax, piece.bz - piece.az);
    if (len < EPS) continue;
    const ux = (piece.bx - piece.ax) / len;
    const uz = (piece.bz - piece.az) / len;
    for (const side of [1, -1]) {
      // the normal: left of the direction, or right; u is turned so that n stays left of it
      const nx = -uz * side;
      const nz = ux * side;
      const fu = { x: ux * side, z: uz * side };
      const c = nx * piece.ax + nz * piece.az + piece.thickness / 2;
      const s0 = fu.x * piece.ax + fu.z * piece.az;
      const s1 = fu.x * piece.bx + fu.z * piece.bz;
      const span = { s0: Math.min(s0, s1), s1: Math.max(s0, s1), y0: piece.y0, y1: piece.y1 };
      let face = faces.find((f) => f.nx * nx + f.nz * nz > 1 - 1e-4 && Math.abs(f.c - c) < SAME_LINE);
      if (!face) faces.push(face = { nx, nz, ux: fu.x, uz: fu.z, c, spans: [], pieces: [] });
      face.spans.push(span);
      face.pieces.push(piece);
    }
  }
  facesCache.set(pieces, faces); // a pieces list is never changed after it is made
  return faces;
}

/** [from, to] intervals, merged. */
function merge(list) {
  const sorted = list.filter((i) => i.to - i.from > EPS).sort((a, b) => a.from - b.from);
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.from <= last.to + 0.002) last.to = Math.max(last.to, i.to);
    else out.push({ ...i });
  }
  return out;
}

function subtract(list, holes) {
  let pieces = list;
  for (const h of holes) {
    pieces = pieces.flatMap((p) => {
      if (h.to <= p.from || h.from >= p.to) return [p];
      const out = [];
      if (h.from > p.from) out.push({ from: p.from, to: h.from });
      if (h.to < p.to) out.push({ from: h.to, to: p.to });
      return out;
    });
  }
  return pieces.filter((p) => p.to - p.from > EPS);
}

/**
 * Where along a face an item fits: the stretches backed by wall over its whole height [y0, y1], less
 * where another wall comes within `depth` in front of the face (a corner).
 */
function freeStretches(face, pieces, y0, y1, depth) {
  const backed = merge(face.spans.filter((sp) => sp.y0 <= y0 + 0.002 && sp.y1 >= y1 - 0.002)
    .map((sp) => ({ from: sp.s0, to: sp.s1 })));
  if (!backed.length) return [];
  const holes = [];
  for (const q of pieces) {
    if (face.pieces.includes(q) || q.y1 <= y0 + EPS || q.y0 >= y1 - EPS) continue;
    const len = Math.hypot(q.bx - q.ax, q.bz - q.az);
    if (len < EPS) continue;
    const qx = (q.bx - q.ax) / len;
    const qz = (q.bz - q.az) / len;
    const half = q.thickness / 2;
    const corners = [[q.ax, q.az], [q.bx, q.bz]].flatMap(([x, z]) => [[x - qz * half, z + qx * half], [x + qz * half, z - qx * half]]);
    const h = corners.map(([x, z]) => face.nx * x + face.nz * z - face.c);
    if (Math.max(...h) <= 0.002 || Math.min(...h) >= depth - 0.002) continue; // not in front, within reach
    const s = corners.map(([x, z]) => face.ux * x + face.uz * z);
    holes.push({ from: Math.min(...s), to: Math.max(...s) });
  }
  return subtract(backed, holes);
}

/** The top of the wall on this face at `s` (the highest piece there). */
function wallTopAt(face, s) {
  let top = 0;
  for (const sp of face.spans) if (s >= sp.s0 - EPS && s <= sp.s1 + EPS) top = Math.max(top, sp.y1);
  return top;
}

/** An exit sign's foot: EXIT_GAP over the highest door or window top under [from, to], at least `bottom`. */
function exitBottom(face, from, to, bottom) {
  let y = bottom;
  for (const sp of face.spans) {
    if (sp.y0 < 1.5 || sp.s1 <= from + EPS || sp.s0 >= to - EPS) continue; // the wall over a door or a window
    y = Math.max(y, sp.y0 + EXIT_GAP);
  }
  return y;
}

const round = (v, step) => Math.round(v / step) * step;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Hang a wall item on the wall nearest the point (the mouse on the floor).
 * @param {object} obj  { assetType, scaleX?, scaleY?, scaleZ? }
 * @param {{ x: number, z: number }} point
 * @param {object[]} pieces  wallPieces of the item's floor
 * @param {{ catalog?: object, maxDistance?: number }} [options]  catalog: ASSET_TYPES (sizes)
 * @returns {{ x, z, y, rotationY, distance, face } | null}  null: no wall it fits on within maxDistance
 */
export function mountOnWall(obj, point, pieces, { catalog, maxDistance = SNAP_DISTANCE } = {}) {
  const spec = WALL_ITEMS[obj?.assetType];
  if (!spec || !point) return null;
  const size = sizeOf(obj, catalog);
  const reach = size.depth + MOUNT_GAP; // how far the item reaches in front of the face
  let best = null;
  for (const face of wallFaces(pieces)) {
    const h = face.nx * point.x + face.nz * point.z - face.c; // in front of the face: > 0
    if (h < -0.3 || h > maxDistance) continue; // behind it (the other face of that wall is nearer), or far
    const s = face.ux * point.x + face.uz * point.z;
    if (!face.spans.some((sp) => s >= sp.s0 - maxDistance && s <= sp.s1 + maxDistance)) continue;
    const hw = size.width / 2;
    // its height: its own, below the top of the wall
    let y0 = spec.aboveDoor ? exitBottom(face, s - hw, s + hw, spec.bottom) : spec.centre - size.height / 2;
    const top = wallTopAt(face, s);
    if (top > 0 && y0 + size.height > top - TOP_GAP) y0 = top - TOP_GAP - size.height;
    if (y0 < 0) continue;
    for (const stretch of freeStretches(face, pieces, y0, y0 + size.height, reach)) {
      if (stretch.to - stretch.from < size.width - EPS) continue;
      const lo = stretch.from + hw;
      const hi = stretch.to - hw;
      let at = Math.min(hi, Math.max(lo, round(s, ALONG_STEP)));
      if (at < lo - EPS || at > hi + EPS) at = (lo + hi) / 2;
      const distance = Math.abs(h) + Math.abs(at - s);
      if (distance > maxDistance || (best && distance >= best.distance)) continue;
      const out = size.back + MOUNT_GAP;
      best = {
        x: r3(face.ux * at + face.nx * (face.c + out)),
        z: r3(face.uz * at + face.nz * (face.c + out)),
        y: r3(y0),
        rotationY: Math.atan2(face.nx, face.nz),
        distance,
        face: { nx: face.nx, nz: face.nz, ux: face.ux, uz: face.uz, c: face.c, along: at },
      };
    }
  }
  return best;
}

/**
 * Does this wall item hang on a wall: its foot off the floor, its back on a wall face that backs it all?
 * @param {object} obj  store item
 * @param {object[]} pieces  wallPieces of its floor
 */
export function isOnWall(obj, pieces, { catalog } = {}) {
  if (!isWallItem(obj?.assetType) || !hangsOnWall(obj)) return false;
  const size = sizeOf(obj, catalog);
  const r = Number(obj.rotationY) || 0;
  const fx = Math.sin(r);
  const fz = Math.cos(r);
  const bx = (Number(obj.x) || 0) - fx * size.back;
  const bz = (Number(obj.z) || 0) - fz * size.back;
  const y0 = Number(obj.y) || 0;
  for (const face of wallFaces(pieces)) {
    if (face.nx * fx + face.nz * fz < 0.98) continue;
    if (Math.abs(face.nx * bx + face.nz * bz - face.c) > ON_WALL_TOLERANCE) continue;
    const s = face.ux * bx + face.uz * bz;
    const stretches = freeStretches(face, pieces, y0 + 0.01, y0 + size.height - 0.01, 0);
    const half = size.width / 2 - ON_WALL_TOLERANCE;
    if (stretches.some((st) => s - half >= st.from - EPS && s + half <= st.to + EPS)) return true;
  }
  return false;
}

/** "Large Display TV hangs on the wall" / "… no wall near" : the hint while placing or dragging one. */
export function mountText(label, mounted) {
  return mounted ? `${label} hangs on the wall` : `${label}: no wall near, it stands on the floor`;
}
