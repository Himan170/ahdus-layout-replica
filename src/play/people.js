/**
 * play/people.js
 *
 * PURE maths and data for people at their desks (engine/systems/CharacterSystem):
 * which chair belongs to a desk (deskSeat), where a person sits or stands
 * (seatPose), bone names of character files (Mixamo, and Unreal-style rigs
 * such as Victoria's) and the pose tables, and which people are drawn as full
 * characters (chooseFullCharacters; everyone else is a simple figure).
 * No Babylon. Tests: play/__tests__/people.test.js.
 */

import { elevationOf } from './building';

// ── Desks and chairs ──

/** Desk footprints (m, unscaled), as utils/assetCatalog.js builds them (a test checks they match). */
export const DESK_SIZES = {
  DESK_STANDARD: { width: 1.6, depth: 0.8 },
  DESK_CORNER: { width: 2.4, depth: 2.4 },
  RECEPTION_DESK: { width: 2.5, depth: 0.85 },
};

/** How far from the desk's edge its chair may stand (m). */
export const SEAT_REACH = 1.2;
/** A chair "faces" the desk within this angle (60°). */
const FACING_MIN = Math.cos(Math.PI / 3);
/** Seat height of an office chair (m above its floor). */
export const SEAT_HEIGHT = 0.46;
/** Standing at a desk with no chair: this far from its edge (m), on its work side (DESK_WORK_SIDE). */
export const STAND_GAP = 0.35;
/**
 * The side of a desk its person works at, in its own frame (+1 = local +Z,
 * −1 = local −Z): where its chair would be. Desks: +Z (as the sample layouts
 * put their chairs); the reception desk: −Z, behind the counter (visitors
 * come to its +Z side, where its raised front and its reception anchor are).
 */
export const DESK_WORK_SIDE = { DESK_STANDARD: 1, DESK_CORNER: 1, RECEPTION_DESK: -1 };

/** A visitor at a reception desk stands this far in front of its counter (m): the body clear of it. */
export const COUNTER_GAP = 0.45;

export const isDesk = (type) => Object.hasOwn(DESK_SIZES, type ?? '');
export const isChair = (type) => typeof type === 'string' && type.startsWith('CHAIR');

const list = (objects) => (Array.isArray(objects) ? objects : Object.values(objects ?? {}));
const floorOf = (o) => o.floor ?? 0;

