// v0.18.4: "Avoid stairs (use lifts)": routes between floors by lift only; a place only the stairs reach is said
// plainly (NEEDS_STAIRS), never walked to by the stairs; Check's floor with no lift stop + Fix it (a stop there).
import { describe, it, expect } from 'vitest';
import { findRoute, findNearestRoute, floorLinks } from '../route';
import { createWalkMapCache } from '../walkMap';
import { liftFloorsFrom, liftProblems, liftStopSpot } from '../../lifts';
import { checkLayout } from '../checkLayout';
import { planTour } from '../tour';
import { ASSET_TYPES } from '../../../utils/assetCatalog';
import { liftLayout } from './liftLayout';

const opts = (more = {}) => ({ maps: createWalkMapCache({ catalog: ASSET_TYPES }), ...more });
const entrance = { x: 0, z: -3, floor: 0 };
const kinds = (r) => r.legs.map((l) => l.stairsAtEnd?.kind).filter(Boolean);

describe('avoid stairs: routes (v0.18.4)', () => {
  it('to Floor 1 the stairs win by default; avoiding them, the lift', () => {
    const layout = liftLayout();
    const goal = { x: -5, z: -3, floor: 1 };
    expect(kinds(findRoute(layout, entrance, goal, opts()))).toEqual(['stairs']);
    const lift = findRoute(layout, entrance, goal, opts({ avoidStairs: true }));
    expect(lift.problem).toBeUndefined();
    expect(kinds(lift)).toEqual(['lift']);
    expect(floorLinks(layout, opts({ avoidStairs: true })).every((l) => l.kind === 'lift')).toBe(true);
  });

  it('a floor no lift goes to: NEEDS_STAIRS in plain words, never a route by the stairs', () => {
    const layout = liftLayout({ liftFloors: [0, 2] }); // stairs to Floor 1, the lift skips it
    const r = findRoute(layout, entrance, { x: -5, z: -3, floor: 1, name: 'Hall 1' }, opts({ avoidStairs: true }));
    expect(r).toEqual({ problem: 'NEEDS_STAIRS', message: 'No lift goes to Floor 1: this route needs the stairs' });
    // with the stairs allowed it is a route
    expect(findRoute(layout, entrance, { x: -5, z: -3, floor: 1 }, opts()).problem).toBeUndefined();
    // from a floor with no stop, going down
    const down = findRoute(layout, { x: -5, z: -3, floor: 1 }, entrance, opts({ avoidStairs: true }));
    expect(down.message).toBe('No lift stops at Floor 1: this route needs the stairs');
  });

  it('when the stairs would not help either, the usual answer stays', () => {
    const layout = liftLayout({ stairs: false, liftFloors: [0, 1] });
    const r = findRoute(layout, entrance, { x: -5, z: -3, floor: 2 }, opts({ avoidStairs: true }));
    expect(r.problem).toBe('NO_STAIRS');
  });

  it('the nearest of several: the one the lift reaches; none: NEEDS_STAIRS', () => {
    const layout = liftLayout({ liftFloors: [0, 2] });
    const goals = [{ x: -5, z: -3, floor: 1, name: 'A' }, { x: -5, z: -3, floor: 2, name: 'B' }];
    expect(findNearestRoute(layout, entrance, goals, opts({ avoidStairs: true })).goalIndex).toBe(1);
    const only = findNearestRoute(layout, entrance, [goals[0]], opts({ avoidStairs: true }));
    expect(only.problem).toBe('NEEDS_STAIRS');
  });

  it('same floor: nothing changes', () => {
    const layout = liftLayout();
    const a = findRoute(layout, entrance, { x: -6, z: 3, floor: 0 }, opts());
    const b = findRoute(layout, entrance, { x: -6, z: 3, floor: 0 }, opts({ avoidStairs: true }));
    expect(b.length).toBeCloseTo(a.length, 6);
  });
});

