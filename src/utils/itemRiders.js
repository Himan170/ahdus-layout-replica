/**
 * utils/itemRiders.js
 *
 * What stands ON an item (a monitor and a plant on a desk), found from the item's
 * mesh: Studio's drag and Walk through's carry (G, Edit item) take them along.
 * One rule for both modes (v0.15.2; it lived in plannerTools before).
 */

/** Building parts keep their height: they neither ride on an item nor get lifted onto one. */
export const KEEP_HEIGHT = new Set(['WALL_SEGMENT', 'DOOR_SINGLE', 'WINDOW_FRAME', 'GLASS_PARTITION']);

/**
 * Items standing on `obj`: their foot is at its top, inside its outline. Locked items,
 * building parts and stairs never ride. The outline is the mesh's, moved back to where
 * the store has the item (a gizmo drag has already moved the mesh when it reports).
 * @param {object} obj        the item (store data)
 * @param {object} mesh       its root mesh / node (getHierarchyBoundingVectors)
 * @param {object[]} objects  every item
 * @param {number} elevation  world height of the item's floor
 * @returns {object[]}
 */
export function ridersOf(obj, mesh, objects, elevation = 0) {
  if (!obj || !mesh?.getHierarchyBoundingVectors) return [];
  const { min, max } = mesh.getHierarchyBoundingVectors(true);
  const sx = (mesh.position?.x ?? obj.x) - obj.x;
  const sz = (mesh.position?.z ?? obj.z) - obj.z;
  const top = max.y - elevation;
  return objects.filter((o) => o.id !== obj.id && (o.floor ?? 0) === (obj.floor ?? 0) &&
    !o.isLocked && !KEEP_HEIGHT.has(o.assetType) && o.assetType !== 'STAIRCASE' &&
    (o.y ?? 0) > 0.05 && Math.abs((o.y ?? 0) - top) < 0.2 &&
    o.x >= min.x - sx && o.x <= max.x - sx && o.z >= min.z - sz && o.z <= max.z - sz);
}
