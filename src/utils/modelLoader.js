/**
 * utils/modelLoader.js
 *
 * Real furniture models (Kenney GLBs, utils/modelRegistry.js) as item
 * templates. Each GLB file is loaded ONCE per scene (an AssetContainer); an
 * asset type's template is made from copies of its model(s), fitted into the
 * box of the type's primitive model (play/modelFit.js) and merged into one
 * mesh, one sub-mesh per material, like the primitive templates
 * (assetInstances.js). Kenney's flat colours become our shared furniture
 * materials (wood veneer, fabric, metal, glass…), so they are lit like the rest.
 *
 * The glTF loader is imported on first use: with "Realistic look" off it is
 * never downloaded.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { modelPartsFor, MODEL_DIR } from './modelRegistry';
import { fitTransform, regionBox } from '../play/modelFit';
import { getAssetMaterial } from './materialLibrary';
import { assetUrl, trackLoad } from './realLook';

/** Kenney's material names → our shared furniture materials (finish, colour). */
const KENNEY_MATERIALS = {
  wood: ['veneer', '#c8a87a'],
  woodDark: ['veneer', '#8b6f47'],
  metal: ['metal', '#a0a8b0'],
  metalLight: ['metal', '#d8dcdf'],
  metalMedium: ['metal', '#606870'],
  metalDark: ['metal', '#2a2e38'],
  carpet: ['fabric', '#4a5568'],
  carpetDarker: ['fabric', '#1e2230'],
  carpetBlue: ['fabric', '#4a5568'],
  carpetWhite: ['gloss', '#f2f2f0'],
  glass: ['glass', '#a8d4f5'],
  lamp: ['matte', '#f6efdc'],
  plant: ['matte', '#3f7a3a'],
  fur: ['fabric', '#8b6f47'],
  _defaultMat: ['matte', '#e8e8e6'],
};

let loaderModule = null;
function loader() {
  loaderModule ??= Promise.all([
    import('@babylonjs/core/Loading/sceneLoader'),
    import('@babylonjs/loaders/glTF/glTFFileLoader'),
    import('@babylonjs/loaders/glTF/2.0/glTFLoader'),
  ]).then(([sceneLoader]) => sceneLoader);
  return loaderModule;
}

const containers = new WeakMap(); // scene → Map(model → Promise<AssetContainer>)

function loadModel(scene, model) {
  let cache = containers.get(scene);
  if (!cache) containers.set(scene, (cache = new Map()));
  if (!cache.has(model)) {
    const url = assetUrl(scene, `${MODEL_DIR}${model}.glb`);
    cache.set(model, trackLoad(scene, loader().then(({ LoadAssetContainerAsync }) =>
      LoadAssetContainerAsync(url, scene, { pluginExtension: '.glb' }))));
  }
  return cache.get(model);
}

/** World matrices from the top down (a child's uses its parent's). */
function refresh(top) {
  top.computeWorldMatrix(true);
  for (const n of top.getDescendants(false)) n.computeWorldMatrix(true);
}

function worldBox(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const bb = m.getBoundingInfo().boundingBox;
    for (const v of bb.vectorsWorld) {
      const a = [v.x, v.y, v.z];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a[i]); max[i] = Math.max(max[i], a[i]); }
    }
  }
  return { min, max };
}

/**
 * Meshes of an asset type's real model, fitted into `box` (the primitive
 * model's box) and with our shared materials; ready for mergeByMaterial.
 * Resolves to null when the type has no model in the registry.
 * Rejects when a file can't be loaded (the caller keeps the primitive model).
 * @param {{ min: number[], max: number[] }} box
 * @returns {Promise<{ meshes: Mesh[], mirrored: boolean, dispose(): void, models: string[] } | null>}
 */
export async function buildModelParts(scene, assetType, box) {
  const parts = modelPartsFor(assetType);
  if (!parts) return null;
  const loaded = await Promise.all(parts.map((p) => loadModel(scene, p.model)));
  if (scene.isDisposed) return null;

  const nodes = [];
  const meshes = [];
  parts.forEach((part, i) => {
    const copy = loaded[i].instantiateModelsToScene((name) => `${part.model}_${name}`, false, { doNotInstantiate: true });
    const fit = new TransformNode(`fit_${part.model}`, scene);
    const turn = new TransformNode(`turn_${part.model}`, scene);
    turn.parent = fit;
    turn.rotation.y = ((part.turn ?? 0) * Math.PI) / 2;
    for (const root of copy.rootNodes) root.parent = turn;
    nodes.push(fit, ...copy.rootNodes);
    const own = turn.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    refresh(fit);
    const { scale, offset } = fitTransform(worldBox(own), regionBox(box, part.region), part.fit);
    fit.scaling = Vector3.FromArray(scale);
    fit.position = Vector3.FromArray(offset);
    refresh(fit);
    const kenneyNames = own.map((m) => m.material?.name); // (an instance's is its source's: read before any change)
    own.forEach((found, k) => {
      const world = found.getWorldMatrix().clone();
      // A part the GLB uses twice comes as an instance: merging needs a real mesh
      const m = found.sourceMesh ? found.sourceMesh.clone(`${found.name}_copy`, null, true, false) : found;
      if (m !== found) nodes.push(m);
      const [finish, hex] = KENNEY_MATERIALS[kenneyNames[k]] ?? KENNEY_MATERIALS._defaultMat;
      m.material = getAssetMaterial(scene, finish, hex); // the copy shares the container's: just drop it
      // Off its parent, at the same place: merging disposes each source, and a
      // mesh disposed first would take its child meshes with it
      m.parent = null;
      m.freezeWorldMatrix(world);
      meshes.push(m);
    });
  });
  return {
    meshes,
    // glTF is right-handed: the loader mirrors it, so baked vertices turn inside out
    mirrored: meshes.length > 0 && meshes[0].getWorldMatrix().determinant() < 0,
    models: parts.map((p) => p.model),
    // what is left once the meshes are merged (the nodes the copies hung on)
    dispose() { for (const n of nodes) if (!n.isDisposed()) n.dispose(false, false); },
  };
}
