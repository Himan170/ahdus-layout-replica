/**
 * play/building.js
 *
 * Pure maths for multi-storey buildings (no Babylon imports, unit-tested):
 *   - floors: each has a floor-to-floor HEIGHT; elevations are derived from them
 *   - wall heights and floor heights that always fit together (no gaps, no overlaps)
 *   - staircases: size from the floor's height, the walkable slope, the opening they need above
 *   - where the character stands (room floor, ground or stairs)
 *   - cutting openings out of rectangles (stairwells in floors, ceilings and roofs)
 *   - rooms lining up between floors: covered by the floor above, overhanging the floor below
 *
 * Conventions (same as play/geometry.js):
 *   - rooms {x, z, width, depth} are centred; width along X, depth along Z
 *   - object rotationY rotates local +Z to (sin θ, cos θ) in the world (Babylon, left-handed)
 *   - object y is measured from ITS floor; world y = floor elevation + y
 *
 * A storey, bottom to top: the floor slab (SLAB thick, under the rooms of
 * upper floors), the room floor at the floor's elevation, then the walls.
 * A room's walls fill its floor (wallHeight = floor height − SLAB) unless the
 * room was made lower on purpose. Floors stack in id order (ground = 0).
 */

import { roomOpenings, wallThicknessOf } from './geometry';

/** Floor-to-floor height of a new floor (metres). */
export const STOREY_HEIGHT = 3.5;

/** Thickness of the floor slab between two storeys. */
export const SLAB = 0.3;

/** The walls of a new room fill a standard floor. */
export const DEFAULT_WALL_HEIGHT = STOREY_HEIGHT - SLAB;

/** Limits for wall heights, and the floor heights they need (15 m: factory halls). */
export const MIN_WALL_HEIGHT = 2;
export const MAX_WALL_HEIGHT = 15;
export const MIN_FLOOR_HEIGHT = MIN_WALL_HEIGHT + SLAB;
export const MAX_FLOOR_HEIGHT = MAX_WALL_HEIGHT + SLAB;

/** One + / − press on a wall height (metres). */
export const HEIGHT_STEP = 0.1;

/** Stair steps are at most this high; the number of steps follows from the rise. */
export const MAX_STEP = 0.2;

/**
 * Size of a staircase that climbs `rise` metres: one straight flight,
 * 1.2 × 4.0 m, with as few steps as keep each one at most MAX_STEP high.
 */
export function stairDims(rise = STOREY_HEIGHT) {
  return { width: 1.2, length: 4.0, rise, steps: Math.max(1, Math.ceil(rise / MAX_STEP - 1e-9)) };
}

/** A staircase on a standard floor (catalog size, tests). */
export const STAIR = stairDims(STOREY_HEIGHT);

/**
 * A staircase is one 4 m flight whatever the floor height: above this floor
 * height (the old 6 m walls + SLAB) it gets steeper than ~58°.
 */
export const STEEP_STAIRS_ABOVE = 6.3;

/** "Stairs here would be very steep (9.3 m in one 4 m flight)" for a floor this high, or null. */
export function steepStairsText(height) {
  if (!(height > STEEP_STAIRS_ABOVE + 1e-6)) return null;
  return `Stairs here would be very steep (${height.toFixed(1)} m in one ${STAIR.length.toFixed(0)} m flight)`;
}

/** How high the character can step up without jumping (a stair step is at most 0.2 m). */
export const STEP_UP = 0.45;

const ROOM_FLOOR_OFFSET = 0.02; // room floors sit just above their floor's elevation
const EPS = 1e-6;
const cm = (v) => Math.round(v * 100) / 100;

// ── Floors ────────────────────────────────────────────────────────────────

/** Floors (store map or array) from the lowest to the highest (they stack in id order). */
export function floorsInOrder(floors) {
  return Object.values(floors ?? {}).sort((a, b) => a.id - b.id);
}

/** Old name, kept for callers: floors from the lowest to the highest. */
export const floorsByElevation = floorsInOrder;

/** Floor-to-floor height of a floor. */
export function floorHeight(floors, floorId) {
  const f = Object.values(floors ?? {}).find((x) => x.id === floorId);
  return typeof f?.height === 'number' && Number.isFinite(f.height) ? f.height : STOREY_HEIGHT;
}

/** World height of a floor: the heights of all floors below it added up (never stored). */
export function elevationOf(floors, floorId) {
  let e = 0;
  for (const f of floorsInOrder(floors)) {
    if (f.id === floorId) return cm(e);
    e += floorHeight(floors, f.id);
  }
  return 0;
}

/** How tall walls on this floor can be: up to the slab of the floor above. */
export function wallSpace(floors, floorId) {
  return cm(floorHeight(floors, floorId) - SLAB);
}

/**
 * True for the ground floor (the lowest one). It can't be deleted: every floor
 * above would drop a storey, and saves always have a ground floor with id 0.
 */
export function isGroundFloor(floors, floorId) {
  return floorsInOrder(floors)[0]?.id === floorId;
}

/** Why the ground floor's Delete is disabled. */
export const GROUND_FLOOR_STAYS = "The ground floor can't be deleted. Remove its rooms instead";

