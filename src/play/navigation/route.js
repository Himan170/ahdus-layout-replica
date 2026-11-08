/**
 * play/navigation/route.js
 *
 * PURE: walking routes over the walk maps of every floor (v0.13.2,
 * private-docs/NAVIGATION_PLAN.md 4.3). No Babylon.
 *
 * - A* over the FREE cells of all floors at once: 8 neighbours, no corner
 *   cutting (a diagonal step needs both cells beside it free), octile
 *   distance. Floors are joined by LINKS: a staircase is one, from the free
 *   spot in front of its bottom step to the spot where its top lands
 *   (`stairTop`), both ways, costing the flight's length. Stairs that lead
 *   nowhere (`stairNeedsRoomAbove`) are not links. `options.links` adds others
 *   (lifts, later).
 * - The heuristic knows the links: on a floor other than the goal's it is the
 *   cheapest way to the goal through a link (octile to the link + the link +
 *   a lower bound from there), so a route to Floor 1 heads for the stairs
 *   instead of filling the ground floor. The open cells sit in a bucket queue
 *   (5 mm steps): the longest Meridian route (entrance → Floor 1's far
 *   corner, 122 m) takes ~30 ms once warm; the first one after a layout
 *   change ~100 ms (the walk maps and the per-map tables below are made then).
 * - Walking next to a wall costs more (up to double in the 4 cells beside a
 *   wall or a desk), so routes keep to the middle of doorways and
 *   corridors. It is a cost, never a block: a narrow door is one cell wide on
 *   the walk map and the route still goes through it.
 * - Smoothing: from each kept point, the furthest later point in line of
 *   sight. A segment is in line of sight when every cell it crosses is FREE
 *   (the grown grid; a corner crossing needs both cells beside it too) AND
 *   the segment keeps the body's radius + 0.02 m from every wall and solid
 *   item, measured exactly. So a route never cuts a corner through a wall.
 *   A shortcut also comes no closer to any wall or item than the cell path
 *   it replaces came to that one (less 5 cm), so the route stays as centred
 *   as the near-wall cost made it.
 *   A cell opened on a narrow door's centre line (walkMap `passages`) is
 *   crossed at its point on that line.
 * - No route: a clear answer, `{ problem, message }` ("No walking route to
 *   Server Room: it has no door"). Never a straight line through walls.
 *
 * Result: { legs: [{ floor, points: [{ x, z }], stairsAtEnd? }], length, seconds,
 * from, to } (from / to: where it really starts and ends, moved onto the
 * nearest free spot within 1.5 m if needed).
 *
 * Used by the viewer's ?debug=walkmap view (src/viewer/walkMapDebug.js), later
 * by search and "Take me there" (findNearestRoute: the nearest washroom). Tests: navigation/__tests__/route.test.js.
 */

import {
  floorsInOrder, floorAbove, stairDimsFor, stairTop, stairNeedsRoomAbove, rectContains, roomRect,
} from '../building';
import { wallThicknessOf } from '../geometry';
import { WALK_SPEED } from '../speeds';
import { createWalkMapCache, distanceToRect, doorGaps, FREE, BODY_RADIUS } from './walkMap';
import { nearestFree } from './entrance';

/** A route's `seconds`: the character's walking speed (play/speeds.js, the one constant). */
export { WALK_SPEED };
/** Extra cost of a step right beside a wall (× 2), fading to none NEAR_WALL_CELLS cells away. */
export const NEAR_WALL_COST = 1;
export const NEAR_WALL_CELLS = 4;
/** A start or goal in a wall or a desk moves to the nearest free spot this close (m). */
export const SNAP_DISTANCE = 1.5;
/** A start in a wall or a desk moves onto an area at least this big (cells), not a pocket between chairs. */
const MIN_AREA_CELLS = 50;
/** How far a smoothed segment keeps from every wall and solid item (m): the body + 2 cm. */
export const SEGMENT_CLEARANCE = BODY_RADIUS + 0.02;
/** A shortcut may come this much closer to a wall or an item than the cell path it replaces (m). */
export const SMOOTH_SLACK = 0.05;
/** Where a staircase's bottom link is: this far in front of its bottom step (as stairTop at the top). */
const STAIR_LANDING = 0.6;
const SQRT2 = Math.SQRT2;
const OCT = SQRT2 - 1;
/** The bucket queue's resolution (m): routes come out within a few millimetres of the best. */
const BUCKET_STEP = 0.005;
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;
const octile = (ax, az, bx, bz) => {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return dx > dz ? dx + OCT * dz : dz + OCT * dx;
};

