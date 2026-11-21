// play/stairFit.js (v0.17.4): stairs that always work. Free floor at both ends, plain words, the floor
// they miss, the nearest spot that works; checkLayout's Fix it; an item that blocks a door.

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stairFit, stairProblems, stairSpots, findStairSpot, findItemSpot, stairPreview, snapStairToWall, STAIR_CLEAR } from '../stairFit';
import { stairTop, rectContains, roomRect, STAIRS_LEAD_NOWHERE } from '../building';
import { floorLinks } from '../navigation/route';
import { checkLayout, walkingProblems, CHECK_KINDS } from '../navigation/checkLayout';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { normaliseLayout } from '../../store/layoutData';

const DEG = Math.PI / 180;
const catalog = ASSET_TYPES;
const oneFloor = { 0: { id: 0, name: 'Ground Floor', height: 4 } };
const twoFloors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const stair = (over = {}) => ({
  id: 's', assetType: 'STAIRCASE', floor: 0, x: 0, y: 0, z: 0,
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...over,
});
const room = (id, name, x, z, width, depth, over = {}) => ({
  id, name, type: 'OFFICE', floor: 0, x, z, width, depth, wallHeight: 3.2, wallThickness: 0.15, doors: [], windows: [], ...over,
});
const item = (assetType, x, z, over = {}) => ({
  id: `${assetType}_${x}_${z}`, assetType, floor: 0, x, y: 0, z,
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...over,
});
const codes = (s, layout) => stairFit(s, layout, { catalog }).problems.map((p) => p.code);
// a big hall on both floors: any flight in its middle fits
const halls = () => [room('h0', 'Hall', 0, 0, 20, 20, { doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] }),
  room('h1', 'Upper hall', 0, 0, 20, 20, { floor: 1 })];

