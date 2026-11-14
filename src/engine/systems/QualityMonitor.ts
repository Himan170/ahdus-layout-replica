/**
 * QualityMonitor.ts — v0.17.0: the viewer lowers its own drawing quality when frames are slow and raises it again
 * when they are smooth for a while (play/quality.js: the steps and the rules; live.js windowFps: the measurement).
 * Drop fast (one slow 3 s window), rise slowly (5 smooth windows, never within a minute of a drop).
 *
 * frame(ms, now) after every frame drawn; frames only count while `measuring()` (everything built, the page shown,
 * not paused): building slices and a hidden tab say nothing about drawing.
 */

import { qualitySteps, nextQuality } from '../../play/quality';
import { windowFps, CAP_WINDOW_MS } from '../../play/live';

export interface QualityStep {
  pixelRatio: number;
  shadows: boolean;
  maxFull: number | null;
}

export interface QualityMonitorOptions {
  /** The screen's pixel ratio (window.devicePixelRatio). */
  dpr: number;
  /** Frames count now? */
  measuring: () => boolean;
  /** The step to draw with (called once at the start, then on every change). */
  apply: (step: QualityStep, level: number) => void;
  /** false: the best step always (a page's choice, tests). */
  auto?: boolean;
  windowMs?: number;
}

export class QualityMonitor {
  readonly steps: QualityStep[];
  private options: QualityMonitorOptions;
  private frames: number[] = [];
  private windowStart = -1;
  private state = { level: 0, good: 0, holdUntil: 0 };
  private forced: QualityStep | null = null;
  /** Every window's result (tests, the debug hook): { fps, level, at }. */
  readonly history: { fps: number | null; level: number; at: number }[] = [];

  constructor(options: QualityMonitorOptions) {
    this.options = options;
    this.steps = qualitySteps(options.dpr);
    options.apply(this.steps[0], 0);
  }

  get level(): number {
    return this.state.level;
  }

  get step(): QualityStep {
    return this.forced ?? this.steps[this.state.level];
  }

  /** v0.17.0: "Low graphics": this step until force(null) (no measuring meanwhile); null: measured again. */
  force(step: QualityStep | null): void {
    if (step === this.forced) return;
    this.forced = step;
    this.frames.length = 0;
    this.windowStart = -1;
    this.options.apply(this.step, step ? -1 : this.state.level);
  }

  get isForced(): boolean {
    return !!this.forced;
  }

  /** A frame was drawn, taking `ms`. true: the step changed. */
  frame(ms: number, now: number): boolean {
    if (this.options.auto === false || this.forced) return false;
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
    const before = this.state.level;
    this.state = nextQuality(this.state, { fps, now, steps: this.steps.length });
    this.history.push({ fps, level: this.state.level, at: now });
    if (this.history.length > 50) this.history.shift();
    if (this.state.level === before) return false;
    // the frames of the old step say nothing about the new one
    this.frames.length = 0;
    this.options.apply(this.step, this.state.level);
    return true;
  }
}
