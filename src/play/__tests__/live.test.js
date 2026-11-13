import { describe, it, expect } from 'vitest';
import {
  cleanLive, cleanSample, createTrack, chooseLiveDrawn, standingSpot, createPoseThrottle, poseOf, liveStateOf,
  nextFullCap, windowFps, wrapAngle, lerpAngle,
  LIVE_DELAY_MS, SNAP_DISTANCE, MAX_LIVE_DRAWN, KEEPALIVE_MS, FULL_CAP_MIN, FULL_CAP_MAX, CAP_HOLD_MS, STAND_BEHIND_SEAT,
  LIVE_TEXT_MAX,
} from '../live';

/** Run a track's frames from t0 to t1 every 16 ms; the last drawn spot. */
function run(track, t0, t1) {
  let out = null;
  for (let t = t0; t <= t1; t += 16) out = track.step(t);
  return out;
}

describe('cleaning what the page gives', () => {
  it('keeps only the fields drawn, cut and checked', () => {
    const p = cleanLive({
      personId: ' p1 ', name: 'A'.repeat(300), department: 'Sales', email: 'a@b.c', x: '3.5', z: 2, floor: 1, yaw: 7, state: 'walk',
      assetReference: 'rocketbox:x', clothing: { pantsColor: 'blue' },
    });
    expect(p.personId).toBe('p1');
    expect(p.name).toHaveLength(120);
    expect(p).not.toHaveProperty('email');
    expect(p.x).toBe(3.5);
    expect(p.floor).toBe(1);
    expect(p.yaw).toBeCloseTo(7 - Math.PI * 2);
    expect(p.state).toBe('walk');
    expect(cleanLive({ name: 'no id' })).toBeNull();
    expect(cleanLive(null)).toBeNull();
  });

  it('no x / z, a bad number or overview = no position', () => {
    expect(cleanSample({ floor: 0, x: 'a', z: 1 })).toEqual({ floor: 0, state: null });
    expect(cleanSample({ floor: 0, x: 1, z: 2, state: 'overview' })).toEqual({ floor: 0, state: 'overview' });
    expect(cleanSample({ floor: -1, x: 1, z: 2, state: 'dance' })).toMatchObject({ floor: null, state: null, x: 1, z: 2, yaw: 0 });
    expect(cleanSample({ floor: 1.5, x: Infinity, z: 2 })).toEqual({ floor: null, state: null });
  });

  it('angles wrap and lerp the short way', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 2);
  });
});

describe('createTrack: drawn 250 ms behind, gliding, snapping', () => {
  it('glides between samples at walking speed, LIVE_DELAY_MS behind', () => {
    const track = createTrack();
    // walking +x at 2 m/s, a sample every 200 ms
    for (let i = 0; i <= 10; i++) track.push({ x: i * 0.4, z: 0, floor: 0, yaw: Math.PI / 2, state: 'walk' }, i * 200);
    const at = run(track, 0, 1200);
    // 1200 ms - 250 ms behind = 950 ms → x 1.9 (the spring a little behind that)
    expect(at.x).toBeGreaterThan(1.7);
    expect(at.x).toBeLessThan(1.95);
    expect(at.speed).toBeGreaterThan(1.6);
    expect(at.speed).toBeLessThan(2.4);
    expect(at.state).toBe('walk');
    // no step is a jump: every frame moves at most 0.1 m
    const t2 = createTrack();
    let prev = null;
    for (let t = 0; t <= 2000; t += 16) {
      if (t % 200 === 0) t2.push({ x: (t / 200) * 0.4, z: 0, floor: 0 }, t);
      const s = t2.step(t);
      if (prev && s) expect(Math.abs(s.x - prev.x)).toBeLessThan(0.1);
      prev = s;
    }
    expect(t2.snaps).toBe(0);
  });

  it('a late sample: the spring keeps them moving (no stop dead)', () => {
    const track = createTrack();
    for (let i = 0; i <= 5; i++) track.push({ x: i * 0.4, z: 0, floor: 0 }, i * 200);
    // the next sample is 150 ms late
    run(track, 0, 1240);
    track.push({ x: 2.4, z: 0, floor: 0 }, 1350);
    const a = track.step(1256);
    const b = track.step(1272);
    expect(b.x).toBeGreaterThanOrEqual(a.x);
  });

  it(`a jump over ${SNAP_DISTANCE} m or to another floor snaps when its time comes`, () => {
    const track = createTrack();
    track.push({ x: 0, z: 0, floor: 0 }, 0);
    track.push({ x: 0.4, z: 0, floor: 0 }, 200);
    track.push({ x: 20, z: 0, floor: 0 }, 400); // Back to entrance
    const before = run(track, 0, 400 + LIVE_DELAY_MS - 20);
    expect(before.x).toBeLessThan(0.5); // never slides towards it
    const after = run(track, 400 + LIVE_DELAY_MS - 4, 400 + LIVE_DELAY_MS + 40);
    expect(after.x).toBe(20);
    expect(track.snaps).toBe(1);
    track.push({ x: 20.2, z: 0, floor: 1 }, 600);
    expect(run(track, 700, 1000)).toMatchObject({ x: 20.2, floor: 1 });
    expect(track.snaps).toBe(2);
  });

  it('turns the short way round and keeps the wave', () => {
    const track = createTrack();
    track.push({ x: 0, z: 0, floor: 0, yaw: 3.0 }, 0);
    track.push({ x: 0, z: 0, floor: 0, yaw: -3.0, state: 'wave' }, 200);
    const s = run(track, 0, 360);
    expect(Math.abs(s.yaw)).toBeGreaterThan(2.9);
    expect(run(track, 360, 700).state).toBe('wave');
  });

  it('a message with no position is heard (keepalive) but moves nothing', () => {
    const track = createTrack();
    expect(track.push({ floor: 0, state: 'overview' }, 500)).toBe(false);
    expect(track.lastHeard).toBe(500);
    expect(track.step(800)).toBeNull();
  });
});

