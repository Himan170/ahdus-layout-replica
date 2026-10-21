/**
 * play/geometry.js
 *
 * Pure geometry helpers for building in Play mode and for building room meshes.
 * No Babylon imports, so everything here is unit-tested in Node.
 *
 * Coordinate conventions (same as the rest of the editor):
 *   - Room {x, z} is its CENTRE; width runs along X, depth along Z.
 *   - Walls: north = +Z side, south = -Z, east = +X, west = -X.
 *   - An opening's `offset` is measured from the wall's centre, along the wall
 *     (X for north/south walls, Z for east/west walls).
 */

import { stairOpening, overhangs } from './building';

export const WALL_THICKNESS = 0.15;
export const SHARED_WALL_TOLERANCE = 0.02;
const GEOMETRY_EPSILON = 1e-6;
export const MIN_ROOM_SIZE = 1.5;
export const DOOR_DEFAULTS = { width: 1.0, height: 2.1, sill: 0 };
export const WINDOW_DEFAULTS = { width: 1.4, height: 1.2, sill: 0.9 };
/** Length of the WALL_SEGMENT asset at scale 1 (see assetCatalog). */
export const WALL_ASSET_LENGTH = 3;

export function snap(v, step = 0.5) {
  return Math.round(v / step) * step;
}

/**
 * Room rectangle from two corner points (as clicked in Play mode).
 * Grows to MIN_ROOM_SIZE in the direction the user dragged if too small.
 */
export function rectFromCorners(a, b, min = MIN_ROOM_SIZE) {
  const grow = (from, to) => {
    const d = to - from;
    if (Math.abs(d) >= min) return [from, to];
    return [from, from + (d < 0 ? -min : min)];
  };
  const [x0, x1] = grow(a.x, b.x);
  const [z0, z1] = grow(a.z, b.z);
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    width: Math.abs(x1 - x0),
    depth: Math.abs(z1 - z0),
  };
}

/**
 * Transform for a WALL_SEGMENT object stretched from point a to point b.
 * Babylon rotates local +X to (cos θ, 0, -sin θ), so θ = atan2(-dz, dx).
 */
export function wallSegmentTransform(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    rotationY: Math.atan2(-dz, dx),
    length,
    scaleX: length / WALL_ASSET_LENGTH,
  };
}

/**
 * The four walls of a room, in room-local coordinates.
 * North/south walls span the full width (+ thickness, so corners are closed);
 * east/west walls fit between them, so no two walls overlap.
 */
export function roomWalls(room) {
  const { width, depth } = room;
  const T = WALL_THICKNESS;
  return [
    { name: 'north', cx: 0, cz: depth / 2, length: width + T, alongX: true },
    { name: 'south', cx: 0, cz: -depth / 2, length: width + T, alongX: true },
    { name: 'east', cx: width / 2, cz: 0, length: depth - T, alongX: false },
    { name: 'west', cx: -width / 2, cz: 0, length: depth - T, alongX: false },
  ];
}

/** Usable (inner) length of a wall for openings. */
export function innerWallLength(room, wallName) {
  return wallName === 'north' || wallName === 'south' ? room.width : room.depth;
}

/** All openings of a room (doors + windows) in one normalised list. */
export function roomOpenings(room) {
  const doors = (room.doors ?? []).map((d, index) => ({
    kind: 'door',
    index,
    wall: d.wall,
    offset: d.offset ?? 0,
    width: d.width ?? DOOR_DEFAULTS.width,
    bottom: 0,
    top: d.height ?? DOOR_DEFAULTS.height,
  }));
  const windows = (room.windows ?? []).map((w, index) => {
    const sill = w.sill ?? WINDOW_DEFAULTS.sill;
    return {
      kind: 'window',
      index,
      wall: w.wall,
      offset: w.offset ?? 0,
      width: w.width ?? WINDOW_DEFAULTS.width,
      bottom: sill,
      top: sill + (w.height ?? WINDOW_DEFAULTS.height),
    };
  });
  return [...doors, ...windows];
}

/**
 * Where on a wall an opening should go, given the world point the user aimed at.
 * Returns the clamped offset, or null if the wall is too short for it.
 */
export function openingOffsetFromHit(room, wallName, point, width, margin = 0.15) {
  const along = wallName === 'north' || wallName === 'south' ? point.x - room.x : point.z - room.z;
  const max = innerWallLength(room, wallName) / 2 - width / 2 - margin;
  if (max < 0) return null;
  return Math.max(-max, Math.min(max, along));
}

/** True if a new opening [offset ± width/2] would overlap an existing one on that wall. */
export function overlapsExisting(room, wallName, offset, width, gap = 0.2) {
  return roomOpenings(room)
    .filter((o) => o.wall === wallName)
    .some((o) => Math.abs(o.offset - offset) < (o.width + width) / 2 + gap);
}

/** The opening (if any) at a point along a wall — used to remove doors/windows. */
export function openingAt(room, wallName, point) {
  const along = wallName === 'north' || wallName === 'south' ? point.x - room.x : point.z - room.z;
  return (
    roomOpenings(room).find(
      (o) => o.wall === wallName && Math.abs(o.offset - along) <= o.width / 2 + 0.1,
    ) ?? null
  );
}

/**
 * Split a wall into solid rectangles around its openings, instead of cutting
 * holes with CSG (faster, no broken geometry, and skirting can follow it).
 *
 * @param {number} length   wall length (u runs from -length/2 to +length/2)
 * @param {number} height   wall height
 * @param {{offset:number,width:number,bottom:number,top:number}[]} openings
 * @returns {{u0:number,u1:number,y0:number,y1:number}[]} solid pieces
 */
export function splitWall(length, height, openings) {
  const half = length / 2;
  const holes = openings
    .map((o) => ({
      u0: Math.max(-half, o.offset - o.width / 2),
      u1: Math.min(half, o.offset + o.width / 2),
      y0: Math.max(0, o.bottom),
      y1: Math.min(height, o.top),
    }))
    .filter((h) => h.u1 > h.u0 && h.y1 > h.y0)
    .sort((a, b) => a.u0 - b.u0);

  const pieces = [];
  const EPS = 1e-6;
  let cursor = -half;
  for (const h of holes) {
    if (h.u0 > cursor + EPS) pieces.push({ u0: cursor, u1: h.u0, y0: 0, y1: height });
    const u0 = Math.max(cursor, h.u0);
    if (h.u1 > u0 + EPS) {
      if (h.y0 > EPS) pieces.push({ u0, u1: h.u1, y0: 0, y1: h.y0 });
      if (h.y1 < height - EPS) pieces.push({ u0, u1: h.u1, y0: h.y1, y1: height });
    }
    cursor = Math.max(cursor, h.u1);
  }
  if (half > cursor + EPS) pieces.push({ u0: cursor, u1: half, y0: 0, y1: height });
  return pieces;
}

/** Room containing a world point (on a given floor), or null. */
export function findRoomAt(rooms, x, z, floor) {
  for (const room of rooms) {
    if (floor !== undefined && room.floor !== floor) continue;
    if (
      x >= room.x - room.width / 2 && x <= room.x + room.width / 2 &&
      z >= room.z - room.depth / 2 && z <= room.z + room.depth / 2
    ) {
      return room;
    }
  }
  return null;
}