/** The floor directly above / below, or null. */
export function floorAbove(floors, floorId) {
  const sorted = floorsInOrder(floors);
  const i = sorted.findIndex((f) => f.id === floorId);
  return i >= 0 ? sorted[i + 1] ?? null : null;
}

export function floorBelow(floors, floorId) {
  const sorted = floorsInOrder(floors);
  const i = sorted.findIndex((f) => f.id === floorId);
  return i > 0 ? sorted[i - 1] : null;
}

/**
 * A floor's place counted from the ground (1 = lowest), how many there are, and
 * its own name (what the HUDs show: "Floor 1 of 2" read wrong next to a floor
 * named "Floor 1"). A floor with no name: "Ground Floor" for the lowest, else "Floor <id>".
 */
export function floorPosition(floors, floorId) {
  const sorted = floorsInOrder(floors);
  const i = Math.max(0, sorted.findIndex((f) => f.id === floorId));
  const own = sorted[i]?.name;
  const name = typeof own === 'string' && own.trim() ? own : i === 0 ? 'Ground Floor' : `Floor ${floorId}`;
  return { index: i + 1, count: sorted.length, name };
}

/**
 * Which floor someone at height `y` is on: the highest floor at or below them.
 * `lead` switches to the next floor a little before reaching it (near the top of the stairs).
 */
export function levelForY(floors, y, lead = 1.0) {
  const sorted = floorsInOrder(floors);
  let level = sorted[0] ?? null;
  for (const f of sorted) {
    if (elevationOf(floors, f.id) <= y + lead) level = f;
  }
  return level?.id ?? 0;
}

// ── Wall and floor heights ────────────────────────────────────────────────

/** True if a room's walls reach the slab of the floor above (its floor is `height` tall). */
export function fillsFloor(room, height) {
  return Math.abs((room.wallHeight ?? DEFAULT_WALL_HEIGHT) - (height - SLAB)) < 0.005;
}

/** Why a room's doors/windows don't fit under walls this high, or null. */
function openingsProblem(room, wallHeight) {
  // a full-height glass panel follows its wall (v0.18.1)
  const tooHigh = roomOpenings(room).find((o) => o.style !== 'panel' && o.top > wallHeight - 0.1 + EPS);
  if (!tooHigh) return null;
  return `The ${tooHigh.kind} in ${room.name ?? 'this room'} is too high for ${wallHeight.toFixed(1)} m walls`;
}

/**
 * Change a floor's height (floor-to-floor). Rooms whose walls filled the
 * floor follow it; rooms that would no longer fit get lower walls. The
 * floors above move with it by themselves (elevations are derived).
 *
 * @param {object}   floors  store floors
 * @param {object[]} rooms   all rooms
 * @param {number}   floorId
 * @param {number}   height  new floor height (metres)
 * @returns {{ problem: string } |
 *           { problem: null, floorId, height: number, rooms: [string, number][] }}
 *          rooms: [roomId, new wallHeight] for every room that changes
 */
export function planFloorHeight(floors, rooms, floorId, height) {
  const h = cm(height);
  if (!(h >= MIN_FLOOR_HEIGHT - EPS && h <= MAX_FLOOR_HEIGHT + EPS)) {
    return { problem: `Floors are ${MIN_FLOOR_HEIGHT.toFixed(1)} to ${MAX_FLOOR_HEIGHT.toFixed(1)} m high` };
  }
  const old = floorHeight(floors, floorId);
  const space = cm(h - SLAB);
  const changes = [];
  for (const r of rooms) {
    if ((r.floor ?? 0) !== floorId) continue;
    const wh = r.wallHeight ?? DEFAULT_WALL_HEIGHT;
    const next = fillsFloor(r, old) || wh > space + EPS ? space : wh;
    if (Math.abs(next - wh) < EPS) continue;
    const problem = openingsProblem(r, next);
    if (problem) return { problem };
    changes.push([r.id, next]);
  }
  return { problem: null, floorId, height: h, rooms: changes };
}

/**
 * Change the height of a room's walls. Lower is always fine (the floor stays
 * as it is). Higher than the floor allows raises the whole floor (floor
 * height = walls + SLAB), and the other rooms that filled it grow with it, so
 * no gap opens under the floor above.
 *
 * @returns {{ problem: string } |
 *           { problem: null, floorId, height: number, raised: boolean, wallHeight: number,
 *             rooms: [string, number][] }}
 *          height: the floor's height afterwards; rooms: [roomId, wallHeight] that change
 */
export function planWallHeight(floors, rooms, room, wallHeight) {
  const h = cm(wallHeight);
  if (h < MIN_WALL_HEIGHT - EPS) return { problem: `Walls are at least ${MIN_WALL_HEIGHT.toFixed(1)} m high` };
  if (h > MAX_WALL_HEIGHT + EPS) return { problem: `Walls are at most ${MAX_WALL_HEIGHT.toFixed(1)} m high` };
  const problem = openingsProblem(room, h);
  if (problem) return { problem };
  const floorId = room.floor ?? 0;
  const current = floorHeight(floors, floorId);
  if (h <= current - SLAB + EPS) {
    const same = Math.abs((room.wallHeight ?? DEFAULT_WALL_HEIGHT) - h) < EPS;
    return { problem: null, floorId, height: current, raised: false, wallHeight: h, rooms: same ? [] : [[room.id, h]] };
  }
  const plan = planFloorHeight(floors, rooms, floorId, h + SLAB);
  if (plan.problem) return plan;
  const others = plan.rooms.filter(([id]) => id !== room.id);
  return { ...plan, raised: true, wallHeight: h, rooms: [[room.id, h], ...others] };
}

