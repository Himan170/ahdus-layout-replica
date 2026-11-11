// "Check my layout" (v0.15.3): what Studio tells the person building. One test (at least) per kind of
// problem, the rules that keep the list quiet, the keys "Ignore" relies on, and how long it takes.
import { describe, expect, it } from 'vitest';
import {
  checkLayout, checkSummary, toggleIgnored, liveIgnored, countText, rectsOverlap, CHECK_KINDS,
} from '../checkLayout';
import { meridianLike } from './meridianLike';
import { createWalkMapCache } from '../walkMap';
import { wallSegmentData } from '../../geometry';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { LAYOUT_TEMPLATES } from '../../../templates';
import { normaliseLayout } from '../../../store/layoutData';

const floors1 = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const floors2 = { ...floors1, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const door = (wall, offset = 0, width = 1) => ({ wall, offset, width, height: 2.1 });
const room = (id, name, x, z, width, depth, more = {}) => ({
  id, name, type: 'OFFICE', floor: 0, x, z, width, depth, wallHeight: 3.2, wallThickness: 0.15, doors: [], windows: [], ...more,
});
let n = 0;
const item = (assetType, x, z, more = {}) => ({
  id: more.id ?? `obj_${++n}`, assetType, floor: 0, x, y: 0.02, z, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...more,
});

/**
 * An Office (6 × 5 m, a door to the outside in its south wall) with a Meeting room back to back on its
 * east side; one door between them, stored on both rooms (as planOpening does).
 */
function twoRooms({ outside = true, between = true } = {}) {
  const office = room('office', 'Office', 0, 0, 6, 5, {
    doors: [...(outside ? [door('south')] : []), ...(between ? [door('east')] : [])],
  });
  const meeting = room('meeting', 'Meeting', 5.65, 0, 5, 5, { type: 'MEETING', doors: between ? [door('west')] : [] });
  return { rooms: [office, meeting], objects: [], floors: floors1 };
}

/** A Hall (6 × 8 m, a door outside) with the same room above it, and room for a staircase (1.2 × 4 m). */
function twoFloors({ meetingUp = false } = {}) {
  const rooms = [
    room('hall', 'Hall', 0, 0, 6, 8, { doors: [door('south')] }),
    room('up', 'Upper Hall', 0, 0, 6, 8, { floor: 1, doors: meetingUp ? [door('east')] : [] }),
  ];
  if (meetingUp) rooms.push(room('up2', 'Upper Meeting', 5.65, 0, 5, 5, { floor: 1, type: 'MEETING', doors: [door('west')] }));
  return { rooms, objects: [], floors: floors2 };
}

const check = (layout) => checkLayout(layout, { catalog: ASSET_TYPES }).problems;
const kinds = (layout) => check(layout).map((p) => p.kind);
const of = (layout, kind) => check(layout).filter((p) => p.kind === kind);

describe('a layout that works has no problems', () => {
  it('two rooms, a door outside and a door between them, a desk with its chair and a monitor', () => {
    const layout = twoRooms();
    const desk = item('DESK_STANDARD', -1, 1);
    layout.objects.push(desk, item('CHAIR_OFFICE', -1, 1.6, { rotationY: Math.PI }),
      item('MONITOR_DUAL', -1, 1, { y: 0.02 + ASSET_TYPES.DESK_STANDARD.defaultHeight }),
      item('RUG', 1, -1), item('SPAWN_POINT', 0, -6));
    expect(check(layout)).toEqual([]);
  });

  it('no rooms at all: nothing to say', () => {
    expect(checkLayout({ rooms: [], objects: [item('DESK_STANDARD', 0, 0)], floors: floors1 }).problems).toEqual([]);
    expect(checkLayout({}).problems).toEqual([]);
    expect(checkLayout(null).problems).toEqual([]);
  });

  it('the three templates are clean (no false alarms on layouts made with care)', () => {
    for (const t of LAYOUT_TEMPLATES) {
      const layout = normaliseLayout(t.layout);
      expect(Object.keys(layout.rooms).length, t.name).toBeGreaterThan(3);
      const found = check(layout).filter((p) => p.severity !== 'info');
      expect(found.map((p) => p.message), t.name).toEqual([]);
    }
  });

  it('the Meridian-shaped layout (24 rooms, ~640 items, 2 floors) is clean', () => {
    expect(check(meridianLike()).filter((p) => p.severity !== 'info')).toEqual([]);
  });
});

describe('rooms and doors', () => {
  it('a room with no door: "Meeting has no door" (once: not also "nobody can walk to it")', () => {
    const found = check(twoRooms({ between: false }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      key: 'ROOM_NO_DOOR:meeting', kind: CHECK_KINDS.ROOM_NO_DOOR, severity: 'error', message: 'Meeting has no door',
      ids: ['meeting'], floorId: 0, roomId: 'meeting',
    });
  });

  it('the desks in a room with no door are not listed one by one', () => {
    const layout = twoRooms({ between: false });
    layout.objects.push(item('DESK_STANDARD', 5.65, 0), item('DESK_STANDARD', 5.65, 1.5));
    expect(kinds(layout)).toEqual([CHECK_KINDS.ROOM_NO_DOOR]);
  });

  it('no door to the outside: "No door leads outside", and nothing else about walking', () => {
    const layout = twoRooms({ outside: false });
    layout.objects.push(item('DESK_STANDARD', -1, 1));
    const found = check(layout);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: CHECK_KINDS.NO_ENTRANCE, severity: 'error', message: 'No door leads outside: nobody can walk in', floorId: 0 });
  });

  it('a room whose only door is shut off by furniture: nobody can walk to it', () => {
    const layout = twoRooms();
    // a row of lockers right across the doorway, on the office's side
    layout.objects.push(item('LOCKER_BANK', 2.7, 0, { rotationY: Math.PI / 2, scaleX: 2 }));
    const found = check(layout);
    expect(found.find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE)).toMatchObject({
      key: 'ROOM_UNREACHABLE:meeting', severity: 'error', message: 'Nobody can walk to Meeting: something blocks the way', roomId: 'meeting',
    });
    expect(found.some((p) => p.kind === CHECK_KINDS.DOOR_BLOCKED)).toBe(true);
    expect(found.some((p) => p.kind === CHECK_KINDS.ROOM_NO_DOOR)).toBe(false);
  });

  it('a room inside a room with no door of its own', () => {
    const layout = twoRooms();
    layout.rooms.push(room('cabin', 'Cabin', -1.5, 1, 2, 2));
    expect(of(layout, CHECK_KINDS.ROOM_NO_DOOR).map((p) => p.message)).toEqual(['Cabin has no door']);
  });
});

