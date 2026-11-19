import { describe, expect, it } from 'vitest';
import { prefabById } from '../../catalog/manifest';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { prefabPlacement, planPrefabDrop } from '../prefabDrop';
import { prefabOutline, groupOf } from '../prefab';
import { aisleGroups, groupOutline, rectGap, narrowAisles, dropAisle, AISLE_MIN } from '../aisles';
import { checkLayout, CHECK_KINDS } from '../navigation/checkLayout';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const office = {
  id: 'open', type: 'OFFICE', name: 'Open Office', floor: 0, x: 0, z: 0, width: 20, depth: 14, wallHeight: 3.2, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [],
};
let n = 0;
const place = (id, x, z, rotationY = 0) => prefabPlacement(prefabById(id), {}, ASSET_TYPES, { x, z, rotationY, floor: 0 }, [office],
  { groupId: `grp_${++n}`, newId: () => `obj_${++n}` }).objects;
const layoutOf = (...groups) => ({ rooms: [office], objects: groups.flat(), floors });
const width6 = prefabOutline(prefabById('WS_CLUSTER_6'), {}, ASSET_TYPES, { x: 0, z: 0 }).hw * 2;
const kinds = (layout, kind) => checkLayout(layout, { catalog: ASSET_TYPES }).problems.filter((p) => p.kind === kind);

