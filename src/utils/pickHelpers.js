/**
 * pickHelpers.js
 *
 * Forgiving picking shared by Build mode and the planner: pointing at the
 * floor under a desk (between its legs) counts as pointing at the desk,
 * because that's what a person means.
 */

const objectIdOf = (m) => m.metadata?.objectId ?? m.parent?.metadata?.objectId ?? null;

/**
 * The placed item standing over a floor point (the tallest one if several),
 * or null. `accept(mesh, objectId)` can skip meshes (ghosts, other floors).
 * @returns {string|null} objectId
 */
export function itemOverFloorPoint(scene, point, accept = () => true) {
  let best = null;
  for (const mesh of scene.meshes) {
    const id = objectIdOf(mesh);
    if (!id || !mesh.isEnabled() || !accept(mesh, id)) continue;
    const { minimumWorld: lo, maximumWorld: hi } = mesh.getBoundingInfo().boundingBox;
    if (point.x >= lo.x && point.x <= hi.x && point.z >= lo.z && point.z <= hi.z) {
      if (!best || hi.y > best.top) best = { objectId: id, top: hi.y };
    }
  }
  return best?.objectId ?? null;
}
