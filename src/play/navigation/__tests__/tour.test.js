// The tour's plan (tour.js, v0.14.3): private-docs/EXPERIENCE_PLAN.md 3.5 + section 5 (every department once,
// ground floor first, no stop unreachable, mentions within 4 m, order shorter than the naive one), the viewer's
// sample, random layouts and the speed.
import { describe, it, expect } from 'vitest';

import {
  planTour, nearestNeighbour, twoOpt, insertBest, sideOf, sampleLine, coarseOf, coarseField, coarseCost,
  MENTION_DISTANCE, STOP_PAUSE, FACILITY_PAUSE, NAMES_MAX, tourSummary, notRightAfter,
} from '../tour';
import { findRoute } from '../route';
import { createWalkMapCache, FREE } from '../walkMap';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { SAMPLE_LAYOUT, SAMPLE_PEOPLE } from '../../../viewer/sampleLayout';
import { meridianWithPeople, MERIDIAN_DEPARTMENTS } from './meridianLike';
import { randomLayout, random } from './randomLayouts';

const plan = (layout, people = [], departments = [], options = {}) => planTour(layout, people, departments, { catalog: ASSET_TYPES, ...options });

/** Every point of a leg, every 5 cm, with its floor. */
function* legSamples(leg) {
  for (const part of leg.legs) {
    for (let n = 1; n < part.points.length; n++) {
      const a = part.points[n - 1];
      const b = part.points[n];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
      for (let s = 0; s <= steps; s++) yield { floor: part.floor, x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps };
    }
  }
}

/** Every leg is walkable: each point on a FREE cell of its floor's walk map (never in a wall or a desk). */
function expectWalkable(layout, tour, maps) {
  for (const s of tour.stops) {
    if (!s.leg) continue;
    expect(s.leg.problem, `${s.name}: ${s.leg.message}`).toBeUndefined();
    let bad = 0;
    for (const p of legSamples(s.leg)) if (maps.get(layout, p.floor).at(p.x, p.z) !== FREE) bad++;
    expect(bad, `the walk to ${s.name} leaves the free cells`).toBe(0);
  }
}

/** The length of walking the stops in this order (findRoute between each two). */
function walkLength(layout, stops, maps) {
  let sum = 0;
  for (let i = 1; i < stops.length; i++) {
    const r = findRoute(layout, stops[i - 1].spot, stops[i].spot, { maps });
    expect(r.problem).toBeUndefined();
    sum += r.length;
  }
  return sum;
}

