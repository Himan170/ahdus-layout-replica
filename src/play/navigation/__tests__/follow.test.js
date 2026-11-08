// Following a route (follow.js, v0.13.4): the path, steering, stuck / off route / arrival, the route line.
import { describe, it, expect } from 'vitest';
import {
  routePath, projectOnPath, pointAt, turnTowards, createFollower, routeMarks, itemDistance, tightAhead,
  TURN_RATE, FURNITURE_CLEARANCE, AUTO_SPEED, STUCK_TIME,
} from '../follow';
import { findRoute, findNearestRoute } from '../route';
import { WALK_SPEED } from '../../speeds';
import { createWalkMapCache, buildWalkMap, itemObstacles, BODY_RADIUS } from '../walkMap';
import { entranceSpawn } from '../entrance';
import { buildPlaces } from '../places';
import { meridianLike } from './meridianLike';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...more,
});
const desk = (id, x, z, more = {}) => ({ id, assetType: 'DESK_STANDARD', floor: 0, x, y: 0, z, rotationY: 0, ...more });
const straight = (x0, x1, z = 0, floor = 0) => ({ legs: [{ floor, points: [{ x: x0, z }, { x: x1, z }] }], length: Math.abs(x1 - x0), seconds: 1 });

/**
 * Walk a route with the follower, as playController would (without its collisions: the follower
 * alone must keep the body clear). The floor changes halfway up a staircase.
 * @returns {{ arrived, time, minWall, minItem, samples }}
 */
function walk(layout, route, { maps, dt = 1 / 30, limit = 120, check = true } = {}) {
  const mapFor = (f) => maps.get(layout, f);
  const f = createFollower(route, { mapFor });
  const start = route.legs[0].points[0];
  const me = { x: start.x, z: start.z, floor: route.legs[0].floor, yaw: 0 };
  let time = 0;
  let minWall = Infinity;
  let minItem = Infinity;
  for (; time < limit; time += dt) {
    const step = f.step(me, dt);
    if (step.arrived) return { arrived: true, time, minWall, minItem };
    me.yaw = step.yaw;
    me.x += step.dirX * step.speed * dt;
    me.z += step.dirZ * step.speed * dt;
    me.floor = pointAt(f.path, f.progress).floor;
    if (!check || step.onStairs) continue;
    for (const o of mapFor(me.floor).obstacles) {
      if (Math.abs(o.x - me.x) > o.hw + o.hd + 1 || Math.abs(o.z - me.z) > o.hw + o.hd + 1) continue;
      const d = distanceTo(o, me.x, me.z);
      if (o.kind === 'item') minItem = Math.min(minItem, d); else minWall = Math.min(minWall, d);
    }
  }
  return { arrived: false, time, minWall, minItem, at: { ...me } };
}

function distanceTo(o, x, z) {
  const c = Math.cos(o.rot ?? 0);
  const s = Math.sin(o.rot ?? 0);
  const dx = x - o.x;
  const dz = z - o.z;
  return Math.hypot(Math.max(Math.abs(dx * c - dz * s) - o.hw, 0), Math.max(Math.abs(dx * s + dz * c) - o.hd, 0));
}

describe('the path', () => {
  const route = {
    legs: [
      { floor: 0, points: [{ x: 0, z: 0 }, { x: 4, z: 0 }], stairsAtEnd: { kind: 'stairs', objectId: 's', direction: 'up', toFloor: 1, length: 5 } },
      { floor: 1, points: [{ x: 4, z: 3 }, { x: 0, z: 3 }] },
    ],
    length: 4 + 5 + 4,
  };

  it('one path, the stairs a segment of their own (as long as the flight), the same length as the route', () => {
    const p = routePath(route);
    expect(p.points.map((q) => [q.floor, q.stairs, q.s])).toEqual([[0, false, 0], [0, true, 4], [1, false, 9], [1, false, 13]]);
    expect(p.length).toBeCloseTo(route.length, 6);
  });

  it('projection and points along it, per floor', () => {
    const p = routePath(route);
    expect(projectOnPath(p, 2, 0.5, 0)).toMatchObject({ k: 0, s: 2, dist: 0.5 });
    expect(projectOnPath(p, 2, 3.2, 1)).toMatchObject({ k: 2 });
    expect(projectOnPath(p, 2, 3.2, 1).s).toBeCloseTo(11, 6);
    // the staircase belongs to both floors
    expect(projectOnPath(p, 4, 1.5, 1).k).toBe(1);
    expect(pointAt(p, 6.5)).toMatchObject({ x: 4, z: 1.5 });
    expect(pointAt(p, 100)).toMatchObject({ x: 0, z: 3, floor: 1 });
  });

  it('turns at most TURN_RATE per second', () => {
    expect(turnTowards(0, Math.PI / 2, (TURN_RATE * 1) / 30)).toBeCloseTo(Math.PI / 20, 6);
    expect(turnTowards(0, 0.01, 1)).toBe(0.01);
    // the short way round
    expect(turnTowards(3, -3, 0.1)).toBeCloseTo(3.1, 6);
  });
});

