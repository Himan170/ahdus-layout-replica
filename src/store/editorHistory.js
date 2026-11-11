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
  STOREY_HEIGHT, floorHeight, floorsInOrder, wallSpace, planWallHeight, planFloorHeight, copyRoomsUp, isGroundFloor,
  GROUND_FLOOR_STAYS, stairPatch,
} from '../play/building';
import { toV1 } from '../engine/model/toV1';
import { normaliseLayout } from './layoutData';
import { CommandHistory } from '../engine/commands/CommandHistory';
import {
  AddObjectCommand,
  DeleteObjectCommand,
  TransformCommand,
  AddRoomCommand,
  DeleteRoomCommand,
  UpdateRoomCommand,
} from '../engine/commands/LayoutCommands';

/**
 * Adapter: implements the engine's LayoutStore interface on top of a
 * workspace store (the app's, or a LayoutEngine's own). Records keep the
 * store's current (v1) field names (floor, isLocked, scaleX...) — the
 * commands only move patches around, so they don't care about the shape.
 */
export function layoutStoreFor(workspace) {
  const store = () => workspace.getState();
  return {
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
}

/** The adapter on the app's store. */
export const zustandLayoutStore = layoutStoreFor(useWorkspaceStore);

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
  constructor(label, mutate, store) {
    this.label = label;
    this.mutate = mutate;
    this.store = store;
    this.before = null;
    this.after = null;
  }
  capture() {
    const { floors, rooms, objects, currentFloor, anchorData, ignoredChecks } = this.store();
    return { floors, rooms, objects, currentFloor, anchorData, ignoredChecks };
  }
  execute() {
    if (!this.after) {
      this.before = this.capture();
      this.mutate();
      this.after = this.capture();
    } else {
      this.store().replaceLayoutState(this.after);
    }
  }
  undo() {
    this.store().replaceLayoutState(this.before);
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
  constructor(label, roomPatches, mergeKey, layoutStore) {
    super(label, roomPatches.map(([roomId, patch]) =>
      new UpdateRoomCommand(layoutStore, roomId, patch, { mergeKey: mergeKey ? `group:${mergeKey}` : undefined })));
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
 * Item and room patches as ONE step that merges with the next one carrying the
 * same mergeKey on the same records (typing a desk's X moves it and its chair:
 * one undo step per burst). v0.15.1.
 */
class PatchGroupCommand extends CompositeCommand {
  constructor(label, commands, ids, mergeKey) {
    super(label, commands);
    this.mergeKey = mergeKey;
    this.ids = ids.join('|');
  }
  mergeWith(next) {
    if (!(next instanceof PatchGroupCommand) || !this.mergeKey ||
        next.mergeKey !== this.mergeKey || next.ids !== this.ids) return false;
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
 * the same target (a burst of + / − presses on one room, typing in a field).
 */
class HeightsCommand {
  constructor(label, planFn, mergeKey, target, store) {
    this.label = label;
    this.planFn = planFn;
    this.store = store;
    this.mergeKey = mergeKey;
    this.target = target; // 'room:<id>' or 'floor:<id>'
    this.before = null;
    this.after = null;
  }
  apply(floorId, { height, rooms }) {
    this.store().setFloorHeight(floorId, height);
    for (const [id, wallHeight] of rooms) this.store().updateRoom(id, { wallHeight });
  }
  execute() {
    if (!this.after) {
      const plan = this.planFn();
      this.floorId = plan.floorId;
      this.after = { height: plan.height, rooms: new Map(plan.rooms) };
      this.before = {
        height: floorHeight(this.store().floors, plan.floorId),
        rooms: new Map(plan.rooms.map(([id]) => [id, this.store().rooms[id]?.wallHeight])),
      };
    }
    this.apply(this.floorId, this.after);
  }
  undo() {
    this.apply(this.floorId, this.before);
  }
  mergeWith(next) {
    if (!(next instanceof HeightsCommand) || !this.mergeKey || next.mergeKey !== this.mergeKey ||
        next.target !== this.target || next.floorId !== this.floorId) return false;
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
  constructor(anchorId, patch, { label = 'Edit link', mergeKey } = {}, store) {
    this.store = store;
    this.anchorId = anchorId;
    this.patch = { ...patch };
    this.label = label;
    this.mergeKey = mergeKey;
    this.before = undefined;
  }
  execute() {
    if (this.before === undefined) this.before = this.store().anchorData[this.anchorId] ?? null;
    this.store().setAnchorData(this.anchorId, this.patch);
  }
  undo() {
    // Restore exactly what was there before: clear every key we touched, then put old values back
    const clear = Object.fromEntries(Object.keys(this.patch).map((k) => [k, null]));
    this.store().setAnchorData(this.anchorId, { ...clear, ...(this.before ?? {}) });
  }
  mergeWith(next) {
    if (!(next instanceof AnchorDataCommand) || !this.mergeKey ||
        next.mergeKey !== this.mergeKey || next.anchorId !== this.anchorId) return false;
    this.patch = { ...this.patch, ...next.patch };
    return true;
  }
}

/** "Ignore" / "Show again" on a problem of Check my layout: the list of ignored keys, before and after. */
class IgnoredChecksCommand {
  constructor(keys, { label = 'Ignore problem' } = {}, store) {
    this.store = store;
    this.after = [...keys];
    this.label = label;
    this.before = undefined;
  }
  execute() {
    if (this.before === undefined) this.before = [...(this.store().ignoredChecks ?? [])];
    this.store().setIgnoredChecks(this.after);
  }
  undo() {
    this.store().setIgnoredChecks(this.before ?? []);
  }
}

/**
 * When the input behind the current change happened: the time stamp of the
 * event being handled (a key press, a mouse move), else now. On a slow PC a
 * key press can be handled long after it was made (the rebuild of the last
 * one takes a while), so a burst of presses is measured from the presses.
 */
export function inputTime() {
  const e = typeof window !== 'undefined' ? window.event : undefined;
  if (e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 && typeof performance !== 'undefined') {
    return performance.timeOrigin + e.timeStamp;
  }
  return Date.now();
}

/**
 * Create the editor's action set with its own undo history.
 * @param {(state: {canUndo: boolean, canRedo: boolean, undoLabel: string|null, redoLabel: string|null}) => void} [onChange]
 * @param {{ now?: () => number, workspace?: object }} [options]  now: input clock (tests pass a fake one);
 *   workspace: the store to edit (default the app's; a LayoutEngine passes its own)
 */
export function createEditorHistory(onChange, { now = inputTime, workspace = useWorkspaceStore } = {}) {
  const store = () => workspace.getState();
  const history = new CommandHistory({
    maxSize: 200,
    now,
    onChange: () =>
      onChange?.({
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undoLabel: history.undoLabel,
        redoLabel: history.redoLabel,
      }),
  });
  const s = workspace === useWorkspaceStore ? zustandLayoutStore : layoutStoreFor(workspace);
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
      // Stairs keep their size, stand on their floor and stay level (what you walk on is what you see)
      const allowed = obj.assetType === 'STAIRCASE' ? stairPatch(patch) : patch;
      // Skip no-op updates so they don't create empty undo steps
      const changed = Object.keys(allowed).some((k) => obj[k] !== allowed[k]);
      if (!changed) return;
      run(new TransformCommand(s, id, allowed, options));
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
    /**
     * Move several items as ONE undo step: an item dragged in Studio with what
     * stands on it (the monitor and keyboard on a desk). Locked items stay.
     * @param {[string, object][]} moves  [objectId, patch]
     * @param {{label?: string, mergeKey?: string}} [options]  mergeKey: a burst on the same items (typing) = one step
     */
    moveObjects(moves, { label = 'Move items', mergeKey } = {}) {
      const cmds = [];
      const ids = [];
      for (const [id, patch] of moves) {
        const obj = s.getObject(id);
        if (!obj || obj.isLocked) continue;
        const allowed = obj.assetType === 'STAIRCASE' ? stairPatch(patch) : patch;
        if (!Object.keys(allowed).some((k) => obj[k] !== allowed[k])) continue;
        cmds.push(new TransformCommand(s, id, allowed, { label, mergeKey: mergeKey ? `group:${mergeKey}` : undefined }));
        ids.push(id);
      }
      if (cmds.length === 0) return;
      if (mergeKey) run(new PatchGroupCommand(label, cmds, ids, mergeKey));
      else run(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds));
    },
    /**
     * Remove some items and add others as ONE undo step: a door or window cut
     * into a free-standing wall (geometry.planWallSegmentOpening) is the wall
     * replaced by its pieces plus the door.
     * @param {string[]} removeIds
     * @param {object[]} addList  object data, as for addObject
     * @param {{label?: string}} [options]
     */
    replaceObjects(removeIds, addList, { label = 'Change items' } = {}) {
      const removes = removeIds.filter((id) => s.getObject(id)).map((id) => new DeleteObjectCommand(s, id));
      const adds = addList.map((data) => new AddObjectCommand(s, data));
      if (removes.length + adds.length === 0) return;
      const cmd = new CompositeCommand(label, [...removes, ...adds]);
      run(cmd);
    },
    /**
     * Lock or unlock several items as ONE undo step (v0.15.5: a group's "Lock all" / L).
     * @param {string[]} ids
     * @param {boolean} locked
     */
    lockObjects(ids, locked) {
      const cmds = ids.map((id) => s.getObject(id)).filter((o) => o && !!o.isLocked !== locked)
        .map((o) => new TransformCommand(s, o.id, { isLocked: locked }, { label: locked ? 'Lock items' : 'Unlock items' }));
      if (cmds.length === 0) return;
      run(cmds.length === 1 ? cmds[0] : new CompositeCommand(locked ? 'Lock items' : 'Unlock items', cmds));
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
      }, undefined, undefined, store)]));
    },
    deleteRoom(id) {
      if (!s.getRoom(id)) return;
      run(new DeleteRoomCommand(s, id));
    },
    /**
     * Move a room with what is in it as ONE undo step (v0.15.1): `plan` is
     * geometry.planRoomMove's (rect, rooms inside it, items in it, locked ones too).
     * @param {string} id
     * @param {{ rect: object, blocker: object|null, rooms?: [string, object][], objects?: [string, object][] }} plan
     * @param {{ label?: string, mergeKey?: string }} [options]  mergeKey: typing X / Z = one step per burst
     * @returns {boolean} whether it moved
     */
    moveRoom(id, plan, { label, mergeKey } = {}) {
      const room = s.getRoom(id);
      if (!room || !plan || plan.blocker) return false;
      if (Math.abs(plan.rect.x - room.x) < 1e-6 && Math.abs(plan.rect.z - room.z) < 1e-6) return false;
      const text = label ?? `Move ${room.name ?? 'room'}`;
      const sub = { label: text, mergeKey: mergeKey ? `group:${mergeKey}` : undefined };
      const cmds = [new UpdateRoomCommand(s, id, { x: plan.rect.x, z: plan.rect.z }, sub)];
      const ids = [`room:${id}`];
      for (const [roomId, patch] of plan.rooms ?? []) {
        if (!s.getRoom(roomId)) continue;
        cmds.push(new UpdateRoomCommand(s, roomId, patch, sub));
        ids.push(`room:${roomId}`);
      }
      for (const [objectId, patch] of plan.objects ?? []) {
        const obj = s.getObject(objectId);
        if (!obj) continue;
        const allowed = obj.assetType === 'STAIRCASE' ? stairPatch(patch) : patch;
        cmds.push(new TransformCommand(s, objectId, allowed, sub));
        ids.push(objectId);
      }
      if (mergeKey) run(new PatchGroupCommand(text, cmds, ids, mergeKey));
      else run(cmds.length === 1 ? cmds[0] : new CompositeCommand(text, cmds));
      return true;
    },
    /**
     * Turn a room with what is in it as ONE undo step (v0.15.2): `plan` is geometry.planRoomTurn's
     * (the room's patch, the rooms inside it, the items in it).
     * @param {string} id
     * @param {{ problem: string|null, patch?: object, rooms?: [string, object][], objects?: [string, object][] }} plan
     * @param {{ label?: string }} [options]
     * @returns {boolean} whether it turned
     */
    turnRoom(id, plan, { label } = {}) {
      const room = s.getRoom(id);
      if (!room || !plan || plan.problem || !plan.patch) return false;
      const text = label ?? `Turn ${room.name ?? 'room'}`;
      const sub = { label: text };
      const cmds = [new UpdateRoomCommand(s, id, plan.patch, sub)];
      for (const [roomId, patch] of plan.rooms ?? []) {
        if (s.getRoom(roomId)) cmds.push(new UpdateRoomCommand(s, roomId, patch, sub));
      }
      for (const [objectId, patch] of plan.objects ?? []) {
        const obj = s.getObject(objectId);
        if (!obj) continue;
        cmds.push(new TransformCommand(s, objectId, obj.assetType === 'STAIRCASE' ? stairPatch(patch) : patch, sub));
      }
      run(cmds.length === 1 ? cmds[0] : new CompositeCommand(text, cmds));
      return true;
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
      run(new HeightsCommand(label ?? `Wall height of ${room.name}`, () => plan, mergeKey, `room:${id}`, store));
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
      run(new HeightsCommand(label ?? `Height of ${store().floors[floorId].name}`, () => plan, mergeKey, `floor:${floorId}`, store));
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
      run(new RoomGroupCommand(label ?? `Resize ${list[0].kind}`, patches, mergeKey, s));
    },

    // ── Anchors (hook points for other modules) ──
    /**
     * @param {string} anchorId
     * @param {{positionRef?: string|null, label?: string|null}} patch  null clears a value
     * @param {{label?: string, mergeKey?: string}} [options]
     */
    /**
     * Check my layout (v0.15.3): the problems marked "Ignore" for this layout, as a list of problem
     * keys (navigation/checkLayout.js). Saved with the layout; one undo step.
     * @param {string[]} keys  the whole new list
     * @param {{label?: string}} [options]
     */
    setIgnoredChecks(keys, options) {
      const next = [...new Set((keys ?? []).filter((k) => typeof k === 'string' && k))];
      const current = store().ignoredChecks ?? [];
      if (next.length === current.length && next.every((k, i) => k === current[i])) return;
      run(new IgnoredChecksCommand(next, options, store));
    },
    setAnchorData(anchorId, patch, options) {
      const current = store().anchorData[anchorId] ?? {};
      const changed = Object.entries(patch).some(([k, v]) => (current[k] ?? null) !== (v || null));
      if (!changed) return;
      run(new AnchorDataCommand(anchorId, patch, options, store));
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
      }, store));
      return newId;
    },
    /**
     * Remove a floor with its rooms and items. The ground floor can't be removed.
     * @returns {{ problem: string | null }}
     */
    removeFloor(floorId) {
      if (!store().floors[floorId]) return { problem: 'This floor is gone' };
      if (isGroundFloor(store().floors, floorId)) return { problem: GROUND_FLOOR_STAYS };
      run(new SnapshotCommand('Remove floor', () => store().removeFloor(floorId), store));
      return { problem: null };
    },
    renameFloor(floorId, newName) {
      run(new SnapshotCommand('Rename floor', () => store().renameFloor(floorId, newName), store));
    },

    /**
     * R8: Apply an AI proposed layout to the workplace.
     * All additions are bundled into one SnapshotCommand so Ctrl+Z undoes the entire proposal cleanly.
     * @param {object} proposedLayout Layout v2 object
     */
    applyProposedLayout(proposedLayout) {
      if (!proposedLayout) return;
      const v1 = proposedLayout.schemaVersion === 2 ? toV1(proposedLayout) : proposedLayout;
      run(new SnapshotCommand('Apply proposed layout', () => {
        const st = store();
        if (Array.isArray(v1.rooms)) {
          for (const room of v1.rooms) {
            st.addRoom(room);
          }
        }
        if (Array.isArray(v1.objects)) {
          for (const obj of v1.objects) {
            st.addObject(obj);
          }
        }
        st.selectRoom(null);
        st.selectObject(null);
      }, store));
    },

    /**
     * R4: Restore an old layout version from a snapshot.
     * Wrapped in a SnapshotCommand so Ctrl+Z undoes the restore cleanly,
     * while keeping prior undo history intact. The layout name stays as it is
     * (it is not part of undo).
     * @param {object} snapshot Layout snapshot (rooms, floors, objects, anchorData)
     */
    restoreVersion(snapshot) {
      if (!snapshot) return;
      const v1 = snapshot.schemaVersion === 2 ? toV1(snapshot) : snapshot;
      const normalised = normaliseLayout(v1);
      return run(new SnapshotCommand('Restore version', () => {
        store().replaceLayoutState({
          floors: normalised.floors,
          rooms: normalised.rooms,
          objects: normalised.objects,
          currentFloor: Object.keys(normalised.floors || {})[0] ? Number(Object.keys(normalised.floors)[0]) : 0,
          anchorData: normalised.anchorData,
          ignoredChecks: normalised.ignoredChecks,
        });
      }, store));
    },

    // ── History ──
    undo: () => history.undo(),
    redo: () => history.redo(),
    clear: () => history.clear(),
    /** The mouse was released or the tool changed: the next change is a new undo step. */
    endBurst: () => history.endBurst(),
  };
  return api;
}
