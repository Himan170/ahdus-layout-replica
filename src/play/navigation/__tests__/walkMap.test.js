import { describe, it, expect } from 'vitest';
import {
  buildWalkMap, createWalkMapCache, wallObstacles, isSolidItem, itemFootprint, distanceToRect, groundFloorId,
  BLOCKED, FREE, STAIRS, VOID, CLEARANCE, CELL, SKIRTING_OUT,
} from '../walkMap';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({ id, assetType, floor: 0, x, y: 0, z, rotationY: 0, ...more });
const map = (rooms, objects = [], floorId = 0) => buildWalkMap({ rooms, objects, floors }, floorId, { catalog: ASSET_TYPES });

/** A 6 × 4 m office at the origin, its south wall on z = −2. */
const office = (more) => room('office', 0, 0, 6, 4, more);

/** Can the body walk from a to b on the map (FREE cells, 4 neighbours)? */
function reaches(m, a, b) {
  const start = m.indexOf(a.x, a.z);
  const goal = m.indexOf(b.x, b.z);
  if (m.cells[start] !== FREE || m.cells[goal] !== FREE) return false;
  const seen = new Uint8Array(m.cells.length);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const k = queue.pop();
    if (k === goal) return true;
    const i = k % m.cols;
    for (const n of [i > 0 ? k - 1 : -1, i < m.cols - 1 ? k + 1 : -1, k - m.cols, k + m.cols]) {
      if (n >= 0 && n < m.cells.length && !seen[n] && m.cells[n] === FREE) { seen[n] = 1; queue.push(n); }
    }
  }
  return false;
}

describe('walls', () => {
  it('a wall cell is never walkable, nor is anything closer to it than the clearance', () => {
    const m = map([office()]);
    expect(m.at(0, -2)).toBe(BLOCKED);
    expect(m.at(0, -2 + 0.075 + SKIRTING_OUT + CLEARANCE - 0.06)).toBe(BLOCKED);
    expect(m.at(0, -2 + 0.075 + SKIRTING_OUT + CLEARANCE + 0.06)).toBe(FREE);
    expect(m.at(0, 0)).toBe(FREE);
    expect(m.at(0, -4)).toBe(FREE); // the ground floor: outside is walkable (the street)
  });

  it('every cell is BLOCKED exactly when a wall is closer than the clearance (measured from its centre)', () => {
    const rooms = [office({ doors: [{ wall: 'south', offset: 1, width: 1 }], wallThickness: 0.3 })];
    const m = map(rooms);
    const walls = wallObstacles(rooms);
    for (let k = 0; k < m.cells.length; k += 7) {
      const { x, z } = m.centreOf(k);
      const near = walls.some((w) => distanceToRect(w, x, z) < CLEARANCE);
      expect(m.cells[k] === BLOCKED).toBe(near);
    }
  });

  it('a 1 m door is a gap the body fits through (a strip ~0.26 m wide)', () => {
    const m = map([office({ doors: [{ wall: 'south', offset: 0, width: 1 }] })]);
    expect(m.at(0, -2)).toBe(FREE);
    let strip = 0;
    for (let x = -0.6; x <= 0.6 + 1e-9; x += CELL) if (m.at(x + CELL / 2 - 1e-6, -2) === FREE) strip += 1;
    expect(strip).toBeGreaterThanOrEqual(2);
    expect(strip).toBeLessThanOrEqual(3);
    expect(m.at(0.3, -2)).toBe(BLOCKED); // 0.2 m from the jamb
  });

  it('a 0.6 m and a 0.7 m door are closed (the body is 0.64 m wide, plus the margin); 0.9 m is open', () => {
    for (const [width, open] of [[0.6, false], [0.7, false], [0.9, true]]) {
      const m = map([office({ doors: [{ wall: 'south', offset: 0, width }] })]);
      const any = [-0.05, 0, 0.05].some((x) => m.at(x, -2) === FREE);
      expect(any).toBe(open);
    }
  });

  it('a 0.8 m door is open, on every wall and wherever it lies on the grid; 0.6 / 0.7 m stay closed', () => {
    const offsets = [0, 0.02, 0.03, 0.05, 0.07, 0.09, 0.43, -1.234];
    for (const wall of ['south', 'north', 'east', 'west']) {
      for (const offset of offsets) {
        for (const [width, open] of [[0.6, false], [0.7, false], [0.8, true], [0.85, true]]) {
          // the room off the grid's lines too (x, z), with thick walls sometimes
          const m = map([room('r', 0.013, -0.027, 6, 4, {
            doors: [{ wall, offset, width }], wallThickness: offset > 0.4 ? 0.3 : 0.15,
          })]);
          expect(reaches(m, { x: 0.013, z: -0.027 }, { x: 0, z: -7 }), `${wall} ${offset} ${width}`).toBe(open);
        }
      }
    }
  });

  it('a 0.8 m door with a desk in front of it is closed (door passages still check items)', () => {
    const rooms = [office({ doors: [{ wall: 'south', offset: 0, width: 0.8 }] })];
    const m = map(rooms, [item('d', 'DESK_STANDARD', 0, -1.4)]);
    expect(reaches(m, { x: 0, z: 0.8 }, { x: 0, z: -7 })).toBe(false);
  });

  it('windows do not open the wall (their glass collides)', () => {
    const m = map([office({ windows: [{ wall: 'south', offset: 0, width: 2.4, height: 1.6, sill: 0 }] })]);
    expect(m.at(0, -2)).toBe(BLOCKED);
  });

  it('a shared wall with the door stored on only one of its rooms is open, whichever room builds it', () => {
    // back to back: a's south wall at z = 0, b's north wall at z = −0.15
    for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
      const a = room(first, 0, 2, 6, 4, { doors: [{ wall: 'south', offset: 0, width: 1.2 }] });
      const b = room(second, 0, -2.15, 6, 4);
      const m = map([a, b]);
      expect(m.at(0, -0.075)).toBe(FREE);
      expect(m.at(2, -0.075)).toBe(BLOCKED); // the rest of the shared wall
      // built once: the wall pieces of both rooms don't cover the door
      expect(wallObstacles([a, b]).some((w) => distanceToRect(w, 0, -0.075) === 0)).toBe(false);
    }
  });

  it('a room inside a room: both walls block, the inner door opens the inner wall', () => {
    const outer = room('outer', 0, 0, 20, 12, { doors: [{ wall: 'south', offset: 0, width: 1.2 }] });
    const inner = room('inner', 4, 2, 6, 4, { doors: [{ wall: 'west', offset: 0, width: 1 }] });
    const m = map([outer, inner]);
    expect(m.at(4, 0)).toBe(BLOCKED);  // inner south wall
    expect(m.at(1, 2)).toBe(FREE);     // inner west door
    expect(m.at(4, 2)).toBe(FREE);     // inside the inner room
    expect(m.at(0, -6)).toBe(FREE);    // outer door
  });
});