/** Where you step onto a staircase at the bottom (world x, z): in front of its bottom step. */
export function stairBottom(stair, dims) {
  const r = stair.rotationY ?? 0;
  const d = dims.length / 2 + STAIR_LANDING;
  return { x: stair.x - Math.sin(r) * d, z: stair.z - Math.cos(r) * d };
}

/**
 * The links between floors: every staircase that leads somewhere, from the
 * free spot in front of its bottom step to the free spot where it arrives.
 * A staircase whose ends are walled in or under furniture (no free spot
 * within 1 m) is not a link.
 * @param {{ rooms, objects, floors }} layout  store shape
 * @param {{ maps?: { get(layout, floorId) }, catalog?: object }} [options]
 * @returns {{ kind: 'stairs', objectId: string, from: { floor, x, z }, to: { floor, x, z }, cost: number }[]}
 */
export function floorLinks(layout, options = {}) {
  const maps = options.maps ?? createWalkMapCache({ catalog: options.catalog });
  const floors = layout.floors ?? {};
  const rooms = list(layout.rooms);
  const links = [];
  for (const s of list(layout.objects)) {
    if (s.assetType !== 'STAIRCASE') continue;
    const floor = floorOf(s);
    const above = floorAbove(floors, floor);
    if (!above || !floors[floor] || stairNeedsRoomAbove(s, floors, rooms)) continue;
    const dims = stairDimsFor(floors, s);
    const low = landing(maps.get(layout, floor), stairBottom(s, dims));
    const high = landing(maps.get(layout, above.id), stairTop(s, dims));
    if (!low || !high) continue;
    const cost = Math.hypot(Math.hypot(high.x - low.x, high.z - low.z), dims.rise);
    links.push({ kind: 'stairs', objectId: s.id, from: { floor, x: low.x, z: low.z }, to: { floor: above.id, x: high.x, z: high.z }, cost });
  }
  return links;
}

function landing(map, p) {
  const spot = nearestFree(map, p.x, p.z, { maxDistance: 1 });
  return spot && { x: spot.x, z: spot.z };
}

/** The innermost room of a floor holding a point (null: none). */
export function roomAt(layout, floorId, x, z) {
  let best = null;
  for (const r of list(layout.rooms)) {
    if (floorOf(r) !== floorId || !rectContains(roomRect(r), x, z)) continue;
    if (!best || r.width * r.depth < best.width * best.depth) best = r;
  }
  return best;
}

/** Does any door (its own, or a neighbour's through a wall it shares) lead out of this room? */
export function roomHasDoor(room, rooms) {
  const T = wallThicknessOf(room);
  const rect = roomRect(room);
  const grown = { x0: rect.x0 - T, x1: rect.x1 + T, z0: rect.z0 - T, z1: rect.z1 + T };
  const inner = { x0: rect.x0 + T, x1: rect.x1 - T, z0: rect.z0 + T, z1: rect.z1 - T };
  const onFloor = rooms.filter((r) => floorOf(r) === floorOf(room));
  return doorGaps(onFloor).some((g) => rectContains(grown, g.x, g.z) && !rectContains(inner, g.x, g.z));
}

/** A door, or a link (stairs arriving) inside it: a way into the room. */
function roomHasWayIn(room, rooms, links) {
  const rect = roomRect(room);
  const inside = (p) => p.floor === floorOf(room) && rectContains(rect, p.x, p.z);
  return roomHasDoor(room, rooms) || links.some((l) => inside(l.from) || inside(l.to));
}

/** The name a "no route" answer uses for a place: its room, else its floor. */
function placeName(layout, p) {
  const room = roomAt(layout, p.floor, p.x, p.z);
  if (room?.name) return room.name;
  return (layout.floors ?? {})[p.floor]?.name ?? 'there';
}

function problem(code, message) {
  return { problem: code, message };
}

// ── Per-map helpers (made once per walk map) ──────────────────────────────

const nearWalls = new WeakMap();
/**
 * Per cell: `dist`, the chessboard distance in cells to the nearest cell that isn't FREE (capped at
 * NEAR_WALL_CELLS + 1), and `cost`, its step cost multiplier (1, up to 1 + NEAR_WALL_COST beside one).
 */
