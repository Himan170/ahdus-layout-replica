/**
 * src/utils/accessibleSummary.js
 *
 * Accessibility helpers for Task S3:
 * - Generates clear, descriptive text for screen readers and speech synthesis.
 * - Describes rooms, furniture items, and accessible path summaries between floors/spaces.
 */

import { ROOM_TYPES } from './roomStore';
import { ASSET_TYPES } from './assetCatalog';

/** Converts radians to nearest degrees (-180 to 180). */
export function toDegrees(rad) {
  const deg = Math.round((Number(rad) || 0) * 180 / Math.PI);
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

/**
 * Returns a spoken/screen-reader description for a room.
 * @param {object} room
 * @param {object[]} [objects]
 * @param {string} [floorName]
 * @returns {string}
 */
export function describeRoom(room, objects = [], floorName = 'Ground Floor') {
  if (!room) return '';
  const typeLabel = ROOM_TYPES[room.type]?.label || room.type || 'Room';
  const name = room.name || typeLabel;
  const w = (Number(room.width) || 0).toFixed(1);
  const d = (Number(room.depth) || 0).toFixed(1);

  const roomItems = (objects || []).filter((o) => o.roomId === room.id);
  const itemsText = roomItems.length > 0
    ? ` Contains ${roomItems.length} ${roomItems.length === 1 ? 'item' : 'items'}.`
    : ' Room is currently empty.';

  const doorsCount = Array.isArray(room.doors) ? room.doors.length : 0;
  const doorText = doorsCount === 1 ? ' 1 door.' : doorsCount > 1 ? ` ${doorsCount} doors.` : '';

  return `${name}, ${typeLabel}. Dimensions ${w} by ${d} metres on ${floorName}.${itemsText}${doorText}`;
}

/**
 * Returns a spoken/screen-reader description for a furniture item.
 * @param {object} object
 * @param {string} [roomName]
 * @param {string} [floorName]
 * @returns {string}
 */
export function describeObject(object, roomName = null, floorName = 'Ground Floor') {
  if (!object) return '';
  const def = ASSET_TYPES[object.assetType];
  const name = object.label || def?.label || object.assetType || 'Item';
  const x = (Number(object.x) || 0).toFixed(1);
  const z = (Number(object.z) || 0).toFixed(1);
  const deg = toDegrees(object.rotationY || 0);

  const locationText = roomName ? ` in ${roomName} on ${floorName}` : ` on ${floorName}`;
  const lockText = object.isLocked ? ' Item is locked.' : '';

  return `${name}${locationText}. Position X ${x}, Z ${z} metres. Rotation ${deg} degrees.${lockText}`;
}

/**
 * Summarizes the accessible navigation paths between floors and rooms.
 * @param {object[]} floors
 * @param {object[]} rooms
 * @param {object[]} [objects]
 * @param {object[]} [routes]
 * @returns {string}
 */
export function describeAccessibilityRoutes(floors = [], rooms = [], objects = [], routes = []) {
  const floorList = Array.isArray(floors) ? floors : Object.values(floors || {});
  const floorCount = Math.max(1, floorList.length);

  // Check for stairs or elevators in objects
  const hasStairs = (objects || []).some((o) => o.assetType === 'STAIRCASE');
  const hasElevator = (objects || []).some((o) => o.assetType === 'ELEVATOR');

  if (floorCount === 1) {
    return 'Single level layout. All rooms on Ground Floor are step-free accessible.';
  }

  let connection = 'No vertical links defined between floors yet.';
  if (hasStairs && hasElevator) {
    connection = 'Stairs and elevator available for access between floors.';
  } else if (hasElevator) {
    connection = 'Elevator available for step-free access between floors.';
  } else if (hasStairs) {
    connection = 'Stairs connect between floors.';
  }

  const routeCount = Array.isArray(routes) ? routes.length : 0;
  const routeText = routeCount > 0 ? ` ${routeCount} designated routes mapped.` : '';

  return `${floorCount} floors total. ${connection}${routeText}`;
}
