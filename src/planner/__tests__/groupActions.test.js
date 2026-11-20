import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';
import { createGroupActions } from '../groupActions';

const S = () => useWorkspaceStore.getState();
const objs = () => Object.values(S().objects);

let editor;
let messages;
let group;

/** A desk with its chair behind it (what plannerTools.carriedWith finds from the meshes). */
const chairOf = (o) => (o.assetType === 'DESK_STANDARD'
  ? objs().filter((c) => c.assetType === 'CHAIR_OFFICE' && c.floor === o.floor && Math.abs(c.x - o.x) < 0.1 && Math.abs(c.z - (o.z - 0.8)) < 0.1)
  : []);

function add(assetType, x, z, extra = {}) {
  editor.addObject({ assetType, x, y: 0, z, rotationY: 0, floor: S().currentFloor, ...extra });
  return objs().at(-1).id;
}

beforeEach(() => {
  S().resetWorkspace();
  editor = createEditorHistory();
  messages = [];
  group = createGroupActions({
    editor, getState: S, carriedWith: chairOf, message: (text, bad) => messages.push({ text, bad: !!bad }),
  });
});

describe('group actions (v0.15.5)', () => {
  it('moves the group with the desks\' chairs in ONE undo step; a locked item stays and says so', () => {
    const a = add('DESK_STANDARD', 0, 0);
    const chair = add('CHAIR_OFFICE', 0, -0.8);
    const b = add('DESK_STANDARD', 4, 0);
    const locked = add('PLANT_LARGE', 8, 0);
    editor.toggleLock(locked);
    S().setObjectSelection([a, b, locked]);
    expect(group.isGroup()).toBe(true);

    group.move(1, 0);
    expect(S().objects[a].x).toBe(1);
    expect(S().objects[chair].x).toBe(1);
    expect(S().objects[b].x).toBe(5);
    expect(S().objects[locked].x).toBe(8);
    expect(messages.at(-1)).toEqual({ text: '1 locked item was not moved', bad: true });

    editor.undo();
    expect([S().objects[a].x, S().objects[chair].x, S().objects[b].x]).toEqual([0, 0, 4]);
  });

  it('deletes the unlocked items in one step; the locked one stays selected', () => {
    const a = add('DESK_STANDARD', 0, 0);
    const b = add('DESK_STANDARD', 4, 0);
    const c = add('DESK_STANDARD', 8, 0);
    editor.toggleLock(c);
    S().setObjectSelection([a, b, c]);
    group.remove();
    expect(objs().map((o) => o.id)).toEqual([c]);
    expect(S().selectedObjectId).toBe(c);
    expect(messages.at(-1).text).toMatch(/Deleted 2 items.*1 locked item was not deleted/);
    editor.undo();
    expect(objs()).toHaveLength(3);
  });

  it('copies a desk with its chair; Ctrl+Shift+V on the floor above pastes at the same x / z, one undo step', () => {
    editor.addFloor({ copyRooms: false });
    S().selectFloor(0);
    const desk = add('DESK_STANDARD', 2, 3, { label: 'Asha\'s desk' });
    add('CHAIR_OFFICE', 2, 2.2);
    S().selectObject(desk);
    group.copy();
    expect(messages.at(-1).text).toBe('Copied Asha\'s desk (and 1 item with it). Ctrl+V to paste.');

    S().selectFloor(1);
    const ids = group.paste({ same: true });
    expect(ids).toHaveLength(2);
    const pasted = ids.map((id) => S().objects[id]);
    expect(pasted.map((o) => [o.assetType, o.floor, o.x, o.z])).toEqual([
      ['DESK_STANDARD', 1, 2, 3], ['CHAIR_OFFICE', 1, 2, 2.2],
    ]);
    expect(ids).not.toContain(desk); // new ids: who sits at the old desk stays there
    expect(S().selectedObjectIds).toEqual(ids);

    editor.undo(); // removes everything pasted
    expect(objs().filter((o) => o.floor === 1)).toHaveLength(0);
  });

  it('Ctrl+V puts the copy\'s middle at the mouse, or 0.5 m further aside each time', () => {
    const a = add('DESK_STANDARD', 0, 0);
    S().selectObject(a);
    group.copy();
    const [first] = group.paste();
    const [second] = group.paste();
    expect([S().objects[first].x, S().objects[first].z]).toEqual([0.5, 0.5]);
    expect([S().objects[second].x, S().objects[second].z]).toEqual([1, 1]);
    const [atMouse] = group.paste({ at: { x: 10, z: -4 } });
    expect([S().objects[atMouse].x, S().objects[atMouse].z]).toEqual([10, -4]);
  });

  it('pastes nothing before a copy', () => {
    expect(group.paste()).toEqual([]);
    expect(messages.at(-1).text).toMatch(/Nothing copied yet/);
  });
});