function nearWallOf(map) {
  let m = nearWalls.get(map);
  if (m) return m;
  const { cols, rows, cells } = map;
  const cap = NEAR_WALL_CELLS + 1;
  const d = new Uint8Array(cols * rows);
  // chessboard distance (in cells) to the nearest cell that isn't FREE, capped (two passes)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (cells[k] !== FREE) continue;
      let v = cap;
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - cols] + 1);
        if (i > 0) v = Math.min(v, d[k - cols - 1] + 1);
        if (i < cols - 1) v = Math.min(v, d[k - cols + 1] + 1);
      }
      d[k] = v;
    }
  }
  for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      if (d[k] === 0) continue;
      let v = d[k];
      if (i < cols - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < rows - 1) {
        v = Math.min(v, d[k + cols] + 1);
        if (i < cols - 1) v = Math.min(v, d[k + cols + 1] + 1);
        if (i > 0) v = Math.min(v, d[k + cols - 1] + 1);
      }
      d[k] = v;
    }
  }
  const cost = new Float32Array(cols * rows);
  for (let k = 0; k < cost.length; k++) cost[k] = 1 + (NEAR_WALL_COST * Math.max(0, cap - d[k])) / NEAR_WALL_CELLS;
  m = { dist: d, cost };
  nearWalls.set(map, m);
  return m;
}

const areaCache = new WeakMap();
/**
 * The walkable areas of a map: `label` per cell (−1: not FREE) and each area's `sizes` (cells).
 * Cells joined by side (a diagonal step needs both side cells free, so it joins nothing new).
 */
function areasOf(map) {
  let a = areaCache.get(map);
  if (a) return a;
  const { cols, cells } = map;
  const n = cells.length;
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const queue = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (cells[s0] !== FREE || label[s0] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s0;
    label[s0] = id;
    while (head < tail) {
      const k = queue[head++];
      const i = k % cols;
      if (i > 0 && cells[k - 1] === FREE && label[k - 1] < 0) { label[k - 1] = id; queue[tail++] = k - 1; }
      if (i < cols - 1 && cells[k + 1] === FREE && label[k + 1] < 0) { label[k + 1] = id; queue[tail++] = k + 1; }
      if (k >= cols && cells[k - cols] === FREE && label[k - cols] < 0) { label[k - cols] = id; queue[tail++] = k - cols; }
      if (k + cols < n && cells[k + cols] === FREE && label[k + cols] < 0) { label[k + cols] = id; queue[tail++] = k + cols; }
    }
    sizes.push(tail);
  }
  a = { label, sizes };
  areaCache.set(map, a);
  return a;
}

const BUCKET = 2;
const obstacleIndexes = new WeakMap();
/** The map's walls and solid items in 2 m buckets, to find the ones near a segment fast. */
function obstacleIndexOf(map) {
  let index = obstacleIndexes.get(map);
  if (index) return index;
  const { x0, z0 } = map;
  const bc = Math.ceil((map.cols * map.cell) / BUCKET) + 1;
  const br = Math.ceil((map.rows * map.cell) / BUCKET) + 1;
  const buckets = Array.from({ length: bc * br }, () => []);
  const grow = SEGMENT_CLEARANCE;
  const span = (lo, hi, n) => [Math.max(0, Math.floor(lo / BUCKET)), Math.min(n - 1, Math.floor(hi / BUCKET))];
  map.obstacles.forEach((o, n) => {
    const c = Math.abs(Math.cos(o.rot ?? 0));
    const s = Math.abs(Math.sin(o.rot ?? 0));
    const ex = o.hw * c + o.hd * s + grow;
    const ez = o.hw * s + o.hd * c + grow;
    const [i0, i1] = span(o.x - ex - x0, o.x + ex - x0, bc);
    const [j0, j1] = span(o.z - ez - z0, o.z + ez - z0, br);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * bc + i].push(n);
  });
  const seen = new Uint32Array(map.obstacles.length);
  let stamp = 0;
  index = {
    /** Every obstacle whose grown box may touch the box (ax0..ax1, az0..az1): fn(obstacle) → true stops. */
    some(ax0, az0, ax1, az1, fn) {
      stamp++;
      const [i0, i1] = span(ax0 - x0, ax1 - x0, bc);
      const [j0, j1] = span(az0 - z0, az1 - z0, br);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          for (const n of buckets[j * bc + i]) {
            if (seen[n] === stamp) continue;
            seen[n] = stamp;
            if (fn(map.obstacles[n])) return true;
          }
        }
      }
      return false;
    },
  };
  obstacleIndexes.set(map, index);
  return index;
}