describe('aisles beside clusters (v0.18.0)', () => {
  it('a group outline is the prefab outline, wherever it stands and turns', () => {
    for (const rot of [0, Math.PI / 2, 0.7]) {
      const items = place('WS_CLUSTER_6', 1, 2, rot);
      const [g] = aisleGroups(items, ASSET_TYPES);
      const want = prefabOutline(prefabById('WS_CLUSTER_6'), {}, ASSET_TYPES, { x: 1, z: 2, rotationY: rot });
      expect(g.outline.x).toBeCloseTo(want.x, 2);
      expect(g.outline.z).toBeCloseTo(want.z, 2);
      // the members' own footprints: inside the prefab's outline, at most a chair's gap smaller
      for (const k of ['hw', 'hd']) {
        expect(g.outline[k]).toBeLessThanOrEqual(want[k] + 1e-3);
        expect(g.outline[k]).toBeGreaterThan(want[k] - 0.1);
      }
    }
    expect(groupOutline(prefabById('WS_ROW_4'), place('WS_ROW_4', 0, 0), ASSET_TYPES)).toBeTruthy();
  });

  it('measures gaps between turned rectangles', () => {
    expect(rectGap({ x: 0, z: 0, hw: 1, hd: 1, rot: 0 }, { x: 3, z: 0, hw: 1, hd: 1, rot: 0 })).toBeCloseTo(1, 6);
    expect(rectGap({ x: 0, z: 0, hw: 1, hd: 1, rot: 0 }, { x: 1.5, z: 0, hw: 1, hd: 1, rot: 0 })).toBe(0);
    expect(rectGap({ x: 0, z: 0, hw: 1, hd: 1, rot: Math.PI / 4 }, { x: 3, z: 0, hw: 1, hd: 1, rot: 0 })).toBeCloseTo(2 - Math.SQRT2, 6);
  });

  it('a well-spaced office has no problems at all', () => {
    const layout = layoutOf(place('WS_CLUSTER_6', -4.5, 2), place('WS_CLUSTER_6', 2, 2), place('WS_ROW_4', -2, -3.5));
    expect(narrowAisles(layout, ASSET_TYPES)).toEqual([]);
    const problems = checkLayout(layout, { catalog: ASSET_TYPES }).problems.filter((p) => p.severity !== 'info');
    expect(problems.map((p) => p.message)).toEqual([]);
  });

  it('two clusters 0.6 m apart: one warning naming both; pushed together or 1 m apart: none', () => {
    const at = (gap) => layoutOf(place('WS_CLUSTER_6', -3, 2), place('WS_CLUSTER_6', -3 + width6 + gap, 2));
    const narrow = kinds(at(0.6), CHECK_KINDS.AISLE_NARROW);
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toMatchObject({ severity: 'warning', floorId: 0 });
    expect(narrow[0].message).toBe('Only 0.6 m between the 6-person cluster and the 6-person cluster: an aisle needs 0.9 m');
    expect(narrow[0].ids).toHaveLength(24);
    expect(kinds(at(0), CHECK_KINDS.AISLE_NARROW)).toHaveLength(0);
    expect(kinds(at(1), CHECK_KINDS.AISLE_NARROW)).toHaveLength(0);
  });

  it('a cluster 0.5 m from the wall: a warning; against the wall: none', () => {
    const inner = office.x - office.width / 2 + 0.075;
    const near = layoutOf(place('WS_CLUSTER_4', inner + 0.5 + width6 / 3, 0));
    const w = kinds(near, CHECK_KINDS.AISLE_NARROW);
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/and the wall of Open Office: an aisle needs 0\.9 m$/);
    const out = prefabOutline(prefabById('WS_CLUSTER_4'), {}, ASSET_TYPES, { x: 0, z: 0 });
    expect(kinds(layoutOf(place('WS_CLUSTER_4', inner + out.hw, 0)), CHECK_KINDS.AISLE_NARROW)).toHaveLength(0);
  });

  it('the drop hint says it before it is dropped', () => {
    const layout = layoutOf(place('WS_CLUSTER_6', -3, 2));
    const outline = prefabOutline(prefabById('WS_CLUSTER_6'), {}, ASSET_TYPES, { x: -3 + width6 + 0.5, z: 2, rotationY: 0 });
    const hint = dropAisle(outline, layout, 0, ASSET_TYPES);
    expect(hint.text).toBe('Leaves 0.5 m to the 6-person cluster: an aisle needs 0.9 m');
    expect(hint.gap).toBeLessThan(AISLE_MIN);
    expect(dropAisle({ ...outline, x: outline.x + 1 }, layout, 0, ASSET_TYPES)).toBeNull();
  });

  it('the drop hint and Check give the same number for the same spot', () => {
    const first = place('WS_CLUSTER_6', -3, 2);
    const layout = { ...layoutOf(first), floor: 0 };
    const [g] = aisleGroups(first, ASSET_TYPES);
    for (const gap of [0.2, 0.35, 0.6]) {
      const point = { x: g.outline.x + g.outline.hw * 2 + gap, z: g.outline.z };
      const plan = planPrefabDrop(prefabById('WS_CLUSTER_6'), point, layout, { catalog: ASSET_TYPES });
      const placed = place('WS_CLUSTER_6', plan.at.x, plan.at.z);
      const [narrow] = narrowAisles(layoutOf(first, placed), ASSET_TYPES);
      const number = (text) => text.match(/(\d+\.\d) m/)[1];
      expect(number(plan.warning)).toBe(number(narrow.message));
    }
  });
});