describe('who is drawn', () => {
  it(`the nearest ${MAX_LIVE_DRAWN} on the floor shown`, () => {
    const people = Array.from({ length: 40 }, (_, i) => ({ personId: `p${String(i).padStart(2, '0')}`, floor: 0, x: i, z: 0 }));
    people.push({ personId: 'up', floor: 1, x: 0, z: 0 }, { personId: 'nowhere', floor: 0 });
    const drawn = chooseLiveDrawn(people, { x: 0, z: 0 }, 0);
    expect(drawn).toHaveLength(MAX_LIVE_DRAWN);
    expect(drawn[0]).toBe('p00');
    expect(drawn).not.toContain('up');
    expect(drawn).not.toContain('p35');
    expect(chooseLiveDrawn(people, { x: 39, z: 0 }, 0, 2)).toEqual(['p39', 'p38']);
  });

  it('standing up from the desk: behind the chair, facing the desk', () => {
    const spot = standingSpot({ x: 2, y: 3.5, z: 4, yaw: 0, floor: 1, seated: true });
    expect(spot).toMatchObject({ x: 2, z: 4 - STAND_BEHIND_SEAT, y: 3.5, yaw: 0, floor: 1 });
    expect(standingSpot({ x: 2, y: 0, z: 4, yaw: Math.PI / 2, floor: 0, seated: false })).toMatchObject({ x: 2, z: 4 });
  });
});

