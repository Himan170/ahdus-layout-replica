/**
 * play/wallClear.js (v0.18.9)
 *
 * PURE: furniture never stands in a wall. An item's real footprint (its catalogue size × its scale, turned with
 * it; an L-shaped desk = its two arms: walkMap.itemFootprints) may never overlap a wall: a room's walls (shared
 * walls once, glass walls too, their thickness counted, cut by doors and windows: wallMount.wallPieces), a wall
 * drawn with the Wall tool (WALL_SEGMENT) or a glass partition (GLASS_PARTITION). Heights count: a cabinet under a
 * window is in the wall below the window; nothing is in the wall above a door it stands under.
 *
 * When a move, a turn, a new size, a copy or a placing would put it in a wall, it is pushed straight out of that
 * wall (along the wall's normal), to the side it came from, so it ends flush against the wall's face. An item that
 * can't be pushed clear (bigger than the space) is refused. A wall item (a TV, a whiteboard) hangs ON a wall face:
 * the same rule keeps it out of the wall (wallMount puts its back 5 mm in front of the face).
 *
 * Nothing moves by itself: this is used by editorHistory for edits and by Studio's previews; an old save with an
 * item in a wall keeps it (Check my layout's "Inside a wall" + Move out: insideWalls / moveOut).
 * Tested in play/__tests__/wallClear.test.js.
 */

import { wallPieces, WALL_ITEMS } from './wallMount';
import { itemFootprints } from './navigation/walkMap';

/** Items that may stand in or across a wall: walls themselves, what sits in an opening, columns, rugs, markers, stairs. */
export const WALL_FREE_TYPES = new Set([
  'WALL_SEGMENT', 'GLASS_PARTITION', 'DOOR_SINGLE', 'WINDOW_FRAME', 'COLUMN', 'RUG', 'STAIRCASE', 'SPAWN_POINT', 'ZONE_MARKER',
]);
/** Items that are walls for furniture besides the rooms' walls (their own footprint, their own height). */
export const WALL_LIKE_TYPES = new Set(['WALL_SEGMENT', 'GLASS_PARTITION']);
/** An item may reach this far (m) into a wall and still count as clear (rounding to the mm, a face it touches). */
export const WALL_TOLERANCE = 0.002;
/** How far past the face a pushed item ends (m): flush, by a hair, so rounding never puts it back in. */
const PUSH_GAP = 0.001;
/** How many pushes (one wall each: a corner is two) before giving up. */
const MAX_PUSHES = 6;
/** Height overlap (m) below which an item under / over a wall piece is not in it. */
const HEIGHT_SLACK = 0.01;

const floorOf = (o) => o?.floor ?? 0;
const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** May this item stand in a wall (it is a wall, sits in an opening, is flat or a marker)? */
export function isWallFree(obj, catalog = {}) {
  if (!obj) return true;
  if (WALL_FREE_TYPES.has(obj.assetType)) return true;
  return catalog[obj.assetType]?.category === 'Marker';
}

/** How tall an item is (m): its catalogue height × its scale. */
function heightOf(obj, catalog) {
  return (catalog[obj.assetType]?.defaultHeight ?? 1) * Math.abs(obj.scaleY ?? 1);
}

/**
 * The rectangles an item covers on the floor, with its height: [{ x, z, hw, hd, rot, y0, y1 }]. A wall item whose
 * model's back is not at depth / 2 (a projector screen) covers from its back.
 */