describe('the tour of the Meridian-shaped layout', () => {
  const { layout, people } = meridianWithPeople();
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const departments = [
    { name: 'HR', description: '  People operations, hiring, onboarding and employee records. ' },
    { name: 'Nobody here', description: 'Not shown' },
  ];
  const tour = plan(layout, people, departments, { maps });
  const byKind = (kind) => tour.stops.filter((s) => s.kind === kind);

  it('starts at the main entrance, then the reception; ends back at the reception', () => {
    expect(tour.stops[0]).toMatchObject({ n: 1, id: 'entrance', kind: 'entrance', floor: 0, leg: null });
    expect(tour.stops[1]).toMatchObject({ n: 2, id: 'reception', kind: 'reception', name: 'Lobby & Reception', roomId: 'room_f0_02' });
    expect(tour.stops.at(-1)).toMatchObject({ kind: 'return', name: 'Lobby & Reception', floor: 0 });
    expect(tour.stops.map((s) => s.n)).toEqual(tour.stops.map((_, i) => i + 1));
    // a department comes before any washroom or meeting room (one is about as near the reception)
    expect(tour.stops[2].kind).toBe('department');
  });

  it('every department once, its rooms grouped (Engineering: 2 rooms on Floor 1)', () => {
    const names = byKind('department').map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...new Set(Object.values(MERIDIAN_DEPARTMENTS))].sort());
    const eng = byKind('department').find((s) => s.name === 'Engineering');
    expect(eng.rooms.map((r) => r.name).sort()).toEqual(['Engineering 1', 'Engineering 2']);
    expect(eng.floor).toBe(1);
  });

  it('the ground floor first, then up the stairs: both floors', () => {
    expect(tour.floors).toEqual([0, 1]);
    const floors = tour.stops.filter((s) => s.kind !== 'return').map((s) => s.floor);
    expect(floors).toEqual([...floors].sort((a, b) => a - b));
    const up = tour.stops.find((s, i) => i && s.floor === 1 && tour.stops[i - 1].floor === 0);
    expect(up.leg.legs.map((l) => l.floor)).toEqual([0, 1]);
    expect(up.leg.legs[0].stairsAtEnd).toMatchObject({ direction: 'up', toFloor: 1 });
    expect(up.leg.directions).toMatch(/the stairs (on your (left|right)|ahead), up to Floor 1/);
  });

  it('one washroom and one meeting room per floor, not all of them', () => {
    for (const floor of [0, 1]) {
      for (const facility of ['RESTROOM', 'MEETING']) {
        expect(byKind('facility').filter((s) => s.floor === floor && s.facility === facility)).toHaveLength(1);
      }
    }
    // the ground floor has two meeting rooms: only one is a stop
    expect(layout.rooms.filter((r) => r.floor === 0 && r.type === 'MEETING')).toHaveLength(2);
  });

  it('no stop is unreachable, nothing skipped; every walk is on free cells (never through a wall)', () => {
    expect(tour.skipped).toEqual([]);
    expectWalkable(layout, tour, maps);
    for (const s of tour.stops.slice(1)) expect(s.leg.length).toBeGreaterThan(0);
  });

  it('the order is shorter than the naive one (the rooms as listed, floor by floor)', () => {
    const middle = tour.stops.filter((s) => s.kind === 'department' || s.kind === 'facility');
    const naive = [...middle].sort((a, b) => a.floor - b.floor
      || layout.rooms.findIndex((r) => r.id === a.roomId) - layout.rooms.findIndex((r) => r.id === b.roomId));
    const ends = (list) => [tour.stops[0], tour.stops[1], ...list, tour.stops.at(-1)];
    const planned = walkLength(layout, ends(middle), maps);
    expect(planned).toBeCloseTo(tour.length, 3);
    expect(planned).toBeLessThan(walkLength(layout, ends(naive), maps) * 0.9);
  });

  it('passing mentions: within 4 m of the door, on the route, once each, never a stop', () => {
    expect(tour.mentions.length).toBeGreaterThan(0);
    const stopRooms = new Set(tour.stops.map((s) => s.roomId));
    const seen = new Set();
    for (const m of tour.mentions) {
      expect(m.distance).toBeLessThanOrEqual(MENTION_DISTANCE);
      expect(Math.hypot(m.at.x - m.door.x, m.at.z - m.door.z)).toBeLessThanOrEqual(MENTION_DISTANCE + 1e-9);
      expect(m.text).toMatch(/^(On your (left|right)|Ahead): /);
      expect(stopRooms.has(m.roomId)).toBe(false);
      expect(seen.has(m.roomId)).toBe(false);
      seen.add(m.roomId);
      // the point is on the leg's route
      const leg = tour.stops[m.stop - 1].leg;
      let best = Infinity;
      for (const p of legSamples(leg)) if (p.floor === m.at.floor) best = Math.min(best, Math.hypot(p.x - m.at.x, p.z - m.at.z));
      expect(best).toBeLessThan(0.3);
    }
    // the tour covers the building: every room a stop, mentioned or walked through, but the far meeting room
    expect(tour.missed.map((r) => r.name)).toEqual(['Meeting Room 0.2']);
  });

  it("each stop's text: name, type, floor, the department's description, how many people, up to 3 names", () => {
    const hr = tour.stops.find((s) => s.name === 'HR');
    expect(hr.description).toBe('People operations, hiring, onboarding and employee records.');
    expect(hr.lines[0]).toBe('HR');
    expect(hr.lines[1]).toBe('Department · Ground Floor');
    expect(hr.lines).toContain('People operations, hiring, onboarding and employee records.');
    const n = people.filter((p) => p.department === 'HR' && p.deskId !== 'obj_f0_reception').length;
    expect(hr.people).toBe(n);
    expect(hr.lines).toContain(`${n} people work here`);
    expect(hr.names).toHaveLength(NAMES_MAX);
    expect(hr.names.every((p) => Object.keys(p).sort().join() === 'department,name')).toBe(true);
    expect(hr.lines.at(-1)).toMatch(/^Among them: Person \d+, Person \d+ and Person \d+$/);
    const eng = tour.stops.find((s) => s.name === 'Engineering');
    expect(eng.lines[1]).toBe('Department · 2 rooms: Engineering 1 and Engineering 2 · Floor 1');
    expect(eng.description).toBeNull();
    const reception = tour.stops[1];
    expect(reception.lines).toEqual(['Lobby & Reception', 'Reception · Ground Floor', '1 person works here', 'Kavya Iyer (HR)']);
    expect(tour.stops.find((s) => s.facility === 'RESTROOM').lines[1]).toBe('Washroom · Ground Floor');
    // every count is the number of stops, the entrance and the way back included (v0.14.4: it said 19 of 20)
    expect(tour.stops[0].lines.at(-1)).toBe(`The tour: ${tour.stops.length} stops, about ${tour.minutes} min`);
    expect(tourSummary(1, 1)).toBe('The tour: 1 stop, about 1 min');
    // nothing from the people list but names and departments
    expect(JSON.stringify(tour)).not.toMatch(/@meridian\.example|u_kavya/);
  });

  it('where to stand and face: inside the room (the reception: in front of its counter, facing it)', () => {
    for (const s of tour.stops.filter((x) => x.kind === 'department' || x.kind === 'facility')) {
      const room = layout.rooms.find((r) => r.id === s.roomId);
      expect(Math.abs(s.spot.x - room.x)).toBeLessThan(room.width / 2);
      expect(Math.abs(s.spot.z - room.z)).toBeLessThan(room.depth / 2);
      // facing into the room: its middle is ahead (or you stand on it)
      const mid = { x: room.x - s.spot.x, z: room.z - s.spot.z };
      const ahead = Math.sin(s.yaw) * mid.x + Math.cos(s.yaw) * mid.z;
      expect(ahead > 0 || Math.hypot(mid.x, mid.z) < 1, s.name).toBe(true);
    }
    const r = tour.stops[1];
    expect(r.spot.z).toBeLessThan(-7.65); // the counter's visitor side (−Z)
    expect(Math.cos(r.yaw)).toBeGreaterThan(0.99); // facing +Z: the counter
  });

  it('a room stop stands about 2 m inside the room (v0.14.4): free, in sight of the door, never in the doorway', () => {
    const rooms = tour.stops.filter((x) => x.kind === 'department' || x.kind === 'facility');
    const depths = [];
    for (const s of rooms) {
      const room = layout.rooms.find((r) => r.id === s.roomId);
      const map = maps.get(layout, s.spot.floor);
      expect(map.isClear(s.spot.x, s.spot.z), s.name).toBe(true);
      // how far from the nearest wall that has a door (its inner face)
      const T = room.wallThickness ?? 0.15;
      const walls = { north: room.z + room.depth / 2 - s.spot.z, south: s.spot.z - (room.z - room.depth / 2),
        east: room.x + room.width / 2 - s.spot.x, west: s.spot.x - (room.x - room.width / 2) };
      const doorWalls = [...new Set((room.doors ?? []).map((d) => d.wall))];
      const depth = Math.min(...doorWalls.map((w) => walls[w])) - T / 2;
      depths.push(depth);
      expect(depth, `${s.name} stands ${depth.toFixed(2)} m in`).toBeGreaterThan(1);
    }
    // most stand the full 2 m in (some rooms are small or full of desks there)
    expect(depths.filter((d) => d > 1.9).length).toBeGreaterThanOrEqual(Math.ceil(rooms.length * 0.6));
  });

  it('text directions for each leg', () => {
    for (const s of tour.stops.slice(1)) {
      expect(s.leg.directions).toMatch(/^[A-Z].*\.$/);
      expect(s.leg.steps.length).toBeGreaterThan(0);
    }
    expect(tour.stops[1].leg.directions).toBe('Into Lobby & Reception.');
    const all = tour.stops.map((s) => s.leg?.directions ?? '').join(' ');
    expect(all).toMatch(/along the corridor/);
    expect(all).toMatch(/is the (first|second|third) door on your (left|right)/);
    expect(tour.stops.at(-1).leg.directions).toMatch(/down to Ground Floor/);
  });

  it('a door counted along the corridor: the second on your right, past the first', () => {
    // walking east from Operations to Sales the corridor passes Customer Success's door on the right (south) first
    const t = plan(
      { ...layout, rooms: layout.rooms.map((r) => ({ ...r, departmentRef: ['Operations', 'Sales'].includes(r.departmentRef) ? r.departmentRef : undefined })) },
      [], [], { maps: createWalkMapCache({ catalog: ASSET_TYPES }), backToReception: false },
    );
    const sales = t.stops.find((s) => s.name === 'Sales');
    const before = t.stops[sales.n - 2];
    if (before.name === 'Operations') expect(sales.leg.directions).toMatch(/Sales is the second door on your right/);
    else expect(sales.leg.directions).toMatch(/Sales is the (first|second|third|fourth) door on your right/);
  });

  it('the total length and the estimated time: walking + a pause at each stop (shorter at facilities, none at the end)', () => {
    const sum = tour.stops.reduce((n, s) => n + (s.leg?.length ?? 0), 0);
    expect(tour.length).toBeCloseTo(sum, 6);
    for (const s of tour.stops) {
      const want = s.kind === 'return' ? 0 : s.kind === 'facility' || s.kind === 'entrance' ? FACILITY_PAUSE : STOP_PAUSE;
      expect(s.pause, s.name).toBe(want);
    }
    expect(FACILITY_PAUSE).toBeLessThan(STOP_PAUSE);
    expect(tour.pauseSeconds).toBe(tour.stops.reduce((n, s) => n + s.pause, 0));
    expect(tour.seconds).toBeCloseTo(tour.walkSeconds + tour.pauseSeconds, 6);
    expect(tour.minutes).toBeGreaterThanOrEqual(5);
    expect(tour.minutes).toBeLessThanOrEqual(12);
    const slow = plan(layout, people, [], { maps, speed: 1.4, pause: 30, backToReception: false });
    expect(slow.stops.at(-1).kind).not.toBe('return');
    const slowPauses = slow.stops.reduce((n, s) => n + (s.kind === 'facility' || s.kind === 'entrance' ? FACILITY_PAUSE : 30), 0);
    expect(slow.seconds).toBeCloseTo(slow.length / 1.4 + slowPauses, 6);
  });

  it('plans Meridian in under 300 ms (walk maps ready, as after the engine warms them)', () => {
    // ~170 ms on a laptop; the fastest of 6, since the other test files run alongside (the runner and CI vary).
    // GitHub's shared runners measured 306, 339 and 403 ms (8 Nov 2026): 600 ms there (CI is set), 300 ms elsewhere.
    const limit = process.env.CI ? 600 : 300;
    let fastest = Infinity;
    let again = null;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      again = plan(layout, people, departments, { maps });
      fastest = Math.min(fastest, performance.now() - t0);
    }
    expect(fastest).toBeLessThan(limit);
    expect(again.stops.map((s) => s.id)).toEqual(tour.stops.map((s) => s.id)); // the same plan every time
  });
});