// ── Line of sight ─────────────────────────────────────────────────────────

/** Every cell the segment a → b crosses is FREE (through a corner: both cells beside it too). */
export function cellsClear(map, ax, az, bx, bz) {
  const { cell, x0, z0, cols, rows, cells } = map;
  const ux = (ax - x0) / cell;
  const uz = (az - z0) / cell;
  const vx = (bx - x0) / cell;
  const vz = (bz - z0) / cell;
  let i = Math.floor(ux);
  let j = Math.floor(uz);
  const ie = Math.floor(vx);
  const je = Math.floor(vz);
  const ok = (a, b) => a >= 0 && b >= 0 && a < cols && b < rows && cells[b * cols + a] === FREE;
  if (!ok(i, j)) return false;
  const dx = vx - ux;
  const dz = vz - uz;
  const si = Math.sign(dx);
  const sj = Math.sign(dz);
  const tdx = si ? Math.abs(1 / dx) : Infinity;
  const tdz = sj ? Math.abs(1 / dz) : Infinity;
  let tx = si > 0 ? (i + 1 - ux) * tdx : si < 0 ? (ux - i) * tdx : Infinity;
  let tz = sj > 0 ? (j + 1 - uz) * tdz : sj < 0 ? (uz - j) * tdz : Infinity;
  let guard = Math.abs(ie - i) + Math.abs(je - j) + 2;
  while ((i !== ie || j !== je) && guard-- > 0) {
    if (Math.abs(tx - tz) < 1e-9) {
      if (!ok(i + si, j) || !ok(i, j + sj)) return false; // through a corner
      i += si; j += sj; tx += tdx; tz += tdz;
    } else if (tx < tz) {
      i += si; tx += tdx;
    } else {
      j += sj; tz += tdz;
    }
    if (!ok(i, j)) return false;
  }
  return i === ie && j === je;
}

/** Distance (m) from the segment a → b to a (turned) rectangle { x, z, hw, hd, rot }; 0 if they meet. */
export function segmentToRect(o, ax, az, bx, bz) {
  const c = Math.cos(o.rot ?? 0);
  const s = Math.sin(o.rot ?? 0);
  const local = (x, z) => {
    const dx = x - o.x;
    const dz = z - o.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const [px, pz] = local(ax, az);
  const [qx, qz] = local(bx, bz);
  const { hw, hd } = o;
  // do they meet? (Liang–Barsky clip of the segment to the box)
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, px + hw) && clip(dx, hw - px) && clip(-dz, pz + hd) && clip(dz, hd - pz) && t0 <= t1) return 0;
  const boxDist = (x, z) => Math.hypot(Math.max(Math.abs(x) - hw, 0), Math.max(Math.abs(z) - hd, 0));
  const len2 = dx * dx + dz * dz;
  const segDist = (x, z) => {
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - px) * dx + (z - pz) * dz) / len2)) : 0;
    return Math.hypot(px + t * dx - x, pz + t * dz - z);
  };
  return Math.min(
    boxDist(px, pz), boxDist(qx, qz),
    segDist(-hw, -hd), segDist(hw, -hd), segDist(-hw, hd), segDist(hw, hd),
  );
}

/** Can the body walk straight from a to b on this floor (see the header)? */
export function lineOfSight(map, a, b, clearance = SEGMENT_CLEARANCE) {
  if (!cellsClear(map, a.x, a.z, b.x, b.z)) return false;
  const g = clearance;
  return !obstacleIndexOf(map).some(
    Math.min(a.x, b.x) - g, Math.min(a.z, b.z) - g, Math.max(a.x, b.x) + g, Math.max(a.z, b.z) + g,
    (o) => segmentToRect(o, a.x, a.z, b.x, b.z) < g,
  );
}

/**
 * Keep only the points where the line of sight breaks, then drop points in a straight line.
 * A shortcut also comes no closer to any wall or item than the cell path it replaces came to that
 * same one (less SMOOTH_SLACK; beyond COMFORT it doesn't matter), so a route the near-wall cost kept
 * in the middle of a door or a corridor stays there.
 */