describe('desks', () => {
  /** A desk in the office's north-west corner, walled off by two walls drawn with the Wall tool. */
  function fenced(gap = false) {
    const layout = twoRooms();
    const desk = item('DESK_STANDARD', -2.0, 1.9, { id: 'desk' });
    const wall = (a, b, id) => item('WALL_SEGMENT', 0, 0, { ...wallSegmentData(a, b, layout.rooms).data, id, floor: 0 });
    layout.objects.push(desk,
      wall({ x: -3, z: 0.4 }, { x: gap ? -1.4 : -0.3, z: 0.4 }, 'w1'),
      wall({ x: -0.3, z: 0.4 }, { x: -0.3, z: 2.5 }, 'w2'));
    return layout;
  }

  it('a desk nobody can walk to: "Nobody can walk to Standard Desk in Office"', () => {
    const found = of(fenced(), CHECK_KINDS.DESK_UNREACHABLE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      key: 'DESK_UNREACHABLE:desk', severity: 'error', message: 'Nobody can walk to Standard Desk in Office', objectId: 'desk', floorId: 0,
    });
  });

  it('with a gap in the fence it can be reached: no problem', () => {
    expect(of(fenced(true), CHECK_KINDS.DESK_UNREACHABLE)).toEqual([]);
  });

  it('a desk against the wall with its chair behind it is fine (you reach it from the side)', () => {
    const layout = twoRooms();
    layout.objects.push(item('DESK_STANDARD', -2.1, 1.6), item('CHAIR_OFFICE', -2.1, 2.15, { rotationY: Math.PI }));
    expect(of(layout, CHECK_KINDS.DESK_UNREACHABLE)).toEqual([]);
  });

  it('it uses the desk\'s own name when it has one', () => {
    const layout = fenced();
    layout.objects[0].label = 'SAL-0001';
    expect(of(layout, CHECK_KINDS.DESK_UNREACHABLE)[0].message).toBe('Nobody can walk to SAL-0001 in Office');
  });
});

