// A room's department from its seats (v0.14.9, private-docs/EXPERIENCE_PLAN.md 3.5): a room with no departmentRef
// takes the department of more than half of the people seated in it (a tie or no one: none; shared spaces never),
// and Find (places.js) and the tour (tour.js) use it the same way. A set departmentRef wins.
import { describe, it, expect } from 'vitest';

import { roomDepartments, buildPlaces, searchPlaces, SHARED_ROOM_TYPES } from '../places';
import { browsePlaces } from '../browse';
import { planTour } from '../tour';
import { createWalkMapCache, FREE } from '../walkMap';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const room = (id, type, name, x, extra = {}) => ({
  id, type, name, floor: 0, x, z: 0, width: 6, depth: 6, wallHeight: 3, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [], ...extra,
});
const desk = (id, roomId, x, z) => ({ id, assetType: 'DESK_STANDARD', floor: 0, roomId, x, y: 0, z, rotationY: 0 });

/**
 * A small single-floor office as Studio makes it: no room has a departmentRef. Office A: two of Sales and one of HR;
 * Office B: one of Design, one of Marketing (a tie); Office C: nobody; the front desk: someone from HR.
 */
function smallOffice() {
  return {
    rooms: [
      room('r_rec', 'RECEPTION', 'Front desk', 0),
      room('r_a', 'OFFICE', 'Office A', 6),
      room('r_b', 'OFFICE', 'Office B', 12),
      room('r_c', 'OFFICE', 'Office C', 18),
    ],
    objects: [
      { id: 'd_rec', assetType: 'RECEPTION_DESK', floor: 0, roomId: 'r_rec', x: 0, y: 0, z: 1.5, rotationY: 0 },
      desk('a1', 'r_a', 4.5, 1.8), desk('a2', 'r_a', 6, 1.8), desk('a3', 'r_a', 7.5, 1.8),
      desk('b1', 'r_b', 11, 1.8), desk('b2', 'r_b', 13, 1.8),
    ],
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
  };
}
const PEOPLE = [
  { personId: 'p_rec', deskId: 'd_rec', name: 'Kavya Iyer', department: 'HR' },
  { personId: 'p1', deskId: 'a1', name: 'Asha Patel', department: 'Sales' },
  { personId: 'p2', deskId: 'a2', name: 'Ravi Kumar', department: ' sales ' },
  { personId: 'p3', deskId: 'a3', name: 'Neha Rao', department: 'HR' },
  { personId: 'p4', deskId: 'b1', name: 'Omar Khan', department: 'Design' },
  { personId: 'p5', deskId: 'b2', name: 'Meera Shah', department: 'Marketing' },
];

describe('roomDepartments', () => {
  it('more than half of the people seated in a room: its department (spelt as the first of them)', () => {
    expect([...roomDepartments(smallOffice(), PEOPLE)]).toEqual([['r_a', 'Sales']]);
  });
  it('a tie, no majority, no one seated, nobody given: none', () => {
    const layout = smallOffice();
    expect(roomDepartments(layout, PEOPLE).has('r_b')).toBe(false); // 1 Design, 1 Marketing
    expect(roomDepartments(layout, PEOPLE).has('r_c')).toBe(false); // nobody
    // 1 Sales of 2 (the other with no department) is not more than half
    expect(roomDepartments(layout, [PEOPLE[1], { personId: 'x', deskId: 'a2', name: 'X' }]).size).toBe(0);
    expect(roomDepartments(layout, []).size).toBe(0);
    expect(roomDepartments(layout).size).toBe(0);
  });
  it('a set departmentRef wins over the seats', () => {
    const layout = smallOffice();
    layout.rooms[1].departmentRef = 'Finance';
    layout.rooms[3].departmentRef = '  Legal ';
    expect(Object.fromEntries(roomDepartments(layout, PEOPLE))).toEqual({ r_a: 'Finance', r_c: 'Legal' });
  });
  it('shared spaces (reception, washrooms, meeting rooms, stairs, corridors) never take one from their seats', () => {
    expect([...SHARED_ROOM_TYPES].sort()).toEqual(['CORRIDOR', 'MEETING', 'RECEPTION', 'RESTROOM', 'STAIRCASE']);
    expect(roomDepartments(smallOffice(), PEOPLE).has('r_rec')).toBe(false); // Kavya (HR) at the front desk
    const layout = smallOffice();
    layout.rooms[0].departmentRef = 'Front office';
    expect(roomDepartments(layout, PEOPLE).get('r_rec')).toBe('Front office'); // …but its own departmentRef counts
  });
  it('a desk counts for the room it stands in when its saved room is gone; desks not in the layout don\'t count', () => {
    const layout = smallOffice();
    layout.objects = layout.objects.map((o) => (o.id === 'a3' ? { ...o, roomId: 'room_gone' } : o));
    expect(roomDepartments(layout, [...PEOPLE, { personId: 'p9', deskId: 'nowhere', department: 'HR' }]).get('r_a')).toBe('Sales');
    // a third HR person at a desk in Office A: 2 Sales, 2 HR = a tie
    layout.objects.push(desk('a4', null, 6, -1.5));
    expect(roomDepartments(layout, [...PEOPLE, { personId: 'p8', deskId: 'a4', name: 'Liam', department: 'hr' }]).has('r_a')).toBe(false);
  });
});