describe('stairFit: what Studio says about a staircase', () => {
  // a small stair room, 2.5 × 3.5 m (x 4.75 … 7.25, z −4.75 … −1.25), a door on its west and east walls
  const stairRoom = room('sr', 'Stair hall', 6, -3, 2.5, 3.5, { type: 'STAIRCASE', wallHeight: 3.7,
    doors: [{ wall: 'east', offset: 0, width: 1, height: 2.1 }, { wall: 'west', offset: 0.5, width: 1, height: 2.1 }] });

  it('a half-size flight turned round: leads nowhere, its bottom step faces the wall, it stands in front of the west door', () => {
    const s = stair({ x: 5.4, z: -2.4, rotationY: Math.PI, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 });
    const problems = stairProblems(s, oneFloor, [stairRoom]);
    expect(problems.map((p) => p.code)).toEqual(['NOWHERE', 'NO_STEP_ON', 'BLOCKS_DOOR']);
    expect(problems[0].text).toBe(`${STAIRS_LEAD_NOWHERE}: there is no floor above. Add one, with a room where they arrive`);
    // v0.17.4: plain words, no metres to work out
    expect(problems[1].text).toBe('The stairs are too close to the wall of Stair hall: there is no room to step onto them');
    expect(problems[2].text).toBe('The stairs block a door of Stair hall');
  });

  it('the bottom step 0.3 m from the wall (as found on Render, v0.17.3): the missing floor is shaded', () => {
    const r = room('sr', 'Stair hall', 5.325, -3.825, 5.35, 6.35, { type: 'STAIRCASE' }); // z −7 … −0.65
    const s = stair({ x: 5, z: -3, rotationY: Math.PI }); // bottom step at z −1, the wall's inside face at −0.725
    const fit = stairFit(s, { floors: oneFloor, rooms: [r] }, { catalog });
    expect(fit.problems.filter((p) => p.code !== 'NOWHERE').map((p) => p.code)).toEqual(['NO_STEP_ON']);
    // 0.25 m of floor there: the other 0.55 m is missing, 1.2 m wide, beyond the wall (z > −0.75)
    const [shade] = fit.shade;
    expect(shade).toMatchObject({ floor: 0, x: 5, hw: 0.6 });
    expect(shade.hd * 2).toBeCloseTo(STAIR_CLEAR - 0.25, 5);
    expect(shade.z - shade.hd).toBeCloseTo(-1 + 0.25, 5);
    expect(codes({ ...s, z: -3.6 }, { floors: oneFloor, rooms: [r] })).toEqual(['NOWHERE']);
  });

  it('a normal-size flight (4 m) sticks out of a 3.5 m stair room', () => {
    expect(codes(stair({ x: 6, z: -3 }), { floors: oneFloor, rooms: [stairRoom] })).toContain('STICKS_OUT');
  });

  it('a floor above with no room where they arrive: build one there (and the missing landing is shaded up there)', () => {
    const fit = stairFit(stair(), { floors: twoFloors, rooms: [halls()[0]] }, { catalog });
    expect(fit.problems[0]).toEqual({ code: 'NOWHERE', text: `${STAIRS_LEAD_NOWHERE}: build a room on Floor 1 where they arrive` });
    expect(fit.shade).toEqual([expect.objectContaining({ floor: 1 })]);
  });

  it('a flight in the middle of a big room, with a room above: nothing to say, at every turn', () => {
    for (const a of [0, 90, 180, 270, 45]) {
      expect(stairFit(stair({ x: 3, z: 2, rotationY: a * DEG }), { floors: twoFloors, rooms: halls() }, { catalog })).toMatchObject({ ok: true, problems: [], shade: [] });
    }
  });

  it('outside every room, with nothing near: only "leads nowhere" counts', () => {
    expect(codes(stair({ x: 100, z: 0 }), { floors: oneFloor, rooms: [stairRoom] })).toEqual(['NOWHERE']);
  });

  it('the top step too close to a wall upstairs: no room to step off', () => {
    // the upper room's wall 0.7 m past the top step (+Z end at z 2): the landing needs 0.8 m
    const rooms = [halls()[0], room('u', 'Upper', 0, -2.5375, 6, 10.625, { floor: 1 })]; // z −7.85 … 2.775, inside face 2.7
    const fit = stairFit(stair(), { floors: twoFloors, rooms }, { catalog });
    expect(fit.problems).toEqual([{ code: 'NO_LANDING', text: 'The stairs end too close to a wall on Floor 1: there is no room to step off at the top' }]);
    expect(fit.shade[0]).toMatchObject({ floor: 1 });
    expect(stairPreview(stair(), { floors: twoFloors, rooms }, { catalog }).zones[0].y).toBeCloseTo(3.5, 5);
  });

  it('the top step right against a wall upstairs (a room there, but they arrive past it): no room to step off, not "build a room"', () => {
    const rooms = [halls()[0], room('u', 'Upper', 0, -2.85, 6, 10, { floor: 1 })]; // inside face 2.075: 0.075 m past the top step
    const fit = stairFit(stair(), { floors: twoFloors, rooms }, { catalog });
    expect(fit.problems.map((p) => p.code)).toEqual(['NO_LANDING']);
    expect(findStairSpot(stair(), { floors: twoFloors, rooms }, { catalog })).toEqual({ x: 0, z: -0.75, roomId: 'h0' });
  });

  it('furniture in the way: at the bottom, at the top, on the flight, over the opening upstairs', () => {
    const layout = (objects) => ({ floors: twoFloors, rooms: halls(), objects });
    expect(stairFit(stair(), layout([item('DESK_STANDARD', 0, -2.4)]), { catalog }).problems)
      .toEqual([{ code: 'IN_THE_WAY', text: 'Standard Desk is in the way at the bottom of the stairs' }]);
    expect(stairFit(stair(), layout([item('BOOKSHELF', 0, 2.5, { floor: 1 })]), { catalog }).problems[0].text)
      .toBe('Bookshelf on Floor 1 is in the way at the top of the stairs');
    expect(stairFit(stair(), layout([item('BOOKSHELF', 0, 0)]), { catalog }).problems[0].text).toBe('Bookshelf stands on the stairs');
    expect(stairFit(stair(), layout([item('BOOKSHELF', 0, 0, { floor: 1 })]), { catalog }).problems[0].text)
      .toBe('Bookshelf on Floor 1 stands over the opening for the stairs');
    // a rug is the floor; a TV on a wall is not in the way
    expect(stairFit(stair(), layout([item('RUG', 0, -2.4)]), { catalog }).ok).toBe(true);
  });

  it('a door of the room next door that opens onto the flight blocks it too (a shared wall)', () => {
    // the hall's neighbour to the north has the door; the stair hall has none of its own
    const hall = room('a', 'Stair hall', 0, -3.5, 5, 7, { type: 'STAIRCASE' });          // z −7 … 0
    const office = room('b', 'Office', 0, 3.5, 5, 7, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] }); // z 0 … 7
    const up = room('c', 'Upper', 0, 0, 20, 20, { floor: 1 });
    const s = stair({ x: 0, z: -2.4 }); // the flight reaches z −0.4, in front of the door at z 0
    expect(codes(s, { floors: twoFloors, rooms: [hall, office, up] })).toContain('BLOCKS_DOOR');
  });
});