/**
 * Hint for a wall-height change: "Office · walls 3.4 m · Ground Floor is now 3.7 m high",
 * plus a warning when the floor is so high its stairs get very steep (steepStairsText).
 */
export function wallHeightText(room, plan, floorName = 'The floor') {
  const walls = `${room.name} · walls ${plan.wallHeight.toFixed(1)} m`;
  const text = plan.raised ? `${walls} · ${floorName} is now ${plan.height.toFixed(1)} m high` : walls;
  const steep = steepStairsText(plan.height);
  return steep ? `${text} · ${steep}` : text;
}

/**
 * v0.18.6 (audit 8 + 9): what a copy of a room keeps, the ONE rule for "Copy rooms from below" and Duplicate:
 * its type, colour, wall height and thickness, the floor chosen for it, its glass walls and a Meeting room's
 * "first door in glass". Not its name, place, size, doors, windows, department or lock: each caller says what
 * it does with those (the floor copy keeps the footprint and the openings, Duplicate neither).
 * `glassWalls` is always given (empty: solid), so a copied Meeting room stays as solid as its original.
 */
export function roomLook(r) {
  return {
    type: r.type,
    color: r.color,
    wallHeight: r.wallHeight ?? DEFAULT_WALL_HEIGHT,
    wallThickness: wallThicknessOf(r),
    ...(r.floorFinish && r.floorFinish !== 'default' ? { floorFinish: r.floorFinish } : {}),
    glassWalls: [...(r.glassWalls ?? [])],
    ...(r.glassOnFirstDoor ? { glassOnFirstDoor: true } : {}),
  };
}

/**
 * The rooms of a floor copied onto a new floor above it: same footprints, doors and windows, and the room's
 * look (roomLook: type, wall heights, floor, glass walls). No furniture, no stairs.
 * @returns {object[]} room data ready for addRoom (without ids)
 */
export function copyRoomsUp(rooms, fromFloorId, toFloorId) {
  return rooms
    .filter((r) => (r.floor ?? 0) === fromFloorId)
    .map((r) => ({
      ...roomLook(r),
      x: r.x,
      z: r.z,
      width: r.width,
      depth: r.depth,
      doors: (r.doors ?? []).map((d) => ({ ...d })),
      windows: (r.windows ?? []).map((w) => ({ ...w })),
      floor: toFloorId,
    }));
}

// ── Rectangles ────────────────────────────────────────────────────────────

/** Room {x,z,width,depth} → {x0,x1,z0,z1} */
export function roomRect(r) {
  return { x0: r.x - r.width / 2, x1: r.x + r.width / 2, z0: r.z - r.depth / 2, z1: r.z + r.depth / 2 };
}

export function rectArea(r) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);
}

export function intersectRects(a, b) {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
  return r.x1 > r.x0 && r.z1 > r.z0 ? r : null;
}

export function rectContains(r, x, z) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/**
 * `rect` minus `holes`, as a list of non-overlapping rectangles that cover
 * everything except the holes (e.g. a floor with a stairwell cut out).
 */
export function subtractRects(rect, holes, minSize = 0.01) {
  let pieces = [rect];
  for (const hole of holes) {
    const next = [];
    for (const p of pieces) {
      const h = intersectRects(p, hole);
      if (!h) { next.push(p); continue; }
      // left and right strips (full height), then bottom and top between them
      next.push({ x0: p.x0, x1: h.x0, z0: p.z0, z1: p.z1 });
      next.push({ x0: h.x1, x1: p.x1, z0: p.z0, z1: p.z1 });
      next.push({ x0: h.x0, x1: h.x1, z0: p.z0, z1: h.z0 });
      next.push({ x0: h.x0, x1: h.x1, z0: h.z1, z1: p.z1 });
    }
    pieces = next.filter((r) => r.x1 - r.x0 > minSize && r.z1 - r.z0 > minSize);
  }
  return pieces;
}

/** How much of a room (0..1) is covered by rooms on the floor above. */
export function coveredFraction(room, upperRooms) {
  const mine = roomRect(room);
  const area = rectArea(mine);
  if (area === 0) return 0;
  let covered = 0;
  for (const u of upperRooms) {
    const i = intersectRects(mine, roomRect(u));
    if (i) covered += rectArea(i); // rooms on one floor never overlap, so a plain sum is exact
  }
  return Math.min(1, covered / area);
}

/**
 * Area (m²) of a room on an upper floor with nothing under it. A room below
 * counts up to the outside of its walls, so a room built over two
 * back-to-back rooms doesn't overhang the gap between their walls.
 */
export function overhangArea(rect, belowRooms, wallThickness = 0.15) {
  const mine = roomRect(rect);
  const supports = belowRooms.map((r) => {
    const b = roomRect(r);
    const t = wallThickness / 2;
    return { x0: b.x0 - t, x1: b.x1 + t, z0: b.z0 - t, z1: b.z1 + t };
  });
  return subtractRects(mine, supports).reduce((sum, p) => sum + rectArea(p), 0);
}

