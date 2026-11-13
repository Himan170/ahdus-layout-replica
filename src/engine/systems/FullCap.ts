/**
 * FullCap.ts — how many full characters this device draws (v0.16.1), measured from its frame rate, never
 * guessed from its name: FULL_CAP_MIN (12) to start and on weak devices (software WebGL, quality 'low'), up
 * to FULL_CAP_MAX (24) while frames stay smooth and more people near would be full characters, back down
 * when frames get slow (play/live.js nextFullCap: the rules, windowFps: the measurement).
 *
 * frame(ms, now) after every frame drawn; frames only count while `measuring()` (everything built, the page
 * shown): building slices and a hidden tab say nothing about drawing people.
 */

import { nextFullCap, windowFps, CAP_WINDOW_MS, FULL_CAP_MIN } from '../../play/live';

export interface FullCapOptions {
  weak: () => boolean;
  /** How many people near would be full characters with no cap (seated + live). */
  wanted: () => number;
  /** Frames count now? */
  measuring: () => boolean;
  windowMs?: number;
  /** A fixed cap (tests, a page's choice): no measuring. */
  fixed?: number | null;
}

export class FullCapMonitor {
  private options: FullCapOptions;
  private frames: number[] = [];
  private windowStart = -1;
  private state = { cap: FULL_CAP_MIN, good: 0, holdUntil: 0 };
  /** Every window's result (tests, the debug hook): { fps, cap }. */
  readonly history: { fps: number | null; cap: number; at: number }[] = [];

  constructor(options: FullCapOptions) {
    this.options = options;
    if (typeof options.fixed === 'number') this.state.cap = Math.max(0, Math.floor(options.fixed));
  }

  get cap(): number {
    return this.state.cap;
  }

  /** A frame was drawn, taking `ms`. true: the cap changed. */
  frame(ms: number, now: number): boolean {
    if (typeof this.options.fixed === 'number') return false;
    if (!this.options.measuring()) {
      this.frames.length = 0;
      this.windowStart = -1;
      return false;
    }
    if (this.windowStart < 0) this.windowStart = now;
    this.frames.push(ms);
    if (now - this.windowStart < (this.options.windowMs ?? CAP_WINDOW_MS)) return false;
    const fps = windowFps(this.frames);
    this.frames.length = 0;
    this.windowStart = now;
    const before = this.state.cap;
    this.state = nextFullCap(this.state, { fps, now, weak: this.options.weak(), wanted: this.options.wanted() });
    this.history.push({ fps, cap: this.state.cap, at: now });
    if (this.history.length > 50) this.history.shift();
    return this.state.cap !== before;
  }
}