describe('the route line', () => {
  const p = routePath({
    legs: [
      { floor: 0, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], stairsAtEnd: { kind: 'stairs', objectId: 's', direction: 'up', toFloor: 1, length: 4.5 } },
      { floor: 1, points: [{ x: 10, z: 4 }, { x: 4, z: 4 }] },
    ],
  });

  it('chevrons every metre ahead of you on your floor only, the stairs marked; the goal on its floor', () => {
    const ground = routeMarks(p, 2.3, 0);
    expect(ground.chevrons.length).toBeGreaterThan(8);
    expect(ground.chevrons.every((c) => c.x >= 2.3 && (c.z === 0 || c.stairs))).toBe(true);
    expect(ground.chevrons[0].yaw).toBeCloseTo(Math.PI / 2, 6); // facing +X
    expect(ground.markers).toEqual([{ kind: 'stairs', x: 10, z: 0 }]);
    const up = routeMarks(p, 15, 1);
    expect(up.markers).toEqual([{ kind: 'goal', x: 4, z: 4 }]);
    expect(up.chevrons.every((c) => c.z === 4 && c.x < 10 && c.x > 4)).toBe(true);
    // chevrons stay put as you walk (on whole metres)
    expect(routeMarks(p, 2.4, 0).chevrons[0].x).toBe(ground.chevrons[0].x);
  });
});

describe('steering clear of furniture', () => {
  const catalog = ASSET_TYPES;
  const hd = itemObstacles([desk('d', 0, 0)], 0, catalog)[0].hd;

  it('keeps ~0.44 m from a desk corner the route passes at 0.36 m, when there is room', () => {
    const layout = { floors, rooms: [room('r', 0, 0, 12, 8)], objects: [desk('d', 0, 0.36 + hd)] };
    const maps = createWalkMapCache({ catalog });
    const r = walk(layout, straight(-4, 4), { maps });
    expect(r.arrived).toBe(true);
    expect(r.minItem).toBeGreaterThan(FURNITURE_CLEARANCE - 0.03);
  });

  it('a narrow aisle (desks at 0.36 m on both sides): straight through the middle, no closer than the route', () => {
    const layout = { floors, rooms: [room('r', 0, 0, 12, 8)], objects: [desk('a', 0, 0.36 + hd), desk('b', 0, -0.36 - hd)] };
    const maps = createWalkMapCache({ catalog });
    const r = walk(layout, straight(-4, 4), { maps });
    expect(r.arrived).toBe(true);
    expect(r.minItem).toBeGreaterThan(BODY_RADIUS + 0.02);
  });

  it('walks at walking speed on a straight way', () => {
    const layout = { floors, rooms: [room('r', 0, 0, 30, 8)], objects: [] };
    const r = walk(layout, straight(-12, 12), { maps: createWalkMapCache({ catalog }) });
    expect(r.arrived).toBe(true);
    // 23 m to within 1 m of the end, slowing for the last 2 m
    expect(r.time).toBeLessThan(23 / AUTO_SPEED + 1.2);
  });
});

describe('stuck, off the route, arrived', () => {
  it('no progress for STUCK_TIME = stuck (and again after another STUCK_TIME)', () => {
    const f = createFollower(straight(0, 10));
    let stuck = 0;
    for (let t = 0; t < STUCK_TIME * 2 + 0.05; t += 0.1) if (f.step({ x: 0, z: 0, floor: 0, yaw: 0 }, 0.1).stuck) stuck++;
    expect(stuck).toBe(2);
    // moving along: never stuck
    const g = createFollower(straight(0, 10));
    let x = 0;
    for (let t = 0; t < 2; t += 0.1) { expect(g.step({ x, z: 0, floor: 0, yaw: Math.PI / 2 }, 0.1).stuck).toBe(false); x += 0.4; }
  });

  it('more than 3 m off it: offRoute; within 1 m of the end on its floor: arrived', () => {
    const f = createFollower(straight(0, 10));
    expect(f.step({ x: 5, z: 3.5, floor: 0, yaw: 0 }, 0.1, { drive: false }).offRoute).toBe(true);
    expect(f.step({ x: 5, z: 2, floor: 0, yaw: 0 }, 0.1, { drive: false }).offRoute).toBe(false);
    expect(f.step({ x: 9.2, z: 0.3, floor: 0, yaw: 0 }, 0.1).arrived).toBe(true);
    expect(f.step({ x: 9.2, z: 0.3, floor: 1, yaw: 0 }, 0.1).arrived).toBe(false); // the floor above
  });
});

