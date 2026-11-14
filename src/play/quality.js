// v0.17.0: the viewer lowers its own quality when frames are slow, and raises it again when they are smooth for a
// while ("drop fast, rise slowly", like the full-character cap in live.js). PURE: no Babylon, no DOM.
//
// The steps, best first: the pixel ratio (never above 2: a phone at 3 draws 9 × the pixels of 1), then 1.5, then 1;
// then no shadows; then fewer full characters. A step that changes nothing on this screen (1.5 on a screen of
// ratio 1) is left out, so every drop is felt.

/** The pixel ratio is never above this, before any drop (a phone at 3 = 2.25 × the pixels of 2). */
export const MAX_PIXEL_RATIO = 2;
/** At the last step, at most this many full characters (the cap's 12 otherwise). */
export const LOW_FULL_CHARACTERS = 6;
/** A window (3 s, live.js CAP_WINDOW_MS) under this p90 frame rate drops one step at once. */
export const DROP_FPS = 30;
/** This many windows in a row at or over RAISE_FPS raise one step... */
export const RAISE_FPS = 50;
export const RAISE_AFTER = 5;
/** ...but not within this long of the last drop (ms). */
export const RAISE_HOLD_MS = 60000;

/**
 * The quality steps on a screen of this pixel ratio, best first: { pixelRatio, shadows, maxFull } (maxFull null =
 * no limit beyond the cap). Steps the same as the one before are left out.
 * @param {number} dpr  window.devicePixelRatio
 */
export function qualitySteps(dpr = 1) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const r = (cap) => Math.min(ratio, cap);
  const all = [
    { pixelRatio: r(MAX_PIXEL_RATIO), shadows: true, maxFull: null },
    { pixelRatio: r(1.5), shadows: true, maxFull: null },
    { pixelRatio: r(1), shadows: true, maxFull: null },
    { pixelRatio: r(1), shadows: false, maxFull: null },
    { pixelRatio: r(1), shadows: false, maxFull: LOW_FULL_CHARACTERS },
  ];
  return all.filter((s, i) => i === 0 || s.pixelRatio !== all[i - 1].pixelRatio || s.shadows !== all[i - 1].shadows
    || s.maxFull !== all[i - 1].maxFull);
}

/**
 * The step after one window of frames: { level, good, holdUntil } from the state before and that window's frame
 * rate (live.js windowFps: its p90 frame; null = too few frames, nothing changes).
 * @param {{ level: number, good: number, holdUntil: number }} state
 * @param {{ fps: number | null, now: number, steps: number }} window  steps = qualitySteps(dpr).length
 */
export function nextQuality(state, { fps, now, steps }) {
  const last = Math.max(0, steps - 1);
  const s = {
    level: Math.min(last, Math.max(0, Number.isInteger(state?.level) ? state.level : 0)),
    good: state?.good ?? 0,
    holdUntil: state?.holdUntil ?? 0,
  };
  if (fps === null || !Number.isFinite(fps)) return s;
  if (fps < DROP_FPS) {
    if (s.level >= last) return { ...s, good: 0 };
    return { level: s.level + 1, good: 0, holdUntil: now + RAISE_HOLD_MS };
  }
  if (fps >= RAISE_FPS && s.level > 0 && now >= s.holdUntil) {
    const good = s.good + 1;
    if (good >= RAISE_AFTER) return { level: s.level - 1, good: 0, holdUntil: s.holdUntil };
    return { ...s, good };
  }
  return { ...s, good: 0 };
}

// ── "Low graphics" (the viewer's switch, remembered per browser) ─────────

export const LOW_GRAPHICS_KEY = 'ahdus.lowGraphics';

/** The viewer's "Low graphics" switch as last set in this browser (false when storage is blocked). */
export function storedLowGraphics(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LOW_GRAPHICS_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeLowGraphics(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(LOW_GRAPHICS_KEY, '1');
    else storage?.removeItem(LOW_GRAPHICS_KEY);
  } catch { /* blocked: this visit only */ }
}