/** "6.0 × 4.5 m, 27 m²" */
export function formatRoomSize(width, depth) {
  return `${width.toFixed(1)} × ${depth.toFixed(1)} m, ${Math.round(width * depth)} m²`;
}

// ── Neighbouring rooms ────────────────────────────────────────────────────
// Rooms built next to each other sit "back to back": the new room's wall is
// placed one wall-thickness outside the neighbour's wall. That avoids two walls
// in the exact same place (flickering), and lets a door cut through both.

export const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

const floorOf = (room) => room.floor ?? room.floorId ?? 0;
const alongCentre = (room, axis) => axis === 'z' ? room.x : room.z;

function physicalWallLine(room, wallName) {
  const line = wallLine(room, wallName);
  const wall = roomWalls(room).find((candidate) => candidate.name === wallName);
  const centre = alongCentre(room, line.axis);
  return {
    ...line,
    from: centre - wall.length / 2,
    to: centre + wall.length / 2,
  };
}

function isSharedBoundary(a, b, tolerance = SHARED_WALL_TOLERANCE) {
  const distance = Math.abs(a.value - b.value);
  return distance <= tolerance || Math.abs(distance - WALL_THICKNESS) <= tolerance;
}

/** True when `room`'s `wallName` lies on the same wall of `other` (same line, ± tolerance). */
function onSameWallLine(room, other, wallName) {
  return Math.abs(wallLine(room, wallName).value - wallLine(other, wallName).value) <= SHARED_WALL_TOLERANCE;
}

/**
 * The rooms inside `room` that stand on its wall `wallName`: their wall there
 * IS that wall (one wall, built by them; see roomWallSegments).
 */
export function roomsStandingOnWall(room, wallName, rooms) {
  return rooms.filter((other) => other.id !== room.id && floorOf(other) === floorOf(room) &&
    roomContainedBy(room, other) && onSameWallLine(other, room, wallName));
}

/** The room `room` stands in whose wall `wallName` is also `room`'s wall there, or null. */
export function outerRoomOfWall(room, wallName, rooms) {
  let best = null;
  for (const other of rooms) {
    if (other.id === room.id || floorOf(other) !== floorOf(room)) continue;
    if (!roomContainedBy(other, room) || !onSameWallLine(room, other, wallName)) continue;
    if (!best || other.width * other.depth < best.width * best.depth) best = other; // the innermost
  }
  return best;
}

/** [from, to] world intervals minus other intervals. */
function subtractSpans(spans, holes) {
  let pieces = spans;
  for (const hole of holes) {
    pieces = pieces.flatMap((p) => {
      if (hole.to <= p.from || hole.from >= p.to) return [p];
      const out = [];
      if (hole.from > p.from) out.push({ from: p.from, to: hole.from });
      if (hole.to < p.to) out.push({ from: hole.to, to: p.to });
      return out;
    });
  }
  return pieces.filter((p) => p.to - p.from > GEOMETRY_EPSILON);
}

/**
 * A room's physical wall, with the ends cut back where it meets the wall of
 * an outer room it stands on (a north / south wall ends at that wall's inside
 * face instead of reaching into it).
 */
function wallExtent(room, wallName, rooms) {
  const line = physicalWallLine(room, wallName);
  if (!ALONG_X(wallName) || outerRoomOfWall(room, wallName, rooms)) return line;
  const T = WALL_THICKNESS;
  if (outerRoomOfWall(room, 'west', rooms)) line.from = room.x - room.width / 2 + T / 2;
  if (outerRoomOfWall(room, 'east', rooms)) line.to = room.x + room.width / 2 - T / 2;
  return line;
}

/** The parts of a room's wall it builds (or shares) itself: not where rooms inside stand on it. */
function ownWallSpans(room, wallName, rooms, extent = wallExtent(room, wallName, rooms)) {
  return subtractSpans([{ from: extent.from, to: extent.to }],
    roomsStandingOnWall(room, wallName, rooms).map((inner) => physicalWallLine(inner, wallName)));
}

/**
 * Physical wall pieces for a room boundary.
 * - Back to back: opposing boundaries either share a centreline (older/manual
 *   layouts) or are WALL_THICKNESS apart (the planner's back-to-back
 *   placement). Shared pieces are emitted by exactly one room, chosen by
 *   stable ID order.
 * - A room inside a room may stand on the outer room's wall (same line): there
 *   the outer room builds nothing and the inner room builds the wall, full
 *   thickness on that line, as a piece shared with the outer room
 *   (`sameSide`: both rooms are on its inner side; outside it is the outer
 *   room's). The inner room's other walls stop at that wall's inside face.
 * Shared pieces carry partnerRoom and partnerWall (the partner's wall name).
 */
export function roomWallSegments(room, wallName, rooms = []) {
  const mine = wallExtent(room, wallName, rooms);
  const centre = alongCentre(room, mine.axis);
  const ownSpans = ownWallSpans(room, wallName, rooms, mine);
  const theirName = OPPOSITE[wallName];
  const candidates = [];

  for (const other of rooms) {
    if (other.id === room.id || floorOf(other) !== floorOf(room)) continue;
    const theirs = physicalWallLine(other, theirName);
    if (!isSharedBoundary(mine, theirs)) continue;
    // Where rooms inside `other` stand on its wall, the wall is theirs (they are in this loop too)
    for (const span of ownWallSpans(other, theirName, rooms)) {
      for (const own of ownSpans) {
        const worldFrom = Math.max(own.from, span.from);
        const worldTo = Math.min(own.to, span.to);
        if (worldTo - worldFrom <= GEOMETRY_EPSILON) continue;
        candidates.push({
          u0: worldFrom - centre,
          u1: worldTo - centre,
          crossOffset: (theirs.value - mine.value) / 2,
          worldValue: (theirs.value + mine.value) / 2,
          axis: mine.axis,
          thickness: WALL_THICKNESS,
          partnerRoom: other,
          partnerWall: theirName,
          shared: true,
        });
      }
    }
  }

  candidates.sort((a, b) => a.u0 - b.u0 || String(a.partnerRoom.id).localeCompare(String(b.partnerRoom.id)));
  const shared = [];
  for (const candidate of candidates) {
    let pieces = [{ u0: candidate.u0, u1: candidate.u1 }];
    for (const used of shared) {
      pieces = pieces.flatMap((piece) => {
        if (used.u1 <= piece.u0 || used.u0 >= piece.u1) return [piece];
        const result = [];
        if (used.u0 > piece.u0) result.push({ u0: piece.u0, u1: used.u0 });
        if (used.u1 < piece.u1) result.push({ u0: used.u1, u1: piece.u1 });
        return result;
      });
    }
    for (const piece of pieces) {
      if (piece.u1 - piece.u0 <= GEOMETRY_EPSILON) continue;
      shared.push({ ...candidate, ...piece });
    }
  }

  // The rest of the room's own wall: plain, or (standing on an outer room's wall) shared with that room
  const outer = outerRoomOfWall(room, wallName, rooms);
  const plain = subtractSpans(ownSpans, shared.map((s) => ({ from: s.u0 + centre, to: s.u1 + centre })));
  const segments = plain.map(({ from, to }) => (outer
    ? {
      u0: from - centre, u1: to - centre, crossOffset: 0, worldValue: mine.value, axis: mine.axis,
      thickness: WALL_THICKNESS, partnerRoom: outer, partnerWall: wallName, shared: true, sameSide: true,
    }
    : { u0: from - centre, u1: to - centre, crossOffset: 0, shared: false }));

  for (const segment of shared) {
    if (String(room.id).localeCompare(String(segment.partnerRoom.id)) < 0) segments.push(segment);
  }
  return segments.sort((a, b) => a.u0 - b.u0 || Number(a.shared) - Number(b.shared));
}

