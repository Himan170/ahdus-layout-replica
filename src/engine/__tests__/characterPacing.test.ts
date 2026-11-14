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

// v0.17.0: the building first, then the people one at a time, with no CPU skinning for their boxes.
const FILES: Record<string, Uint8Array> = {
  'mixamo.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-mixamo.glb')),
};
const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0) =>
  ({ id, assetType, floor: 0, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects: Record<string, ReturnType<typeof obj>> = {};
for (let i = 0; i < 3; i++) {
  objects[`d${i}`] = obj(`d${i}`, 'DESK_STANDARD', i * 2, 0);
  objects[`c${i}`] = obj(`c${i}`, 'CHAIR_OFFICE', i * 2, 0.7, Math.PI);
}
const people: Person[] = Array.from({ length: 3 }, (_, i) => ({
  personId: `p${i}`, deskId: `d${i}`, name: `P${i}`, department: 'E', character: { url: '/c/mixamo.glb', height: 1.75 },
}));

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  // looking at (0, 0, 0): p0's desk is the nearest to the point looked at
  scene.activeCamera = new FreeCamera('cam', new Vector3(2, 1.6, -3), scene);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

const loads: string[] = [];
function system(extra: Partial<ConstructorParameters<typeof CharacterSystem>[1]> = {}) {
  return new CharacterSystem(scene, {
    getLayout: () => ({ objects, floors, currentFloor: 0 }),
    getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    loadFile: (url, sc) => {
      loads.push(url);
      return registerGltfExtensions().then(() => LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], sc, GLB_LOAD_OPTIONS));
    },
    ...extra,
  });
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('people after the building, one at a time (v0.17.0)', () => {
  it('no character file while not ready (simple figures meanwhile); then they come', async () => {
    loads.length = 0;
    let ready = false;
    const cs = system({ ready: () => ready, makeEveryMs: 0 });
    cs.setPeople(people);
    for (let i = 0; i < 5; i++) { cs.update(); await tick(); }
    expect(loads).toEqual([]);
    expect(cs.fullCount).toBe(0);
    expect(scene.getMeshByName('people_seated')!.isEnabled()).toBe(true);
    ready = true;
    for (let i = 0; i < 100 && cs.fullCount < 3; i++) {
      (cs as any).lastChoice = -Infinity;
      cs.update();
      await cs.whenSettled();
      await tick(5);
    }
    expect(loads).toEqual(['/c/mixamo.glb']);
    expect(cs.fullCount).toBe(3);
    cs.dispose();
  });

  it('makes at most one full character per makeEveryMs, the nearest first', async () => {
    const cs = system({ makeEveryMs: 150 });
    cs.setPeople(people);
    // until the file is loaded and the first one is made
    for (let i = 0; i < 100 && cs.fullCount === 0; i++) {
      (cs as any).lastChoice = -Infinity;
      cs.update();
      await cs.whenSettled();
      await tick(5);
    }
    expect(cs.fullCount).toBe(1);
    expect(cs.fullState('p0')).not.toBeNull(); // the nearest to the point looked at
    (cs as any).lastChoice = -Infinity;
    cs.update();
    expect(cs.fullCount).toBe(1); // not yet: 150 ms between two
    await tick(170);
    cs.update(); // the next choice comes by itself after 150 ms (no lastChoice reset)
    expect(cs.fullCount).toBe(2);
    cs.dispose();
  });

  it('full characters skip the CPU-skinned box: a cube about their rest box holds the pose', async () => {
    const cs = system({ makeEveryMs: 0 });
    cs.setPeople(people.slice(0, 1));
    for (let i = 0; i < 100 && cs.fullCount === 0; i++) {
      (cs as any).lastChoice = -Infinity;
      cs.update();
      await cs.whenSettled();
      await tick(5);
    }
    const root = scene.getTransformNodeByName('person_p0')!;
    const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    expect(meshes.length).toBeGreaterThan(0);
    // a cube about the rest box, big enough for the seated pose (the knees, the feet), culled as any mesh
    const cs2 = cs as any;
    const bones: Map<string, any> = cs2.full.get('p0').bones;
    for (const m of meshes) {
      expect(m.alwaysSelectAsActiveMesh).toBe(false);
      m.computeWorldMatrix(true);
      const box = m.getBoundingInfo().boundingBox;
      const e = box.extendSize;
      expect(e.x).toBeCloseTo(e.y, 5);
      expect(e.y).toBeCloseTo(e.z, 5);
      for (const name of ['Hips', 'LeftFoot', 'RightFoot', 'Head', 'LeftHand']) {
        const at = bones.get(name)?.getAbsolutePosition();
        if (!at) continue;
        expect(at.x).toBeGreaterThan(box.minimumWorld.x); expect(at.x).toBeLessThan(box.maximumWorld.x);
        expect(at.y).toBeGreaterThan(box.minimumWorld.y); expect(at.y).toBeLessThan(box.maximumWorld.y);
        expect(at.z).toBeGreaterThan(box.minimumWorld.z); expect(at.z).toBeLessThan(box.maximumWorld.z);
      }
    }
    cs.dispose();
  });
});
