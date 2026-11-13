/**
 * play/live.js — live presence (v0.16.1), the pure parts: no Babylon, no DOM
 * (tests: play/__tests__/live.test.js).
 *
 * People who have the 3D Company page open send where they walk (the page's
 * WebSocket, AHDUS); everyone else is drawn at their desk as before. Here:
 * - cleanLive / cleanSample: what the page gives (numbers checked, text cut, nothing but the fields we draw).
 * - createTrack: one live person's samples, drawn LIVE_DELAY_MS behind, gliding between them (and a light
 *   spring over that, so a late sample doesn't stop them dead); a jump over SNAP_DISTANCE or to another
 *   floor is a snap, never a slide through the walls.
 * - chooseLiveDrawn: the nearest MAX_LIVE_DRAWN on the floor shown.
 * - standingSpot: someone on the page who isn't walking (looking from above) stands up beside their desk.
 * - createPoseThrottle: what this browser sends of its own walk: at most POSE_RATE a second, only when it
 *   moved, turned or changed what it does, and a keepalive every KEEPALIVE_MS (else others think it left).
 * - nextFullCap: how many full characters this device draws, measured from its frame rate.
 */

/** Live people are drawn this far behind the samples (ms): there is always a next one to glide to. */
export const LIVE_DELAY_MS = 250;
/** A move further than this (m) between two samples is a jump (stairs, Back to entrance, a fade): a snap. */
export const SNAP_DISTANCE = 5;
/** A live person with no sample for this long (ms) has left: they sit back down at their desk. */
export const SILENT_MS = 10_000;
/** At most this many live people are drawn, the nearest on the floor shown. */
export const MAX_LIVE_DRAWN = 30;
/** How fast the drawn spot follows the glided one (1 / s): small enough to hide a late sample. */
export const FOLLOW_RATE = 14;
/** What a live person does (the clip they play). 'overview' = on the page, looking from above (no position). */
export const LIVE_STATES = Object.freeze(['idle', 'walk', 'run', 'wave', 'overview']);
/** Names and departments are cut to this many characters (as setPeople's). */
export const LIVE_TEXT_MAX = 120;
/** How far behind their chair (m) someone stands who stood up from their desk. */
export const STAND_BEHIND_SEAT = 0.55;
/** Samples kept per person (5 a second: 4 s). */
const MAX_SAMPLES = 20;
const TAU = Math.PI * 2;

const finite = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, LIVE_TEXT_MAX) : '');

/** An angle in (−π, π]. */
export function wrapAngle(a) {
  if (a > -Math.PI && a <= Math.PI) return a;
  let r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (r === -Math.PI) r = Math.PI;
  return r;
}

