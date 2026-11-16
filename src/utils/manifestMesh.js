/**
 * utils/manifestMesh.js (v0.18.0)
 *
 * Draws a manifest item (catalog/manifest.js): its `parts` (boxes and cylinders), or its parametric
 * `builder` (utils/workstationMesh.js). Same style as the hand-built furniture of assetCatalog.js:
 * shared materials (materialLibrary.getAssetMaterial, never disposed), one TransformNode with the
 * parts as children; assetInstances.js merges them into one template per type (or per variant).
 * An item drawn by neither (a builder this app doesn't know) is a plain box of its size.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { getAssetMaterial } from './materialLibrary';
import { parseMaterial } from '../catalog/manifest';

const WOOD_FINISH = { wood: 'veneer' };

/** A shared material from a manifest material text ('fabric:#4a5568'). */
export function manifestMaterial(scene, text) {
  const m = parseMaterial(text) ?? { finish: 'matte', hex: '#9aa1a8' };
  return getAssetMaterial(scene, WOOD_FINISH[m.finish] ?? m.finish, m.hex);
}

/** A box w × h × d standing on y (its bottom), centred on x, z. */
export function partBox(scene, name, w, h, d, x, y, z, material, pick = true) {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y + h / 2, z);
  m.material = material;
  m.isPickable = pick;
  return m;
}

function partCyl(scene, name, diameter, h, x, y, z, material, pick = true) {
  const m = MeshBuilder.CreateCylinder(name, { diameter, height: h, tessellation: 12 }, scene);
  m.position.set(x, y + h / 2, z);
  m.material = material;
  m.isPickable = pick;
  return m;
}

/** Build a list of manifest parts under `root`. */
export function buildParts(scene, root, parts) {
  parts.forEach((p, i) => {
    const mat = manifestMaterial(scene, p.material);
    const [x, y, z] = p.at;
    const mesh = p.shape === 'cyl'
      ? partCyl(scene, `mp${i}`, p.size[0], p.size[1], x, y, z, mat, p.pick !== false)
      : partBox(scene, `mp${i}`, p.size[0], p.size[1], p.size[2], x, y, z, mat, p.pick !== false);
    mesh.parent = root;
  });
  return root;
}

const builders = new Map(); // name → (scene, root, def, opts) => void

/** utils/workstationMesh.js registers 'workstation' here. */
export function registerBuilder(name, build) {
  builders.set(name, build);
}

/**
 * The mesh of a manifest item.
 * @param {object} def  its manifest entry (manifest.readItem)
 * @param {{ variant?: object }} [opts]  a parametric item's own sizes and options (play/workstation.js)
 */
export function buildManifestMesh(scene, assetType, def, objectId, opts = {}) {
  const root = new TransformNode(`manifest_${assetType.toLowerCase()}_${objectId}`, scene);
  const build = def.builder ? builders.get(def.builder) : null;
  if (def.parts) buildParts(scene, root, def.parts);
  else if (build) build(scene, root, def, opts);
  else partBox(scene, 'mbox', def.defaultWidth, def.defaultHeight, def.defaultDepth, 0, 0, 0, manifestMaterial(scene, 'matte:#b8bcc2')).parent = root;
  root.metadata = { assetType, objectId };
  return root;
}
