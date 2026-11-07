import { describe, it, expect } from 'vitest';

import {
  buildPlaces, searchPlaces, words, facilitiesNamed, roomDoorSpots, publicPlace, flatResults, GROUP_LIMIT,
} from '../places';
import { createWalkMapCache } from '../walkMap';
import { findRoute, findNearestRoute } from '../route';
import { entranceSpawn } from '../entrance';
import { meridianLike } from './meridianLike';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const FIRST = ['Asha', 'Arjun', 'Meera', 'Rohan', 'Neha', 'Liam', 'Olivia', 'Wei', 'Hana', 'Omar', 'Zoya', 'Kabir', 'Sofia', 'Noah', 'Yuki', 'Diya'];
const LAST = ['Patel', 'Shah', 'Kumar', 'Rao', 'Smith', 'Chen', 'Khan', 'Garcia', 'Sato', 'Nair', 'Das', 'Mehta', 'Lee', 'Brown', 'Singh', 'Gupta', 'Ali', 'Roy', 'Bose', 'Iyer'];
const DEPARTMENTS = {
  room_f0_03: 'Operations', room_f0_04: 'Customer Success', room_f0_05: 'Sales', room_f0_09: 'HR', room_f0_10: 'Finance',
  room_f0_11: 'Legal', room_f0_12: 'Marketing', room_f1_02: 'Product', room_f1_03: 'Design', room_f1_04: 'Data & AI',
  room_f1_05: 'Engineering', room_f1_09: 'Engineering', room_f1_10: 'IT & Security', room_f1_11: 'Executive',
};

/** The Meridian-shaped layout with departments, and 320 people at its desks (Kavya Iyer at reception). */
function meridianWithPeople() {
  const layout = meridianLike();
  for (const r of layout.rooms) if (DEPARTMENTS[r.id]) r.departmentRef = DEPARTMENTS[r.id];
  const desks = layout.objects.filter((o) => o.assetType === 'DESK_STANDARD');
  const people = [{ personId: 'u_kavya', deskId: 'obj_f0_reception', name: 'Kavya Iyer', department: 'HR', email: 'kavya.iyer@meridian.example' }];
  for (let i = 0; people.length < 320 && i < desks.length; i++) {
    const desk = desks[i];
    people.push({
      personId: `u_${i}`, deskId: desk.id, name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
      department: DEPARTMENTS[desk.roomId], email: `person${i}@meridian.example`, phone: '+91 00000',
    });
  }
  return { layout, people };
}

const names = (list) => list.map((p) => p.name);

describe('words', () => {
  it('lower case, no accents, letters and digits only', () => {
    expect(words('Data & AI')).toEqual(['data', 'ai']);
    expect(words('  Zoë  O’Brien-Smith ')).toEqual(['zoe', 'o', 'brien', 'smith']);
    expect(words('Meeting Room 0.1')).toEqual(['meeting', 'room', '0', '1']);
    expect(words(null)).toEqual([]);
  });
});

describe('facilitiesNamed', () => {
  it('washroom, restroom, toilet, WC all find washrooms; meeting, reception, stairs their own', () => {
    for (const q of ['washroom', 'Restroom', 'toilets', 'WC', 'bathroom', 'wash']) expect(facilitiesNamed(q)).toEqual(['RESTROOM']);
    expect(facilitiesNamed('meeting')).toEqual(['MEETING']);
    expect(facilitiesNamed('conference')).toEqual(['MEETING']);
    expect(facilitiesNamed('reception')).toEqual(['RECEPTION']);
    expect(facilitiesNamed('stairs')).toEqual(['STAIRS']);
    expect(facilitiesNamed('staircase')).toEqual(['STAIRS']);
  });

  it('not every word: "room", "meeting room 0.1", one letter, a name', () => {
    expect(facilitiesNamed('room')).toEqual([]);
    expect(facilitiesNamed('meeting room 0.1')).toEqual([]);
    expect(facilitiesNamed('w')).toEqual([]);
    expect(facilitiesNamed('Kavya')).toEqual([]);
    expect(facilitiesNamed('')).toEqual([]);
  });
});

describe('roomDoorSpots', () => {
  it('just inside each door, else the middle', () => {
    const room = { x: 10, z: 0, width: 8, depth: 6, wallThickness: 0.2, doors: [{ wall: 'south', offset: 1, width: 1 }, { wall: 'east', offset: -2, width: 1 }] };
    const [a, b] = roomDoorSpots(room);
    expect(a.x).toBeCloseTo(11);
    expect(a.z).toBeCloseTo(-3 + 0.1 + 0.6);
    expect(b.x).toBeCloseTo(14 - 0.1 - 0.6);
    expect(b.z).toBeCloseTo(-2);
    expect(roomDoorSpots({ x: 1, z: 2, width: 3, depth: 3 })).toEqual([{ x: 1, z: 2 }]);
  });
});

