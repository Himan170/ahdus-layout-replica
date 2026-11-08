import { describe, it, expect } from 'vitest';
import {
  entranceSpawn, mainEntrance, outsideDoors, nearestFree, facingYaw, insideAnyRoom, ENTRANCE_DISTANCE,
} from '../entrance';
import {
  buildWalkMap, wallObstacles, itemObstacles, distanceToRect, FREE, STAIRS, BLOCKED, CLEARANCE, ITEM_CLEARANCE, SKIRTING_OUT,
} from '../walkMap';
import { wallThicknessOf } from '../../geometry';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { meridianLike } from './meridianLike';
import { randomLayout } from './randomLayouts';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({ id, assetType, floor: 0, x, y: 0, z, rotationY: 0, ...more });
const spawnOf = (rooms, objects = []) => entranceSpawn({ rooms, objects, floors }, { catalog: ASSET_TYPES });

/** Angle (radians, 0..π) between where yaw looks and the direction from `at` to `to`. */
const offAngle = (yaw, at, to) => {
  const d = Math.abs(yaw - facingYaw(at, to)) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
const TEN_DEGREES = (10 * Math.PI) / 180;

/**
 * Checked without the walk map: the body (radius CLEARANCE) is clear of every room's walls (the room's
 * whole rectangle ring, door gaps ignored) and of every solid item of the ground floor.
 */
function clearOfEverything(layout, at) {
  const ground = layout.rooms.filter((r) => r.floor === 0);
  for (const r of ground) {
    const t = wallThicknessOf(r) / 2 + SKIRTING_OUT;
    const outer = { x: r.x, z: r.z, hw: r.width / 2 + t, hd: r.depth / 2 + t, rot: 0 };
    const inner = { x: r.x, z: r.z, hw: r.width / 2 - t, hd: r.depth / 2 - t, rot: 0 };
    const nearRing = distanceToRect(outer, at.x, at.z) < CLEARANCE - 1e-9 &&
      !(distanceToRect(inner, at.x, at.z) === 0 && Math.min(
        inner.hw - Math.abs(at.x - r.x), inner.hd - Math.abs(at.z - r.z)) >= CLEARANCE - 1e-9);
    if (nearRing) return `near the walls of ${r.id}`;
  }
  for (const o of itemObstacles(layout.objects, 0, ASSET_TYPES)) {
    if (distanceToRect(o, at.x, at.z) < ITEM_CLEARANCE - 1e-9) return `in ${o.objectId}`;
  }
  return null;
}

describe('the Meridian-shaped layout', () => {
  it('with its spawn point: there, on the ground floor, facing +Z (the lobby door)', () => {
    const layout = meridianLike();
    const s = entranceSpawn(layout, { catalog: ASSET_TYPES });
    expect(s).toMatchObject({ source: 'spawnPoint', floor: 0, moved: false, yaw: 0 });
    expect(s.x).toBeCloseTo(-25, 0);
    expect(s.z).toBeCloseTo(-19.15, 0);
    expect(clearOfEverything(layout, s)).toBeNull();
  });

  it('without it: 3 m outside the lobby\'s outside door, facing it (not inside Customer Success, as before)', () => {
    const layout = meridianLike({ spawnPoint: false });
    const s = entranceSpawn(layout, { catalog: ASSET_TYPES });
    expect(s.source).toBe('entrance');
    expect(s.floor).toBe(0);
    expect(s.door).toMatchObject({ roomId: 'room_f0_02', wall: 'south', width: 2.4 });
    expect(s.x).toBeCloseTo(-25, 1);
    expect(s.z).toBeCloseTo(-15.65 - 0.075 - ENTRANCE_DISTANCE, 1);
    expect(offAngle(s.yaw, s, s.door)).toBeLessThan(TEN_DEGREES);
    expect(insideAnyRoom(layout.rooms.filter((r) => r.floor === 0), s.x, s.z)).toBe(false);
    expect(clearOfEverything(layout, s)).toBeNull();
  });

  it('only the lobby\'s south door leads outside (the others open onto the corridor)', () => {
    const doors = outsideDoors(meridianLike(), 0);
    expect(doors.map((d) => `${d.roomId} ${d.wall}`)).toEqual(['room_f0_02 south']);
  });
});

describe('entranceSpawn', () => {
  it('a spawn point inside a desk moves to the nearest free spot', () => {
    const rooms = [room('office', 0, 0, 10, 8)];
    const objects = [item('d', 'DESK_STANDARD', 2, 1), item('s', 'SPAWN_POINT', 2, 1, { rotationY: 1 })];
    const s = spawnOf(rooms, objects);
    expect(s).toMatchObject({ source: 'spawnPoint', moved: true, yaw: 1, floor: 0 });
    expect(Math.hypot(s.x - 2, s.z - 1)).toBeLessThan(1.3);
    expect(clearOfEverything({ rooms, objects }, s)).toBeNull();
  });

  it('a spawn point on another floor is not used: the walkthrough starts on the ground floor', () => {
    const rooms = [room('g', 0, 0, 10, 8, { doors: [{ wall: 'east', offset: 1, width: 1.2 }] }), room('u', 0, 0, 10, 8, { floor: 1 })];
    const s = spawnOf(rooms, [item('s', 'SPAWN_POINT', 0, 0, { floor: 1 })]);
    expect(s.source).toBe('entrance');
    expect(s.floor).toBe(0);
    expect(s.x).toBeCloseTo(5 + 0.075 + 3, 1);
    expect(s.z).toBeCloseTo(1, 1);
    expect(offAngle(s.yaw, s, s.door)).toBeLessThan(TEN_DEGREES);
  });

  it('a reception\'s outside door wins over a wider door of another room', () => {
    const rooms = [
      room('hall', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: 0, width: 3 }] }),
      room('reception', 10.15, 0, 10, 8, { type: 'RECEPTION', doors: [{ wall: 'south', offset: 2, width: 1.2 }] }),
    ];
    expect(mainEntrance({ rooms, floors }, 0)).toMatchObject({ roomId: 'reception', width: 1.2 });
    expect(mainEntrance({ rooms: [rooms[0], { ...rooms[1], type: 'OFFICE' }], floors }, 0)).toMatchObject({ roomId: 'hall' });
  });

  it('doors to a neighbour, doors of a room inside a room and doors facing another room don\'t lead outside', () => {
    const a = room('a', 0, 0, 10, 8, { doors: [{ wall: 'east', offset: 0, width: 1 }] });
    const b = room('b', 10.15, 0, 10, 8, { doors: [{ wall: 'west', offset: 2, width: 1 }] }); // back to back with a
    const outer = room('outer', 30, 0, 14, 10);
    const inner = room('inner', 28, 0, 6, 4, { doors: [{ wall: 'west', offset: 0, width: 1 }] });
    const facing = room('facing', 0, 11, 10, 8, { doors: [{ wall: 'south', offset: 0, width: 1 }] });
    const across = room('across', 0, 5.35, 10, 1.2); // 1 m in front of facing's door (its south wall is at z = 7)
    const doors = outsideDoors({ rooms: [a, b, outer, inner, facing, across], floors }, 0);
    expect(doors.map((d) => d.roomId)).not.toContain('a');
    expect(doors.map((d) => d.roomId)).not.toContain('b');
    expect(doors.map((d) => d.roomId)).not.toContain('inner');
    expect(doors.map((d) => d.roomId)).not.toContain('facing');
    expect(outsideDoors({ rooms: [facing], floors }, 0).map((d) => d.roomId)).toEqual(['facing']); // alone, it does
  });

  it('no door leads outside: 3 m outside the middle of the −Z side, facing the building', () => {
    const rooms = [room('a', 0, 0, 10, 8), room('b', 10.15, 0, 10, 8)];
    const s = spawnOf(rooms);
    expect(s.source).toBe('buildingSide');
    expect(s.x).toBeCloseTo(5.075, 1);
    expect(s.z).toBeCloseTo(-4 - 0.075 - 3, 1);
    expect(s.yaw).toBe(0);
  });

  it('something standing on the spot: the nearest free spot outside, still facing the door', () => {
    const rooms = [room('a', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: 0, width: 1.2 }] })];
    const objects = [item('p', 'VENDING_MACHINE', 0, -7.1)];
    const s = spawnOf(rooms, objects);
    expect(s).toMatchObject({ source: 'entrance', moved: true });
    expect(clearOfEverything({ rooms, objects }, s)).toBeNull();
    expect(offAngle(s.yaw, s, s.door)).toBeLessThan(TEN_DEGREES);
  });

  it('no rooms: (0, −8), facing +Z, as before', () => {
    expect(spawnOf([])).toMatchObject({ x: expect.closeTo(0, 1), z: expect.closeTo(-8, 1), yaw: 0, floor: 0, source: 'origin' });
  });
});

