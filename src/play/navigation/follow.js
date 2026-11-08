/**
 * follow.js: following a route (v0.13.4, NAVIGATION_PLAN.md 4.5 and 5.3). PURE, no Babylon.
 *
 * A route from route.js (legs per floor, joined by stairs) becomes one path:
 * its points, each tagged with its floor; between two legs a straight stairs
 * segment (the bottom landing → the top landing, or back down).
 *
 *   const f = createFollower(route, { mapFor });
 *   const step = f.step({ x, z, floor, yaw }, dt);   // every frame
 *     → { dirX, dirZ, speed, yaw, s, remaining, offRoute, arrived, stuck, onStairs, floor }
 *
 * - "Show route" (guide) only reads s / remaining / offRoute / arrived: you walk yourself.
 * - "Take me there" (auto) moves the body along (dirX, dirZ) at `speed` (the caller moves it with
 *   moveWithSteps, the same collisions as the keys) and turns it to `yaw` (≤ TURN_RATE).
 *
 * Steering: the furthest point ahead on the route (up to LOOK_AHEAD) that can be walked to in a
 * straight line, keeping FURNITURE_CLEARANCE (0.44 m) from solid items when there is room (else no
 * closer to them than the body is now: narrow aisles and doors fall back to the route itself), plus
 * a small push away from furniture closer than that. The route already keeps 0.34 m (the walk map).
 */

import { segmentToRect, cellsClear } from './route';
import { distanceToRect, FREE, STAIRS, BLOCKED } from './walkMap';
import { WALK_SPEED } from '../speeds';

/** Take me there walks at the character's walking speed (play/speeds.js, the one constant). */
export const AUTO_SPEED = WALK_SPEED;
/** Turning (rad/s): 270°/s. */
export const TURN_RATE = (3 * Math.PI) / 2;
/** Arrived: this close to the end of the route (m), on its floor. */
export const ARRIVE_WITHIN = 1;
/** Off the route (Show route): further than this from it (m) → a new route. */
export const OFF_ROUTE = 3;
/** Stuck: less than STUCK_PROGRESS (m) along the route in STUCK_TIME (s). */
export const STUCK_TIME = 1.5;
export const STUCK_PROGRESS = 0.3;
/** Where there's room, the body's centre keeps this far from solid items (m): ~0.1 m more than the walk map. */
export const FURNITURE_CLEARANCE = 0.44;
/** How far ahead on the route it aims (m), at most. */
export const LOOK_AHEAD = 1.8;
const LOOK_STEPS = [1.8, 1.3, 0.9, 0.6];
/** On a staircase it aims this far ahead (m): onto the flight's own line, not across its solid side. */
const STAIR_LOOK = 0.8;
/** Aim this far beside the route (m) when it grazes furniture and there is room. */
const SIDE_STEPS = [0, 0.1, -0.1, 0.2, -0.2];
const MIN_LOOK = 0.45;
/** A tight spot (a door, a narrow aisle) this far ahead on the route: follow its line closely. */
export const TIGHT_AHEAD = 1.5;
/** …blocked on both sides within this of the route's line. */
const TIGHT_SIDE = 0.3;
const TIGHT_LOOK = 0.2;
/**
 * Walking speed in a tight spot (m/s), and at most TIGHT_STEP per frame (a slow frame of 0.25 s: 0.8 m/s):
 * one frame is one straight step, and a longer one cuts the corner before a door into its frame.
 */
export const TIGHT_SPEED = 0.9 * AUTO_SPEED;
const TIGHT_STEP = 0.2;
/** A step never ends closer than this to a wall or an item (m: the body + 4 cm); else it is halved, down to SAFE_STEP_MIN. */
const SAFE_CLEARANCE = 0.36;
const SAFE_STEP_MIN = 0.05;
/** Slower near a sharp turn ahead (within this many metres) and at the end. */
const CORNER_AHEAD = 1.4;
const SLOW_END = 2;
const MIN_SPEED = 1.1;

const angleDiff = (a, b) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
export const headingOf = (dx, dz) => Math.atan2(dx, dz); // yaw 0 = +Z

/** Turn `from` towards `to` by at most `max` radians. */
export function turnTowards(from, to, max) {
  const d = angleDiff(from, to);
  return Math.abs(d) <= max ? to : from + Math.sign(d) * max;
}

/**
 * A route as one path: [{ x, z, floor, s, stairs }] (s: metres from the start; stairs: the segment
 * from this point to the next is a staircase), and its length (= route.length).
 */
