import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { registerGltfExtensions } from '../../utils/gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../../utils/modelLoader';
import { CharacterSystem } from '../systems/CharacterSystem';
import type { Person } from '../systems/CharacterSystem';

// v0.17.0: walking past people makes and removes full characters again and again. Measured in the browser (Meridian,
// the same route walked 3 times): the heap rose once (108 → 337 MB) and stayed flat, so no leak, but the clips baked
// for each character file were kept for the whole visit, even after the file was unloaded (79 after one walk).
const FILES: Record<string, Uint8Array> = {
  'suit.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-suit.glb')),
  'clips.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-clips.glb')),
};
const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0) =>
  ({ id, assetType, floor: 0, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects: Record<string, ReturnType<typeof obj>> = {};
for (let i = 0; i < 4; i++) {
  objects[`d${i}`] = obj(`d${i}`, 'DESK_STANDARD', i * 2, 0);
  objects[`c${i}`] = obj(`c${i}`, 'CHAIR_OFFICE', i * 2, 0.7, Math.PI);
}
const suit = { url: '/c/suit.glb', height: 1.74, outfit: 'rocketbox' as const, clips: '/c/clips.glb' };
const people: Person[] = Array.from({ length: 4 }, (_, i) => ({ personId: `p${i}`, deskId: `d${i}`, name: `P${i}`, department: 'E', character: suit }));

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new FreeCamera('cam', new Vector3(3, 1.6, -3), scene);
  scene.activeCamera = camera;
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

const counts = () => ({
  meshes: scene.meshes.length, nodes: scene.transformNodes.length, skeletons: scene.skeletons.length,
  geometries: scene.geometries.length, groups: scene.animationGroups.length, materials: scene.materials.length,
  textures: scene.textures.length,
});
const near = () => { camera.position.set(3, 1.6, -3); camera.computeWorldMatrix(); };
const far = () => { camera.position.set(500, 1.6, -300); camera.computeWorldMatrix(); };

function system(unloadAfterMs: number) {
  return new CharacterSystem(scene, {
    getLayout: () => ({ objects, floors, currentFloor: 0 }),
    getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    loadFile: (url, sc) => registerGltfExtensions().then(() => LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], sc, GLB_LOAD_OPTIONS)),
    unloadAfterMs,
  });
}

/** Until the people near are full and posed by their clips (or none is full when far). */
async function settle(cs: CharacterSystem, full: number) {
  for (let i = 0; i < 200; i++) {
    (cs as any).lastChoice = -Infinity;
    cs.update();
    await cs.whenSettled();
    const posed = people.every((p) => !cs.fullState(p.personId) || cs.fullState(p.personId)!.clip);
    if (cs.fullCount === full && posed) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`not settled: ${cs.fullCount} full`);
}

describe('full characters made and removed again and again (v0.17.0)', () => {
  it('leave nothing behind in the scene', async () => {
    const cs = system(1e9);
    cs.setPeople(people);
    near(); await settle(cs, 4);
    far(); await settle(cs, 0);
    const after1 = counts();
    const baked = cs.clipLibrary.bakedCount;
    for (let round = 0; round < 6; round++) {
      near(); await settle(cs, 4);
      far(); await settle(cs, 0);
    }
    expect(counts()).toEqual(after1);
    expect(cs.clipLibrary.bakedCount).toBe(baked); // baked once, not per visit
    cs.dispose();
  }, 60000);

  it('an unloaded character file takes its baked clips with it', async () => {
    const cs = system(0);
    cs.setPeople(people);
    near(); await settle(cs, 4);
    expect(cs.clipLibrary.bakedCount).toBeGreaterThan(0);
    far(); await settle(cs, 0);
    await new Promise((r) => setTimeout(r, 5));
    cs.update(); // nobody near uses it: unloaded (unloadAfterMs 0)
    expect(cs.unloads).toBe(1);
    expect(cs.loadedFiles).not.toContain('/c/suit.glb');
    expect(cs.clipLibrary.bakedCount).toBe(0);
    // walking back: loaded and baked again, posed as before
    near(); await settle(cs, 4);
    expect(cs.clipLibrary.bakedCount).toBeGreaterThan(0);
    cs.dispose();
  }, 60000);
});