/** Openings for a wall piece, translated into its owning room's wall offsets. */
export function wallSegmentOpenings(room, wallName, segment) {
  const along = wallName === 'north' || wallName === 'south' ? 'x' : 'z';
  const ownCentre = room[along];
  const sources = [{ room, wall: wallName }];
  if (segment.shared) sources.push({ room: segment.partnerRoom, wall: segment.partnerWall ?? OPPOSITE[wallName] });

  const openings = [];
  for (const source of sources) {
    for (const opening of roomOpenings(source.room)) {
      if (opening.wall !== source.wall) continue;
      const offset = opening.offset + source.room[along] - ownCentre;
      if (offset < segment.u0 - 1e-6 || offset > segment.u1 + 1e-6) continue;
      const duplicate = openings.some((existing) =>
        existing.kind === opening.kind &&
        Math.abs(existing.offset - offset) <= SHARED_WALL_TOLERANCE &&
        Math.abs(existing.width - opening.width) <= SHARED_WALL_TOLERANCE);
      if (!duplicate) openings.push({
        ...opening,
        offset,
        roomId: source.room.id,
        sourceWall: source.wall,
      });
    }
  }
  return openings;
}

/**
 * Which room and wall a hit on a wall mesh (or a door / window in it) is about.
 * A shared wall is built by one of its two rooms (the id that sorts first, see
 * roomWallSegments), but it is a wall of both: it means the wall of the room
 * on the side it was hit from. roomBuilder tags shared pieces with
 * { sharedWith, sharedWall, sharedAt } (the other room, its wall, the world
 * coordinate of the wall's centre line).
 * A room inside a room standing on its wall shares it the other way round
 * (`sameSide`, with `innerRoom` / `outerRoom`): from inside it is the inner
 * room's wall, from outside the outer room's.
 * @param {{ roomId, wallName, sharedWith?, sharedWall?, sharedAt?, sameSide?, innerRoom?, outerRoom? }} meta
 * @param {{ x: number, z: number } | null} from  a world point on the side it was hit from
 * @returns {{ roomId: string, wallName: string }}
 */
export function wallPickTarget(meta, from) {
  const own = { roomId: meta.roomId, wallName: meta.wallName };
  if (!meta.sharedWith || !from) return own;
  const across = meta.wallName === 'north' || meta.wallName === 'south' ? from.z : from.x;
  // A room is on the inside of its walls: below its north / east wall, above its south / west wall
  const below = meta.wallName === 'north' || meta.wallName === 'east';
  const inside = below ? across <= meta.sharedAt : across >= meta.sharedAt;
  if (meta.sameSide) return { roomId: inside ? meta.innerRoom : meta.outerRoom, wallName: meta.wallName };
  return inside ? own : { roomId: meta.sharedWith, wallName: meta.sharedWall };
}

// ── Which rooms to rebuild ────────────────────────────────────────────────
// A room's mesh depends on the rooms it can share a wall with: back to back
// they are at most WALL_THICKNESS (+ tolerance) apart.
const TOUCH_GAP = WALL_THICKNESS + SHARED_WALL_TOLERANCE + GEOMETRY_EPSILON;

/** Rooms on `room`'s floor whose rectangle touches (or overlaps) it, close enough to share a wall. */
export function touchingRooms(room, rooms) {
  return rooms.filter((other) => other.id !== room.id && floorOf(other) === floorOf(room) &&
    Math.abs(other.x - room.x) - (other.width + room.width) / 2 <= TOUCH_GAP &&
    Math.abs(other.z - room.z) - (other.depth + room.depth) / 2 <= TOUCH_GAP);
}

/**
 * What a room's mesh is built from, of the rooms on its floor: the room itself
 * and the rooms touching it (their shared walls, and the doors and windows in
 * them). roomBuilder.roomGeometryKey is made from it.
 */
export function roomBuildInput(room, rooms) {
  return [
    floorOf(room), room.x, room.z, room.width, room.depth, room.wallHeight, room.type, room.color,
    room.doors ?? [], room.windows ?? [],
    touchingRooms(room, rooms).map((r) => [r.id, r.x, r.z, r.width, r.depth, r.wallHeight, r.doors ?? [], r.windows ?? []]),
  ];
}

/**
 * Which rooms need a new mesh when the rooms go from `before` to `after`
 * (lists of rooms, any floors): new and changed rooms, and the rooms touching
 * a changed (or removed) room's old or new rectangle on its floor. Not the
 * other rooms on that floor.
 * @returns {Set<string>} ids of rooms in `after`
 */
export function roomsToRebuild(before, after) {
  const old = new Map(before.map((r) => [r.id, r]));
  const input = (room, rooms) => JSON.stringify(roomBuildInput(room, rooms));
  return new Set(after
    .filter((r) => !old.has(r.id) || input(r, after) !== input(old.get(r.id), before))
    .map((r) => r.id));
}

/** World-space centre line of a wall: fixed coordinate + extent along it. */
export function wallLine(room, wallName) {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  switch (wallName) {
    case 'north': return { axis: 'z', value: room.z + hd, from: room.x - hw, to: room.x + hw };
    case 'south': return { axis: 'z', value: room.z - hd, from: room.x - hw, to: room.x + hw };
    case 'east': return { axis: 'x', value: room.x + hw, from: room.z - hd, to: room.z + hd };
    default: return { axis: 'x', value: room.x - hw, from: room.z - hd, to: room.z + hd };
  }
}

/**
 * The wall on the other side of `room`'s `wallName` at a world point, if a
 * neighbouring room is built back-to-back there. Used so one door goes through both.
 * `span`: width of the opening; a neighbour counts if any part of it is behind the opening.
 */
