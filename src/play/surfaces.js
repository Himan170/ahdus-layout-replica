/**
 * play/surfaces.js (v0.18.6, Astra audit 2a / 13 / 14)
 *
 * PURE: where an item's top really is, so what is dropped on it (a Desk Plant, a monitor) stands on a
 * surface, never in mid-air beside it. Most items are one box: their whole footprint at their full height.
 * The others, as their meshes draw them (assetCatalog; their real models are fitted into the same box):
 *   DESK_CORNER   two arms (the −Z one and the −X one, people.CORNER_DESK_ARM of its size deep); the +X, +Z
 *                 corner is open floor (its chair goes there)
 *   TABLE_ROUND   a round top (an ellipse when it is stretched)
 *   WALL_SHELF    the bare board (half its height) and, on its left, the books (its full height)
 * Parts are in fractions of the item's footprint (−0.5 … 0.5 along its own x and z; a negative scale mirrors
 * them, as it does the mesh) and of its height (`top`). Plan view draws the same outlines (planOutline).
 */

import { CORNER_DESK_ARM } from './people';

const A = 0.5 - CORNER_DESK_ARM;

/** The surfaces of the items that are not one box. */
export const SURFACE_PARTS = {
  DESK_CORNER: [
    { x0: -0.5, x1: 0.5, z0: -0.5, z1: -A, top: 1 },
    { x0: -0.5, x1: -A, z0: -A, z1: 0.5, top: 1 },
  ],
  TABLE_ROUND: [{ disk: true, top: 1 }],
  WALL_SHELF: [
    { x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5, top: 0.5 },     // the board: 0.15 of 0.30 m
    { x0: -0.325, x1: -0.065, z0: -0.44, z1: 0.28, top: 1 }, // the books on it
  ],
};

/** An item's point in fractions of its footprint (fx, fz: −0.5 … 0.5 on it), from a world point. */
function local(obj, point, width, depth) {
  const r = Number(obj.rotationY) || 0;
  const dx = point.x - (Number(obj.x) || 0);
  const dz = point.z - (Number(obj.z) || 0);
  const lx = dx * Math.cos(r) - dz * Math.sin(r);
  const lz = dx * Math.sin(r) + dz * Math.cos(r);
  return { fx: width ? lx / width : Infinity, fz: depth ? lz / depth : Infinity };
}

const EPS = 1e-9;

/**
 * How high above an item's own foot the surface under a world point is (metres), or null when the point is not
 * on it (beside it, in the L's open corner, past the round top's edge).
 * @param {object} obj   { assetType, x, z, rotationY }
 * @param {{x:number,z:number}} point
 * @param {{ width:number, depth:number, height:number }} size  its size (catalogue × scale; a negative scale mirrors)
 */
export function surfaceTopAt(obj, point, size) {
  const { fx, fz } = local(obj, point, size.width, size.depth);
  const parts = SURFACE_PARTS[obj?.assetType];
  if (!parts) return Math.abs(fx) <= 0.5 + EPS && Math.abs(fz) <= 0.5 + EPS ? Math.abs(size.height) : null;
  let top = null;
  for (const p of parts) {
    const on = p.disk ? fx * fx + fz * fz <= 0.25 + EPS
      : fx >= p.x0 - EPS && fx <= p.x1 + EPS && fz >= p.z0 - EPS && fz <= p.z1 + EPS;
    if (on && (top === null || p.top > top)) top = p.top;
  }
  return top === null ? null : top * Math.abs(size.height);
}

/**
 * The outline Plan view draws for an item: 'rect' (its footprint), 'ellipse' (a round top), or a polygon in
 * fractions of its footprint ([[fx, fz], …]: the corner desk's L).
 */
export function planOutline(assetType) {
  if (assetType === 'TABLE_ROUND') return { kind: 'ellipse' };
  if (assetType === 'DESK_CORNER') {
    return { kind: 'polygon', points: [[-0.5, -0.5], [0.5, -0.5], [0.5, -A], [-A, -A], [-A, 0.5], [-0.5, 0.5]] };
  }
  return { kind: 'rect' };
}