describe('avoid stairs: floors by lift and Check (v0.18.4)', () => {
  it('liftFloorsFrom: the floors lifts join to the start, lift after lift', () => {
    const { rooms, floors } = liftLayout({ liftFloors: [0, 2] });
    expect([...liftFloorsFrom(rooms, floors, 0)].sort()).toEqual([0, 2]);
    expect([...liftFloorsFrom(rooms, floors, 1)]).toEqual([1]);
  });

  it('Check: "Floor 1 has no lift stop", Fix it = a stop there (its spot is free); the old key kept', () => {
    const layout = liftLayout({ liftFloors: [0, 2] });
    const p = checkLayout(layout, { catalog: ASSET_TYPES }).problems.filter((x) => x.kind === 'LIFT');
    expect(p.map((x) => x.code)).toEqual(['LIFT_GAP']); // a skipped floor is said once
    const one = liftLayout({ liftFloors: [0, 1] });
    const q = checkLayout(one, { catalog: ASSET_TYPES }).problems.find((x) => x.code === 'LIFT_FLOOR_NOT_SERVED');
    expect(q).toMatchObject({
      key: 'LIFT_LIFT_FLOOR_NOT_SERVED:lift_0:2', floorId: 2,
      message: "Floor 2 has no lift stop: people who can't use stairs can't get there",
      fix: { liftStops: { roomId: 'lift_0', stops: [0, 1, 2] }, label: 'Add a lift stop on Floor 2' },
    });
    // the gap's line has the same Fix it
    const gap = checkLayout(layout, { catalog: ASSET_TYPES }).problems.find((x) => x.code === 'LIFT_GAP');
    expect(gap.fix).toEqual({ liftStops: { roomId: 'lift_0', stops: [0, 1, 2] }, label: 'Add a lift stop on Floor 1' });
  });

  it('no Fix it where the shaft would land on a room or an item', () => {
    const layout = liftLayout({ liftFloors: [0, 1] });
    layout.rooms.box = { id: 'box', name: 'Store', type: 'STORAGE', floor: 2, x: 5.5, z: 2.5, width: 3, depth: 3, wallHeight: 3.2, doors: [], windows: [] };
    expect(liftStopSpot(layout.rooms, layout.objects, layout.floors, 2)).toBeNull();
    const withDesk = liftLayout({ liftFloors: [0, 1] });
    withDesk.objects.d = { id: 'd', assetType: 'DESK', floor: 2, x: 5, y: 0, z: 2, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
    expect(liftStopSpot(withDesk.rooms, withDesk.objects, withDesk.floors, 2)).toBeNull();
    const p = liftProblems(withDesk.rooms, withDesk.floors, withDesk.objects).find((x) => x.code === 'LIFT_FLOOR_NOT_SERVED');
    expect(p.stop).toBeUndefined();
    expect(p.text).toBe("Floor 2 has no lift stop: people who can't use stairs can't get there");
  });

  it('a floor a lift stops at, but no lift from the ground floor reaches', () => {
    const layout = liftLayout({ liftFloors: [] });
    for (const f of [1, 2]) {
      layout.rooms[`up_${f}`] = { id: `up_${f}`, name: 'Lift', type: 'LIFT', floor: f, x: 5, z: 2, width: 2.2, depth: 2.2, wallHeight: 3.2, doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [] };
    }
    const p = liftProblems(layout.rooms, layout.floors, layout.objects);
    expect(p.map((x) => [x.floor, x.text])).toEqual([
      [1, "No lift from Ground Floor reaches Floor 1: people who can't use stairs can't get there"],
      [2, "No lift from Ground Floor reaches Floor 2: people who can't use stairs can't get there"],
    ]);
  });
});

describe('avoid stairs: the tour (v0.18.4)', () => {
  const withDepartments = (more) => {
    const layout = liftLayout(more);
    layout.rooms.hall_1.departmentRef = 'Sales';
    layout.rooms.hall_2.departmentRef = 'Design';
    return layout;
  };
  it('by lift only: Floor 2 visited by the lift, Floor 1 (no lift stop) skipped saying why', () => {
    const plan = planTour(withDepartments({ liftFloors: [0, 2] }), [], [], { catalog: ASSET_TYPES, avoidStairs: true });
    expect([...new Set(plan.stops.map((s) => s.floor))]).toEqual([0, 2]);
    expect(plan.stops.map((s) => s.department).filter(Boolean)).toEqual(['Design']);
    expect(plan.skipped.find((s) => s.roomId === 'hall_1')).toMatchObject({ problem: 'NEEDS_STAIRS', message: 'No lift goes to Floor 1: this route needs the stairs' });
  });
  it('stairs allowed: floor by floor as before (the stairs to Floor 1; from there no way up, so Floor 2 is skipped)', () => {
    const plan = planTour(withDepartments({ liftFloors: [0, 2] }), [], [], { catalog: ASSET_TYPES });
    expect([...new Set(plan.stops.map((s) => s.floor))]).toEqual([0, 1]);
    expect(plan.stops.some((s) => s.department === 'Sales')).toBe(true);
  });
});