describe('buildPlaces on the Meridian-shaped layout', () => {
  const { layout, people } = meridianWithPeople();
  const index = buildPlaces(layout, people);
  const kinds = (k) => index.places.filter((p) => p.kind === k);

  it('rooms, departments, facilities and 320 people', () => {
    expect(kinds('person')).toHaveLength(320);
    expect(names(kinds('department'))).toEqual(['Engineering']); // one room each for the others, of the same name
    const facilities = kinds('facility');
    expect(facilities.filter((p) => p.facility === 'RESTROOM')).toHaveLength(2);
    expect(facilities.filter((p) => p.facility === 'MEETING')).toHaveLength(3);
    expect(facilities.filter((p) => p.facility === 'STAIRS')).toHaveLength(2); // the stair rooms; their staircase is in them
    // the reception desk stands in the reception room: the room is the facility
    expect(facilities.filter((p) => p.facility === 'RECEPTION').map((p) => p.id)).toEqual(['room:room_f0_02']);
    expect(kinds('room').length + facilities.length).toBe(layout.rooms.length);
  });

  it('people: name and department only, never an email or anything else', () => {
    const kavya = index.byId.get('person:u_kavya');
    expect(kavya).toMatchObject({
      name: 'Kavya Iyer', department: 'HR', floor: 0, floorName: 'Ground Floor', roomName: 'Lobby & Reception',
      detail: 'HR · Ground Floor, Lobby & Reception', deskId: 'obj_f0_reception', entityId: 'obj_f0_reception',
    });
    const text = JSON.stringify(index.places);
    expect(text).not.toContain('@');
    expect(text).not.toContain('meridian.example');
    expect(text).not.toContain('+91');
    expect(searchPlaces(index, 'meridian').total).toBe(0);
    expect(searchPlaces(index, 'person0').total).toBe(0);
  });

  it('a person whose desk is not in the layout is not a place', () => {
    const i = buildPlaces(layout, [{ personId: 'x', deskId: 'obj_gone', name: 'Gone Away' }, { personId: 'y', name: 'No Desk' }]);
    expect(i.places.filter((p) => p.kind === 'person')).toEqual([]);
  });

  it('a person sits on their chair; the walk to them ends behind it, in the aisle', () => {
    const p = index.byId.get('person:u_0');
    const desk = layout.objects.find((o) => o.id === p.deskId);
    expect(p.highlight).toEqual([desk.id, `${desk.id}_chair`]);
    expect(p.x).toBeCloseTo(desk.x);
    expect(p.z).toBeCloseTo(desk.z + 0.7);
    expect(p.goals[0].z).toBeCloseTo(desk.z + 1.4);
  });

  it('a staircase not in a stair room is a facility, its goal in front of the bottom step', () => {
    const l = meridianLike();
    l.rooms = l.rooms.filter((r) => r.type !== 'STAIRCASE');
    const stairs = buildPlaces(l).places.filter((p) => p.facility === 'STAIRS');
    expect(stairs).toHaveLength(1);
    expect(stairs[0]).toMatchObject({ id: 'item:obj_f0_stairs', name: 'Staircase', detail: 'Stairs · Ground Floor to Floor 1' });
    expect(stairs[0].goals[0].z).toBeLessThan(5.15 - 2); // the flight is 4 m, climbing +Z
  });

  it('every goal can be walked to from the entrance (rooms, departments, facilities, every 10th person)', () => {
    const maps = createWalkMapCache({ catalog: ASSET_TYPES });
    const spawn = entranceSpawn(layout, { catalog: ASSET_TYPES, maps });
    const problems = [];
    const corridorsHaveNoDoor = (p) => p.roomId?.endsWith('_01');
    for (const p of index.places.filter((q, n) => q.kind !== 'person' || n % 10 === 0)) {
      if (corridorsHaveNoDoor(p)) continue;
      const r = findNearestRoute(layout, spawn, p.goals, { maps });
      if (r.problem) problems.push(`${p.id}: ${r.message}`);
    }
    expect(problems).toEqual([]);
    // Kavya (reception, no chair: standing behind the counter): the walk ends right there
    const kavya = index.byId.get('person:u_kavya').goals[0];
    const end = findRoute(layout, spawn, kavya, { maps }).to;
    expect(Math.hypot(end.x - kavya.x, end.z - kavya.z)).toBeLessThan(0.5);
  });
});

