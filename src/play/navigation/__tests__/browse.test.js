import { describe, it, expect } from 'vitest';

import { buildPlaces } from '../places';
import { browsePlaces, addRecent, recentPlaces, kindOf, RECENT_MAX, DESCRIPTION_MAX } from '../browse';
import { meridianLike } from './meridianLike';

// As the real Meridian (seed-big-company.py): 13 departments, Engineering in two rooms on Floor 1
const DEPARTMENTS = {
  room_f0_03: 'Operations', room_f0_04: 'Customer Success', room_f0_05: 'Sales', room_f0_09: 'HR', room_f0_10: 'Finance',
  room_f0_11: 'Legal', room_f0_12: 'Marketing', room_f1_02: 'Product', room_f1_03: 'Design', room_f1_04: 'Data & AI',
  room_f1_05: 'Engineering', room_f1_09: 'Engineering', room_f1_10: 'IT & Security', room_f1_11: 'Executive',
};

function meridian() {
  const layout = meridianLike();
  for (const r of layout.rooms) if (DEPARTMENTS[r.id]) r.departmentRef = DEPARTMENTS[r.id];
  const desks = layout.objects.filter((o) => o.assetType === 'DESK_STANDARD');
  const people = [{ personId: 'u_kavya', deskId: 'obj_f0_reception', name: 'Kavya Iyer', department: 'HR', email: 'kavya@meridian.example' }];
  desks.forEach((d, i) => people.push({ personId: `u_${i}`, deskId: d.id, name: `Person ${i}`, department: DEPARTMENTS[d.roomId] }));
  return { layout, people };
}

/** A small office: a reception, two offices and a washroom; no meeting room, no stairs. */
function small() {
  const room = (id, type, name, x, extra = {}) => ({
    id, type, name, floor: 0, x, z: 0, width: 6, depth: 6, wallHeight: 3, wallThickness: 0.15,
    doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [], ...extra,
  });
  return {
    rooms: [
      room('r_rec', 'RECEPTION', 'Front desk', 0),
      room('r_a', 'OFFICE', 'Studio', 6, { departmentRef: 'Design' }),
      room('r_b', 'OFFICE', '', 12),
      room('r_wc', 'RESTROOM', 'WC', 18),
      room('r_lab', 'LAB_SPACE', 'Lab', 24),
    ],
    objects: [
      { id: 'd1', assetType: 'DESK_STANDARD', floor: 0, roomId: 'r_a', x: 6, y: 0, z: 0, rotationY: 0 },
      { id: 'd2', assetType: 'DESK_STANDARD', floor: 0, roomId: 'r_b', x: 12, y: 0, z: 0, rotationY: 0 },
      { id: 'd3', assetType: 'DESK_STANDARD', floor: 0, roomId: 'r_b', x: 12, y: 0, z: 1.8, rotationY: 0 },
    ],
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
  };
}

describe('browsePlaces on the Meridian-shaped layout', () => {
  const { layout, people } = meridian();
  const index = buildPlaces(layout, people);
  const menu = browsePlaces(index, {
    me: 'u_kavya',
    departments: [{ name: 'engineering', description: '  Builds   the product. ' }, { name: 'Nobody here', description: 'Not shown' }],
  });

  it('the 13 departments that exist, by name, with rooms, floors and people', () => {
    expect(menu.departments.map((d) => d.name)).toEqual([
      'Customer Success', 'Data & AI', 'Design', 'Engineering', 'Executive', 'Finance', 'HR', 'IT & Security', 'Legal',
      'Marketing', 'Operations', 'Product', 'Sales',
    ]);
    const eng = menu.departments.find((d) => d.name === 'Engineering');
    const engineers = people.filter((p) => p.department === 'Engineering').length;
    expect(eng.detail).toBe(`2 rooms · Floor 1 · ${engineers} people`);
    expect(eng.rooms.map((r) => r.name)).toEqual(['Engineering 1', 'Engineering 2']);
    expect(eng.people).toHaveLength(engineers);
    expect(eng.place).toMatchObject({ id: 'department:Engineering', kind: 'department' }); // the whole department
    // a department of one room of its own name: the room
    expect(menu.departments.find((d) => d.name === 'Sales').place).toMatchObject({ id: 'room:room_f0_05' });
    // HR: its room + Kavya at reception
    expect(menu.departments.find((d) => d.name === 'HR').people.map((p) => p.name)).toContain('Kavya Iyer');
  });

  it('a description when the page gives one (matched by name, spaces tidied); unknown names left out', () => {
    expect(menu.departments.find((d) => d.name === 'Engineering').description).toBe('Builds the product.');
    expect(menu.departments.find((d) => d.name === 'Sales').description).toBeNull();
    expect(menu.departments.some((d) => d.name === 'Nobody here')).toBe(false);
    const long = browsePlaces(index, { departments: [{ name: 'Sales', description: 'x'.repeat(400) }] });
    expect(long.departments.find((d) => d.name === 'Sales').description).toHaveLength(DESCRIPTION_MAX);
  });

  it('places by kind, the usual ones first, each with its count and places by floor', () => {
    expect(menu.kinds.map((k) => `${k.name} ${k.count}`)).toEqual([
      'Offices 14', 'Meeting rooms 3', 'Washrooms 2', 'Reception 1', 'Stairs 2', 'Corridors 2',
    ]);
    const meeting = menu.kinds.find((k) => k.key === 'MEETING');
    expect(meeting.detail).toBe('Ground Floor, Floor 1');
    expect(meeting.floors.map((f) => `${f.floorName}: ${f.places.map((p) => p.name).join(', ')}`)).toEqual([
      'Ground Floor: Meeting Room 0.1, Meeting Room 0.2', 'Floor 1: Meeting Room 1.3',
    ]);
  });

  it('by floor: Ground Floor · 13 rooms, Floor 1 · 11 rooms, their rooms by name', () => {
    expect(menu.floors.map((f) => `${f.name} · ${f.detail}`)).toEqual(['Ground Floor · 13 rooms', 'Floor 1 · 11 rooms']);
    expect(menu.floors[0].places[0].name).toBe('Corridor');
    expect(menu.floors[0].places.every((p) => p.floor === 0)).toBe(true);
  });

  it('chips: the four facility kinds (they all exist here)', () => {
    expect(menu.chips.map((c) => `${c.label} ${c.count}`)).toEqual(['Washroom 2', 'Meeting room 3', 'Reception 1', 'Stairs 2']);
    expect(menu.chips.find((c) => c.facility === 'RECEPTION').only).toMatchObject({ id: 'room:room_f0_02' });
  });

  it('My desk: the signed-in person\'s seat; none for someone without one', () => {
    expect(menu.myDesk).toMatchObject({ id: 'person:u_kavya', deskId: 'obj_f0_reception', roomName: 'Lobby & Reception' });
    expect(browsePlaces(index, { me: 'nobody' }).myDesk).toBeNull();
    expect(browsePlaces(index).myDesk).toBeNull();
  });

  it('never an email', () => {
    expect(JSON.stringify(menu)).not.toMatch(/@meridian/);
  });
});

