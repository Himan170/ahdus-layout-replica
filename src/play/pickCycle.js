/**
 * play/pickCycle.js (v0.18.9)
 *
 * PURE: what a click in Studio's 3D / 2D view selects. Everything under the mouse, nearest first, in the order
 * furniture → wall (one drawn with the Wall tool, a glass partition) → room: a click on a chair selects the
 * chair, never the room or the wall behind it, even while that room is selected. A second click on the same spot
 * selects the next thing under it (chair → room → chair …). Things hidden behind a solid wall or under a floor
 * are not under the mouse. Doors and windows keep their own click (studioPointer). Tests:
 * play/__tests__/pickCycle.test.js.
 */

/** Items that are walls: they come after the furniture. */
export const WALL_ITEM_TYPES = new Set(['WALL_SEGMENT', 'GLASS_PARTITION']);
/** A click within this many pixels of the last one is "the same spot". */
export const SAME_SPOT_PX = 6;
/** …and within this long after it (ms); later it starts again from the top. */
export const CYCLE_MS = 5000;

const floorOf = (o) => o?.floor ?? o?.floorId ?? 0;

/**
 * The things a click could select, in the order it selects them.
 * @param {{ objectId?: string|null, roomId?: string|null, part?: string|null, glass?: boolean, ground?: boolean }[]} hits
 *   what the ray from the mouse passes, nearest first (the caller maps the floor under a desk to the desk)
 * @param {Record<string, object>} objects  the store's items
 * @param {{ floor?: number }} [options]  the floor being edited (items of other floors are not candidates)
 * @returns {{ kind: 'object' | 'room', id: string }[]}
 */
export function pickCandidates(hits, objects, { floor = 0 } = {}) {
  const items = [];
  const walls = [];
  const rooms = [];
  const seen = new Set();
  let blocked = false; // past a solid wall, a floor or the ground: what is further is hidden
  for (const h of hits ?? []) {
    if (!h) continue;
    if (h.objectId) {
      if (blocked) continue;
      const o = objects?.[h.objectId];
      if (!o || floorOf(o) !== floor || seen.has(`o:${o.id}`)) continue;
      seen.add(`o:${o.id}`);
      (WALL_ITEM_TYPES.has(o.assetType) ? walls : items).push({ kind: 'object', id: o.id });
      continue;
    }
    if (h.ground) break;
    if (h.roomId && (h.part === 'wall' || h.part === 'floor')) {
      if (!seen.has(`r:${h.roomId}`)) {
        seen.add(`r:${h.roomId}`);
        rooms.push({ kind: 'room', id: h.roomId });
      }
      if (h.part === 'floor') break; // nothing under a floor counts
      if (!h.glass) blocked = true;  // through glass you still see (and click) what is behind
    }
  }
  return [...items, ...walls, ...rooms];
}

const same = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;

/**
 * Which candidate a click selects: the first one, or (a click on the same spot as the last, `sameSpot`) the one
 * after the selected thing, round to the first again.
 * @param {{ kind: string, id: string }[]} candidates  pickCandidates
 * @param {{ kind: string, id: string } | null} current  what is selected now
 * @param {{ sameSpot?: boolean }} [options]
 * @returns {{ kind: string, id: string } | null}  null: nothing under the mouse (deselect)
 */
export function nextPick(candidates, current, { sameSpot = false } = {}) {
  if (!candidates?.length) return null;
  if (!sameSpot || !current) return candidates[0];
  const i = candidates.findIndex((c) => same(c, current));
  return i < 0 ? candidates[0] : candidates[(i + 1) % candidates.length];
}

/** Is this click on the same spot as the last one (pixels and time)? */
export function isSameSpot(last, now) {
  if (!last || !now) return false;
  return Math.hypot(now.x - last.x, now.y - last.y) <= SAME_SPOT_PX && now.t - last.t <= CYCLE_MS && now.t >= last.t;
}
