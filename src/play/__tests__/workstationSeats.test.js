// v0.18.0: every seat of a prefab is a desk like any other: its person sits (and types at its built-in
// screen), Find finds them, a walk reaches them, live presence stands them beside it, on any floor.
import { describe, expect, it } from 'vitest';
import { prefabById } from '../../catalog/manifest';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { prefabPlacement } from '../prefabDrop';
import { groupOf, groupSeats } from '../prefab';
import { deskSeats, seatPose, workClip, hasBuiltInScreen } from '../people';
import { wsPatch } from '../workstation';
import { buildPlaces, searchPlaces } from '../navigation/places';
import { findNearestRoute } from '../navigation/route';
import { createWalkMapCache } from '../navigation/walkMap';
import { entranceSpawn } from '../navigation/entrance';
import { standingSpot } from '../live';
import { itemFootprints } from '../navigation/walkMap';
import { rectsOverlap } from '../turnedRect';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const office = (floor = 0) => ({
  id: `open_${floor}`, type: 'OFFICE', name: 'Open Office', floor, x: 0, z: 0, width: 20, depth: 14, wallHeight: 3.2, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [],
});

function officeWith(floor = 0) {
  const rooms = [office(floor)];
  let n = 0;
  const objects = [];
  const put = (id, x, z, rotationY = 0) => {
    const { objects: items } = prefabPlacement(prefabById(id), {}, ASSET_TYPES, { x, z, rotationY, floor }, rooms,
      { groupId: `grp_${id}_${x}`, newId: () => `obj_${floor}_${++n}` });
    objects.push(...items);
  };
  put('WS_CLUSTER_6', -4.5, 2);
  put('WS_CLUSTER_6', 2, 2);
  put('WS_ROW_4', -2, -3.5);
  put('WS_MANAGER', 7, -3, Math.PI / 2);
  return { rooms, objects, floors };
}

const people = (layout) => groupSeatsOf(layout).map((s, i) => ({ personId: `p${i}`, deskId: s.desk.id, name: `Person ${i}`, department: 'Sales' }));
function groupSeatsOf(layout) {
  const groups = new Map();
  for (const o of layout.objects) {
    const g = groupOf(o);
    if (g) groups.set(g.id, [...(groups.get(g.id) ?? []), o]);
  }
  return [...groups.values()].flatMap((members) => groupSeats(members));
}

describe('people at workstation seats (v0.18.0)', () => {
  const layout = officeWith();
  const seats = deskSeats(layout.objects);

  it('every seat has its own chair; a manager desk never seats its person on a visitor chair', () => {
    const all = groupSeatsOf(layout);
    expect(all).toHaveLength(6 + 6 + 4 + 1);
    for (const s of all) expect(seats.get(s.desk.id)?.id).toBe(s.chair.id);
    const visitors = layout.objects.filter((o) => o.metadata?.visitor);
    expect(visitors).toHaveLength(2);
    // without its own chair the manager stands at the desk: the visitor chairs stay free
    const manager = layout.objects.find((o) => o.assetType === 'DESK_MANAGER');
    const noChair = layout.objects.filter((o) => o.id !== seats.get(manager.id).id);
    const pose = seatPose(manager.id, noChair, floors);
    expect(pose.seated).toBe(false);
  });

  it('they type at the built-in screen; with "Monitor and keyboard" off they sit', () => {
    const desk = layout.objects.find((o) => o.assetType === 'DESK_WORKSTATION');
    const pose = seatPose(desk.id, layout.objects, floors, seats);
    expect(hasBuiltInScreen(desk)).toBe(true);
    expect(workClip(pose, layout.objects)).toBe('Type');
    const off = layout.objects.map((o) => (o.id === desk.id ? { ...o, ...wsPatch(o, { screen: false }) } : o));
    expect(workClip(pose, off)).toBe('Sit');
    expect(workClip(seatPose(layout.objects.find((o) => o.assetType === 'DESK_MANAGER').id, layout.objects, floors, seats), layout.objects)).toBe('Type');
  });

  it('live presence: standing beside each desk, clear of every desk', () => {
    const desks = layout.objects.filter((o) => o.assetType.startsWith('DESK_'));
    for (const s of groupSeatsOf(layout)) {
      const spot = standingSpot(seatPose(s.desk.id, layout.objects, floors, seats));
      const body = { x: spot.x, z: spot.z, hw: 0.15, hd: 0.15, rot: 0 };
      for (const d of desks) for (const fp of itemFootprints(d, ASSET_TYPES)) expect(rectsOverlap(fp, body)).toBe(false);
    }
  });

  it('Find finds each person, and a walk from the entrance reaches every seat', () => {
    const who = people(layout);
    const index = buildPlaces(layout, who);
    expect(searchPlaces(index, 'Person 7').groups.people[0].id).toBe('person:p7');
    const maps = createWalkMapCache();
    const from = { ...entranceSpawn(layout, { catalog: ASSET_TYPES }), floor: 0 };
    for (const p of who) {
      const goals = index.byId.get(`person:${p.personId}`).goals;
      const route = findNearestRoute(layout, from, goals, { catalog: ASSET_TYPES, maps });
      expect(route.problem, `${p.name}: ${route.message}`).toBeUndefined();
      const end = route.legs.at(-1).points.at(-1);
      const chair = seats.get(p.deskId);
      expect(Math.hypot(end.x - chair.x, end.z - chair.z)).toBeLessThan(1.6);
    }
  });

  it('on an upper floor too', () => {
    const up = officeWith(1);
    const upSeats = deskSeats(up.objects);
    const s = groupSeatsOf(up)[0];
    const pose = seatPose(s.desk.id, up.objects, floors, upSeats);
    expect(pose).toMatchObject({ seated: true, floor: 1, y: 3.5 });
    expect(workClip(pose, up.objects)).toBe('Type');
  });
});