describe('searchPlaces', () => {
  const { layout, people } = meridianWithPeople();
  const index = buildPlaces(layout, people);

  it('"Kavya": Kavya Iyer first, with her floor and room', () => {
    const r = searchPlaces(index, 'Kavya');
    expect(r.groups.people[0]).toMatchObject({ name: 'Kavya Iyer', detail: 'HR · Ground Floor, Lobby & Reception' });
    expect(searchPlaces(index, 'kav').groups.people[0].name).toBe('Kavya Iyer');
    expect(searchPlaces(index, 'iyer kav').groups.people[0].name).toBe('Kavya Iyer');
    expect(searchPlaces(index, 'KAVYA IYER').groups.people[0].name).toBe('Kavya Iyer');
  });

  it('"Engineering": the department and its rooms, then its people (6 shown, the rest counted)', () => {
    const r = searchPlaces(index, 'Engineering');
    expect(names(r.groups.rooms)).toEqual(['Engineering', 'Engineering 1', 'Engineering 2']);
    expect(r.groups.rooms[0]).toMatchObject({ kind: 'department', detail: 'Department · 2 rooms · Floor 1', highlight: ['room_f1_05', 'room_f1_09'] });
    expect(r.groups.people).toHaveLength(GROUP_LIMIT);
    const engineers = people.filter((p) => p.department === 'Engineering').length;
    expect(r.more.people).toBe(engineers - GROUP_LIMIT);
    expect(r.groups.people.every((p) => p.department === 'Engineering')).toBe(true);
    expect(r.total).toBe(3 + engineers);
  });

  it('"washroom" (and restroom, toilet, WC): every washroom, the floor shown first', () => {
    for (const q of ['washroom', 'restroom', 'toilet', 'WC']) {
      const r = searchPlaces(index, q, { from: { floor: 1 } });
      expect(r.groups.facilities.map((p) => `${p.name} · ${p.floorName}`)).toEqual(['Restrooms · Floor 1', 'Restrooms · Ground Floor']);
      expect(r.groups.people).toEqual([]);
    }
  });

  it('"meeting": the meeting rooms (facilities), nearest first', () => {
    const r = searchPlaces(index, 'meeting', { from: { x: 26, z: 8, floor: 0 } });
    expect(r.groups.facilities[0]).toMatchObject({ kind: 'nearest', name: 'Nearest meeting room' });
    expect(names(r.groups.facilities.slice(1))).toEqual(['Meeting Room 0.2', 'Meeting Room 0.1', 'Meeting Room 1.3']);
    expect(r.groups.rooms).toEqual([]);
    expect(names(searchPlaces(index, 'meeting room 1.3').groups.facilities)).toEqual(['Meeting Room 1.3']);
  });

  it('walking: "Nearest washroom" first; findNearestRoute takes the nearer one by walking', () => {
    const maps = createWalkMapCache({ catalog: ASSET_TYPES });
    const from = { x: -20, z: 0, floor: 1 }; // the corridor upstairs
    const r = searchPlaces(index, 'washroom', { from });
    const nearest = r.groups.facilities[0];
    expect(nearest).toMatchObject({ kind: 'nearest', name: 'Nearest washroom', places: ['room:room_f0_07', 'room:room_f1_07'] });
    const route = findNearestRoute(layout, from, nearest.goals, { maps });
    expect(route.problem).toBeUndefined();
    expect(nearest.goals[route.goalIndex].placeId).toBe('room:room_f1_07');
    expect(route.legs.map((l) => l.floor)).toEqual([1]);
  });

  it('every word must match; nothing found is empty', () => {
    expect(searchPlaces(index, 'Kavya Engineering').total).toBe(0);
    expect(searchPlaces(index, 'zzzz').total).toBe(0);
    expect(searchPlaces(index, '   ').total).toBe(0);
    expect(names(searchPlaces(index, 'data').groups.rooms)).toEqual(['Data & AI']);
  });

  it('a name word beats a department word; whole names first', () => {
    const r = searchPlaces(index, 'sales');
    expect(r.groups.rooms[0].name).toBe('Sales');
    const lee = searchPlaces(index, 'lee');
    expect(lee.groups.people.every((p) => /\blee\b/i.test(p.name))).toBe(true);
  });

  it('fast: one keystroke under 50 ms with 320 people (a few ms in practice)', () => {
    const queries = ['K', 'Ka', 'Kav', 'Kavy', 'Kavya', 'E', 'Engineering', 'washroom', 'meeting', 'a'];
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) for (const q of queries) searchPlaces(index, q, { from: { x: 0, z: 0, floor: 0 } });
    const each = (performance.now() - t0) / (10 * queries.length);
    expect(each).toBeLessThan(50);
    const b0 = performance.now();
    buildPlaces(layout, people);
    expect(performance.now() - b0).toBeLessThan(500);
  });

  it('publicPlace: the same fields for every kind, nothing internal', () => {
    const all = flatResults(searchPlaces(index, 'washroom', { from: { x: 0, z: 0, floor: 0 } }));
    for (const p of all.map(publicPlace)) {
      expect(p).not.toHaveProperty('words');
      expect(p).not.toHaveProperty('goals');
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['id', 'kind', 'group', 'name', 'detail', 'floorId', 'floorName', 'roomId', 'entityId']));
    }
    expect(publicPlace(index.byId.get('person:u_kavya'))).toEqual({
      id: 'person:u_kavya', kind: 'person', group: 'people', name: 'Kavya Iyer', detail: 'HR · Ground Floor, Lobby & Reception',
      floorId: 0, floorName: 'Ground Floor', roomId: 'room_f0_02', roomName: 'Lobby & Reception', department: 'HR',
      facility: null, personId: 'u_kavya', deskId: 'obj_f0_reception', entityId: 'obj_f0_reception',
    });
  });
});
