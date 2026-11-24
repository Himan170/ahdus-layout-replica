// v0.18.11: Check my layout in slices (checkRunner.js) when the layout changes while a check is half done: it starts
// over on the new layout, and never gives out a result that mixes the old and the new one.
import { describe, expect, it } from 'vitest';
import { checkLayout, checkLayoutSteps } from '../checkLayout';
import { createSlicedCheck, layoutCopy, sameLayout, CHECK_SLICE_MS } from '../checkRunner';
import { createWalkMapCache } from '../walkMap';
import { meridianLike } from './meridianLike';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const records = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

/** A store as Studio's: records by id; every edit makes new records (never changes one in place). */
function fakeStore() {
  const m = meridianLike();
  let state = {
    rooms: records(Object.values(m.rooms)), objects: records(Object.values(m.objects)), floors: m.floors,
    currentFloor: 0, selectedRoomId: null, ignoredChecks: [],
  };
  return {
    get: () => state,
    set: (patch) => { state = { ...state, ...patch }; },
    /** A room moved / resized (a drag dropped, a typed size): new rooms record. */
    updateRoom(id, patch) { state = { ...state, rooms: { ...state.rooms, [id]: { ...state.rooms[id], ...patch } } }; },
    /** An item moved: new objects record. */
    updateObject(id, patch) { state = { ...state, objects: { ...state.objects, [id]: { ...state.objects[id], ...patch } } }; },
  };
}

/** A clock that moves 1 ms each time it is read: every slice is a handful of steps. */
const tickClock = () => { let t = 0; return () => t++; };

const whole = (layout) => checkLayout(layoutCopy(layout), { catalog: ASSET_TYPES, maps: createWalkMapCache({ catalog: ASSET_TYPES }) }).problems;

function runner(store, maps = createWalkMapCache({ catalog: ASSET_TYPES })) {
  return createSlicedCheck({
    getLayout: store.get,
    makeSteps: (copy) => checkLayoutSteps(copy, { catalog: ASSET_TYPES, maps }),
    clock: tickClock(),
  });
}

/** Slices until done; `between(n)` runs before slice n (an edit there = an edit while the check is half done). */
function runAll(check, between = () => {}) {
  for (let n = 0; n < 100000; n++) {
    between(n);
    const r = check.slice();
    if (r.done) return { result: r.result, slices: n + 1 };
  }
  throw new Error('never finished');
}

/** The office room with a door and the first desk of the ground floor (Meridian), for edits. */
function targets(store) {
  const s = store.get();
  const room = Object.values(s.rooms).find((r) => (r.floor ?? 0) === 0 && r.doors?.length && r.type !== 'RECEPTION');
  const desk = Object.values(s.objects).find((o) => /^DESK/.test(o.assetType) && (o.floor ?? 0) === 0);
  return { room, desk };
}

describe('checkRunner: Check my layout in slices (v0.18.11)', () => {
  it('runs in many slices and gives exactly checkLayout\'s problems', () => {
    const store = fakeStore();
    const check = runner(store);
    const { result, slices } = runAll(check);
    expect(slices).toBeGreaterThan(20);
    expect(check.restarts).toBe(0);
    expect(result.problems).toEqual(whole(store.get()));
    expect(CHECK_SLICE_MS).toBe(8);
  });

  it('an edit halfway (a room\'s doors removed, as a drag or a typed change) starts it over on the new layout', () => {
    const store = fakeStore();
    const before = store.get();
    const { room } = targets(store);
    const check = runner(store);
    const { result } = runAll(check, (n) => { if (n === 10) store.updateRoom(room.id, { doors: [] }); });
    expect(check.restarts).toBe(1);
    const after = whole(store.get());
    expect(result.problems).toEqual(after);
    // …and that is not what the old layout gives: the new problem is there, from the new copy only
    expect(after).not.toEqual(whole(before));
    expect(result.problems.some((p) => p.kind === 'ROOM_NO_DOOR' && p.roomId === room.id)).toBe(true);
  });

  it('an item moved, then undone (the old records back) while it runs: the result is the layout it ends on', () => {
    const store = fakeStore();
    const original = store.get().objects;
    const { desk } = targets(store);
    const check = runner(store);
    const { result } = runAll(check, (n) => {
      if (n === 5) store.updateObject(desk.id, { x: desk.x + 3 });
      if (n === 15) store.set({ objects: original }); // undo: the records as they were
    });
    expect(check.restarts).toBe(2);
    expect(result.problems).toEqual(whole(store.get()));
  });

  it('switching floor or selecting something while it runs changes nothing (not part of the check)', () => {
    const store = fakeStore();
    const check = runner(store);
    const { result } = runAll(check, (n) => {
      if (n === 3) store.set({ currentFloor: 1 });
      if (n === 6) store.set({ selectedRoomId: 'x', ignoredChecks: ['NO_ENTRANCE:building'] });
    });
    expect(check.restarts).toBe(0);
    expect(result.problems).toEqual(whole(store.get()));
  });

  it('never gives out the old layout\'s result after the layout changed (even on what would have been its last slice)', () => {
    const store = fakeStore();
    const { room } = targets(store);
    // how many slices the check takes on the old layout
    const { slices } = runAll(runner(fakeStore()));
    const check = runner(store);
    const results = [];
    for (let n = 0; n < 100000; n++) {
      if (n === slices - 1) store.updateRoom(room.id, { doors: [] }); // just before its last slice
      const r = check.slice();
      if (r.done) { results.push(r.result); break; }
    }
    expect(results).toHaveLength(1);
    expect(results[0].problems).toEqual(whole(store.get()));
  });

  it('the copy is the layout\'s records as they are; sameLayout tells a change', () => {
    const store = fakeStore();
    const copy = layoutCopy(store.get());
    expect(Object.keys(copy)).toEqual(['rooms', 'objects', 'floors']);
    expect(sameLayout(copy, store.get())).toBe(true);
    store.set({ currentFloor: 2 });
    expect(sameLayout(copy, store.get())).toBe(true);
    const { room } = targets(store);
    store.updateRoom(room.id, { width: room.width + 1 });
    expect(sameLayout(copy, store.get())).toBe(false);
  });

  it('reset() drops a half-done check; the next slice starts a new one', () => {
    const store = fakeStore();
    const check = runner(store);
    check.slice();
    expect(check.running).toBe(true);
    check.reset();
    expect(check.running).toBe(false);
    expect(runAll(check).result.problems).toEqual(whole(store.get()));
  });
});
