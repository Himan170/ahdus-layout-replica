/**
 * play/locks.js (v0.15.6)
 *
 * PURE: what a lock stops. A locked item never moves, turns, resizes or is deleted (since v0.3);
 * a locked ROOM (v0.15.6, store field `isLocked`, v2 `locked`) follows the same rules: no move,
 * no resize (its walls, its size, its wall height or thickness), no turn, no delete. Its name,
 * type, colour, floor finish, department, doors and windows can still change, and items in it
 * still move on their own.
 */

/** Room fields that move, resize or turn it: a locked room keeps them. */
export const ROOM_SHAPE_KEYS = ['x', 'z', 'width', 'depth', 'wallHeight', 'wallThickness', 'floor'];

/** Item fields that move, turn or resize it: a locked item keeps them (v0.18.6: in every path, the Inspector too). */
export const ITEM_SHAPE_KEYS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ', 'floor', 'roomId'];

/**
 * The part of an item patch a lock allows: everything but its place, angle and size when it is locked
 * (its name, department and other details still change; `isLocked` itself always does).
 * @returns {{ patch: object, refused: string[] }}
 */
export function allowedItemPatch(obj, patch) {
  if (!obj?.isLocked) return { patch, refused: [] };
  const allowed = {};
  const refused = [];
  for (const [k, v] of Object.entries(patch)) {
    if (ITEM_SHAPE_KEYS.includes(k) && obj[k] !== v) refused.push(k);
    else allowed[k] = v;
  }
  return { patch: allowed, refused };
}

/** The words for "this is locked", the same in Studio, Plan view and Walk through. */
export function lockedText(name) {
  return `${name || 'This'} is locked. Select it and press L to unlock it`;
}

/** Is this room locked? (missing = unlocked, as in old saves) */
export function isRoomLocked(room) {
  return !!room?.isLocked;
}

/**
 * The part of a room patch a lock allows: everything but its shape when it is locked.
 * @returns {{ patch: object, refused: string[] }}  refused = the keys left out
 */
export function allowedRoomPatch(room, patch) {
  if (!isRoomLocked(room)) return { patch, refused: [] };
  const allowed = {};
  const refused = [];
  for (const [k, v] of Object.entries(patch)) {
    if (ROOM_SHAPE_KEYS.includes(k) && room[k] !== v) refused.push(k);
    else allowed[k] = v;
  }
  return { patch: allowed, refused };
}
