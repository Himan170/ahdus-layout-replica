import { describe, it, expect } from 'vitest';
import {
  floorBuildOrder, createBudget, UNLIMITED, isBigChange, BIG_CHANGE, buildProgress, progressPercent,
} from '../buildSchedule';

// Floors stack in id order (their elevation is derived from the heights below)
const floors = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
  2: { id: 2, name: 'Floor 2', height: 3.5 },
  3: { id: 3, name: 'Floor 3', height: 3.5 },
};

describe('floorBuildOrder', () => {
  it('starts with the start floor, then the floors below (nearest first), then above', () => {
    expect(floorBuildOrder(floors, 0)).toEqual([0, 1, 2, 3]);
    expect(floorBuildOrder(floors, 2)).toEqual([2, 1, 0, 3]);
    expect(floorBuildOrder(floors, 3)).toEqual([3, 2, 1, 0]);
    expect(floorBuildOrder(floors, 1)).toEqual([1, 0, 2, 3]);
  });

  it('builds bottom up when the start floor is unknown, and copes with one floor', () => {
    expect(floorBuildOrder(floors, 9)).toEqual([0, 1, 2, 3]);
    expect(floorBuildOrder({ 0: floors[0] }, 0)).toEqual([0]);
    expect(floorBuildOrder({}, 0)).toEqual([]);
  });

  it('lists every floor exactly once', () => {
    for (const start of [0, 1, 2, 3]) {
      const order = floorBuildOrder(floors, start);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('createBudget', () => {
  const clock = (times) => { let i = 0; return () => times[Math.min(i++, times.length - 1)]; };

  it('allows work until the time is used', () => {
    // start 0; checks at 2, 5, 9, 12 ms (10 ms budget)
    const budget = createBudget(10, clock([0, 2, 5, 9, 12]));
    expect(budget.take()).toBe(true); // first piece: no clock check
    expect(budget.take()).toBe(true); // 2 ms
    expect(budget.take()).toBe(true); // 5 ms
    expect(budget.take()).toBe(true); // 9 ms
    expect(budget.take()).toBe(false); // 12 ms
    expect(budget.taken).toBe(4);
  });

  it('always does at least one piece, even if the clock already ran out', () => {
    const budget = createBudget(10, clock([0, 50, 60]));
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.taken).toBe(1);
  });

  it('hasTime looks without taking', () => {
    const budget = createBudget(10, clock([0, 3, 4, 11]));
    expect(budget.hasTime()).toBe(true); // nothing taken yet: no clock check
    expect(budget.take()).toBe(true);
    expect(budget.hasTime()).toBe(true); // 3 ms
    expect(budget.taken).toBe(1);
    expect(budget.take()).toBe(true); // 4 ms
    expect(budget.hasTime()).toBe(false); // 11 ms
  });

  it('an unlimited budget never runs out', () => {
    const budget = createBudget(Infinity, clock([0, 1e9]));
    for (let i = 0; i < 100; i++) expect(budget.take()).toBe(true);
    expect(budget.unlimited).toBe(true);
    expect(UNLIMITED.take()).toBe(true);
    expect(UNLIMITED.hasTime()).toBe(true);
    expect(UNLIMITED.unlimited).toBe(true);
  });
});

describe('isBigChange', () => {
  it('builds many new rooms / items in slices, a few at once', () => {
    expect(isBigChange(1)).toBe(false);
    expect(isBigChange(BIG_CHANGE)).toBe(false);
    expect(isBigChange(BIG_CHANGE + 1)).toBe(true);
    expect(isBigChange(5, 4)).toBe(true);
  });
});

describe('buildProgress', () => {
  const order = [1, 0, 2];

  it('counts what is done and names the floor being built', () => {
    const p = buildProgress({ total: 100, pending: new Map([[1, 10], [0, 20], [2, 30]]), order, startFloor: 1 });
    expect(p).toEqual({ done: 40, total: 100, floor: 1, currentFloorReady: false, allBuilt: false });
  });

  it('the start floor is ready while other floors still build', () => {
    const p = buildProgress({ total: 100, pending: new Map([[1, 0], [0, 0], [2, 30]]), order, startFloor: 1 });
    expect(p).toMatchObject({ done: 70, floor: 2, currentFloorReady: true, allBuilt: false });
  });

  it('everything built', () => {
    const p = buildProgress({ total: 100, pending: new Map(), order, startFloor: 1 });
    expect(p).toEqual({ done: 100, total: 100, floor: 1, currentFloorReady: true, allBuilt: true });
  });

  it('an empty layout is built at once', () => {
    expect(buildProgress({ total: 0, pending: new Map(), order: [0], startFloor: 0 }))
      .toMatchObject({ done: 0, currentFloorReady: true, allBuilt: true });
  });

  it('percent', () => {
    expect(progressPercent({ done: 40, total: 100 })).toBe(40);
    expect(progressPercent({ done: 2, total: 3 })).toBe(66);
    expect(progressPercent({ done: 0, total: 0 })).toBe(100);
  });
});
