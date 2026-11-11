import { describe, it, expect } from 'vitest';
import {
  adjacentFloor, floorBelow, planStairs, planPrefsKey, loadPlanPrefs, savePlanPrefs, cleanPlanPrefs,
} from '../planFloors';
import { isTypingTarget } from '../../ui/typing';

const floors = [{ id: 2, name: 'Floor 2' }, { id: 0, name: 'Ground Floor' }, { id: 1, name: 'Floor 1' }];

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

describe('adjacentFloor (Page Up / Down)', () => {
  it('steps through the floors in id order', () => {
    expect(adjacentFloor(floors, 0, 1)).toBe(1);
    expect(adjacentFloor(floors, 1, 1)).toBe(2);
    expect(adjacentFloor(floors, 1, -1)).toBe(0);
  });
  it('stops at the top and the ground floor', () => {
    expect(adjacentFloor(floors, 2, 1)).toBeNull();
    expect(adjacentFloor(floors, 0, -1)).toBeNull();
    expect(floorBelow(floors, 0)).toBeNull();
    expect(floorBelow(floors, 2)).toBe(1);
  });
  it('an unknown current floor goes to the lowest', () => {
    expect(adjacentFloor(floors, 7, 1)).toBe(0);
    expect(adjacentFloor([], 0, 1)).toBeNull();
  });
});

describe('planStairs (stairs on both floors they join)', () => {
  const stair = { id: 's1', assetType: 'STAIRCASE', floor: 0, x: 3, z: 4, rotationY: 0 };
  const desk = { id: 'd1', assetType: 'DESK_STANDARD', floor: 0, x: 0, z: 0 };
  it('shows a flight going up on its own floor and going down on the floor above', () => {
    const ground = planStairs([stair, desk], floors, 0);
    expect(ground).toHaveLength(1);
    expect(ground[0]).toMatchObject({ id: 's1', dir: 'up', other: 1, width: 1.2, length: 4 });
    const first = planStairs([stair, desk], floors, 1);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ dir: 'down', other: 0 });
    expect(planStairs([stair], floors, 2)).toEqual([]);
  });
  it('a flight on the top floor leads nowhere', () => {
    expect(planStairs([{ ...stair, floor: 2 }], floors, 2)[0].dir).toBe('nowhere');
  });
  it('the outline turns with the flight', () => {
    const [s] = planStairs([{ ...stair, rotationY: Math.PI / 2 }], floors, 0);
    expect(s.box.x1 - s.box.x0).toBeCloseTo(4);
    expect(s.box.z1 - s.box.z0).toBeCloseTo(1.2);
  });
});

describe('Plan settings per workplace', () => {
  it('defaults: floor below on, fitted', () => {
    expect(loadPlanPrefs('a/b', memoryStorage())).toEqual({ below: true, zoom: 1, pan: { x: 0, y: 0 } });
  });
  it('remembers each workplace on its own', () => {
    const s = memoryStorage();
    savePlanPrefs(planPrefsKey('c1', 'l1'), { below: false, zoom: 2.5, pan: { x: 3, y: -4 } }, s);
    savePlanPrefs(planPrefsKey('c1', 'l2'), { below: true, zoom: 0.5, pan: { x: 0, y: 1 } }, s);
    expect(loadPlanPrefs('c1/l1', s)).toEqual({ below: false, zoom: 2.5, pan: { x: 3, y: -4 } });
    expect(loadPlanPrefs('c1/l2', s).zoom).toBe(0.5);
  });
  it('keeps at most 30 workplaces, newest first', () => {
    const s = memoryStorage();
    for (let i = 0; i < 35; i += 1) savePlanPrefs(`c/${i}`, { zoom: 2 }, s, 1000 + i);
    const all = JSON.parse(s.data['ahdus.planView']);
    expect(Object.keys(all)).toHaveLength(30);
    expect(all['c/0']).toBeUndefined();
    expect(all['c/34']).toBeDefined();
  });
  it('blocked or broken storage never breaks the plan', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadPlanPrefs('a/b', blocked).below).toBe(true);
    expect(savePlanPrefs('a/b', { zoom: 2 }, blocked)).toBe(false);
    const broken = { getItem: () => '{not json', setItem: () => {} };
    expect(loadPlanPrefs('a/b', broken).zoom).toBe(1);
    expect(cleanPlanPrefs({ zoom: 'x', pan: { x: NaN } })).toEqual({ below: true, zoom: 1, pan: { x: 0, y: 0 } });
    expect(cleanPlanPrefs({ zoom: 1e9 }).zoom).toBe(20);
  });
});

describe('isTypingTarget (keys stay in text fields)', () => {
  const el = (tagName, extra = {}) => ({ tagName, getAttribute: (k) => extra[k] ?? null, ...extra });
  it('inputs, text areas, dropdowns, editable text and search boxes take the keys', () => {
    expect(isTypingTarget(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el('DIV', { role: 'combobox' }))).toBe(true);
  });
  it('the canvas, the page and buttons do not', () => {
    expect(isTypingTarget(el('CANVAS'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
