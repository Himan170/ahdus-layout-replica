// Walking routes (route.js, v0.13.2): plan section 6 + the Meridian-shaped layout + 200 random layouts.
import { describe, it, expect } from 'vitest';
import {
  findRoute, findNearestRoute, floorLinks, stairBottom, cellsClear, segmentToRect, lineOfSight, roomHasDoor,
} from '../route';
import { createWalkMapCache, buildWalkMap, itemObstacles, wallObstacles, FREE, BODY_RADIUS } from '../walkMap';
import { entranceSpawn } from '../entrance';
import { stairTop, stairDimsFor } from '../../building';
import { WALK_SPEED } from '../../speeds';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { meridianLike } from './meridianLike';
import { randomLayout } from './randomLayouts';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({ id, assetType, floor: 0, x, y: 0, z, rotationY: 0, ...more });
const route = (layout, from, to, options = {}) => findRoute(layout, from, to, { catalog: ASSET_TYPES, ...options });

const checkMaps = new WeakMap(); // walk maps built by the checker, per layout

/** Every point a route walks through, every 2 cm, with its floor. */
function* samples(r) {
  for (const leg of r.legs) {
    for (let n = 1; n < leg.points.length; n++) {
      const a = leg.points[n - 1];
      const b = leg.points[n];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02));
      for (let s = 0; s <= steps; s++) yield { floor: leg.floor, x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps };
    }
  }
}

/**
 * Checked independently of the route's own line-of-sight test: every sample is on a FREE cell of its
 * floor's walk map and keeps the body's radius from every wall and solid item (the body never
 * touches one), and every time the route crosses a room's wall line it does so through a door
 * (a door of any room of that floor on that line, the body inside the door's width).
 * @returns {string[]} what's wrong (empty: nothing)
 */
function troubles(layout, r) {
  const out = [];
  const maps = checkMaps.get(layout) ?? {};
  checkMaps.set(layout, maps);
  const mapOf = (f) => (maps[f] ??= buildWalkMap(layout, f, { catalog: ASSET_TYPES }));
  const solids = {};
  const solidsOf = (f) => (solids[f] ??= [
    ...wallObstacles(layout.rooms.filter((x) => x.floor === f)), ...itemObstacles(layout.objects, f, ASSET_TYPES),
  ]);
  for (const p of samples(r)) {
    const map = mapOf(p.floor);
    if (map.at(p.x, p.z) !== FREE) { out.push(`not walkable at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} (floor ${p.floor})`); break; }
    const hit = solidsOf(p.floor).find((o) => Math.abs(o.x - p.x) < o.hw + o.hd + 1 && Math.abs(o.z - p.z) < o.hw + o.hd + 1 &&
      segmentToRect(o, p.x, p.z, p.x, p.z) < BODY_RADIUS - 1e-6);
    if (hit) { out.push(`touches ${hit.kind} ${hit.roomId ?? hit.objectId} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`); break; }
  }
  for (const leg of r.legs) {
    for (let n = 1; n < leg.points.length; n++) {
      const bad = wallCrossings(layout, leg.floor, leg.points[n - 1], leg.points[n]).filter((c) => !c.door);
      if (bad.length) out.push(`through the ${bad[0].wall} wall of ${bad[0].roomId} at ${bad[0].u.toFixed(2)} (floor ${leg.floor})`);
    }
  }
  return out;
}

