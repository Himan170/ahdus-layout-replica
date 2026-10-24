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
 * With "Realistic look" on (realLook.js), a type listed in modelRegistry.js
 * gets a second template from its real model (modelLoader.js) once it has
 * loaded, and its items switch to it (their child's metadata.model names it);
 * switching the look off switches them back.
 *
 * Also: mergeByMaterial (used for room parts too) and the shared MultiMaterials.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { buildAssetMesh, ASSET_TYPES, OBJECT_CATEGORIES } from './assetCatalog';
import { markShared, sharedMultiMaterial } from './materialLibrary';
import { modelPartsFor } from './modelRegistry';
import { buildModelParts } from './modelLoader';
import { isRealistic, onLookChange } from './realLook';

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
// Each asset type has its primitive template (built at once) and, with
// "Realistic look" on and a model in modelRegistry.js, a model template
// (loaded after; until then and if it fails, items show the primitive one).

const templates = new WeakMap(); // scene → Map(key → { mesh, model, rootName, assetType, loading })

/** Hide a merged mesh and keep it as a template (never drawn or picked; shared materials). */
function asTemplate(mesh, metadata) {
  mesh.isVisible = false;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.receiveShadows = true;
  mesh.metadata = metadata;
  if (mesh.material) markShared(mesh.material);
  for (const m of mesh.material?.subMaterials ?? []) if (m) markShared(m);
  return mesh;
}

function templateEntry(scene, assetType, rise) {
  let cache = templates.get(scene);
  if (!cache) templates.set(scene, (cache = new Map()));
  const key = rise === undefined ? assetType : `${assetType}@${rise}`;
  const hit = cache.get(key);
  if (hit && !hit.mesh.isDisposed()) return hit;

  const root = buildAssetMesh(assetType, scene, 'template', { rise });
  const parts = [root, ...root.getChildMeshes(false)].filter((m) => m.getTotalVertices?.() > 0);
  for (const p of parts) p.computeWorldMatrix(true);
  const mesh = asTemplate(mergeByMaterial(parts, `template_${key}`), { template: assetType });
  if (!root.isDisposed()) root.dispose(false, false);
  const entry = { mesh, model: null, rootName: root.name, assetType, loading: null, failed: false };
  cache.set(key, entry);
  return entry;
}

/** Start loading a type's real model (once); its items switch to it when it is there. */
function loadModelTemplate(scene, entry) {
  if (entry.model || entry.loading || entry.failed || !modelPartsFor(entry.assetType)) return;
  const bb = entry.mesh.getBoundingInfo().boundingBox; // the template has no transform: local = world
  const box = { min: bb.minimum.asArray(), max: bb.maximum.asArray() };
  entry.loading = buildModelParts(scene, entry.assetType, box).then((built) => {
    entry.loading = null;
    if (!built || scene.isDisposed || entry.mesh.isDisposed()) { built?.dispose(); return; }
    try {
      const merged = mergeByMaterial(built.meshes, `model_${entry.assetType}`);
      if (built.mirrored) merged.flipFaces(false); // the winding, not the normals (they were transformed right)
      entry.model = asTemplate(merged, { template: entry.assetType, model: built.models.join('+') });
    } finally {
      built.dispose();
    }
    refreshItems(scene, entry);
  }).catch((err) => {
    entry.loading = null;
    entry.failed = true; // keeps the primitive model
    console.warn(`[realistic look] ${entry.assetType} keeps its simple model: ${err?.message ?? err}`);
  });
}

/** The template an item of this entry is drawn with now. */
function activeTemplate(scene, entry) {
  if (!isRealistic(scene)) return entry.mesh;
  if (entry.model && !entry.model.isDisposed()) return entry.model;
  loadModelTemplate(scene, entry);
  return entry.mesh;
}

const watched = new WeakSet(); // scenes whose look changes switch the items

function watchLook(scene) {
  if (watched.has(scene)) return;
  watched.add(scene);
  onLookChange(scene, () => {
    for (const entry of templates.get(scene)?.values() ?? []) refreshItems(scene, entry);
  });
}

// ── Items ─────────────────────────────────────────────────────────────────

const items = new WeakMap(); // root → { entry, template, solid, castShadow, shadowGenerator, looks, mesh }
const liveItems = new WeakMap(); // scene → Set(root): the items to switch when a model loads

function attachChild(root, mesh, checkCollisions) {
  const it = items.get(root);
  mesh.parent = root;
  mesh.isVisible = true;                // a clone copies the hidden template's flags
  mesh.isPickable = true;
  mesh.metadata = {
    objectId: root.metadata.objectId,
    floorId: root.metadata.floorId,
    ...(it.template.metadata?.model ? { model: it.template.metadata.model } : {}), // drawn by a real model
  };
  mesh.checkCollisions = checkCollisions;
  mesh.receiveShadows = true;
  if (it.castShadow) it.shadowGenerator?.addShadowCaster(mesh, false);
  it.mesh = mesh;
}

/** A per-item look (lock tint, outline) set on the old mesh carries over to the new one. */
const LOOK_PROPS = ['renderOverlay', 'overlayColor', 'overlayAlpha', 'renderOutline', 'outlineColor', 'outlineWidth'];

/** Draw the item with `template` (an instance, or a clone while it has a look of its own). */
function redraw(root, it, template) {
  const old = it.mesh;
  const checkCollisions = old && !old.isDisposed() ? old.checkCollisions : it.solid; // carrying an item turns this off
  it.template = template;
  const next = it.looks.size > 0
    ? template.clone(`${root.name}_own`, null, true)
    : template.createInstance(`${root.name}_mesh`);
  if (old && !old.isDisposed()) {
    if (it.looks.size > 0) for (const p of LOOK_PROPS) next[p] = old[p];
    it.shadowGenerator?.removeShadowCaster(old, false);
    old.dispose(false, false);
  }
  attachChild(root, next, checkCollisions);
  return next;
}

/** Switch the items of a template entry to the template they should use now. */
function refreshItems(scene, entry) {
  const template = activeTemplate(scene, entry);
  for (const root of liveItems.get(scene) ?? []) {
    const it = items.get(root);
    if (it?.entry === entry && it.template !== template && !root.isDisposed()) redraw(root, it, template);
  }
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
  watchLook(scene);
  const entry = templateEntry(scene, assetType, rise);
  const template = activeTemplate(scene, entry);
  // Same name as the catalog gives it (e.g. arch_stair_<id>), with this item's id
  const root = new TransformNode(entry.rootName.replace(/template$/, objectId), scene);
  root.metadata = { assetType, objectId, floorId, ...(rise !== undefined ? { rise } : {}) };
  items.set(root, {
    entry, template, solid, castShadow: castsShadow(assetType), shadowGenerator, looks: new Set(), mesh: null,
  });
  let live = liveItems.get(scene);
  if (!live) liveItems.set(scene, (live = new Set()));
  live.add(root);
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
  // (switching between instance and clone: the caller sets the look on the result)
  const old = it.mesh;
  if (old && !old.isDisposed()) for (const p of LOOK_PROPS) if (p.startsWith('render')) old[p] = false;
  return redraw(root, it, it.template);
}

/** Remove a placed item's meshes. Its template and materials stay (shared). */
export function disposeItemMesh(root) {
  const it = items.get(root);
  if (it?.mesh && !it.mesh.isDisposed()) {
    it.shadowGenerator?.removeShadowCaster(it.mesh, false);
    it.mesh.dispose(false, false);
  }
  items.delete(root);
  liveItems.get(root.getScene())?.delete(root);
  if (!root.isDisposed()) root.dispose(false, false);
}
