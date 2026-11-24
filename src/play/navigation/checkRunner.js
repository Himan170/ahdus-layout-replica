/**
 * play/navigation/checkRunner.js (v0.18.11)
 *
 * PURE (no React, no Babylon): Check my layout in slices, on ONE fixed copy of the layout. Studio's idle check
 * (hooks/useLayoutCheck.js) runs it a slice at a time after a layout opens or changes, as navigation.warm() runs the
 * tour's plan: on 72 rooms / 864 items one whole check was a 640–1,100 ms task.
 *
 *   createSlicedCheck({ getLayout, makeSteps, sliceMs, clock }) → { slice(), reset(), restarts }
 *   slice() → { done: false } | { done: true, result }  (result = makeSteps' return value, `ms` = the working time)
 *
 * The copy: the store's `rooms`, `objects` and `floors` records (an edit always makes new records, never changes one
 * in place). Each slice first compares the store's records with the copy: a change (a drag dropped, an undo, a typed
 * size, a new floor) starts the check over on the new layout, so a result is never a mix of two layouts, and it is
 * only given out while the copy is still the store's layout. Anything else (the floor shown, the selection, the
 * ignored list) is not part of the check and changes nothing.
 */

/** The check runs this long per slice (ms), then gives the page a frame. */
export const CHECK_SLICE_MS = 8;

const defaultClock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The part of a layout the check reads: its records, kept as they are (a fixed copy). */
export function layoutCopy(layout) {
  return { rooms: layout?.rooms, objects: layout?.objects, floors: layout?.floors };
}

/** Is this still the layout the copy was taken from? */
export function sameLayout(copy, layout) {
  return !!copy && copy.rooms === layout?.rooms && copy.objects === layout?.objects && copy.floors === layout?.floors;
}

/**
 * @param {{ getLayout: () => object, makeSteps: (copy: object) => Generator, sliceMs?: number, clock?: () => number }} o
 *   getLayout: the layout now (the store's state); makeSteps: the check's steps for a copy (checkLayoutSteps)
 */
export function createSlicedCheck({ getLayout, makeSteps, sliceMs = CHECK_SLICE_MS, clock = defaultClock }) {
  let job = null; // { copy, steps, work }
  let restarts = 0;
  return {
    /** One slice of work, at least one step. */
    slice() {
      const now = getLayout();
      if (job && !sameLayout(job.copy, now)) { job = null; restarts++; }
      if (!job) {
        const copy = layoutCopy(now);
        job = { copy, steps: makeSteps(copy), work: 0 };
      }
      const t0 = clock();
      for (;;) {
        const r = job.steps.next();
        if (r.done) {
          const result = { ...r.value, ms: job.work + (clock() - t0) }; // the working time, not the time between slices
          job = null;
          return { done: true, result };
        }
        if (clock() - t0 >= sliceMs) break;
      }
      job.work += clock() - t0;
      return { done: false };
    },
    /** Drop a check that hasn't finished (the next slice starts a new one). */
    reset() { job = null; },
    /** How many times a check started over because the layout changed under it. */
    get restarts() { return restarts; },
    /** A check is half done. */
    get running() { return !!job; },
  };
}
