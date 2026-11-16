/**
 * play/aisles.js: PURE (v0.18.0). Room to walk between workstation clusters.
 * A cluster or desk row (a saved group, play/prefab.js) needs an aisle of at least AISLE_MIN beside it:
 * to the next cluster or row, to the walls of its room and to rooms standing inside that room. Pushed
 * together (AISLE_TOUCH or less) is one block, not an aisle: that is fine. Used by Check my layout
 * (AISLE_NARROW) and by the library drop's hint. Tested in play/__tests__/aisles.test.js.
 */

import { groupOf, groupOrigin } from './prefab';
import { prefabById } from '../catalog/manifest';
import { itemFootprints } from './navigation/walkMap';
import { distanceTo, rectsOverlap } from './turnedRect';
import { wallThicknessOf } from './geometry';

/** The narrowest aisle people walk along (m). */
export const AISLE_MIN = 0.9;
/** Closer than this is pushed together (m), not an aisle. */
export const AISLE_TOUCH = 0.05;
/** Prefab layouts that need aisles (a manager desk and a cabin have their own room). */
export const AISLE_LAYOUTS = new Set(['cluster', 'row']);

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (o) => o.floor ?? 0;
const EPS = 1e-6;

function corners(r) {
  const c = Math.cos(r.rot ?? 0);
  const s = Math.sin(r.rot ?? 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: r.x + a * r.hw * c + b * r.hd * s, z: r.z - a * r.hw * s + b * r.hd * c }));
}

/**
 * The outline of a group as it stands now: the rectangle, turned as the group is, around every member's
 * footprint (chairs pulled out included). Members moved on their own still count where they are.
 */
export function groupOutline(prefab, members, catalog) {
  const at = groupOrigin(prefab, members, catalog);
  const rot = at?.rotationY ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const o of members) {
    for (const fp of itemFootprints(o, catalog)) {
      for (const p of corners(fp)) {
        // into the group's frame (the inverse of toWorld)
        const lx = p.x * c - p.z * s;
        const lz = p.x * s + p.z * c;
        x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
      }
    }
  }
  if (!Number.isFinite(x0)) return null;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  return { x: mx * c + mz * s, z: -mx * s + mz * c, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, rot };
}

/** The saved groups that need aisles, per floor: [{ groupId, prefab, members, outline, floor }]. */
export function aisleGroups(objects, catalog) {
  const byGroup = new Map();
  for (const o of list(objects)) {
    const g = groupOf(o);
    if (!g) continue;
    if (!byGroup.has(g.id)) byGroup.set(g.id, []);
    byGroup.get(g.id).push(o);
  }
  const out = [];
  for (const [groupId, members] of byGroup) {
    const prefab = prefabById(groupOf(members[0]).prefab);
    if (!prefab || !AISLE_LAYOUTS.has(prefab.layout)) continue;
    const outline = groupOutline(prefab, members, catalog);
    if (outline) out.push({ groupId, prefab, members, outline, floor: floorOf(members[0]) });
  }
  return out;
}

/** The gap between two turned rectangles (0 when they touch or overlap). */
export function rectGap(a, b) {
  if (rectsOverlap(a, b)) return 0;
  let best = Infinity;
  for (const p of corners(a)) best = Math.min(best, distanceTo(b, p.x, p.z));
  for (const p of corners(b)) best = Math.min(best, distanceTo(a, p.x, p.z));
  return best;
}

/** The innermost room on a floor holding a point. */
function roomAtPoint(rooms, floor, x, z) {
  let best = null;
  for (const r of rooms) {
    if (floorOf(r) !== floor) continue;
    if (Math.abs(x - r.x) > r.width / 2 + EPS || Math.abs(z - r.z) > r.depth / 2 + EPS) continue;
    if (!best || r.width * r.depth < best.width * best.depth) best = r;
  }
  return best;
}

/**
 * The narrowest gap beside an outline in its room: to the walls (their inner faces) and to the rooms
 * standing inside that room (their outer faces). → { gap, what: 'wall' | 'room', room } or null.
 */