describe('furniture', () => {
  it('two items in each other: "Cupboard overlaps Bookshelf" (once for the pair)', () => {
    const layout = twoRooms();
    layout.objects.push(item('BOOKCASE_CLOSED', 1, 1, { id: 'a' }), item('BOOKSHELF', 1.3, 1.1, { id: 'b' }));
    const found = of(layout, CHECK_KINDS.ITEMS_OVERLAP);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'ITEMS_OVERLAP:a|b', severity: 'warning', message: 'Cupboard overlaps Bookshelf', ids: ['a', 'b'], objectId: 'a' });
  });

  it('not an overlap: side by side, a chair under a table, a monitor on a desk, a plant on a rug, a shelf above', () => {
    const layout = twoRooms();
    layout.objects.push(
      item('BOOKCASE_CLOSED', 1, 1), item('BOOKCASE_CLOSED', 1.8, 1), // touching, side by side
      item('TABLE_MEETING', 5.65, 0), item('CHAIR_OFFICE', 5.65, 0.5, { rotationY: Math.PI }), item('CHAIR_OFFICE', 5.0, -0.4),
      item('DESK_STANDARD', -1.5, -1), item('LAPTOP', -1.5, -1, { y: 0.02 + ASSET_TYPES.DESK_STANDARD.defaultHeight }),
      item('RUG', 1, -1), item('PLANT_LARGE', 1, -1),
      item('SIDE_TABLE', -2.4, 0.5), item('MICROWAVE', -2.4, 0.5, { y: 2.2 }),
    );
    expect(of(layout, CHECK_KINDS.ITEMS_OVERLAP)).toEqual([]);
  });

  it('a monitor on an L-shaped desk, put down a little under the desk height of the catalogue, stands ON it (a real layout)', () => {
    const layout = twoRooms();
    const top = ASSET_TYPES.DESK_CORNER.defaultHeight;
    layout.objects.push(item('DESK_CORNER', 0, 0.5), item('MONITOR_DUAL', -0.4, 0.1, { y: 0.02 + top - 0.06 }));
    expect(of(layout, CHECK_KINDS.ITEMS_OVERLAP)).toEqual([]);
    // sunk half way into it, it is in it
    layout.objects[1].y = top / 2;
    expect(of(layout, CHECK_KINDS.ITEMS_OVERLAP)).toHaveLength(1);
  });

  it('an item in a wall: "3-Seat Sofa stands in a wall of Office"; a whiteboard on the wall is fine', () => {
    const layout = twoRooms();
    layout.objects.push(item('SOFA_3SEAT', -1, 2.5, { id: 'sofa' }), item('WHITEBOARD', 1.5, 2.4), item('BOOKSHELF', 1.5, -2.2));
    const found = of(layout, CHECK_KINDS.ITEM_IN_WALL);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'ITEM_IN_WALL:sofa', severity: 'warning', message: '3-Seat Sofa stands in a wall of Office', objectId: 'sofa' });
  });

  it('an item in a wall drawn with the Wall tool: "… stands in a wall"', () => {
    const layout = twoRooms();
    layout.objects.push(item('WALL_SEGMENT', 0, 0, { ...wallSegmentData({ x: -1, z: 0 }, { x: 1, z: 0 }, layout.rooms).data, id: 'w' }),
      item('PLANT_LARGE', 0, 0.1, { id: 'plant' }));
    expect(of(layout, CHECK_KINDS.ITEM_IN_WALL).map((p) => p.message)).toEqual(['Large Plant stands in a wall']);
  });

  it('upstairs, an item outside every room floats: listed. On the ground floor, and markers: not', () => {
    const layout = twoFloors();
    layout.objects.push(
      item('STAIRCASE', -1.5, 0, { id: 'stairs' }),
      item('PLANT_LARGE', 12, 12, { id: 'floating', floor: 1 }), item('ZONE_MARKER', 14, 12, { floor: 1 }),
      item('PLANT_LARGE', 0, -6, { id: 'garden' }), item('PLANT_LARGE', 1.5, 1, { floor: 1 }),
    );
    const found = of(layout, CHECK_KINDS.ITEM_OUTSIDE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'ITEM_OUTSIDE:floating', severity: 'warning', message: 'Large Plant on Floor 1 is outside every room', floorId: 1, objectId: 'floating' });
  });
});