export function itemRects(obj, catalog = {}) {
  const y0 = Number(obj.y) || 0;
  const y1 = y0 + heightOf(obj, catalog);
  const spec = WALL_ITEMS[obj.assetType];
  if (spec) {
    // a wall item: the size wallMount hangs it by (the catalogue's), so a hung one is exactly 5 mm off its wall
    const def = catalog[obj.assetType] ?? {};
    const rot = obj.rotationY ?? 0;
    const hw = ((def.defaultWidth ?? 0.5) * Math.abs(obj.scaleX ?? 1)) / 2;
    const hd = ((def.defaultDepth ?? 0.1) * Math.abs(obj.scaleZ ?? 1)) / 2;
    const shift = spec.back === undefined ? 0 : hd - spec.back * (Math.abs(obj.scaleZ ?? 1) || 1);
    return [{ x: (Number(obj.x) || 0) + Math.sin(rot) * shift, z: (Number(obj.z) || 0) + Math.cos(rot) * shift, hw, hd, rot, y0, y1 }];
  }
  return itemFootprints(obj, catalog).map((r) => ({ ...r, y0, y1 }));
}

/**
 * The walls of one floor for furniture: [{ cx, cz, ux, uz, hl, ht, y0, y1, roomId?, objectId? }] (the middle, the
 * direction along it, half its length, half its thickness, its height).
 * @param {object[] | Record<string, object>} rooms
 * @param {object[] | Record<string, object>} objects
 * @param {number} floor
 * @param {{ catalog?: object, ignore?: Iterable<string> }} [options]  ignore: item ids that are not walls here
 */
export function floorWallBoxes(rooms, objects, floor, { catalog = {}, ignore = [] } = {}) {
  const skip = new Set(ignore);
  const here = list(rooms).filter((r) => floorOf(r) === floor);
  const items = list(objects).filter((o) => floorOf(o) === floor && WALL_LIKE_TYPES.has(o.assetType) && !skip.has(o.id));
  const out = [];
  for (const p of wallPieces(here, items.filter((o) => o.assetType === 'WALL_SEGMENT'))) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    if (len < 1e-6) continue;
    out.push({
      cx: (p.ax + p.bx) / 2, cz: (p.az + p.bz) / 2, ux: (p.bx - p.ax) / len, uz: (p.bz - p.az) / len,
      hl: len / 2, ht: p.thickness / 2, y0: p.y0, y1: p.y1, roomId: p.roomId ?? null, objectId: p.objectId ?? null,
    });
  }
  for (const o of items) {
    if (o.assetType !== 'GLASS_PARTITION') continue;
    for (const r of itemRects(o, catalog)) {
      // the partition's own +X is its length (Babylon: local +X → (cos, −sin))
      out.push({ cx: r.x, cz: r.z, ux: Math.cos(r.rot), uz: -Math.sin(r.rot), hl: r.hw, ht: r.hd, y0: r.y0, y1: r.y1, roomId: null, objectId: o.id });
    }
  }
  return out;
}

/** A rectangle's two axes (unit vectors) and half sizes along them. */
function rectAxes(r) {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  return [{ x: c, z: -s, h: r.hw }, { x: s, z: c, h: r.hd }];
}

/** Half the extent of a rectangle along a unit axis. */
const extent = (axes, ax, az) => axes.reduce((sum, a) => sum + a.h * Math.abs(a.x * ax + a.z * az), 0);

/**
 * How far an item rectangle reaches into a wall (the smallest overlap over the four separating axes), or 0.
 */
export function overlapDepth(rect, wall) {
  if (Math.min(rect.y1, wall.y1) - Math.max(rect.y0, wall.y0) <= HEIGHT_SLACK) return 0;
  const ra = rectAxes(rect);
  const wa = [{ x: wall.ux, z: wall.uz, h: wall.hl }, { x: -wall.uz, z: wall.ux, h: wall.ht }];
  const dx = rect.x - wall.cx;
  const dz = rect.z - wall.cz;
  let least = Infinity;
  for (const a of [...ra, ...wa]) {
    const gap = extent(ra, a.x, a.z) + extent(wa, a.x, a.z) - Math.abs(dx * a.x + dz * a.z);
    if (gap <= 0) return 0;
    least = Math.min(least, gap);
  }
  return least;
}

