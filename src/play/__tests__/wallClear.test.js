import { describe, it, expect } from 'vitest';
import {
  floorWallBoxes, itemRects, wallHit, clearOfWalls, insideWalls, isWallFree, WALL_TOLERANCE, IN_WALL_WARN,
} from '../wallClear';
import { mountOnWall, wallPieces } from '../wallMount';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const T = 0.15;
const room = (id, x, z, width, depth, extra = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3, wallThickness: T, doors: [], windows: [], ...extra,
});
const item = (id, assetType, x, z, extra = {}) => ({
  id, assetType, floor: 0, x, y: 0, z, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra,
});
// Office x −5..5, z −4..4; its east wall shared with Board x 5..11
const office = room('office', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: -3, width: 1, height: 2.1 }] });
const board = room('board', 8, 0, 6, 8, { glassWalls: ['east'] });
const rooms = [office, board];
const C = ASSET_TYPES;
const walls = (objects = []) => floorWallBoxes(rooms, objects, 0, { catalog: C });
const FACE_W = -5 + T / 2; // the office's west wall, inner face
const placed = (o, res) => ({ ...o, x: o.x + res.dx, z: o.z + res.dz });
const inWall = (o, objs = []) => wallHit(itemRects(o, C), walls(objs));

describe('wallClear (v0.18.9): furniture never in a wall', () => {
  it('a cabinet in the west wall is found; one beside it is clear', () => {
    expect(inWall(item('c', 'FILING_CABINET', -4.9, 0))?.depth).toBeGreaterThan(0.1);
    expect(inWall(item('c', 'FILING_CABINET', FACE_W + 0.23 + 0.01, 0))).toBeNull();
  });

  it('pushed out flush to the side it came from', () => {
    const c = item('c', 'FILING_CABINET', -4.9, 0);
    const res = clearOfWalls([c], walls(), { catalog: C, from: { x: -3, z: 0 } });
    expect(res.ok).toBe(true);
    const p = placed(c, res);
    expect(p.x - 0.23).toBeCloseTo(FACE_W, 2); // its back on the face
    expect(inWall(p)).toBeNull();
  });

  it('from the other side (outside), it ends outside against the outer face', () => {
    const c = item('c', 'FILING_CABINET', -5.1, 0);
    const p = placed(c, clearOfWalls([c], walls(), { catalog: C, from: { x: -7, z: 0 } }));
    expect(p.x + 0.23).toBeCloseTo(-5 - T / 2, 2);
  });

  it('a turned long table (R) beside the wall is pushed out by its turned footprint', () => {
    // 3.2 × 1.4, its length along X after the turn, its middle 1.0 m from the west face
    const t = item('t', 'TABLE_MEETING', FACE_W + 1.0, 0);
    const res = clearOfWalls([t], walls(), { catalog: C, from: { x: t.x, z: 0 } });
    const p = placed(t, res);
    expect(p.x - 1.6).toBeCloseTo(FACE_W, 2);
    // turned 15°: the corner touches the face
    const t15 = { ...t, rotationY: Math.PI / 12 };
    const p15 = placed(t15, clearOfWalls([t15], walls(), { catalog: C, from: { x: t.x, z: 0 } }));
    expect(inWall(p15)).toBeNull();
    const reach = 1.6 * Math.cos(Math.PI / 12) + 0.7 * Math.sin(Math.PI / 12);
    expect(p15.x - reach).toBeCloseTo(FACE_W, 2);
  });

  it('into a corner: out of both walls', () => {
    const c = item('c', 'FILING_CABINET', -4.95, -3.95);
    const p = placed(c, clearOfWalls([c], walls(), { catalog: C, from: { x: 0, z: 0 } }));
    expect(inWall(p)).toBeNull();
    expect(p.x - 0.23).toBeCloseTo(FACE_W, 2);
    expect(p.z - itemRects(c, C)[0].hd).toBeCloseTo(-4 + T / 2, 2);
  });

  it('too big for the room: refused', () => {
    const t = item('t', 'TABLE_MEETING', 0, 0, { scaleX: 4 }); // 12.8 m in a 10 m room
    expect(clearOfWalls([t], walls(), { catalog: C, from: { x: 0, z: 0 } }).ok).toBe(false);
  });

  it('a shared wall and a glass wall are walls too', () => {
    expect(inWall(item('c', 'FILING_CABINET', 5, 0))).not.toBeNull();
    expect(inWall(item('c', 'FILING_CABINET', 11, 0))).not.toBeNull();
  });

  it('a Wall-tool wall and a glass partition block furniture; columns, rugs, markers, stairs may stand in walls', () => {
    const seg = item('w', 'WALL_SEGMENT', 1, 1.5, { rotationY: Math.PI / 2 });
    const glass = item('g', 'GLASS_PARTITION', -2, 2);
    expect(inWall(item('c', 'FILING_CABINET', 1.05, 1.5), [seg])).not.toBeNull();
    expect(inWall(item('c', 'FILING_CABINET', -2, 2.05), [glass])).not.toBeNull();
    for (const t of ['COLUMN', 'RUG', 'SPAWN_POINT', 'ZONE_MARKER', 'STAIRCASE', 'WALL_SEGMENT', 'GLASS_PARTITION', 'DOOR_SINGLE', 'WINDOW_FRAME']) {
      expect(isWallFree({ assetType: t }, C)).toBe(true);
      expect(clearOfWalls([item('x', t, -5, 0)], walls(), { catalog: C }).pushed).toBe(false);
    }
  });

  it('heights count: under a door\'s opening is no wall; under a window the wall below it is', () => {
    // a chair in the south doorway (south = −Z; the door is 1 m wide at x −3.5..−2.5, 2.1 m high)
    expect(inWall(item('ch', 'CHAIR_OFFICE', -3, -4))).toBeNull();
    expect(inWall(item('ch', 'CHAIR_OFFICE', -2, -4))).not.toBeNull(); // beside it: the wall
    const win = room('win', 0, 20, 10, 8, { windows: [{ wall: 'north', offset: 0, width: 2, height: 1.2, sill: 0.9 }] });
    const w2 = floorWallBoxes([win], [], 0, { catalog: C });
    const low = item('c', 'FILING_CABINET', 0, 23.9, {}); // north = +Z (z 24); 1.32 m high: into the wall below the window
    expect(wallHit(itemRects(low, C), w2)).not.toBeNull();
    const plant = item('p', 'PLANT_SMALL', 0, 23.95, { y: 0.95 }); // on the sill, in the window's opening
    expect(wallHit(itemRects({ ...plant, scaleY: 0.5 }, C), w2)).toBeNull();
  });

  it('a group (a desk and its chair) moves as one', () => {
    const desk = item('d', 'DESK_STANDARD', -4.6, 0, { rotationY: Math.PI / 2 }); // 0.8 deep across X now
    const chair = item('ch', 'CHAIR_OFFICE', -3.8, 0);
    const res = clearOfWalls([desk, chair], walls(), { catalog: C, from: { x: -3, z: 0 } });
    expect(res.ok).toBe(true);
    expect(inWall(placed(desk, res))).toBeNull();
    // the chair kept its place beside the desk
    expect(placed(chair, res).x - placed(desk, res).x).toBeCloseTo(0.8);
  });

  it('a wall item hung by mountOnWall is clear of its wall (5 mm), one pushed into it comes back onto the face', () => {
    const pieces = wallPieces(rooms, []);
    const tv = item('tv', 'TV_DISPLAY', 0, -3.5);
    const m = mountOnWall(tv, { x: 0, z: -3.5 }, pieces, { catalog: C });
    const hung = { ...tv, ...m };
    expect(inWall(hung)).toBeNull();
    const pushed = { ...hung, z: hung.z - 0.1 };
    expect(inWall(pushed)).not.toBeNull();
    const back = placed(pushed, clearOfWalls([pushed], walls(), { catalog: C, from: { x: hung.x, z: hung.z } }));
    expect(back.z).toBeCloseTo(hung.z, 2);
  });

  it('a projector screen (its back not at depth / 2) hung right is clear', () => {
    const pieces = wallPieces(rooms, []);
    const s = item('s', 'PROJECTOR_SCREEN', 0, 3.5);
    const hung = { ...s, ...mountOnWall(s, { x: 0, z: 3.5 }, pieces, { catalog: C }) };
    expect(inWall(hung)).toBeNull();
  });

  it('insideWalls: what Check lists, and where Move out puts it (its own room\'s side)', () => {
    const shelf = item('shelf', 'BOOKSHELF', 5.05, -2, { rotationY: Math.PI / 2, roomId: 'office' });
    const fine = item('fine', 'FILING_CABINET', 0, 0);
    const found = insideWalls(rooms, [shelf, fine], 0, { catalog: C });
    expect(found.map((f) => f.item.id)).toEqual(['shelf']);
    expect(found[0].to.x + 0.175).toBeCloseTo(5 - T / 2, 2); // its 0.35 m depth along X: in the office
    // no room of its own: the side its middle is on (the board room)
    const loose = insideWalls(rooms, [{ ...shelf, roomId: null }], 0, { catalog: C });
    expect(loose[0].to.x - 0.175).toBeCloseTo(5 + T / 2, 2);
    expect(WALL_TOLERANCE).toBeLessThan(0.01);
  });

  it('insideWalls: less than 3 cm into a wall is not listed (touching, an older layout's lamp)', () => {
    // the cabinet's west side 2.5 cm past the room's west wall face, then 4 cm
    const at = (d) => item('c', 'FILING_CABINET', FACE_W + 0.23 - d, 0, { roomId: 'office' });
    expect(IN_WALL_WARN).toBe(0.03);
    expect(insideWalls(rooms, [at(0.025)], 0, { catalog: C })).toEqual([]);
    expect(insideWalls(rooms, [at(0)], 0, { catalog: C })).toEqual([]);
    const deep = insideWalls(rooms, [at(0.04)], 0, { catalog: C });
    expect(deep.map((f) => f.item.id)).toEqual(['c']);
    expect(deep[0].depth).toBeCloseTo(0.04, 3);
    // asked for any depth: the 2.5 cm one too
    expect(insideWalls(rooms, [at(0.025)], 0, { catalog: C, tolerance: 0 })).toHaveLength(1);
  });

  it('an arrow-key step (sweep) never jumps a wall: a step that would end clear past it stops at it', () => {
    // a cabinet 0.1 m off the west face, one 1 m step left: the end is clear, outside the room
    const c = item('c', 'FILING_CABINET', FACE_W + 0.23 + 0.1, 0);
    const stepped = { ...c, x: c.x - 1 };
    expect(inWall(stepped)).toBeNull();
    expect(clearOfWalls([stepped], walls(), { catalog: C, from: { x: c.x, z: 0 } }).dx).toBe(0); // a drag may
    const res = clearOfWalls([stepped], walls(), { catalog: C, from: { x: c.x, z: 0 }, sweep: { dx: -1, dz: 0 } });
    expect(res.ok).toBe(true);
    expect(placed(stepped, res).x - 0.23).toBeCloseTo(FACE_W, 2); // flush on the side it came from
    // a hung TV, ArrowUp (0.5 m into its wall): it stays on the face
    const pieces = wallPieces(rooms, []);
    const tv = item('tv', 'TV_DISPLAY', 0, -3.5);
    const hung = { ...tv, ...mountOnWall(tv, { x: 0, z: -3.5 }, pieces, { catalog: C }) };
    const up = { ...hung, z: hung.z - 0.5 };
    const back = placed(up, clearOfWalls([up], walls(), { catalog: C, from: { x: hung.x, z: hung.z }, sweep: { dx: 0, dz: -0.5 } }));
    expect(back.z).toBeCloseTo(hung.z, 2);
    // an item in a wall from an old save may be stepped out of it
    const old = item('o', 'FILING_CABINET', -4.9, 0);
    const out = { ...old, x: old.x + 0.5 };
    expect(clearOfWalls([out], walls(), { catalog: C, from: { x: old.x, z: 0 }, sweep: { dx: 0.5, dz: 0 } })).toMatchObject({ ok: true, dx: 0, dz: 0 });
  });

  it('upper floors: only that floor\'s walls', () => {
    const up = { ...office, id: 'up', floor: 1 };
    const c = { ...item('c', 'FILING_CABINET', -4.95, 0), floor: 1 };
    expect(wallHit(itemRects(c, C), floorWallBoxes([office, up], [], 1, { catalog: C }))).not.toBeNull();
    expect(floorWallBoxes([up], [], 0, { catalog: C })).toEqual([]);
  });
});
