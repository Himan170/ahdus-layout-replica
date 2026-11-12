import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { registerGltfExtensions } from '../../utils/gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../../utils/modelLoader';

// v0.16.0: our own Rocketbox-like figures and clip set (scripts/make-placeholder-character.mjs), so the public repo's
// tests never need Harsh's files.
const file = (name: string) => new Uint8Array(readFileSync(`public/assets/characters/${name}`));

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('placeholder Rocketbox-like figures (v0.16.0)', () => {
  it('both REQUIRE meshopt + quantization, like the Rocketbox files', () => {
    for (const name of ['placeholder-suit.glb', 'placeholder-own.glb']) {
      const data = file(name);
      const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + new DataView(data.buffer, data.byteOffset).getUint32(12, true))));
      expect(json.extensionsRequired).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    }
  });

  it('load through our loader: the Rocketbox part names, one skeleton, Mixamo + face bone names', async () => {
    await registerGltfExtensions();
    const suit = await LoadAssetContainerAsync(file('placeholder-suit.glb'), scene, GLB_LOAD_OPTIONS);
    const parts = suit.meshes.map((m) => m.name).filter((n) => n !== '__root__').sort();
    expect(parts).toEqual(['Body', 'Hair', 'Outfit_formal', 'Shoes', 'Skin_formal', 'Skin_shirt', 'Skin_tee',
      'Top_shirt', 'Top_tee', 'Trousers']);
    expect(suit.skeletons).toHaveLength(1);
    const bones = suit.skeletons[0].bones.map((b) => b.name);
    expect(bones).toContain('mixamorig:Hips');
    expect(bones).toContain('Bip01 MJaw');
    // one material per part, named like it (the tints recolour them)
    expect(suit.materials.map((m) => m.name).sort()).toEqual(parts);

    const own = await LoadAssetContainerAsync(file('placeholder-own.glb'), scene, GLB_LOAD_OPTIONS);
    const ownParts = own.meshes.map((m) => m.name);
    expect(ownParts).toContain('Outfit_original');
    expect(ownParts).toContain('Skin_original');
    expect(ownParts).not.toContain('Outfit_formal');
  });

  it('the clip set: Idle, Walk, Run, Wave, Sit, Type, no mesh', async () => {
    const clips = await LoadAssetContainerAsync(file('placeholder-clips.glb'), scene, GLB_LOAD_OPTIONS);
    expect(clips.animationGroups.map((g) => g.name)).toEqual(['Idle', 'Walk', 'Run', 'Wave', 'Sit', 'Type']);
    expect(clips.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
    // our loader starts none of them
    expect(clips.animationGroups.some((g) => g.isStarted)).toBe(false);
  });
});
