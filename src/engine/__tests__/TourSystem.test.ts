// The company tour's state machine (v0.14.4, systems/TourSystem.ts): with a made-up plan and fake hooks
// (no Babylon, no routes). The engine around it: LayoutEngine.test.ts ("the company tour"); e2e:tour on Meridian.
import { describe, it, expect, vi } from 'vitest';

import { TourSystem, MOVED_AWAY, STOP_PITCH } from '../systems/TourSystem';
import type { TourEvent, TourHooks } from '../systems/TourSystem';
import type { TourPlan, TourStop, NavigationEvent } from '../systems/NavigationSystem';
import { VISITED_KEY } from '../../play/navigation/tourVisited';

function stop(n: number, kind: TourStop['kind'], name: string, x: number, more: Partial<TourStop> = {}): TourStop {
  return {
    id: kind === 'entrance' ? 'entrance' : kind === 'return' ? 'return' : `room:${name}`, n, kind, facility: null, name,
    floor: 0, floorName: 'Ground Floor', roomId: kind === 'entrance' ? null : `r_${name}`,
    rooms: kind === 'entrance' ? [] : [{ id: `r_${name}`, name }], department: null, description: null,
    spot: { x, z: 0, floor: 0 }, yaw: 1, look: null, people: 0,
    pause: kind === 'facility' || kind === 'entrance' ? 8 : kind === 'return' ? 0 : 20, names: [],
    lines: [name, `${name} · Ground Floor`], text: name,
    leg: n === 1 ? null : { legs: [], length: 10, seconds: 2.4, directions: `Into ${name}.`, steps: [], mentions: [] },
    ...more,
  };
}

function makePlan(): TourPlan {
  const stops = [
    stop(1, 'entrance', 'Main entrance', 0),
    stop(2, 'reception', 'Reception', 10),
    stop(3, 'department', 'Sales', 20),
    stop(4, 'facility', 'Restrooms', 30),
    stop(5, 'return', 'Reception', 10),
  ];
  stops[2].leg!.mentions = [{
    roomId: 'r_wc', name: 'Store', side: 'left', text: 'On your left: Store', at: { x: 15, z: 0, floor: 0 },
    door: { x: 15, z: 2 }, distance: 2, along: 5,
  }];
  return { stops, floors: [0], length: 40, seconds: 100, walkSeconds: 10, pauseSeconds: 56, minutes: 2, mentions: [], skipped: [], missed: [], ms: 1 };
}

/** A Map-backed localStorage. */
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

function setup({ walking = false, plan = makePlan(), storage = memoryStorage() as ReturnType<typeof memoryStorage> | null } = {}) {
  const events: TourEvent[] = [];
  const me = { x: 0, z: 0, floor: 0 };
  const nav = {
    active: null as null | { source?: string; paused: boolean; walk: string },
    stop: vi.fn(() => { const was = !!nav.active; nav.active = null; return was; }),
    pause: vi.fn(() => { if (!nav.active) return false; nav.active.paused = true; return true; }),
    resume: vi.fn(() => { if (!nav.active) return false; nav.active.paused = false; nav.active.walk = 'auto'; return true; }),
    setWalk: vi.fn((w: string) => { if (!nav.active) return false; nav.active.walk = w; nav.active.paused = false; return true; }),
    get walking() { return nav.active; },
  };
  let keys: ((code: string) => boolean) | null = null;
  const state = { walking };
  const hooks = {
    plan: vi.fn(() => plan),
    startWalking: vi.fn(() => { state.walking = true; return true; }),
    isWalking: () => state.walking,
    getWalker: () => (state.walking ? { ...me } : null),
    setPose: vi.fn((p: { x: number; z: number; floor: number }) => { Object.assign(me, { x: p.x, z: p.z, floor: p.floor }); }),
    routeTo: vi.fn((_spot: unknown, o: { walk: string }) => { nav.active = { source: 'tour', paused: false, walk: o.walk }; return { length: 10, seconds: 2.4 }; }),
    navigation: nav,
    highlight: vi.fn(),
    clearHighlights: vi.fn(),
    setKeys: vi.fn((h) => { keys = h; }),
    emit: (e: TourEvent) => events.push(e),
    layoutKey: () => 'Head office',
    storage,
    stopView: vi.fn(),
  } satisfies TourHooks;
  const tour = new TourSystem(hooks);
  const navEvent = (state: NavigationEvent['state'], more: Partial<NavigationEvent> = {}) => {
    if (state !== 'progress') nav.active = null;
    tour.onNavigation({ state, walk: 'auto', place: { name: 'x' } as never, source: 'tour', ...more });
  };
  return { tour, hooks, nav, events, me, navEvent, key: (code: string) => keys?.(code) ?? false, keysSet: () => keys, types: () => events.map((e) => e.type) };
}

