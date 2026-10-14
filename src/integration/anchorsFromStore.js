/**
 * integration/anchorsFromStore.js
 *
 * Anchors for the LIVE editor (the Zustand store).
 *
 * An anchor is a hook point other modules attach to: a seat, a workstation,
 * a machine, a reception desk, a spawn point. Its position is NOT stored:
 * it is worked out from the object it belongs to every time, so it always
 * follows the object when it is moved, rotated or undone.
 *
 * What IS stored (store.anchorData, saved with the layout) is the data other
 * modules write onto an anchor:
 *   anchorData = { [anchorId]: { positionRef?: string, label?: string } }
 *
 * Anchor IDs are stable (UUID v5 of objectId + kind), so a link like
 * "this workstation belongs to the Engineering Head position" survives
 * reloads, moves and undo/redo.
 */

import { generateAnchorsForObject } from '../engine/model/anchors';
import { elevationOf } from '../play/building';

/** Store object (v1 field names) → the minimal shape the anchor generator needs. */
function toLayoutObject(o) {
  return {
    id: String(o.id),
    floorId: o.floor ?? o.floorId ?? 0,
    roomId: o.roomId ?? null,
    assetType: o.assetType ?? '',
    x: o.x ?? 0,
    y: o.y ?? 0,
    z: o.z ?? 0,
    rotationY: o.rotationY ?? 0,
  };
}

/**
 * Anchors of one store object, with any saved positionRef / label applied.
 * Positions are WORLD positions: an object on Floor 1 has anchors 3.5 m up.
 */
export function anchorsForObject(obj, anchorData = {}, floors = null) {
  const elevation = floors ? elevationOf(floors, obj.floor ?? 0) : 0;
  return generateAnchorsForObject(toLayoutObject(obj), elevation).map((a) => {
    const saved = anchorData[a.id];
    return saved ? { ...a, ...pick(saved) } : a;
  });
}

/**
 * All anchors in the layout.
 * @param {Record<string, object> | object[]} objects  store.objects
 * @param {Record<string, {positionRef?: string, label?: string}>} anchorData  store.anchorData
 * @param {Record<string, {id, elevation}>} [floors]  store.floors (for world heights)
 */
export function anchorsFromStore(objects, anchorData = {}, floors = null) {
  return Object.values(objects ?? {}).flatMap((o) => anchorsForObject(o, anchorData, floors));
}

/** Which anchor best represents an object when someone interacts with it. */
const PRIMARY_ORDER = ['machine', 'reception', 'workstation', 'seat', 'spawn', 'info-point'];

export function primaryAnchor(anchors) {
  for (const kind of PRIMARY_ORDER) {
    const a = anchors.find((x) => x.kind === kind);
    if (a) return a;
  }
  return anchors[0] ?? null;
}

function pick(saved) {
  const out = {};
  if (saved.positionRef) out.positionRef = saved.positionRef;
  if (saved.label) out.label = saved.label;
  return out;
}
