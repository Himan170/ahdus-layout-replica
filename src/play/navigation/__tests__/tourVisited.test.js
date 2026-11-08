// The tour's visited stops, per browser and layout (v0.14.4, tourVisited.js).
import { describe, expect, it } from 'vitest';

import { VISITED_KEY, MAX_LAYOUTS, readVisited, markVisited, clearVisited } from '../tourVisited';

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, m };
}

describe('tour visited stops', () => {
  it('ticks each stop once, per layout, kept across reads (a reload)', () => {
    const s = memory();
    expect(readVisited(s, 'A')).toEqual([]);
    markVisited(s, 'A', 'entrance');
    markVisited(s, 'A', 'entrance');
    markVisited(s, 'A', 'reception');
    markVisited(s, 'B', 'entrance');
    expect(readVisited(s, 'A')).toEqual(['entrance', 'reception']);
    expect(readVisited(s, 'B')).toEqual(['entrance']);
    expect(clearVisited(s, 'A')).toEqual([]);
    expect(readVisited(s, 'A')).toEqual([]);
    expect(readVisited(s, 'B')).toEqual(['entrance']);
  });

  it(`at most ${MAX_LAYOUTS} layouts: the one used longest ago goes first`, () => {
    const s = memory();
    for (let i = 0; i <= MAX_LAYOUTS; i++) markVisited(s, `L${i}`, 'entrance');
    const all = JSON.parse(s.m.get(VISITED_KEY));
    expect(Object.keys(all)).toHaveLength(MAX_LAYOUTS);
    expect(all.L0).toBeUndefined();
    expect(all[`L${MAX_LAYOUTS}`]).toEqual(['entrance']);
  });

  it('broken, blocked or missing storage: nothing thrown, the ticks kept by the caller', () => {
    const broken = memory();
    broken.setItem(VISITED_KEY, '{not json');
    expect(readVisited(broken, 'A')).toEqual([]);
    broken.setItem(VISITED_KEY, JSON.stringify({ A: ['entrance', 3, null] }));
    expect(readVisited(broken, 'A')).toEqual(['entrance']);
    const blocked = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(markVisited(blocked, 'A', 'entrance')).toEqual(['entrance']);
    expect(markVisited(blocked, 'A', 'reception', ['entrance'])).toEqual(['entrance', 'reception']);
    expect(markVisited(null, 'A', 'entrance')).toEqual(['entrance']);
  });
});
