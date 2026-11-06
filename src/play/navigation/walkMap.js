/**
 * play/navigation/walkMap.js
 *
 * PURE: the walk map of one floor, a grid of 0.1 m cells made from the LAYOUT
 * DATA (rooms, their walls and doors, solid items), not from meshes. A cell is
 * FREE when the walking body's centre fits there: standing on something (a
 * room's floor, or the ground around the building on the ground floor) and at
 * least CLEARANCE (the body's radius 0.32 m + 0.05 m) from every wall and
 * every solid item.
 *
 * The walls are exactly the ones utils/roomBuilder.js builds (the same
 * roomWallSegments / wallSegmentOpenings / splitWall, so shared walls are
 * counted once and a door through a shared wall opens both rooms), with their
 * skirting. Only doors cut the walls: windows have glass (it collides).
 * Items block as utils/assetInstances + ObjectSystem make them collide: every
 * item except markers, staircases and `solid: false` ones (rugs), as its
 * catalogue footprint × scale, turned. Seated people never block.
 *
 * The distance to each wall / item is measured exactly (from each cell's centre
 * to the obstacle's rectangle), so a 1 m door leaves a ~0.26 m wide strip. In a
 * door gap the cells on the door's centre line are tested on that line, so a
 * 0.8 m door (a 0.06 m strip, narrower than a cell) is open, as it is for the
 * real collision, and a 0.7 m one is closed (the body is 0.64 m wide, plus the
 * margin).
 *
 * Used by entrance.js (where the walkthrough starts, nearestFree) and
 * play/playController.js. No Babylon. Tests: navigation/__tests__/walkMap.test.js.
 */

import {
  roomWalls, roomWallSegments, wallSegmentOpenings, splitWall, wallThicknessOf,
} from '../geometry';
import {
  floorsInOrder, floorBelow, stairOpening, stairDimsFor, rectContains, roomRect,
} from '../building';

/** Cell size (m): a 1 m door minus the body leaves ~3 cells; narrower doors are opened along their centre line. */
export const CELL = 0.1;
/** The walking body (playController's collider ellipsoid): radius and height. */
export const BODY_RADIUS = 0.32;
export const BODY_HEIGHT = 1.8;
/** Kept clear around the body. */
export const BODY_MARGIN = 0.05;
/** How far the body's centre stays from walls and solid items. */
export const CLEARANCE = BODY_RADIUS + BODY_MARGIN;
/** On the ground floor you can walk this far around the building (the street in front of the entrance). */
export const STREET = 10;
/** Skirting sticks out of the wall this much on each side (roomBuilder: wall thickness + 0.03), and collides. */
export const SKIRTING_OUT = 0.015;
/** A bigger floor gets bigger cells, so a map stays ≤ ~2.5 MB. */
export const MAX_CELLS = 2_500_000;

/** Cell values. */
export const BLOCKED = 0; // a wall or a solid item is closer than CLEARANCE
export const FREE = 1;    // the body fits, standing on a floor (or the ground)
export const STAIRS = 2;  // on a staircase's flight (walkable, but not a place to start)
export const VOID = 3;    // nothing in the way, but nothing to stand on (outside the rooms of an upper floor, a stair opening)

const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const floorOf = (r) => r.floor ?? r.floorId ?? 0;

/** The ground floor's id: the lowest floor (always 0 in saves; 0 with no floors). */
export function groundFloorId(floors) {
  return floorsInOrder(floors)[0]?.id ?? 0;
}

/**
 * Does this item block the walking body? As ObjectSystem makes it collide:
 * not markers (spawn point, zones), not staircases (walked on), not
 * `solid: false` (rugs); and not if it hangs above the body (y ≥ 1.8 m).
 * @param {object} obj  store item (assetType, y relative to its floor)
 * @param {Record<string, { category?: string, solid?: boolean }>} catalog  ASSET_TYPES
 */