export function wallGap(outline, rooms, floor) {
  const home = roomAtPoint(rooms, floor, outline.x, outline.z);
  if (!home) return null;
  const pts = corners(outline);
  const t = wallThicknessOf(home) / 2;
  const inner = { x0: home.x - home.width / 2 + t, x1: home.x + home.width / 2 - t, z0: home.z - home.depth / 2 + t, z1: home.z + home.depth / 2 - t };
  let best = null;
  const take = (gap, what, room) => { if (gap > AISLE_TOUCH && (!best || gap < best.gap)) best = { gap, what, room }; };
  take(Math.min(...pts.map((p) => p.x - inner.x0)), 'wall', home);
  take(Math.min(...pts.map((p) => inner.x1 - p.x)), 'wall', home);
  take(Math.min(...pts.map((p) => p.z - inner.z0)), 'wall', home);
  take(Math.min(...pts.map((p) => inner.z1 - p.z)), 'wall', home);
  for (const r of rooms) {
    if (r === home || floorOf(r) !== floor) continue;
    // a room inside this one: its walls stand in the way like any wall
    if (Math.abs(r.x - home.x) > (home.width - r.width) / 2 + EPS || Math.abs(r.z - home.z) > (home.depth - r.depth) / 2 + EPS) continue;
    const half = wallThicknessOf(r) / 2;
    const box = { x: r.x, z: r.z, hw: r.width / 2 + half, hd: r.depth / 2 + half, rot: 0 };
    take(rectGap(outline, box), 'room', r);
  }
  return best && best.gap < AISLE_MIN - 1e-3 ? best : null;
}

/** "0.6 m": a gap as Check and the hints say it (rounded down, so 0.89 is never "0.9 m"). */
export const metres = (v) => `${(Math.floor(v * 10) / 10).toFixed(1)} m`;

/**
 * Every aisle narrower than AISLE_MIN on a layout: [{ ids, groups, gap, message, floor, objectId }].
 * Between two groups once; a group and its room's walls once (the narrowest).
 */
export function narrowAisles(layout, catalog) {
  const rooms = list(layout.rooms);
  const groups = aisleGroups(layout.objects, catalog);
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const a = groups[i];
    const deskOf = (g) => g.members.find((o) => groupOf(o).role === 'desk')?.id ?? g.members[0].id;
    for (let j = i + 1; j < groups.length; j++) {
      const b = groups[j];
      if (b.floor !== a.floor) continue;
      const gap = rectGap(a.outline, b.outline);
      if (gap <= AISLE_TOUCH || gap >= AISLE_MIN - 1e-3) continue;
      out.push({
        ids: [...a.members, ...b.members].map((o) => o.id), groups: [a.groupId, b.groupId], gap, floor: a.floor, objectId: deskOf(a),
        sides: { [a.groupId]: `the ${b.prefab.label.toLowerCase()}`, [b.groupId]: `the ${a.prefab.label.toLowerCase()}` },
        message: `Only ${metres(gap)} between the ${a.prefab.label.toLowerCase()} and the ${b.prefab.label.toLowerCase()}: an aisle needs ${AISLE_MIN} m`,
      });
    }
    const w = wallGap(a.outline, rooms, a.floor);
    if (w) {
      const name = String(w.room.name ?? '').trim() || 'the room';
      out.push({
        ids: a.members.map((o) => o.id), groups: [a.groupId], gap: w.gap, floor: a.floor, objectId: deskOf(a),
        sides: { [a.groupId]: w.what === 'wall' ? 'the wall' : `the walls of ${w.room.name}` },
        message: `Only ${metres(w.gap)} between the ${a.prefab.label.toLowerCase()} and the wall of ${name}: an aisle needs ${AISLE_MIN} m`,
      });
    }
  }
  return out;
}

/**
 * While a prefab is dropped (its outline at a spot): the narrowest aisle it would leave, or null.
 * @returns {{ gap: number, text: string } | null}
 */
export function dropAisle(outline, layout, floor, catalog) {
  let best = null;
  const w = wallGap(outline, list(layout.rooms), floor);
  if (w) best = { gap: w.gap, text: `Leaves ${metres(w.gap)} to the ${w.what === 'wall' ? 'wall' : `walls of ${w.room.name}`}: an aisle needs ${AISLE_MIN} m` };
  for (const g of aisleGroups(layout.objects, catalog)) {
    if (g.floor !== floor) continue;
    const gap = rectGap(outline, g.outline);
    if (gap > AISLE_TOUCH && gap < AISLE_MIN - 1e-3 && (!best || gap < best.gap)) {
      best = { gap, text: `Leaves ${metres(gap)} to the ${g.prefab.label.toLowerCase()}: an aisle needs ${AISLE_MIN} m` };
    }
  }
  return best;
}
