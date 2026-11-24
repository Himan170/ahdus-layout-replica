/**
 * engine/perfTip.ts (v0.18.10): the tip for a smoother 3D view on a weak device. PURE, except the storage helpers
 * (each in try / catch).
 *
 * Shown only on a weak device, never on a good one: WebGL drawn by software (startMode.softwareRenderer), the viewer's
 * existing weak-device check (engine.weakDevice: quality 'low' or software; the page's `weakDevice`), or frames under
 * SLOW_FPS for SLOW_FOR_MS in a row (SlowWatch). At most once per visit, never again after "Don't show again" (per
 * browser). Where the viewer's weak-device note shows (startMode), the tip's words go into that note instead of a
 * card of their own: one note, not two. The viewer's More and Studio's Settings open it any time.
 */

export const PERF_TIP_TEXT = 'For a smoother 3D view: use a computer with a good graphics card, and turn on hardware '
  + '(graphics) acceleration in your browser\'s settings. People far away show as simple figures until you come closer - '
  + 'that keeps things smooth.';

/** The menu item that opens it (the viewer's More, Studio's Settings). */
export const PERF_TIP_MENU_LABEL = 'Smoother 3D tips';

/** "Don't show again" (localStorage, per browser). */
export const PERF_TIP_OFF_KEY = 'ahdus.perfTipOff';
/** Shown this visit (sessionStorage: a reload in the same tab is the same visit). */
export const PERF_TIP_SHOWN_KEY = 'ahdus.perfTipShown';

/** Slow: frames a second under this… */
export const SLOW_FPS = 20;
/** …for this long in a row (ms). */
export const SLOW_FOR_MS = 10_000;
/** Frames are counted in windows of this long (ms). */
export const SLOW_WINDOW_MS = 2_000;

/** Why a device gets the tip. */
export type PerfTipWhy = 'software' | 'weak' | 'slow';

export interface PerfTipState {
  /** WebGL drawn by software (no graphics card in use). */
  software?: boolean;
  /** The existing weak-device check (quality 'low', software WebGL, or the page said so). */
  weak?: boolean;
  /** Frames stayed slow (SlowWatch). */
  slow?: boolean;
}

/** Why this device gets the tip (null: a good machine: never). */
export function perfTipWhy({ software = false, weak = false, slow = false }: PerfTipState): PerfTipWhy | null {
  if (software) return 'software';
  if (weak) return 'weak';
  if (slow) return 'slow';
  return null;
}

/**
 * Where the tip shows by itself, if anywhere: 'note' (inside the viewer's weak-device note, shown now), 'card' (its own
 * small card) or null (a good machine, "Don't show again", or already shown this visit).
 */
export function perfTipPlace(state: PerfTipState & { off?: boolean; shown?: boolean; weakNote?: boolean }): 'note' | 'card' | null {
  if (state.off || state.shown || !perfTipWhy(state)) return null;
  return state.weakNote ? 'note' : 'card';
}

/** The frame rate of a window from its frame times (ms): the average. null: no frames. */
export function averageFps(frameMs: readonly number[]): number | null {
  let sum = 0;
  let n = 0;
  for (const d of frameMs) {
    if (!(d > 0) || !Number.isFinite(d)) continue;
    sum += d;
    n++;
  }
  return n && sum > 0 ? (1000 * n) / sum : null;
}

/**
 * Frames slow for long enough? frame(ms, now, measuring) after every frame drawn; true ONCE, when frames have stayed
 * under `fps` for `forMs` in a row. Only frames drawn while `measuring` count (everything built, the page shown): a
 * pause (building, a hidden tab) or one smooth window starts the count again. The average of each window (not its
 * slowest frames): a few hitches on a good machine never make it slow.
 */
export class SlowWatch {
  private frames: number[] = [];
  private windowStart = -1;
  private slowSince = -1;
  private fired = false;
  /** The last window's frame rate (null: none yet). */
  lastFps: number | null = null;

  constructor(private readonly options: { fps?: number; forMs?: number; windowMs?: number } = {}) {}

  /** Found slow (stays true). */
  get slow(): boolean {
    return this.fired;
  }

  frame(ms: number, now: number, measuring = true): boolean {
    if (this.fired) return false;
    if (!measuring) {
      this.frames.length = 0;
      this.windowStart = -1;
      this.slowSince = -1;
      return false;
    }
    if (this.windowStart < 0) this.windowStart = now;
    this.frames.push(ms);
    if (now - this.windowStart < (this.options.windowMs ?? SLOW_WINDOW_MS)) return false;
    const fps = averageFps(this.frames);
    this.lastFps = fps;
    const start = this.windowStart;
    this.frames.length = 0;
    this.windowStart = now;
    if (fps === null || fps >= (this.options.fps ?? SLOW_FPS)) {
      this.slowSince = -1;
      return false;
    }
    if (this.slowSince < 0) this.slowSince = start;
    if (now - this.slowSince < (this.options.forMs ?? SLOW_FOR_MS)) return false;
    this.fired = true;
    return true;
  }
}

/** "Don't show again" was chosen in this browser (false: not, or storage blocked). */
export function readPerfTipOff(): boolean {
  try {
    return window.localStorage.getItem(PERF_TIP_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

/** "Don't show again" (blocked storage: this page only, as the visit's flag). */
export function storePerfTipOff(): void {
  shownThisPage = true;
  try { window.localStorage.setItem(PERF_TIP_OFF_KEY, '1'); } catch { /* this visit only */ }
}

// Shown on this page already (several viewers on one page, or session storage blocked)
let shownThisPage = false;

/** Already shown this visit (this page, or this tab's session). */
export function perfTipShownThisVisit(): boolean {
  if (shownThisPage) return true;
  try {
    return window.sessionStorage.getItem(PERF_TIP_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPerfTipShown(): void {
  shownThisPage = true;
  try { window.sessionStorage.setItem(PERF_TIP_SHOWN_KEY, '1'); } catch { /* this page only */ }
}

/** Tests: a new page. */
export function resetPerfTipPage(): void {
  shownThisPage = false;
}