/** True if part of a room on an upper floor (more than a sliver) has nothing under it. */
export function overhangs(rect, belowRooms) {
  return overhangArea(rect, belowRooms) > 0.05;
}

// ── Staircases ────────────────────────────────────────────────────────────

/** A saved scale of a staircase as drawn and walked: its size (a negative one is not mirrored), 0.1 to 5, else 1. */
const stairScale = (v) => {
  const a = Math.abs(Number(v));
  return Number.isFinite(a) && a >= 0.1 ? Math.min(a, 5) : 1;
};

/**
 * Width and length of a placed staircase. New stairs can't be resized (`stairPatch`), but a save can
 * hold a scale from before v0.14.5: scaleX and scaleZ are its size, drawn and walked alike.
 */
export function stairSize(stair) {
  if (stairShape(stair) !== 'straight') return { width: L_STAIR.width, length: L_STAIR.length }; // an L is never scaled
  return { width: STAIR.width * stairScale(stair?.scaleX), length: STAIR.length * stairScale(stair?.scaleZ) };
}

// ── L-shaped stairs (v0.18.3) ──
// A staircase's shape is `metadata.stairShape`: missing = the straight flight it always was. An L climbs half
// its steps up the first flight (local +Z), turns on a square landing, and climbs the rest to the side
// ('L-right': local +X, 'L-left': local −X). Older builds ignore the metadata and draw a straight flight.

/** An L-shaped staircase: its box (m) and the flights' width (= the landing's side). */
export const L_STAIR = { width: 3.2, length: 3.2, flight: 1.2 };
/** The shapes a STAIRCASE can have (`metadata.stairShape`; missing = straight). */
export const STAIR_SHAPES = ['straight', 'L-right', 'L-left'];
/** The shapes' names in the UI. */
export const STAIR_SHAPE_LABELS = { straight: 'Straight', 'L-right': 'L, turns right', 'L-left': 'L, turns left' };

/** A staircase's shape: 'straight' | 'L-right' | 'L-left' (anything else: straight). */
export function stairShape(stair) {
  const s = stair?.metadata?.stairShape;
  return s === 'L-right' || s === 'L-left' ? s : 'straight';
}

/**
 * The parts of a flight in its own coordinates (lx across, +lz the way the first flight climbs, the item's
 * x, z at the middle of its box): [{ kind: 'flight' | 'landing', x0, x1, z0, z1, h0, h1, steps, along }]
 * (h0 / h1: heights over its floor where the part starts and ends; along: 'z' | 'x' | '-x', the way it
 * climbs). A straight flight is ONE part, exactly what it always was.
 */
export function stairParts(stair, dims) {
  const shape = stairShape(stair);
  if (shape === 'straight') {
    return [{ kind: 'flight', x0: -dims.width / 2, x1: dims.width / 2, z0: -dims.length / 2, z1: dims.length / 2, h0: 0, h1: dims.rise, steps: dims.steps, along: 'z' }];
  }
  const half = L_STAIR.width / 2;
  const f = L_STAIR.flight;
  const n1 = Math.max(1, Math.floor(dims.steps / 2));
  const n2 = Math.max(1, dims.steps - n1);
  const mid = (n1 / dims.steps) * dims.rise;
  const right = shape === 'L-right';
  const cx0 = right ? -half : half - f; // the first flight and the landing: the column away from the turn
  const cx1 = cx0 + f;
  return [
    { kind: 'flight', x0: cx0, x1: cx1, z0: -half, z1: half - f, h0: 0, h1: mid, steps: n1, along: 'z' },
    { kind: 'landing', x0: cx0, x1: cx1, z0: half - f, z1: half, h0: mid, h1: mid, steps: 0, along: 'z' },
    { kind: 'flight', x0: right ? cx1 : -half, x1: right ? half : cx0, z0: half - f, z1: half, h0: mid, h1: dims.rise, steps: n2, along: right ? 'x' : '-x' },
  ];
}

/** How far up a part (0 at its start, 1 at its end) a local point is. */
function partAlong(p, lx, lz) {
  if (p.along === 'z') return (lz - p.z0) / (p.z1 - p.z0);
  if (p.along === 'x') return (lx - p.x0) / (p.x1 - p.x0);
  return (p.x1 - lx) / (p.x1 - p.x0);
}

/** The tread's height over the floor at a local point of a part (the middle of each step, as always). */
function partHeight(p, lx, lz, dims) {
  if (p.kind === 'landing' || !p.steps) return p.h0;
  const v = Math.min(1, Math.max(0, partAlong(p, lx, lz)));
  const riser = dims.rise / dims.steps;
  return Math.min(p.h1, p.h0 + (v * p.steps + 0.5) * riser);
}

/** The solid blocks of a flight in its own coordinates: straight = its box; an L = its two arms. */
function stairBlocks(stair, dims) {
  const parts = stairParts(stair, dims);
  if (parts.length === 1) return parts;
  const [first, landing, second] = parts;
  return [{ ...first, z1: landing.z1, column: true }, second];
}