/** Where a segment crosses the wall lines of a floor's rooms, and through which door (null: none). */
function wallCrossings(layout, floor, a, b) {
  const rooms = layout.rooms.filter((x) => x.floor === floor);
  const lines = []; // { roomId, wall, alongX, at, u0, u1 }
  const doors = []; // { alongX, at, u, half, T }
  for (const r of rooms) {
    const T = r.wallThickness ?? 0.15;
    const x0 = r.x - r.width / 2;
    const x1 = r.x + r.width / 2;
    const z0 = r.z - r.depth / 2;
    const z1 = r.z + r.depth / 2;
    for (const [wall, alongX, at, u0, u1] of [
      ['south', true, z0, x0, x1], ['north', true, z1, x0, x1], ['west', false, x0, z0, z1], ['east', false, x1, z0, z1],
    ]) {
      lines.push({ roomId: r.id, wall, alongX, at, u0: u0 - T / 2, u1: u1 + T / 2, T });
      for (const d of (r.doors ?? []).filter((x) => x.wall === wall)) {
        doors.push({ alongX, at, u: (alongX ? r.x : r.z) + (d.offset ?? 0), half: (d.width ?? 1) / 2, T });
      }
    }
  }
  const out = [];
  for (const l of lines) {
    const pa = l.alongX ? a.z : a.x;
    const pb = l.alongX ? b.z : b.x;
    if ((pa - l.at) * (pb - l.at) > 0 || pa === pb) continue;
    const t = (l.at - pa) / (pb - pa);
    const u = l.alongX ? a.x + t * (b.x - a.x) : a.z + t * (b.z - a.z);
    if (u < l.u0 || u > l.u1) continue;
    // the doors on this line (either room's, on a shared wall), overlapping ones joined into one gap
    const gaps = doors
      .filter((d) => d.alongX === l.alongX && Math.abs(d.at - l.at) <= Math.max(d.T, l.T) + 0.02)
      .map((d) => [d.u - d.half, d.u + d.half])
      .sort((p, q) => p[0] - q[0])
      .reduce((acc, g) => {
        const last = acc[acc.length - 1];
        if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
        else acc.push([...g]);
        return acc;
      }, []);
    const door = gaps.find(([g0, g1]) => u - BODY_RADIUS >= g0 - 1e-6 && u + BODY_RADIUS <= g1 + 1e-6);
    out.push({ ...l, u, door: door ?? null });
  }
  return out;
}

/** The doors a route goes through, as "roomId wall" (each door once per crossing). */
function doorsThrough(layout, r) {
  const out = [];
  for (const leg of r.legs) {
    for (let n = 1; n < leg.points.length; n++) {
      for (const c of wallCrossings(layout, leg.floor, leg.points[n - 1], leg.points[n])) out.push(`${leg.floor}:${c.roomId}:${c.wall}`);
    }
  }
  return out;
}

// Two offices back to back (one wall between them at x = 4.075), closed to the outside
const twoRooms = (doorWidth = 1, more = []) => ({
  rooms: [
    room('room_a', 0, 0, 8, 6, { name: 'Office A', doors: doorWidth ? [{ wall: 'east', offset: 2, width: doorWidth, height: 2.1 }] : [] }),
    room('room_b', 8.15, 0, 8, 6, { name: 'Office B' }),
    ...more,
  ],
  objects: [],
  floors,
});

