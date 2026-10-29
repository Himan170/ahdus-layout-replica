/**
 * buildSchedule.js
 *
 * PURE (no Babylon): in what order a layout's scene is built, in slices of a
 * few milliseconds, so opening a big layout never freezes the tab
 * (engine/systems/SceneBuilder runs the slices).
 *   - The floor you start on first, then the floors below it (Studio shows
 *     them under it), then the ones above, nearest first.
 *   - Each slice works until its time budget is used, always doing at least
 *     one thing, so a slow machine still gets somewhere.
 *   - After the first build, small edits are built at once (as before); a
 *     change that brings many new rooms / items is built in slices again.
 */

import { floorsByElevation } from './building';

/** Time per slice (ms): short enough that the page stays responsive. */
export const BUILD_BUDGET_MS = 10;

/** More new rooms + items than this in one change: build it in slices. */
export const BIG_CHANGE = 50;

/**
 * Floor ids in build order: `startFloor`, the floors below it (nearest
 * first), then the floors above it (nearest first). Unknown start: bottom up.
 */
export function floorBuildOrder(floors, startFloor) {
  const ids = floorsByElevation(floors).map((f) => f.id);
  const i = ids.indexOf(startFloor);
  if (i < 0) return ids;
  return [startFloor, ...ids.slice(0, i).reverse(), ...ids.slice(i + 1)];
}

/**
 * A time budget for one slice. take() says whether to do the next piece of
 * work: always yes for the first one, then while less than `ms` has passed.
 */
export function createBudget(ms = BUILD_BUDGET_MS, now = () => performance.now()) {
  const start = now();
  let taken = 0;
  const hasTime = () => taken === 0 || now() - start < ms;
  return {
    take() {
      if (!hasTime()) return false;
      taken++;
      return true;
    },
    /** Is there time for another piece (without taking it)? */
    hasTime,
    /** How many pieces were done in this slice. */
    get taken() { return taken; },
    /** No limit: the work done at once (small edits, finishing a build). */
    unlimited: !Number.isFinite(ms),
  };
}

/** A budget that never runs out. */
export const UNLIMITED = Object.freeze({ take: () => true, hasTime: () => true, taken: 0, unlimited: true });

/** Should a change that brings `newCount` rooms + items be built in slices? */
export function isBigChange(newCount, threshold = BIG_CHANGE) {
  return newCount > threshold;
}

/**
 * Progress of a build for the indicator and the 'progress' event.
 * @param total      rooms + items in the layout
 * @param pending    Map floorId → rooms + items on that floor still to build
 * @param order      floor ids in build order (floorBuildOrder)
 * @param startFloor the floor the user is on
 * @returns {{ done, total, floor, currentFloorReady, allBuilt }}
 *   floor: the floor being built now (the first in order with work left; the
 *   start floor when nothing is left)
 */
export function buildProgress({ total, pending, order, startFloor }) {
  let left = 0;
  for (const n of pending.values()) left += n;
  const floor = order.find((f) => (pending.get(f) ?? 0) > 0) ?? startFloor;
  return {
    done: Math.max(0, total - left),
    total,
    floor,
    currentFloorReady: (pending.get(startFloor) ?? 0) === 0,
    allBuilt: left === 0,
  };
}

/** "40 %" of a progress (100 % when there is nothing to build). */
export function progressPercent({ done, total }) {
  return total > 0 ? Math.floor((done / total) * 100) : 100;
}