describe('doors and windows with furniture in front', () => {
  it('a cupboard in front of a door: "Cupboard blocks a door of Office" (a door between two rooms: once)', () => {
    const layout = twoRooms();
    layout.objects.push(item('BOOKCASE_CLOSED', 0.35, -2.1, { id: 'c1' }), item('PLANT_LARGE', 3.5, 0.3, { id: 'p1' }));
    const found = of(layout, CHECK_KINDS.DOOR_BLOCKED);
    expect(found.map((p) => [p.message, p.severity, p.objectId])).toEqual([
      ['Cupboard blocks a door of Office', 'warning', 'c1'],
      ['Large Plant blocks a door of Office', 'warning', 'p1'],
    ]);
  });

  it('furniture a step away from the door is fine', () => {
    const layout = twoRooms();
    layout.objects.push(item('BOOKCASE_CLOSED', 1.6, -2.1), item('BOOKCASE_CLOSED', 0, -1.4));
    expect(of(layout, CHECK_KINDS.DOOR_BLOCKED)).toEqual([]);
  });

  it('a bookshelf in front of a window is a note (not counted); a coffee table under it is not', () => {
    const layout = twoRooms();
    layout.rooms[0].windows = [{ wall: 'north', offset: 0, width: 3.4, height: 1.2, sill: 0.9 }];
    layout.objects.push(item('BOOKSHELF', -0.9, 2.2, { id: 'shelf' }), item('TABLE_COFFEE', 0.8, 2.1));
    const found = of(layout, CHECK_KINDS.WINDOW_BLOCKED);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'info', message: 'Bookshelf stands in front of a window of Office', objectId: 'shelf' });
    expect(checkSummary(check(layout), [], floors1).count).toBe(0);
  });
});

describe('stairs and floors', () => {
  it('stairs that lead nowhere: building.stairProblems\' own words, as an error', () => {
    const layout = twoFloors();
    layout.floors = floors1;
    layout.rooms = layout.rooms.filter((r) => r.floor === 0);
    layout.objects.push(item('STAIRCASE', -1.5, 0, { id: 's' }));
    const found = of(layout, CHECK_KINDS.STAIRS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'STAIRS_NOWHERE:s', severity: 'error', code: 'NOWHERE', objectId: 's', floorId: 0 });
    expect(found[0].message).toMatch(/^These stairs lead nowhere: there is no floor above/);
  });

  it('stairs that stick out of their room: a warning with the Inspector\'s text', () => {
    const layout = twoFloors();
    layout.objects.push(item('STAIRCASE', 2.6, 0, { id: 's' }));
    expect(of(layout, CHECK_KINDS.STAIRS).map((p) => [p.code, p.severity, p.message])).toEqual([
      ['STICKS_OUT', 'warning', "These stairs don't fit Hall: they stick out of it"],
    ]);
  });

  it('an upper floor no stairs lead to: one line for the floor, not one per room', () => {
    const layout = twoRooms();
    layout.floors = floors2;
    layout.rooms.push(room('up1', 'Upper Office', 0, 0, 6, 5, { floor: 1, doors: [door('east')] }),
      room('up2', 'Upper Meeting', 5.65, 0, 5, 5, { floor: 1, doors: [door('west')] }));
    layout.objects.push(item('DESK_STANDARD', 0, 0, { floor: 1 }));
    const found = check(layout).filter((p) => p.floorId === 1);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: CHECK_KINDS.FLOOR_UNREACHABLE, severity: 'error', message: 'Nobody can walk to Floor 1: no stairs lead there', floorId: 1 });
  });

  it('with stairs, the rooms upstairs are reached through them', () => {
    const layout = twoFloors({ meetingUp: true });
    layout.objects.push(item('STAIRCASE', -1.5, 0, { id: 's' }), item('DESK_STANDARD', 6.5, 1, { floor: 1 }));
    expect(check(layout)).toEqual([]);
    // take the stairs away: the floor is cut off again
    layout.objects.shift();
    expect(kinds(layout)).toEqual([CHECK_KINDS.FLOOR_UNREACHABLE]);
  });
});