describe('the company tour (TourSystem)', () => {
  it('starts at the main entrance (from above: walking starts there): stop 1 of 5, ticked, P and Esc are its keys', () => {
    const { tour, hooks, events, keysSet } = setup();
    expect(tour.start()).toEqual({ count: 5, minutes: 2, length: 40 });
    expect(hooks.startWalking).toHaveBeenCalled();
    expect(hooks.setPose).not.toHaveBeenCalled(); // walking began at the entrance: no jump
    expect(tour.status).toMatchObject({ state: 'stop', index: 0, count: 5, follow: 'auto', dwell: 8, visited: ['entrance'] });
    expect(events.map((e) => e.type)).toEqual(['started', 'arrived']);
    expect(keysSet()).toBeTypeOf('function');
    expect(tour.running).toBe(true);
  });

  it('already walking: it starts at the entrance too (a jump there)', () => {
    const { tour, hooks, me } = setup({ walking: true });
    me.x = 50;
    tour.start({ follow: 'self' });
    expect(hooks.setPose).toHaveBeenCalledWith({ x: 0, z: 0, floor: 0, yaw: 1, pitch: STOP_PITCH });
    expect(tour.status).toMatchObject({ state: 'stop', index: 0, follow: 'self' });
  });

  it('the stop’s pause counts down, then "Walk me" walks to the next stop, facing it on arrival; arriving ticks and outlines it', () => {
    const { tour, hooks, navEvent } = setup();
    tour.start();
    tour.tick(5);
    expect(tour.status.dwell).toBe(3);
    tour.tick(3.1);
    expect(hooks.routeTo).toHaveBeenLastCalledWith({ x: 10, z: 0, floor: 0, name: 'Reception' }, { walk: 'auto', face: { yaw: 1, pitch: STOP_PITCH } });
    expect(tour.status).toMatchObject({ state: 'walking', index: 1, remaining: 10 });
    navEvent('progress', { remaining: 4 });
    expect(tour.status.remaining).toBe(4);
    navEvent('arrived');
    expect(tour.status).toMatchObject({ state: 'stop', index: 1, dwell: 20, visited: ['entrance', 'room:Reception'] });
    expect(hooks.highlight).toHaveBeenLastCalledWith(['r_Reception']);
  });

  it('at a stop the camera eases higher and further back (the stop view); walking on, pausing by walking away or ending: back', () => {
    const { tour, hooks, me } = setup();
    tour.start();
    expect(hooks.stopView).toHaveBeenLastCalledWith(true, false);
    tour.next();
    expect(hooks.stopView).toHaveBeenLastCalledWith(false, false);
    tour.goTo(2);
    return Promise.resolve().then(() => {
      expect(hooks.stopView).toHaveBeenLastCalledWith(true, false);
      me.x += MOVED_AWAY + 0.5;
      tour.tick(0.1);
      expect(hooks.stopView).toHaveBeenLastCalledWith(false, false);
      tour.setReducedMotion(true);
      tour.resume();
      tour.goTo(1);
      return Promise.resolve();
    }).then(() => {
      expect(hooks.stopView).toHaveBeenLastCalledWith(true, true); // reduced motion: at once
      tour.stop();
      expect(hooks.stopView).toHaveBeenLastCalledWith(false, true);
    });
  });

  it('a pauseScale shortens every pause (tests, demos)', () => {
    const { tour } = setup();
    tour.start({ pauseScale: 0.25 });
    expect(tour.status.dwell).toBe(2);
  });

  it('a movement key pauses "Walk me" (as Take me there); P or Resume walks on', () => {
    const { tour, nav, navEvent, key, types } = setup();
    tour.start();
    tour.next();
    navEvent('progress', { paused: true, remaining: 6 });
    expect(tour.status).toMatchObject({ state: 'paused', pausedFrom: 'walking' });
    expect(key('KeyP')).toBe(true);
    expect(nav.resume).toHaveBeenCalled();
    expect(tour.status.state).toBe('walking');
    expect(types()).toContain('resumed');
    // P again: paused on purpose (the route stops where you are)
    key('KeyP');
    expect(nav.pause).toHaveBeenCalled();
    expect(tour.status.state).toBe('paused');
    // G (navigation's own key) walked on: the tour follows
    navEvent('progress', { paused: false });
    expect(tour.status.state).toBe('walking');
    expect(key('KeyW')).toBe(false); // other keys walk as always
  });

  it('pausing at a stop stops its countdown', () => {
    const { tour } = setup();
    tour.start();
    tour.pause();
    tour.tick(30);
    expect(tour.status).toMatchObject({ state: 'paused', pausedFrom: 'stop', dwell: 8 });
    tour.resume();
    tour.tick(8.1);
    expect(tour.status.state).toBe('walking');
  });

  it('Next skips on, Previous and Skip the walk jump with the fade', async () => {
    const { tour, hooks } = setup();
    const fader = vi.fn(async (mid: () => void) => { mid(); });
    tour.setFader(fader);
    tour.start();
    expect(tour.next()).toBe(true); // to stop 2
    expect(tour.next()).toBe(true); // walking to 2: on to 3 (2 left out)
    expect(tour.status).toMatchObject({ state: 'walking', index: 2 });
    expect(tour.skip()).toBe(true); // there at once
    await Promise.resolve();
    expect(fader).toHaveBeenCalledTimes(1);
    expect(tour.status).toMatchObject({ state: 'stop', index: 2 });
    expect(hooks.setPose).toHaveBeenLastCalledWith({ x: 20, z: 0, floor: 0, yaw: 1, pitch: STOP_PITCH });
    expect(tour.previous()).toBe(true);
    await Promise.resolve();
    expect(tour.status).toMatchObject({ state: 'stop', index: 1 });
    expect(tour.goTo(3)).toBe(true);
    await Promise.resolve();
    expect(tour.status).toMatchObject({ state: 'stop', index: 3 });
    expect(tour.goTo(9)).toBe(false);
  });

  it('a fader that never calls mid() still gets there', async () => {
    const { tour } = setup();
    tour.setFader(() => Promise.resolve());
    tour.start();
    tour.skip();
    await Promise.resolve();
    await Promise.resolve();
    expect(tour.status).toMatchObject({ state: 'stop', index: 1 });
  });

  it('"Walk me" ↔ "I\'ll walk" at any time: walking, the same route goes on the other way', () => {
    const { tour, nav, hooks } = setup();
    tour.start();
    tour.next();
    expect(tour.setFollow('self')).toBe(true);
    expect(nav.setWalk).toHaveBeenLastCalledWith('guide');
    expect(tour.status.follow).toBe('self');
    tour.setFollow('auto');
    expect(nav.setWalk).toHaveBeenLastCalledWith('auto');
    // "I'll walk" from now on: the next walk is a line only
    tour.setFollow('self');
    tour.next();
    expect(hooks.routeTo).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ walk: 'guide' }));
  });

  it('at a stop, walking away: "I\'ll walk" goes on (the line to the next stop), "Walk me" pauses', () => {
    const a = setup();
    a.tour.start({ follow: 'self' });
    a.me.x = MOVED_AWAY + 0.2;
    a.tour.tick(0.1);
    expect(a.tour.status).toMatchObject({ state: 'walking', index: 1 });
    expect(a.hooks.routeTo).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ walk: 'guide' }));
    const b = setup();
    b.tour.start();
    b.me.x = MOVED_AWAY + 0.2;
    b.tour.tick(0.1);
    expect(b.tour.status).toMatchObject({ state: 'paused', pausedFrom: 'stop' });
    b.tour.resume(); // the countdown goes on from where you are now
    b.tour.tick(0.1);
    expect(b.tour.status.state).toBe('stop');
  });

  it('a click on the floor takes over the walk: paused; Resume makes a new route to the stop', () => {
    const { tour, hooks, nav } = setup();
    tour.start();
    tour.next();
    nav.active = { source: 'click', paused: false, walk: 'auto' };
    tour.onNavigation({ state: 'started', walk: 'auto', place: {} as never, source: 'click' });
    expect(tour.status).toMatchObject({ state: 'paused', pausedFrom: 'walking' });
    hooks.routeTo.mockClear();
    tour.resume();
    expect(hooks.routeTo).toHaveBeenCalledTimes(1);
    expect(tour.status).toMatchObject({ state: 'walking', index: 1 });
  });

  it('passing mentions: "On your left: Store" once, near its point of the route', () => {
    const { tour, me, types } = setup();
    tour.start();
    tour.goTo(1);
    tour.next(); // walking to Sales: its leg has the mention at x = 15
    me.x = 11;
    tour.tick(0.1);
    expect(types()).not.toContain('mention');
    me.x = 14;
    tour.tick(0.1);
    tour.tick(0.1);
    expect(types().filter((t) => t === 'mention')).toHaveLength(1);
    expect(tour.status.mention?.text).toBe('On your left: Store');
  });

  it('the last stop: done (Restart starts again with no ticks); Esc ends the tour where you are', () => {
    const { tour, hooks, key, types } = setup();
    tour.start();
    tour.goTo(4);
    return Promise.resolve().then(() => {
      expect(tour.status).toMatchObject({ state: 'done', index: 4, dwell: null });
      expect(types()).toContain('done');
      expect(tour.next()).toBe(false);
      tour.restart();
      expect(tour.status).toMatchObject({ state: 'stop', index: 0, visited: ['entrance'] });
      expect(key('Escape')).toBe(true);
      expect(tour.status.state).toBe('idle');
      expect(types().at(-1)).toBe('ended');
      expect(hooks.setKeys).toHaveBeenLastCalledWith(null);
      expect(hooks.clearHighlights).toHaveBeenCalled();
      expect(key('KeyP')).toBe(false);
    });
  });

  it('a route ended by someone else (another layout, leaving walking) ends the tour; its own stops don\'t', () => {
    const { tour, navEvent } = setup();
    tour.start();
    tour.next();
    tour.next(); // stops the first walk itself: still running
    expect(tour.running).toBe(true);
    navEvent('stopped');
    expect(tour.running).toBe(false);
  });

  it('a walk that fails (stuck) or can\'t start: there with a fade, and says why', async () => {
    const { tour, hooks, navEvent } = setup();
    tour.start();
    tour.next();
    navEvent('failed', { message: "Can't get past here" });
    await Promise.resolve();
    expect(tour.status).toMatchObject({ state: 'stop', index: 1 });
    hooks.routeTo.mockReturnValueOnce({ problem: 'NO_ROUTE', message: 'No walking route to Sales' } as never);
    tour.next();
    await Promise.resolve();
    expect(tour.status).toMatchObject({ state: 'stop', index: 2, message: 'No walking route to Sales' });
  });

  it('prefers-reduced-motion: no turning on the way; arriving faces the stop behind a fade', async () => {
    const { tour, hooks, navEvent, me } = setup();
    tour.setReducedMotion(true);
    const fader = vi.fn(async (mid: () => void) => { mid(); });
    tour.setFader(fader);
    tour.start();
    tour.next();
    expect(hooks.routeTo).toHaveBeenLastCalledWith(expect.anything(), { walk: 'auto', face: undefined });
    me.x = 9.5;
    navEvent('arrived');
    await Promise.resolve();
    expect(fader).toHaveBeenCalled();
    expect(hooks.setPose).toHaveBeenLastCalledWith({ x: 9.5, z: 0, floor: 0, yaw: 1, pitch: STOP_PITCH });
    expect(tour.status).toMatchObject({ state: 'stop', index: 1 });
  });

  it('visited stops are kept per browser and layout; blocked storage keeps them for this visit only', () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    a.tour.start();
    a.tour.next();
    a.navEvent('arrived');
    expect(JSON.parse(storage.m.get(VISITED_KEY)!)).toEqual({ 'Head office': ['entrance', 'room:Reception'] });
    a.tour.stop();
    const b = setup({ storage }); // a reload
    expect(b.tour.visitedNow()).toEqual(['entrance', 'room:Reception']);
    b.tour.start();
    expect(b.tour.status.visited).toEqual(['entrance', 'room:Reception']);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const c = setup({ storage: blocked as never });
    c.tour.start();
    c.tour.next();
    c.navEvent('arrived');
    expect(c.tour.status.visited).toEqual(['entrance', 'room:Reception']);
  });

  it('every count agrees: the status, the plan and "The tour: N stops"', () => {
    const { tour } = setup();
    tour.start();
    expect(tour.status.count).toBe(tour.status.plan!.stops.length);
  });

  it('nothing to tour, or walking can\'t start: a problem, no tour', () => {
    const empty = setup({ plan: { ...makePlan(), stops: [] } });
    expect(empty.tour.start()).toMatchObject({ problem: 'NO_TOUR' });
    expect(empty.tour.running).toBe(false);
    const stuck = setup();
    stuck.hooks.startWalking.mockReturnValueOnce(false);
    expect(stuck.tour.start()).toMatchObject({ problem: 'NOT_WALKING' });
    expect(stuck.tour.pause()).toBe(false);
    expect(stuck.tour.stop()).toBe(false);
  });
});