/** From angle a towards b by t (0…1), the short way round. */
export function lerpAngle(a, b, t) {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

/**
 * The position part of what the page gives: { floor, x, z, y?, yaw, state } with every number checked.
 * No x / z (or not numbers): no position ({ floor?, state } only: looking from above, or not known here).
 * @param {object} raw
 * @returns {{ floor: number | null, x?: number, z?: number, y?: number, yaw?: number, state: string | null }}
 */
export function cleanSample(raw) {
  const out = { floor: null, state: null };
  if (!raw || typeof raw !== 'object') return out;
  if (finite(raw.floor) && Number.isInteger(Number(raw.floor)) && Number(raw.floor) >= 0) out.floor = Number(raw.floor);
  if (LIVE_STATES.includes(raw.state)) out.state = raw.state;
  if (out.state !== 'overview' && finite(raw.x) && finite(raw.z) && Math.abs(raw.x) < 1e5 && Math.abs(raw.z) < 1e5) {
    out.x = Number(raw.x);
    out.z = Number(raw.z);
    if (finite(raw.y) && Math.abs(raw.y) < 100) out.y = Number(raw.y);
    out.yaw = finite(raw.yaw) ? wrapAngle(Number(raw.yaw)) : 0;
  }
  return out;
}

/** Has this sample a position? */
export const hasPosition = (s) => !!s && typeof s.x === 'number' && typeof s.z === 'number';

/**
 * A live person as the page gives it (live.add): { personId, name, department, assetReference, clothing } +
 * cleanSample's fields. Only these fields are kept (no email or anything else reaches the 3D view).
 * null: no personId.
 */
export function cleanLive(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const personId = text(raw.personId);
  if (!personId) return null;
  return {
    personId,
    name: text(raw.name),
    department: text(raw.department),
    assetReference: typeof raw.assetReference === 'string' ? raw.assetReference : null,
    clothing: raw.clothing && typeof raw.clothing === 'object' ? raw.clothing : null,
    ...cleanSample(raw),
  };
}

/**
 * One live person's movement. push(sample, now) as samples arrive (ms, the receiver's clock);
 * step(now) each frame = where to draw them: the samples' path LIVE_DELAY_MS behind (glided, the yaw the
 * short way round), followed by a spring (FOLLOW_RATE); a jump (> SNAP_DISTANCE, another floor) snaps at
 * the moment its sample is reached. `speed` = how fast the drawn spot moves (m/s, smoothed): the clips'
 * speed. `state` = the sample's (or null: from the speed).
 */
export function createTrack({ delay = LIVE_DELAY_MS, snap = SNAP_DISTANCE, follow = FOLLOW_RATE } = {}) {
  /** @type {{ t: number, x: number, y: number | null, z: number, yaw: number, floor: number, state: string | null, jump: boolean }[]} */
  const samples = [];
  let shown = null; // { x, y, z, yaw, floor }
  let lastStep = null;
  let speed = 0;
  let lastHeard = -Infinity;
  let snaps = 0;

  function push(sample, now) {
    lastHeard = now;
    if (!hasPosition(sample)) return false;
    const prev = samples[samples.length - 1];
    const floor = sample.floor ?? prev?.floor ?? 0;
    const t = prev ? Math.max(now, prev.t + 1) : now;
    const jump = !!prev && (floor !== prev.floor || Math.hypot(sample.x - prev.x, sample.z - prev.z) > snap);
    samples.push({ t, x: sample.x, y: sample.y ?? null, z: sample.z, yaw: sample.yaw ?? prev?.yaw ?? 0, floor, state: sample.state, jump });
    while (samples.length > MAX_SAMPLES) samples.shift();
    return true;
  }

  /** Where the samples say they were at time `at` (no spring), and whether a jump was just passed. */
  function target(at) {
    if (!samples.length) return null;
    if (at <= samples[0].t) return { ...samples[0], jumped: false };
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1];
      const b = samples[i];
      if (at < a.t) continue;
      if (at >= b.t) return { ...b, jumped: b.jump };
      if (b.jump) return { ...a, jumped: false }; // stays, then snaps when b's time comes
      const k = (at - a.t) / (b.t - a.t);
      return {
        t: at, floor: b.floor, state: a.state, jump: false, jumped: false,
        x: a.x + (b.x - a.x) * k,
        z: a.z + (b.z - a.z) * k,
        y: a.y === null || b.y === null ? b.y ?? a.y : a.y + (b.y - a.y) * k,
        yaw: lerpAngle(a.yaw, b.yaw, k),
      };
    }
    return { ...samples[samples.length - 1], jumped: false };
  }

  function step(now) {
    const want = target(now - delay);
    if (!want) return null;
    const dt = lastStep === null ? 0 : Math.min(0.25, Math.max(0, (now - lastStep) / 1000));
    lastStep = now;
    const jumped = !shown || want.floor !== shown.floor || Math.hypot(want.x - shown.x, want.z - shown.z) > snap;
    if (jumped) {
      if (shown) snaps++;
      shown = { x: want.x, y: want.y, z: want.z, yaw: want.yaw, floor: want.floor };
      speed = 0;
    } else {
      const k = 1 - Math.exp(-follow * dt);
      const bx = shown.x;
      const bz = shown.z;
      shown.x += (want.x - shown.x) * k;
      shown.z += (want.z - shown.z) * k;
      shown.y = shown.y === null || want.y === null ? want.y : shown.y + (want.y - shown.y) * k;
      shown.yaw = lerpAngle(shown.yaw, want.yaw, k);
      if (dt > 0) {
        const v = Math.hypot(shown.x - bx, shown.z - bz) / dt;
        speed += (v - speed) * Math.min(1, dt * 8);
      }
    }
    // the newest sample's state from the moment its time is reached
    return { ...shown, state: want.state, speed: Math.max(0, speed) };
  }

  return {
    push,
    step,
    target,
    /** When the last message (with or without a position) came (ms). */
    get lastHeard() { return lastHeard; },
    /** Heard from without moving (a keepalive). */
    touch(now) { lastHeard = now; },
    get hasPosition() { return samples.length > 0; },
    get last() { return samples[samples.length - 1] ?? null; },
    /** How many snaps were drawn (tests). */
    get snaps() { return snaps; },
    /** Forget the samples (no position any more: looking from above, another floor). */
    clear() { samples.length = 0; shown = null; lastStep = null; speed = 0; },
  };
}