export function partnerWall(rooms, room, wallName, point, span = 0) {
  const mine = wallLine(room, wallName);
  const along = mine.axis === 'z' ? point.x : point.z;
  const half = span / 2;
  const covers = (from, to) => to - from > GEOMETRY_EPSILON && along + half > from && along - half < to;
  const sameFloor = rooms.filter((other) => other.id !== room.id && floorOf(other) === floorOf(room));

  // An outer room's wall where a room inside stands on it: that room's wall
  for (const inner of roomsStandingOnWall(room, wallName, sameFloor.concat(room))) {
    const line = wallLine(inner, wallName);
    if (covers(line.from, line.to)) return { room: inner, wallName };
  }
  // Back to back (where rooms inside the other room stand on its wall, it is theirs)
  const theirName = OPPOSITE[wallName];
  for (const other of sameFloor) {
    const theirs = wallLine(other, theirName);
    if (!isSharedBoundary(mine, theirs)) continue;
    const spans = subtractSpans([{ from: theirs.from, to: theirs.to }],
      roomsStandingOnWall(other, theirName, rooms).map((inner) => wallLine(inner, theirName)));
    for (const span of spans) {
      if (covers(Math.max(mine.from, span.from), Math.min(mine.to, span.to))) return { room: other, wallName: theirName };
    }
  }
  // Standing on an outer room's wall: the outer room's wall too
  const outer = outerRoomOfWall(room, wallName, rooms);
  if (outer && covers(mine.from, mine.to)) return { room: outer, wallName };
  return null;
}

/** True if two rooms' floor areas overlap (touching edges is fine). */
export function rectsOverlap(a, b, eps = 0.05) {
  const ox = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const oz = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
  return ox > eps && oz > eps;
}

/**
 * True when the inner room lies inside the outer room on the same floor: on
 * each side its walls are at least `clearance` in from the outer walls (so
 * they don't touch), or it stands exactly on the outer wall (same line, ±
 * SHARED_WALL_TOLERANCE: that wall is then its wall too). Anything between
 * (walls partly in each other) or the very same rectangle is not inside.
 */
export function roomContainedBy(outer, inner, clearance = WALL_THICKNESS) {
  if (floorOf(outer) !== floorOf(inner)) return false;
  if (outer.width / 2 - clearance <= 0 || outer.depth / 2 - clearance <= 0) return false;
  const side = (gap) => gap >= clearance - GEOMETRY_EPSILON || Math.abs(gap) <= SHARED_WALL_TOLERANCE;
  const sameRect = Math.abs(outer.width - inner.width) <= SHARED_WALL_TOLERANCE &&
    Math.abs(outer.depth - inner.depth) <= SHARED_WALL_TOLERANCE;
  return !sameRect &&
    side((inner.x - inner.width / 2) - (outer.x - outer.width / 2)) &&
    side((outer.x + outer.width / 2) - (inner.x + inner.width / 2)) &&
    side((inner.z - inner.depth / 2) - (outer.z - outer.depth / 2)) &&
    side((outer.z + outer.depth / 2) - (inner.z + inner.depth / 2));
}

/** A placement may overlap only a room whose usable interior fully contains it. */
export function roomPlacementBlocker(rect, rooms) {
  return rooms.find((room) =>
    floorOf(room) === floorOf(rect) &&
    !roomContainedBy(room, rect) &&
    rectsOverlap(room, rect)) ?? null;
}

/**
 * What stops an existing room from taking the rectangle `rect` (moved,
 * stretched, resized), or null: the rooms it stands in must still contain
 * it, the rooms inside it must still be inside, and it may not overlap others.
 */
export function roomRectBlocker(room, rect, rooms) {
  const others = rooms.filter((other) => other.id !== room.id && floorOf(other) === floorOf(room));
  const children = others.filter((other) => roomContainedBy(room, other));
  const containers = others.filter((other) => roomContainedBy(other, room));
  const target = { ...rect, floor: floorOf(room) };
  return children.find((child) => !roomContainedBy(target, child)) ??
    containers.find((container) => !roomContainedBy(container, target)) ??
    roomPlacementBlocker(target, others.filter((other) => !children.includes(other))) ??
    null;
}

/**
 * Validate a whole-room move while preserving any existing enclosing rooms.
 * The room keeps its size; it lands back to back on a neighbour (or on the
 * wall of the room it stands in) when it comes close (snapRoomRect).
 */
export function planRoomMove(room, x, z, rooms) {
  const rect = snapRoomRect({ x, z, width: room.width, depth: room.depth, floor: floorOf(room) }, rooms, {
    id: room.id, container: containerOf(room, rooms), translate: true,
  });
  return {
    rect: { x: rect.x, z: rect.z, width: rect.width, depth: rect.depth },
    blocker: roomRectBlocker(room, rect, rooms),
  };
}

/**
 * Validate an Inspector resize (about the room's centre) against enclosing
 * rooms and neighbouring rooms. The edges that move snap like everywhere else,
 * so the centre can move a little: use rect.x / rect.z too.
 */
export function planRoomResize(room, width, depth, rooms) {
  const edges = [
    ...(Math.abs(width - room.width) > GEOMETRY_EPSILON ? ['west', 'east'] : []),
    ...(Math.abs(depth - room.depth) > GEOMETRY_EPSILON ? ['south', 'north'] : []),
  ];
  const rect = snapRoomRect({ x: room.x, z: room.z, width, depth, floor: floorOf(room) }, rooms, {
    id: room.id, container: containerOf(room, rooms), edges,
  });
  return {
    rect: { x: rect.x, z: rect.z, width: rect.width, depth: rect.depth },
    blocker: roomRectBlocker(room, rect, rooms),
  };
}

function insideRoomFootprint(outer, inner) {
  if (floorOf(outer) !== floorOf(inner)) return false;
  return inner.x - inner.width / 2 >= outer.x - outer.width / 2 - GEOMETRY_EPSILON &&
    inner.x + inner.width / 2 <= outer.x + outer.width / 2 + GEOMETRY_EPSILON &&
    inner.z - inner.depth / 2 >= outer.z - outer.depth / 2 - GEOMETRY_EPSILON &&
    inner.z + inner.depth / 2 <= outer.z + outer.depth / 2 + GEOMETRY_EPSILON;
}

function pointInsideRoomInterior(room, point) {
  const halfWidth = room.width / 2 - WALL_THICKNESS;
  const halfDepth = room.depth / 2 - WALL_THICKNESS;
  return halfWidth > 0 && halfDepth > 0 &&
    point.x >= room.x - halfWidth - GEOMETRY_EPSILON &&
    point.x <= room.x + halfWidth + GEOMETRY_EPSILON &&
    point.z >= room.z - halfDepth - GEOMETRY_EPSILON &&
    point.z <= room.z + halfDepth + GEOMETRY_EPSILON;
}

/**
 * Nudge a new room's edges that land close to a neighbour's wall so the two
 * rooms sit exactly back-to-back (one wall thickness apart). Fully nested room
 * footprints are not neighbours for snapping purposes.
 */