export function smoothPath(map, points) {
  if (points.length <= 2) return points.slice();
  const index = obstacleIndexOf(map);
  const comfort = map.clearance + NEAR_WALL_CELLS * map.cell;
  const out = [points[0]];
  let a = 0;
  while (a < points.length - 1) {
    const near = new Map(); // obstacle → the closest the cell path came to it since point a
    const note = (p) => index.some(p.x - comfort, p.z - comfort, p.x + comfort, p.z + comfort, (o) => {
      const d = segmentToRect(o, p.x, p.z, p.x, p.z);
      if (d < comfort && !(near.get(o) <= d)) near.set(o, d);
      return false;
    });
    note(points[a]);
    note(points[a + 1]);
    let b = a + 1; // the next point is always reachable (neighbouring cells)
    for (let t = a + 2; t < points.length; t++) {
      note(points[t]);
      if (shortcutClear(map, index, points[a], points[t], near, comfort)) b = t;
      else break;
    }
    out.push(points[b]);
    a = b;
  }
  return dropStraight(out);
}

function shortcutClear(map, index, a, b, near, comfort) {
  if (!cellsClear(map, a.x, a.z, b.x, b.z)) return false;
  return !index.some(
    Math.min(a.x, b.x) - comfort, Math.min(a.z, b.z) - comfort, Math.max(a.x, b.x) + comfort, Math.max(a.z, b.z) + comfort,
    (o) => segmentToRect(o, a.x, a.z, b.x, b.z) < Math.max(SEGMENT_CLEARANCE, Math.min(near.get(o) ?? comfort, comfort) - SMOOTH_SLACK),
  );
}

function dropStraight(points) {
  const out = [points[0]];
  for (let n = 1; n < points.length - 1; n++) {
    const a = out[out.length - 1];
    const b = points[n];
    const c = points[n + 1];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z);
    if (Math.abs(cross) < 1e-9 && dot >= 0) continue;
    out.push(b);
  }
  if (points.length > 1) out.push(points[points.length - 1]);
  return out;
}

const pathLength = (points) => points.reduce((sum, p, n) => (n ? sum + Math.hypot(p.x - points[n - 1].x, p.z - points[n - 1].z) : 0), 0);

// ── The route ─────────────────────────────────────────────────────────────

/**
 * A walking route from one spot to another, on any floors.
 * @param {{ rooms, objects, floors }} layout  store shape (v1 field names)
 * @param {{ x:number, z:number, floor?:number }} from
 * @param {{ x:number, z:number, floor?:number }} to
 * @param {{ maps?: { get(layout, floorId) }, catalog?: object, links?: object[], name?: string, speed?: number }} [options]
 *   maps: a createWalkMapCache (else one is made), links: more links (lifts), name: what the answers call the goal
 * @returns {Route | { problem: string, message: string }}
 */