describe('an L staircase is checked by its arms, not its square (v0.18.6, audit 4b)', () => {
  // 12 x 12 rooms on both floors, a right-turning L at (0, 0): its empty corner is x -0.4 … 1.6, z -1.6 … 0.4
  const rooms = (extra = []) => [
    room('a', 'Hall', 0, 0, 12, 12, { doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] }),
    room('b', 'Upper hall', 0, 0, 12, 12, { floor: 1 }), ...extra];
  const L = stair({ metadata: { stairShape: 'L-right' } });

  it('a small room reaching into the empty corner is not in the way', () => {
    const cabin = room('c', 'Corner cabin', 2, -1.1, 2, 2);
    expect(codes(L, { floors: twoFloors, rooms: rooms() })).toEqual([]);
    expect(codes(L, { floors: twoFloors, rooms: rooms([cabin]) })).toEqual([]);
  });
  it('a room over one of its arms still is', () => {
    const onArm = room('c', 'Corner cabin', 1.5, 1.6, 2, 2);
    const fit = stairFit(L, { floors: twoFloors, rooms: rooms([onArm]) }, { catalog });
    expect(fit.problems.map((p) => p.text)).toContain('The stairs run into Corner cabin');
  });
  it('the same when it is turned a quarter', () => {
    const turned = { ...L, rotationY: 90 * DEG };
    // a quarter turn: local (x, z) → world (z, -x): the empty corner is x -1.6 … 0.4, z -1.6 … 0.4
    const cabin = room('c', 'Corner cabin', -1.1, -2, 2, 2);
    expect(codes(turned, { floors: twoFloors, rooms: rooms([cabin]) })).toEqual([]);
  });
});

describe('snapStairToWall: a side of the flight flush to a wall (v0.18.6, audit 4a)', () => {
  // 12 x 12 rooms, 0.15 m walls: the inner face of the east wall is at x 5.925; a 1.2 m flight meets it at x 5.325
  const rooms = [room('a', 'Hall', 0, 0, 12, 12), room('b', 'Upper hall', 0, 0, 12, 12, { floor: 1 })];
  const at = (over) => snapStairToWall(stair(over), rooms);

  it('near the wall, the side goes flush (the half-metre grid would give 5.0 or 5.5)', () => {
    for (const x of [5.0, 5.2, 5.45, 5.6]) expect(at({ x }).x).toBeCloseTo(5.325, 6);
    expect(at({ x: 5.2 }).snapped).toEqual({ x: true, z: false });
    expect(at({ x: -5.1 }).x).toBeCloseTo(-5.325, 6);
    expect(stairFit(stair({ x: 5.325 }), { floors: twoFloors, rooms }, { catalog }).ok).toBe(true);
  });
  it('far from a wall, or at the ends of the flight, nothing snaps (an end needs 0.8 m of floor)', () => {
    expect(at({ x: 4 })).toMatchObject({ x: 4, snapped: { x: false, z: false } });
    expect(at({ x: 0, z: 3.8 })).toMatchObject({ z: 3.8, snapped: { z: false } });
  });
  it('turned a quarter, its sides are along X: they snap in Z', () => {
    const s = at({ x: 0, z: 5.2, rotationY: 90 * DEG });
    expect(s.z).toBeCloseTo(5.325, 6);
    expect(s.snapped).toEqual({ x: false, z: true });
  });
  it("an L: the first flight's outer side and the second flight's outer side", () => {
    const s = at({ x: -4.2, z: 4.2, metadata: { stairShape: 'L-right' } });
    expect(s.x).toBeCloseTo(-5.925 + 1.6, 6);
    expect(s.z).toBeCloseTo(5.925 - 1.6, 6);
  });
  it('the wall of a room inside the hall counts too', () => {
    const cabin = room('c', 'Cabin', 3, 0, 2, 3);
    // the cabin's west wall is 1.925 … 2.075 m: a flight meets it at x 1.325
    expect(snapStairToWall(stair({ x: 1.1 }), [...rooms, cabin]).x).toBeCloseTo(1.325, 6);
  });
});

