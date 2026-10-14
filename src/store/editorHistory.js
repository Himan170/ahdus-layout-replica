/**
 * editorHistory.js
 *
 * The ONE place the editor changes layout data. Every action here goes
 * through the engine's CommandHistory, so Ctrl+Z / Ctrl+Y work for all of
 * them: placing, deleting, duplicating, moving, locking objects; adding,
 * editing, deleting rooms and doors; adding and removing floors.
 *
 * Mesh updates need no special handling: commands change the Zustand store,
 * and WorkplaceEditor's existing sync effects rebuild the Babylon meshes.
 *
 * Usage (inside a component):
 *   const editor = useMemo(() => createEditorHistory(setUndoState), []);
 *   editor.addObject({ assetType: 'DESK_STANDARD', x, z });
 *   editor.undo();
 */

import { useWorkspaceStore } from './workspaceStore';
import {
  STOREY_HEIGHT, floorHeight, floorsInOrder, wallSpace, planWallHeight, planFloorHeight, copyRoomsUp,
} from '../play/building';
import { CommandHistory } from '../engine/commands/CommandHistory';
import {
  AddObjectCommand,
  DeleteObjectCommand,
  TransformCommand,
  AddRoomCommand,
  DeleteRoomCommand,
  UpdateRoomCommand,
} from '../engine/commands/LayoutCommands';

const store = () => useWorkspaceStore.getState();

/**
 * Adapter: implements the engine's LayoutStore interface on top of the
 * Zustand store. Records keep the store's current (v1) field names
 * (floor, isLocked, scaleX...) — the commands only move patches around,
 * so they don't care about the shape.
 */
export const zustandLayoutStore = {
  addObject: (data) => store().addObject(data).id,
  updateObject: (id, patch) => store().updateObject(id, patch),
  removeObject: (id) => store().removeObject(id),
  getObject: (id) => store().objects[id],

  addRoom: (data) => store().addRoom(data).id,
  updateRoom: (id, patch) => store().updateRoom(id, patch),
  removeRoom: (id) => store().removeRoom(id),
  getRoom: (id) => store().rooms[id],

  // Anchor POSITIONS are derived from objects (integration/anchorsFromStore.js);
  // the store only keeps what other modules write on them (store.anchorData),
  // which is changed through setAnchorData below.
  addAnchor: () => {},
  removeAnchor: () => {},
};

/** Fields that describe the record itself, not UI state. */
function withoutUiState(record) {
  if (!record) return record;
  const { isSelected, ...rest } = record;
  return rest;
}

/**
 * Undo/redo for actions that change many records at once (e.g. removing a
 * floor deletes its rooms and objects). Snapshots before and after.
 */
class SnapshotCommand {
  constructor(label, mutate) {
    this.label = label;
    this.mutate = mutate;
    this.before = null;
    this.after = null;
  }
  static capture() {
    const { floors, rooms, objects, currentFloor } = store();
    return { floors, rooms, objects, currentFloor };
  }
  execute() {
    if (!this.after) {
      this.before = SnapshotCommand.capture();
      this.mutate();
      this.after = SnapshotCommand.capture();
    } else {
      store().replaceLayoutState(this.after);
    }
  }
  undo() {
    store().replaceLayoutState(this.before);
  }
}

/** Several commands that undo/redo together as ONE step. */
class CompositeCommand {
  constructor(label, commands) {
    this.label = label;
    this.commands = commands;
  }
  execute() { this.commands.forEach((c) => c.execute()); }
  undo() { [...this.commands].reverse().forEach((c) => c.undo()); }
}

/**
 * Room updates on one or more rooms as ONE step that merges with the next
 * one carrying the same mergeKey on the same rooms (a burst of + / − on a
 * door shared by two rooms is one undo step).
 */
class RoomGroupCommand extends CompositeCommand {
  constructor(label, roomPatches, mergeKey) {
    super(label, roomPatches.map(([roomId, patch]) =>
      new UpdateRoomCommand(zustandLayoutStore, roomId, patch, { mergeKey: mergeKey ? `group:${mergeKey}` : undefined })));
    this.mergeKey = mergeKey;
    this.roomIds = roomPatches.map(([roomId]) => roomId).join('|');
  }
  mergeWith(next) {
    if (!(next instanceof RoomGroupCommand) || !this.mergeKey ||
        next.mergeKey !== this.mergeKey || next.roomIds !== this.roomIds) return false;
    this.commands.forEach((c, i) => c.mergeWith(next.commands[i]));
    this.label = next.label;
    return true;
  }
}