/** The deepest wall an item's rectangles reach into: { wall, depth } (depth > WALL_TOLERANCE), or null. */
export function wallHit(rects, walls) {
  let best = null;
  for (const r of rects) {
    // cheap check first: the wall's middle within reach
    const reach = r.hw + r.hd;
    for (const w of walls) {
      if (Math.abs(r.x - w.cx) > reach + w.hl + w.ht || Math.abs(r.z - w.cz) > reach + w.hl + w.ht) continue;
      const depth = overlapDepth(r, w);
      if (depth > WALL_TOLERANCE && (!best || depth > best.depth)) best = { wall: w, depth };
    }
  }
  return best;
}

const centreOf = (items) => {
  const n = items.length || 1;
  return { x: items.reduce((s, o) => s + (Number(o.x) || 0), 0) / n, z: items.reduce((s, o) => s + (Number(o.z) || 0), 0) / n };
};

/**
 * Push items (moved together: one item, a desk with its chair, a group) out of the walls, each push along a wall's
 * normal to the side of `from` (where they were: the middle of their old places), else the side their middle is on.
 * @param {object[]} items   the items where they are wanted (store shape: x, z, rotationY, scale, y, assetType)
 * @param {object[]} walls   floorWallBoxes of their floor
 * @param {{ catalog?: object, from?: { x: number, z: number } | null, side?: (wall) => number,
 *   sweep?: { dx: number, dz: number } | null }} [options]
 *   side: a wall → +1 / −1 (the side of its normal to push to), for an item placed with nothing to come from;
 *   sweep: the step they just made (an arrow key): a wall on the way stops them there, even when the step would
 *   end clear on its other side (a 0.5 m step jumped a 0.15 m wall). Walls they were in before the step don't count.
 * @returns {{ ok: boolean, dx: number, dz: number, pushed: boolean, wall: object | null }}
 *   ok false: no place clear of the walls near (dx / dz then 0); wall: the last wall pushed against
 */
export function clearOfWalls(items, walls, { catalog = {}, from = null, side = null, sweep = null } = {}) {
  const solid = items.filter((o) => !isWallFree(o, catalog));
  if (!solid.length || !walls.length) return { ok: true, dx: 0, dz: 0, pushed: false, wall: null };
  const ref = from ?? centreOf(solid);
  let dx = 0;
  let dz = 0;
  let last = null;
  const at = (ox, oz) => solid.flatMap((o) => itemRects({ ...o, x: (Number(o.x) || 0) + ox, z: (Number(o.z) || 0) + oz }, catalog));
  const len = sweep ? Math.hypot(sweep.dx || 0, sweep.dz || 0) : 0;
  if (len > 1e-6) {
    // back where the step started, then forward in SWEEP_STEP slices: the first wall met (not one it was in) stops it
    const startRects = at(-sweep.dx, -sweep.dz);
    const ahead = walls.filter((w) => !startRects.some((r) => overlapDepth(r, w) > WALL_TOLERANCE));
    const n = Math.ceil(len / SWEEP_STEP);
    for (let k = 1; k < n; k++) {
      const back = 1 - k / n;
      if (wallHit(at(-sweep.dx * back, -sweep.dz * back), ahead)) { dx = -sweep.dx * back; dz = -sweep.dz * back; break; }
    }
  }
  for (let i = 0; i <= MAX_PUSHES; i++) {
    const rects = solid.flatMap((o) => itemRects({ ...o, x: (Number(o.x) || 0) + dx, z: (Number(o.z) || 0) + dz }, catalog));
    const hit = wallHit(rects, walls);
    if (!hit) return { ok: true, dx: r3(dx), dz: r3(dz), pushed: !!last, wall: last };
    if (i === MAX_PUSHES) break;
    const w = hit.wall;
    const nx = -w.uz;
    const nz = w.ux;
    // the side: where they came from; on the wall's centre line, where their middle is now; else `side`
    let sign = Math.sign(nx * (ref.x - w.cx) + nz * (ref.z - w.cz));
    if (Math.abs(nx * (ref.x - w.cx) + nz * (ref.z - w.cz)) < 1e-6) {
      const now = centreOf(solid);
      sign = Math.sign(nx * (now.x + dx - w.cx) + nz * (now.z + dz - w.cz)) || side?.(w) || 1;
    }
    // how far along the normal the items reach on the wrong side of the face
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rects) {
      if (Math.min(r.y1, w.y1) - Math.max(r.y0, w.y0) <= HEIGHT_SLACK) continue;
      const c = nx * (r.x - w.cx) + nz * (r.z - w.cz);
      const e = extent(rectAxes(r), nx, nz);
      lo = Math.min(lo, c - e);
      hi = Math.max(hi, c + e);
    }
    const d = sign > 0 ? (w.ht + PUSH_GAP) - lo : -(w.ht + PUSH_GAP) - hi;
    if (!Number.isFinite(d) || Math.abs(d) < 1e-9) break;
    dx += nx * d;
    dz += nz * d;
    last = w;
  }
  return { ok: false, dx: 0, dz: 0, pushed: false, wall: last };
}

