import { describe, expect, it } from 'vitest';
import {
  layoutPrefab, prefabItems, prefabParams, groupOf, groupItems, selectionFor, selectedGroup, groupOrigin,
  rebuildGroup, ungroupMoves, regroupCopies, groupSeats, prefabOutline, memberKey, CHAIR_TYPE, VISITOR_TYPE,
} from '../prefab';
import { PREFABS, prefabById } from '../../catalog/manifest';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { deskSeats, seatPose } from '../people';
import { wsParams } from '../workstation';
import { itemFootprints } from '../navigation/walkMap';
import { groupMoves, groupTurn, groupMembers } from '../group';

let n = 0;
const newId = () => `obj_${++n}`;
const place = (id, at = { x: 3, z: -2, rotationY: 0, floor: 0 }, params = {}) => {
  const prefab = prefabById(id);
  return prefabItems(prefab, params, ASSET_TYPES, at, { groupId: `grp_${id}`, idFor: newId });
};
const FLOORS = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const corners = (r) => {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: r.x + a * r.hw * c + b * r.hd * s, z: r.z - a * r.hw * s + b * r.hd * c }));
};
const inside = (outline, p) => {
  const c = Math.cos(outline.rot);
  const s = Math.sin(outline.rot);
  const dx = p.x - outline.x;
  const dz = p.z - outline.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= outline.hw + 2e-3 && Math.abs(lz) <= outline.hd + 2e-3; // positions are kept to the mm
};

describe('prefab layouts (v0.18.0)', () => {
  it('a cluster of N: N desks, N chairs, every chair the seat of its own desk', () => {
    for (const seats of [2, 4, 6, 8]) {
      const items = place(`WS_CLUSTER_${seats}`);
      const desks = items.filter((o) => groupOf(o).role === 'desk');
      const chairs = items.filter((o) => o.assetType === CHAIR_TYPE);
      expect(desks).toHaveLength(seats);
      expect(chairs).toHaveLength(seats);
      const pairs = deskSeats(items);
      for (const d of desks) {
        const chair = pairs.get(d.id);
        expect(chair, `${seats}: desk ${groupOf(d).slot}`).toBeTruthy();
        expect(groupOf(chair).slot).toBe(groupOf(d).slot);
        expect(seatPose(d.id, items, FLOORS).seated).toBe(true);
      }
    }
  });

  it('two rows back to back along one spine, with the partitions never in the same place', () => {
    const items = place('WS_CLUSTER_6', { x: 0, z: 0, rotationY: 0, floor: 0 });
    const desks = items.filter((o) => groupOf(o).role === 'desk');
    // each desk's back edge (its local −Z) lies on z = 0
    for (const d of desks) {
      const back = d.z - Math.cos(d.rotationY) * 0.35;
      expect(back).toBeCloseTo(0, 6);
    }
    // the side screens: world x of every panel, never two at one x on one side of the spine
    const panels = [];
    for (const d of desks) {
      const p = wsParams(d, ASSET_TYPES.DESK_WORKSTATION);
      const half = p.width / 2;
      const flip = Math.cos(d.rotationY) < 0 ? -1 : 1; // turned 180°: local −X is world +X
      const sides = p.sides === 'both' ? [-1, 1] : p.sides === 'left' ? [-1] : [];
      for (const sx of sides) panels.push(`${Math.sign(d.z)}:${(d.x + flip * sx * half).toFixed(3)}`);
    }
    expect(new Set(panels).size).toBe(panels.length);
    // both ends of each row are closed, and each joint has one divider: n + 1 panels per row
    expect(panels.length).toBe(2 * (3 + 1));
  });

  it('every member stands inside the prefab outline', () => {
    for (const prefab of PREFABS) {
      const at = { x: 1, z: 2, rotationY: 0.4, floor: 0 };
      const items = place(prefab.id, at);
      const outline = prefabOutline(prefab, {}, ASSET_TYPES, at);
      for (const o of items) {
        for (const fp of itemFootprints(o, ASSET_TYPES)) {
          for (const c of corners(fp)) expect(inside(outline, c), `${prefab.id}: ${o.assetType}`).toBe(true);
        }
      }
    }
  });

  it('a manager workstation: visitor chairs facing the desk, never its seat', () => {
    const items = place('WS_MANAGER');
    const desk = items.find((o) => groupOf(o).role === 'desk');
    const visitors = items.filter((o) => o.assetType === VISITOR_TYPE);
    expect(visitors).toHaveLength(2);
    for (const v of visitors) expect(v.metadata.visitor).toBe(true);
    expect(deskSeats(items).get(desk.id).assetType).toBe(CHAIR_TYPE);
    expect(desk.metadata.ws.modesty).toBe(true);
  });

  it('a cabin has its room, big enough for what is in it', () => {
    const { room, width, depth } = layoutPrefab(prefabById('WS_CABIN'), {}, ASSET_TYPES);
    expect(room).toMatchObject({ type: 'OFFICE', name: 'Cabin' });
    expect([width, depth]).toEqual([room.width, room.depth]);
  });

  it('cleans options', () => {
    expect(prefabParams(prefabById('WS_CLUSTER_4'), { deskWidth: 9, partition: 'stone', partitionHeight: 0.01 }))
      .toEqual({ deskWidth: 2.4, deskDepth: 0.7, partition: 'none', partitionHeight: 0.2 });
  });
});