/**
 * A floor's height and the wall heights that go with it, as ONE undo step
 * (raising a room's walls past its floor raises the floor, and the rooms
 * that filled it). `planFn` (building.planWallHeight / planFloorHeight) runs
 * on the first execute. Merges with the next one with the same mergeKey on
 * the same floor (a burst of + / − presses, typing in a field).
 */
class HeightsCommand {
  constructor(label, planFn, mergeKey) {
    this.label = label;
    this.planFn = planFn;
    this.mergeKey = mergeKey;
    this.before = null;
    this.after = null;
  }
  static apply(floorId, { height, rooms }) {
    store().setFloorHeight(floorId, height);
    for (const [id, wallHeight] of rooms) store().updateRoom(id, { wallHeight });
  }
  execute() {
    if (!this.after) {
      const plan = this.planFn();
      this.floorId = plan.floorId;
      this.after = { height: plan.height, rooms: new Map(plan.rooms) };
      this.before = {
        height: floorHeight(store().floors, plan.floorId),
        rooms: new Map(plan.rooms.map(([id]) => [id, store().rooms[id]?.wallHeight])),
      };
    }
    HeightsCommand.apply(this.floorId, this.after);
  }
  undo() {
    HeightsCommand.apply(this.floorId, this.before);
  }
  mergeWith(next) {
    if (!(next instanceof HeightsCommand) || !this.mergeKey ||
        next.mergeKey !== this.mergeKey || next.floorId !== this.floorId) return false;
    for (const [id, h] of next.before.rooms) if (!this.before.rooms.has(id)) this.before.rooms.set(id, h);
    for (const [id, h] of next.after.rooms) this.after.rooms.set(id, h);
    this.after.height = next.after.height;
    this.label = next.label;
    return true;
  }
}

const OPENING_LIST = { door: 'doors', window: 'windows' };

/**
 * Set data on an anchor (e.g. link a workstation to a job position).
 * Commands with the same mergeKey on the same anchor merge into one undo step
 * (typing a position ID letter by letter).
 */
class AnchorDataCommand {
  constructor(anchorId, patch, { label = 'Edit link', mergeKey } = {}) {
    this.anchorId = anchorId;
    this.patch = { ...patch };
    this.label = label;
    this.mergeKey = mergeKey;
    this.before = undefined;
  }
  execute() {
    if (this.before === undefined) this.before = store().anchorData[this.anchorId] ?? null;
    store().setAnchorData(this.anchorId, this.patch);
  }
  undo() {
    // Restore exactly what was there before: clear every key we touched, then put old values back
    const clear = Object.fromEntries(Object.keys(this.patch).map((k) => [k, null]));
    store().setAnchorData(this.anchorId, { ...clear, ...(this.before ?? {}) });
  }
  mergeWith(next) {
    if (!(next instanceof AnchorDataCommand) || !this.mergeKey ||
        next.mergeKey !== this.mergeKey || next.anchorId !== this.anchorId) return false;
    this.patch = { ...this.patch, ...next.patch };
    return true;
  }
}

/**
 * Create the editor's action set with its own undo history.
 * @param {(state: {canUndo: boolean, canRedo: boolean, undoLabel: string|null, redoLabel: string|null}) => void} [onChange]
 */