describe('browsePlaces on a small layout without meeting rooms', () => {
  const layout = small();
  const index = buildPlaces(layout, [
    { personId: 'p1', deskId: 'd1', name: 'Asha', department: 'Design' },
    // two departments with no room of their own: r_b is theirs half each (a tie: no department, v0.14.9)
    { personId: 'p2', deskId: 'd2', name: 'Ravi', department: 'Sales' },
    { personId: 'p3', deskId: 'd3', name: 'Meera', department: 'Marketing' },
  ]);
  const menu = browsePlaces(index);

  it('no "Meeting rooms" item or chip, no stairs', () => {
    expect(menu.kinds.map((k) => k.name)).toEqual(['Offices', 'Washrooms', 'Reception', 'Lab space']);
    expect(menu.chips.map((c) => c.label)).toEqual(['Washroom', 'Reception']);
  });

  it('departments from rooms and from people (no rooms: its people\'s floor)', () => {
    expect(menu.departments.map((d) => `${d.name}: ${d.detail}`)).toEqual([
      'Design: 1 room · Ground Floor · 1 person', 'Marketing: Ground Floor · 1 person', 'Sales: Ground Floor · 1 person',
    ]);
    expect(menu.departments.find((d) => d.name === 'Sales').place).toBeNull();
  });

  it('one floor, its five rooms (an unnamed room by its type)', () => {
    expect(menu.floors).toHaveLength(1);
    expect(menu.floors[0].places.map((p) => p.name)).toEqual(['Front desk', 'Lab', 'Office', 'Studio', 'WC']);
  });

  it('an empty layout: an empty menu', () => {
    expect(browsePlaces(buildPlaces({ rooms: {}, objects: {}, floors: {} }))).toEqual({
      chips: [], myDesk: null, departments: [], kinds: [], floors: [],
    });
  });
});

describe('kindOf', () => {
  it('rooms by type, item facilities by their kind, others none', () => {
    expect(kindOf({ id: 'room:a', roomType: 'OFFICE' })).toBe('OFFICE');
    expect(kindOf({ id: 'item:s', facility: 'STAIRS' })).toBe('STAIRCASE');
    expect(kindOf({ id: 'person:p' })).toBeNull();
    expect(kindOf({ id: 'department:x' })).toBeNull();
  });
});

describe('recent searches', () => {
  it('newest first, no repeats, at most 5', () => {
    let ids = [];
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g']) ids = addRecent(ids, id);
    expect(ids).toEqual(['g', 'f', 'e', 'd', 'a']);
    expect(ids).toHaveLength(RECENT_MAX);
    expect(addRecent('junk', 'x')).toEqual(['x']);
    expect(addRecent(['x', 3, null], 'y')).toEqual(['y', 'x']);
  });

  it('only the places that still exist', () => {
    const index = buildPlaces(small());
    expect(recentPlaces(index, ['room:r_wc', 'room:gone', 'room:r_a', 'room:r_wc']).map((p) => p.name)).toEqual(['WC', 'Studio']);
    expect(recentPlaces(index, null)).toEqual([]);
  });
});