describe('keys, the panel\'s list and Ignore', () => {
  const layout = () => {
    const l = twoRooms({ between: false });
    l.floors = floors2;
    l.rooms.push(room('up', 'Upper Office', 0, 0, 6, 5, { floor: 1, doors: [door('south')] }));
    l.objects.push(item('BOOKCASE_CLOSED', 1, 1, { id: 'a' }), item('BOOKSHELF', 1.3, 1.1, { id: 'b' }));
    return l;
  };

  it('a key stays the same when the things it is about move, and when other things change', () => {
    const one = check(layout()).map((p) => p.key).sort();
    const moved = layout();
    moved.objects[0].x = 1.1;
    moved.rooms[1].name = 'Board room';
    moved.objects.push(item('PLANT_LARGE', -2, -1));
    expect(check(moved).map((p) => p.key).sort()).toEqual(one);
    expect(new Set(one).size).toBe(one.length);
  });

  it('the summary: grouped by floor in floor order, the worst first; ignored ones apart and not counted', () => {
    const problems = check(layout());
    const all = checkSummary(problems, [], floors2);
    expect(all.groups.map((g) => [g.floorId, g.name])).toEqual([[0, 'Ground Floor'], [1, 'Floor 1']]);
    expect(all.groups[0].problems.map((p) => p.severity)).toEqual(['error', 'warning']);
    expect(all.count).toBe(3);
    const some = checkSummary(problems, ['ITEMS_OVERLAP:a|b', 'GONE:x'], floors2);
    expect(some.count).toBe(2);
    expect(some.ignored.map((p) => p.key)).toEqual(['ITEMS_OVERLAP:a|b']);
    expect(some.groups[0].problems.map((p) => p.kind)).toEqual([CHECK_KINDS.ROOM_NO_DOOR]);
    expect(some.total).toBe(3);
  });

  it('Ignore / Show again: no key twice; keys of problems that are gone are dropped', () => {
    expect(toggleIgnored(['x'], 'y', true)).toEqual(['x', 'y']);
    expect(toggleIgnored(['x', 'y'], 'y', true)).toEqual(['x', 'y']);
    expect(toggleIgnored(['x', 'y'], 'x', false)).toEqual(['y']);
    expect(toggleIgnored(undefined, 'x', true)).toEqual(['x']);
    expect(liveIgnored(['ITEMS_OVERLAP:a|b', 'GONE:x'], check(layout()))).toEqual(['ITEMS_OVERLAP:a|b']);
  });

  it('the badge\'s words', () => {
    expect([countText(0), countText(1), countText(12)]).toEqual(['No problems', '1 problem', '12 problems']);
  });
});

describe('rectsOverlap', () => {
  const r = (x, z, hw, hd, rot = 0) => ({ x, z, hw, hd, rot });
  it('touching is not overlapping; a tolerance lets things be pushed together', () => {
    expect(rectsOverlap(r(0, 0, 1, 1), r(2, 0, 1, 1))).toBe(false);
    expect(rectsOverlap(r(0, 0, 1, 1), r(1.9, 0, 1, 1))).toBe(true);
    expect(rectsOverlap(r(0, 0, 1, 1), r(1.9, 0, 1, 1), 0.12)).toBe(false);
  });
  it('turned rectangles: a diamond beside a square misses it where their boxes cross', () => {
    expect(rectsOverlap(r(0, 0, 1, 1), r(2.3, 0, 1, 1, Math.PI / 4))).toBe(true);
    expect(rectsOverlap(r(0, 0, 1, 1), r(2.2, 2.2, 1, 1, Math.PI / 4))).toBe(false);
  });
});

describe('speed', () => {
  it('the Meridian-shaped layout: well under a second cold, faster with its walk maps ready', () => {
    const layout = meridianLike();
    const cold = checkLayout(layout, { catalog: ASSET_TYPES });
    const maps = createWalkMapCache({ catalog: ASSET_TYPES });
    checkLayout(layout, { catalog: ASSET_TYPES, maps });
    const warm = checkLayout(layout, { catalog: ASSET_TYPES, maps });
    // (a loose limit: CI runners are slow and uneven; on a laptop it is about 60 ms cold, 25 ms warm)
    expect(cold.ms).toBeLessThan(2000);
    expect(warm.ms).toBeLessThan(cold.ms + 50);
    expect(warm.problems.map((p) => p.key)).toEqual(cold.problems.map((p) => p.key));
  });
});

describe('the Small Office template with a door removed', () => {
  it('says which room has no door, and nothing once the door is back', () => {
    const layout = normaliseLayout(LAYOUT_TEMPLATES.find((t) => t.id === 'small-office').layout);
    const meeting = Object.values(layout.rooms).find((r) => r.type === 'MEETING');
    const doors = meeting.doors;
    meeting.doors = [];
    const found = check(layout).filter((p) => p.severity === 'error');
    expect(found.map((p) => p.message)).toEqual([`${meeting.name} has no door`]);
    expect(found[0].roomId).toBe(meeting.id);
    meeting.doors = doors;
    expect(check(layout).filter((p) => p.severity === 'error')).toEqual([]);
  });
});
