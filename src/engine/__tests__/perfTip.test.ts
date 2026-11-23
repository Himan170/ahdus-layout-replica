// v0.18.10: the performance tip: when it shows (software WebGL, the weak-device check, slow frames), never on a good
// machine, in the weak note or a card, at most once per visit, and "Don't show again" stays.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PERF_TIP_TEXT, PERF_TIP_OFF_KEY, PERF_TIP_SHOWN_KEY, SLOW_FOR_MS, SlowWatch, averageFps, markPerfTipShown,
  perfTipPlace, perfTipShownThisVisit, perfTipWhy, readPerfTipOff, resetPerfTipPage, storePerfTipOff,
} from '../perfTip';

/** A fake Storage (Node has none). */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

/** Frames at `fps` for `ms`, starting at `t0`; returns the time after them and whether the watch fired. */
function run(watch: SlowWatch, fps: number, ms: number, t0 = 0, measuring = true): { t: number; fired: number } {
  const dt = 1000 / fps;
  let fired = 0;
  let t = t0;
  while (t < t0 + ms) {
    t += dt;
    if (watch.frame(dt, t, measuring)) fired++;
  }
  return { t, fired };
}

describe('perfTip: when the tip shows (v0.18.10)', () => {
  it('the text, word for word', () => {
    expect(PERF_TIP_TEXT).toBe('For a smoother 3D view: use a computer with a good graphics card, and turn on hardware '
      + '(graphics) acceleration in your browser\'s settings. People far away show as simple figures until you come '
      + 'closer - that keeps things smooth.');
  });

  it('on a weak device: software WebGL, the weak-device check, or slow frames', () => {
    expect(perfTipWhy({ software: true })).toBe('software');
    expect(perfTipWhy({ weak: true })).toBe('weak');
    expect(perfTipWhy({ slow: true })).toBe('slow');
    expect(perfTipPlace({ software: true })).toBe('card');
    expect(perfTipPlace({ weak: true })).toBe('card');
    expect(perfTipPlace({ slow: true })).toBe('card');
  });

  it('never on a good machine', () => {
    expect(perfTipWhy({})).toBeNull();
    expect(perfTipWhy({ software: false, weak: false, slow: false })).toBeNull();
    expect(perfTipPlace({ software: false, weak: false, slow: false })).toBeNull();
    // even where a weak note would show, a good machine gets nothing
    expect(perfTipPlace({ weakNote: true })).toBeNull();
  });

  it('one note, not two: with the weak-device note it goes in the note', () => {
    expect(perfTipPlace({ weak: true, weakNote: true })).toBe('note');
    expect(perfTipPlace({ software: true, weakNote: false })).toBe('card');
  });

  it('not after "Don\'t show again", not twice a visit (note or card)', () => {
    expect(perfTipPlace({ software: true, off: true })).toBeNull();
    expect(perfTipPlace({ weak: true, weakNote: true, off: true })).toBeNull();
    expect(perfTipPlace({ slow: true, shown: true })).toBeNull();
    expect(perfTipPlace({ weak: true, weakNote: true, shown: true })).toBeNull();
  });
});

describe('SlowWatch: under 20 FPS for 10 s (v0.18.10)', () => {
  it('fires once, after 10 s of slow frames', () => {
    const w = new SlowWatch();
    const early = run(w, 12, SLOW_FOR_MS - 2_500);
    expect(early.fired).toBe(0);
    const late = run(w, 12, 5_000, early.t);
    expect(late.fired).toBe(1);
    expect(w.slow).toBe(true);
    expect(run(w, 12, 20_000, late.t).fired).toBe(0); // once
  });

  it('very slow frames (fewer than 20 a window) count too', () => {
    const w = new SlowWatch();
    expect(run(w, 4, 15_000).fired).toBe(1);
  });

  it('a good machine never: 60 FPS, 30 FPS, 60 FPS with hitches', () => {
    for (const fps of [60, 30, 21]) {
      const w = new SlowWatch();
      expect(run(w, fps, 120_000).fired).toBe(0);
    }
    const w = new SlowWatch();
    let t = 0;
    let fired = 0;
    for (let i = 0; i < 7_200; i++) {
      const dt = i % 60 === 0 ? 250 : 1000 / 60; // a 250 ms hitch every second
      t += dt;
      if (w.frame(dt, t)) fired++;
    }
    expect(fired).toBe(0);
  });

  it('one smooth window starts the count again', () => {
    const w = new SlowWatch();
    let { t } = run(w, 10, 8_000);
    ({ t } = run(w, 60, 2_500, t)); // smooth
    const again = run(w, 10, 8_000, t);
    expect(again.fired).toBe(0);
    expect(run(w, 10, 4_000, again.t).fired).toBe(1);
  });

  it('only frames while measuring (building, a hidden tab: the count starts again)', () => {
    const w = new SlowWatch();
    let { t } = run(w, 10, 8_000);
    ({ t } = run(w, 10, 5_000, t, false));
    expect(run(w, 10, 8_000, t).fired).toBe(0);
    const n = new SlowWatch();
    expect(run(n, 5, 60_000, 0, false).fired).toBe(0);
  });

  it('averageFps', () => {
    expect(averageFps([])).toBeNull();
    expect(averageFps([50, 50])).toBe(20);
    expect(averageFps([0, -1, Number.NaN, 100])).toBe(10);
  });
});

describe('perfTip storage: dismissed stays dismissed, once per visit (v0.18.10)', () => {
  let local: Storage;
  let session: Storage;
  beforeEach(() => {
    local = fakeStorage();
    session = fakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    resetPerfTipPage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPerfTipPage();
  });

  it('"Don\'t show again" is kept in the browser, and the tip stays away', () => {
    expect(readPerfTipOff()).toBe(false);
    storePerfTipOff();
    expect(local.getItem(PERF_TIP_OFF_KEY)).toBe('1');
    resetPerfTipPage(); // a new visit
    session.clear();
    expect(readPerfTipOff()).toBe(true);
    expect(perfTipPlace({ software: true, off: readPerfTipOff(), shown: perfTipShownThisVisit() })).toBeNull();
    expect(perfTipPlace({ weak: true, weakNote: true, off: readPerfTipOff() })).toBeNull();
  });

  it('shown once per visit: this page, and a reload in the same tab', () => {
    expect(perfTipShownThisVisit()).toBe(false);
    markPerfTipShown();
    expect(perfTipShownThisVisit()).toBe(true);
    expect(session.getItem(PERF_TIP_SHOWN_KEY)).toBe('1');
    resetPerfTipPage(); // a reload: the tab's session remembers
    expect(perfTipShownThisVisit()).toBe(true);
    session.clear(); // a new visit
    expect(perfTipShownThisVisit()).toBe(false);
    expect(readPerfTipOff()).toBe(false); // "Got it" is not "Don't show again"
  });

  it('blocked storage: no error; once on this page; "Don\'t show again" for this page', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    vi.stubGlobal('window', { localStorage: blocked, sessionStorage: blocked });
    expect(readPerfTipOff()).toBe(false);
    expect(perfTipShownThisVisit()).toBe(false);
    expect(() => markPerfTipShown()).not.toThrow();
    expect(perfTipShownThisVisit()).toBe(true);
    resetPerfTipPage();
    expect(() => storePerfTipOff()).not.toThrow();
    expect(perfTipShownThisVisit()).toBe(true);
  });
});
