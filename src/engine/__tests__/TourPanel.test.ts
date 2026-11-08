// The tour panel's words (v0.14.4, TourPanel.tsx: pure parts) and Find's tour entry (PlaceSearch).
import { describe, expect, it } from 'vitest';

import { stopTitle, stateLine, spokenText, TOUR_LABEL } from '../react/TourPanel';
import { tourDetail } from '../react/PlaceSearch';

const stop = { name: 'Marketing', lines: ['Marketing · 2 rooms · Ground Floor', '12 people work here'] } as never;

describe('the tour panel', () => {
  it('"Stop 4 of 20 · Marketing"', () => {
    expect(stopTitle({ index: 3, count: 20, stop })).toBe('Stop 4 of 20 · Marketing');
    expect(stopTitle({ index: 0, count: 0, stop: null })).toBe(TOUR_LABEL);
  });

  it('what the tour is doing, in key words or touch words', () => {
    const base = { follow: 'auto' as const, pausedFrom: null, remaining: 41.6, dwell: null };
    expect(stateLine({ ...base, state: 'walking' })).toBe('On the way · 42 m · a movement key pauses');
    expect(stateLine({ ...base, state: 'walking' }, true)).toBe('On the way · 42 m · the joystick pauses');
    expect(stateLine({ ...base, state: 'walking', follow: 'self' })).toBe('Follow the line · 42 m');
    expect(stateLine({ ...base, state: 'stop', dwell: 7.2 })).toBe('Walking on in 8 s');
    expect(stateLine({ ...base, state: 'stop', follow: 'self', dwell: 3 })).toBe('The way on shows in 3 s');
    expect(stateLine({ ...base, state: 'stop', dwell: 0 })).toBe('Here');
    expect(stateLine({ ...base, state: 'paused', pausedFrom: 'walking' })).toBe('Paused · Press P to go on');
    expect(stateLine({ ...base, state: 'paused', pausedFrom: 'stop' }, true)).toBe('Paused · Tap Resume to go on');
    expect(stateLine({ ...base, state: 'done' })).toBe('Tour complete');
    expect(stateLine({ ...base, state: 'idle' })).toBe('');
  });

  it('narration reads the stop as sentences', () => {
    expect(spokenText({ index: 3, count: 20, stop })).toBe('Stop 4 of 20. Marketing , 2 rooms , Ground Floor. 12 people work here');
    expect(spokenText({ index: 0, count: 0, stop: null })).toBe('');
  });

  it('Find\'s entry: "20 stops · about 8 min", visited stops, before the plan is made', () => {
    expect(tourDetail({ count: 20, minutes: 8, visited: 0 })).toBe('20 stops · about 8 min');
    expect(tourDetail({ count: 20, minutes: 8, visited: 3 })).toBe('20 stops · about 8 min · 3 visited');
    expect(tourDetail({ count: 1, minutes: null, visited: 0 })).toBe('1 stop · about 1 min');
    expect(tourDetail({ count: null, minutes: null, visited: 0 })).toBe('From the main entrance');
  });
});