/** (x, z) in an object's own frame (+Z = the way it faces). */
function toLocal(obj, x, z) {
  const c = Math.cos(obj.rotationY ?? 0);
  const s = Math.sin(obj.rotationY ?? 0);
  const dx = x - obj.x;
  const dz = z - obj.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** A local (x, z) of an object in world space (anchors.ts uses the same rotation). */
function toWorld(obj, lx, lz) {
  const c = Math.cos(obj.rotationY ?? 0);
  const s = Math.sin(obj.rotationY ?? 0);
  return { x: obj.x + lx * c + lz * s, z: obj.z - lx * s + lz * c };
}

function halfSize(desk) {
  const size = DESK_SIZES[desk.assetType];
  return { w: (size.width * Math.abs(desk.scaleX ?? 1)) / 2, d: (size.depth * Math.abs(desk.scaleZ ?? 1)) / 2 };
}

/**
 * How well a chair fits a desk: lower is better, null = not its chair. The
 * chair stands at most SEAT_REACH from the desk's edge (or under it) and
 * faces it (within 60°).
 */
export function seatScore(desk, chair) {
  if (floorOf(desk) !== floorOf(chair)) return null;
  const { w, d } = halfSize(desk);
  const p = toLocal(desk, chair.x, chair.z);
  // the nearest point of the desk's footprint (its centre if the chair is under it)
  const nx = Math.max(-w, Math.min(w, p.x));
  const nz = Math.max(-d, Math.min(d, p.z));
  const inside = nx === p.x && nz === p.z;
  const gap = Math.hypot(p.x - nx, p.z - nz);
  if (gap > SEAT_REACH) return null;
  const to = inside ? { x: -p.x, z: -p.z } : { x: nx - p.x, z: nz - p.z };
  const len = Math.hypot(to.x, to.z);
  // the chair's forward in the desk's frame
  const turn = (chair.rotationY ?? 0) - (desk.rotationY ?? 0);
  const facing = len < 1e-6 ? 1 : (Math.sin(turn) * to.x + Math.cos(turn) * to.z) / len;
  if (facing < FACING_MIN) return null;
  return gap + 0.5 * (1 - facing);
}

/**
 * Which chair belongs to which desk, for every desk: a chair goes to the desk
 * it fits best, and a desk takes the best of the chairs that chose it.
 * @returns {Map<string, object>} deskId → chair
 */
export function deskSeats(objects) {
  const all = list(objects);
  const desks = all.filter((o) => isDesk(o.assetType));
  const chairs = all.filter((o) => isChair(o.assetType));
  const best = new Map(); // deskId → { chair, score }
  for (const chair of chairs) {
    let mine = null;
    for (const desk of desks) {
      // cheap check first: no desk is bigger than 2.5 m across
      if (Math.abs(desk.x - chair.x) > 4 || Math.abs(desk.z - chair.z) > 4) continue;
      const score = seatScore(desk, chair);
      if (score !== null && (!mine || score < mine.score)) mine = { desk, score };
    }
    if (!mine) continue;
    const had = best.get(mine.desk.id);
    if (!had || mine.score < had.score) best.set(mine.desk.id, { chair, score: mine.score });
  }
  return new Map([...best].map(([deskId, { chair }]) => [deskId, chair]));
}

/** The chair that belongs to a desk (within SEAT_REACH in front, facing it), or null. */
export function deskSeat(desk, objects) {
  if (!desk || !isDesk(desk.assetType)) return null;
  return deskSeats(list(objects).filter((o) => o.id === desk.id || floorOf(o) === floorOf(desk))).get(desk.id) ?? null;
}

/**
 * Where a person at this desk is, in world space: seated on its chair, else
 * standing on its work side (where a chair would be, turned with the desk),
 * facing it. `seats` (deskSeats) saves the search
 * when there are many people.
 * @param {string} deskId
 * @param {object[] | Record<string, object>} objects
 * @param {Record<string | number, object>} floors
 * @param {Map<string, object> | null} [seats]
 * @returns {{ deskId, chairId: string | null, seated: boolean, floor: number,
 *   x: number, y: number, z: number, yaw: number, seatHeight: number } | null}
 *   y = the floor under them (world); null if there is no such desk
 */
export function seatPose(deskId, objects, floors, seats = null) {
  const all = Array.isArray(objects) ? null : objects;
  const desk = all ? all[deskId] : list(objects).find((o) => o.id === deskId);
  if (!desk || !isDesk(desk.assetType)) return null;
  const floor = floorOf(desk);
  const chair = seats ? seats.get(deskId) ?? null : deskSeat(desk, objects);
  const elevation = elevationOf(floors, floor);
  if (chair) {
    return {
      deskId, chairId: chair.id, seated: true, floor,
      x: chair.x, y: elevation + (chair.y ?? 0), z: chair.z, yaw: chair.rotationY ?? 0,
      seatHeight: SEAT_HEIGHT * Math.abs(chair.scaleY ?? 1),
    };
  }
  const { d } = halfSize(desk);
  const side = DESK_WORK_SIDE[desk.assetType];
  const at = toWorld(desk, 0, side * (d + STAND_GAP));
  // facing the desk: its own −Z from the +Z side, its +Z from the −Z side
  const yaw = (desk.rotationY ?? 0) + (side > 0 ? Math.PI : 0);
  return {
    deskId, chairId: null, seated: false, floor,
    x: at.x, y: elevation + (desk.y ?? 0), z: at.z, yaw, seatHeight: 0,
  };
}

/**
 * Where a visitor stands at a desk that has a front for visitors (the reception desk): the side opposite its
 * person (DESK_WORK_SIDE), COUNTER_GAP from the counter, in the middle; turned with the desk. Null for other desks.
 */
export function visitorSpot(desk) {
  if (desk?.assetType !== 'RECEPTION_DESK') return null;
  const { d } = halfSize(desk);
  return toWorld(desk, 0, -DESK_WORK_SIDE[desk.assetType] * (d + COUNTER_GAP));
}

/**
 * The person nearest to a point on a floor (hover, walking up to a desk), or
 * null if nobody is within `radius` (m, horizontally).
 * @param {{ personId: string, floor: number, x: number, z: number }[]} placed
 */
export function personNear(placed, point, floor, radius) {
  let found = null;
  let bestD = radius;
  for (const p of placed) {
    if (p.floor !== floor) continue;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d <= bestD) { bestD = d; found = p; }
  }
  return found;
}

