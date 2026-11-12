/**
 * play/dragSnap.js (v0.15.6)
 *
 * PURE: where a dragged item snaps to, and the guide lines that say why. While an item is dragged (Studio's
 * 3D / 2D drag, Plan view) its outline lines up with what is near, one axis at a time:
 *   - a wall: its side against the wall's face (the face it stands in front of), "wall"; a wall in reach
 *     wins over any item (backing onto the wall matters more than lining up with a desk in the next room)
 *   - another item: edge to edge (its left edge on the other's left or right edge, …), "edge";
 *     middle to middle, "centre"
 *   - else the grid (Studio's snap step), with no guide line.
 * Hold Alt for none of these (the caller passes `free`).
 *
 * Outlines are axis-aligned boxes around the item's turned footprint (walkMap.itemFootprints: an L-shaped
 * desk's two arms; models bigger than their catalogue size). Only walls along X or Z are used.
 *
 *   const targets = snapTargets(objects, pieces, { catalog, ignore })   once, when the drag starts
 *   const s = snapDrag(item, { x, z }, targets, { grid, tolerance })     every pointer move
 *   s = { x, z, guides: [{ ax, az, bx, bz, kind }], snapped: { x: kind | null, z: kind | null } }
 *
 * Meridian (2 floors, 700+ items): the targets of a floor take a few ms; a move scans them in well under 1 ms.
 */
import { itemFootprints } from './navigation/walkMap';
import { wallFaces } from './wallMount';

/** How near (m) an edge must come to a line to snap onto it. */
export const SNAP_TOLERANCE = 0.15;
/** Items further than this (m) from the dragged one are no snap targets: lines across the building only confuse. */
export const SNAP_REACH = 8;

const EPS = 1e-6;
const AXIS = 0.999; // |n| along X or Z: a wall along an axis

/** The axis-aligned box around an item's footprint (its rectangles, turned). */
export function itemBox(obj, catalog = {}) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const r of itemFootprints(obj, catalog)) {
    const c = Math.abs(Math.cos(r.rot ?? 0));
    const s = Math.abs(Math.sin(r.rot ?? 0));
    const hx = r.hw * c + r.hd * s;
    const hz = r.hw * s + r.hd * c;
    x0 = Math.min(x0, r.x - hx); x1 = Math.max(x1, r.x + hx);
    z0 = Math.min(z0, r.z - hz); z1 = Math.max(z1, r.z + hz);
  }
  return { x0, x1, z0, z1 };
}

/**
 * What a drag can snap to on one floor: the items' boxes and the wall faces along X or Z.
 * @param {object[]} objects  the floor's items
 * @param {object[]} pieces   wallMount.wallPieces of the floor
 * @param {{ catalog?: object, ignore?: Iterable<string> }} [options]  ignore: the dragged items (and what they carry)
 * @returns {{ items: object[], walls: object[], catalog: object }}
 *   items: [{ id, x0, x1, z0, z1, cx, cz }]; walls: [{ axis: 'x' | 'z', at, side: 1 | -1, from, to }]
 *   (a wall with axis 'x' is a line x = at from z = from to z = to; `side` = where its room is: +1 = larger x)
 */
export function snapTargets(objects = [], pieces = [], { catalog = {}, ignore = [] } = {}) {
  const skip = new Set(ignore);
  const items = [];
  for (const o of objects) {
    if (skip.has(o.id) || o.assetType === 'WALL_SEGMENT' || catalog[o.assetType]?.category === 'Marker') continue;
    const b = itemBox(o, catalog);
    if (!Number.isFinite(b.x0)) continue;
    items.push({ id: o.id, ...b, cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2 });
  }
  const walls = [];
  for (const f of wallFaces(pieces)) {
    const alongX = Math.abs(f.nx) > AXIS; // the face looks along X: a line x = …
    const alongZ = Math.abs(f.nz) > AXIS;
    if (!alongX && !alongZ) continue;
    const n = alongX ? f.nx : f.nz;
    const u = alongX ? f.uz : f.ux; // along the face: s = u · (that coordinate)
    for (const sp of f.spans) {
      const a = sp.s0 * u;
      const b = sp.s1 * u;
      walls.push({ axis: alongX ? 'x' : 'z', at: f.c / n, side: Math.sign(n), from: Math.min(a, b), to: Math.max(a, b) });
    }
  }
  return { items, walls, catalog };
}

const round = (v, step) => Math.round(v / step) * step;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Snap one axis. `lo` / `hi` / `mid`: the dragged box on this axis; `cLo` / `cHi`: its extent on the other axis.
 * Returns { delta, kind, at, from, to } or null.
 */
