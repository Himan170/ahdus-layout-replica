import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import { createEditorHistory } from '../editorHistory';
import { elevationOf } from '../../play/building';

const S = () => useWorkspaceStore.getState();
const objs = () => Object.values(S().objects);
const rooms = () => Object.values(S().rooms);

let editor;
beforeEach(() => {
  S().resetWorkspace();
  editor = createEditorHistory();
});

describe('editor actions are all undoable', () => {
  it('place object → undo → redo (same id, same data)', () => {
    editor.addObject({ assetType: 'DESK_STANDARD', x: 2, y: 0.75, z: 3, rotationY: 1 });
    const placed = objs()[0];
    expect(placed).toMatchObject({ x: 2, y: 0.75, z: 3, rotationY: 1 });

    editor.undo();
    expect(objs()).toHaveLength(0);
    editor.redo();
    expect(objs()).toHaveLength(1);
    expect(objs()[0].id).toBe(placed.id);
  });

  it('delete → undo restores the object exactly, including label and department', () => {
    editor.addObject({ assetType: 'CHAIR_OFFICE', x: 1 });
    const id = objs()[0].id;
    editor.updateObject(id, { label: 'Rahul', department: 'Engineering' });
    editor.deleteObject(id);
    expect(S().objects[id]).toBeUndefined();

    editor.undo();
    expect(S().objects[id]).toMatchObject({ label: 'Rahul', department: 'Engineering', x: 1 });
  });

  it('restoring an old id keeps the id counter ahead (no duplicate ids later)', () => {
    editor.addObject({ assetType: 'A' });
    editor.addObject({ assetType: 'B' });
    const [a] = objs();
    editor.deleteObject(a.id);
    editor.undo();
    editor.addObject({ assetType: 'C' });
    const ids = objs().map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('duplicate gets a NEW id, copies data, and is undoable', () => {
    editor.addObject({ assetType: 'PRINTER', x: 0, z: 0 });
    const src = objs()[0];
    editor.updateObject(src.id, { label: 'P1' });
    editor.duplicateObject(src.id);
    const copy = objs().find((o) => o.id !== src.id);
    expect(copy).toMatchObject({ assetType: 'PRINTER', x: 1, z: 1, label: 'P1 (copy)' });

    editor.undo();
    expect(objs()).toHaveLength(1);
  });

  it('locked objects cannot be duplicated; lock itself is undoable', () => {
    editor.addObject({ assetType: 'DESK_STANDARD' });
    const id = objs()[0].id;
    editor.toggleLock(id);
    expect(S().objects[id].isLocked).toBe(true);
    editor.duplicateObject(id);
    expect(objs()).toHaveLength(1);
    editor.undo();
    expect(S().objects[id].isLocked).toBe(false);
  });

  it('gizmo drag (no mergeKey) = one undo step per drag', () => {
    editor.addObject({ assetType: 'DESK_STANDARD', x: 0 });
    const id = objs()[0].id;
    editor.updateObject(id, { x: 1 });
    editor.updateObject(id, { x: 2 });
    editor.undo();
    expect(S().objects[id].x).toBe(1);
  });

  it('inspector slider burst (same mergeKey) = ONE undo step', () => {
    editor.addObject({ assetType: 'DESK_STANDARD', x: 0, z: 0 });
    const id = objs()[0].id;
    for (let x = 0.1; x <= 3; x += 0.1) editor.updateObject(id, { x }, { mergeKey: 'inspector' });
    editor.updateObject(id, { z: 5 }, { mergeKey: 'inspector' });
    editor.undo();
    expect(S().objects[id]).toMatchObject({ x: 0, z: 0 });
  });

  it('edits separated by a pause are separate undo steps', () => {
    vi.useFakeTimers();
    try {
      editor = createEditorHistory();
      editor.addObject({ assetType: 'DESK_STANDARD', x: 0 });
      const id = objs()[0].id;
      editor.updateObject(id, { x: 1 }, { mergeKey: 'inspector' });
      vi.advanceTimersByTime(2000);
      editor.updateObject(id, { x: 2 }, { mergeKey: 'inspector' });
      editor.undo();
      expect(S().objects[id].x).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('a burst of + / − is one undo step, however slow the PC', () => {
    let clock;
    const press = (ms) => { clock += ms; };
    const wall = (id) => S().rooms[id].wallHeight;
    beforeEach(() => {
      clock = 1_000_000;
      editor = createEditorHistory(undefined, { now: () => clock });
      editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4 });
      editor.addRoom({ type: 'MEETING', x: 10, z: 0, width: 4, depth: 4 });
    });
    const plus = (id) => editor.setWallHeight(id, Math.round((wall(id) + 0.1) * 10) / 10, { mergeKey: 'play-wall-height' });

    it('presses 1.5 s apart (a slow PC) still merge; one Ctrl+Z undoes all 8', () => {
      const [a] = rooms().map((r) => r.id);
      for (let i = 0; i < 8; i++) { press(1500); plus(a); }
      expect(wall(a)).toBeCloseTo(4.0);
      expect(S().floors[0].height).toBeCloseTo(4.3);
      editor.undo();
      expect(wall(a)).toBeCloseTo(3.2);
      expect(S().floors[0].height).toBeCloseTo(3.5);
      editor.undo();                                       // the next step is the room before it
      expect(rooms()).toHaveLength(1);
    });

    it('another command in between splits the burst', () => {
      const [a] = rooms().map((r) => r.id);
      press(100); plus(a); press(100); plus(a);
      press(100); editor.addObject({ assetType: 'CHAIR_OFFICE' });
      press(100); plus(a); press(100); plus(a);
      editor.undo();
      expect(wall(a)).toBeCloseTo(3.4);                    // only the last two presses
      editor.undo();
      expect(objs()).toHaveLength(0);
      editor.undo();
      expect(wall(a)).toBeCloseTo(3.2);
    });

    it('a 2 s pause, the mouse released (endBurst) or another room ends the burst', () => {
      const [a, b] = rooms().map((r) => r.id);
      press(100); plus(a); press(2000); plus(a);           // 2 s without a press
      editor.undo();
      expect(wall(a)).toBeCloseTo(3.3);

      press(100); plus(a); editor.endBurst(); press(100); plus(a);
      editor.undo();
      expect(wall(a)).toBeCloseTo(3.4);

      // same key, other room (lower walls: only that room changes)
      const minus = (id) => editor.setWallHeight(id, Math.round((wall(id) - 0.1) * 10) / 10, { mergeKey: 'play-wall-height' });
      const [a0, b0] = [wall(a), wall(b)];
      press(100); minus(a); press(100); minus(b);
      editor.undo();
      expect(wall(b)).toBeCloseTo(b0);
      expect(wall(a)).toBeCloseTo(a0 - 0.1);
    });
  });

  it('no-op updates do not create undo steps', () => {
    editor.addObject({ assetType: 'DESK_STANDARD', x: 4 });
    const id = objs()[0].id;
    editor.updateObject(id, { x: 4 });
    expect(editor.history.undoLabel).toMatch(/^Add/);
  });

  it('rooms: add, typing in fields (merged), door toggle, delete are all undoable', () => {
    editor.addRoom({ type: 'MEETING', x: 0, z: 0 });
    const id = rooms()[0].id;
    editor.updateRoom(id, { name: 'B' }, { mergeKey: 'room-fields' });
    editor.updateRoom(id, { name: 'Bo' }, { mergeKey: 'room-fields' });
    editor.updateRoom(id, { name: 'Board' }, { mergeKey: 'room-fields' });
    editor.toggleDoor(id, 'north');
    editor.deleteRoom(id);

    editor.undo(); // delete
    expect(S().rooms[id]).toMatchObject({ name: 'Board', type: 'MEETING' });
    expect(S().rooms[id].doors).toHaveLength(1);
    editor.undo(); // door
    expect(S().rooms[id].doors).toHaveLength(0);
    editor.undo(); // all the typing at once
    expect(S().rooms[id].name).toMatch(/^Meeting Room/);
    editor.undo(); // add
    expect(rooms()).toHaveLength(0);
  });

  it('removing a floor (and everything on it) is undoable', () => {
    editor.addFloor();
    S().selectFloor(1);
    editor.addRoom({ type: 'OFFICE' });
    editor.addObject({ assetType: 'DESK_STANDARD' });
    expect(rooms()[0].floor).toBe(1);

    editor.removeFloor(1);
    expect(S().floors[1]).toBeUndefined();
    expect(rooms()).toHaveLength(0);

    editor.undo();
    expect(S().floors[1]).toBeDefined();
    expect(rooms()).toHaveLength(1);
    expect(objs()).toHaveLength(1);
  });

  it('the ground floor cannot be removed, but upper floors still can', () => {
    editor.addFloor();
    expect(Object.keys(S().floors)).toHaveLength(2);
    editor.removeFloor(0);
    expect(S().floors[0]).toBeDefined();

    editor.addRoom({ type: 'OFFICE', floor: 1 });
    editor.addObject({ assetType: 'DESK_STANDARD', floor: 1 });
    editor.removeFloor(1);
    expect(S().floors[1]).toBeUndefined();
    expect(rooms()).toHaveLength(0);
    expect(objs()).toHaveLength(0);
  });

  it('removeFloor refuses the lowest floor (the ground floor), even with floors above', () => {
    editor.addFloor();
    S().selectFloor(1);
    editor.addRoom({ type: 'OFFICE' });
    const undoBefore = editor.history.undoLabel;

    expect(editor.removeFloor(0).problem).toMatch(/ground floor can't be deleted/);
    expect(S().floors[0]).toBeDefined();
    expect(rooms()[0].floor).toBe(1);
    expect(elevationOf(S().floors, 1)).toBeCloseTo(3.5);   // the room upstairs stays up
    expect(editor.history.undoLabel).toBe(undoBefore);     // no empty undo step

    S().removeFloor(0);                                    // the store refuses too
    expect(S().floors[0]).toBeDefined();
    expect(editor.removeFloor(1).problem).toBeNull();      // other floors still go
    expect(S().floors[1]).toBeUndefined();
    expect(S().currentFloor).toBe(0);
  });

  it('reports canUndo / canRedo / labels to the toolbar', () => {
    const states = [];
    editor = createEditorHistory((st) => states.push(st));
    editor.addRoom({ type: 'OFFICE' });
    expect(states.at(-1)).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Add OFFICE' });
    editor.undo();
    expect(states.at(-1)).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Add OFFICE' });
  });

  it('a door through two back-to-back rooms is added and undone as one step', () => {
    editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 6, depth: 4 });
    editor.addRoom({ type: 'MEETING', x: 5.15, z: 0, width: 4, depth: 4 });
    const [a, b] = rooms();
    editor.addOpenings([
      { roomId: a.id, kind: 'door', wall: 'east', offset: 0.5, width: 1 },
      { roomId: b.id, kind: 'door', wall: 'west', offset: 0.5, width: 1 },
    ]);
    expect(S().rooms[a.id].doors).toHaveLength(1);
    expect(S().rooms[b.id].doors).toHaveLength(1);
    expect(S().rooms[a.id].doors[0]).toEqual({ wall: 'east', offset: 0.5, width: 1 });

    editor.undo();
    expect(S().rooms[a.id].doors).toHaveLength(0);
    expect(S().rooms[b.id].doors).toHaveLength(0);
  });

  it('windows are added and removed by index', () => {
    editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 6, depth: 4 });
    const id = rooms()[0].id;
    editor.addOpenings([{ roomId: id, kind: 'window', wall: 'north', offset: -1.5 }]);
    editor.addOpenings([{ roomId: id, kind: 'window', wall: 'north', offset: 1.5 }]);
    editor.removeOpenings([{ roomId: id, kind: 'window', index: 0 }]);
    expect(S().rooms[id].windows).toEqual([{ wall: 'north', offset: 1.5 }]);
    editor.undo();
    expect(S().rooms[id].windows).toHaveLength(2);
  });
});

