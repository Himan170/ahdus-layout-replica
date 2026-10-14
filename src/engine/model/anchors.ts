/**
 * model/anchors.ts
 *
 * Auto-generated anchors for placed objects.
 *
 * Anchor IDs are DETERMINISTIC: the same object + kind always produces the
 * same UUID (UUID v5). This matters because teammates store anchor IDs in
 * their own data (Harsh's character placements, Yashashwi's positionRef).
 * If IDs were random, every reload would break those links.
 */

import { v5 as uuidv5 } from 'uuid';
import type { Anchor, AnchorKind, Layout, LayoutObject } from './schema';

// Fixed namespace for AHDUS anchor IDs. Never change this value —
// changing it changes every anchor ID in every saved layout.
const ANCHOR_NAMESPACE = '6f1c2a4e-3b7d-4e5f-9a1b-2c3d4e5f6a7b';

export function anchorId(objectId: string, kind: AnchorKind): string {
  return uuidv5(`${objectId}:${kind}`, ANCHOR_NAMESPACE);
}

/** Asset types that get a `machine` anchor (Karthik attaches videos/files here). */
export const MACHINE_ASSET_TYPES = new Set([
  'SERVER_RACK', 'PRINTER', 'PROJECTOR_SCREEN', 'TV_DISPLAY',
  'VENDING_MACHINE', 'COFFEE_MACHINE',
  // shop-floor machines
  'CNC_MACHINE', 'LATHE',
]);

/**
 * Rotate a local (x, z) offset by the object's Y rotation so that
 * "in front of the machine" stays in front after the machine is rotated.
 * Babylon uses a left-handed system: rotating by +θ around Y maps
 * local +Z to (sin θ, cos θ).
 */
function offset(obj: LayoutObject, localX: number, y: number, localZ: number) {
  const c = Math.cos(obj.rotationY);
  const s = Math.sin(obj.rotationY);
  return {
    x: obj.x + localX * c + localZ * s,
    y: obj.y + y,
    z: obj.z - localX * s + localZ * c,
  };
}

/**
 * Build the auto-anchors for one object. Pure function, no side effects.
 * `elevation`: world height of the object's floor. Object y is measured from
 * its floor; anchor positions are WORLD positions (what other modules need).
 */
export function generateAnchorsForObject(obj: LayoutObject, elevation = 0): Anchor[] {
  const type = obj.assetType.toUpperCase();
  const result: Anchor[] = [];

  const make = (
    kind: AnchorKind,
    local: Anchor['position'],
    rotationY = obj.rotationY,
  ): Anchor => ({
    id: anchorId(obj.id, kind),
    kind,
    position: { x: local.x, y: local.y + elevation, z: local.z },
    floorId: obj.floorId,
    roomId: obj.roomId ?? null,
    rotationY,
    objectId: obj.id,
  });

  if (type.startsWith('CHAIR') || type === 'SOFA_3SEAT') {
    result.push(make('seat', offset(obj, 0, 0.45, 0)));
  }

  // Reception desk gets ONLY a reception anchor (it is not a workstation).
  if (type === 'RECEPTION_DESK') {
    result.push(make('reception', offset(obj, 0, 0, 1.2), obj.rotationY + Math.PI));
  } else if (type.startsWith('DESK')) {
    result.push(make('workstation', offset(obj, 0, 0.75, 0)));
  }

  if (MACHINE_ASSET_TYPES.has(type)) {
    result.push(make('machine', offset(obj, 0, 0, 0.8)));
  }

  if (type === 'SPAWN_POINT') {
    result.push(make('spawn', offset(obj, 0, 0, 0)));
  }

  return result;
}

/**
 * Recompute all object-linked anchors from the current objects.
 *
 * - Anchors follow their object (position, rotation, floor, room).
 * - Data other modules wrote onto an anchor (positionRef, label) is kept.
 * - Anchors whose object was deleted are dropped.
 * - Manual anchors (no objectId) are kept unchanged.
 *
 * Call this after loading a layout and after any command that changes objects.
 */
export function syncAnchors(layout: Layout): Anchor[] {
  const previous = new Map(layout.anchors.map((a) => [a.id, a]));
  const manual = layout.anchors.filter((a) => !a.objectId);

  const elevations = new Map(layout.floors.map((f) => [f.id, f.elevation ?? 0]));
  const generated = layout.objects.flatMap((o) =>
    generateAnchorsForObject(o, elevations.get(o.floorId) ?? 0)).map((a) => {
    const old = previous.get(a.id);
    return old
      ? { ...a, positionRef: old.positionRef, label: old.label }
      : a;
  });

  return [...manual, ...generated];
}
