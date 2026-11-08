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
      wallThickness: wallThicknessOf(r),
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
  return { width: STAIR.width * stairScale(stair?.scaleX), length: STAIR.length * stairScale(stair?.scaleZ) };
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

/** The axis-aligned box (world) of a rectangle in a staircase's own frame: lx across, lz along the climb. */
function stairLocalBox(stair, lx0, lx1, lz0, lz1) {
  const c = Math.cos(stair.rotationY ?? 0);
  const s = Math.sin(stair.rotationY ?? 0);
  const xs = [];
  const zs = [];
  for (const lx of [lx0, lx1]) {
    for (const lz of [lz0, lz1]) {
      // the inverse of toStairLocal
      xs.push(stair.x + lx * c + lz * s);
      zs.push(stair.z - lx * s + lz * c);
    }
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

const overlapsBy = (a, b, tol) => a.x0 < b.x1 - tol && a.x1 > b.x0 + tol && a.z0 < b.z1 - tol && a.z1 > b.z0 + tol;
const insideBy = (a, b, tol) => a.x0 >= b.x0 - tol && a.x1 <= b.x1 + tol && a.z0 >= b.z0 - tol && a.z1 <= b.z1 + tol;

/**
 * Why a staircase can't be used as placed, for Studio (the Inspector, placing one): a list of
 * { code, text }, empty when it is fine.
 *   NOWHERE    no floor above, or no room there where it arrives (it can't be climbed: stairPushOut)
 *   STICKS_OUT the flight is not inside the room it stands in
 *   NO_STEP_ON no room in front of its bottom step (STAIR_STEP_ON, inside that room)
 *   BLOCKS_DOOR the flight stands in front of a door of that room (DOOR_CLEAR)
 * The room = the innermost room of its floor holding its middle; outside every room only NOWHERE counts.
 */
export function stairProblems(stair, floors, rooms) {
  const out = [];
  const floor = stair.floor ?? 0;
  const above = floorAbove(floors, floor);
  if (stairNeedsRoomAbove(stair, floors, rooms)) {
    out.push({
      code: 'NOWHERE',
      text: above
        ? `${STAIRS_LEAD_NOWHERE}: build a room on ${above.name || 'the floor above'} where they arrive`
        : `${STAIRS_LEAD_NOWHERE}: there is no floor above. Add one, with a room where they arrive`,
    });
  }
  const room = rooms
    .filter((r) => (r.floor ?? 0) === floor && rectContains(roomRect(r), stair.x, stair.z))
    .sort((a, b) => a.width * a.depth - b.width * b.depth)[0];
  if (!room) return out;
  const name = room.name?.trim() || 'their room';
  const T = wallThicknessOf(room) / 2;
  const r = roomRect(room);
  const inner = { x0: r.x0 + T, x1: r.x1 - T, z0: r.z0 + T, z1: r.z1 - T };
  const { width, length } = stairSize(stair);
  const flight = stairLocalBox(stair, -width / 2, width / 2, -length / 2, length / 2);
  const stepOn = stairLocalBox(stair, -width / 2, width / 2, -length / 2 - STAIR_STEP_ON, -length / 2);
  const tol = 0.02;
  if (!insideBy(flight, inner, tol)) {
    out.push({ code: 'STICKS_OUT', text: `These stairs don't fit ${name}: they stick out of it` });
  } else if (!insideBy(stepOn, inner, tol)) {
    out.push({ code: 'NO_STEP_ON', text: `These stairs don't fit ${name}: there's no room in front of the bottom step` });
  }
  const doorBlocked = roomOpenings(room).some((o) => {
    if (o.kind !== 'door') return false;
    const half = o.width / 2;
    const zone = {
      north: { x0: room.x + o.offset - half, x1: room.x + o.offset + half, z0: inner.z1 - DOOR_CLEAR, z1: inner.z1 },
      south: { x0: room.x + o.offset - half, x1: room.x + o.offset + half, z0: inner.z0, z1: inner.z0 + DOOR_CLEAR },
      east: { x0: inner.x1 - DOOR_CLEAR, x1: inner.x1, z0: room.z + o.offset - half, z1: room.z + o.offset + half },
      west: { x0: inner.x0, x1: inner.x0 + DOOR_CLEAR, z0: room.z + o.offset - half, z1: room.z + o.offset + half },
    }[o.wall];
    return zone && overlapsBy(flight, zone, tol);
  });
  if (doorBlocked) out.push({ code: 'BLOCKS_DOOR', text: `These stairs don't fit ${name}: they block a door` });
  return out;
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
    // a room's floor reaches under its walls (the slab does): no gap to fall into in the doorway between
    // two rooms upstairs (back to back, the strip under their shared wall belongs to neither rectangle)
    const r = roomRect(room);
    const t = wallThicknessOf(room) / 2 + 0.02;
    if (!rectContains({ x0: r.x0 - t, x1: r.x1 + t, z0: r.z0 - t, z1: r.z1 + t }, x, z)) continue;
    const elev = elevationOf(floors, room.floor);
    // An opening for stairs coming up from the floor below?
    const below = floorBelow(floors, room.floor);
    const inOpening = below && stairs.some((s) => (s.floor ?? 0) === below.id && rectContains(stairOpening(s), x, z));
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
  const inOpening = stairs.some((s) => (s.floor ?? 0) === below.id && rectContains(stairOpening(s), x, z));
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