describe('nearestFree', () => {
  it('finds the closest free cell, never a blocked one, and honours accept / values', () => {
    // the stairs lead to a room on Floor 1 (stairs that lead nowhere are a block: walkMap.test.js)
    const rooms = [
      room('office', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: 0, width: 1.2 }] }),
      room('up', 0, 0, 10, 8, { floor: 1 }),
    ];
    const objects = [item('d', 'DESK_STANDARD', 0, 0), item('st', 'STAIRCASE', 3, 0)];
    const map = buildWalkMap({ rooms, objects, floors }, 0, { catalog: ASSET_TYPES });
    const spot = nearestFree(map, 0, 0);
    expect(map.at(spot.x, spot.z)).toBe(FREE);
    expect(spot.distance).toBeLessThan(0.4 + CLEARANCE + 0.1); // just off the desk's long side
    expect(nearestFree(map, -3, -4)).toMatchObject({ distance: expect.any(Number) }); // in the wall: off it
    expect(map.at(-3, -4)).toBe(BLOCKED);
    const outside = nearestFree(map, 0, -3.5, { accept: (x, z) => !insideAnyRoom(rooms, x, z) });
    expect(insideAnyRoom(rooms, outside.x, outside.z)).toBe(false);
    expect(nearestFree(map, 3, 0, { values: [FREE, STAIRS] }).distance).toBeLessThan(0.08); // the stairs are fine here
    expect(nearestFree(map, 0, 0, { maxDistance: 0.3 })).toBeNull();
  });
});