/** "A wall is in the way": what a refused move / turn / size says. */
/** The slice a swept step is checked in (m): thinner than any wall (0.1 m). */
const SWEEP_STEP = 0.02;

export const NO_ROOM_TEXT = 'A wall is in the way: there is no room for it there';

/**
 * The items of one floor that stand in a wall now (Check my layout): [{ item, wall, depth, to: { x, z } | null }]
 * (`to`: where Move out puts it, pushed to the side its own room is on, else the side its middle is on).
 * Wall items that hang right are not in a wall (the rule leaves them their 5 mm).
 */
export function insideWalls(rooms, objects, floor, { catalog = {} } = {}) {
  const walls = floorWallBoxes(rooms, objects, floor, { catalog });
  if (!walls.length) return [];
  const roomById = new Map(list(rooms).map((r) => [r.id, r]));
  const out = [];
  for (const item of list(objects)) {
    if (floorOf(item) !== floor || isWallFree(item, catalog)) continue;
    const hit = wallHit(itemRects(item, catalog), walls);
    if (!hit) continue;
    const home = roomById.get(item.roomId);
    const side = home && floorOf(home) === floor
      ? (w) => Math.sign(-w.uz * (home.x - w.cx) + w.ux * (home.z - w.cz)) || 1
      : null;
    // from: its own room's middle when it has one (out into its room), else the side its middle is on
    const from = home && floorOf(home) === floor ? { x: home.x, z: home.z } : null;
    const res = clearOfWalls([item], walls, { catalog, from, side });
    out.push({
      item, wall: hit.wall, depth: hit.depth,
      to: res.ok ? { x: r3((Number(item.x) || 0) + res.dx), z: r3((Number(item.z) || 0) + res.dz) } : null,
    });
  }
  return out;
}

/**
 * floorWallBoxes, remembered while the store's rooms and items records stay the same (they are replaced on every
 * change): Studio's previews ask on every mouse move.
 */
const boxCache = new WeakMap(); // rooms record → WeakMap(objects record → Map(floor → boxes))
export function cachedFloorWallBoxes(rooms, objects, floor, { catalog = {} } = {}) {
  if (!rooms || typeof rooms !== 'object' || !objects || typeof objects !== 'object') {
    return floorWallBoxes(rooms ?? [], objects ?? [], floor, { catalog });
  }
  let byObjects = boxCache.get(rooms);
  if (!byObjects) boxCache.set(rooms, (byObjects = new WeakMap()));
  let byFloor = byObjects.get(objects);
  if (!byFloor) byObjects.set(objects, (byFloor = new Map()));
  if (!byFloor.has(floor)) byFloor.set(floor, floorWallBoxes(rooms, objects, floor, { catalog }));
  return byFloor.get(floor);
}
