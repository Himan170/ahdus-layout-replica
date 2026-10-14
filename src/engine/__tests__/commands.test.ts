import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHistory } from '../commands/CommandHistory';
import {
  AddObjectCommand, DeleteObjectCommand, TransformCommand,
  AddRoomCommand, DeleteRoomCommand, UpdateRoomCommand,
  type LayoutStore,
} from '../commands/LayoutCommands';
import type { LayoutObject, Room, Anchor } from '../model/schema';

/** Minimal in-memory store that follows the LayoutStore contract (reuses given IDs). */
function memoryStore(): LayoutStore & { objects: Map<string, LayoutObject>; rooms: Map<string, Room> } {
  let n = 0;
  const objects = new Map<string, LayoutObject>();
  const rooms = new Map<string, Room>();
  const anchors = new Map<string, Anchor>();
  return {
    objects, rooms,
    addObject(o) {
      const id = o.id ?? `obj_${++n}`;
      objects.set(id, {
        floorId: 0, x: 0, y: 0, z: 0, rotationY: 0, scale: { x: 1, y: 1, z: 1 },
        label: '', department: '', locked: false, ...o, id,
      } as LayoutObject);
      return id;
    },
    updateObject(id, patch) { objects.set(id, { ...objects.get(id)!, ...patch }); },
    removeObject(id) { objects.delete(id); },
    getObject(id) { return objects.get(id); },
    addRoom(r) {
      const id = r.id ?? `room_${++n}`;
      rooms.set(id, { floorId: 0, name: '', type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4,
        wallHeight: 3, color: '#fff', floorFinish: 'default', ...r, id } as Room);
      return id;
    },
    updateRoom(id, patch) { rooms.set(id, { ...rooms.get(id)!, ...patch }); },
    removeRoom(id) { rooms.delete(id); },
    getRoom(id) { return rooms.get(id); },
    addAnchor(a) { anchors.set(a.id, a); },
    removeAnchor(id) { anchors.delete(id); },
  };
}

describe('undo / redo commands', () => {
  let store: ReturnType<typeof memoryStore>;
  let history: CommandHistory;
  beforeEach(() => { store = memoryStore(); history = new CommandHistory(); });

  it('add → undo → redo keeps the same object ID', () => {
    history.execute(new AddObjectCommand(store, { assetType: 'DESK_STANDARD', x: 2 }));
    const [id] = store.objects.keys();
    history.undo();
    expect(store.objects.size).toBe(0);
    history.redo();
    expect([...store.objects.keys()]).toEqual([id]);
    expect(store.getObject(id)!.x).toBe(2);
  });

  it('delete → undo restores the object exactly', () => {
    const id = store.addObject({ assetType: 'CHAIR_OFFICE', x: 3, label: 'Chair A' });
    const before = structuredClone(store.getObject(id));
    history.execute(new DeleteObjectCommand(store, id));
    expect(store.getObject(id)).toBeUndefined();
    history.undo();
    expect(store.getObject(id)).toEqual(before);
  });

  it('transform → undo restores only the changed fields', () => {
    const id = store.addObject({ assetType: 'PRINTER', x: 1, z: 1, label: 'P1' });
    history.execute(new TransformCommand(store, id, { x: 5, rotationY: 1 }));
    store.updateObject(id, { label: 'renamed outside history' });
    history.undo();
    expect(store.getObject(id)).toMatchObject({ x: 1, z: 1, rotationY: 0, label: 'renamed outside history' });
  });

  it('room add / update / delete are all undoable', () => {
    history.execute(new AddRoomCommand(store, { type: 'MEETING', width: 5 }));
    const [id] = store.rooms.keys();
    history.execute(new UpdateRoomCommand(store, id, { width: 8 }));
    history.execute(new DeleteRoomCommand(store, id));
    expect(store.getRoom(id)).toBeUndefined();
    history.undo();
    expect(store.getRoom(id)!.width).toBe(8);
    history.undo();
    expect(store.getRoom(id)!.width).toBe(5);
    history.undo();
    expect(store.getRoom(id)).toBeUndefined();
  });

  it('a new edit after undo clears redo', () => {
    history.execute(new AddObjectCommand(store, { assetType: 'A' }));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(new AddObjectCommand(store, { assetType: 'B' }));
    expect(history.canRedo).toBe(false);
  });

  it('history is capped at maxSize', () => {
    history = new CommandHistory({ maxSize: 3 });
    for (let i = 0; i < 5; i++) history.execute(new AddObjectCommand(store, { assetType: `T${i}` }));
    let undone = 0;
    while (history.undo()) undone++;
    expect(undone).toBe(3);
    expect(store.objects.size).toBe(2);
  });
});
