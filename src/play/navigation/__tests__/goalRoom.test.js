// A walk to a person never ends outside at a window (v0.14.5): the goal moves only to a free spot in the SAME
// room as the target, never across a wall; a room that can't be reached gets a reason, never a walk outside.
import { describe, expect, it } from 'vitest';
import { findNearestRoute, findRoute, roomAt } from '../route';
import { buildPlaces } from '../places';
import { createWalkMapCache } from '../walkMap';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { randomLayout } from './randomLayouts';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const room = (id, x, z, width, depth, more = {}) => ({
  id, type: 'OFFICE', name: id, floor: 0, x, z, width, depth, wallHeight: 3.2, wallThickness: 0.15, doors: [], windows: [], ...more,
});
const item = (id, assetType, x, z, more = {}) => ({ id, assetType, floor: 0, x, y: 0, z, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...more });

// Dhruv's office, x −5…5, z −4…4. The window is in the east wall. His desk stands against that wall with
// his chair between the desk and the wall, so "0.7 m behind the chair" lies outside the building.
const WINDOW = [{ wall: 'east', offset: 0, width: 2.4, height: 1.2, sill: 0.9 }];
const dhruvsOffice = (door = { wall: 'south', offset: 0, width: 1, height: 2.1 }, extra = {}) => ({
  rooms: [room('office', 0, 0, 10, 8, { name: 'Dhruv\'s office', doors: door ? [door] : [], windows: WINDOW, ...extra })],
  // the chair faces away from the wall (+X faces −X: rotationY −90°) right against it
  objects: [
    item('desk', 'DESK_STANDARD', 3.4, 0, { rotationY: Math.PI / 2 }),
    item('chair', 'CHAIR_OFFICE', 4.45, 0, { rotationY: -Math.PI / 2 }),
  ],
  floors,
});
const PEOPLE = [{ personId: 'p1', deskId: 'desk', name: 'Dhruv Khatwani', department: 'Engineering' }];
const ENTRANCE = { x: 0, z: -8, floor: 0 };

const goalsOf = (layout) => buildPlaces(layout, PEOPLE).byId.get('person:p1').goals;
const go = (layout, from = ENTRANCE) => findNearestRoute(layout, from, goalsOf(layout).map((g) => ({ ...g, name: 'Dhruv Khatwani\'s desk' })), { catalog: ASSET_TYPES });
const endOf = (r) => r.legs.at(-1).points.at(-1);

describe('a desk next to an outside wall with a window', () => {
  it('(the bug) 0.7 m behind his chair is outside the building: the place knows his room all the same', () => {
    const layout = dhruvsOffice();
    const [goal] = goalsOf(layout);
    expect(goal.roomId).toBe('office');
    expect(goal.x).toBeGreaterThan(4.8); // through the wall the window is in, or against it
  });

  it('the walk goes in through the door and ends in his room, near his desk: never outside at the window', () => {
    const layout = dhruvsOffice();
    const r = go(layout);
    expect(r.problem, r.message).toBeUndefined();
    const end = endOf(r);
    expect(roomAt(layout, 0, end.x, end.z)?.id).toBe('office');
    expect(Math.hypot(end.x - 4.45, end.z)).toBeLessThanOrEqual(4.2);
    // it does go through the door
    const pts = r.legs[0].points;
    const crossing = pts.findIndex((p, i) => i > 0 && pts[i - 1].z < -4 && p.z >= -4);
    expect(crossing).toBeGreaterThan(0);
    const a = pts[crossing - 1];
    const b = pts[crossing];
    expect(Math.abs(a.x + ((b.x - a.x) * (-4 - a.z)) / (b.z - a.z))).toBeLessThan(0.5);
  });

  it('from outside by that very window it still goes round to the door', () => {
    const layout = dhruvsOffice();
    const r = go(layout, { x: 6.5, z: 0, floor: 0 });
    expect(r.problem, r.message).toBeUndefined();
    expect(roomAt(layout, 0, endOf(r).x, endOf(r).z)?.id).toBe('office');
    expect(r.length).toBeGreaterThan(10); // round the corner, not 2 m through the wall
  });

  it('its only door is a narrow Studio door (0.7 m, Inspector): through it', () => {
    const layout = dhruvsOffice({ wall: 'south', offset: -2, width: 0.7, height: 2.1 });
    const r = go(layout);
    expect(r.problem, r.message).toBeUndefined();
    expect(roomAt(layout, 0, endOf(r).x, endOf(r).z)?.id).toBe('office');
  });

  it('his room has no door: says why, in his name, and leads nowhere', () => {
    expect(go(dhruvsOffice(null))).toEqual({
      problem: 'NO_DOOR', message: 'No walking route to Dhruv Khatwani\'s desk: Dhruv\'s office has no door',
    });
  });

  it('a cabinet fills his door: says why, never a spot outside it', () => {
    const layout = dhruvsOffice();
    layout.objects.push(item('c', 'FILING_CABINET', 0, -4, { scaleX: 3 }));
    expect(go(layout)).toEqual({
      problem: 'NO_ROUTE', message: 'No walking route to Dhruv Khatwani\'s desk: something blocks the way into Dhruv\'s office',
    });
  });

  it('in another room: a door between two rooms and none to the outside: outside is answered as closed too', () => {
    const layout = {
      rooms: [
        room('a', 0, 0, 6, 6, { name: 'Sealed A', doors: [{ wall: 'east', offset: 0, width: 1, height: 2.1 }] }),
        room('b', 6.15, 0, 6, 6, { name: 'Sealed B' }),
      ],
      objects: [],
      floors,
    };
    expect(findRoute(layout, ENTRANCE, { x: 6, z: 1, floor: 0, roomId: 'b' }, { catalog: ASSET_TYPES, name: 'B' }).problem).toBe('NO_ROUTE');
  });
});