describe('saved groups (v0.18.0)', () => {
  const world = () => Object.fromEntries([...place('WS_CLUSTER_4'), { id: 'loose', assetType: 'DESK_STANDARD', x: 9, z: 9 }].map((o) => [o.id, o]));

  it('a click selects the whole group; Alt one item', () => {
    const objects = world();
    const desk = Object.values(objects).find((o) => groupOf(o)?.role === 'desk');
    const ids = selectionFor(objects, desk);
    expect(ids).toHaveLength(8);
    expect(selectionFor(objects, desk, { alone: true })).toEqual([desk.id]);
    expect(selectionFor(objects, objects.loose)).toEqual(['loose']);
    expect(selectedGroup(objects, ids)).toBe('grp_WS_CLUSTER_4');
    expect(selectedGroup(objects, ids.slice(1))).toBeNull();
    expect(groupItems(objects, 'grp_WS_CLUSTER_4')[0].metadata.group.role).toBe('desk');
  });

  it('knows where it is after being moved and turned as a whole', () => {
    const objects = world();
    const prefab = prefabById('WS_CLUSTER_4');
    const ids = Object.keys(objects).filter((id) => id !== 'loose');
    const { items } = groupMembers(objects, ids);
    const turned = Object.fromEntries(groupTurn(items, Math.PI / 2).map(([id, p]) => [id, { ...objects[id], ...p }]));
    const moved = Object.fromEntries(groupMoves(Object.values(turned).map((item) => ({ item })), 2, 1).map(([id, p]) => [id, { ...turned[id], ...p }]));
    const at = groupOrigin(prefab, Object.values(moved), ASSET_TYPES);
    expect(at.rotationY).toBeCloseTo(Math.PI / 2, 6);
    // the same items come back from there
    const again = prefabItems(prefab, {}, ASSET_TYPES, at, { groupId: 'g', idFor: (m) => memberKey(m) });
    for (const o of Object.values(moved)) {
      const twin = again.find((a) => a.id === memberKey(groupOf(o)));
      expect(twin.x).toBeCloseTo(o.x, 3);
      expect(twin.z).toBeCloseTo(o.z, 3);
    }
  });

  it('new options rebuild it with the same ids (a desk keeps its people)', () => {
    const objects = world();
    const prefab = prefabById('WS_CLUSTER_4');
    const members = groupItems(objects, 'grp_WS_CLUSTER_4');
    members[0].label = 'Asha';
    const { removeIds, add } = rebuildGroup(prefab, members, { deskWidth: 1.6, partition: 'glass' }, ASSET_TYPES, () => 'new');
    expect(removeIds.sort()).toEqual(members.map((o) => o.id).sort());
    expect(add.map((o) => o.id).sort()).toEqual(members.map((o) => o.id).sort());
    const desk = add.find((o) => o.id === members[0].id);
    expect(desk.label).toBe('Asha');
    expect(wsParams(desk, ASSET_TYPES.DESK_WORKSTATION)).toMatchObject({ width: 1.6, partition: 'glass' });
    expect(desk.metadata.group.params.deskWidth).toBe(1.6);
  });

  it('ungroups and regroups copies', () => {
    const members = groupItems(world(), 'grp_WS_CLUSTER_4');
    for (const [, patch] of ungroupMoves(members)) {
      expect(patch.metadata.group).toBeUndefined();
    }
    expect(ungroupMoves(members).find(([id]) => id === members[0].id)[1].metadata.ws).toBeTruthy();
    let g = 0;
    const copies = regroupCopies(members.map((o) => ({ ...o, id: `c_${o.id}` })), () => `grp_new${++g}`);
    expect(new Set(copies.map((o) => groupOf(o).id))).toEqual(new Set(['grp_new1']));
    const one = regroupCopies([members[0]], () => 'x');
    expect(groupOf(one[0])).toBeNull();
  });

  it('lists its seats, Seat 1 … N', () => {
    const seats = groupSeats(groupItems(world(), 'grp_WS_CLUSTER_4'));
    expect(seats.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    for (const s of seats) expect(groupOf(s.chair).slot).toBe(groupOf(s.desk).slot);
  });
});