describe("the tour of the viewer's sample company", () => {
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });

  it("the entrance, the reception, Engineering (from Asha's seat), the meeting room upstairs (by the stairs), back to reception", () => {
    const tour = plan(SAMPLE_LAYOUT, SAMPLE_PEOPLE, [], { maps });
    // v0.14.9: no departmentRef, but Asha (Engineering) is the only one seated there; Kavya (HR) at the reception
    // makes nothing HR (a shared space)
    expect(tour.stops.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'entrance:Main entrance', 'reception:Reception', 'department:Engineering', 'facility:Meeting room', 'return:Reception',
    ]);
    expect(tour.skipped).toEqual([]);
    expect(tour.floors).toEqual([0, 1]);
    expect(tour.stops[3].leg.directions).toBe('Out of Engineering, outside, through Reception, the stairs ahead, up to Floor 1, into Meeting room.');
    expect(tour.stops[1].lines).toEqual(['Reception', 'Reception · Ground Floor', '1 person works here', 'Kavya Iyer (HR)']);
    expectWalkable(SAMPLE_LAYOUT, tour, maps);
  });

  it('Engineering as a department: a stop with Asha, its description from the page', () => {
    const layout = { ...SAMPLE_LAYOUT, rooms: SAMPLE_LAYOUT.rooms.map((r) => (r.id === 'room_engineering' ? { ...r, departmentRef: 'Engineering' } : r)) };
    const tour = plan(layout, SAMPLE_PEOPLE, [{ name: 'engineering', description: 'Builds the machines.' }], { maps });
    const eng = tour.stops.find((s) => s.kind === 'department');
    expect(eng.lines).toEqual(['Engineering', 'Department · Ground Floor', 'Builds the machines.', '1 person works here', 'Asha Patel']);
    expect(tour.stops.map((s) => s.kind)).toEqual(['entrance', 'reception', 'department', 'facility', 'return']);
    expectWalkable(layout, tour, maps);
  });

  it('a room with no door is skipped, with the reason; the rest of the tour goes on', () => {
    const layout = {
      ...SAMPLE_LAYOUT,
      rooms: [...SAMPLE_LAYOUT.rooms, {
        id: 'room_closed', type: 'RESTROOM', name: 'Locked WC', floor: 0, x: 20, z: 0, width: 4, depth: 6, wallHeight: 3.2, doors: [], windows: [],
      }],
    };
    const tour = plan(layout, SAMPLE_PEOPLE, [], { maps: createWalkMapCache({ catalog: ASSET_TYPES }) });
    expect(tour.skipped).toEqual([expect.objectContaining({
      roomId: 'room_closed', name: 'Locked WC', problem: 'NO_DOOR', message: 'No walking route to Locked WC: it has no door',
    })]);
    expect(tour.stops.some((s) => s.roomId === 'room_closed')).toBe(false);
    expect(tour.stops.map((s) => s.kind)).toEqual(['entrance', 'reception', 'department', 'facility', 'return']);
  });

  it('a floor no stairs lead to: its rooms skipped (no stairs), the ground floor toured', () => {
    const layout = { ...SAMPLE_LAYOUT, objects: SAMPLE_LAYOUT.objects.filter((o) => o.assetType !== 'STAIRCASE') };
    const tour = plan(layout, SAMPLE_PEOPLE, [], { maps: createWalkMapCache({ catalog: ASSET_TYPES }) });
    expect(tour.floors).toEqual([0]);
    expect(tour.skipped).toEqual([expect.objectContaining({ roomId: 'room_meeting', problem: 'NO_STAIRS' })]);
    expect(tour.stops.map((s) => s.kind)).toEqual(['entrance', 'reception', 'department', 'return']);
  });

  it('an empty layout: just the start', () => {
    const tour = plan({ rooms: [], objects: [], floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } } });
    expect(tour.stops).toHaveLength(1);
    expect(tour.length).toBe(0);
    expect(tour.skipped).toEqual([]);
  });
});