export function isSolidItem(obj, catalog = {}) {
  if (!obj || obj.assetType === 'STAIRCASE') return false;
  const def = catalog[obj.assetType];
  if (def?.category === 'Marker' || def?.solid === false) return false;
  return !((obj.y ?? 0) >= BODY_HEIGHT);
}

/**
 * Items whose model is bigger than its catalogue size (width × depth, m, centred: covers the
 * model both ways). footprints.test.js measures every item's model and fails if one is missing here.
 */
export const MODEL_SIZES = {
  COLUMN: { width: 0.56, depth: 0.56 },
  SOFA_3SEAT: { width: 2.4, depth: 0.9 },
  WHITEBOARD: { width: 2, depth: 0.18 },
  PLANT_LARGE: { width: 0.68, depth: 0.68 },
  CNC_MACHINE: { width: 2.2, depth: 1.96 },
};

/**
 * The rectangle an item blocks (world x, z; half sizes along its own axes; turned by rotationY).
 * An item type the catalogue doesn't know counts as 1 × 1 m.
 */
export function itemFootprint(obj, catalog = {}) {
  const def = catalog[obj.assetType] ?? {};
  const size = MODEL_SIZES[obj.assetType];
  return {
    x: obj.x ?? 0,
    z: obj.z ?? 0,
    hw: ((size?.width ?? def.defaultWidth ?? 1) * Math.abs(obj.scaleX ?? obj.scale?.x ?? 1)) / 2,
    hd: ((size?.depth ?? def.defaultDepth ?? 1) * Math.abs(obj.scaleZ ?? obj.scale?.z ?? 1)) / 2,
    rot: obj.rotationY ?? 0,
    kind: 'item',
    objectId: obj.id,
  };
}

/**
 * The wall pieces of a floor that block walking, as axis-aligned rectangles
 * ({ x, z, hw, hd, rot: 0, kind: 'wall', roomId }): each room's own walls and
 * the shared walls it builds (once per pair), cut by doors (its own and its
 * neighbour's), not by windows; the pieces above doors are left out.
 * @param {object[]} rooms  the rooms of ONE floor (store shape)
 */
export function wallObstacles(rooms) {
  return wallsAndDoors(rooms).walls;
}

/**
 * The door gaps of a floor's walls ({ x, z, alongX, width, depth }: the gap's
 * centre, the wall's direction, the door's width along it, the wall's
 * thickness with skirting across it). A door stored on both rooms of a shared
 * wall can be listed twice (harmless).
 * @param {object[]} rooms  the rooms of ONE floor (store shape)
 */
export function doorGaps(rooms) {
  return wallsAndDoors(rooms).doors;
}

function wallsAndDoors(rooms) {
  const out = [];
  const gaps = [];
  for (const room of rooms) {
    const T = wallThicknessOf(room);
    for (const wall of roomWalls(room)) {
      for (const segment of roomWallSegments(room, wall.name, rooms)) {
        const segmentCentre = (segment.u0 + segment.u1) / 2;
        const segmentLength = segment.u1 - segment.u0;
        const thickness = (segment.shared ? segment.thickness : T) + 2 * SKIRTING_OUT;
        const doors = wallSegmentOpenings(room, wall.name, segment)
          .filter((o) => o.kind === 'door')
          .map((o) => ({ ...o, offset: o.offset - segmentCentre }));
        const height = Math.max(room.wallHeight ?? 3, BODY_HEIGHT + 1);
        const wallCx = wall.cx + (wall.alongX ? 0 : segment.crossOffset);
        const wallCz = wall.cz + (wall.alongX ? segment.crossOffset : 0);
        for (const d of doors) {
          if ((d.top ?? 2.1) < BODY_HEIGHT - 1e-6) continue; // too low to walk under
          const mid = d.offset + segmentCentre;
          gaps.push({
            x: room.x + (wall.alongX ? wallCx + mid : wallCx),
            z: room.z + (wall.alongX ? wallCz : wallCz + mid),
            alongX: wall.alongX,
            width: d.width ?? 1,
            depth: thickness,
          });
        }
        for (const p of splitWall(segmentLength, height, doors)) {
          if (p.y0 >= BODY_HEIGHT - 1e-6) continue; // over a door: you walk under it
          const mid = (p.u0 + p.u1) / 2 + segmentCentre;
          const len = p.u1 - p.u0;
          out.push({
            x: room.x + (wall.alongX ? wallCx + mid : wallCx),
            z: room.z + (wall.alongX ? wallCz : wallCz + mid),
            hw: wall.alongX ? len / 2 : thickness / 2,
            hd: wall.alongX ? thickness / 2 : len / 2,
            rot: 0,
            kind: 'wall',
            roomId: room.id,
          });
        }
      }
    }
  }
  return { walls: out, doors: gaps };
}

