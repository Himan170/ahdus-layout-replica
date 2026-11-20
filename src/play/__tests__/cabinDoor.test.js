// v0.18.5: a cabin's door leads somewhere people can walk. Placed with its door towards a wall, it turns;
// one already standing so gets Check's Fix it (turn it, or move it off the wall), one undo step.
import { describe, expect, it } from 'vitest';
import { prefabById } from '../../catalog/manifest';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { planPrefabDrop, prefabPlacement } from '../prefabDrop';
import { checkLayout, CHECK_KINDS } from '../navigation/checkLayout';
import { groupOf } from '../prefab';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const office = (floor = 0) => ({
  id: `open_${floor}`, type: 'OFFICE', name: 'Open Office', floor, x: 0, z: 0, width: 20, depth: 14, wallHeight: 3.2,
  wallThickness: 0.15, doors: [{ wall: 'west', offset: 0, width: 1, height: 2.1 }], windows: [],
});
const CABIN = prefabById('WS_CABIN');

/** A cabin dropped at `point` (the library's drop: it may turn), as store data. */
function dropCabin(point, floor = 0, at = null) {
  const rooms = [office(floor)];
  const plan = at ? null : planPrefabDrop(CABIN, point, { rooms, objects: [], floor }, { catalog: ASSET_TYPES });
  let n = 0;
  const placed = prefabPlacement(CABIN, {}, ASSET_TYPES, at ?? plan.at, rooms,
    { groupId: 'grp_cab', newId: () => `cab_${++n}`, roomId: 'room_cab', roomRect: plan?.room ?? null });
  return { plan, layout: { rooms: [...rooms, placed.room], objects: placed.objects, floors }, room: placed.room };
}
const errors = (layout) => checkLayout(layout, { catalog: ASSET_TYPES }).problems.filter((p) => p.severity === 'error');

/** A Check fix applied as Studio applies it (editor.turnRoom: the room, the rooms in it, its items). */
function applyFix(layout, fix) {
  const { id, patch, rooms = [], objects = [] } = fix.room;
  const rp = new Map([[id, patch], ...rooms]);
  const op = new Map(objects);
  return {
    ...layout,
    rooms: layout.rooms.map((r) => (rp.has(r.id) ? { ...r, ...rp.get(r.id) } : r)),
    objects: layout.objects.map((o) => (op.has(o.id) ? { ...o, ...op.get(o.id) } : o)),
  };
}

describe('a cabin with its door to a wall (v0.18.5)', () => {
  it('in the open, it stays as before: door in its south wall, towards the east end', () => {
    const { plan, room, layout } = dropCabin({ x: 0, z: 0 });
    expect(plan.at.rotationY).toBe(0);
    expect(room.doors).toEqual([{ wall: 'south', offset: 0.9, width: 0.9, height: 2.1 }]);
    expect(errors(layout)).toEqual([]);
  });

  it('dropped with its door towards the outer wall, it turns so the door faces into the room', () => {
    for (const z of [-4.6, -5.0, -5.35]) {
      const { plan, room, layout } = dropCabin({ x: 6, z });
      expect(plan.problem).toBeNull();
      expect(room.doors).toHaveLength(1);
      expect(room.doors[0].wall).not.toBe('south');
      expect(errors(layout).map((p) => p.message), `z ${z}`).toEqual([]);
      // its desk, chair and visitor chairs turned with it, all inside it
      for (const o of layout.objects) {
        expect(groupOf(o).id).toBe('grp_cab');
        expect(Math.abs(o.x - room.x)).toBeLessThan(room.width / 2);
        expect(Math.abs(o.z - room.z)).toBeLessThan(room.depth / 2);
      }
    }
  });

  it('in an east corner it turns too (its door never to a wall), on an upper floor as well', () => {
    for (const floor of [0, 1]) {
      const { room, layout } = dropCabin({ x: 7.4, z: -4.8 }, floor);
      expect(room.floor).toBe(floor);
      expect(['north', 'west']).toContain(room.doors[0].wall);
      if (floor === 0) expect(errors(layout)).toEqual([]);
    }
  });

  it("Check: one standing with its door to the wall gets Fix it, Turn the cabin, and that clears it", () => {
    const { layout } = dropCabin(null, 0, { x: 6, z: -4.6, rotationY: 0, floor: 0 });
    const lost = errors(layout).find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE);
    expect(lost?.message).toBe('Nobody can walk to Cabin: something blocks the way');
    expect(lost.fix?.label).toMatch(/^(Turn|Move) the cabin$/);
    expect(lost.fix.room.id).toBe('room_cab');
    const fixed = applyFix(layout, lost.fix);
    expect(errors(fixed)).toEqual([]);
    // what is in it went round with it: still inside it
    const room = fixed.rooms.find((r) => r.id === 'room_cab');
    for (const o of fixed.objects) {
      expect(Math.abs(o.x - room.x)).toBeLessThan(room.width / 2);
      expect(Math.abs(o.z - room.z)).toBeLessThan(room.depth / 2);
    }
  });

  it('no Fix it while the cabin or something in it is locked', () => {
    const { layout } = dropCabin(null, 0, { x: 6, z: -4.6, rotationY: 0, floor: 0 });
    const locked = { ...layout, rooms: layout.rooms.map((r) => (r.id === 'room_cab' ? { ...r, isLocked: true } : r)) };
    expect(errors(locked).find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE).fix).toBeUndefined();
    const deskLocked = { ...layout, objects: layout.objects.map((o, i) => (i === 0 ? { ...o, isLocked: true } : o)) };
    expect(errors(deskLocked).find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE).fix).toBeUndefined();
  });

  it('Studio applies the fix as ONE undo step (editor.turnRoom): the cabin and its items, back with Ctrl+Z', () => {
    const { layout } = dropCabin(null, 0, { x: 6, z: -4.6, rotationY: 0, floor: 0 });
    const S = () => useWorkspaceStore.getState();
    S().resetWorkspace();
    const editor = createEditorHistory();
    editor.restoreVersion({ floors, rooms: layout.rooms, objects: layout.objects });
    const lost = errors({ rooms: Object.values(S().rooms), objects: Object.values(S().objects), floors })
      .find((p) => p.kind === CHECK_KINDS.ROOM_UNREACHABLE);
    const before = JSON.stringify({ r: S().rooms.room_cab, o: S().objects });
    expect(editor.turnRoom(lost.fix.room.id, { problem: null, ...lost.fix.room }, { label: lost.fix.label })).toBe(true);
    expect(editor.history.undoLabel).toBe(lost.fix.label);
    expect(errors({ rooms: Object.values(S().rooms), objects: Object.values(S().objects), floors })).toEqual([]);
    editor.undo();
    expect(JSON.stringify({ r: S().rooms.room_cab, o: S().objects })).toBe(before);
  });
});
