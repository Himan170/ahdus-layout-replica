/**
 * utils/assetInstances.js
 *
 * Placed items are drawn as INSTANCES of one template per asset type, so a
 * building with 300 desks costs a handful of draw calls, not thousands:
 *   - the template: the asset built once per scene (assetCatalog.buildAssetMesh)
 *     with its parts merged into ONE mesh, one sub-mesh per material. It is
 *     never drawn itself (isVisible false), only its instances are.
 *   - each item: a TransformNode root (position, rotation, scale; metadata
 *     objectId, floorId, assetType; what the gizmo moves) with one child mesh,
 *     an instance of the template (metadata objectId, floorId: picking).
 * An item that needs a look of its own (the lock tint, Preview's outline) swaps
 * its instance for a clone of the template (same geometry, drawn on its own)
 * while it needs it: instances can't have their own overlay or outline.
 *
 * Also: mergeByMaterial (used for room parts too) and the shared MultiMaterials.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { buildAssetMesh, ASSET_TYPES, OBJECT_CATEGORIES } from './assetCatalog';
import { markShared } from './materialLibrary';

/** Small items don't cast shadows (a shadow each costs a draw call and shows little). */
const NO_SHADOW = new Set([
  'CHAIR_OFFICE', 'PLANT_LARGE', 'PLANT_SMALL', 'MONITOR_DUAL', 'PRINTER', 'COFFEE_MACHINE',
  'FIRE_EXTINGUISHER', 'EMERGENCY_EXIT', 'FIRST_AID',
  'LAPTOP', 'KEYBOARD', 'COMPUTER_MOUSE', 'TRASH_CAN', 'MICROWAVE', 'FLOOR_LAMP', 'RUG',
]);

export function castsShadow(assetType) {
  if (NO_SHADOW.has(assetType)) return false;
  return ASSET_TYPES[assetType]?.category !== OBJECT_CATEGORIES.MARKER;
}

// ── Merging ───────────────────────────────────────────────────────────────

const multiMaterials = new WeakMap(); // scene → Map(sub-material ids → MultiMaterial)

/** One shared MultiMaterial per list of sub-materials (rooms and templates reuse them). */
function sharedMultiMaterial(scene, subMaterials) {
  let cache = multiMaterials.get(scene);
  if (!cache) multiMaterials.set(scene, (cache = new Map()));
  const key = subMaterials.map((m) => m?.uniqueId ?? 'none').join('|');
  let mm = cache.get(key);
  if (!mm || !scene.materials.includes(mm)) { // new, or disposed with its scene
    mm = markShared(new MultiMaterial(`multi_${key}`, scene));
    mm.subMaterials = [...subMaterials];
    cache.set(key, mm);
  }
  return mm;
}

/**
 * Merge meshes into ONE mesh with one sub-mesh per material (one draw call per
 * material). Each mesh's world transform is baked into the vertices; the
 * result has no parent and an identity transform. The sources are disposed.
 * @returns {Mesh}
 */