describe('items', () => {
  it('a desk footprint grown by the clearance is closed, and nothing else around it', () => {
    const desk = item('d', 'DESK_STANDARD', 0.03, 0.04);
    const m = map([room('big', 0, 0, 12, 12)], [desk]);
    const fp = itemFootprint(desk, ASSET_TYPES);
    expect(fp.hw).toBeCloseTo(0.8);
    expect(fp.hd).toBeCloseTo(0.4);
    for (let x = -2; x <= 2; x += 0.1) {
      for (let z = -2; z <= 2; z += 0.1) {
        const c = m.cellCentre(x, z);
        expect(m.at(c.x, c.z) === BLOCKED).toBe(distanceToRect(fp, c.x, c.z) < CLEARANCE);
      }
    }
    expect(m.at(0.03 + 0.8 + 0.3, 0.04)).toBe(BLOCKED);
    expect(m.at(0.03 + 0.8 + 0.45, 0.04)).toBe(FREE);
  });

  it('a turned, scaled desk blocks its turned footprint', () => {
    const desk = item('d', 'DESK_STANDARD', 0, 0, { rotationY: 0.6, scaleX: 1.5 });
    const m = map([room('big', 0, 0, 12, 12)], [desk]);
    const fp = itemFootprint(desk, ASSET_TYPES);
    expect(fp.hw).toBeCloseTo(1.2);
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      // along its long axis (local +X → world (cos, −sin)), just inside and just outside the grown footprint
      const dir = { x: Math.cos(0.6), z: -Math.sin(0.6) };
      expect(m.at(dir.x * (1.2 + 0.3), dir.z * (1.2 + 0.3))).toBe(BLOCKED);
      expect(m.at(dir.x * (1.2 + 0.5), dir.z * (1.2 + 0.5))).toBe(FREE);
    }
  });

  it('rugs, markers, staircases and things above the head do not block; people are not items', () => {
    expect(isSolidItem(item('r', 'RUG', 0, 0), ASSET_TYPES)).toBe(false);
    expect(isSolidItem(item('s', 'SPAWN_POINT', 0, 0), ASSET_TYPES)).toBe(false);
    expect(isSolidItem(item('z', 'ZONE_MARKER', 0, 0), ASSET_TYPES)).toBe(false);
    expect(isSolidItem(item('st', 'STAIRCASE', 0, 0), ASSET_TYPES)).toBe(false);
    expect(isSolidItem(item('tv', 'TV_DISPLAY', 0, 0, { y: 1.9 }), ASSET_TYPES)).toBe(false);
    expect(isSolidItem(item('d', 'DESK_STANDARD', 0, 0), ASSET_TYPES)).toBe(true);
    expect(isSolidItem(item('w', 'WALL_SEGMENT', 0, 0), ASSET_TYPES)).toBe(true);
    const m = map([room('big', 0, 0, 12, 12)], [item('r', 'RUG', 0, 0), item('s', 'SPAWN_POINT', 3, 3)]);
    expect(m.at(0, 0)).toBe(FREE);
    expect(m.at(3, 3)).toBe(FREE);
  });

  it('items on another floor do not block this one', () => {
    const m = map([room('big', 0, 0, 12, 12)], [item('d', 'DESK_STANDARD', 0, 0, { floor: 1 })]);
    expect(m.at(0, 0)).toBe(FREE);
  });
});