describe('the tour on random layouts', () => {
  it('60 random layouts: every leg walkable, each department once, unreachable rooms listed with a reason', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const layout = randomLayout(seed);
      const rnd = random(seed * 7);
      for (const r of layout.rooms) if (rnd() < 0.4) r.departmentRef = `Team ${1 + Math.floor(rnd() * 3)}`;
      const maps = createWalkMapCache({ catalog: ASSET_TYPES });
      const tour = plan(layout, [], [], { maps });
      const where = `seed ${seed}`;
      expect(tour.stops[0].kind, where).toBe('entrance');
      expectWalkable(layout, tour, maps);
      const depts = tour.stops.filter((s) => s.kind === 'department').map((s) => s.name);
      expect(new Set(depts).size, where).toBe(depts.length);
      for (const s of tour.skipped) expect(s.message, where).toMatch(/No walking route|Not on the tour/);
      // a department is a stop, or every one of its rooms on its floor was skipped
      for (const name of new Set(layout.rooms.map((r) => r.departmentRef).filter(Boolean))) {
        if (depts.includes(name)) continue;
        const its = layout.rooms.filter((r) => r.departmentRef === name && r.type !== 'RECEPTION');
        expect(its.some((r) => tour.skipped.some((k) => k.roomId === r.id)) || its.length === 0, `${where}: ${name}`).toBe(true);
      }
      // the floors in order, ground first
      const floors = tour.stops.filter((s) => s.kind !== 'return').map((s) => s.floor);
      expect(floors, where).toEqual([...floors].sort((a, b) => a - b));
      for (const m of tour.mentions) expect(m.distance, where).toBeLessThanOrEqual(MENTION_DISTANCE);
    }
  }, 60000);
});