export function snapRectToNeighbours(rect, rooms, tolerance = 0.35) {
  let x0 = rect.x - rect.width / 2;
  let x1 = rect.x + rect.width / 2;
  let z0 = rect.z - rect.depth / 2;
  let z1 = rect.z + rect.depth / 2;
  const T = WALL_THICKNESS;

  for (const r of rooms) {
    if (floorOf(r) !== floorOf(rect)) continue;
    if (insideRoomFootprint(r, rect) || insideRoomFootprint(rect, r)) continue;
    const rx0 = r.x - r.width / 2, rx1 = r.x + r.width / 2;
    const rz0 = r.z - r.depth / 2, rz1 = r.z + r.depth / 2;
    const zOverlap = Math.min(z1, rz1) - Math.max(z0, rz0) > 0.1;
    const xOverlap = Math.min(x1, rx1) - Math.max(x0, rx0) > 0.1;
    if (zOverlap) {
      if (Math.abs(x0 - rx1) < tolerance) x0 = rx1 + T;
      if (Math.abs(x1 - rx0) < tolerance) x1 = rx0 - T;
    }
    if (xOverlap) {
      if (Math.abs(z0 - rz1) < tolerance) z0 = rz1 + T;
      if (Math.abs(z1 - rz0) < tolerance) z1 = rz0 - T;
    }
  }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0 };
}

/** How close (metres) an edge must come to a wall on the floor below to snap onto it. */
export const OUTLINE_SNAP = 0.3;

/**
 * Line a room up with the rooms on the floor below: an edge that lands within
 * `tolerance` of a wall below moves exactly onto it, so walls stand on walls.
 * Only walls next to the edge count (their extent overlaps it); a corner
 * snaps because both of its edges do.
 */
export function snapRectToOutline(rect, belowRooms, tolerance = OUTLINE_SNAP) {
  let x0 = rect.x - rect.width / 2;
  let x1 = rect.x + rect.width / 2;
  let z0 = rect.z - rect.depth / 2;
  let z1 = rect.z + rect.depth / 2;
  const nearest = (v, candidates) => {
    let best = v;
    let dist = tolerance;
    for (const c of candidates) {
      if (Math.abs(c - v) < dist) { best = c; dist = Math.abs(c - v); }
    }
    return best;
  };
  const xs = [];
  const zs = [];
  for (const r of belowRooms) {
    const rx0 = r.x - r.width / 2, rx1 = r.x + r.width / 2;
    const rz0 = r.z - r.depth / 2, rz1 = r.z + r.depth / 2;
    if (Math.min(z1, rz1) - Math.max(z0, rz0) > -tolerance) xs.push(rx0, rx1);
    if (Math.min(x1, rx1) - Math.max(x0, rx0) > -tolerance) zs.push(rz0, rz1);
  }
  x0 = nearest(x0, xs); x1 = nearest(x1, xs);
  z0 = nearest(z0, zs); z1 = nearest(z1, zs);
  if (x1 - x0 < MIN_ROOM_SIZE - 1e-6 || z1 - z0 < MIN_ROOM_SIZE - 1e-6) return rect;
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0 };
}

// ── Snapping rooms (one rule for drawing, Stretch, wall drag, Inspector, moving) ──

/** How close (metres) an edge must come to a neighbour's wall, or its outer room's wall, to snap. */
export const ROOM_SNAP = 0.35;

/**
 * The room a room (or rectangle) stands in: the smallest other room on its
 * floor whose footprint holds it, or null. `room.id` itself never counts.
 */
export function containerOf(rect, rooms) {
  let best = null;
  for (const other of rooms) {
    if (other.id === rect.id || floorOf(other) !== floorOf(rect)) continue;
    if (!insideRoomFootprint(other, rect)) continue;
    if (other.width * other.depth <= rect.width * rect.depth + GEOMETRY_EPSILON) continue; // the same rectangle
    if (!best || other.width * other.depth < best.width * best.depth) best = other;
  }
  return best;
}

const EDGES = ['west', 'east', 'south', 'north'];

/**
 * Snap a room's rectangle, the same way wherever a room is drawn or changed:
 * - back to back (WALL_THICKNESS apart) onto rooms in the same room as it
 *   (inside the same outer room, or both outside): they then share one wall;
 *   rooms inside other rooms, or inside this one, are not neighbours;
 * - onto the wall of the room it stands in (`container`): that wall becomes
 *   its wall on that side; and the other way round, a room's edge onto the
 *   rooms standing inside it;
 * - else onto a wall of the floor below (`below`, OUTLINE_SNAP), so walls stand on walls.
 * The nearest wall within ROOM_SNAP wins. Nothing changes that isn't close.
 * @param {{x,z,width,depth,floor?}} rect
 * @param {object[]} rooms  rooms (any floors; only the rect's floor counts)
 * @param {{
 *   id?: string,              the room being changed (it and the rooms inside it are left out)
 *   container?: object|null,  the room it stands in (default: containerOf(rect))
 *   edges?: string[],         which edges may move (default all four; Stretch: the one being dragged)
 *   translate?: boolean,      move the whole rectangle instead (moving a room: its size stays)
 *   below?: object[]|null,    rooms on the floor below
 * }} [options]
 * @returns {{x,z,width,depth,floor}}
 */
export function snapRoomRect(rect, rooms, options = {}) {
  const { id = null, edges = EDGES, translate = false, below = null } = options;
  const floor = floorOf(rect);
  const T = WALL_THICKNESS;
  const same = rooms.filter((r) => r.id !== id && floorOf(r) === floor);
  const container = options.container !== undefined ? options.container : containerOf({ ...rect, id }, same);
  const containerId = container?.id ?? null;
  const parentOf = (r) => containerOf(r, rooms)?.id ?? null;
  const siblings = same.filter((r) => r.id !== containerId && !insideRoomFootprint(rect, r) &&
    !insideRoomFootprint(r, rect) && parentOf(r) === containerId);
  const children = id === null ? [] : same.filter((r) => parentOf(r) === id);

  const box = {
    west: rect.x - rect.width / 2, east: rect.x + rect.width / 2,
    south: rect.z - rect.depth / 2, north: rect.z + rect.depth / 2,
  };
  const edgesOf = (r) => ({
    west: r.x - r.width / 2, east: r.x + r.width / 2, south: r.z - r.depth / 2, north: r.z + r.depth / 2,
  });
  const overlapsAlong = (r, edge) => {
    const e = edgesOf(r);
    return edge === 'west' || edge === 'east'
      ? Math.min(box.north, e.north) - Math.max(box.south, e.south) > 0.1
      : Math.min(box.east, e.east) - Math.max(box.west, e.west) > 0.1;
  };
  // Where each edge could go: [value, tolerance] pairs, best first by kind
  const targets = (edge) => {
    const near = [];
    for (const r of siblings) {
      if (!overlapsAlong(r, edge)) continue;
      const e = edgesOf(r);
      if (edge === 'west') near.push(e.east + T);
      else if (edge === 'east') near.push(e.west - T);
      else if (edge === 'south') near.push(e.north + T);
      else near.push(e.south - T);
    }
    if (container) near.push(edgesOf(container)[edge]);
    for (const r of children) near.push(edgesOf(r)[edge]);
    const outline = [];
    if (below && !container) {
      for (const r of below) {
        const e = edgesOf(r);
        const along = edge === 'west' || edge === 'east'
          ? Math.min(box.north, e.north) - Math.max(box.south, e.south)
          : Math.min(box.east, e.east) - Math.max(box.west, e.west);
        if (along > -OUTLINE_SNAP) outline.push(...(edge === 'west' || edge === 'east' ? [e.west, e.east] : [e.south, e.north]));
      }
    }
    return { near, outline };
  };
  const nearestShift = (edge) => {
    const v = box[edge];
    const { near, outline } = targets(edge);
    const best = (list, tolerance) => list.reduce((acc, c) => {
      const d = c - v;
      return Math.abs(d) < tolerance && (acc === null || Math.abs(d) < Math.abs(acc)) ? d : acc;
    }, null);
    return best(near, ROOM_SNAP) ?? best(outline, OUTLINE_SNAP);
  };

  const next = { ...box };
  if (translate) {
    for (const [a, b] of [['west', 'east'], ['south', 'north']]) {
      const shifts = [nearestShift(a), nearestShift(b)].filter((d) => d !== null);
      if (!shifts.length) continue;
      const d = shifts.reduce((m, s) => (Math.abs(s) < Math.abs(m) ? s : m));
      next[a] += d;
      next[b] += d;
    }
  } else {
    for (const edge of edges) {
      const d = nearestShift(edge);
      if (d !== null) next[edge] = box[edge] + d;
    }
    // Never snap a room smaller than allowed: that axis stays as it was
    if (next.east - next.west < MIN_ROOM_SIZE - 1e-6) { next.west = box.west; next.east = box.east; }
    if (next.north - next.south < MIN_ROOM_SIZE - 1e-6) { next.south = box.south; next.north = box.north; }
  }
  return {
    x: (next.west + next.east) / 2, z: (next.south + next.north) / 2,
    width: next.east - next.west, depth: next.north - next.south, floor,
  };
}