describe('stairSpots / findStairSpot: the nearest spot that works', () => {
  const hall = room('sr', 'Stair hall', 5.325, -3.825, 5.35, 6.35, { type: 'STAIRCASE' });
  const up = room('u', 'Upper', 5.325, -3.825, 5.35, 6.35, { floor: 1 });
  const layout = { floors: twoFloors, rooms: [hall, up], objects: [] };

  it('moves along the climb, keeps the turn, stays in the room', () => {
    const s = stair({ x: 5, z: -3, rotationY: Math.PI });
    const spot = findStairSpot(s, layout, { catalog });
    expect(spot).toEqual({ x: 5, z: -3.55, roomId: 'sr' }); // 0.55 m: the bottom step 0.8 m from the wall
    expect(stairFit({ ...s, ...spot }, layout, { catalog }).ok).toBe(true);
  });

  it('a spot that already works is the first one', () => {
    const s = stair({ x: 5, z: -3.8, rotationY: Math.PI });
    expect(stairSpots(s, layout, { catalog }).next().value).toEqual({ x: 5, z: -3.8, roomId: 'sr' });
  });

  it('every turn: the spot found works, and is inside the same room', () => {
    const big = room('sr', 'Stair hall', 0, 0, 8, 8, { type: 'STAIRCASE' });
    const l = { floors: twoFloors, rooms: [big, room('u', 'Upper', 0, 0, 8, 8, { floor: 1 })], objects: [] };
    for (const a of [0, 90, 180, 270]) {
      const s = stair({ x: 3.5, z: 3.5, rotationY: a * DEG }); // in a corner: sticks out
      expect(stairFit(s, l, { catalog }).ok).toBe(false);
      const spot = findStairSpot(s, l, { catalog });
      expect(spot, `${a}°`).not.toBeNull();
      expect(stairFit({ ...s, ...spot }, l, { catalog }).ok).toBe(true);
      expect(Math.abs(spot.x) <= 4 && Math.abs(spot.z) <= 4).toBe(true);
    }
  });

  it('none when nothing in the room works (no floor above): null', () => {
    expect(findStairSpot(stair({ x: 5, z: -3, rotationY: Math.PI }), { floors: oneFloor, rooms: [hall] }, { catalog })).toBeNull();
  });
});