describe('routes on one floor', () => {
  it('go through the door, not the wall', () => {
    const layout = twoRooms(1);
    const r = route(layout, { x: -2, z: -2, floor: 0 }, { x: 10, z: -2, floor: 0 });
    expect(r.problem).toBeUndefined();
    expect(troubles(layout, r)).toEqual([]);
    const crossing = wallCrossings(layout, 0, ...firstCrossingSegment(r, 4.075));
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.every((c) => c.door)).toBe(true);
    expect(Math.abs(crossing[0].u - 2)).toBeLessThan(0.18); // inside the 1 m door (0.5 − 0.32)
    expect(r.length).toBeGreaterThan(12.5); // longer than straight through the wall
    expect(r.seconds).toBeCloseTo(r.length / WALK_SPEED, 5);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].points[0]).toEqual({ x: -2, z: -2 });
    expect(r.legs[0].points.at(-1)).toEqual({ x: 10, z: -2 });
  });

  it('a 0.8 m door is one cell wide on the walk map, and the route still goes through it', () => {
    const layout = twoRooms(0.8);
    const map = buildWalkMap(layout, 0, { catalog: ASSET_TYPES });
    const across = [];
    for (let z = 1.4; z <= 2.6; z += 0.1) if (map.at(4.075, z) === FREE) across.push(z);
    expect(across.length).toBeLessThanOrEqual(1); // one cell (on the door's centre line)
    expect(map.passages.size).toBeGreaterThan(0);
    const r = route(layout, { x: -2, z: -2, floor: 0 }, { x: 10, z: -2, floor: 0 });
    expect(r.problem).toBeUndefined();
    expect(troubles(layout, r)).toEqual([]);
    const [c] = wallCrossings(layout, 0, ...firstCrossingSegment(r, 4.075));
    expect(Math.abs(c.u - 2)).toBeLessThan(0.08 + 1e-6); // within 0.4 − 0.32 of the door's middle
  });

  it('a 0.7 m door is too narrow: no route, and a clear answer', () => {
    const r = route(twoRooms(0.7), { x: -2, z: -2, floor: 0 }, { x: 10, z: -2, floor: 0 });
    expect(r).toEqual({ problem: 'NO_ROUTE', message: 'No walking route to Office B: something blocks the way' });
  });

  it('no route into a room without a door (or out of one)', () => {
    const layout = twoRooms(1, [room('room_server', 0, 6.15, 8, 6, { name: 'Server Room' })]);
    expect(roomHasDoor(layout.rooms[2], layout.rooms)).toBe(false);
    expect(roomHasDoor(layout.rooms[1], layout.rooms)).toBe(true); // A's door, through the wall they share
    expect(route(layout, { x: -2, z: -2, floor: 0 }, { x: 0, z: 6, floor: 0 }))
      .toEqual({ problem: 'NO_DOOR', message: 'No walking route to Server Room: it has no door' });
    expect(route(layout, { x: 0, z: 6, floor: 0 }, { x: -2, z: -2, floor: 0 }))
      .toEqual({ problem: 'START_NO_DOOR', message: 'No walking route to Office A: the room you are in has no door' });
    expect(route(layout, { x: 0, z: 6, floor: 0 }, { x: 0, z: 6, floor: 0 }).problem).toBeUndefined(); // inside it is fine
  });

  it('keeps to the middle of a wide door', () => {
    const layout = twoRooms(2);
    const r = route(layout, { x: 0, z: -2.5, floor: 0 }, { x: 8, z: -2.5, floor: 0 });
    const [c] = wallCrossings(layout, 0, ...firstCrossingSegment(r, 4.075));
    expect(Math.abs(c.u - 2)).toBeLessThan(0.35); // not along the door frame (it could be 0.66 off)
  });

  it('a long empty corridor is one straight segment', () => {
    const layout = { rooms: [room('room_c', 0, 0, 40, 3, { name: 'Corridor' })], objects: [], floors };
    const r = route(layout, { x: -18, z: 0, floor: 0 }, { x: 18, z: 0, floor: 0 });
    expect(r.legs[0].points).toEqual([{ x: -18, z: 0 }, { x: 18, z: 0 }]);
    expect(r.length).toBeCloseTo(36, 5);
  });

  it('a start or goal in a desk or a wall moves to the nearest free spot (within 1.5 m)', () => {
    const layout = twoRooms(1);
    layout.objects.push(item('obj_desk', 'DESK_STANDARD', 9, -1));
    const r = route(layout, { x: 4.075, z: -1, floor: 0 }, { x: 9, z: -1, floor: 0 });
    expect(r.problem).toBeUndefined();
    expect(Math.abs(r.from.x - 4.075)).toBeGreaterThan(0.45); // off the wall (either side, the nearer free spot)
    expect(Math.abs(r.from.x - 4.075)).toBeLessThan(0.6);
    expect(Math.hypot(r.to.x - 9, r.to.z + 1)).toBeLessThan(1.5);
    expect(troubles(layout, r)).toEqual([]);
    expect(route(layout, { x: -2, z: -2 }, { x: 30, z: 30, floor: 0 }).problem).toBe('GOAL_BLOCKED');
  });

  it('goes round furniture, never through it', () => {
    const layout = twoRooms(1);
    for (let z = -1.35; z <= 1.36; z += 0.9) layout.objects.push(item(`obj_${z}`, 'FILING_CABINET', 0, z)); // a row, gaps at the ends
    layout.objects.push(item('obj_table', 'TABLE_MEETING', 10, 0, { rotationY: 0.6 }));
    const r = route(layout, { x: -3, z: 0, floor: 0 }, { x: 11.5, z: 1.5, floor: 0 });
    expect(r.problem).toBeUndefined();
    expect(troubles(layout, r)).toEqual([]);
  });

  it('the nearest of several places: the nearer by walking, and one that can be reached', () => {
    const layout = twoRooms(1, [
      room('room_wc1', -8.15, 0, 8, 6, { type: 'RESTROOM', name: 'Washroom West', doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] }),
      room('room_wc2', 0, 6.15, 8, 6, { type: 'RESTROOM', name: 'Washroom North' }), // no door
    ]);
    layout.rooms[0].doors.push({ wall: 'south', offset: 0, width: 1, height: 2.1 });
    const west = { x: -8, z: 0, floor: 0, name: 'Washroom West' };
    const north = { x: 0, z: 6, floor: 0, name: 'Washroom North' };
    const east = { x: 10, z: 0, floor: 0, name: 'Office B' };
    const from = { x: 2, z: 0, floor: 0 };
    // North is nearest in a straight line but has no door; Office B is nearer to walk to than the West washroom
    const r = route(layout, from, east);
    const w = route(layout, from, west);
    expect(r.length).toBeLessThan(w.length);
    const n = findNearestRoute(layout, from, [west, north, east], { catalog: ASSET_TYPES });
    expect(n.goalIndex).toBe(2);
    expect(n.length).toBeCloseTo(r.length, 5);
    expect(findNearestRoute(layout, from, [west, north], { catalog: ASSET_TYPES }).goalIndex).toBe(0);
    expect(findNearestRoute(layout, from, [north], { catalog: ASSET_TYPES }))
      .toEqual({ problem: 'NO_DOOR', message: 'No walking route to Washroom North: it has no door' });
  });
});