export function findRoute(layout, from, to, options = {}) {
  const floors = layout.floors ?? {};
  const cache = options.maps ?? createWalkMapCache({ catalog: options.catalog });
  const order = floorsInOrder(floors).map((f) => f.id);
  if (!order.length) order.push(0);
  const fromFloor = from.floor ?? order[0];
  const toFloor = to.floor ?? order[0];
  const goalPlace = { x: to.x, z: to.z, floor: toFloor };
  const name = options.name ?? placeName(layout, goalPlace);
  const fi = (floorId) => order.indexOf(floorId);
  if (fi(fromFloor) < 0 || fi(toFloor) < 0) return problem('NO_FLOOR', `No walking route to ${name}: that floor doesn't exist`);

  const maps = order.map((id) => cache.get(layout, id));
  const rooms = list(layout.rooms);
  const links = [...floorLinks(layout, { maps: cache }), ...(options.links ?? [])];
  const areas = maps.map(areasOf);
  const areaAt = (f, x, z) => { const k = maps[f].indexOf(x, z); return k < 0 ? -1 : areas[f].label[k]; };

  // where it starts: here, else the nearest free spot that isn't a pocket between furniture
  const sf = fi(fromFloor);
  const start = snap(maps[sf], from, (x, z) => areas[sf].sizes[areaAt(sf, x, z)] >= MIN_AREA_CELLS) ?? snap(maps[sf], from);
  if (!start) return problem('START_BLOCKED', "No walking route: there's nowhere to stand where you are");
  if (fromFloor !== toFloor && !links.some((l) => l.from.floor === toFloor || l.to.floor === toFloor)) {
    const floorName = floors[toFloor]?.name ?? 'that floor';
    return problem('NO_STAIRS', `No walking route to ${name}: no stairs lead to ${floorName}`);
  }

  // every walkable area you can get to from there (areas joined by links), so the goal can be put
  // on a spot that is reachable and a "no route" is known at once, without searching
  const reach = new Set([`${sf}:${areaAt(sf, start.x, start.z)}`]);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of links) {
      const a = `${fi(l.from.floor)}:${areaAt(fi(l.from.floor), l.from.x, l.from.z)}`;
      const b = `${fi(l.to.floor)}:${areaAt(fi(l.to.floor), l.to.x, l.to.z)}`;
      if (reach.has(a) !== reach.has(b)) { reach.add(a); reach.add(b); grew = true; }
    }
  }
  const gfi = fi(toFloor);
  const goal = snap(maps[gfi], to, (x, z) => reach.has(`${gfi}:${areaAt(gfi, x, z)}`));
  if (!goal) {
    if (!snap(maps[gfi], to)) return problem('GOAL_BLOCKED', `No walking route to ${name}: there's no room to stand there`);
    const goalRoom = roomAt(layout, toFloor, to.x, to.z);
    const startRoom = roomAt(layout, fromFloor, start.x, start.z);
    if (goalRoom && !roomHasWayIn(goalRoom, rooms, links)) return problem('NO_DOOR', `No walking route to ${name}: it has no door`);
    if (startRoom && !roomHasWayIn(startRoom, rooms, links)) {
      return problem('START_NO_DOOR', `No walking route to ${name}: the room you are in has no door`);
    }
    return problem('NO_ROUTE', `No walking route to ${name}: something blocks the way`);
  }

  // nodes: every cell of every floor, numbered floor after floor
  const offsets = [];
  let total = 0;
  for (const m of maps) { offsets.push(total); total += m.cols * m.rows; }
  const floorIndexOf = (n) => { let f = 0; while (f + 1 < offsets.length && n >= offsets[f + 1]) f++; return f; };
  const nodeAt = (f, x, z) => { const k = maps[f].indexOf(x, z); return k < 0 ? -1 : offsets[f] + k; };
  const startNode = nodeAt(sf, start.x, start.z);
  const goalNode = nodeAt(gfi, goal.x, goal.z);

  // links, both ways, as edges between nodes
  const edges = new Map();
  const exits = maps.map(() => []); // per floor: where you can leave it ({ x, z, edge })
  const directed = [];
  for (const link of links) {
    const f0 = fi(link.from.floor);
    const f1 = fi(link.to.floor);
    if (f0 < 0 || f1 < 0) continue;
    const a = nodeAt(f0, link.from.x, link.from.z);
    const b = nodeAt(f1, link.to.x, link.to.z);
    if (a < 0 || b < 0) continue;
    for (const [n0, n1, p0, p1, fa, fb, direction] of [
      [a, b, link.from, link.to, f0, f1, 'up'], [b, a, link.to, link.from, f1, f0, 'down'],
    ]) {
      const edge = { from: n0, to: n1, p0, p1, f0: fa, f1: fb, cost: link.cost, link, direction, bound: Infinity };
      if (!edges.has(n0)) edges.set(n0, []);
      edges.get(n0).push(edge);
      exits[fa].push(edge);
      directed.push(edge);
    }
  }
  // a lower bound of the cost from each link to the goal (Bellman–Ford over the few links)
  const gf = gfi;
  const restFrom = (f, x, z) => {
    let best = f === gf ? octile(x, z, goal.x, goal.z) : Infinity;
    for (const e of exits[f]) best = Math.min(best, octile(x, z, e.p0.x, e.p0.z) + e.bound);
    return best;
  };
  for (let pass = 0; pass <= directed.length; pass++) {
    let changed = false;
    for (const e of directed) {
      const b = e.cost + restFrom(e.f1, e.p1.x, e.p1.z);
      if (b < e.bound - 1e-9) { e.bound = b; changed = true; }
    }
    if (!changed) break;
  }

  // A*, kept lean: a long route visits a hundred thousand cells or more
  const g = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const linkFrom = new Uint8Array(total);
  for (const n of edges.keys()) linkFrom[n] = 1;
  const gx = goal.x;
  const gz = goal.z;
  const data = maps.map((m, f) => ({
    cols: m.cols, rows: m.rows, cells: m.cells, cost: nearWallOf(m).cost, off: offsets[f],
    cell: m.cell, diag: m.cell * SQRT2, x0: m.x0 + m.cell / 2, z0: m.z0 + m.cell / 2, goal: f === gf,
    ex: Float64Array.from(exits[f], (e) => e.p0.x), ez: Float64Array.from(exits[f], (e) => e.p0.z),
    eb: Float64Array.from(exits[f], (e) => e.bound),
  }));
  const hOf = (d, x, z) => {
    let best = Infinity;
    if (d.goal) {
      const dx = Math.abs(x - gx);
      const dz = Math.abs(z - gz);
      best = dx > dz ? dx + OCT * dz : dz + OCT * dx;
    }
    const { ex, ez, eb } = d;
    for (let e = 0; e < eb.length; e++) {
      const dx = Math.abs(x - ex[e]);
      const dz = Math.abs(z - ez[e]);
      const v = (dx > dz ? dx + OCT * dz : dz + OCT * dx) + eb[e];
      if (v < best) best = v;
    }
    return best;
  };
  const queue = createBucketQueue();
  g[startNode] = 0;
  queue.push(startNode, restFrom(fi(fromFloor), start.x, start.z));
  let found = false;
  for (;;) {
    const n = queue.pop();
    if (n < 0) break;
    if (closed[n]) continue;
    closed[n] = 1;
    if (n === goalNode) { found = true; break; }
    const f = floorIndexOf(n);
    const d = data[f];
    const { cols, rows, cells, cost, off } = d;
    const k = n - off;
    const i = k % cols;
    const j = (k - i) / cols;
    const gn = g[n];
    for (let q = 0; q < 8; q++) {
      const di = DI[q];
      const dj = DJ[q];
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = k + dj * cols + di;
      if (cells[nk] !== FREE) continue;
      if (q >= 4 && (cells[k + di] !== FREE || cells[k + dj * cols] !== FREE)) continue; // no corner cutting
      const nn = off + nk;
      if (closed[nn]) continue;
      const ng = gn + (q >= 4 ? d.diag : d.cell) * cost[nk];
      if (ng >= g[nn]) continue;
      const h = hOf(d, d.x0 + ni * d.cell, d.z0 + nj * d.cell);
      if (h === Infinity) continue; // the goal can't be reached from this floor
      g[nn] = ng;
      parent[nn] = n;
      queue.push(nn, ng + h);
    }
    if (!linkFrom[n]) continue;
    for (const e of edges.get(n)) {
      const ng = gn + e.cost;
      if (closed[e.to] || ng >= g[e.to]) continue;
      g[e.to] = ng;
      parent[e.to] = n;
      queue.push(e.to, ng + restFrom(e.f1, e.p1.x, e.p1.z));
    }
  }

  if (!found) return problem('NO_ROUTE', `No walking route to ${name}: something blocks the way`); // (known above)

  // the cells, split into one leg per floor
  const nodes = [];
  for (let n = goalNode; n !== -1; n = parent[n]) nodes.push(n);
  nodes.reverse();
  const legs = [];
  let leg = null;
  let length = 0;
  nodes.forEach((n, idx) => {
    const f = floorIndexOf(n);
    const map = maps[f];
    const k = n - offsets[f];
    if (!leg || leg.f !== f) {
      if (leg) {
        const prev = nodes[idx - 1];
        const e = (edges.get(prev) ?? []).find((x) => x.to === n);
        leg.stairsAtEnd = {
          kind: e.link.kind, objectId: e.link.objectId, direction: e.direction,
          toFloor: order[f], length: e.cost,
        };
        length += e.cost;
      }
      leg = { f, cells: [] };
      legs.push(leg);
    }
    leg.cells.push(map.passages?.get(k) ?? map.centreOf(k));
  });
  const first = legs[0].cells;
  first[0] = { x: start.x, z: start.z };
  const lastCells = legs[legs.length - 1].cells;
  if (lastCells.length > 1 || legs.length > 1) lastCells[lastCells.length - 1] = { x: goal.x, z: goal.z };
  else lastCells.push({ x: goal.x, z: goal.z });

  const out = legs.map((l) => {
    const points = smoothPath(maps[l.f], l.cells);
    length += pathLength(points);
    const r = { floor: order[l.f], points };
    if (l.stairsAtEnd) r.stairsAtEnd = l.stairsAtEnd;
    return r;
  });
  return {
    legs: out,
    length,
    seconds: length / (options.speed ?? WALK_SPEED),
    from: { x: start.x, z: start.z, floor: fromFloor },
    to: { x: goal.x, z: goal.z, floor: toFloor },
  };
}