describe('ordering helpers', () => {
  // points on a line: the distance is |a − b|
  const D = { d: (a, b) => Math.abs(a - b) };

  it('nearest neighbour from the start', () => {
    expect(nearestNeighbour(D, 0, [5, 1, 9, 3])).toEqual([0, 1, 3, 5, 9]);
  });

  it('2-opt untangles a crossing (open path; the end fixed or not)', () => {
    expect(twoOpt(D, [0, 3, 1, 2, 4], false)).toEqual([0, 1, 2, 3, 4]);
    expect(twoOpt(D, [0, 9, 1, 5, 10], true)).toEqual([0, 1, 5, 9, 10]);
    expect(twoOpt(D, [0, 2, 1], true)).toEqual([0, 2, 1]); // the end never moves
  });

  it('a facility goes where it adds the least walking, never after the stairs', () => {
    expect(insertBest(D, [0, 4, 10], [5, 20], true)).toEqual([0, 4, 5, 10]);
    expect(insertBest(D, [0, 4, 10], [20], true)).toEqual([0, 4, 20, 10]);
    expect(insertBest(D, [0, 4, 10], [20], false)).toEqual([0, 4, 10, 20]);
    expect(insertBest(D, [0, 4], [], false)).toEqual([0, 4]);
  });

  it('a facility right after the reception moves on when a department is about as near (v0.14.4)', () => {
    const at = (x, kind) => ({ x, kind });
    const Dx = { d: (a, b) => Math.abs(a.x - b.x) };
    const rec = at(0, 'reception');
    const wc = at(2, 'facility');
    const sales = at(5, 'department');
    const hr = at(9, 'department');
    expect(notRightAfter(Dx, [rec, wc, sales, hr], false)).toEqual([rec, sales, wc, hr]);
    // the department far further away: the washroom stays first
    const far = at(40, 'department');
    expect(notRightAfter(Dx, [rec, wc, far], false)).toEqual([rec, wc, far]);
    // a department first already: nothing changes; never after the stairs
    expect(notRightAfter(Dx, [rec, sales, wc], false)).toEqual([rec, sales, wc]);
    const stairs = at(12, 'stairs');
    expect(notRightAfter(Dx, [rec, wc, sales, stairs], true)).toEqual([rec, sales, wc, stairs]);
  });

  it('left and right: facing +Z, +X is on your right', () => {
    const samples = sampleLine([{ x: 0, z: 0 }, { x: 0, z: 10 }]);
    const k = 20; // at z = 5
    expect(sideOf(samples, k, { x: 2, z: 5 })).toBe('right');
    expect(sideOf(samples, k, { x: -2, z: 5 })).toBe('left');
    expect(sideOf(samples, k, { x: 0.1, z: 8 })).toBe('ahead');
  });

  it('the coarse grid keeps a narrow door open and walls closed', () => {
    const layout = {
      floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
      rooms: [
        { id: 'a', type: 'OFFICE', name: 'A', floor: 0, x: 0, z: 0, width: 6, depth: 6, wallHeight: 3, doors: [{ wall: 'east', offset: 0, width: 0.9 }], windows: [] },
        { id: 'b', type: 'OFFICE', name: 'B', floor: 0, x: 6.15, z: 0, width: 6, depth: 6, wallHeight: 3, doors: [], windows: [] },
      ],
      objects: [],
    };
    const map = createWalkMapCache({ catalog: ASSET_TYPES }).get(layout, 0);
    const f = coarseField(coarseOf(map), { x: 0, z: 0 });
    const through = coarseCost(f, { x: 6.15, z: 0 });
    expect(through).toBeGreaterThan(5.5); // through the door, not around
    expect(through).toBeLessThan(7.5);
    const r = findRoute(layout, { x: 0, z: 0, floor: 0 }, { x: 6.15, z: 0, floor: 0 }, { catalog: ASSET_TYPES });
    expect(Math.abs(through - r.length)).toBeLessThan(0.6);
  });
});