/**
 * Who is drawn: live people with a spot on `floor`, the nearest to `from` first, at most `max`.
 * @param {{ personId: string, floor: number, x: number, z: number }[]} people
 * @returns {string[]} personIds
 */
export function chooseLiveDrawn(people, from, floor, max = MAX_LIVE_DRAWN) {
  const near = [];
  for (const p of people) {
    if (p.floor !== floor || typeof p.x !== 'number') continue;
    near.push({ id: p.personId, d: from ? Math.hypot(p.x - from.x, p.z - from.z) : 0 });
  }
  near.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return near.slice(0, Math.max(0, max)).map((n) => n.id);
}

/**
 * Where someone stands who stood up from their desk (on the page, looking from above): seated, STAND_BEHIND_SEAT
 * behind their chair, facing the desk as they sat; at a desk with no chair, where they stand already.
 * @param {{ x: number, y: number, z: number, yaw: number, floor: number, seated: boolean } | null} placed CharacterSystem's
 */
export function standingSpot(placed) {
  if (!placed) return null;
  const back = placed.seated ? STAND_BEHIND_SEAT : 0;
  return {
    x: placed.x - Math.sin(placed.yaw) * back,
    z: placed.z - Math.cos(placed.yaw) * back,
    y: placed.y,
    yaw: placed.yaw,
    floor: placed.floor,
  };
}

// ── What this browser sends ──────────────────────────────────────────────

/** At most this many poses a second. */
export const POSE_RATE = 5;
/** Standing still (or from above), the pose again this often (ms), so the others know you are still there. */
export const KEEPALIVE_MS = 4_000;
/** Moving less than this (m) or turning less than this (rad) since the last pose sent is not moving. */
export const POSE_MIN_MOVE = 0.05;
export const POSE_MIN_TURN = 0.035;

/**
 * Your own pose for the page to send: next(pose, now) → the pose to send now, or null. A pose =
 * { state, floor, x?, y?, z?, yaw? } (state 'overview': from above, no position). Sent: the first one,
 * then whenever the state or floor changes, or it moved / turned (at most POSE_RATE a second: a change
 * made too soon is sent when the time comes, so where you stopped is always sent), and a keepalive
 * after KEEPALIVE_MS of nothing.
 */
export function createPoseThrottle({ rate = POSE_RATE, keepalive = KEEPALIVE_MS, minMove = POSE_MIN_MOVE, minTurn = POSE_MIN_TURN } = {}) {
  let sent = null;
  let sentAt = -Infinity;
  const gap = 1000 / rate;
  return {
    next(pose, now) {
      if (!pose) return null;
      let changed = !sent || pose.state !== sent.state || pose.floor !== sent.floor || hasPosition(pose) !== hasPosition(sent);
      if (!changed && hasPosition(pose)) {
        changed = Math.hypot(pose.x - sent.x, pose.z - sent.z) >= minMove
          || Math.abs((pose.y ?? 0) - (sent.y ?? 0)) >= minMove
          || Math.abs(wrapAngle((pose.yaw ?? 0) - (sent.yaw ?? 0))) >= minTurn;
      }
      const due = now - sentAt >= gap;
      if ((changed && due) || now - sentAt >= keepalive) {
        sent = { ...pose };
        sentAt = now;
        return { ...pose };
      }
      return null;
    },
    /** Start again (a new layout, walking stopped and started): the next pose is sent at once. */
    reset() { sent = null; sentAt = -Infinity; },
  };
}