/**
 * The point itself if the body fits exactly there (and `accept`s it), else the nearest free spot within
 * SNAP_DISTANCE that `accept(x, z)` takes (null: none).
 */
function snap(map, p, accept = null) {
  if (map.isClear(p.x, p.z) && (!accept || accept(p.x, p.z))) return { x: p.x, z: p.z };
  const spot = nearestFree(map, p.x, p.z, { maxDistance: SNAP_DISTANCE, accept });
  return spot && { x: spot.x, z: spot.z };
}

/**
 * A bucket queue of nodes by priority (metres, in BUCKET_STEP buckets): push and pop cost next to
 * nothing, and the newest node of a bucket comes out first (deeper cells win ties). A* pops in
 * near-increasing order, so the scan only moves forward (or back to a lower bucket a push made).
 */
function createBucketQueue() {
  let heads = new Int32Array(1 << 14).fill(-1);
  let nodes = new Int32Array(1 << 16);
  let next = new Int32Array(1 << 16);
  let count = 0;
  let free = -1; // popped items, reused
  let cur = 0;
  let size = 0;
  return {
    push(n, key) {
      const b = Math.max(0, Math.floor(key / BUCKET_STEP));
      if (b >= heads.length) {
        const h = new Int32Array(Math.max(b + 1, heads.length * 2)).fill(-1);
        h.set(heads);
        heads = h;
      }
      let id = free;
      if (id >= 0) free = next[id];
      else {
        if (count === nodes.length) {
          const nn = new Int32Array(count * 2); nn.set(nodes); nodes = nn;
          const nx = new Int32Array(count * 2); nx.set(next); next = nx;
        }
        id = count++;
      }
      nodes[id] = n;
      next[id] = heads[b];
      heads[b] = id;
      if (b < cur) cur = b;
      size++;
    },
    /** The node with the lowest priority, or −1 when empty. */
    pop() {
      if (!size) return -1;
      while (heads[cur] < 0) cur++;
      const id = heads[cur];
      heads[cur] = next[id];
      next[id] = free;
      free = id;
      size--;
      return nodes[id];
    },
  };
}

