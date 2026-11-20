// v0.18.3: routes ride a lift (route.floorLinks: kind 'lift'); Find's "Nearest lift" (places.js).
import { describe, it, expect } from 'vitest';
import { findRoute, floorLinks, findNearestRoute } from '../route';
import { createWalkMapCache } from '../walkMap';
import { buildPlaces, searchPlaces } from '../places';
import { routePath } from '../follow';
import { rideSeconds, liftsOf } from '../../lifts';
import { WALK_SPEED } from '../../speeds';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

/** Three floors: a hall each, a lift shaft inside each hall (same rectangle), stairs from the ground floor to Floor 1 only. */
export function liftLayout({ stairs = true, liftFloors = [0, 1, 2] } = {}) {
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 }, 2: { id: 2, name: 'Floor 2', height: 3.5 } };
  const rooms = {};
  for (const f of [0, 1, 2]) {
    rooms[`hall_${f}`] = {
      id: `hall_${f}`, name: f ? `Hall ${f}` : 'Hall', type: 'OFFICE', floor: f, x: 0, z: 0, width: 16, depth: 10, wallHeight: 3.2,
      doors: f === 0 ? [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] : [], windows: [],
    };
    if (liftFloors.includes(f)) {
      rooms[`lift_${f}`] = {
        id: `lift_${f}`, name: 'Lift', type: 'LIFT', floor: f, x: 5, z: 2, width: 2.2, depth: 2.2, wallHeight: 3.2,
        doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [],
      };
    }
  }
  const objects = stairs ? {
    s1: { id: 's1', assetType: 'STAIRCASE', floor: 0, x: -5, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
  } : {};
  return { rooms, objects, floors };
}

const opts = () => ({ maps: createWalkMapCache({ catalog: ASSET_TYPES }) });

describe('lift routes (v0.18.3)', () => {
  it('a lift is a link between every two floors it serves, its ride as cost, nothing walked', () => {
    const layout = liftLayout();
    const links = floorLinks(layout, opts());
    const lifts = links.filter((l) => l.kind === 'lift');
    expect(lifts.map((l) => `${l.from.floor}-${l.to.floor}`).sort()).toEqual(['0-1', '0-2', '1-2']);
    const [lift] = liftsOf(layout.rooms, layout.floors);
    const l02 = lifts.find((l) => l.from.floor === 0 && l.to.floor === 2);
    expect(l02).toMatchObject({ liftId: 'lift_0', length: 0, seconds: rideSeconds(lift, 0, 2) });
    expect(l02.cost).toBeCloseTo(rideSeconds(lift, 0, 2) * WALK_SPEED);
    expect(Math.hypot(l02.from.x - 5, l02.from.z - 2)).toBeLessThan(0.3); // the middle of the car
  });

  it('Floor 2 (no stairs up there) is reached by the lift; its ride is in the seconds, not the metres', () => {
    const layout = liftLayout();
    const r = findRoute(layout, { x: 0, z: -3, floor: 0 }, { x: -5, z: -3, floor: 2 }, opts());
    expect(r.problem).toBeUndefined();
    expect(r.legs.map((l) => l.floor)).toEqual([0, 2]);
    expect(r.legs[0].stairsAtEnd).toMatchObject({ kind: 'lift', liftId: 'lift_0', direction: 'up', toFloor: 2, length: 0 });
    const walked = r.legs.reduce((s, l) => s + l.points.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - l.points[i].x, p.z - l.points[i].z), 0), 0);
    expect(r.length).toBeCloseTo(walked, 5);
    expect(r.seconds).toBeCloseTo(r.length / WALK_SPEED + r.legs[0].stairsAtEnd.seconds, 5);
    // the route's path: the ride is one point on each floor, at the car (follow.js)
    const path = routePath(r);
    const k = path.points.findIndex((p) => p.stairs);
    expect(path.points[k].floor).toBe(0);
    expect(path.points[k + 1].floor).toBe(2);
    expect(path.points[k].len).toBe(0);
  });

  it('one floor up with the stairs near: the stairs; and down again by the lift', () => {
    const layout = liftLayout();
    const up = findRoute(layout, { x: -2, z: -3, floor: 0 }, { x: -3, z: -3, floor: 1 }, opts());
    expect(up.legs[0].stairsAtEnd.kind).toBe('stairs');
    const down = findRoute(layout, { x: 3, z: -3, floor: 2 }, { x: 3, z: -3, floor: 0 }, opts());
    expect(down.legs[0].stairsAtEnd).toMatchObject({ kind: 'lift', direction: 'down', toFloor: 0 });
  });

  it('no lift and no stairs to Floor 2: no route (as before)', () => {
    const r = findRoute(liftLayout({ liftFloors: [0, 1] }), { x: 0, z: -3, floor: 0 }, { x: -5, z: -3, floor: 2 }, opts());
    expect(r.problem).toBe('NO_STAIRS');
  });

  it('Find: a Lift facility, "Nearest lift" while walking', () => {
    const layout = liftLayout();
    const index = buildPlaces(layout, []);
    const found = searchPlaces(index, 'lift', { from: { x: 0, z: -3, floor: 0 } });
    const facilities = found.groups.facilities;
    expect(facilities.length).toBeGreaterThan(0);
    expect(JSON.stringify(facilities[0])).toMatch(/Nearest lift/);
    const lifts = index.places.filter((p) => p.facility === 'LIFT');
    expect(lifts.length).toBe(3); // one shaft per floor
    const near = findNearestRoute(layout, { x: 0, z: -3, floor: 0 }, lifts.flatMap((p) => p.goals.map((g) => ({ ...g, name: p.name }))), opts());
    expect(near.problem).toBeUndefined();
    expect(near.legs).toHaveLength(1); // the one on the ground floor
  });
});

describe('Check my layout and lifts (v0.18.3)', () => {
  it('warns when the lift skips a floor or a floor has no stop; nothing for a lift that serves every floor', async () => {
    const { checkLayout } = await import('../checkLayout');
    const lifts = (layout) => checkLayout(layout, { catalog: ASSET_TYPES, fixes: false }).problems.filter((p) => p.kind === 'LIFT');
    expect(lifts(liftLayout())).toEqual([]);
    const gap = lifts(liftLayout({ liftFloors: [0, 2] }));
    expect(gap.map((p) => [p.code, p.floorId, p.severity, p.message])).toEqual([['LIFT_GAP', 1, 'warning', 'The lift skips Floor 1']]);
    const none = lifts(liftLayout({ liftFloors: [0, 1] }));
    expect(none.map((p) => [p.code, p.floorId, p.message])).toEqual([['LIFT_FLOOR_NOT_SERVED', 2, 'No lift stops at Floor 2']]);
  });
});
