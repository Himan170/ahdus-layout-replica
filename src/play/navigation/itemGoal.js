/**
 * play/navigation/itemGoal.js (v0.18.7, Astra audit 2c)
 *
 * PURE: where a click on an item walks to. A click on a table's top used to walk to the spot clicked, a
 * little back towards the camera: the middle of a big meeting table is more than route.js's SNAP_DISTANCE
 * (1.5 m) from its edge, so the walk said "there's no room to stand there" although its sides were free.
 * Now the walk goes to the item's edge nearest to the point clicked, just outside it (where the body fits:
 * walkMap's ITEM_CLEARANCE and a little more), on the side the camera sees when two edges are as near.
 * The route still finds the nearest reachable spot from there, in the same room, never across a wall.
 */

import { itemFootprints, ITEM_CLEARANCE } from './walkMap';

/** How far outside the item's outline the walk ends (the body's centre). */
export const EDGE_GAP = ITEM_CLEARANCE + 0.05;

const local = (r, x, z) => {
  const c = Math.cos(r.rot ?? 0);
  const s = Math.sin(r.rot ?? 0);
  const dx = x - r.x;
  const dz = z - r.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
};
const world = (r, lx, lz) => {
  const c = Math.cos(r.rot ?? 0);
  const s = Math.sin(r.rot ?? 0);
  return { x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c };
};

/**
 * The spot just outside one turned rectangle { x, z, hw, hd, rot } nearest to (x, z), and how far it is.
 * Inside: across its nearest edge (two as near: the one facing `towards`, the camera). Outside: straight
 * out from the nearest point of its outline.
 */
export function edgeSpot(r, point, { gap = EDGE_GAP, towards = null } = {}) {
  const { lx, lz } = local(r, point.x, point.z);
  const t = towards ? local(r, towards.x, towards.z) : null;
  const inside = Math.abs(lx) <= r.hw && Math.abs(lz) <= r.hd;
  if (inside) {
    const signOf = (v, tv) => (Math.abs(v) > 1e-6 ? Math.sign(v) : Math.sign(tv ?? 1) || 1);
    const edges = [
      { d: r.hw - Math.abs(lx), at: () => ({ lx: signOf(lx, t?.lx) * (r.hw + gap), lz }), facing: t ? Math.sign(t.lx) === signOf(lx, t.lx) : false },
      { d: r.hd - Math.abs(lz), at: () => ({ lx, lz: signOf(lz, t?.lz) * (r.hd + gap) }), facing: t ? Math.sign(t.lz) === signOf(lz, t.lz) : false },
    ];
    edges.sort((a, b) => (Math.abs(a.d - b.d) < 0.05 ? Number(b.facing) - Number(a.facing) : a.d - b.d));
    const e = edges[0];
    const q = e.at();
    return { ...world(r, q.lx, q.lz), distance: e.d + gap };
  }
  const qx = Math.max(-r.hw, Math.min(r.hw, lx));
  const qz = Math.max(-r.hd, Math.min(r.hd, lz));
  const d = Math.hypot(lx - qx, lz - qz);
  if (d >= gap) return { x: point.x, z: point.z, distance: 0 }; // already clear of it
  const ux = (lx - qx) / (d || 1);
  const uz = (lz - qz) / (d || 1);
  return { ...world(r, qx + ux * gap, qz + uz * gap), distance: gap - d };
}

/**
 * Where a click on an item at `point` (the hit, world x / z) walks to: just outside the part of the item
 * nearest to it. `towards` (the camera) decides between two edges as near. null: an item with no outline.
 * @param {object} obj   the item (store fields: assetType, x, z, rotationY, scaleX / Z)
 * @param {{x:number, z:number}} point
 * @param {{ catalog?: object, towards?: {x:number, z:number} }} [options]
 */
export function itemWalkGoal(obj, point, { catalog = {}, towards = null } = {}) {
  const rects = itemFootprints(obj, catalog).filter((r) => r.hw > 0 && r.hd > 0);
  if (!rects.length) return null;
  let best = null;
  for (const r of rects) {
    const spot = edgeSpot(r, point, { towards });
    // a spot that lands in another part of the item (the corner desk's other arm) is no spot
    const inOther = rects.some((o) => o !== r && (() => { const q = local(o, spot.x, spot.z); return Math.abs(q.lx) < o.hw && Math.abs(q.lz) < o.hd; })());
    if (inOther) continue;
    if (!best || spot.distance < best.distance) best = spot;
  }
  return best ? { x: best.x, z: best.z } : null;
}