describe('findItemSpot: an item that blocks a door', () => {
  it('a bookshelf in front of the only door moves the shortest way to where it blocks nothing', () => {
    const office = room('o', 'Office', 0, 0, 6, 5, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
    const shelf = item('BOOKSHELF', 0, -2.1);
    const layout = { floors: oneFloor, rooms: [office], objects: [shelf] };
    expect(checkLayout(layout, { catalog }).problems.map((p) => p.kind)).toContain(CHECK_KINDS.DOOR_BLOCKED);
    const spot = findItemSpot(shelf, layout, { catalog });
    expect(spot.moves).toHaveLength(1);
    const [[id, at]] = spot.moves;
    expect(id).toBe(shelf.id);
    expect(at.roomId).toBe('o');
    expect(Math.hypot(at.x, at.z + 2.1)).toBeLessThan(2); // near where it was
    expect(checkLayout({ ...layout, objects: [{ ...shelf, ...at }] }, { catalog }).problems).toEqual([]);
  });

  it('a desk takes its chair along', () => {
    const office = room('o', 'Office', 0, 0, 6, 5, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
    const desk = item('DESK_STANDARD', 0, -1.6);
    const chair = item('CHAIR_OFFICE', 0, -1.0, { rotationY: Math.PI });
    const spot = findItemSpot(desk, { floors: oneFloor, rooms: [office], objects: [desk, chair] }, { catalog });
    expect(spot.moves.map(([id]) => id).sort()).toEqual([chair.id, desk.id].sort());
    const [, d] = spot.moves.find(([id]) => id === desk.id);
    const [, c] = spot.moves.find(([id]) => id === chair.id);
    expect(c.x - d.x).toBeCloseTo(0, 5);
    expect(c.z - d.z).toBeCloseTo(0.6, 5);
  });
});

// The layout found on Render (15 Nov 2026), its shape only (names changed): a stair hall with no door of
// its own, entered through the office's door; the stairs' bottom step 0.3 m from that wall
function renderShaped() {
  const d = (wall, offset, width = 1, height = 2.1) => ({ wall, offset, width, height });
  const r = (id, type, floor, x, z, width, depth, doors) => ({ id, name: id, type, floor, x, z, width, depth, wallHeight: 4.6, wallThickness: 0.15, doors, windows: [] });
  return {
    floors: { 0: { id: 0, name: 'Ground Floor', height: 4.9 }, 1: { id: 1, name: 'Floor 1', height: 4.9 } },
    rooms: [
      r('Office', 'OFFICE', 0, 4.5, 3.25, 11, 7.5, [d('west', -1.693), d('east', -0.301), d('south', 0.34), d('south', -3.66)]),
      r('Restroom', 'RESTROOM', 0, 0.75, -2.825, 3.5, 4.35, [d('north', 0.09)]),
      r('Reception', 'MEETING', 0, -5.325, 2.5, 8.35, 14, [d('east', -0.943), d('south', -0.81, 2.1, 2.7)]),
      r('Stair hall', 'STAIRCASE', 0, 5.325, -3.825, 5.35, 6.35, []),
      r('Upper office', 'OFFICE', 1, 4.5, 3.25, 11, 7.5, [d('west', -1.693), d('south', 3.3), d('south', -3.422)]),
      r('Upper restroom', 'RESTROOM', 1, 0.75, -2.825, 3.5, 4.35, [d('north', 0.328)]),
      r('Staircase 2', 'STAIRCASE', 1, 6.325, -3.575, 7.35, 5.85, [d('north', 1.48)]),
      r('Meeting', 'MEETING', 1, -5.325, 4.75, 8.35, 9.5, [d('east', -3.193)]),
    ],
    objects: [stair({ id: 'stairs', x: 5, z: -3, rotationY: Math.PI, roomId: 'Stair hall' })],
  };
}

describe('Check my layout: Fix it (v0.17.4)', () => {
  const check = (layout) => checkLayout(layout, { catalog }).problems;
  const apply = (layout, fix) => {
    const moves = new Map(fix.moves);
    return { ...layout, objects: layout.objects.map((o) => (moves.has(o.id) ? { ...o, ...moves.get(o.id) } : o)) };
  };

  it('the Render layout: every walking problem has a Fix it, and after it Check is clean and the stairs reach Staircase 2', () => {
    const layout = renderShaped();
    const problems = check(layout);
    expect(problems.map((p) => [p.kind, p.code ?? null])).toEqual([
      [CHECK_KINDS.ROOM_UNREACHABLE, null],
      [CHECK_KINDS.STAIRS, 'NO_STEP_ON'],
      [CHECK_KINDS.STAIRS, 'BLOCKS_DOOR'],
    ]);
    expect(problems.every((p) => p.blocksWalking && p.fix)).toBe(true);
    expect(problems.find((p) => p.code === 'NO_STEP_ON').message).toBe('The stairs are too close to the wall of Stair hall: there is no room to step onto them');
    // one move fixes all three
    const fixed = apply(layout, problems[0].fix);
    expect(problems[0].fix.moves).toEqual([['stairs', { x: 5, z: -3.55, roomId: 'Stair hall' }]]);
    expect(check(fixed)).toEqual([]);
    const moved = fixed.objects[0];
    const top = stairTop(moved);
    expect(rectContains(roomRect(fixed.rooms.find((r) => r.id === 'Staircase 2')), top.x, top.z)).toBe(true);
    expect(floorLinks(fixed)).toHaveLength(1);
  });

  it('a desk in the only door of an office: Fix it moves it (and its chair), and the office can be walked to again', () => {
    const office = room('o', 'Office', 0, 0, 6, 5, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }, { wall: 'west', offset: 0, width: 1, height: 2.1 }] });
    const inner = room('i', 'Small office', 1.5, 0.75, 3, 3.5, { doors: [{ wall: 'west', offset: -0.5, width: 1, height: 2.1 }] });
    const shelf = item('BOOKSHELF', -0.1, 0.25, { rotationY: Math.PI / 2 }); // in front of the small office's door
    const layout = { floors: oneFloor, rooms: [office, inner], objects: [shelf] };
    const problems = check(layout);
    const lost = problems.find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE);
    expect(lost?.roomId).toBe('i');
    expect(lost.fix).toBeTruthy();
    expect(problems.find((p) => p.kind === CHECK_KINDS.DOOR_BLOCKED)?.fix).toBeTruthy();
    const after = check(apply(layout, lost.fix));
    expect(after.filter((p) => p.blocksWalking || p.kind === CHECK_KINDS.DOOR_BLOCKED)).toEqual([]);
  });

  it('no fix offered where moving can\'t help (stairs with no floor above)', () => {
    const layout = { floors: oneFloor, rooms: [halls()[0]], objects: [stair()] };
    const [p] = check(layout);
    expect(p).toMatchObject({ code: 'NOWHERE', blocksWalking: true });
    expect(p.fix).toBeUndefined();
  });

  it('walkingProblems: Publish lists walking problems even when ignored, and only those', () => {
    const layout = renderShaped();
    layout.objects.push(item('BOOKSHELF', 4, 1), item('BOOKSHELF', 4.3, 1)); // two shelves in each other: a warning
    const problems = check(layout);
    expect(problems.some((p) => p.kind === CHECK_KINDS.ITEMS_OVERLAP)).toBe(true);
    const ignored = problems.map((p) => p.key);
    const list = walkingProblems(problems, ignored);
    expect(list).toHaveLength(3);
    expect(list.every((p) => p.ignored && p.blocksWalking)).toBe(true);
  });

  it('checking a layout of 5 problems with fixes stays quick (< 600 ms)', () => {
    const t = performance.now();
    check(renderShaped());
    expect(performance.now() - t).toBeLessThan(600);
  });
});