describe('the goal never moves across a wall', () => {
  it('a spot in a sealed room next to a corridor: not the corridor, 20 cm away', () => {
    const layout = {
      rooms: [
        room('sealed', 0, 0, 6, 6, { name: 'Sealed' }),
        room('hall', 0, -4.6, 6, 3, { name: 'Hall', doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] }),
      ],
      objects: [],
      floors,
    };
    const r = findRoute(layout, ENTRANCE, { x: 0, z: -2.9, floor: 0 }, { catalog: ASSET_TYPES, name: 'Sealed room' });
    expect(r.problem).toBe('NO_DOOR');
  });

  it('a spot just inside an outside wall: not the street on the other side', () => {
    const layout = { rooms: [room('sealed', 0, 0, 6, 6, { name: 'Sealed' })], objects: [], floors };
    expect(findRoute(layout, ENTRANCE, { x: 2.9, z: 0, floor: 0 }, { catalog: ASSET_TYPES }).problem).toBe('NO_DOOR');
  });

  it('a free-standing wall in the room is a wall too: the goal stays on its side', () => {
    const wall = item('w', 'WALL_SEGMENT', 2, 0, { rotationY: Math.PI / 2, scaleX: 6 });
    const box = item('box', 'FILING_CABINET', 2.8, 0, { scaleX: 3, scaleZ: 3 });
    const layout = {
      rooms: [room('hall', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: -2, width: 1.2, height: 2.1 }] })],
      objects: [wall, box],
      floors,
    };
    const r = findRoute(layout, ENTRANCE, { x: 2.8, z: 0.05, floor: 0 }, { catalog: ASSET_TYPES });
    if (r.problem) return; // walled off: an answer, not a walk to the other side
    expect(endOf(r).x).toBeGreaterThan(2);
  });

  it('a target outside every room stays outside', () => {
    const layout = { rooms: [room('r', 0, 0, 6, 6, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] })], objects: [item('c', 'FILING_CABINET', 4, 0, { scaleX: 3, scaleZ: 3 })], floors };
    const r = findRoute(layout, ENTRANCE, { x: 4, z: 0, floor: 0 }, { catalog: ASSET_TYPES });
    expect(r.problem, r.message).toBeUndefined();
    expect(roomAt(layout, 0, endOf(r).x, endOf(r).z)).toBeNull();
  });

  it('a desk moved to another room (an old roomId in its save): its room is where it stands', () => {
    const layout = {
      rooms: [
        room('old', -6, 0, 6, 6, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] }),
        room('new', 6, 0, 6, 6, { doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] }),
      ],
      objects: [item('desk', 'DESK_STANDARD', 6, 0, { roomId: 'old' })],
      floors,
    };
    const [g] = goalsOf(layout);
    expect(g.roomId).toBe('new');
    const r = go(layout);
    expect(roomAt(layout, 0, endOf(r).x, endOf(r).z)?.id).toBe('new');
  });

  it('200 random layouts: a walk to a room or a person always ends in that very room', () => {
    let walks = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const layout = randomLayout(seed);
      const maps = createWalkMapCache({ catalog: ASSET_TYPES });
      const objects = Array.isArray(layout.objects) ? layout.objects : Object.values(layout.objects);
      const rooms = Array.isArray(layout.rooms) ? layout.rooms : Object.values(layout.rooms);
      const desks = objects.filter((o) => /^DESK/.test(o.assetType)).slice(0, 3);
      const people = desks.map((d, i) => ({ personId: `p${i}`, deskId: d.id, name: `P ${i}` }));
      const index = buildPlaces(layout, people);
      const ground = rooms.filter((r) => (r.floor ?? 0) === 0);
      if (!ground.length) continue;
      const from = { x: ground[0].x, z: ground[0].z - ground[0].depth / 2 - 8, floor: 0 };
      for (const p of index.places.filter((q) => q.kind === 'person' || q.kind === 'room')) {
        const r = findNearestRoute(layout, from, p.goals.map((g) => ({ ...g, name: p.name })), { maps });
        if (r.problem) { expect(r.message, `seed ${seed}`).toMatch(/^No walking route/); continue; }
        const g = p.goals[r.goalIndex];
        if (g.roomId == null) continue;
        const end = endOf(r);
        const inside = roomAt(layout, g.floor, end.x, end.z);
        // the innermost room at the end is the place's room (or, for a room with rooms inside, one of them is not allowed)
        expect(inside?.id, `seed ${seed}: ${p.name} ended outside its room`).toBe(g.roomId);
        walks++;
      }
    }
    expect(walks).toBeGreaterThan(200);
  });
});
