import { describe, expect, it } from 'vitest';
import { QualityMonitor } from '../systems/QualityMonitor';
import type { QualityStep } from '../systems/QualityMonitor';
import { RAISE_AFTER, RAISE_HOLD_MS } from '../../play/quality';

// v0.17.0: the viewer's drawing quality, from its frame rate: drop fast, rise slowly; "Low graphics" forces the last.
function monitor(dpr = 3, measuring = () => true) {
  const applied: [QualityStep, number][] = [];
  const m = new QualityMonitor({ dpr, measuring, apply: (step, level) => applied.push([step, level]), windowMs: 3000 });
  return { m, applied };
}
/** One 3 s window of frames of `ms` each, starting at `t`; returns the time after it. */
function windowOf(m: QualityMonitor, ms: number, t: number): number {
  let now = t;
  while (now - t <= 3000) {
    m.frame(ms, now);
    now += ms;
  }
  return now;
}

describe('QualityMonitor (v0.17.0)', () => {
  it('starts at the best step (a phone at 3: the pixel ratio 2) and drops one step per slow window', () => {
    const { m, applied } = monitor(3);
    expect(applied).toEqual([[{ pixelRatio: 2, shadows: true, maxFull: null }, 0]]);
    let t = windowOf(m, 60, 0); // ~16 FPS
    expect(m.level).toBe(1);
    expect(m.step.pixelRatio).toBe(1.5);
    t = windowOf(m, 60, t);
    t = windowOf(m, 60, t);
    expect(m.step).toEqual({ pixelRatio: 1, shadows: false, maxFull: null });
    expect(applied.length).toBe(4);
  });

  it('rises one step after smooth windows, a minute after the drop at the earliest', () => {
    const { m } = monitor(1);
    let t = windowOf(m, 60, 0);
    expect(m.level).toBe(1); // no shadows (ratio 1: no pixel steps)
    for (let i = 0; i < RAISE_AFTER + 3; i++) t = windowOf(m, 10, t);
    expect(m.level).toBe(1); // held
    t = RAISE_HOLD_MS + 5000;
    for (let i = 0; i < RAISE_AFTER; i++) t = windowOf(m, 10, t);
    expect(m.level).toBe(0);
  });

  it('nothing counts while not measuring (building, a hidden page)', () => {
    let on = false;
    const { m } = monitor(3, () => on);
    windowOf(m, 120, 0);
    expect(m.level).toBe(0);
    on = true;
    windowOf(m, 120, 10000);
    expect(m.level).toBe(1);
  });

  it('"Low graphics": a forced step, no measuring, then measured again from where it was', () => {
    const { m, applied } = monitor(3);
    const low = { pixelRatio: 1, shadows: false, maxFull: 0 };
    m.force(low);
    expect(m.step).toBe(low);
    expect(applied.at(-1)).toEqual([low, -1]);
    windowOf(m, 120, 0);
    expect(m.level).toBe(0);
    m.force(null);
    expect(m.step.pixelRatio).toBe(2);
    expect(applied.at(-1)![1]).toBe(0);
  });
});