// ── For the tour (v0.14.3) ────────────────────────────────────────────────

/**
 * Which walkable area of a floor a spot is in (cells joined by side; −1: not FREE). Two spots with the
 * same area can be walked between on that floor.
 */
export function areaOf(map, x, z) {
  const k = map.indexOf(x, z);
  return k < 0 ? -1 : areasOf(map).label[k];
}

/** The length of a path of points (m). */
export { pathLength };

/**
 * The shortest route to the nearest of several places ("the nearest washroom"): routes are tried
 * nearest-first by straight-line distance, and stop as soon as no other place could be nearer (a
 * route is never shorter than the straight line). Result: that route + `goalIndex` (its place in
 * `goals`), or, when none can be reached, the first place's answer ({ problem, message }).
 * `options` as for findRoute (`name` is per goal: `goals[i].name`).
 */
export function findNearestRoute(layout, from, goals, options = {}) {
  if (!goals.length) return problem('NO_ROUTE', 'No walking route: there is nowhere to go');
  const maps = options.maps ?? createWalkMapCache({ catalog: options.catalog });
  const order = goals
    .map((g, i) => ({ g, i, line: Math.hypot(g.x - from.x, g.z - from.z) }))
    .sort((a, b) => a.line - b.line);
  let best = null;
  const problems = [];
  for (const { g, i, line } of order) {
    if (best && line >= best.length) break;
    const r = findRoute(layout, from, g, { ...options, maps, name: g.name ?? options.name });
    if (r.problem) { problems[i] = r; continue; }
    if (!best || r.length < best.length) best = { ...r, goalIndex: i };
  }
  return best ?? problems[0]; // none reachable: every goal was tried
}

/**
 * @typedef {object} Route
 * @property {{ floor: number, points: {x:number, z:number}[], stairsAtEnd?: { kind: string, objectId: string,
 *   direction: 'up' | 'down', toFloor: number, length: number } }[]} legs  one per floor walked on, in order
 * @property {number} length   metres, stairs included
 * @property {number} seconds  at Preview's walking speed
 * @property {{ x, z, floor }} from  where it really starts (moved off a wall or a desk if needed)
 * @property {{ x, z, floor }} to    where it really ends
 */