// The real file (private-docs, Himan's laptop only): the same, on a copy of it
const REAL = 'private-docs/rusborn-2026-11-15.json';
describe.skipIf(!fs.existsSync(REAL))('the real Render layout (private-docs copy)', () => {
  it('Fix it moves the stairs so Check is clean and they still reach Staircase 2 on Floor 1', () => {
    const file = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    const layout = normaliseLayout(structuredClone(file.layout));
    const problems = checkLayout(layout, { catalog }).problems;
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.fix)).toBe(true);
    const moves = new Map(problems.flatMap((p) => p.fix.moves));
    const fixed = { ...layout, objects: Object.values(layout.objects).map((o) => (moves.has(o.id) ? { ...o, ...moves.get(o.id) } : o)) };
    expect(checkLayout(fixed, { catalog }).problems).toEqual([]);
    const stairs = fixed.objects.find((o) => o.assetType === 'STAIRCASE');
    const top = stairTop(stairs);
    const arrive = Object.values(fixed.rooms).find((r) => r.floor === 1 && rectContains(roomRect(r), top.x, top.z));
    expect(arrive?.name).toBe('Staircase 2');
    expect(floorLinks(fixed)).toHaveLength(1);
    // the file itself is not changed
    expect(JSON.parse(fs.readFileSync(REAL, 'utf8')).layout.objects.find((o) => o.assetType === 'STAIRCASE').z).toBe(-3);
  });
});