describe('your own pose: at most 5 a second, only when moving', () => {
  it('sends the first, moves at most every 200 ms, and where you stopped', () => {
    const throttle = createPoseThrottle();
    const sent = [];
    // 2 s walking at 2 m/s, a frame every 16 ms, then standing 1 s
    for (let t = 0; t <= 3000; t += 16) {
      const x = Math.min(t, 2000) / 1000 * 2;
      const out = throttle.next(poseOf({ x, y: 0, z: 0, yaw: 0, floor: 0, state: t < 2000 ? 'walk' : 'idle' }), t);
      if (out) sent.push({ t, ...out });
    }
    for (let i = 1; i < sent.length; i++) expect(sent[i].t - sent[i - 1].t).toBeGreaterThanOrEqual(200);
    expect(sent.length).toBeLessThanOrEqual(12);
    const last = sent[sent.length - 1];
    expect(last.x).toBe(4);
    expect(last.state).toBe('idle');
    expect(last.t).toBeLessThan(2300); // nothing more while standing
  });

  it(`standing still: a keepalive every ${KEEPALIVE_MS / 1000} s, and at once on a new floor or overview`, () => {
    const throttle = createPoseThrottle();
    const pose = { x: 1, y: 0, z: 1, yaw: 0, floor: 0, state: 'idle' };
    const times = [];
    for (let t = 0; t <= 10_000; t += 100) if (throttle.next(pose, t)) times.push(t);
    expect(times).toEqual([0, 4000, 8000]);
    expect(throttle.next({ ...pose, floor: 1 }, 10_100)).toMatchObject({ floor: 1 });
    expect(throttle.next({ state: 'overview', floor: 1 }, 10_300)).toEqual({ state: 'overview', floor: 1 });
    expect(throttle.next({ state: 'overview', floor: 1 }, 10_500)).toBeNull();
  });

  it('a turn on the spot counts; the pose is small', () => {
    const throttle = createPoseThrottle();
    throttle.next({ x: 0, z: 0, yaw: 0, floor: 0, state: 'idle' }, 0);
    expect(throttle.next({ x: 0, z: 0, yaw: 0.01, floor: 0, state: 'idle' }, 300)).toBeNull();
    expect(throttle.next({ x: 0, z: 0, yaw: 0.2, floor: 0, state: 'idle' }, 400)).not.toBeNull();
    const pose = poseOf({ x: 12.345678, y: 3.50001, z: -40.123456, yaw: 7, floor: 2, state: 'run' });
    expect(pose).toEqual({ state: 'run', floor: 2, x: 12.35, y: 3.5, z: -40.12, yaw: 0.72 });
    expect(JSON.stringify({ type: 'pose', ...pose }).length).toBeLessThan(120);
  });

  it('the state: the clip, else the speed', () => {
    expect(liveStateOf('Wave', 0, false)).toBe('wave');
    expect(liveStateOf(null, 2.2, false)).toBe('walk');
    expect(liveStateOf(undefined, 4.5, false)).toBe('run');
    expect(liveStateOf(null, 4.5, true)).toBe('idle');
  });
});

describe('the full-character cap, from the frame rate', () => {
  const frames = (fps, n = 180) => Array.from({ length: n }, () => 1000 / fps);

  it('measures the slow frames, not the average', () => {
    expect(windowFps(frames(60))).toBeCloseTo(60);
    const hitchy = [...frames(60, 160), ...frames(20, 20)];
    expect(windowFps(hitchy)).toBeLessThan(35);
    expect(windowFps(frames(60, 10))).toBeNull();
  });

  it('weak devices keep 12', () => {
    expect(nextFullCap({ cap: 20 }, { fps: 120, now: 0, weak: true }).cap).toBe(FULL_CAP_MIN);
  });

  it('rises after two smooth windows while more are wanted, up to 24; falls at once when slow, then holds', () => {
    let s = { cap: FULL_CAP_MIN, good: 0, holdUntil: 0 };
    s = nextFullCap(s, { fps: 60, now: 0, wanted: 30 });
    expect(s.cap).toBe(12);
    s = nextFullCap(s, { fps: 60, now: 3000, wanted: 30 });
    expect(s.cap).toBe(16);
    for (let i = 0; i < 10; i++) s = nextFullCap(s, { fps: 60, now: 6000 + i * 3000, wanted: 30 });
    expect(s.cap).toBe(FULL_CAP_MAX);
    s = nextFullCap(s, { fps: 30, now: 40_000, wanted: 30 });
    expect(s.cap).toBe(20);
    s = nextFullCap(s, { fps: 60, now: 43_000, wanted: 30 });
    s = nextFullCap(s, { fps: 60, now: 46_000, wanted: 30 });
    expect(s.cap).toBe(20); // held after lowering
    s = nextFullCap(s, { fps: 60, now: 40_000 + CAP_HOLD_MS, wanted: 30 });
    s = nextFullCap(s, { fps: 60, now: 43_000 + CAP_HOLD_MS, wanted: 30 });
    expect(s.cap).toBe(24);
  });

  it('never rises with nobody more to draw, nor without a measurement; never below 12', () => {
    let s = { cap: 12, good: 0, holdUntil: 0 };
    for (let i = 0; i < 5; i++) s = nextFullCap(s, { fps: 144, now: i * 3000, wanted: 8 });
    expect(s.cap).toBe(12);
    expect(nextFullCap(s, { fps: null, now: 0, wanted: 30 })).toEqual(s);
    expect(nextFullCap(s, { fps: 10, now: 0, wanted: 30 }).cap).toBe(12);
  });
});

