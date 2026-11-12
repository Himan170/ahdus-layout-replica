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