/** Solid items of one floor as rectangles (itemFootprint). */
export function itemObstacles(objects, floorId, catalog = {}) {
  return objects
    .filter((o) => floorOf(o) === floorId && isSolidItem(o, catalog))
    .map((o) => itemFootprint(o, catalog));
}

/** A rectangle turned by rot (Babylon: local +X → (cos, −sin)), as staircases and items are. */
function toLocal(rect, x, z) {
  const c = Math.cos(rect.rot);
  const s = Math.sin(rect.rot);
  const dx = x - rect.x;
  const dz = z - rect.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/** The axis-aligned box around a turned rectangle, grown by `grow`. */
function rectBounds(rect, grow = 0) {
  const c = Math.abs(Math.cos(rect.rot));
  const s = Math.abs(Math.sin(rect.rot));
  const ex = rect.hw * c + rect.hd * s + grow;
  const ez = rect.hw * s + rect.hd * c + grow;
  return { x0: rect.x - ex, x1: rect.x + ex, z0: rect.z - ez, z1: rect.z + ez };
}

/** Distance (m) from a point to a (turned) rectangle; 0 inside it. */
export function distanceToRect(rect, x, z) {
  const { lx, lz } = toLocal(rect, x, z);
  const dx = Math.max(Math.abs(lx) - rect.hw, 0);
  const dz = Math.max(Math.abs(lz) - rect.hd, 0);
  return Math.hypot(dx, dz);
}

/**
 * Build the walk map of one floor.
 * @param {{ rooms, objects, floors }} layout  store shape (arrays or records; v1 field names)
 * @param {number} floorId
 * @param {{ catalog?: object, cell?: number, clearance?: number, street?: number }} [options]
 *   catalog: ASSET_TYPES (item sizes, solid or not)
 * @returns {WalkMap}
 */
export function buildWalkMap(layout, floorId, options = {}) {
  const { catalog = {}, clearance = CLEARANCE, street = STREET } = options;
  const rooms = list(layout.rooms).filter((r) => floorOf(r) === floorId);
  const objects = list(layout.objects);
  const floors = layout.floors ?? {};
  const ground = floorId === groundFloorId(floors);
  const { walls, doors } = wallsAndDoors(rooms);
  const items = itemObstacles(objects, floorId, catalog);
  const obstacles = [...walls, ...items];

  // Bounds: the rooms (and items) of this floor; the ground floor adds the street around them
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (b) => { x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1); };
  for (const r of rooms) {
    const t = wallThicknessOf(r) / 2 + SKIRTING_OUT;
    take({ x0: r.x - r.width / 2 - t, x1: r.x + r.width / 2 + t, z0: r.z - r.depth / 2 - t, z1: r.z + r.depth / 2 + t });
  }
  for (const it of items) take(rectBounds(it));
  if (x0 > x1) take({ x0: 0, x1: 0, z0: 0, z1: 0 }); // nothing here: around the origin
  const margin = ground ? street : 1;
  x0 -= margin; x1 += margin; z0 -= margin; z1 += margin;

  let cell = options.cell ?? CELL;
  const area = (x1 - x0) * (z1 - z0);
  if (area / (cell * cell) > MAX_CELLS) cell = Math.ceil(Math.sqrt(area / MAX_CELLS) * 20) / 20;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell));
  const rows = Math.max(1, Math.ceil((z1 - z0) / cell));
  const cells = new Uint8Array(cols * rows);
  const cx = (i) => x0 + (i + 0.5) * cell;
  const cz = (j) => z0 + (j + 0.5) * cell;

  /** Every cell whose centre is in the box: fn(index, x, z). */
  const forBox = (b, fn) => {
    const i0 = Math.max(0, Math.floor((b.x0 - x0) / cell));
    const i1 = Math.min(cols - 1, Math.ceil((b.x1 - x0) / cell));
    const j0 = Math.max(0, Math.floor((b.z0 - z0) / cell));
    const j1 = Math.min(rows - 1, Math.ceil((b.z1 - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = cz(j);
      for (let i = i0; i <= i1; i++) fn(j * cols + i, cx(i), z);
    }
  };

  // 1. Something to stand on: the ground floor everywhere; an upper floor in its rooms
  cells.fill(ground ? FREE : VOID);
  if (!ground) {
    for (const r of rooms) {
      const rect = roomRect(r);
      forBox(rect, (k, x, z) => { if (rectContains(rect, x, z)) cells[k] = FREE; });
    }
  }
  // 2. The openings for stairs coming up from the floor below: nothing to stand on
  const below = floorBelow(floors, floorId);
  const stairs = objects.filter((o) => o.assetType === 'STAIRCASE');
  if (below) {
    for (const s of stairs.filter((o) => floorOf(o) === below.id)) {
      const hole = stairOpening(s, stairDimsFor(floors, s));
      forBox(hole, (k, x, z) => { if (rectContains(hole, x, z)) cells[k] = VOID; });
    }
  }
  // 3. Staircases starting on this floor: walkable, not a place to start
  for (const s of stairs.filter((o) => floorOf(o) === floorId)) {
    const dims = stairDimsFor(floors, s);
    const rect = { x: s.x, z: s.z, hw: dims.width / 2, hd: dims.length / 2, rot: s.rotationY ?? 0 };
    forBox(rectBounds(rect), (k, x, z) => {
      if (cells[k] === FREE && distanceToRect(rect, x, z) === 0) cells[k] = STAIRS;
    });
  }
  // 4. Walls and solid items, grown by the clearance (exact distance from each cell's centre)
  const standing = cells.slice(); // each cell before walls and items (for step 5)
  const c2 = clearance * clearance;
  for (const o of obstacles) {
    const cos = Math.cos(o.rot);
    const sin = Math.sin(o.rot);
    forBox(rectBounds(o, clearance), (k, x, z) => {
      if (cells[k] === BLOCKED) return;
      const dx = x - o.x;
      const dz = z - o.z;
      const ex = Math.max(Math.abs(dx * cos - dz * sin) - o.hw, 0);
      const ez = Math.max(Math.abs(dx * sin + dz * cos) - o.hd, 0);
      if (ex * ex + ez * ez < c2) cells[k] = BLOCKED;
    });
  }
  // 5. Door passages: a narrow door's free strip (a 0.8 m door: 0.06 m wide) can fall between two
  //    cell centres. The cells a door's centre line crosses are tested at the point ON that line
  //    (level with the cell's centre, exactly, against every wall and item), so a door the body
  //    fits through is open on the map. Everything else stays measured from cell centres.
  for (const d of doors) {
    if (d.width / 2 < clearance) continue; // the body can't pass (0.7 m doors and narrower)
    const reach = d.depth / 2 + clearance + cell;
    const box = d.alongX
      ? { x0: d.x, x1: d.x, z0: d.z - reach, z1: d.z + reach }
      : { x0: d.x - reach, x1: d.x + reach, z0: d.z, z1: d.z };
    const near = obstacles.filter((o) => {
      const b = rectBounds(o, clearance);
      return b.x0 <= box.x1 && b.x1 >= box.x0 && b.z0 <= box.z1 && b.z1 >= box.z0;
    });
    const steps = Math.ceil((4 * reach) / cell);
    for (let n = 0; n <= steps; n++) {
      const t = -reach + (n * 2 * reach) / steps;
      const i = Math.floor(((d.alongX ? d.x : d.x + t) - x0) / cell);
      const j = Math.floor(((d.alongX ? d.z + t : d.z) - z0) / cell);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      if (cells[k] !== BLOCKED || standing[k] === BLOCKED) continue;
      const qx = d.alongX ? d.x : cx(i);
      const qz = d.alongX ? cz(j) : d.z;
      if (near.every((o) => distanceToRect(o, qx, qz) >= clearance)) cells[k] = standing[k];
    }
  }

  const indexOf = (x, z) => {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((z - z0) / cell);
    return i < 0 || j < 0 || i >= cols || j >= rows ? -1 : j * cols + i;
  };
  /** @type {WalkMap} */
  return {
    floor: floorId,
    ground,
    cell,
    clearance,
    x0, z0, cols, rows,
    cells,
    obstacles,
    rooms,
    /** The cell value at a world point (outside the map: VOID). */
    at(x, z) {
      const k = indexOf(x, z);
      return k < 0 ? VOID : cells[k];
    },
    /** Does the body fit here, standing (FREE; `stairs: true` also on a staircase)? */
    isFree(x, z, { stairs: onStairs = false } = {}) {
      const v = this.at(x, z);
      return v === FREE || (onStairs && v === STAIRS);
    },
    /** The centre of the cell a point is in (null outside the map). */
    cellCentre(x, z) {
      const k = indexOf(x, z);
      return k < 0 ? null : { x: cx(k % cols), z: cz(Math.floor(k / cols)) };
    },
    indexOf,
    centreOf: (k) => ({ x: cx(k % cols), z: cz(Math.floor(k / cols)) }),
  };
}

/**
 * Walk maps, built when first asked for and kept until the layout changes
 * (rooms, objects or floors: the store's records are replaced when edited, so
 * comparing them one by one is enough and costs microseconds).
 * @param {{ catalog?: object }} [options]
 */
export function createWalkMapCache(options = {}) {
  let rooms = null;
  let objects = null;
  let floors = null;
  let maps = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  return {
    /** The walk map of a floor of this layout (built now if the layout changed). */
    get(layout, floorId) {
      const r = list(layout.rooms);
      const o = list(layout.objects);
      if (!same(r, rooms) || !same(o, objects) || layout.floors !== floors) {
        rooms = r; objects = o; floors = layout.floors; maps = new Map();
      }
      if (!maps.has(floorId)) maps.set(floorId, buildWalkMap(layout, floorId, options));
      return maps.get(floorId);
    },
    clear() { rooms = null; objects = null; floors = null; maps = new Map(); },
  };
}

/**
 * @typedef {object} WalkMap
 * @property {number} floor
 * @property {boolean} ground   the ground floor (you can walk around the building)
 * @property {number} cell      cell size (m)
 * @property {number} clearance
 * @property {number} x0  @property {number} z0  world corner of cell (0, 0)
 * @property {number} cols @property {number} rows
 * @property {Uint8Array} cells  BLOCKED | FREE | STAIRS | VOID, row by row (z), index j * cols + i
 * @property {object[]} obstacles  walls and solid items ({ x, z, hw, hd, rot, kind })
 * @property {object[]} rooms   the floor's rooms
 * @property {(x:number, z:number) => number} at
 * @property {(x:number, z:number, o?: { stairs?: boolean }) => boolean} isFree
 */