// ── 200 random layouts ──

describe('200 random layouts', () => {
  it('the spawn is free, outside every room, on the ground floor, facing the entrance (within 10°)', () => {
    const problems = [];
    const sources = {};
    for (let seed = 1; seed <= 200; seed++) {
      const layout = randomLayout(seed);
      const s = entranceSpawn(layout, { catalog: ASSET_TYPES });
      sources[s.source] = (sources[s.source] ?? 0) + 1;
      const ground = layout.rooms.filter((r) => r.floor === 0);
      const map = buildWalkMap(layout, 0, { catalog: ASSET_TYPES });
      const trouble = [
        s.floor !== 0 && 'not on the ground floor',
        !map.isFree(s.x, s.z) && 'not free on the walk map',
        clearOfEverything(layout, s),
        insideAnyRoom(ground, s.x, s.z, CLEARANCE) && 'inside a room (or in a doorway)',
        s.source === 'entrance' && offAngle(s.yaw, s, s.door) > TEN_DEGREES && 'not facing the door',
        s.source === 'entrance' && insideAnyRoom(ground, s.door.x + s.door.normal.x, s.door.z + s.door.normal.z) && 'the door doesn\'t lead outside',
        s.source === 'entrance' && Math.hypot(s.x - s.door.x, s.z - s.door.z) > ENTRANCE_DISTANCE + 6.5 && 'far from the door',
      ].filter(Boolean);
      if (trouble.length) problems.push(`seed ${seed} (${s.source}): ${trouble.join(', ')}`);
      // the walls the map uses are the ones the renderer builds: none of them is under the spawn
      if (wallObstacles(ground).some((w) => distanceToRect(w, s.x, s.z) < CLEARANCE)) problems.push(`seed ${seed}: in a wall`);
    }
    expect(problems).toEqual([]);
    expect(sources.entrance).toBeGreaterThan(100); // most layouts have a door outside
    expect(sources.buildingSide ?? 0).toBeGreaterThan(0);
  });
});