// ── Full characters or simple figures ──

/** At most this many full characters at once; everyone else is a simple figure. */
export const MAX_FULL_CHARACTERS = 12;
/** Full characters only this near the camera (m)… */
export const FULL_RADIUS = 15;
/** …and they stay full until this far (so walking past doesn't swap them back and forth). */
export const KEEP_RADIUS = 18;

/**
 * Who is drawn as a full character: people with a character file, on the
 * current floor, within FULL_RADIUS of the camera (KEEP_RADIUS for those full
 * already), the nearest first, at most MAX_FULL_CHARACTERS.
 * @param {{ personId: string, floor: number, x: number, y: number, z: number, character?: object | null }[]} people
 * @param {{ x: number, y: number, z: number }} camera
 * @param {number} floor
 * @param {{ max?: number, radius?: number, keepRadius?: number, current?: Iterable<string> }} [options]
 * @returns {string[]} personIds, nearest first
 */
export function chooseFullCharacters(people, camera, floor, options = {}) {
  const { max = MAX_FULL_CHARACTERS, radius = FULL_RADIUS, keepRadius = KEEP_RADIUS } = options;
  const current = new Set(options.current ?? []);
  const near = [];
  for (const p of people) {
    if (p.floor !== floor || !p.character?.url) continue;
    const d = Math.hypot(p.x - camera.x, (p.y ?? 0) - camera.y, p.z - camera.z);
    if (d <= (current.has(p.personId) ? keepRadius : radius)) near.push({ id: p.personId, d });
  }
  near.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return near.slice(0, Math.max(0, max)).map((n) => n.id);
}

// ── Bone names ──

/** Mixamo's prefix ("mixamorig:", "mixamorig4:", "mixamorig_") taken off: "mixamorig4:Hips" → "Hips". */
export function normaliseBoneName(name) {
  return String(name ?? '').replace(/^mixamorig\d*[:_]?/, '');
}

/**
 * The body bones the poses use: [Mixamo name, Unreal-style name] (Victoria's
 * rig: pelvis, spine_01, thigh_l, …). One table for both directions.
 */
export const BONE_TABLE = [
  ['Hips', 'pelvis'],
  ['Spine', 'spine_01'],
  ['Spine1', 'spine_02'],
  ['Spine2', 'spine_03'],
  ['Neck', 'neck_01'],
  ['Head', 'head'],
  ['LeftShoulder', 'clavicle_l'],
  ['LeftArm', 'upperarm_l'],
  ['LeftForeArm', 'lowerarm_l'],
  ['LeftHand', 'hand_l'],
  ['RightShoulder', 'clavicle_r'],
  ['RightArm', 'upperarm_r'],
  ['RightForeArm', 'lowerarm_r'],
  ['RightHand', 'hand_r'],
  ['LeftUpLeg', 'thigh_l'],
  ['LeftLeg', 'calf_l'],
  ['LeftFoot', 'foot_l'],
  ['LeftToeBase', 'ball_l'],
  ['RightUpLeg', 'thigh_r'],
  ['RightLeg', 'calf_r'],
  ['RightFoot', 'foot_r'],
  ['RightToeBase', 'ball_r'],
];

const UE_TO_MIXAMO = new Map(BONE_TABLE.map(([mixamo, ue]) => [ue, mixamo]));
const MIXAMO_BONES = new Set(BONE_TABLE.map(([mixamo]) => mixamo));

/**
 * A bone's Mixamo name ('Hips', 'LeftArm', …) in a file with this rig, or null
 * if the poses don't use it. 'mixamo': the prefix is taken off; 'ue': the
 * Unreal-style name is looked up (case doesn't matter).
 * @param {string} name
 * @param {'mixamo' | 'ue'} rig
 */
export function canonicalBoneName(name, rig = 'mixamo') {
  if (rig === 'ue') return UE_TO_MIXAMO.get(String(name ?? '').toLowerCase()) ?? null;
  const n = normaliseBoneName(name);
  return MIXAMO_BONES.has(n) ? n : null;
}

