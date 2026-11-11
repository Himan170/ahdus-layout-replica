/**
 * planner/groupActions.js (v0.15.5)
 *
 * Studio's actions on several items at once, and copy / paste. Every one is ONE undo step through
 * editorHistory (moveObjects, replaceObjects, lockObjects); the maths is pure (play/group.js).
 * Locked items are selected like any other, but a group never moves, turns or deletes them: the
 * message says how many stayed. Copying a desk takes its chair and what stands on it (as a drag
 * does). Who sits at a desk is kept by AHDUS against the desk's id, so pasted desks are empty.
 * The clipboard is Studio's own (one per page), never the system clipboard.
 */

import { v4 as uuidv4 } from 'uuid';

import { findRoomAt } from '../play/geometry';
import { turnStep } from '../play/carry';
import { ASSET_TYPES } from '../utils/assetCatalog';
import {
  groupMembers, groupMoves, groupTurn, copyItems, pasteOffset, pasteItems, lockedNote,
} from '../play/group';

const plural = (n, one = 'item', many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The outline of a selected group in the 3D / 2D view and the plan. */
export const GROUP_HIGHLIGHT = '#2563eb';

/**
 * @param {{
 *   editor: object,                       editorHistory
 *   getState: () => object,               the workspace store's state (and actions)
 *   carriedWith: (obj) => object[],       plannerTools.carriedWith (its chair, what stands on it)
 *   message: (text: string, bad?: boolean) => void,
 * }} deps
 */
export function createGroupActions({ editor, getState, carriedWith = () => [], message = () => {} }) {
  let clipboard = null; // { floor, centre, items }
  let pastes = 0;       // pastes of this clipboard without the mouse: each one 0.5 m further aside

  const st = () => getState();
  /** The selection: the group, else the one selected item. */
  const selection = () => {
    const s = st();
    if (s.selectedObjectIds?.length) return s.selectedObjectIds;
    return s.selectedObjectId ? [s.selectedObjectId] : [];
  };
  const roomAt = (floor) => {
    const rooms = Object.values(st().rooms);
    return (x, z) => findRoomAt(rooms, x, z, floor)?.id ?? null;
  };
  const nameOf = (o) => o?.label || ASSET_TYPES[o?.assetType]?.label || 'item';

  /** Patches with the room each item ends in. */
  function withRooms(moves) {
    const objects = st().objects;
    const rooms = Object.values(st().rooms);
    return moves.map(([id, p]) => {
      const o = objects[id];
      return [id, { ...p, roomId: findRoomAt(rooms, p.x ?? o.x, p.z ?? o.z, o.floor ?? 0)?.id ?? null }];
    });
  }

  function members(ids = selection()) {
    return groupMembers(st().objects, ids, carriedWith);
  }

  const api = {
    /** True when 2+ items are selected. */
    isGroup: () => (st().selectedObjectIds?.length ?? 0) > 1,
    selection,

    /** Move the group by (dx, dz) metres (arrow keys). */
    move(dx, dz, { label, mergeKey } = {}) {
      const ids = selection();
      const { items, locked } = members(ids);
      if (!items.length) { message(lockedNote(locked.length) ?? 'Nothing to move', true); return false; }
      editor.moveObjects(withRooms(groupMoves(items, dx, dz)), { label: label ?? `Move ${plural(ids.length)}`, mergeKey });
      if (locked.length) message(lockedNote(locked.length), true);
      return true;
    },

    /** Turn the group about its middle: R = 90°, Shift+R = 15°. */
    turn(small = false) {
      const ids = selection();
      const { items, locked } = members(ids);
      if (!items.length) { message(lockedNote(locked.length, 'turned') ?? 'Nothing to turn', true); return false; }
      editor.moveObjects(withRooms(groupTurn(items, turnStep(small))), { label: `Turn ${plural(ids.length)}` });
      message([`Turned ${plural(ids.length)} ${small ? '15°' : '90°'}.`, lockedNote(locked.length, 'turned')].filter(Boolean).join(' '), !!locked.length);
      return true;
    },

    /** Delete the unlocked selected items (one undo step). */
    remove() {
      const ids = selection();
      const objects = st().objects;
      const free = ids.filter((id) => objects[id] && !objects[id].isLocked);
      const locked = ids.length - free.length;
      if (!free.length) { message(lockedNote(locked, 'deleted') ?? 'Nothing to delete', true); return false; }
      editor.replaceObjects(free, [], { label: `Delete ${plural(free.length)}` });
      message([`Deleted ${plural(free.length)}. Ctrl+Z to undo.`, lockedNote(locked, 'deleted')].filter(Boolean).join(' '), !!locked);
      if (locked) st().setObjectSelection(ids.filter((id) => !free.includes(id)));
      return true;
    },

    /** Lock every selected item, or unlock them all when all are locked (L). */
    toggleLock() {
      const ids = selection();
      const objects = st().objects;
      const lock = !ids.every((id) => objects[id]?.isLocked);
      editor.lockObjects(ids, lock);
      message(`${lock ? 'Locked' : 'Unlocked'} ${plural(ids.length)}`);
    },

    /** Ctrl+C: the selection (with chairs and what stands on desks) to Studio's clipboard. */
    copy() {
      const ids = selection();
      const clip = copyItems(st().objects, ids, (o) => (o.isLocked ? [] : carriedWith(o)));
      if (!clip) return false;
      clipboard = clip;
      pastes = 0;
      const extra = clip.items.length - ids.length;
      message(`Copied ${ids.length === 1 ? nameOf(st().objects[ids[0]]) : plural(ids.length)}${extra > 0 ? ` (and ${plural(extra, 'item')} with ${ids.length === 1 ? 'it' : 'them'})` : ''}. Ctrl+V to paste.`);
      return true;
    },

    hasClipboard: () => !!clipboard,

    /**
     * Ctrl+V: paste on the floor being edited, its middle at `at` (the mouse), else 0.5 m aside;
     * Ctrl+Shift+V (`same`): at the same x / z as copied. One undo step; the pasted items are selected.
     * @returns {string[]} the new ids
     */
    paste({ at = null, same = false } = {}) {
      if (!clipboard) { message('Nothing copied yet: select items and press Ctrl+C'); return []; }
      const floor = st().currentFloor;
      if (!same && !at) pastes += 1;
      const offset = pasteOffset(clipboard, { at, same, times: pastes });
      const add = pasteItems(clipboard, { floor, offset, newId: () => `obj_${uuidv4()}`, roomAt: roomAt(floor) });
      editor.replaceObjects([], add, { label: `Paste ${plural(add.length)}` });
      const ids = add.map((o) => o.id);
      st().setObjectSelection(ids);
      const where = floor !== clipboard.floor ? ` on ${st().floors[floor]?.name ?? 'this floor'}` : '';
      message(`Pasted ${plural(add.length)}${where}. Ctrl+Z to undo.`);
      return ids;
    },

    /** Ctrl+D / Duplicate on a group: a copy 0.5 m aside, selected. The clipboard is left alone. */
    duplicate() {
      const ids = selection();
      const clip = copyItems(st().objects, ids, (o) => (o.isLocked ? [] : carriedWith(o)));
      if (!clip) return [];
      const floor = st().currentFloor;
      const add = pasteItems(clip, { floor, offset: pasteOffset(clip), newId: () => `obj_${uuidv4()}`, roomAt: roomAt(floor) });
      editor.replaceObjects([], add, { label: `Duplicate ${plural(add.length)}` });
      st().setObjectSelection(add.map((o) => o.id));
      message(`Duplicated ${plural(ids.length)}. Ctrl+Z to undo.`);
      return add.map((o) => o.id);
    },
  };
  return api;
}
