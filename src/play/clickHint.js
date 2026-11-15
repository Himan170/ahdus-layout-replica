/**
 * clickHint.js (v0.17.3): PURE. What a walking click that can't be walked to says.
 *
 * A click (a tap) walks to the floor or up / down the stairs. On a wall, a ceiling, the sky or a spot no
 * route reaches it used to do nothing, or put "No walking route to …" in the HUD. Now a short hint shows
 * at the click, "Click the floor or the stairs to walk there", for CLICK_HINT_MS, at most once every
 * CLICK_HINT_GAP_MS; a room that really can't be reached keeps its own message ("…: it has no door").
 * Used by LayoutEngine._walkClick (viewer, embed), Studio's Walk through (useStudioScene), the hint's
 * component (engine/react/ClickHint.tsx) and playController.clickTarget (what a click can't walk to).
 * Tests: play/__tests__/clickHint.test.js.
 */

export const CLICK_HINT = 'Click the floor or the stairs to walk there';
export const CLICK_HINT_TOUCH = 'Tap the floor or the stairs';
/** How long the hint shows (ms), the last part of it fading. */
export const CLICK_HINT_MS = 2000;
export const CLICK_HINT_FADE_MS = 400;
/** At most one hint in this long (ms): clicking on and on at a wall doesn't flash it. */
export const CLICK_HINT_GAP_MS = 4000;

/**
 * Room parts a click can't walk to: what you stand on is the floor (and the ground, the stairs); a door
 * is walked through (a click on it walks to the doorway), so it is not here.
 */
export const NO_WALK_PARTS = new Set(['wall', 'window', 'ceiling', 'roof', 'slab', 'band', 'skirting']);

/**
 * Route problems (route.js) that name a room nobody can reach: their own message stays, it says why
 * ("No walking route to Server Room: it has no door"). Every other problem (a spot boxed in by
 * furniture, nothing to stand on, "something blocks the way") gets the hint.
 */
export const ROOM_PROBLEMS = new Set(['NO_DOOR', 'START_NO_DOOR', 'NO_STAIRS']);

export const clickHintText = (touch) => (touch ? CLICK_HINT_TOUCH : CLICK_HINT);

/**
 * What a click that didn't start a walk shows: 'hint' (near the click), 'message' (the route's own
 * words, as before) or null (nothing: it did something else, or there is nothing to say).
 * @param {{ walkTo?: object | null, problem?: string | null }} click  walkTo null: nothing to walk to
 */
export function clickFeedback({ walkTo = null, problem = null } = {}) {
  if (!walkTo) return 'hint';
  if (!problem) return null;
  return ROOM_PROBLEMS.has(problem) ? 'message' : 'hint';
}

/**
 * At most one hint per `gapMs`. `allow(now)` → true when one may show now (and counts it).
 */
export function createHintGate({ gapMs = CLICK_HINT_GAP_MS } = {}) {
  let last = -Infinity;
  return {
    allow(now) {
      if (now - last < gapMs) return false;
      last = now;
      return true;
    },
    reset() { last = -Infinity; },
  };
}

/**
 * Where the hint goes (its middle, CSS px in the view): just above the click, kept inside a view of
 * `width` × `height` with `half` px on either side of its middle and `margin` from the edges.
 */
export function hintSpot({ x, y }, { width, height }, { half = 140, margin = 8, above = 28 } = {}) {
  const lo = margin + half;
  const hi = width - margin - half;
  const cx = lo <= hi ? Math.min(hi, Math.max(lo, x)) : width / 2;
  const cy = Math.min(height - margin - 16, Math.max(margin + 16, y - above));
  return { x: cx, y: cy };
}
