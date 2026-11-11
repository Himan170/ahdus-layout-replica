import { describe, it, expect } from 'vitest';
import {
  HIDDEN_KEY, MAX_WORKPLACES, readHidden, writeHidden, toggleHidden, liveHidden, hiddenText, NO_HIDDEN,
} from '../hiddenLayers';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

describe('hiddenLayers (v0.15.6)', () => {
  it('remembers per workplace, and forgets a workplace with nothing hidden', () => {
    const store = memoryStorage();
    expect(readHidden('c/a', store)).toBe(NO_HIDDEN);
    let h = toggleHidden(NO_HIDDEN, 'objects', 'obj_1');
    h = toggleHidden(h, 'rooms', 'room_1');
    writeHidden('c/a', h, store);
    expect(readHidden('c/a', store)).toEqual({ rooms: ['room_1'], objects: ['obj_1'] });
    expect(readHidden('c/b', store)).toEqual(NO_HIDDEN);

    h = toggleHidden(toggleHidden(h, 'objects', 'obj_1'), 'rooms', 'room_1');
    writeHidden('c/a', h, store);
    expect(JSON.parse(store.getItem(HIDDEN_KEY))).toEqual({});
  });

  it('keeps at most MAX_WORKPLACES workplaces (the oldest go)', () => {
    const store = memoryStorage();
    for (let i = 0; i < MAX_WORKPLACES + 5; i++) writeHidden(`c/${i}`, { rooms: [], objects: ['x'] }, store);
    const all = JSON.parse(store.getItem(HIDDEN_KEY));
    expect(Object.keys(all)).toHaveLength(MAX_WORKPLACES);
    expect(all['c/0']).toBeUndefined();
    expect(all[`c/${MAX_WORKPLACES + 4}`]).toBeDefined();
  });

  it('blocked or broken storage: nothing hidden, no throw', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readHidden('c/a', broken)).toBe(NO_HIDDEN);
    expect(() => writeHidden('c/a', { rooms: ['r'], objects: [] }, broken)).not.toThrow();
    const junk = memoryStorage();
    junk.setItem(HIDDEN_KEY, '{not json');
    expect(readHidden('c/a', junk)).toBe(NO_HIDDEN);
    junk.setItem(HIDDEN_KEY, JSON.stringify({ 'c/a': { rooms: [1, 'r', null], objects: 'x' } }));
    expect(readHidden('c/a', junk)).toEqual({ rooms: ['r'], objects: [] });
  });

  it('counts only what still exists', () => {
    const live = liveHidden({ rooms: ['r1', 'gone'], objects: ['o1', 'o2'] }, { r1: {} }, { o1: {}, o2: {} });
    expect(live).toEqual({ rooms: ['r1'], objects: ['o1', 'o2'] });
    expect(hiddenText(live)).toBe('3 hidden');
    expect(hiddenText(NO_HIDDEN)).toBeNull();
  });
});