describe('door / window size', () => {
  const twoRooms = () => {
    editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 6, depth: 4, floor: 1 });
    editor.addRoom({ type: 'OFFICE', x: 0, z: 4.15, width: 6, depth: 4, floor: 1 });
    const [a, b] = rooms();
    editor.addOpenings([
      { roomId: a.id, kind: 'door', wall: 'north', offset: 0, width: 1, height: 2.1 },
      { roomId: b.id, kind: 'door', wall: 'south', offset: 0, width: 1, height: 2.1 },
    ]);
    return [a.id, b.id];
  };
  const resize = (a, b, width, opts) => editor.resizeOpening([
    { roomId: a, kind: 'door', index: 0, patch: { offset: 0, width, height: 2.1 } },
    { roomId: b, kind: 'door', index: 0, patch: { offset: 0, width, height: 2.1 } },
  ], opts);

  it('resizes a shared door in both rooms (upper floor) and undoes in one step', () => {
    const [a, b] = twoRooms();
    resize(a, b, 1.3);
    expect(S().rooms[a].doors[0].width).toBe(1.3);
    expect(S().rooms[b].doors[0].width).toBe(1.3);
    expect(S().rooms[a].floor).toBe(1);
    editor.undo();
    expect(S().rooms[a].doors[0].width).toBe(1);
    expect(S().rooms[b].doors[0].width).toBe(1);
    editor.redo();
    expect(S().rooms[b].doors[0].width).toBe(1.3);
  });

  it('a burst of + presses with one mergeKey is one undo step', () => {
    const [a, b] = twoRooms();
    resize(a, b, 1.1, { mergeKey: 'play-opening' });
    resize(a, b, 1.2, { mergeKey: 'play-opening' });
    resize(a, b, 1.3, { mergeKey: 'play-opening' });
    expect(S().rooms[a].doors[0].width).toBe(1.3);
    editor.undo();
    expect(S().rooms[a].doors[0].width).toBe(1);
    expect(S().rooms[b].doors[0].width).toBe(1);
    expect(editor.history.canUndo).toBe(true); // the door itself is still there to undo
  });

  it('without a mergeKey (a handle drag) each change is its own step', () => {
    const [a, b] = twoRooms();
    resize(a, b, 1.1);
    resize(a, b, 1.2);
    editor.undo();
    expect(S().rooms[a].doors[0].width).toBe(1.1);
  });

  it('ignores a change to a door that is gone, and no-op changes', () => {
    const [a] = twoRooms();
    const before = editor.history.undoLabel;
    editor.resizeOpening([{ roomId: a, kind: 'door', index: 5, patch: { width: 2 } }]);
    editor.resizeOpening([{ roomId: a, kind: 'door', index: 0, patch: { width: 1 } }]);
    expect(editor.history.undoLabel).toBe(before);
  });
});