/**
 * Where a door/window aimed at `point` on `room`'s `wallName` will go.
 * If a neighbour is built back-to-back there, the opening must fit BOTH walls
 * at the same spot (otherwise half the doorway would be blocked).
 *
 * @returns {{ offset:number, partner:null|{room,wallName}, partnerOffset:number|null } | { problem:string, partner }}
 */
export function placeOpening(rooms, room, wallName, point, width, margin = 0.15) {
  const alongX = wallName === 'north' || wallName === 'south';
  const centreOf = (r) => (alongX ? r.x : r.z);
  const rangeOf = (r, wall) => {
    const max = innerWallLength(r, wall) / 2 - width / 2 - margin;
    return max < 0 ? null : [centreOf(r) - max, centreOf(r) + max];
  };
  const partner = partnerWall(rooms, room, wallName, point, width);
  let range = rangeOf(room, wallName);
  if (range && partner) {
    const theirs = rangeOf(partner.room, partner.wallName);
    range = theirs ? [Math.max(range[0], theirs[0]), Math.min(range[1], theirs[1])] : null;
    if (range && range[0] > range[1]) range = null;
  }
  if (!range) {
    return { problem: partner ? `Not enough shared wall with ${partner.room.name} here` : 'This wall is too short', partner };
  }
  const along = Math.max(range[0], Math.min(range[1], alongX ? point.x : point.z));
  const offset = along - centreOf(room);
  const partnerOffset = partner ? along - centreOf(partner.room) : null;
  if (overlapsExisting(room, wallName, offset, width) ||
    (partner && overlapsExisting(partner.room, partner.wallName, partnerOffset, width))) {
    return { problem: 'Too close to another door or window', partner };
  }
  return { offset, partner, partnerOffset };
}

// ── Stretching a room (push / pull one wall) ──────────────────────────────

const ALONG_X = (wallName) => wallName === 'north' || wallName === 'south';

/** World coordinate of a room's wall (X for east/west, Z for north/south). */
export function wallCoordinate(room, wallName) {
  return wallLine(room, wallName).value;
}

/**
 * Move ONE wall of a room to `target` (a world X for east/west walls, a world Z
 * for north/south walls) and work out the room's new shape.
 *
 * - The opposite wall stays where it is.
 * - Doors/windows on the two side walls keep their place in the world
 *   (their offsets are re-measured from the new centre).
 * - Lands back-to-back on a neighbour's wall if released close to it.
 *
 * @param {object} room                  room from the store
 * @param {'north'|'south'|'east'|'west'} wallName
 * @param {number} target                where the wall should go
 * @param {{ rooms?: object[], objects?: object[], nameOf?: (obj) => string }} [context]
 *        rooms on the same floor (to avoid overlaps), objects (to avoid cutting through furniture)
 * @returns {{ rect, patch, delta:number, problem:string|null }}
 *          patch: {x, z, width, depth, doors, windows} ready for updateRoom
 *          delta: how far the wall moved outward (negative = room got smaller)
 */
export function stretchRoom(room, wallName, target, context = {}) {
  const { rooms = [], objects = [], below = null, nameOf = (o) => o.label || o.name || 'An item' } = context;
  const others = rooms.filter((r) => r.id !== room.id && floorOf(r) === floorOf(room));

  let x0 = room.x - room.width / 2;
  let x1 = room.x + room.width / 2;
  let z0 = room.z - room.depth / 2;
  let z1 = room.z + room.depth / 2;

  if (wallName === 'east') x1 = target;
  else if (wallName === 'west') x0 = target;
  else if (wallName === 'north') z1 = target;
  else z0 = target;

  // Back to back with a neighbour, onto the wall of the room it stands in, or
  // over a wall of the floor below? Only the moving edge is allowed to snap.
  const moved = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, floor: floorOf(room) };
  const snapped = snapRoomRect(moved, rooms, {
    id: room.id, container: containerOf(room, rooms), edges: [wallName], below,
  });
  const sx0 = snapped.x - snapped.width / 2, sx1 = snapped.x + snapped.width / 2;
  const sz0 = snapped.z - snapped.depth / 2, sz1 = snapped.z + snapped.depth / 2;
  if (wallName === 'east') x1 = sx1;
  else if (wallName === 'west') x0 = sx0;
  else if (wallName === 'north') z1 = sz1;
  else z0 = sz0;

  const rect = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, floor: floorOf(room) };
  const before = wallCoordinate(room, wallName);
  const after = wallName === 'east' ? x1 : wallName === 'west' ? x0 : wallName === 'north' ? z1 : z0;
  const delta = wallName === 'east' || wallName === 'north' ? after - before : before - after;

  // Doors/windows: the moving wall's own openings ride along with it (their
  // offset is along the wall, which doesn't change). Openings on the two
  // side walls must stay put in the world, so re-measure from the new centre.
  const shift = ALONG_X(wallName) ? rect.z - room.z : rect.x - room.x;
  const sideWalls = ALONG_X(wallName) ? ['east', 'west'] : ['north', 'south'];
  const sideLength = ALONG_X(wallName) ? rect.depth : rect.width;
  let problem = null;

  const moveOpenings = (list, kind) => (list ?? []).map((o) => {
    if (!sideWalls.includes(o.wall)) return o;
    const offset = (o.offset ?? 0) - shift;
    const width = o.width ?? (kind === 'door' ? DOOR_DEFAULTS.width : WINDOW_DEFAULTS.width);
    if (!problem && Math.abs(offset) + width / 2 > sideLength / 2 - 0.05) {
      problem = `The ${kind} on the ${o.wall} wall is in the way`;
    }
    return { ...o, offset };
  });
  const doors = moveOpenings(room.doors, 'door');
  const windows = moveOpenings(room.windows, 'window');

  if (rect.width < MIN_ROOM_SIZE - 1e-6 || rect.depth < MIN_ROOM_SIZE - 1e-6) {
    problem = `Too small (rooms are at least ${MIN_ROOM_SIZE} m)`;
  }
  if (!problem) {
    const blocker = roomRectBlocker(room, rect, others);
    if (blocker) problem = `Would overlap ${blocker.name}`;
  }
  if (!problem && delta < 0) {
    // Shrinking: don't cut through furniture that belongs to this room
    const margin = 0.1;
    const outside = objects.find((o) => o.roomId === room.id && (
      o.x < rect.x - rect.width / 2 + margin || o.x > rect.x + rect.width / 2 - margin ||
      o.z < rect.z - rect.depth / 2 + margin || o.z > rect.z + rect.depth / 2 - margin));
    if (outside) problem = `${nameOf(outside)} is in the way`;
  }

  return {
    rect: { x: rect.x, z: rect.z, width: rect.width, depth: rect.depth },
    delta,
    problem,
    overhang: !!below && overhangs(rect, below),
    patch: { x: rect.x, z: rect.z, width: rect.width, depth: rect.depth, doors, windows },
  };
}

