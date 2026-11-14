/**
 * arrivalView.js — v0.17.1: where the third-person camera goes when Take me there (or My desk) arrives, so the person
 * or place you came to is clearly in view and your own character doesn't hide it. PURE (plain { x, y, z } vectors).
 *
 * Arriving turns you to face the place, and the usual camera sits behind you (on a phone, or near a wall, straight
 * behind your head): the place was right behind your body (Kavya at reception, in the v0.17.1 review). So the camera
 * goes to a raised spot over a shoulder and looks AT the place. It tries spots one by one (SPOTS_WIDE / SPOTS_NARROW:
 * a portrait phone keeps its spots nearer the middle, or you would be off the side of the view) and takes the first
 * one that (1) walls don't push closer than MIN_DISTANCE to your eye (the camera is pulled in front of a wall, as
 * the usual camera), (2) has nothing between it and the place (a cast up to TARGET_MARGIN short of it: the person's own
 * desk and chair don't count) and (3) whose line to the place misses your body: at least BODY_CLEAR from your torso's
 * middle line (feet to shoulders) and HEAD_CLEAR from your head's middle. None fits: the spot that passes furthest from
 * your body, and your character is hidden there (`hideCharacter`), so the place is never covered.
 */

/** How long the camera takes to get there, and back when you move or turn (s). */
export const ARRIVAL_EASE_S = 0.6;
/** The line from the camera to the place passes at least this far from your torso's middle line (m), and HEAD_CLEAR
 * from your head's middle. */
export const BODY_CLEAR = 0.4;
export const HEAD_CLEAR = 0.25;
/** The cast towards the place stops this far short of it (m): what stands right by it (a desk, a chair) doesn't count. */
export const TARGET_MARGIN = 0.7;
/** A spot that walls pull in closer than this to your eye (m) isn't used. */
export const MIN_DISTANCE = 1.0;
/** The camera stays this far in front of a wall it was pulled in by (m), as the usual third-person camera. */
const WALL_GAP = 0.25;
/** Your shoulders below your eye, and your head's middle above it (m). */
const SHOULDERS_BELOW_EYE = 0.15;
const HEAD_ABOVE_EYE = 0.05;

/** Candidate spots from your eye: `side` m to your right (negative: left), `back` m behind, `up` m higher. */
export const SPOTS_WIDE = [
  { side: 1.0, back: 2.0, up: 0.7 }, { side: -1.0, back: 2.0, up: 0.7 },
  { side: 1.3, back: 1.5, up: 0.9 }, { side: -1.3, back: 1.5, up: 0.9 },
  { side: 0.6, back: 2.4, up: 1.1 }, { side: -0.6, back: 2.4, up: 1.1 },
  { side: 1.5, back: 0.9, up: 0.6 }, { side: -1.5, back: 0.9, up: 0.6 },
  { side: 0, back: 2.2, up: 1.3 },
];
export const SPOTS_NARROW = [
  { side: 0.55, back: 2.2, up: 1.1 }, { side: -0.55, back: 2.2, up: 1.1 },
  { side: 0.85, back: 1.8, up: 1.1 }, { side: -0.85, back: 1.8, up: 1.1 },
  { side: 0.3, back: 2.4, up: 1.4 }, { side: -0.3, back: 2.4, up: 1.4 },
  { side: 1.2, back: 1.3, up: 0.8 }, { side: -1.2, back: 1.3, up: 0.8 },
  { side: 0, back: 2.2, up: 1.4 },
];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);

/** The shortest distance between the segments p1–q1 and p2–q2 (3D). */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-9;
  let s;
  let t;
  if (a <= EPS && e <= EPS) return len(r);
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return len(sub(add(p1, scale(d1, s)), add(p2, scale(d2, t))));
}

/**
 * The arrival camera.
 * @param {object} p
 * @param {{x,y,z}} p.eye     your character's eye
 * @param {number}  p.feetY   your feet (world y)
 * @param {{x,y,z}} p.target  the point to look at (a person's chest / head, a place's middle)
 * @param {number|null} p.ceiling  indoors: the highest the camera may be (world y), else null
 * @param {boolean} [p.narrow]  a portrait view (a phone): SPOTS_NARROW
 * @param {(from, to) => number|null} p.cast  the first wall / item between two points: its distance from `from`
 * @returns {{ position: {x,y,z}, hideCharacter: boolean, clearance: number, spot: number }}
 *   clearance: how far the line misses your body (≥ 1: clear)
 *   spot: which candidate (-1: none was clear of walls: straight behind you, raised)
 */
export function arrivalCamera({ eye, feetY, target, ceiling = null, narrow = false, cast }) {
  // facing the place: forward = level, from you to it (your yaw may be a little off it)
  let fx = target.x - eye.x;
  let fz = target.z - eye.z;
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) { fx = 0; fz = 1; } else { fx /= fl; fz /= fl; }
  const forward = { x: fx, y: 0, z: fz };
  const right = { x: fz, y: 0, z: -fx }; // Babylon: x right, z forward (left-handed)
  const bodyLow = { x: eye.x, y: feetY + 0.1, z: eye.z };
  const bodyHigh = { x: eye.x, y: eye.y - SHOULDERS_BELOW_EYE, z: eye.z };
  const head = { x: eye.x, y: eye.y + HEAD_ABOVE_EYE, z: eye.z };
  /** How far the line misses your body, in BODY_CLEAR units (≥ 1: clear of the torso and the head). */
  const missBy = (from) => Math.min(
    segmentDistance(from, target, bodyLow, bodyHigh) / BODY_CLEAR,
    segmentDistance(from, target, head, head) / HEAD_CLEAR,
  );
  const toward = (from, to, d) => {
    const v = sub(to, from);
    const l = len(v) || 1;
    return add(from, scale(v, d / l));
  };
  const spots = narrow ? SPOTS_NARROW : SPOTS_WIDE;
  let best = null;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    let want = add(add(add(eye, scale(forward, -s.back)), scale(right, s.side)), { x: 0, y: s.up, z: 0 });
    if (ceiling !== null && ceiling !== undefined && want.y > ceiling) want = { ...want, y: Math.max(eye.y, ceiling) };
    const hit = cast(eye, want);
    const position = hit !== null && hit !== undefined ? toward(eye, want, Math.max(0, hit - WALL_GAP)) : want;
    if (len(sub(position, eye)) < MIN_DISTANCE) continue;
    const toTarget = len(sub(target, position));
    const short = toTarget > TARGET_MARGIN ? toward(position, target, toTarget - TARGET_MARGIN) : position;
    const blocked = toTarget > TARGET_MARGIN && cast(position, short);
    const clearance = missBy(position);
    if (!(blocked !== null && blocked !== undefined && blocked !== false) && clearance >= 1) {
      return { position, hideCharacter: false, clearance, spot: i };
    }
    if (!best || clearance > best.clearance) best = { position, clearance, spot: i };
  }
  if (best) return { position: best.position, hideCharacter: best.clearance < 1, clearance: best.clearance, spot: best.spot };
  // walls all round: just behind and above you, your character hidden
  const position = add(eye, { x: -forward.x * 0.6, y: 0.3, z: -forward.z * 0.6 });
  return { position, hideCharacter: true, clearance: 0, spot: -1 };
}