describe('bad live data is ignored safely (v0.16.1 review)', () => {
  it('no person id, not an object: not a live person', () => {
    for (const raw of [null, undefined, 42, 'asha', [], {}, { personId: '' }, { personId: '   ' }, { personId: {} }]) {
      expect(cleanLive(raw)).toBeNull();
    }
  });

  it('missing, NaN, infinite or huge positions: no position (never drawn at NaN)', () => {
    for (const bad of [
      {}, { x: 1 }, { z: 1 }, { x: NaN, z: 1 }, { x: 1, z: Infinity }, { x: '1', z: 'a' }, { x: 1e9, z: 0 },
      { x: null, z: null }, { x: {}, z: [] },
    ]) {
      const s = cleanSample({ floor: 0, state: 'walk', ...bad });
      expect(s.x).toBeUndefined();
      expect(s.z).toBeUndefined();
    }
    const s = cleanSample({ floor: 0, x: 1, z: 2, y: NaN, yaw: Infinity, state: 'walk' });
    expect(s).toEqual({ floor: 0, state: 'walk', x: 1, z: 2, yaw: 0 }); // no y, facing 0
    expect(cleanSample({ floor: 0, x: 1, z: 2, y: 1e6 }).y).toBeUndefined();
  });

  it('a floor that is not a floor id, a state it does not know: left out', () => {
    for (const floor of [-1, 1.5, NaN, Infinity, 'up', null, {}]) expect(cleanSample({ floor }).floor).toBeNull();
    expect(cleanSample({ floor: '2' }).floor).toBe(2);
    for (const state of ['dance', '', 3, null, {}, 'WALK']) expect(cleanSample({ state }).state).toBeNull();
  });

  it('very long or odd names: cut to the limit, never anything but text', () => {
    const p = cleanLive({ personId: 'p'.repeat(500), name: 'A'.repeat(5000), department: { html: '<b>' }, clothing: 'red' });
    expect(p.personId).toHaveLength(LIVE_TEXT_MAX);
    expect(p.name).toHaveLength(LIVE_TEXT_MAX);
    expect(p.department).toBe('');
    expect(p.clothing).toBeNull();
    expect(cleanLive({ personId: 'x', name: '<img src=x onerror=alert(1)>' }).name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('the full-character cap does not flip up and down (v0.16.1 review)', () => {
  const step = (s, fps, now) => nextFullCap(s, { fps, now, wanted: 99 });

  it('smooth and slow windows in turn: it never rises (a raise needs two smooth windows in a row)', () => {
    let s = { cap: FULL_CAP_MIN };
    for (let i = 0; i < 20; i++) s = step(s, i % 2 ? 40 : 60, i * 3000);
    expect(s.cap).toBe(FULL_CAP_MIN);
  });

  it('one step after two smooth windows, at once down when slow, then it waits 30 s', () => {
    let s = step(step({ cap: FULL_CAP_MIN }, 60, 0), 60, 3000);
    expect(s.cap).toBe(16);
    s = step(s, 20, 6000); // one slow window: down at once
    expect(s.cap).toBe(12);
    for (let t = 9000; t < 6000 + CAP_HOLD_MS; t += 3000) s = step(s, 120, t);
    expect(s.cap).toBe(12); // held
  });

  it('never above 24, never below 12: many smooth windows, or a state given from outside', () => {
    let s = { cap: FULL_CAP_MIN };
    for (let i = 0; i < 100; i++) s = step(s, 144, i * 3000);
    expect(s.cap).toBe(FULL_CAP_MAX);
    expect(step({ cap: 400 }, 60, 0).cap).toBe(FULL_CAP_MAX);
    expect(step({ cap: 400 }, 20, 0).cap).toBe(FULL_CAP_MAX - 4);
    expect(step({ cap: -5 }, 40, 0).cap).toBe(FULL_CAP_MIN);
    expect(step({ cap: NaN }, 40, 0).cap).toBe(FULL_CAP_MIN);
  });
});
