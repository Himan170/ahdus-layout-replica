/**
 * pickHelpers.js
 *
 * Forgiving picking shared by Build mode and the planner: pointing at the
 * floor under a desk (between its legs) counts as pointing at the desk, and
 * a wall shared by two rooms is the wall of the room you are looking from,
 * because that's what a person means.
 */

import { wallPickTarget } from '../play/geometry';

/**
 * The room and wall a pick on a wall (or a door / window in it) means. A
 * shared wall is the wall of the room on the side of the face that was hit
 * (geometry.wallPickTarget). On its top or its end the face doesn't tell: then
 * `eye` (the camera; null in the 2D view) decides, or else which half of the
 * top was hit.
 * @param {PickingInfo} hit
 * @param {{x:number, z:number}|null} [eye]
 * @returns {{ roomId: string, wallName: string }}
 */
export function wallTargetOf(hit, eye = null) {
  const meta = hit.pickedMesh.metadata;
  if (!meta?.sharedWith) return { roomId: meta?.roomId, wallName: meta?.wallName };
  const p = hit.pickedPoint;
  const n = hit.getNormal(true);
  const across = meta.wallName === 'north' || meta.wallName === 'south' ? n?.z : n?.x;
  const from = n && Math.abs(across) > 0.5 ? { x: p.x + n.x * 0.05, z: p.z + n.z * 0.05 } : (eye ?? p);
  return wallPickTarget(meta, from);
}

const objectIdOf = (m) => m.metadata?.objectId ?? m.parent?.metadata?.objectId ?? null;

/**
 * The placed item standing over a floor point, or null. If several are, the
 * one standing lowest wins (the desk, not the monitor on it), then the
 * tallest. `accept(mesh, objectId)` can skip meshes (ghosts, other floors).
 * @returns {string|null} objectId
 */
export function itemOverFloorPoint(scene, point, accept = () => true) {
  let best = null;
  for (const mesh of scene.meshes) {
    const id = objectIdOf(mesh);
    if (!id || !mesh.isEnabled() || !accept(mesh, id)) continue;
    const { minimumWorld: lo, maximumWorld: hi } = mesh.getBoundingInfo().boundingBox;
    if (point.x >= lo.x && point.x <= hi.x && point.z >= lo.z && point.z <= hi.z) {
      const lower = best && lo.y < best.bottom - 0.05;
      const asLow = best && Math.abs(lo.y - best.bottom) <= 0.05;
      if (!best || lower || (asLow && hi.y > best.top)) best = { objectId: id, bottom: lo.y, top: hi.y };
    }
  }
  return best?.objectId ?? null;
}

/**
 * v0.18.1: did a pick land on glass (a glass wall's pane, a window's or a glass door's glass)? The pane is a
 * sub-mesh of a merged mesh, so its material says (materialLibrary marks glass with `metadata.glass`).
 * @param {PickingInfo} hit
 */
export function hitIsGlass(hit) {
  const mesh = hit?.pickedMesh;
  let mat = mesh?.material;
  if (!mat) return false;
  if (mat.subMaterials) {
    const sub = mesh.subMeshes?.[hit.subMeshId ?? 0];
    mat = mat.subMaterials[sub?.materialIndex ?? 0];
  }
  return !!mat?.metadata?.glass;
}

/**
 * The nearest pick along `ray` that is not glass (v0.18.1): a click or a hover in the viewer goes THROUGH
 * glass to the person, the desk or the floor behind it. Studio's own picks still pick the glass wall.
 * @returns {PickingInfo | null}
 */
export function pickThroughGlass(scene, ray, predicate) {
  const hits = scene.multiPickWithRay(ray, predicate) ?? [];
  hits.sort((a, b) => a.distance - b.distance);
  return hits.find((h) => h.hit && !hitIsGlass(h)) ?? null;
}
