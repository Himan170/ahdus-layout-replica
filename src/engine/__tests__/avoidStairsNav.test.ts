// v0.18.4: "Avoid stairs (use lifts)" in engine.navigation: routes by lift only, NEEDS_STAIRS said plainly (never a
// walk up the stairs), "Use the stairs this time" (stairs: true, kept for reroutes), Find's stairsOnly note, the tour
// planned again. Fake hooks as in PlaceSearch.test.ts; the routes are real (play/navigation/route.js).
import { describe, expect, it } from 'vitest';

import { NavigationSystem } from '../systems/NavigationSystem';
import type { Pilot } from '../systems/NavigationSystem';
import { liftLayout } from '../../play/navigation/__tests__/liftLayout';
import { storedAvoidStairs, storeAvoidStairs, AVOID_STAIRS_KEY, needsStairs } from '../../play/navigation/avoidStairs';

function setup(liftFloors = [0, 2], walker: { x: number; z: number; floor: number } | null = { x: 0, z: -3, floor: 0 }) {
  const layout: any = { ...liftLayout({ liftFloors }), currentFloor: 0 };
  // a desk upstairs on each floor, so people can be found there
  for (const f of [1, 2]) {
    layout.objects[`desk_${f}`] = { id: `desk_${f}`, assetType: 'DESK_STANDARD', floor: f, x: -5, y: 0, z: 3, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
  }
  const events: any[] = [];
  let pilot: Pilot | null = null;
  const idleQueue: (() => void)[] = [];
  const nav = new NavigationSystem({
    getLayout: () => layout, getWalker: () => walker, focusOn: () => true, highlight: () => {}, clearHighlights: () => {},
    startWalking: () => ({ setAutopilot: (p) => { pilot = p; } }),
    emit: (e) => events.push(e),
    idle: (fn) => idleQueue.push(fn),
  });
  nav.setPeople([
    { personId: 'p1', deskId: 'desk_1', name: 'Asha Patel', department: 'Sales' },
    { personId: 'p2', deskId: 'desk_2', name: 'Ravi Menon', department: 'Sales' },
  ]);
  const runIdle = () => { for (let i = 0; i < 10000 && idleQueue.length; i++) idleQueue.shift()!(); };
  return { nav, layout, events, idleQueue, runIdle, pilot: () => pilot };
}

describe('engine.navigation: avoid stairs (v0.18.4)', () => {
  it('off by default; setAvoidStairs says whether it changed; multiStorey', () => {
    const { nav } = setup();
    expect(nav.avoidStairs).toBe(false);
    expect(nav.setAvoidStairs(true)).toBe(true);
    expect(nav.setAvoidStairs(true)).toBe(false);
    expect(nav.avoidStairs).toBe(true);
    expect(nav.multiStorey).toBe(true);
  });

  it('on: Take me there to a floor no lift goes to = NEEDS_STAIRS (a failed event, no walk); off: by the stairs', () => {
    const { nav, events, pilot } = setup();
    nav.setAvoidStairs(true);
    const r = nav.routeTo('person:p1', { walk: 'auto' });
    expect(r).toMatchObject({ problem: 'NEEDS_STAIRS', message: 'No lift goes to Floor 1: this route needs the stairs' });
    expect(events.at(-1)).toMatchObject({ state: 'failed', problem: 'NEEDS_STAIRS' });
    expect(nav.walking).toBeNull();
    expect(needsStairs(r.problem)).toBe(true);
    // "Use the stairs this time"
    const once = nav.routeTo('person:p1', { walk: 'auto', stairs: true });
    expect(once.problem).toBeUndefined();
    expect(pilot()).not.toBeNull();
    expect(events.at(-1)).toMatchObject({ state: 'started' });
    nav.stop();
    // the option itself is unchanged
    expect(nav.avoidStairs).toBe(true);
    nav.setAvoidStairs(false);
    expect(nav.routeTo('person:p1', { walk: 'auto' }).problem).toBeUndefined();
  });

  it('on: Floor 2 is reached by the lift', () => {
    const { nav } = setup();
    nav.setAvoidStairs(true);
    const r = nav.routeTo('person:p2', { walk: 'guide' });
    expect(r.problem).toBeUndefined();
    expect(r.floors).toEqual([0, 2]);
  });

  it('show() walking: the problem with the option on, the walk with stairs: true', () => {
    const { nav } = setup();
    nav.setAvoidStairs(true);
    expect(nav.show('person:p1')).toMatchObject({ problem: 'NEEDS_STAIRS' });
    const s = nav.show('person:p1', { stairs: true })!;
    expect(s.problem).toBeUndefined();
    expect(s.route).toMatchObject({ floors: [0, 1] });
    expect(s.route?.by).toBeUndefined(); // by the stairs (only a lift is named)
  });

  it("Find: 'stairsOnly' on places no lift reaches, only while the option is on", () => {
    const { nav } = setup();
    const asha = () => nav.find('Asha')[0];
    const ravi = () => nav.find('Ravi')[0];
    expect(asha().stairsOnly).toBeUndefined();
    nav.setAvoidStairs(true);
    expect(asha().stairsOnly).toBe(true);
    expect(ravi().stairsOnly).toBeUndefined(); // the lift goes to Floor 2
    const grouped = nav.search('Asha');
    expect(grouped.groups.people[0].stairsOnly).toBe(true);
    nav.setAvoidStairs(false);
    expect(asha().stairsOnly).toBeUndefined();
  });

  it('from above: from the ground floor', () => {
    const { nav } = setup([0, 2], null);
    nav.setAvoidStairs(true);
    expect(nav.find('Asha')[0].stairsOnly).toBe(true);
    expect(nav.find('Ravi')[0].stairsOnly).toBeUndefined();
  });

  it('the tour: planned again when it changes (idle time); stops no lift reaches are skipped', () => {
    const { nav, runIdle } = setup();
    void nav.warm();
    runIdle();
    const before = nav.tourPlanReady;
    expect(before).not.toBeNull();
    nav.setAvoidStairs(true);
    expect(nav.tourPlanReady).toBeNull(); // the old plan is for the stairs
    runIdle();
    const after = nav.tourPlanReady!;
    expect(after).not.toBeNull();
    expect(after.stops.every((s: any) => s.floor !== 1)).toBe(true);
    expect(before!.stops.some((s: any) => s.floor === 1)).toBe(true);
  });
});

describe('the browser keeps the option (v0.18.4)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
  };
  it('stored, read back, removed; blocked storage = off', () => {
    const s = memory();
    expect(storedAvoidStairs(s as any)).toBe(false);
    storeAvoidStairs(true, s as any);
    expect(s.m.get(AVOID_STAIRS_KEY)).toBe('1');
    expect(storedAvoidStairs(s as any)).toBe(true);
    storeAvoidStairs(false, s as any);
    expect(s.m.has(AVOID_STAIRS_KEY)).toBe(false);
    const blocked = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => { throw new Error('no'); } };
    expect(storedAvoidStairs(blocked as any)).toBe(false);
    expect(() => storeAvoidStairs(true, blocked as any)).not.toThrow();
  });
});