describe('the Meridian-shaped layout', () => {
  const layout = meridianLike();
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const spawn = entranceSpawn(layout, { maps });
  const from = { x: spawn.x, z: spawn.z, floor: spawn.floor };
  const people = [{ personId: 'kavya', deskId: 'obj_f0_reception', name: 'Kavya Iyer', department: 'HR' }];
  const upstairs = layout.objects.filter((o) => o.floor === 1 && o.assetType === 'DESK_STANDARD');
  // the desk upstairs nearest the stairs' top, and the furthest one
  people.push({ personId: 'far', deskId: upstairs[upstairs.length - 1].id, name: 'Far Desk', department: 'Executive' });
  const index = buildPlaces(layout, people);

  for (const [name, id] of [['Kavya Iyer at reception', 'person:kavya'], ['a desk at the far end of Floor 1', 'person:far']]) {
    it(`from the entrance to ${name}: arrives in about the route's time, never touching a wall or a desk`, () => {
      const place = index.byId.get(id);
      const r = findNearestRoute(layout, from, place.goals, { maps });
      expect(r.problem).toBeUndefined();
      const w = walk(layout, r, { maps });
      expect(w.arrived).toBe(true);
      expect(w.time).toBeLessThan(r.seconds * 1.6 + 3);
      expect(w.minWall).toBeGreaterThan(BODY_RADIUS);
      expect(w.minItem).toBeGreaterThan(BODY_RADIUS);
    });
  }

  it('slow frames (0.25 s each) to the desk upstairs nearest the stairs: through the 1 m stairs door on the route\'s line, with room to spare', () => {
    // the real collider is the body's radius: a follower that grazes a door frame gets stuck there
    const stairs = layout.objects.find((o) => o.assetType === 'STAIRCASE');
    const near = [...upstairs].sort((a, b) => Math.hypot(a.x - stairs.x, a.z - stairs.z) - Math.hypot(b.x - stairs.x, b.z - stairs.z))[0];
    const goals = buildPlaces(layout, [{ personId: 'n', deskId: near.id, name: 'Near Stairs', department: 'Product' }]).byId.get('person:n').goals;
    const r = findNearestRoute(layout, from, goals, { maps });
    expect(r.problem).toBeUndefined();
    for (const dt of [1 / 60, 0.25]) {
      const w = walk(layout, r, { maps, dt });
      expect(w.arrived).toBe(true);
      expect(w.time).toBeLessThan(r.seconds * 1.6 + 3);
      expect(w.minWall).toBeGreaterThan(BODY_RADIUS + 0.01);
      expect(w.minItem).toBeGreaterThan(BODY_RADIUS + 0.01);
    }
  });

  it('tightAhead: a 1 m door and a narrow aisle are tight, the corridor is not', () => {
    const map = maps.get(layout, 0);
    const across = (x, z0, z1) => routePath({ legs: [{ floor: 0, points: [{ x, z: z0 }, { x, z: z1 }] }], length: Math.abs(z1 - z0) });
    expect(tightAhead(map, across(-31, 0, 4), 0)).toBe(true); // into the stairs room (1 m door at z 1.6)
    const along = routePath({ legs: [{ floor: 0, points: [{ x: -10, z: 0 }, { x: 10, z: 0 }] }], length: 20 });
    expect(tightAhead(map, along, 0)).toBe(false); // the 3 m corridor
  });

  it('the nearest washroom from the entrance', () => {
    const washrooms = index.places.filter((p) => p.facility === 'RESTROOM' && p.kind !== 'nearest');
    const r = findNearestRoute(layout, from, washrooms.flatMap((p) => p.goals), { maps });
    expect(r.problem).toBeUndefined();
    const w = walk(layout, r, { maps });
    expect(w.arrived).toBe(true);
    expect(w.minWall).toBeGreaterThan(BODY_RADIUS);
  });

  it('itemDistance: Infinity far from furniture, the distance near it', () => {
    const map = buildWalkMap(layout, 0, { catalog: ASSET_TYPES });
    expect(itemDistance(map, spawn.x, spawn.z)).toBe(Infinity); // outside, in the street
    const d = layout.objects.find((o) => o.floor === 0 && o.assetType === 'DESK_STANDARD');
    expect(itemDistance(map, d.x, d.z)).toBe(0);
  });

  it('routes from findRoute too (one goal)', () => {
    const r = findRoute(layout, from, index.byId.get('person:far').goals[0], { maps });
    expect(walk(layout, r, { maps, check: false }).arrived).toBe(true);
  });
});

describe('a flight on the path (v0.14.5)', () => {
  it('is walked along its own line (via), and the path is as long as the route says', () => {
    const route = {
      length: 10,
      legs: [
        { floor: 0, points: [{ x: 0, z: 0 }, { x: 3, z: 0 }], stairsAtEnd: { kind: 'stairs', toFloor: 1, length: 4, via: [{ x: 3.5, z: 0 }, { x: 7.5, z: 0 }] } },
        { floor: 1, points: [{ x: 8, z: 0 }, { x: 10, z: 0 }] },
      ],
    };
    const p = routePath(route);
    const on = p.points.filter((q) => q.inFlight);
    expect(on.map((q) => q.x)).toEqual([3.5, 7.5]);
    expect(p.length).toBeCloseTo(route.length, 5);
  });
  it('the speeds: Take me there walks at the one walking speed', () => {
    expect(AUTO_SPEED).toBe(WALK_SPEED);
  });
});