/** A segment of the route that crosses the line x = at. */
function firstCrossingSegment(r, at) {
  for (const leg of r.legs) {
    for (let n = 1; n < leg.points.length; n++) {
      const a = leg.points[n - 1];
      const b = leg.points[n];
      if ((a.x - at) * (b.x - at) <= 0) return [a, b];
    }
  }
  throw new Error('the route never crosses x = ' + at);
}

// A reception with a door outside (south) and stairs inside; an office above it
const twoFloors = ({ roomAbove = true } = {}) => ({
  rooms: [
    room('room_hall', 0, 0, 10, 8, { name: 'Hall', type: 'RECEPTION', doors: [{ wall: 'south', offset: -3, width: 1.4, height: 2.1 }] }),
    ...(roomAbove ? [room('room_up', 0, 0, 10, 8, { name: 'Upstairs office', floor: 1 })] : []),
  ],
  objects: [item('obj_stairs', 'STAIRCASE', 3, -0.5)],
  floors,
});

describe('routes between floors', () => {
  it('use the stairs: up from outside, then down again', () => {
    const layout = twoFloors();
    const up = route(layout, { x: -3, z: -8, floor: 0 }, { x: -4, z: 3, floor: 1 });
    expect(up.problem).toBeUndefined();
    expect(up.legs.map((l) => l.floor)).toEqual([0, 1]);
    expect(up.legs[0].stairsAtEnd).toMatchObject({ kind: 'stairs', objectId: 'obj_stairs', direction: 'up', toFloor: 1 });
    const stair = layout.objects[0];
    const dims = stairDimsFor(floors, stair);
    const bottom = stairBottom(stair, dims);
    const top = stairTop(stair, dims);
    const end = up.legs[0].points.at(-1);
    const start = up.legs[1].points[0];
    expect(Math.hypot(end.x - bottom.x, end.z - bottom.z)).toBeLessThan(0.15);
    expect(Math.hypot(start.x - top.x, start.z - top.z)).toBeLessThan(0.15);
    expect(up.length).toBeGreaterThan(up.legs[0].stairsAtEnd.length);
    expect(troubles(layout, up)).toEqual([]);
    expect(doorsThrough(layout, up)).toContain('0:room_hall:south');

    const down = route(layout, { x: -4, z: 3, floor: 1 }, { x: -3, z: -8, floor: 0 });
    expect(down.legs.map((l) => l.floor)).toEqual([1, 0]);
    expect(down.legs[0].stairsAtEnd).toMatchObject({ direction: 'down', toFloor: 0 });
    expect(troubles(layout, down)).toEqual([]);
  });

  it('stairs that lead nowhere are not links: "no stairs lead to Floor 1"', () => {
    const layout = twoFloors({ roomAbove: false });
    layout.rooms.push(room('room_far', 30, 0, 6, 6, { name: 'Far office', floor: 1 })); // Floor 1 exists, not above the stairs
    expect(floorLinks(layout, { catalog: ASSET_TYPES })).toEqual([]);
    expect(route(layout, { x: -3, z: -8, floor: 0 }, { x: 30, z: 0, floor: 1 }))
      .toEqual({ problem: 'NO_STAIRS', message: 'No walking route to Far office: no stairs lead to Floor 1' });
  });

  it('upstairs, a door in the wall between two rooms is walkable (the floor runs under the walls)', () => {
    const layout = twoFloors();
    layout.rooms.push(room('room_up2', 10.15, 0, 10, 8, { name: 'Upstairs meeting', floor: 1, doors: [{ wall: 'west', offset: 2, width: 0.9, height: 2.1 }] }));
    const r = route(layout, { x: -3, z: -8, floor: 0 }, { x: 12, z: -2, floor: 1 });
    expect(r.problem).toBeUndefined();
    expect(troubles(layout, r)).toEqual([]);
    expect(doorsThrough(layout, r)).toContain('1:room_up2:west');
  });
});

