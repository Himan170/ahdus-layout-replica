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

import { roomOpenings } from './geometry';

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

/** For "Floor 2 of 3": a floor's place counted from the ground (1 = lowest) and how many there are. */
export function floorPosition(floors, floorId) {
  const sorted = floorsInOrder(floors);
  return { index: Math.max(0, sorted.findIndex((f) => f.id === floorId)) + 1, count: sorted.length };
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
  const tooHigh = roomOpenings(room).find((o) => o.top > wallHeight - 0.1 + EPS);
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
 * The rooms of a floor copied onto a new floor above it: same footprints,
 * types, wall heights, doors and windows. No furniture, no stairs.
 * @returns {object[]} room data ready for addRoom (without ids)
 */
export function copyRoomsUp(rooms, fromFloorId, toFloorId) {
  return rooms
    .filter((r) => (r.floor ?? 0) === fromFloorId)
    .map((r) => ({
      type: r.type,
      color: r.color,
      x: r.x,
      z: r.z,
      width: r.width,
      depth: r.depth,
      wallHeight: r.wallHeight ?? DEFAULT_WALL_HEIGHT,
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

/** Size of a placed staircase: it climbs exactly the height of the floor it starts on. */
export function stairDimsFor(floors, stair) {
  return stairDims(floorHeight(floors, stair.floor ?? 0));
}

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
export function stairHeightAt(stair, x, z, dims = STAIR) {
  const { lx, lz } = toStairLocal(stair, x, z);
  // The top continues a little past the last step (a landing lip), so there is
  // no gap between the stairs and the edge of the opening in the floor above.
  const LIP = 0.15;
  if (Math.abs(lx) > dims.width / 2 || lz < -dims.length / 2 || lz > dims.length / 2 + LIP) return null;
  const v = (lz + dims.length / 2) / dims.length; // 0 at the bottom, 1 at the top
  return Math.min(dims.rise, ((v * dims.steps + 0.5) / dims.steps) * dims.rise);
}

/** Axis-aligned box around a staircase (with a margin): the opening it needs in floors, ceilings and roofs. */
export function stairOpening(stair, dims = STAIR, margin = 0.05) {
  const c = Math.abs(Math.cos(stair.rotationY ?? 0));
  const s = Math.abs(Math.sin(stair.rotationY ?? 0));
  const hx = (dims.width / 2) * c + (dims.length / 2) * s + margin;
  const hz = (dims.width / 2) * s + (dims.length / 2) * c + margin;
  return { x0: stair.x - hx, x1: stair.x + hx, z0: stair.z - hz, z1: stair.z + hz };
}

/** Where the top of a staircase lands (world x, z), e.g. to put the character there. */
export function stairTop(stair, dims = STAIR) {
  const r = stair.rotationY ?? 0;
  const d = dims.length / 2 + 0.6;
  return { x: stair.x + Math.sin(r) * d, z: stair.z + Math.cos(r) * d };
}

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
    if (!rectContains(roomRect(room), x, z)) continue;
    const elev = elevationOf(floors, room.floor);
    // An opening for stairs coming up from the floor below?
    const below = floorBelow(floors, room.floor);
    const inOpening = below && stairs.some((s) => s.floor === below.id && rectContains(stairOpening(s), x, z));
    if (!inOpening) surfaces.push(elev + ROOM_FLOOR_OFFSET);
  }
  for (const s of stairs) {
    const h = stairHeightAt(s, x, z, stairDimsFor(floors, s));
    if (h !== null) surfaces.push(elevationOf(floors, s.floor) + h);
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
  const inOpening = stairs.some((s) => s.floor === below.id && rectContains(stairOpening(s), x, z));
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