export function routePath(route) {
  const points = [];
  route.legs.forEach((leg, i) => {
    leg.points.forEach((p, k) => {
      const last = k === leg.points.length - 1;
      const stairs = last && i < route.legs.length - 1;
      const toFloor = stairs ? leg.stairsAtEnd?.toFloor : undefined;
      points.push({ x: p.x, z: p.z, floor: leg.floor, stairs, toFloor, stairLength: last ? leg.stairsAtEnd?.length : undefined });
      // along the flight's own line: its sides are solid, the landing may be off to one side
      if (stairs) for (const v of leg.stairsAtEnd?.via ?? []) points.push({ x: v.x, z: v.z, floor: leg.floor, stairs: true, toFloor, inFlight: true });
    });
  });
  let s = 0;
  // a staircase's segments together are as long as the route says (its slope is longer than its plan)
  let stretch = 1;
  points.forEach((p, k) => {
    p.s = s;
    const q = points[k + 1];
    if (!q) return;
    const flat = Math.hypot(q.x - p.x, q.z - p.z);
    if (p.stairLength !== undefined && p.stairs) {
      let plan = flat;
      for (let n = k + 1; points[n]?.inFlight && points[n + 1]; n++) plan += Math.hypot(points[n + 1].x - points[n].x, points[n + 1].z - points[n].z);
      stretch = plan > 1e-6 ? Math.max(1, p.stairLength / plan) : 1;
      p.len = plan > 1e-6 ? flat * stretch : Math.max(flat, p.stairLength);
    } else {
      p.len = p.inFlight ? flat * stretch : flat;
    }
    s += p.len;
  });
  const last = points[points.length - 1];
  if (last) last.len = 0;
  return { points, length: s };
}

/** Can segment k be where a walker on `floor` is? (its floor, or a staircase from / to it) */
function segmentOn(points, k, floor) {
  const a = points[k];
  const b = points[k + 1];
  return a.floor === floor || (a.stairs && (b.floor === floor || a.toFloor === floor));
}

/** The nearest point of the path to (x, z) on segments [from, to] usable on `floor`: { k, t, s, dist }. */
export function projectOnPath(path, x, z, floor, from = 0, to = path.points.length - 2) {
  const { points } = path;
  let best = null;
  for (let k = Math.max(0, from); k <= Math.min(to, points.length - 2); k++) {
    if (floor !== undefined && !segmentOn(points, k, floor)) continue;
    const a = points[k];
    const b = points[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const dist = Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
    if (!best || dist < best.dist - 1e-9) best = { k, t, s: a.s + t * a.len, dist };
  }
  if (!best && points.length === 1) {
    const p = points[0];
    best = { k: 0, t: 0, s: 0, dist: Math.hypot(p.x - x, p.z - z) };
  }
  return best;
}

/** The point at `s` metres along the path: { x, z, floor, k } (clamped to its ends). */
export function pointAt(path, s) {
  const { points } = path;
  if (!points.length) return null;
  if (s <= 0) return { x: points[0].x, z: points[0].z, floor: points[0].floor, k: 0 };
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k];
    if (s <= a.s + a.len) {
      const b = points[k + 1];
      const t = a.len > 0 ? (s - a.s) / a.len : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, floor: t < 0.5 || !a.stairs ? a.floor : b.floor, k };
    }
  }
  const p = points[points.length - 1];
  return { x: p.x, z: p.z, floor: p.floor, k: points.length - 1 };
}

/** Where the path next changes floor (s of the stairs' start), after s; Infinity: never. */
function nextStairsAfter(path, s) {
  for (const p of path.points) if (p.stairs && p.s + p.len > s) return p.s;
  return Infinity;
}

/** The nearest point of a (turned) rectangle to (x, z). */
function nearestOnRect(o, x, z) {
  const c = Math.cos(o.rot ?? 0);
  const sn = Math.sin(o.rot ?? 0);
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = Math.max(-o.hw, Math.min(o.hw, dx * c - dz * sn));
  const lz = Math.max(-o.hd, Math.min(o.hd, dx * sn + dz * c));
  // back to world (inverse of the rotation above)
  return { x: o.x + lx * c + lz * sn, z: o.z - lx * sn + lz * c };
}

const itemsNear = (map, x, z, r) => (map?.obstacles ?? []).filter((o) => o.kind === 'item'
  && Math.abs(o.x - x) <= o.hw + o.hd + r && Math.abs(o.z - z) <= o.hw + o.hd + r);