/**
 * Your pose as sent: the walker's spot rounded (cm, 0.01 rad), its floor, and what it does. Rounded so a
 * message stays small (the server allows 200 bytes).
 */
export function poseOf({ x, y, z, yaw, floor, state }) {
  const r = (v, d) => Math.round(v * d) / d;
  return { state, floor, x: r(x, 100), y: r(y, 100), z: r(z, 100), yaw: r(wrapAngle(yaw), 100) };
}

/** What your character does, as a live state: its clip ('Walk' → 'walk'), else from the speed. */
export function liveStateOf(gait, speed, flying, { walkFrom = 0.3, runFrom = 3.3 } = {}) {
  const g = typeof gait === 'string' ? gait.toLowerCase() : null;
  if (g === 'wave' || g === 'run' || g === 'walk' || g === 'idle') return g;
  if (flying || !(speed >= walkFrom)) return 'idle';
  return speed >= runFrom ? 'run' : 'walk';
}

// ── How many full characters this device draws ───────────────────────────

/** Full characters: at least this many (weak devices keep it), at most this many on a fast one. */
export const FULL_CAP_MIN = 12;
export const FULL_CAP_MAX = 24;
export const FULL_CAP_STEP = 4;
/** One measurement window (ms of frames drawn). */
export const CAP_WINDOW_MS = 3_000;
/** A window this smooth (frames a second, its slowest tenth counted) is room for more… */
export const CAP_RAISE_FPS = 50;
/** …this slow, fewer. */
export const CAP_LOWER_FPS = 35;
/** Raised only after this many smooth windows in a row; after lowering, not raised again for this long (ms). */
export const CAP_RAISE_AFTER = 2;
export const CAP_HOLD_MS = 30_000;

/**
 * The frame rate of a window: frames a second from its 90th-percentile frame time (a few slow frames, a
 * hitch while a file loads, count; one is not enough to lower it). null: too few frames to say.
 * @param {number[]} frameMs frame times (ms)
 */
export function windowFps(frameMs) {
  const f = frameMs.filter((d) => d > 0 && d < 1000);
  if (f.length < 20) return null;
  const sorted = [...f].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return 1000 / p90;
}

/**
 * The cap after one window: { cap, good, holdUntil } from the state before and the window's fps (windowFps).
 * Weak devices (software WebGL, quality 'low') keep FULL_CAP_MIN. It rises only while more people are wanted
 * than the cap allows (`wanted`: measuring with nothing to draw says nothing), never from the device's name.
 * @param {{ cap: number, good: number, holdUntil: number }} state
 * @param {{ fps: number | null, now: number, weak?: boolean, wanted?: number }} window
 */
export function nextFullCap(state, { fps, now, weak = false, wanted = Infinity }) {
  // never above FULL_CAP_MAX nor below FULL_CAP_MIN, whatever state it is given
  const was = Number.isFinite(state?.cap) ? state.cap : FULL_CAP_MIN;
  const s = { cap: Math.min(FULL_CAP_MAX, Math.max(FULL_CAP_MIN, was)), good: state?.good ?? 0, holdUntil: state?.holdUntil ?? 0 };
  if (weak) return { cap: FULL_CAP_MIN, good: 0, holdUntil: s.holdUntil };
  if (fps === null || !Number.isFinite(fps)) return s;
  if (fps < CAP_LOWER_FPS) {
    if (s.cap <= FULL_CAP_MIN) return { ...s, good: 0 };
    return { cap: Math.max(FULL_CAP_MIN, s.cap - FULL_CAP_STEP), good: 0, holdUntil: now + CAP_HOLD_MS };
  }
  if (fps >= CAP_RAISE_FPS && wanted > s.cap && s.cap < FULL_CAP_MAX && now >= s.holdUntil) {
    const good = s.good + 1;
    if (good >= CAP_RAISE_AFTER) return { cap: Math.min(FULL_CAP_MAX, s.cap + FULL_CAP_STEP), good: 0, holdUntil: s.holdUntil };
    return { ...s, good };
  }
  return { ...s, good: 0 };
}