describe('floors', () => {
  it('upper floor: only its rooms are standing room; the opening over stairs from below is not', () => {
    const rooms = [room('g', 0, 0, 10, 8), room('u', 0, 0, 10, 8, { floor: 1 })];
    const stairs = item('st', 'STAIRCASE', 2, 0);
    const up = map(rooms, [stairs], 1);
    expect(up.ground).toBe(false);
    expect(up.at(-3, -2)).toBe(FREE);
    expect(up.at(0, -6)).toBe(VOID);  // outside the building, upstairs: nothing to stand on
    expect(up.at(2, 0)).toBe(VOID);   // the stair opening
    const ground = map(rooms, [stairs], 0);
    expect(ground.ground).toBe(true);
    expect(ground.at(2, 0)).toBe(STAIRS); // the flight: walkable, not a place to start
    expect(ground.isFree(2, 0)).toBe(false);
    expect(ground.isFree(2, 0, { stairs: true })).toBe(true);
  });

  it('the ground floor is the lowest one; the street reaches 10 m around the building', () => {
    expect(groundFloorId(floors)).toBe(0);
    expect(groundFloorId({})).toBe(0);
    expect(groundFloorId({ 2: { id: 2 }, 5: { id: 5 } })).toBe(2);
    const m = map([office()]);
    expect(m.at(0, -2 - 9.5)).toBe(FREE);
    expect(m.at(0, -2 - 12)).toBe(VOID); // off the map
  });

  it('a 66 × 35 m floor builds quickly and stays small', () => {
    const rooms = [];
    for (let i = 0; i < 12; i++) rooms.push(room(`r${i}`, -27.5 + i * 5.15, -8.65, 5, 14, { doors: [{ wall: 'north', offset: 0, width: 1.2 }] }));
    rooms.push(room('corridor', 0, 0, 66, 3));
    const objects = [];
    for (let i = 0; i < 400; i++) objects.push(item(`d${i}`, 'DESK_STANDARD', -30 + (i % 30) * 2, -14 + Math.floor(i / 30) * 1.1));
    const t = performance.now();
    const m = map(rooms, objects);
    const ms = performance.now() - t;
    expect(m.cells.byteLength).toBeLessThan(1_000_000);
    expect(ms).toBeLessThan(400); // budget 60 ms on a laptop; CI machines vary
  });
});

describe('createWalkMapCache', () => {
  it('builds a floor once, and again only when the layout changes', () => {
    const cache = createWalkMapCache({ catalog: ASSET_TYPES });
    const rooms = [office()];
    const layout = { rooms, objects: [], floors };
    const a = cache.get(layout, 0);
    expect(cache.get({ rooms: [...rooms], objects: [], floors }, 0)).toBe(a); // same records
    const moved = { rooms: [{ ...rooms[0], x: 1 }], objects: [], floors };
    expect(cache.get(moved, 0)).not.toBe(a);
  });
});