// ── Build actions shared by Build mode and the planner ────────────────────
// Both modes aim differently (crosshair vs mouse) but decide WHAT to build the
// same way, with these functions.

/**
 * A new room drawn from corner `a` to corner `b`: the rectangle (lined up with
 * the walls of the floor below, and snapped back-to-back onto neighbours) and
 * the room it would overlap, if any.
 * @param {object[]} rooms        rooms on the same floor
 * @param {object[]|null} [below] rooms on the floor below (null on the ground floor)
 * @returns {{ rect: {x,z,width,depth}, blocker: object|null, overhang: boolean }}
 *          overhang: part of the room has nothing under it (allowed, but worth a warning)
 */
export function planRoom(a, b, rooms, below = null) {
  const placementFloor = rooms[0] ? floorOf(rooms[0]) : 0;
  const drawn = { ...rectFromCorners(a, b), floor: placementFloor };
  // Drawn inside a room (it holds the rectangle, or a corner or the middle is
  // inside it): that room is its container, the smallest if several
  const container = rooms.filter((room) =>
    floorOf(room) === placementFloor && (
      insideRoomFootprint(room, drawn) ||
      pointInsideRoomInterior(room, a) ||
      pointInsideRoomInterior(room, b) ||
      pointInsideRoomInterior(room, drawn)
    )).sort((p, q) => p.width * p.depth - q.width * q.depth)[0] ?? null;
  const rect = snapRoomRect(drawn, rooms, { container, below });
  const blocker = roomPlacementBlocker(rect, rooms);
  return {
    rect: { x: rect.x, z: rect.z, width: rect.width, depth: rect.depth },
    blocker,
    overhang: !!below && overhangs(rect, below),
  };
}

/** Hint text for a room on an upper floor that sticks out past the floor below. */
export const OVERHANG_WARNING = 'Part of it has nothing under it';

/**
 * A door or window aimed at `point` on a room's wall.
 * @returns {{ problem: string, partner } |
 *           { problem: null, offset: number, partner, defaults, list: object[] }}
 *   list: ready for editorHistory.addOpenings (includes the back-to-back neighbour's wall)
 */
export function planOpening(rooms, room, wallName, point, kind) {
  const defaults = kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  const spot = placeOpening(rooms, room, wallName, point, defaults.width);
  const { partner } = spot;
  let problem = spot.problem ?? null;
  if (!problem && kind === 'window' && (room.wallHeight ?? 3) < defaults.sill + defaults.height + 0.1) {
    problem = 'This wall is too low for a window';
  }
  if (problem) return { problem, partner, defaults };
  const opening = kind === 'door'
    ? { width: defaults.width, height: defaults.height }
    : { width: defaults.width, height: defaults.height, sill: defaults.sill };
  const list = [{ roomId: room.id, kind, wall: wallName, offset: spot.offset, ...opening }];
  if (partner) {
    list.push({ roomId: partner.room.id, kind, wall: partner.wallName, offset: spot.partnerOffset, ...opening });
  }
  return { problem: null, offset: spot.offset, partner, defaults, list };
}

/**
 * Removing the door/window `index` of `kind` on a room's wall, clicked at
 * `point`: that opening plus the matching one in a back-to-back neighbour.
 * @returns {object[]} ready for editorHistory.removeOpenings
 */
export function planRemoveOpening(rooms, room, wallName, point, kind, index) {
  const list = [{ roomId: room.id, kind, index }];
  const partner = partnerWall(rooms, room, wallName, point);
  if (partner) {
    const o = openingAt(partner.room, partner.wallName, point);
    if (o && o.kind === kind) list.push({ roomId: partner.room.id, kind: o.kind, index: o.index });
  }
  return list;
}

/**
 * A free-standing wall from `a` to `b` as WALL_SEGMENT object data
 * (add `floor` and `category` before saving).
 * @returns {{ data: object, length: number }}
 */
export function wallSegmentData(a, b, rooms) {
  const t = wallSegmentTransform(a, b);
  const room = findRoomAt(rooms, t.x, t.z);
  return {
    length: t.length,
    data: {
      assetType: 'WALL_SEGMENT',
      x: t.x, y: 0, z: t.z,
      rotationY: t.rotationY,
      scaleX: t.scaleX,
      roomId: room?.id ?? null,
      label: `Wall ${t.length.toFixed(1)} m`,
    },
  };
}

/** Item size limits for resizing (scale factor). */
export const MIN_ITEM_SCALE = 0.2;
export const MAX_ITEM_SCALE = 5;

/**
 * Make an item bigger or smaller by `factor`, keeping its proportions.
 * Returns the new {scaleX, scaleY, scaleZ}, or null if it would go past the limits.
 */
export function resizeItem(obj, factor) {
  const s = [obj.scaleX ?? 1, obj.scaleY ?? 1, obj.scaleZ ?? 1].map((v) => v * factor);
  if (s.some((v) => v < MIN_ITEM_SCALE - 1e-9 || v > MAX_ITEM_SCALE + 1e-9)) return null;
  const r = (v) => Math.round(v * 1000) / 1000;
  return { scaleX: r(s[0]), scaleY: r(s[1]), scaleZ: r(s[2]) };
}

// ── Door / window size ────────────────────────────────────────────────────
// Doors and windows are openings in a room wall. Their size is editable in
// both modes (Preview's Edit item, Studio's Inspector and drag handles) with
// the same limits, decided here.

/** One + / − press changes a size by this much (metres). */
export const OPENING_STEP = 0.1;
/** An opening stays this far from each end of its wall. */
export const OPENING_CORNER_GAP = 0.1;
/** Space kept between two openings on one wall (same as when adding one). */
export const OPENING_GAP = 0.2;
/** Smallest sizes, and how far below the top of the wall an opening must stop. */
export const OPENING_LIMITS = {
  door: { minWidth: 0.6, minHeight: 1.8, topGap: 0.1, label: 'Door' },
  window: { minWidth: 0.4, minHeight: 0.4, topGap: 0.1, label: 'Window' },
};
/** Space a door needs in front of and behind it (stairs must not be there). */
const DOOR_CLEARANCE = 0.5;