/**
 * Can the body walk straight from a to b on this map, keeping `keep` from solid items (and the
 * map's own clearance from walls: every crossed cell FREE or STAIRS)?
 */
export function clearPath(map, a, b, keep = FURNITURE_CLEARANCE) {
  if (!map) return true;
  if (!cellsClear(map, a.x, a.z, b.x, b.z) && !cellsWalkable(map, a, b)) return false;
  const r = Math.hypot(b.x - a.x, b.z - a.z) + keep + 1;
  return itemsNear(map, (a.x + b.x) / 2, (a.z + b.z) / 2, r).every((o) => segmentToRect(o, a.x, a.z, b.x, b.z) >= keep - 1e-6);
}

/** Every 5 cm of a → b on a FREE or STAIRS cell (cellsClear only takes FREE: stairs, landings). */
function cellsWalkable(map, a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  for (let i = 0; i <= n; i++) {
    const v = map.at(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
    if (v !== FREE && v !== STAIRS) return false;
  }
  return true;
}

/**
 * Is the way tight between s and TIGHT_AHEAD further (up to `until`): somewhere the map is blocked
 * on BOTH sides of the route's line within TIGHT_SIDE (a door, a narrow aisle between desks)?
 */
export function tightAhead(map, path, s, until = path.length) {
  if (!map) return false;
  const blocked = (x, z) => map.at(x, z) === BLOCKED;
  const to = Math.min(until, s + TIGHT_AHEAD);
  for (let d = s; d <= to + 1e-9; d += 0.1) {
    const q = pointAt(path, d);
    const b = pointAt(path, Math.max(0, d - 0.1));
    const f = pointAt(path, Math.min(path.length, d + 0.1));
    const l = Math.hypot(f.x - b.x, f.z - b.z);
    if (l < 1e-6) continue;
    const nx = -(f.z - b.z) / l;
    const nz = (f.x - b.x) / l;
    if (blocked(q.x + nx * TIGHT_SIDE, q.z + nz * TIGHT_SIDE) && blocked(q.x - nx * TIGHT_SIDE, q.z - nz * TIGHT_SIDE)) return true;
  }
  return false;
}

/** How close (m) the body at (x, z) is to the nearest solid item (Infinity: none near). */
export function itemDistance(map, x, z) {
  let d = Infinity;
  for (const o of itemsNear(map, x, z, 1)) d = Math.min(d, distanceToRect(o, x, z));
  return d;
}

/** How far a point is from the nearest wall or item of the map (m; Infinity: nothing within 1.5 m). */
export function obstacleDistance(map, x, z) {
  let d = Infinity;
  for (const o of map?.obstacles ?? []) {
    if (o.kind === 'stairs') continue; // you walk ONTO it from its landing; the cells around it keep the body off its sides
    if (Math.abs(o.x - x) > o.hw + o.hd + 1.5 || Math.abs(o.z - z) > o.hw + o.hd + 1.5) continue;
    d = Math.min(d, distanceToRect(o, x, z));
  }
  return d;
}

/**
 * Follow a route.
 * @param {import('./route').Route} route
 * @param {{ mapFor?: (floor: number) => any, speed?: number, arriveWithin?: number, inGoalRoom?: (me) => boolean }} [options]
 *   mapFor: the walk map of a floor (steering keeps clear of furniture; none: the route's own line);
 *   inGoalRoom: arrived only once this is true too (in the goal's room: not 1 m short of it, in its doorway)
 */
export function createFollower(route, options = {}) {
  const { mapFor = () => null, speed: walkSpeed = AUTO_SPEED, arriveWithin = ARRIVE_WITHIN, inGoalRoom = () => true } = options;
  const path = routePath(route);
  const end = path.points[path.points.length - 1];
  let s = 0;          // progress along the path (m)
  let k = 0;          // the segment we're on
  let windowTime = 0; // stuck check: time and progress since the window started
  let windowS = 0;

  /** Restart the stuck check (after a pause: standing still then is not being stuck). */
  const resetStuck = () => { windowTime = 0; windowS = s; };

  function locate(me) {
    // near the segment we were on first (no jumping ahead to a later bit of the route nearby),
    // anywhere on this floor if we are far from it (walked away, or a staircase taken)
    let p = projectOnPath(path, me.x, me.z, me.floor, k - 1, k + 4);
    if (!p || p.dist > 1.5) {
      const any = projectOnPath(path, me.x, me.z, me.floor);
      if (any && (!p || any.dist < p.dist - 0.5)) p = any;
    }
    return p;
  }

  return {
    path,
    get length() { return path.length; },
    get progress() { return s; },
    resetStuck,

    /**
     * One frame: where to go. `me`: { x, z, floor, yaw }; `dt` seconds; `drive`: false for Show route
     * (progress, arrival and off-route only, no stuck check).
     */
    step(me, dt, { drive = true } = {}) {
      const p = locate(me);
      const offBy = p ? p.dist : Infinity;
      if (p && p.s >= s - 1) { s = Math.max(s, p.s); k = p.k; }
      const remaining = Math.max(0, path.length - s);
      const toEnd = Math.hypot(end.x - me.x, end.z - me.z);
      const arrived = me.floor === end.floor && (toEnd <= arriveWithin && inGoalRoom(me) || toEnd <= 0.15);
      const out = {
        dirX: 0, dirZ: 0, speed: 0, yaw: me.yaw, s, remaining: arrived ? 0 : Math.max(remaining, toEnd),
        offRoute: offBy > OFF_ROUTE, offBy, arrived, stuck: false, onStairs: !!path.points[k]?.stairs, floor: me.floor,
      };
      if (arrived || !drive || !p) return out;

      // aim: the furthest point ahead that can be walked to straight and clear of furniture
      const map = mapFor(me.floor);
      const here = { x: me.x, z: me.z };
      const stairsAt = nextStairsAfter(path, s);
      const onStairs = out.onStairs;
      // before a staircase, aim at its start; on it, at its far end (straight up or down)
      const cap = onStairs || stairsAt - s < 0.25 ? Infinity : stairsAt; // at its foot: up it
      const near = itemDistance(map, me.x, me.z);
      const keep = Math.min(FURNITURE_CLEARANCE, near);
      let target = null;
      // A tight spot ahead (a door, a narrow aisle): the route's own line, closely (it keeps the body
      // + 2 cm from every wall and item; cutting a corner into a 1 m door hits its frame)
      const tight = !onStairs && tightAhead(map, path, s, Math.min(cap, path.length));
      if (tight) target = pointAt(path, Math.min(s + TIGHT_LOOK, cap, path.length));
      // on the route first (the longest look-ahead that works), then a little to either side of it,
      // where the map has room (stepping round a desk corner the route grazes)
      search: for (const off of tight || onStairs ? [] : SIDE_STEPS) {
        for (const look of LOOK_STEPS) {
          const at = Math.min(s + look, cap, path.length);
          let q = pointAt(path, at);
          if (off) {
            const b = pointAt(path, Math.max(0, at - 0.3));
            const f = pointAt(path, Math.min(path.length, at + 0.3));
            const l = Math.hypot(f.x - b.x, f.z - b.z);
            if (l < 1e-6) continue;
            q = { ...q, x: q.x - ((f.z - b.z) / l) * off, z: q.z + ((f.x - b.x) / l) * off };
            if (!map?.isClear(q.x, q.z)) continue;
          }
          if (Math.hypot(q.x - me.x, q.z - me.z) < 0.05) continue;
          if (onStairs || clearPath(map, here, q, keep)) { target = q; break search; }
        }
      }
      if (!target && onStairs) target = pointAt(path, Math.min(s + STAIR_LOOK, path.length));
      if (!target) target = pointAt(path, Math.min(s + MIN_LOOK, cap, path.length)); // the route itself
      let dx = target.x - me.x;
      let dz = target.z - me.z;
      // the route's own line, if the body has drifted off it: back towards it as well as along
      // (in a tight spot at once and firmly)
      if (offBy > (tight ? 0.02 : 0.3) && !onStairs) {
        const back = pointAt(path, s);
        const pull = tight ? 2.5 : 0.8;
        dx += (back.x - me.x) * pull;
        dz += (back.z - me.z) * pull;
      }
      let len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // a little push away from furniture closer than FURNITURE_CLEARANCE (not where it is tight:
      // the route's line is the way through there)
      if (!onStairs && !tight && map) {
        let px = 0;
        let pz = 0;
        for (const o of itemsNear(map, me.x, me.z, FURNITURE_CLEARANCE)) {
          const d = distanceToRect(o, me.x, me.z);
          if (d >= FURNITURE_CLEARANCE || d <= 1e-6) continue;
          const n = nearestOnRect(o, me.x, me.z);
          const w = Math.min(1, (FURNITURE_CLEARANCE - d) / 0.1) * 0.5;
          px += ((me.x - n.x) / d) * w;
          pz += ((me.z - n.z) / d) * w;
        }
        // never against the way: only the part across it (keeps going forward)
        const along = px * dx + pz * dz;
        if (along < 0) { px -= along * dx; pz -= along * dz; }
        dx += px; dz += pz;
        len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
      }

      // turn smoothly; walk slower while facing away from the way, near a sharp turn and at the end
      const want = headingOf(dx, dz);
      const yaw = turnTowards(me.yaw, want, TURN_RATE * dt);
      let speed = walkSpeed * Math.max(0.3, Math.cos(Math.min(Math.PI / 2, Math.abs(angleDiff(yaw, want)))));
      const ahead = pointAt(path, Math.min(s + CORNER_AHEAD, path.length));
      const far = pointAt(path, Math.min(s + CORNER_AHEAD * 2, path.length));
      const turn = Math.abs(angleDiff(headingOf(ahead.x - me.x, ahead.z - me.z), headingOf(far.x - ahead.x, far.z - ahead.z)));
      if (Math.hypot(far.x - ahead.x, far.z - ahead.z) > 0.2) speed *= 1 - 0.35 * Math.min(1, turn / (Math.PI / 2));
      if (me.floor === end.floor && toEnd < SLOW_END) speed = Math.min(speed, Math.max(MIN_SPEED, walkSpeed * (toEnd / SLOW_END)));
      if (tight) speed = Math.min(speed, TIGHT_SPEED, TIGHT_STEP / Math.max(dt, 1e-3));
      // a big step (a slow frame, the turn off the top of a flight) never ends closer to a wall or an item than
      // SAFE_CLEARANCE, nor closer than you are now if you are closer already: it is halved instead
      if (map && map.at(me.x, me.z) !== STAIRS) {
        const need = Math.min(SAFE_CLEARANCE, obstacleDistance(map, me.x, me.z));
        for (let i = 0; i < 4 && speed * dt > SAFE_STEP_MIN
          && obstacleDistance(map, me.x + dx * speed * dt, me.z + dz * speed * dt) < need; i++) speed /= 2;
      }

      // stuck: less than STUCK_PROGRESS along the route in STUCK_TIME
      windowTime += dt;
      let stuck = false;
      if (windowTime >= STUCK_TIME) {
        stuck = s - windowS < STUCK_PROGRESS;
        windowTime = 0;
        windowS = s;
      }
      return { ...out, dirX: dx, dirZ: dz, speed, yaw, stuck };
    },
  };
}

/**
 * The route line ahead of `s` on one floor: chevrons every `spacing` metres ({ x, z, yaw }, at most
 * `max`), and the markers: the stairs to take (the start of the next staircase on this floor) and
 * the goal (if it is on this floor).
 */
export function routeMarks(path, s, floor, { spacing = 1, max = 400 } = {}) {
  const chevrons = [];
  const markers = [];
  const { points } = path;
  const endS = path.length;
  // the bit of the path on this floor ahead of s, with the staircase leaving it
  let from = Infinity;
  let to = -Infinity;
  for (let k = 0; k < points.length - 1; k++) {
    if (!segmentOn(points, k, floor)) continue;
    const a = points[k];
    if (a.s + a.len < s) continue;
    from = Math.min(from, Math.max(s, a.s));
    to = Math.max(to, a.s + a.len);
  }
  if (from <= to) {
    // start on the next whole spacing (the chevrons don't slide along as you walk)
    for (let t = Math.ceil((from + 0.6) / spacing) * spacing; t <= to - 0.3 && chevrons.length < max; t += spacing) {
      const p = pointAt(path, t);
      const q = pointAt(path, Math.min(endS, t + 0.2));
      const b = pointAt(path, Math.max(0, t - 0.2));
      chevrons.push({ x: p.x, z: p.z, yaw: headingOf(q.x - b.x, q.z - b.z), stairs: !!points[p.k]?.stairs });
    }
  }
  for (const p of points) {
    if (p.stairs && p.floor === floor && p.s + p.len >= s) {
      markers.push({ kind: 'stairs', x: p.x, z: p.z });
      break;
    }
  }
  const end = points[points.length - 1];
  if (end && end.floor === floor) markers.push({ kind: 'goal', x: end.x, z: end.z });
  return { chevrons, markers };
}
