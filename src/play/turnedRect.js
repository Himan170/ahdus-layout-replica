/**
 * play/turnedRect.js
 *
 * PURE: turned rectangles on the floor, { x, z, hw, hd, rot } (centre, half width along the
 * rectangle's own X, half depth along its own Z, rot = Babylon's rotationY). The shape
 * walkMap.itemFootprints gives for an item. Used by Check my layout and the stairs' fit.
 */

const axesOf = (r) => {
  const c = Math.cos(r.rot ?? 0);
  const s = Math.sin(r.rot ?? 0);
  return [{ x: c, z: -s }, { x: s, z: c }]; // local +X, local +Z
};

/** Do two turned rectangles overlap by more than `tol` (each shrunk by tol / 2)? Separating axes. */
export function rectsOverlap(a, b, tol = 0) {
  const t = tol / 2;
  const ra = { ...a, hw: a.hw - t, hd: a.hd - t };
  const rb = { ...b, hw: b.hw - t, hd: b.hd - t };
  if (ra.hw <= 0 || ra.hd <= 0 || rb.hw <= 0 || rb.hd <= 0) return false;
  const [ax, az] = axesOf(ra);
  const [bx, bz] = axesOf(rb);
  const dx = rb.x - ra.x;
  const dz = rb.z - ra.z;
  for (const n of [ax, az, bx, bz]) {
    const reachA = ra.hw * Math.abs(ax.x * n.x + ax.z * n.z) + ra.hd * Math.abs(az.x * n.x + az.z * n.z);
    const reachB = rb.hw * Math.abs(bx.x * n.x + bx.z * n.z) + rb.hd * Math.abs(bz.x * n.x + bz.z * n.z);
    if (Math.abs(dx * n.x + dz * n.z) >= reachA + reachB) return false;
  }
  return true;
}

/** How far a turned rectangle reaches from its centre (a circle around it: a quick "can't touch" test). */
export const reachOf = (r) => Math.hypot(r.hw, r.hd);

/** Too far apart to touch at all. */
export const farApart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) > reachOf(a) + reachOf(b);

/** The axis-aligned box { x0, x1, z0, z1 } around a turned rectangle. */
export function boxOf(r) {
  const c = Math.abs(Math.cos(r.rot ?? 0));
  const s = Math.abs(Math.sin(r.rot ?? 0));
  const hx = r.hw * c + r.hd * s;
  const hz = r.hw * s + r.hd * c;
  return { x0: r.x - hx, x1: r.x + hx, z0: r.z - hz, z1: r.z + hz };
}

/** An axis-aligned box as a turned rectangle. */
export const rectOfBox = (b) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, hw: (b.x1 - b.x0) / 2, hd: (b.z1 - b.z0) / 2, rot: 0 });

/** Distance from a point to a turned rectangle (0 inside). */
export function distanceTo(rect, x, z) {
  const c = Math.cos(rect.rot ?? 0);
  const s = Math.sin(rect.rot ?? 0);
  const dx = x - rect.x;
  const dz = z - rect.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.hypot(Math.max(Math.abs(lx) - rect.hw, 0), Math.max(Math.abs(lz) - rect.hd, 0));
}