describe('floor and wall heights (one undo step each)', () => {
  const elev = (id) => elevationOf(S().floors, id);

  it('raising a room past its floor raises the floor and every floor above; undo puts it all back', () => {
    editor.addRoom({ type: 'OFFICE', name: 'Office', x: 0, z: 0, width: 6, depth: 4, floor: 0 });
    editor.addRoom({ type: 'MEETING', name: 'Meeting', x: 6.15, z: 0, width: 6, depth: 4, floor: 0 });
    editor.addFloor();
    editor.addFloor();
    const [office, meeting] = rooms();
    expect(office.wallHeight).toBeCloseTo(3.2);           // new rooms fill their floor
    expect(elev(2)).toBeCloseTo(7);

    const plan = editor.setWallHeight(office.id, 4);
    expect(plan).toMatchObject({ problem: null, raised: true });
    expect(S().floors[0].height).toBeCloseTo(4.3);
    expect(elev(1)).toBeCloseTo(4.3);
    expect(elev(2)).toBeCloseTo(7.8);
    expect(S().rooms[meeting.id].wallHeight).toBeCloseTo(4);  // it filled the floor, so it grows too

    editor.undo();
    expect(S().floors[0].height).toBeCloseTo(3.5);
    expect(S().rooms[office.id].wallHeight).toBeCloseTo(3.2);
    expect(S().rooms[meeting.id].wallHeight).toBeCloseTo(3.2);
    editor.redo();
    expect(elev(1)).toBeCloseTo(4.3);
  });

  it('lowering is allowed and leaves the floor alone; a burst of + / − is one undo step', () => {
    editor.addRoom({ type: 'OFFICE', floor: 0 });
    const id = rooms()[0].id;
    for (const h of [3.3, 3.4, 3.5]) editor.setWallHeight(id, h, { mergeKey: 'burst' });
    expect(S().floors[0].height).toBeCloseTo(3.8);
    editor.setWallHeight(id, 2.8, { mergeKey: 'burst' });
    expect(S().rooms[id].wallHeight).toBeCloseTo(2.8);
    expect(S().floors[0].height).toBeCloseTo(3.8);
    editor.undo();
    expect(S().rooms[id].wallHeight).toBeCloseTo(3.2);
    expect(S().floors[0].height).toBeCloseTo(3.5);
  });

  it('wallHeight through updateRoom (the Inspector) follows the same rules', () => {
    editor.addRoom({ type: 'OFFICE', floor: 0 });
    const id = rooms()[0].id;
    editor.updateRoom(id, { wallHeight: 5 });
    expect(S().floors[0].height).toBeCloseTo(5.3);
  });

  it('adding a room taller than its floor raises the floor in the same step', () => {
    editor.addFloor();
    editor.addRoom({ type: 'OFFICE', floor: 0, wallHeight: 4 });
    expect(elevationOf(S().floors, 1)).toBeCloseTo(4.3);
    editor.undo();
    expect(rooms()).toHaveLength(0);
    expect(S().floors[0].height).toBeCloseTo(3.5);
  });

  it('a floor height change moves the floors above; walls that filled it follow', () => {
    editor.addRoom({ type: 'OFFICE', floor: 0 });
    editor.addFloor();
    const id = rooms()[0].id;
    expect(editor.setFloorHeight(0, 4.0).problem).toBeNull();
    expect(elevationOf(S().floors, 1)).toBeCloseTo(4.0);
    expect(S().rooms[id].wallHeight).toBeCloseTo(3.7);
    expect(editor.setFloorHeight(0, 1).problem).toMatch(/Floors are/);
    editor.undo();
    expect(elevationOf(S().floors, 1)).toBeCloseTo(3.5);
  });

  it('"Copy rooms from below": same footprints, doors and windows; no furniture or stairs; one undo step', () => {
    editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 8, depth: 6, floor: 0 });
    const ground = rooms()[0].id;
    editor.addOpenings([{ roomId: ground, kind: 'door', wall: 'south', offset: 0, width: 1, height: 2.1 }]);
    editor.addObject({ assetType: 'STAIRCASE', x: 2, z: 0, floor: 0 });
    editor.addObject({ assetType: 'DESK_STANDARD', x: -2, z: 0, floor: 0 });
    editor.setWallHeight(ground, 4);

    const id = editor.addFloor({ copyRooms: true });
    expect(id).toBe(1);
    const copies = rooms().filter((r) => r.floor === 1);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ x: 0, z: 0, width: 8, depth: 6, type: 'OFFICE', wallHeight: 4 });
    expect(copies[0].doors).toHaveLength(1);
    expect(S().floors[1].height).toBeCloseTo(4.3);         // same height as the floor below
    expect(objs().filter((o) => o.floor === 1)).toHaveLength(0);

    editor.undo();
    expect(S().floors[1]).toBeUndefined();
    expect(rooms()).toHaveLength(1);
  });

  it('"Empty floor" adds a standard 3.5 m floor', () => {
    editor.addRoom({ type: 'OFFICE', floor: 0 });
    editor.addFloor({ copyRooms: false });
    expect(S().floors[1].height).toBe(3.5);
    expect(rooms()).toHaveLength(1);
  });

  it('R8: applyProposedLayout adds rooms and items and is fully undoable with Ctrl+Z', () => {
    editor.addRoom({ type: 'OFFICE', name: 'Initial Office', floor: 0 });
    expect(rooms()).toHaveLength(1);

    const proposed = {
      schemaVersion: 2,
      units: 'meters',
      building: { name: 'HQ' },
      floors: [{ id: '0', name: 'Ground Floor', height: 3.5 }],
      rooms: [
        {
          id: 'ai_room_1',
          floorId: '0',
          name: 'AI Detected Room',
          type: 'MEETING',
          color: '#34d399',
          x: 10,
          z: 10,
          width: 5,
          depth: 5,
          wallHeight: 3,
          floorFinish: 'carpet',
        },
      ],
      openings: [],
      objects: [
        {
          id: 'ai_obj_1',
          assetType: 'DESK_STANDARD',
          floorId: '0',
          position: { x: 12, y: 0, z: 12 },
          rotationY: 0,
          scale: { x: 1, y: 1, z: 1 },
          locked: false,
          label: 'AI Desk',
        },
      ],
      anchors: [],
      routes: [],
      floorLinks: [],
    };

    editor.applyProposedLayout(proposed);

    expect(rooms()).toHaveLength(2);
    expect(rooms().some((r) => r.name === 'AI Detected Room')).toBe(true);
    expect(objs().some((o) => o.assetType === 'DESK_STANDARD')).toBe(true);

    // Ctrl+Z / Undo restores prior state
    editor.undo();
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0].name).toBe('Initial Office');
    expect(objs()).toHaveLength(0);

    // Redo restores the AI additions
    editor.redo();
    expect(rooms()).toHaveLength(2);
    expect(objs()).toHaveLength(1);
  });

  it('Task R4: restoreVersion restores an old snapshot and keeps undo history intact', () => {
    editor.addRoom({ type: 'OFFICE', name: 'Original Room', x: 0, z: 0, width: 4, depth: 4 });
    const snap1 = useWorkspaceStore.getState().exportWorkspace();

    editor.addRoom({ type: 'MEETING', name: 'Meeting Room', x: 10, z: 0, width: 6, depth: 4 });
    editor.addObject({ assetType: 'DESK_STANDARD', x: 2, z: 2 });
    expect(rooms()).toHaveLength(2);
    expect(objs()).toHaveLength(1);

    // Restore snap1
    editor.restoreVersion(snap1);
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0].name).toBe('Original Room');
    expect(objs()).toHaveLength(0);

    // Undo undoes the restore
    editor.undo();
    expect(rooms()).toHaveLength(2);
    expect(objs()).toHaveLength(1);

    // Another undo undoes the desk addition (prior history intact)
    editor.undo();
    expect(rooms()).toHaveLength(2);
    expect(objs()).toHaveLength(0);

    // Redo brings desk back, redo again re-applies restore
    editor.redo();
    expect(objs()).toHaveLength(1);
    editor.redo();
    expect(rooms()).toHaveLength(1);
    expect(objs()).toHaveLength(0);
  });
});