describe('the Meridian-shaped layout', () => {
  const layout = meridianLike({ spawnPoint: false });
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const spawn = entranceSpawn(layout, { catalog: ASSET_TYPES, maps });
  const upstairsDesks = layout.objects.filter((o) => o.floor === 1 && o.assetType === 'DESK_STANDARD');

  it('from the entrance to a desk on Floor 1: the lobby doors, the corridor, the stairs, the office door', () => {
    const desk = upstairsDesks.filter((o) => o.roomId === 'room_f1_05').reduce((a, b) => (b.x - b.z > a.x - a.z ? b : a));
    expect([desk.x, desk.z]).toEqual([29.45, -14.05]); // Engineering 1, its far corner
    const r = findRoute(layout, spawn, { x: desk.x, z: desk.z + 0.7, floor: 1 }, { maps }); // to its chair
    expect(r.problem).toBeUndefined();
    expect(r.legs.map((l) => l.floor)).toEqual([0, 1]);
    expect(r.legs[0].stairsAtEnd).toMatchObject({ objectId: 'obj_f0_stairs', direction: 'up', toFloor: 1 });
    expect(troubles(layout, r)).toEqual([]);
    const doors = doorsThrough(layout, r);
    for (const d of ['0:room_f0_02:south', '0:room_f0_02:north', '0:room_f0_06:south', '1:room_f1_06:south', '1:room_f1_05:north']) {
      expect(doors).toContain(d);
    }
    expect(r.length).toBeGreaterThan(100);
    expect(r.length).toBeLessThan(130);
  });

  it('every desk upstairs can be reached, never through a wall, and fast', () => {
    const problems = [];
    let slowest = 0;
    for (const desk of upstairsDesks.filter((_, n) => n % 3 === 0)) {
      const t0 = performance.now();
      const r = findRoute(layout, spawn, { x: desk.x, z: desk.z + 0.7, floor: 1 }, { maps });
      slowest = Math.max(slowest, performance.now() - t0);
      if (r.problem) { problems.push(`${desk.id}: ${r.message}`); continue; }
      const t = troubles(layout, r);
      if (t.length) problems.push(`${desk.id}: ${t.join(', ')}`);
    }
    expect(problems).toEqual([]);
    expect(slowest).toBeLessThan(200); // ~30 ms on a laptop once warm (plan: ≤ 30 ms); test runners and CI vary
  });
});