function snapAxis(axis, box, targets, tolerance) {
  const lo = axis === 'x' ? box.x0 : box.z0;
  const hi = axis === 'x' ? box.x1 : box.z1;
  const mid = (lo + hi) / 2;
  const oLo = axis === 'x' ? box.z0 : box.x0; // the box on the other axis (where the guide line runs)
  const oHi = axis === 'x' ? box.z1 : box.x1;
  let best = null;
  const consider = (delta, kind, at, from, to, rank) => {
    const d = Math.abs(delta);
    if (d > tolerance + EPS) return;
    // a wall before any item; then nearer wins; a tie: an edge before a middle
    if (best && (rank > 0) !== (best.rank > 0)) {
      if (best.rank === 0) return; // a wall is already in reach
    } else if (best && (d > best.d + EPS || (Math.abs(d - best.d) <= EPS && rank >= best.rank))) return;
    best = { d, delta, kind, at, from, to, rank };
  };
  for (const w of targets.walls) {
    if (w.axis !== axis) continue;
    if (w.to < oLo - tolerance || w.from > oHi + tolerance) continue; // the wall isn't beside the item
    // its side towards the room against the face; only from the room's side of it
    const edge = w.side > 0 ? lo : hi;
    if ((mid - w.at) * w.side < 0) continue;
    consider(w.at - edge, 'wall', w.at, Math.min(w.from, oLo), Math.max(w.to, oHi), 0);
  }
  for (const it of targets.items) {
    const tLo = axis === 'x' ? it.x0 : it.z0;
    const tHi = axis === 'x' ? it.x1 : it.z1;
    const tMid = axis === 'x' ? it.cx : it.cz;
    const pLo = axis === 'x' ? it.z0 : it.x0;
    const pHi = axis === 'x' ? it.z1 : it.x1;
    // near enough on the other axis to be worth lining up with
    if (pLo > oHi + SNAP_REACH || pHi < oLo - SNAP_REACH) continue;
    if (tLo > hi + SNAP_REACH || tHi < lo - SNAP_REACH) continue;
    const from = Math.min(pLo, oLo);
    const to = Math.max(pHi, oHi);
    for (const [mine, theirs] of [[lo, tLo], [lo, tHi], [hi, tLo], [hi, tHi]]) consider(theirs - mine, 'edge', theirs, from, to, 1);
    consider(tMid - mid, 'centre', tMid, from, to, 2);
  }
  return best;
}

/**
 * Where a dragged item goes: { x, z, guides, snapped }.
 * @param {object} obj     the dragged item (its type, size, scale and turn: rotationY as it will be)
 * @param {{ x: number, z: number }} at  where the drag would put its middle
 * @param {{ items, walls }} targets  snapTargets
 * @param {{ grid?: number, tolerance?: number, free?: boolean }} [options]
 *   grid: the snap step (0: 5 cm); free (Alt held): no snapping at all (1 cm)
 */
export function snapDrag(obj, at, targets, { grid = 0, tolerance = SNAP_TOLERANCE, free = false } = {}) {
  if (free) return { x: round(at.x, 0.01), z: round(at.z, 0.01), guides: [], snapped: { x: null, z: null } };
  const own = itemBox({ ...obj, x: at.x, z: at.z }, targets.catalog ?? {});
  const box = { x0: own.x0, x1: own.x1, z0: own.z0, z1: own.z1 };
  const step = grid > 0 ? grid : 0.05;
  const sx = snapAxis('x', box, targets, tolerance);
  const sz = snapAxis('z', box, targets, tolerance);
  const x = sx ? at.x + sx.delta : round(at.x, step);
  const z = sz ? at.z + sz.delta : round(at.z, step);
  const guides = [];
  if (sx) guides.push({ ax: sx.at, az: sx.from, bx: sx.at, bz: sx.to, kind: sx.kind });
  if (sz) guides.push({ ax: sz.from, az: sz.at, bx: sz.to, bz: sz.at, kind: sz.kind });
  return { x: r3(x), z: r3(z), guides, snapped: { x: sx?.kind ?? null, z: sz?.kind ?? null } };
}

/** "Lined up with the wall" … for the hint while dragging, or null when it only snapped to the grid. */
export function snapText(snapped) {
  const kinds = [snapped?.x, snapped?.z].filter(Boolean);
  if (!kinds.length) return null;
  if (kinds.includes('wall')) return 'Against the wall';
  if (kinds.includes('edge')) return 'Lined up with an item';
  return 'Centred on an item';
}