// ── Poses ──

/**
 * A pose = where bones point, in the character's frame (+Y up, +Z the way
 * they face). Each entry aims `bone` so that `toward` (a bone further down
 * the chain) lies in direction `dir`; dir[0] > 0 is "outwards" (to the
 * bone's own side, so one entry serves Left and Right). Parents come first.
 */
const sides = (entries) => entries.flatMap(([bone, toward, dir]) => (bone.includes('*')
  ? ['Left', 'Right'].map((side) => [bone.replace('*', side), toward.replace('*', side), dir])
  : [[bone, toward, dir]]));

export const SEATED_POSE = sides([
  ['Spine', 'Spine1', [0, 1, 0.12]],
  ['Spine1', 'Spine2', [0, 1, 0.12]],
  ['Spine2', 'Neck', [0, 1, 0.1]],
  ['Neck', 'Head', [0, 1, 0.08]],
  ['*UpLeg', '*Leg', [0.12, -0.05, 1]],
  ['*Leg', '*Foot', [0.02, -1, 0.08]],
  ['*Foot', '*ToeBase', [0, -0.35, 1]],
  ['*Arm', '*ForeArm', [0.25, -0.8, 0.45]],
  ['*ForeArm', '*Hand', [-0.2, 0.05, 1]],
]);

export const STANDING_POSE = sides([
  ['Spine', 'Spine1', [0, 1, 0]],
  ['*Arm', '*ForeArm', [0.15, -1, 0]],
  ['*ForeArm', '*Hand', [0.06, -1, 0.18]],
]);

/** Seated: the hips sit this far above the seat and this far behind its centre (m, for a 1.75 m person). */
export const HIPS_ABOVE_SEAT = 0.1;
export const HIPS_BEHIND_SEAT = 0.08;

/** A slow breathing sway (radians about the side axis) at time t (s); phase per person. */
export function breathing(t, phase = 0) {
  return 0.025 * Math.sin((t * 2 * Math.PI) / 4.5 + phase);
}

/** A stable number 0…2π for a person (so neighbours don't breathe in step). */
export function phaseOf(personId) {
  let h = 0;
  for (const ch of String(personId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6283) / 1000;
}

// ── Walking as yourself (walkthrough: engine/systems/PlayerCharacter.ts) ──

/** The eye is this far up a person's height (Preview's figure: 1.62 m of 1.75 m). */
export const EYE_RATIO = 1.62 / 1.75;

/** Where the walkthrough camera sits for a person this tall (m). */
export function playerEyeHeight(height) {
  const h = Number(height);
  return +((Number.isFinite(h) && h > 0 ? h : 1.75) * EYE_RATIO).toFixed(3);
}

/** Slower than this (m/s) the character stands instead of walking. */
export const WALK_MIN_SPEED = 0.3;
/** The walk clip plays at most this much faster / slower than its own speed. */
export const MIN_WALK_RATIO = 0.25;
export const MAX_WALK_RATIO = 6;

/**
 * How fast to play the walk clip so the feet keep up with the ground:
 * walking `speed` m/s with a clip that walks `clipSpeed` m/s at its own speed.
 */
export function walkRatio(speed, clipSpeed) {
  if (!(clipSpeed > 0) || !(speed > 0)) return 1;
  return Math.min(MAX_WALK_RATIO, Math.max(MIN_WALK_RATIO, speed / clipSpeed));
}

/** A clip moving its hips at least this far forward over one cycle has root motion (m, the clip's size). */
export const ROOT_MOTION_MIN = 0.2;

/**
 * How fast a walk clip walks at its own speed (m/s, the clip's size): its
 * root motion over the cycle if it has some (`hipsTravel`), else from its
 * steps: in one cycle (two steps) each foot sweeps back one step length
 * (`footRange`, the foot's forward range relative to the hips).
 * @param {{ duration: number, hipsTravel: number, footRange: number }} clip
 */
export function clipSpeed({ duration, hipsTravel, footRange }) {
  if (!(duration > 0)) return 0;
  if (Math.abs(hipsTravel) >= ROOT_MOTION_MIN) return Math.abs(hipsTravel) / duration;
  return footRange > 0 ? (2 * footRange) / duration : 0;
}