describe('a cluster in front of a door (v0.18.0)', () => {
  it('is named once, and Fix it moves the whole cluster clear of it in one go', () => {
    const items = place('WS_CLUSTER_4', 0, -5.6); // the south door is at (0, −7)
    const layout = layoutOf(items);
    const blocked = kinds(layout, CHECK_KINDS.DOOR_BLOCKED);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].message).toBe('The 4-person cluster blocks the door of Open Office');
    expect(blocked[0].ids.sort()).toEqual(items.map((o) => o.id).sort());
    const { fix } = blocked[0];
    expect(fix.label).toBe('Move the 4-person cluster');
    expect(fix.moves.map(([id]) => id).sort()).toEqual(items.map((o) => o.id).sort());
    // every member moves by the same step: the cluster keeps its shape
    const [first] = fix.moves;
    const d = { x: first[1].x - items.find((o) => o.id === first[0]).x, z: first[1].z - items.find((o) => o.id === first[0]).z };
    for (const [id, p] of fix.moves) {
      const o = items.find((i) => i.id === id);
      expect(p.x - o.x).toBeCloseTo(d.x, 2);
      expect(p.z - o.z).toBeCloseTo(d.z, 2);
    }
    const moved = { ...layout, objects: layout.objects.map((o) => ({ ...o, ...(fix.moves.find(([id]) => id === o.id)?.[1] ?? {}) })) };
    expect(kinds(moved, CHECK_KINDS.DOOR_BLOCKED)).toHaveLength(0);
    for (const o of moved.objects) expect(groupOf(o).id).toBe(groupOf(items[0]).id);
  });

  it('one message per cluster: no "Nobody can walk to Workstation Desk" lines, and Fix it clears it', () => {
    const inner = office.depth / 2 - 0.075;
    const hd = (id) => prefabOutline(prefabById(id), {}, ASSET_TYPES, { x: 0, z: 0 }).hd;
    const cases = [
      // 0.5 m from the north wall: the middle seat on that side is more than 1 m from any free floor
      ['WS_CLUSTER_6', inner - 0.5 - hd('WS_CLUSTER_6'), 'The 6-person cluster in Open Office leaves no way to one of its seats: only 0.5 m to the wall', 'Move the 6-person cluster'],
      ['WS_CLUSTER_8', inner - 0.3 - hd('WS_CLUSTER_8'), 'The 8-person cluster in Open Office leaves no way to 2 of its seats: only 0.3 m to the wall', 'Move the 8-person cluster'],
      // 0.6 m from the south wall, in front of its door: nobody gets into the room
      ['WS_CLUSTER_4', -inner + 0.6 + hd('WS_CLUSTER_4'), 'The 4-person cluster blocks the door of Open Office: only 0.6 m to the wall', 'Move the 4-person cluster'],
    ];
    for (const [prefab, z, message, label] of cases) {
      const items = place(prefab, 0, z);
      const layout = layoutOf(items);
      const all = checkLayout(layout, { catalog: ASSET_TYPES }).problems.filter((p) => p.severity !== 'info');
      // one line: the cluster, what it leaves out and why (the aisle is not listed again)
      expect(all.map((p) => p.message)).toEqual([message]);
      expect(all[0]).toMatchObject({ severity: 'error', blocksWalking: true, groupId: groupOf(items[0]).id });
      expect(all[0].fix.label).toBe(label);
      expect(all[0].fix.moves.map(([id]) => id).sort()).toEqual(items.map((o) => o.id).sort());
      const moved = { ...layout, objects: layout.objects.map((o) => ({ ...o, ...(all[0].fix.moves.find(([id]) => id === o.id)?.[1] ?? {}) })) };
      expect(checkLayout(moved, { catalog: ASSET_TYPES }).problems.filter((p) => p.severity !== 'info').map((p) => p.message)).toEqual([]);
    }
  });

  it('a cluster across the door: one line naming it, the room and desks behind it folded in', () => {
    const door = place('WS_CLUSTER_4', 0, -5.6);
    const behind = place('WS_CLUSTER_6', -3, 3);
    const all = checkLayout(layoutOf(door, behind), { catalog: ASSET_TYPES }).problems.filter((p) => p.severity !== 'info');
    expect(all.map((p) => p.message)).toEqual(['The 4-person cluster blocks the door of Open Office']);
    expect(all[0]).toMatchObject({ severity: 'error', blocksWalking: true, groupId: groupOf(door[0]).id });
    expect(all[0].fix.moves.map(([id]) => id).sort()).toEqual(door.map((o) => o.id).sort());
  });

  it('a locked cluster gets no Fix it', () => {
    const items = place('WS_CLUSTER_4', 0, -5.6).map((o, i) => (i === 0 ? { ...o, isLocked: true } : o));
    expect(kinds(layoutOf(items), CHECK_KINDS.DOOR_BLOCKED)[0].fix).toBeUndefined();
  });
});