export function createEditorHistory(onChange) {
  const history = new CommandHistory({
    maxSize: 200,
    onChange: () =>
      onChange?.({
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undoLabel: history.undoLabel,
        redoLabel: history.redoLabel,
      }),
  });
  const s = zustandLayoutStore;
  const run = (cmd) => history.execute(cmd);

  const api = {
    history,

    // ── Objects ──
    addObject(data) {
      run(new AddObjectCommand(s, data));
    },
    deleteObject(id) {
      if (!s.getObject(id)) return;
      run(new DeleteObjectCommand(s, id));
    },
    /**
     * @param {string} id
     * @param {object} patch
     * @param {{label?: string, mergeKey?: string}} [options]
     *   mergeKey: pass e.g. 'inspector' for slider drags/typing so a burst of
     *   edits becomes one undo step. Omit for discrete actions like gizmo drags.
     */
    updateObject(id, patch, options) {
      const obj = s.getObject(id);
      if (!obj) return;
      // Skip no-op updates so they don't create empty undo steps
      const changed = Object.keys(patch).some((k) => obj[k] !== patch[k]);
      if (!changed) return;
      run(new TransformCommand(s, id, patch, options));
    },
    duplicateObject(id) {
      const obj = s.getObject(id);
      if (!obj || obj.isLocked) return;
      // Strip id (a duplicate needs a NEW id) and UI state
      const { id: _oldId, name: _oldName, ...rest } = withoutUiState(obj);
      run(new AddObjectCommand(s, {
        ...rest,
        x: obj.x + 1.0,
        z: obj.z + 1.0,
        label: obj.label ? `${obj.label} (copy)` : '',
      }));
    },
    toggleLock(id) {
      const obj = s.getObject(id);
      if (!obj) return;
      run(new TransformCommand(s, id, { isLocked: !obj.isLocked }, {
        label: obj.isLocked ? 'Unlock object' : 'Lock object',
      }));
    },

    // ── Rooms ──
    addRoom(data) {
      const floor = data.floor ?? store().currentFloor;
      if (!(data.wallHeight > wallSpace(store().floors, floor) + 1e-6)) {
        run(new AddRoomCommand(s, data));
        return;
      }
      // Taller than its floor: the floor grows with it, in the same undo step
      const add = new AddRoomCommand(s, data);
      run(new CompositeCommand(add.label, [add, new HeightsCommand(add.label, () => {
        const room = s.getRoom(store().selectedRoomId);
        return planWallHeight(store().floors, Object.values(store().rooms), room, room.wallHeight);
      })]));
    },
    deleteRoom(id) {
      if (!s.getRoom(id)) return;
      run(new DeleteRoomCommand(s, id));
    },
    updateRoom(id, patch, options) {
      const room = s.getRoom(id);
      if (!room) return;
      if ('wallHeight' in patch) {
        // Wall heights keep the floor fitting (see setWallHeight)
        const { wallHeight, ...rest } = patch;
        if (Object.keys(rest).length) api.updateRoom(id, rest, options);
        api.setWallHeight(id, wallHeight, options);
        return;
      }
      const changed = Object.keys(patch).some((k) => room[k] !== patch[k]);
      if (!changed) return;
      run(new UpdateRoomCommand(s, id, patch, options));
    },

    /**
     * Change the height of a room's walls. Higher than the floor allows raises
     * the floor (and every floor above moves up with it); lower is fine.
     * @param {{label?: string, mergeKey?: string}} [options]  mergeKey: a burst = one undo step
     * @returns {{ problem: string } | { problem: null, raised: boolean, height: number, wallHeight: number }}
     *          the plan (building.planWallHeight); nothing changes on a problem
     */
    setWallHeight(id, wallHeight, { label, mergeKey } = {}) {
      const room = s.getRoom(id);
      if (!room) return { problem: 'This room is gone' };
      const plan = planWallHeight(store().floors, Object.values(store().rooms), room, wallHeight);
      if (plan.problem || plan.rooms.length === 0) return plan;
      run(new HeightsCommand(label ?? `Wall height of ${room.name}`, () => plan, mergeKey));
      return plan;
    },

    /**
     * Change a floor's height (floor-to-floor). Walls that filled the floor
     * follow it; floors above move with it.
     * @returns {{ problem: string } | { problem: null, height: number }}
     */
    setFloorHeight(floorId, height, { label, mergeKey } = {}) {
      if (!store().floors[floorId]) return { problem: 'This floor is gone' };
      const plan = planFloorHeight(store().floors, Object.values(store().rooms), floorId, height);
      if (plan.problem) return plan;
      if (Math.abs(plan.height - floorHeight(store().floors, floorId)) < 1e-6 && plan.rooms.length === 0) return plan;
      run(new HeightsCommand(label ?? `Height of ${store().floors[floorId].name}`, () => plan, mergeKey));
      return plan;
    },
    toggleDoor(roomId, wall) {
      const room = s.getRoom(roomId);
      if (!room) return;
      const doors = room.doors ?? [];
      const has = doors.some((d) => d.wall === wall);
      const next = has
        ? doors.filter((d) => d.wall !== wall)
        : [...doors, { wall, offset: 0, width: 1.2 }];
      run(new UpdateRoomCommand(s, roomId, { doors: next }, {
        label: has ? `Remove ${wall} door` : `Add ${wall} door`,
      }));
    },

    /**
     * Add doors/windows, possibly on several rooms at once (a door between two
     * back-to-back rooms cuts both walls) — one undo step.
     * @param {{roomId:string, kind:'door'|'window', wall:string, offset:number, width?:number, height?:number, sill?:number}[]} list
     */
    addOpenings(list) {
      const byRoom = new Map();
      for (const o of list) {
        const room = s.getRoom(o.roomId);
        if (!room) continue;
        const key = OPENING_LIST[o.kind];
        const current = byRoom.get(o.roomId) ?? { doors: room.doors ?? [], windows: room.windows ?? [] };
        const { roomId: _r, kind: _k, ...opening } = o;
        current[key] = [...current[key], opening];
        byRoom.set(o.roomId, current);
      }
      if (byRoom.size === 0) return;
      const kind = list[0].kind;
      run(new CompositeCommand(`Add ${kind}`, [...byRoom].map(([roomId, patch]) =>
        new UpdateRoomCommand(s, roomId, patch))));
    },

    /** Remove doors/windows by index, possibly on several rooms — one undo step. */
    removeOpenings(list) {
      const byRoom = new Map();
      for (const o of list) {
        const room = s.getRoom(o.roomId);
        if (!room) continue;
        const entry = byRoom.get(o.roomId) ?? { room, remove: { doors: new Set(), windows: new Set() } };
        entry.remove[OPENING_LIST[o.kind]].add(o.index);
        byRoom.set(o.roomId, entry);
      }
      if (byRoom.size === 0) return;
      const kind = list[0].kind;
      run(new CompositeCommand(`Remove ${kind}`, [...byRoom].map(([roomId, { room, remove }]) =>
        new UpdateRoomCommand(s, roomId, {
          doors: (room.doors ?? []).filter((_, i) => !remove.doors.has(i)),
          windows: (room.windows ?? []).filter((_, i) => !remove.windows.has(i)),
        }))));
    },

    /**
     * Change the size (and offset) of doors/windows, possibly in several rooms
     * (a door shared by two back-to-back rooms) — one undo step. Pass the list
     * from geometry.resizeOpening, which checks the limits.
     * @param {{roomId:string, kind:'door'|'window', index:number, patch:{offset?:number,width?:number,height?:number}}[]} list
     * @param {{label?: string, mergeKey?: string}} [options]
     *   mergeKey: a burst of + / − presses (or typing in the Inspector) = one undo step
     */
    resizeOpening(list, { label, mergeKey } = {}) {
      const byRoom = new Map();
      for (const o of list) {
        const room = s.getRoom(o.roomId);
        const key = OPENING_LIST[o.kind];
        if (!room || !(room[key] ?? [])[o.index]) continue;
        const current = byRoom.get(o.roomId) ?? { doors: room.doors ?? [], windows: room.windows ?? [] };
        current[key] = current[key].map((op, i) => (i === o.index ? { ...op, ...o.patch } : op));
        byRoom.set(o.roomId, current);
      }
      const patches = [...byRoom].filter(([roomId, patch]) => {
        const room = s.getRoom(roomId);
        return JSON.stringify(room.doors ?? []) !== JSON.stringify(patch.doors) ||
          JSON.stringify(room.windows ?? []) !== JSON.stringify(patch.windows);
      });
      if (patches.length === 0) return;
      run(new RoomGroupCommand(label ?? `Resize ${list[0].kind}`, patches, mergeKey));
    },

    // ── Anchors (hook points for other modules) ──
    /**
     * @param {string} anchorId
     * @param {{positionRef?: string|null, label?: string|null}} patch  null clears a value
     * @param {{label?: string, mergeKey?: string}} [options]
     */
    setAnchorData(anchorId, patch, options) {
      const current = store().anchorData[anchorId] ?? {};
      const changed = Object.entries(patch).some(([k, v]) => (current[k] ?? null) !== (v || null));
      if (!changed) return;
      run(new AnchorDataCommand(anchorId, patch, options));
    },

    // ── Floors ──
    /**
     * Add a floor on top of the building. Returns its id.
     * @param {{ name?: string, copyRooms?: boolean } | string} [options]
     *   copyRooms: copy the room footprints (types, wall heights, doors,
     *   windows; no furniture, no stairs) of the floor below; the new floor
     *   gets that floor's height. One undo step.
     */
    addFloor(options = {}) {
      const { name, copyRooms = false } = typeof options === 'string' ? { name: options } : options;
      const top = floorsInOrder(store().floors).at(-1) ?? null;
      let newId = null;
      run(new SnapshotCommand(copyRooms ? 'Add floor with rooms' : 'Add floor', () => {
        const st = store();
        const from = copyRooms && top ? top.id : null;
        newId = st.addFloor(name, from === null ? STOREY_HEIGHT : floorHeight(st.floors, from));
        if (from === null) return;
        for (const data of copyRoomsUp(Object.values(st.rooms), from, newId)) store().addRoom(data);
        store().selectRoom(null);
      }));
      return newId;
    },
    removeFloor(floorId) {
      if (Object.keys(store().floors).length <= 1) return;
      run(new SnapshotCommand('Remove floor', () => store().removeFloor(floorId)));
    },
    renameFloor(floorId, newName) {
      run(new SnapshotCommand('Rename floor', () => store().renameFloor(floorId, newName)));
    },

    // ── History ──
    undo: () => history.undo(),
    redo: () => history.redo(),
    clear: () => history.clear(),
  };
  return api;
}