describe('v0.18.5: a private cabin moves and turns with its room', () => {
  let cabinRoomFor;
  beforeEach(async () => { ({ cabinRoomFor } = await import('../../play/cabinDoor')); });

  async function placeCabin(at = { x: 0, z: 0, rotationY: 0, floor: 0 }) {
    const { prefabPlacement } = await import('../../play/prefabDrop');
    const { prefabById } = await import('../../catalog/manifest');
    const { ASSET_TYPES } = await import('../../utils/assetCatalog');
    editor.addRoom({ type: 'OFFICE', name: 'Open Office', x: 0, z: 0, width: 20, depth: 14, floor: 0 });
    let n = 0;
    const { room, objects } = prefabPlacement(prefabById('WS_CABIN'), {}, ASSET_TYPES, at, Object.values(S().rooms),
      { groupId: 'grp_cab', newId: () => `cab_${++n}`, roomId: 'room_cab' });
    editor.placePrefab({ room, objects, label: 'Add private cabin' });
    return objects.map((o) => o.id);
  }

  it('cabinRoomFor: the cabin room of a selected cabin group, else null', async () => {
    const ids = await placeCabin();
    expect(cabinRoomFor(S().objects, S().rooms, ids)?.id).toBe('room_cab');
    expect(cabinRoomFor(S().objects, S().rooms, ids.slice(1))).toBeNull(); // one item of it (Alt+click)
    const desk = add('DESK_STANDARD', 6, 4);
    expect(cabinRoomFor(S().objects, S().rooms, [desk])).toBeNull();
  });

  it('arrow keys move the cabin room and its furniture together, ONE undo step', async () => {
    const ids = await placeCabin();
    const before = ids.map((id) => ({ ...S().objects[id] }));
    S().setObjectSelection(ids);
    group.move(1, 0);
    expect(S().rooms.room_cab.x).toBeCloseTo(1);
    ids.forEach((id, i) => expect(S().objects[id].x).toBeCloseTo(before[i].x + 1));
    editor.undo();
    expect(S().rooms.room_cab.x).toBeCloseTo(0);
    ids.forEach((id, i) => expect(S().objects[id].x).toBeCloseTo(before[i].x));
  });

  it('R turns the cabin room with its furniture (its door goes round), ONE undo step', async () => {
    const ids = await placeCabin();
    S().setObjectSelection(ids);
    const { width, depth } = S().rooms.room_cab;
    group.turn();
    expect(S().rooms.room_cab).toMatchObject({ width: depth, depth: width });
    expect(S().rooms.room_cab.doors[0].wall).toBe('west');
    for (const id of ids) {
      const o = S().objects[id];
      expect(Math.abs(o.x - S().rooms.room_cab.x)).toBeLessThan(depth / 2);
      expect(Math.abs(o.z - S().rooms.room_cab.z)).toBeLessThan(width / 2);
    }
    editor.undo();
    expect(S().rooms.room_cab).toMatchObject({ width, depth });
  });
});