const LIST_OF = { door: 'doors', window: 'windows' };
const round2 = (v) => Math.round(v * 100) / 100;

/** "Door 0.9 × 2.1 m" */
export function formatOpeningSize(kind, width, height) {
  return `${OPENING_LIMITS[kind]?.label ?? 'Opening'} ${width.toFixed(1)} × ${height.toFixed(1)} m`;
}

/**
 * A door/window as stored, with every field filled in (old saves have no
 * height or sill). null if the room has no such opening.
 * @returns {{ wall, offset, width, height, sill } | null}
 */
export function openingData(room, kind, index) {
  const o = room?.[LIST_OF[kind]]?.[index];
  if (!o) return null;
  const d = kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  return {
    ...o,
    wall: o.wall ?? 'north',
    offset: o.offset ?? 0,
    width: o.width ?? d.width,
    height: o.height ?? d.height,
    sill: kind === 'door' ? 0 : (o.sill ?? d.sill),
  };
}

/** World point in the middle of an opening, at floor level. */
export function openingCentre(room, wallName, offset) {
  const line = wallLine(room, wallName);
  return line.axis === 'z'
    ? { x: room.x + offset, z: line.value }
    : { x: line.value, z: room.z + offset };
}

/**
 * The same door/window seen from a back-to-back neighbour (a door between two
 * rooms is stored once in each room). null if it is not shared.
 * @returns {{ room, index } | null}
 */
export function openingPartner(rooms, room, kind, index) {
  const o = openingData(room, kind, index);
  if (!o) return null;
  const point = openingCentre(room, o.wall, o.offset);
  const partner = partnerWall(rooms, room, o.wall, point);
  if (!partner) return null;
  const match = openingAt(partner.room, partner.wallName, point);
  return match && match.kind === kind ? { room: partner.room, index: match.index } : null;
}

/** Why an opening of this size can't be in this room's wall, or null if it fits. */
function openingProblem(room, kind, index, wall, offset, width, height, sill, stairRects) {
  const lim = OPENING_LIMITS[kind];
  const label = lim.label;
  const wallHeight = room.wallHeight ?? 3;
  const eps = 1e-6;
  if (width < lim.minWidth - eps) return `${label}s are at least ${lim.minWidth.toFixed(1)} m wide`;
  if (height < lim.minHeight - eps) return `${label}s are at least ${lim.minHeight.toFixed(1)} m high`;
  const maxTop = wallHeight - lim.topGap;
  if (sill + height > maxTop + eps) {
    return kind === 'door'
      ? `Doors can be at most ${maxTop.toFixed(1)} m high on this wall`
      : 'The window would reach the top of the wall';
  }
  const half = innerWallLength(room, wall) / 2 - OPENING_CORNER_GAP;
  if (width > 2 * half + eps) return `Too wide for this ${innerWallLength(room, wall).toFixed(1)} m wall`;
  if (Math.abs(offset) + width / 2 > half + eps) return 'Too close to the corner of the room';
  const clash = roomOpenings(room).find((o) => o.wall === wall && !(o.kind === kind && o.index === index) &&
    Math.abs(o.offset - offset) < (o.width + width) / 2 + OPENING_GAP - eps);
  if (clash) return `Too close to the ${clash.kind} next to it`;
  // Stairs: a door needs free space on both sides; nothing may be in the wall itself
  const line = wallLine(room, wall);
  const along = (line.axis === 'z' ? room.x : room.z) + offset;
  const depth = kind === 'door' ? DOOR_CLEARANCE : WALL_THICKNESS / 2;
  const a0 = along - width / 2;
  const a1 = along + width / 2;
  const n0 = line.value - depth;
  const n1 = line.value + depth;
  const hitsStairs = stairRects.some((r) => {
    const [r0, r1, s0, s1] = line.axis === 'z' ? [r.x0, r.x1, r.z0, r.z1] : [r.z0, r.z1, r.x0, r.x1];
    return Math.min(a1, r1) - Math.max(a0, r0) > eps && Math.min(n1, s1) - Math.max(n0, s0) > eps;
  });
  if (hitsStairs) return 'The stairs are in the way';
  return null;
}

/**
 * Change the size of a door/window, and of the same opening in a back-to-back
 * neighbour (the two always stay the same size).
 *
 * @param {object[]} rooms   rooms on the same floor (to find the neighbour)
 * @param {object}   room
 * @param {'door'|'window'} kind
 * @param {number}   index   position in room.doors / room.windows
 * @param {{ width?: number, height?: number, keep?: 'centre'|'start'|'end' }} change
 *        keep: what stays put while the width changes: the centre (both sides
 *        move), the start side (lower offset) or the end side. Height grows upwards.
 * @param {{ stairs?: object[] }} [context]  staircase objects (only those on the room's floor count)
 * @returns {{ problem: string|null, width: number, height: number, list: {roomId, kind, index, patch}[] }}
 *          On a problem, width/height are the CURRENT size and list is empty.
 *          list is ready for editorHistory.resizeOpening.
 */
export function resizeOpening(rooms, room, kind, index, change = {}, { stairs = [] } = {}) {
  const o = openingData(room, kind, index);
  if (!o) return { problem: `This ${kind} is gone`, width: 0, height: 0, list: [] };
  const width = round2(change.width ?? o.width);
  const height = round2(change.height ?? o.height);
  const keep = change.keep ?? 'centre';
  const start = o.offset - o.width / 2;
  const end = o.offset + o.width / 2;
  const offset = keep === 'start' ? start + width / 2 : keep === 'end' ? end - width / 2 : o.offset;
  const shift = offset - o.offset;
  const fail = (problem) => ({ problem, width: o.width, height: o.height, list: [] });

  const stairRects = stairs
    .filter((s) => (s.floor ?? 0) === (room.floor ?? 0))
    .map((s) => stairOpening(s, undefined, 0));
  const targets = [{ room, index }];
  const partner = openingPartner(rooms, room, kind, index);
  if (partner) targets.push(partner);

  const list = [];
  for (const t of targets) {
    const mine = openingData(t.room, kind, t.index);
    const newOffset = round2(mine.offset + shift);
    const problem = openingProblem(t.room, kind, t.index, mine.wall, newOffset, width, height, mine.sill, stairRects);
    if (problem) return fail(t.room === room ? problem : `${problem} (in ${t.room.name})`);
    list.push({ roomId: t.room.id, kind, index: t.index, patch: { offset: newOffset, width, height } });
  }
  return { problem: null, width, height, list };
}

/** Back to the standard size (door 1.0 × 2.1 m, window 1.4 × 1.2 m), keeping its centre. */
export function resetOpeningSize(rooms, room, kind, index, context) {
  const d = kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  return resizeOpening(rooms, room, kind, index, { width: d.width, height: d.height }, context);
}