export function mergeByMaterial(meshes, name) {
  const scene = meshes[0].getScene();
  const groups = new Map();
  for (const m of meshes) {
    const key = m.material ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const perMaterial = [...groups].map(([material, list]) => {
    const one = Mesh.MergeMeshes(list, true, true);
    one.material = material;
    return one;
  });
  if (perMaterial.length === 1) {
    perMaterial[0].name = name;
    return perMaterial[0];
  }
  const subMaterials = perMaterial.map((m) => m.material);
  const merged = Mesh.MergeMeshes(perMaterial, true, true, undefined, true, true);
  const own = merged.material;
  merged.material = sharedMultiMaterial(scene, subMaterials);
  own?.dispose(false, false, false); // the one MergeMeshes made (keeps its sub-materials)
  merged.name = name;
  return merged;
}

// ── Templates ─────────────────────────────────────────────────────────────

const templates = new WeakMap(); // scene → Map(key → { mesh, rootName })

function templateFor(scene, assetType, rise) {
  let cache = templates.get(scene);
  if (!cache) templates.set(scene, (cache = new Map()));
  const key = rise === undefined ? assetType : `${assetType}@${rise}`;
  const hit = cache.get(key);
  if (hit && !hit.mesh.isDisposed()) return hit;

  const root = buildAssetMesh(assetType, scene, 'template', { rise });
  const parts = [root, ...root.getChildMeshes(false)].filter((m) => m.getTotalVertices?.() > 0);
  for (const p of parts) p.computeWorldMatrix(true);
  const mesh = mergeByMaterial(parts, `template_${key}`);
  if (!root.isDisposed()) root.dispose(false, false);
  // Templates are never drawn and never picked; their materials stay (shared)
  mesh.isVisible = false;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = true;
  mesh.metadata = { template: assetType };
  if (mesh.material) markShared(mesh.material);
  for (const m of mesh.material?.subMaterials ?? []) if (m) markShared(m);
  const entry = { mesh, rootName: root.name };
  cache.set(key, entry);
  return entry;
}

// ── Items ─────────────────────────────────────────────────────────────────

const items = new WeakMap(); // root → { template, solid, castShadow, shadowGenerator, looks, mesh }

function attachChild(root, mesh, checkCollisions) {
  const it = items.get(root);
  mesh.parent = root;
  mesh.isVisible = true;                // a clone copies the hidden template's flags
  mesh.isPickable = true;
  mesh.metadata = { objectId: root.metadata.objectId, floorId: root.metadata.floorId };
  mesh.checkCollisions = checkCollisions;
  mesh.receiveShadows = true;
  if (it.castShadow) it.shadowGenerator?.addShadowCaster(mesh, false);
  it.mesh = mesh;
}

/**
 * The mesh of a placed item: a root node with an instance of its type's template.
 * @param {string} assetType
 * @param {Scene} scene
 * @param {string} objectId
 * @param {{ rise?: number, floorId?: number, solid?: boolean, shadowGenerator?: object|null }} [options]
 *   rise: a staircase's floor height; solid: furniture blocks the character in Preview
 * @returns {TransformNode}
 */
export function createItemMesh(assetType, scene, objectId, { rise, floorId = 0, solid = true, shadowGenerator = null } = {}) {
  const { mesh: template, rootName } = templateFor(scene, assetType, rise);
  // Same name as the catalog gives it (e.g. arch_stair_<id>), with this item's id
  const root = new TransformNode(rootName.replace(/template$/, objectId), scene);
  root.metadata = { assetType, objectId, floorId, ...(rise !== undefined ? { rise } : {}) };
  items.set(root, {
    template, solid, castShadow: castsShadow(assetType), shadowGenerator, looks: new Set(), mesh: null,
  });
  attachChild(root, template.createInstance(`${root.name}_mesh`), solid);
  return root;
}

/**
 * Give an item a look of its own (`reason`: 'lock', 'outline', …) or take it
 * back. While any reason is on, the item is drawn by a clone of the template
 * (overlay / outline work on it); otherwise by an instance.
 * @returns {AbstractMesh|null} the item's mesh now
 */
export function setItemLook(root, reason, on) {
  const it = items.get(root);
  if (!it || root.isDisposed()) return null;
  const had = it.looks.size > 0;
  if (on) it.looks.add(reason); else it.looks.delete(reason);
  const needs = it.looks.size > 0;
  if (had === needs && it.mesh && !it.mesh.isDisposed()) return it.mesh;

  const old = it.mesh;
  const checkCollisions = old ? old.checkCollisions : it.solid; // carrying an item turns this off
  const next = needs
    ? it.template.clone(`${root.name}_own`, null, true)
    : it.template.createInstance(`${root.name}_mesh`);
  if (old && !old.isDisposed()) {
    it.shadowGenerator?.removeShadowCaster(old, false);
    old.dispose(false, false);
  }
  attachChild(root, next, checkCollisions);
  return next;
}

/** Remove a placed item's meshes. Its template and materials stay (shared). */
export function disposeItemMesh(root) {
  const it = items.get(root);
  if (it?.mesh && !it.mesh.isDisposed()) {
    it.shadowGenerator?.removeShadowCaster(it.mesh, false);
    it.mesh.dispose(false, false);
  }
  items.delete(root);
  if (!root.isDisposed()) root.dispose(false, false);
}