/** A local point → world (the inverse of toStairLocal). */
function stairWorld(stair, lx, lz) {
  const c = Math.cos(stair.rotationY ?? 0);
  const s = Math.sin(stair.rotationY ?? 0);
  return { x: stair.x + lx * c + lz * s, z: stair.z - lx * s + lz * c };
}

/**
 * The flight's blocks as turned rectangles in the world ({ x, z, hw, hd, rot }): the walk map's obstacles and
 * STAIRS cells. Straight: one, the flight. An L: its first flight with the landing, and its second flight.
 */
export function stairRects(stair, dims = stairSize(stair)) {
  const rot = stair.rotationY ?? 0;
  return stairBlocks(stair, { ...STAIR, ...dims }).map((b) => {
    const c = stairWorld(stair, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    return { x: c.x, z: c.z, hw: (b.x1 - b.x0) / 2, hd: (b.z1 - b.z0) / 2, rot };
  });
}

/**
 * The two ends of a flight in the world, each a frame { x, z, rot, hw }: at the edge of its bottom / top
 * step, `rot` the way you climb there (sin, cos = its world direction), `hw` half the flight's width.
 * Straight: the middle of its −Z and +Z ends; an L: the start of the first flight and the end of the second.
 */
export function stairEnds(stair, dims = stairSize(stair)) {
  const rot = stair.rotationY ?? 0;
  const shape = stairShape(stair);
  if (shape === 'straight') {
    const b = stairWorld(stair, 0, -dims.length / 2);
    const t = stairWorld(stair, 0, dims.length / 2);
    return { bottom: { ...b, rot, hw: dims.width / 2 }, top: { ...t, rot, hw: dims.width / 2 } };
  }
  const half = L_STAIR.width / 2;
  const f = L_STAIR.flight;
  const right = shape === 'L-right';
  const b = stairWorld(stair, right ? -half + f / 2 : half - f / 2, -half);
  const t = stairWorld(stair, right ? half : -half, half - f / 2);
  return { bottom: { ...b, rot, hw: f / 2 }, top: { ...t, rot: rot + (right ? Math.PI / 2 : -Math.PI / 2), hw: f / 2 } };
}

/** A point `d` metres along an end's climbing direction (negative: back, in front of a bottom step). */
export function alongEnd(end, d) {
  return { x: end.x + Math.sin(end.rot) * d, z: end.z + Math.cos(end.rot) * d };
}

/** The middle of an L's landing (world x, z); a straight flight's middle. */
export function stairLanding(stair, dims = stairSize(stair)) {
  if (stairShape(stair) === 'straight') return { x: stair.x, z: stair.z };
  const l = stairParts(stair, { ...STAIR, ...dims })[1];
  return stairWorld(stair, (l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2);
}

/**
 * The openings a flight needs in the floor, ceiling and roof above it (axis-aligned boxes, with a margin):
 * straight = stairOpening; an L = one per arm, so the floor over the corner it leaves free stays.
 */
export function stairOpenings(stair, dims = stairSize(stair), margin = 0.05) {
  if (stairShape(stair) === 'straight') return [stairOpening(stair, dims, margin)];
  return stairRects(stair, dims).map((r) => {
    const c = Math.abs(Math.cos(r.rot));
    const s = Math.abs(Math.sin(r.rot));
    const hx = r.hw * c + r.hd * s + margin;
    const hz = r.hw * s + r.hd * c + margin;
    return { x0: r.x - hx, x1: r.x + hx, z0: r.z - hz, z1: r.z + hz };
  });
}

/**
 * stairPushOut for an L (v0.18.3): each arm is a solid block up to its steps. `y` = feet over the stair's
 * floor. The way out (world dx, dz), or null.
 */
function lPushOut(s, dims, { x, z, y, rooms, floors, radius }) {
  const { lx, lz } = toStairLocal(s, x, z);
  let nowhere = null;
  for (const b of stairBlocks(s, dims)) {
    const nx = Math.max(b.x0, Math.min(b.x1, lx));
    const nz = Math.max(b.z0, Math.min(b.z1, lz));
    const away = Math.hypot(lx - nx, lz - nz);
    if (away >= radius) continue;
    if (nowhere === null) nowhere = !!rooms && stairNeedsRoomAbove(s, floors, rooms);
    const w = stairWorld(s, nx, nz);
    const surface = stairHeightAt(s, w.x, w.z, dims) ?? dims.rise;
    if (!nowhere && surface <= y + STEP_UP) continue; // you can step onto it (or you are on it)
    let ox;
    let oz;
    if (away > 1e-9) {
      const by = (radius - away) / away;
      ox = (lx - nx) * by;
      oz = (lz - nz) * by;
    } else {
      // inside the block: out by the nearest side, never back where it starts (except one leading nowhere)
      const sides = [
        [b.x1 - lx, 1, 0], [lx - b.x0, -1, 0], [b.z1 - lz, 0, 1], [lz - b.z0, 0, -1],
      ].filter(([, sx, sz]) => nowhere || !startSide(b, sx, sz));
      const out = sides.sort((p, q) => p[0] - q[0])[0];
      ox = out[1] * (out[0] + radius);
      oz = out[2] * (out[0] + radius);
    }
    const r = s.rotationY ?? 0;
    return { dx: ox * Math.cos(r) + oz * Math.sin(r), dz: oz * Math.cos(r) - ox * Math.sin(r), nowhere };
  }
  return null;
}

/** Is this side of a block (its outward normal sx, sz) the one where it starts, where you step on? */
function startSide(b, sx, sz) {
  if (b.column || b.along === 'z') return sz === -1;
  return b.along === 'x' ? sx === -1 : sx === 1;
}


/**
 * Size of a placed staircase: as stairSize, and it climbs exactly the height of the floor it starts
 * on. The ONE description of a flight: its mesh (`stairDrawn`), the surface you walk on, the opening
 * above it, its ends and the walk map all read this.
 */
export function stairDimsFor(floors, stair) {
  return { ...stairDims(floorHeight(floors, stair.floor ?? 0)), ...stairSize(stair) };
}

/**
 * How a staircase is drawn (ObjectSystem), so what you see is what you walk on: standing on its floor
 * whatever `y` a save holds (a flight in the air could not be climbed nor reach the floor above),
 * never tilted, as high as its floor (scaleY of an old save is not used), as wide and long as stairSize.
 */
export function stairDrawn(floors, stair) {
  const floor = stair.floor ?? 0;
  return {
    y: elevationOf(floors, floor), rotationX: 0, rotationZ: 0,
    scaleX: stairScale(stair.scaleX), scaleY: 1, scaleZ: stairScale(stair.scaleZ),
    rise: floorHeight(floors, floor),
  };
}

/**
 * What of a change to a staircase may happen (editorHistory: the one place layouts change): it keeps
 * its size, stands on its floor and stays level, so "Normal size" is the only change of scale.
 */
export function stairPatch(patch) {
  const { y: _y, rotationX: _rx, rotationZ: _rz, scaleX, scaleY, scaleZ, ...rest } = patch;
  const scales = [scaleX, scaleY, scaleZ].filter((v) => v !== undefined);
  const normal = scales.length === 3 && scales.every((v) => v === 1);
  return normal ? { ...rest, scaleX: 1, scaleY: 1, scaleZ: 1 } : rest;
}

/** Why a staircase can't be resized (Studio's Inspector and R key, Preview's Edit item). */
export const STAIRS_KEEP_SIZE = 'Stairs always climb exactly one floor, so they keep their size';

/** World point → the staircase's own coordinates (lx across, lz along the climb). */
function toStairLocal(stair, x, z) {
  const c = Math.cos(stair.rotationY ?? 0);
  const s = Math.sin(stair.rotationY ?? 0);
  const dx = x - stair.x;
  const dz = z - stair.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/**
 * Height of the walkable stair surface at (x, z), measured from the stair's
 * floor, or null if (x, z) isn't on the stairs. The bottom step starts at the
 * stair's local -Z end and the top lands at +Z, `dims.rise` up.
 * The surface follows the middle of each step, so feet rest on the treads.
 */
export function stairHeightAt(stair, x, z, dims = { ...STAIR, ...stairSize(stair) }) {
  const { lx, lz } = toStairLocal(stair, x, z);
  if (stairShape(stair) !== 'straight') {
    // an L: on one of its parts, or on the lip past its last step (LIP as a straight flight's)
    const parts = stairParts(stair, dims);
    const last = parts[parts.length - 1];
    for (const p of parts) {
      const lip = p === last ? 0.15 : 0;
      const x0 = p.x0 - (p.along === '-x' ? lip : 0);
      const x1 = p.x1 + (p.along === 'x' ? lip : 0);
      if (lx >= x0 - 1e-9 && lx <= x1 + 1e-9 && lz >= p.z0 - 1e-9 && lz <= p.z1 + 1e-9) return partHeight(p, lx, lz, dims);
    }
    return null;
  }
  // The top continues a little past the last step (a landing lip), so there is no gap between the
  // stairs and the edge of the opening in the floor above. A flight turned 45° has a square opening,
  // further away: the lip reaches its edge there.
  const c = Math.abs(Math.cos(stair.rotationY ?? 0));
  const s = Math.abs(Math.sin(stair.rotationY ?? 0));
  const hole = stairOpening(stair, dims);
  const toEdge = Math.min(s > 1e-6 ? (hole.x1 - stair.x) / s : Infinity, c > 1e-6 ? (hole.z1 - stair.z) / c : Infinity);
  const LIP = Math.max(0.15, toEdge - dims.length / 2);
  if (Math.abs(lx) > dims.width / 2 || lz < -dims.length / 2 || lz > dims.length / 2 + LIP) return null;
  const v = (lz + dims.length / 2) / dims.length; // 0 at the bottom, 1 at the top
  return Math.min(dims.rise, ((v * dims.steps + 0.5) / dims.steps) * dims.rise);
}

/** Axis-aligned box around a staircase (with a margin): the opening it needs in floors, ceilings and roofs. */
export function stairOpening(stair, dims = stairSize(stair), margin = 0.05) {
  const c = Math.abs(Math.cos(stair.rotationY ?? 0));
  const s = Math.abs(Math.sin(stair.rotationY ?? 0));
  const hx = (dims.width / 2) * c + (dims.length / 2) * s + margin;
  const hz = (dims.width / 2) * s + (dims.length / 2) * c + margin;
  return { x0: stair.x - hx, x1: stair.x + hx, z0: stair.z - hz, z1: stair.z + hz };
}

/** Where the top of a staircase lands (world x, z), e.g. to put the character there. */
export function stairTop(stair, dims = stairSize(stair)) {
  if (stairShape(stair) !== 'straight') return alongEnd(stairEnds(stair, dims).top, 0.6);
  const r = stair.rotationY ?? 0;
  const d = dims.length / 2 + 0.6;
  return { x: stair.x + Math.sin(r) * d, z: stair.z + Math.cos(r) * d };
}

/**
 * A flight is a solid block up to its steps, drawn so; it used to collide with nothing, so you walked
 * into it from the side or from behind and the steps passed through the camera. This keeps the body
 * out of the part you can't step onto: the way out (world dx, dz) if the body at (x, z), feet at `y`,
 * reaches into a part of a flight that is more than STEP_UP above the feet; else null.
 * Near the bottom of the flight, on the steps, above them and on the floor below it, nothing stops you.
 * Stairs that lead nowhere (`stairNeedsRoomAbove`, given `rooms`) are a block all round, the bottom
 * step too: `nowhere: true` in the answer (the walker says why: STAIRS_LEAD_NOWHERE).
 */
export function stairPushOut({ x, z, y, floors, rooms = null, stairs = [], radius = 0.32, bodyHeight = 1.8 }) {
  for (const s of stairs) {
    const base = elevationOf(floors, s.floor ?? 0);
    if (y + bodyHeight <= base) continue; // underneath it, on the floor below
    const dims = stairDimsFor(floors, s);
    if (stairShape(s) !== 'straight') {
      const out = lPushOut(s, dims, { x, z, y: y - base, rooms, floors, radius });
      if (out) return out;
      continue;
    }
    const hw = dims.width / 2;
    const hl = dims.length / 2;
    const { lx, lz } = toStairLocal(s, x, z);
    const nx = Math.max(-hw, Math.min(hw, lx));
    const nz = Math.max(-hl, Math.min(hl, lz));
    const away = Math.hypot(lx - nx, lz - nz);
    if (away >= radius) continue;
    const nowhere = !!rooms && stairNeedsRoomAbove(s, floors, rooms);
    const v = (nz + hl) / dims.length;
    const surface = base + Math.min(dims.rise, ((v * dims.steps + 0.5) / dims.steps) * dims.rise);
    if (!nowhere && surface <= y + STEP_UP) continue; // you can step onto it (or you are on it)
    let ox;
    let oz;
    if (away > 1e-9) {
      const by = (radius - away) / away;
      ox = (lx - nx) * by;
      oz = (lz - nz) * by;
    } else if (nowhere) {
      // inside a flight that leads nowhere: out by the nearest side or end, the bottom too
      const out = [
        [hw - lx, 1, 0], [hw + lx, -1, 0], [hl - lz, 0, 1], [hl + lz, 0, -1],
      ].sort((a, b) => a[0] - b[0])[0];
      ox = out[1] * (out[0] + radius);
      oz = out[2] * (out[0] + radius);
    } else {
      // inside the block (put there, or fallen in): out by the nearest side or end, never up the steps
      const toSide = hw - Math.abs(lx);
      const toTop = hl - lz;
      if (toSide <= toTop) { ox = Math.sign(lx || 1) * (toSide + radius); oz = 0; }
      else { ox = 0; oz = toTop + radius; }
    }
    const r = s.rotationY ?? 0;
    return { dx: ox * Math.cos(r) + oz * Math.sin(r), dz: oz * Math.cos(r) - ox * Math.sin(r), nowhere };
  }
  return null;
}

/** What the walker says at a flight it can't climb (stairPushOut's `nowhere`). */
export const STAIRS_LEAD_NOWHERE = 'These stairs lead nowhere';

/**
 * True if a staircase leads nowhere: no floor above it, or no room on that
 * floor where the stairs arrive ("Build a room above to use these stairs").
 */
export function stairNeedsRoomAbove(stair, floors, rooms) {
  const above = floorAbove(floors, stair.floor ?? 0);
  if (!above) return true;
  const top = stairTop(stair);
  return !rooms.some((r) => r.floor === above.id && rectContains(roomRect(r), top.x, top.z));
}

/** Room you need in front of a flight's bottom step to step onto it (m). */
export const STAIR_STEP_ON = 0.8;
/** Room kept clear in front of a door, inside its room (m). */
export const DOOR_CLEAR = 0.8;

// stairProblems (why a staircase cannot be used as placed) lives in play/stairFit.js since v0.17.4:
// it needs the furniture and the floor above too, and finds the nearest spot that works.

// ── Standing ──────────────────────────────────────────────────────────────

/**
 * The height the character stands on at (x, z), given how high they are now.
 * Picks the highest surface that is not above them by more than one step
 * (so you walk up stairs, but walking under a floor doesn't lift you onto it).
 *
 * @param {object} p
 * @param {number} p.x
 * @param {number} p.z
 * @param {number} p.y       current feet height (world)
 * @param {object} p.floors  store floors map
 * @param {object[]} p.rooms all rooms (store shape: floor, x, z, width, depth)
 * @param {object[]} p.stairs all staircase objects (store shape: floor, x, z, rotationY)
 * @returns {number} world y to stand on
 */
export function supportHeight({ x, z, y, floors, rooms, stairs = [] }) {
  const surfaces = [0]; // the site ground
  for (const room of rooms) {
    // a room's floor reaches under its walls (the slab does): no gap to fall into in the doorway between
    // two rooms upstairs (back to back, the strip under their shared wall belongs to neither rectangle)
    const r = roomRect(room);
    const t = wallThicknessOf(room) / 2 + 0.02;
    if (!rectContains({ x0: r.x0 - t, x1: r.x1 + t, z0: r.z0 - t, z1: r.z1 + t }, x, z)) continue;
    const elev = elevationOf(floors, room.floor);
    // An opening for stairs coming up from the floor below?
    const below = floorBelow(floors, room.floor);
    const inOpening = below && stairs.some((s) => (s.floor ?? 0) === below.id && stairOpenings(s).some((h) => rectContains(h, x, z)));
    if (!inOpening) surfaces.push(elev + ROOM_FLOOR_OFFSET);
  }
  for (const s of stairs) {
    const h = stairHeightAt(s, x, z, stairDimsFor(floors, s));
    // stairs that lead nowhere are not climbed (stairPushOut keeps the body off them)
    if (h !== null && !stairNeedsRoomAbove(s, floors, rooms)) surfaces.push(elevationOf(floors, s.floor ?? 0) + h);
  }
  let best = -Infinity;
  for (const h of surfaces) {
    if (h <= y + STEP_UP && h > best) best = h;
  }
  return best === -Infinity ? 0 : best;
}

/**
 * Where Page Up / Page Down puts the character on another floor, at the same
 * x, z: standing on a room floor there (or on the ground floor's ground),
 * otherwise flying at that floor's height.
 * @returns {{ y: number, fly: boolean }}
 */
export function arrivalOnFloor({ x, z, floorId, floors, rooms, stairs = [] }) {
  const elev = elevationOf(floors, floorId);
  const below = floorBelow(floors, floorId);
  if (!below) return { y: supportHeight({ x, z, y: elev + 0.1, floors, rooms, stairs }), fly: false };
  const onRoom = rooms.some((r) => r.floor === floorId && rectContains(roomRect(r), x, z));
  const inOpening = stairs.some((s) => (s.floor ?? 0) === below.id && stairOpenings(s).some((h) => rectContains(h, x, z)));
  return { y: elev + ROOM_FLOOR_OFFSET, fly: !onRoom || inOpening };
}

// ── Placing furniture ─────────────────────────────────────────────────────

/**
 * How high an item sits when aimed at a surface (Build mode and the planner).
 * Items go on the floor, or ON TOP of other furniture (a monitor on a desk);
 * aiming at the side of furniture is not a place to put something.
 *
 * @param {object} p
 * @param {'ground'|'floor'|'object'} p.surface  what the pointer hit
 * @param {number} [p.normalY]   up-component of the surface normal at the hit
 * @param {number} [p.pointY]    world height of the hit
 * @param {number} [p.elevation] elevation of the floor being built on
 * @returns {{ worldY:number, y:number, onTop:boolean } | null}
 *          y is relative to the floor (what the store keeps); null = can't place here
 */
export function placementHeight({ surface, normalY = 1, pointY = 0, elevation = 0 }) {
  if (surface === 'object') {
    if (normalY <= 0.7) return null;
    return { worldY: pointY, y: Math.max(0, pointY - elevation), onTop: true };
  }
  const worldY = surface === 'ground' ? 0 : elevation + ROOM_FLOOR_OFFSET;
  return { worldY, y: Math.max(0, worldY - elevation), onTop: false };
}

/**
 * The items that may stand on top of other furniture (a desk, a sideboard): small things.
 * Everything else stands on the floor only (v0.15.2: a Large Plant could be dropped on a desk).
 * Old saves are left alone: an item already on a desk stays there until it is moved.
 */
export const TABLE_TOP_TYPES = new Set([
  'MONITOR_DUAL', 'LAPTOP', 'KEYBOARD', 'COMPUTER_MOUSE', 'PLANT_SMALL',
  'COFFEE_MACHINE', 'MICROWAVE', 'PRINTER', 'FIRST_AID',
]);

/** Flat things that lie on the floor: standing on one is standing on the floor (a desk on a rug). */
export const FLOOR_LIKE_TYPES = new Set(['RUG', 'SPAWN_POINT', 'ZONE_MARKER']);

/**
 * May an item of this type be put on this surface? The floor and the ground: always.
 * On top of another item ('object'): only the table-top types, unless that item is flat on the
 * floor (`onType`: a rug, a marker), which anything may stand on.
 * @param {string} assetType
 * @param {'ground'|'floor'|'object'} surface
 * @param {string | null} [onType]  the type of the item it would stand on
 */
export function canStandOn(assetType, surface, onType = null) {
  return surface !== 'object' || TABLE_TOP_TYPES.has(assetType) || FLOOR_LIKE_TYPES.has(onType);
}

/** Why a floor-only item can't go on a table top: "Large Plant stands on the floor". */
export const floorOnlyText = (label) => `${label || 'This item'} stands on the floor`;