describe('200 random layouts', () => {
  it('routes from the spawn to every room: through doors, never a wall; else a clear answer', () => {
    const problems = [];
    const answers = {};
    let routes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const layout = randomLayout(seed);
      const maps = createWalkMapCache({ catalog: ASSET_TYPES });
      const spawn = entranceSpawn(layout, { catalog: ASSET_TYPES, maps });
      for (const r of layout.rooms) {
        const to = { x: r.x + r.width / 4, z: r.z - r.depth / 5, floor: r.floor };
        const found = findRoute(layout, spawn, to, { maps });
        if (found.problem) {
          answers[found.problem] = (answers[found.problem] ?? 0) + 1;
          if (!/^No walking route/.test(found.message ?? '')) problems.push(`seed ${seed} ${r.id}: no message`);
          continue;
        }
        routes++;
        const t = troubles(layout, found);
        if (t.length) problems.push(`seed ${seed} ${r.id}: ${t.join(', ')}`);
      }
    }
    expect(problems).toEqual([]);
    expect(routes).toBeGreaterThan(400);
    expect(answers.NO_DOOR ?? 0).toBeGreaterThan(0); // some random rooms have no door
  });
});

describe('line of sight', () => {
  const layout = twoRooms(1);
  const map = buildWalkMap(layout, 0, { catalog: ASSET_TYPES });

  it('no straight line through a wall, one through the door', () => {
    expect(lineOfSight(map, { x: 2, z: -2 }, { x: 6, z: -2 })).toBe(false);
    expect(lineOfSight(map, { x: 2, z: 2 }, { x: 6, z: 2 })).toBe(true);
    expect(cellsClear(map, 2, -2, 6, -2)).toBe(false);
  });

  it('a diagonal through the corner between two blocked cells is not clear', () => {
    const tiny = { cell: 1, x0: 0, z0: 0, cols: 2, rows: 2, cells: Uint8Array.from([FREE, 0, 0, FREE]) };
    expect(cellsClear(tiny, 0.5, 0.5, 1.5, 1.5)).toBe(false);
    expect(cellsClear({ ...tiny, cells: Uint8Array.from([FREE, FREE, FREE, FREE]) }, 0.5, 0.5, 1.5, 1.5)).toBe(true);
  });

  it('segmentToRect measures exactly (turned rectangles too)', () => {
    const box = { x: 0, z: 0, hw: 1, hd: 0.5, rot: 0 };
    expect(segmentToRect(box, -3, 1.5, 3, 1.5)).toBeCloseTo(1, 9);
    expect(segmentToRect(box, -3, 0, 3, 0)).toBe(0);
    expect(segmentToRect(box, 2, 2, 3, 3)).toBeCloseTo(Math.hypot(1, 1.5), 9);
    const turned = { ...box, rot: Math.PI / 2 }; // now 1 m wide along z
    expect(segmentToRect(turned, -3, 0.8, 3, 0.8)).toBe(0);
    expect(segmentToRect(turned, 0.8, -3, 0.8, 3)).toBeCloseTo(0.3, 9);
  });
});