describe('Find on a Studio-made office (no departmentRef)', () => {
  const index = buildPlaces(smallOffice(), PEOPLE);
  it('Office A is Sales: in its detail, and a department place "Sales"', () => {
    const a = index.byId.get('room:r_a');
    expect(a.department).toBe('Sales');
    expect(a.detail).toBe('Office · Sales · Ground Floor');
    expect(index.byId.get('department:Sales')).toEqual(expect.objectContaining({ kind: 'department', roomId: 'r_a', highlight: ['r_a'] }));
    expect(Object.values(searchPlaces(index, 'sales').groups).flat().map((p) => p.id)).toContain('department:Sales');
  });
  it('the browse menu: Sales with its room; the others from their people only', () => {
    const menu = browsePlaces(index);
    expect(menu.departments.map((d) => `${d.name}: ${d.detail}`)).toEqual([
      'Design: Ground Floor · 1 person', 'HR: Ground Floor · 2 people', 'Marketing: Ground Floor · 1 person',
      'Sales: 1 room · Ground Floor · 2 people',
    ]);
  });
});

describe('the tour of a Studio-made office (no departmentRef)', () => {
  const layout = smallOffice();
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const tour = planTour(layout, PEOPLE, [{ name: 'Sales', description: 'Sells the product.' }], { catalog: ASSET_TYPES, maps });

  it('a department stop for Sales (from its seats); the tie and the empty office are not stops', () => {
    expect(tour.stops.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'entrance:Main entrance', 'reception:Front desk', 'department:Sales', 'return:Front desk',
    ]);
    const sales = tour.stops[2];
    expect(sales.roomId).toBe('r_a');
    expect(sales.department).toBe('Sales');
    expect(sales.lines).toEqual(['Sales', 'Department · Office A · Ground Floor', 'Sells the product.', '3 people work here',
      'Asha Patel (Sales), Ravi Kumar (sales) and Neha Rao (HR)']); // mixed departments: each named, as before
    expect(tour.skipped).toEqual([]);
  });
  it('every leg walkable', () => {
    for (const s of tour.stops) {
      if (!s.leg) continue;
      expect(s.leg.problem).toBeUndefined();
      for (const part of s.leg.legs) for (const p of part.points) expect(maps.get(layout, part.floor).at(p.x, p.z)).toBe(FREE);
    }
  });
  it('with departmentRef set the seats don\'t matter (as before)', () => {
    const set = smallOffice();
    set.rooms[3].departmentRef = 'Legal';
    const t = planTour(set, PEOPLE, [], { catalog: ASSET_TYPES, maps: createWalkMapCache({ catalog: ASSET_TYPES }) });
    expect(t.stops.filter((s) => s.kind === 'department').map((s) => s.name).sort()).toEqual(['Legal', 'Sales']);
  });
});
