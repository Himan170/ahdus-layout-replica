import { describe, expect, it } from 'vitest';
import {
  qualitySteps, nextQuality, storedLowGraphics, storeLowGraphics, MAX_PIXEL_RATIO, LOW_FULL_CHARACTERS,
  DROP_FPS, RAISE_FPS, RAISE_AFTER, RAISE_HOLD_MS, LOW_GRAPHICS_KEY,
} from '../quality';

describe('qualitySteps (v0.17.0)', () => {
  it('a phone at 3: the pixel ratio 2, 1.5, 1, then no shadows, then fewer full characters', () => {
    expect(qualitySteps(3)).toEqual([
      { pixelRatio: MAX_PIXEL_RATIO, shadows: true, maxFull: null },
      { pixelRatio: 1.5, shadows: true, maxFull: null },
      { pixelRatio: 1, shadows: true, maxFull: null },
      { pixelRatio: 1, shadows: false, maxFull: null },
      { pixelRatio: 1, shadows: false, maxFull: LOW_FULL_CHARACTERS },
    ]);
  });

  it('a screen of ratio 1 has no pixel steps (they would change nothing)', () => {
    expect(qualitySteps(1)).toEqual([
      { pixelRatio: 1, shadows: true, maxFull: null },
      { pixelRatio: 1, shadows: false, maxFull: null },
      { pixelRatio: 1, shadows: false, maxFull: LOW_FULL_CHARACTERS },
    ]);
    expect(qualitySteps(1.25).map((s) => s.pixelRatio)).toEqual([1.25, 1, 1, 1]);
    expect(qualitySteps(NaN)).toEqual(qualitySteps(1));
  });
});

describe('nextQuality: drop fast, rise slowly (v0.17.0)', () => {
  const steps = 5;
  it('one slow window drops a step at once, down to the last', () => {
    let s = { level: 0, good: 0, holdUntil: 0 };
    s = nextQuality(s, { fps: DROP_FPS - 1, now: 1000, steps });
    expect(s).toEqual({ level: 1, good: 0, holdUntil: 1000 + RAISE_HOLD_MS });
    for (let i = 0; i < 10; i++) s = nextQuality(s, { fps: 5, now: 2000 + i, steps });
    expect(s.level).toBe(4);
  });

  it('rises one step after RAISE_AFTER smooth windows in a row, and not while held after a drop', () => {
    let s = nextQuality({ level: 0, good: 0, holdUntil: 0 }, { fps: 10, now: 0, steps });
    expect(s.level).toBe(1);
    for (let i = 0; i < RAISE_AFTER + 2; i++) s = nextQuality(s, { fps: 60, now: 1000 + i * 3000, steps });
    expect(s.level).toBe(1); // held
    for (let i = 0; i < RAISE_AFTER - 1; i++) s = nextQuality(s, { fps: RAISE_FPS, now: RAISE_HOLD_MS + i * 3000, steps });
    expect(s.level).toBe(1);
    s = nextQuality(s, { fps: RAISE_FPS, now: RAISE_HOLD_MS + 20000, steps });
    expect(s.level).toBe(0);
  });

  it('a window between the two limits starts the count again; too few frames change nothing', () => {
    let s = { level: 2, good: RAISE_AFTER - 1, holdUntil: 0 };
    s = nextQuality(s, { fps: 40, now: 1, steps });
    expect(s).toEqual({ level: 2, good: 0, holdUntil: 0 });
    expect(nextQuality(s, { fps: null, now: 2, steps })).toEqual(s);
    expect(nextQuality({ level: 9, good: 0, holdUntil: 0 }, { fps: 40, now: 3, steps: 3 }).level).toBe(2);
  });
});

describe('"Low graphics" remembered (v0.17.0)', () => {
  it('stored per browser; blocked storage = off', () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
    expect(storedLowGraphics(storage)).toBe(false);
    storeLowGraphics(true, storage);
    expect(data.get(LOW_GRAPHICS_KEY)).toBe('1');
    expect(storedLowGraphics(storage)).toBe(true);
    storeLowGraphics(false, storage);
    expect(storedLowGraphics(storage)).toBe(false);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(storedLowGraphics(blocked)).toBe(false);
    expect(() => storeLowGraphics(true, blocked)).not.toThrow();
  });
});
