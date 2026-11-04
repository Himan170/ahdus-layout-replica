import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';

import { createPlayerCharacter, bakeWalk } from '../systems/PlayerCharacter';
import type { PlayCharacter } from '../systems/PlayerCharacter';
import { copyCharacter, refreshTree } from '../systems/CharacterSystem';
import type { LoadedFile } from '../systems/CharacterSystem';
import { playerEyeHeight } from '../../play/people';

// Our own placeholder figures and walk clip (scripts/make-placeholder-character.mjs): the clip walks 1.2 m a second
const FILES: Record<string, Uint8Array> = {
  'mixamo.glb': readFileSync('public/assets/characters/placeholder-mixamo.glb'),
  'ue.glb': readFileSync('public/assets/characters/placeholder-ue.glb'),
  'walk.glb': readFileSync('public/assets/characters/placeholder-walk.glb'),
};

let engine: NullEngine;
let scene: Scene;
let loads: string[];
const cache = new Map<string, Promise<LoadedFile>>();
const loadFile = (url: string) => {
  loads.push(url);
  if (!cache.has(url)) {
    const data = FILES[url];
    cache.set(url, data
      ? LoadAssetContainerAsync(new Uint8Array(data), scene, { pluginExtension: '.glb' }).then((container) => ({ container }))
      : Promise.reject(new Error(`404 ${url}`)));
  }
  return cache.get(url)!;
};

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  loads = [];
  cache.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  scene.dispose();
  engine.dispose();
});

/** The player's bone (by its Mixamo name), from the meshes' skeleton. */
function bone(c: PlayCharacter, name: string, rig: 'mixamo' | 'ue' = 'mixamo'): TransformNode {
  const ue: Record<string, string> = { Hips: 'pelvis', LeftFoot: 'foot_l', RightFoot: 'foot_r', LeftArm: 'upperarm_l', LeftHand: 'hand_l' };
  const wanted = rig === 'ue' ? ue[name] : `mixamorig:${name}`;
  const node = c.root.getDescendants(false).find((n) => n.name === wanted) as TransformNode | undefined;
  if (!node) throw new Error(`no bone ${wanted}`);
  return node;
}

/** Put the walk at a frame (what the scene's animation would do), in the character's frame. */
function at(group: AnimationGroup, frame: number, root: TransformNode) {
  for (const { animation, target } of group.targetedAnimations) {
    const v = animation.evaluate(frame);
    (target as Record<string, unknown>)[animation.targetProperty] = v?.clone ? v.clone() : v;
  }
  refreshTree(root);
}

const quarter = (group: AnimationGroup) => group.from + (group.to - group.from) / 4;

describe('walking as yourself: the player character', () => {
  it('a Mixamo character walks with the clip: own copy, eye height from its height, the clip\'s speed', async () => {
    const c = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb', rig: 'mixamo', height: 1.75 }, walkClipUrl: 'walk.glb' }, loadFile);
    expect(c.kind).toBe('full');
    expect(c.root.name).toBe('player_character');
    expect(c.eyeHeight).toBeCloseTo(playerEyeHeight(1.75), 3);
    expect(c.eyeHeight).toBeCloseTo(1.62, 2);
    // the clip walks 1.2 m in its 1 s cycle (root motion), scaled to this figure's hips (0.95 / 0.93 m)
    expect(c.walkSpeed!).toBeGreaterThan(1.15);
    expect(c.walkSpeed!).toBeLessThan(1.3);
    expect(c.root.getChildMeshes(false).every((m) => !m.isPickable && m.metadata?.player)).toBe(true);
    // a quarter into the cycle the left thigh is forward, the right one back (the character faces +Z)
    at(c.walkGroup!, quarter(c.walkGroup!), c.root);
    const hips = bone(c, 'Hips').getAbsolutePosition();
    expect(bone(c, 'LeftFoot').getAbsolutePosition().z - hips.z).toBeGreaterThan(0.15);
    expect(bone(c, 'RightFoot').getAbsolutePosition().z - hips.z).toBeLessThan(-0.15);
    // the forward motion is taken out: the hips stay over the feet
    for (const f of [0, quarter(c.walkGroup!), c.walkGroup!.to]) {
      at(c.walkGroup!, f, c.root);
      expect(Math.abs(bone(c, 'Hips').getAbsolutePosition().z)).toBeLessThan(0.05);
    }
  });

  it('an Unreal-style skeleton (rig "ue") walks with the same Mixamo clip, by the bone table', async () => {
    const c = await createPlayerCharacter(scene, { character: { url: 'ue.glb', rig: 'ue', height: 1.68 }, walkClipUrl: 'walk.glb' }, loadFile);
    expect(c.walkGroup).not.toBeNull();
    expect(c.eyeHeight).toBeCloseTo(playerEyeHeight(1.68), 3);
    at(c.walkGroup!, quarter(c.walkGroup!), c.root);
    const hips = bone(c, 'Hips', 'ue').getAbsolutePosition();
    expect(bone(c, 'LeftFoot', 'ue').getAbsolutePosition().z - hips.z).toBeGreaterThan(0.12);
    expect(bone(c, 'RightFoot', 'ue').getAbsolutePosition().z - hips.z).toBeLessThan(-0.12);
  });

  it('rest-pose correction: a leg whose bones are twisted another way still swings forward, not sideways (a plain copy of the rotations fails here)', async () => {
    const file = await loadFile('ue.glb');
    const clip = await loadFile('walk.glb');
    const copy = copyCharacter(scene, file, { url: 'ue.glb', rig: 'ue', height: 1.75 }, 'twisted');
    // The left thigh's rest pose tipped a quarter turn (as Unreal skeletons have their bones along another axis),
    // the knee's offset stored in that turned frame, so every joint stays where it was. Copying the clip's local
    // rotations would throw the knee out to the side; the correction keeps the leg swinging forward.
    refreshTree(copy.root);
    const knee = copy.bones.get('LeftLeg')!;
    const footBefore = copy.bones.get('LeftFoot')!.getAbsolutePosition().clone();
    const thigh = copy.bones.get('LeftUpLeg')!;
    const tip = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 2);
    thigh.rotationQuaternion = (thigh.rotationQuaternion ?? Quaternion.Identity()).multiply(tip);
    knee.position = knee.position.applyRotationQuaternion(Quaternion.Inverse(tip));
    knee.rotationQuaternion = Quaternion.Inverse(tip).multiply(knee.rotationQuaternion ?? Quaternion.Identity());
    refreshTree(copy.root);
    const footRest = copy.bones.get('LeftFoot')!.getAbsolutePosition().clone();
    expect(Vector3.Distance(footRest, footBefore)).toBeLessThan(1e-4);
    const walk = bakeWalk(scene, clip.container, copy)!;
    expect(walk).not.toBeNull();
    at(walk.group, quarter(walk.group), copy.root);
    const hips = copy.bones.get('Hips')!.getAbsolutePosition();
    const foot = copy.bones.get('LeftFoot')!.getAbsolutePosition();
    expect(foot.z - hips.z).toBeGreaterThan(0.12);   // forward
    expect(Math.abs(foot.x - footRest.x)).toBeLessThan(0.05); // not out to the side
  });

  it('plays as fast as you move; standing still or flying = the standing pose', async () => {
    const c = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb', height: 1.75 }, walkClipUrl: 'walk.glb' }, loadFile);
    expect(c.walking).toBe(false);
    c.update(0.016, 4.2, false);
    expect(c.walking).toBe(true);
    expect(c.walkGroup!.isPlaying).toBe(true);
    expect(c.walkGroup!.speedRatio).toBeCloseTo(4.2 / c.walkSpeed!, 3);
    c.update(0.016, 2.1, false);
    expect(c.walkGroup!.speedRatio).toBeCloseTo(2.1 / c.walkSpeed!, 3);
    c.update(0.016, 0, false);
    expect(c.walking).toBe(false);
    expect(c.walkGroup!.isPlaying).toBe(false);
    // standing: the arms hang down (the T-pose's arms are level with the shoulders)
    refreshTree(c.root);
    expect(bone(c, 'LeftHand').getAbsolutePosition().y).toBeLessThan(bone(c, 'LeftArm').getAbsolutePosition().y - 0.3);
    c.update(0.016, 9, true);
    expect(c.walking).toBe(false); // flying
  });

  it('each file is loaded once; dispose removes the copy and keeps the shared materials', async () => {
    const a = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb' }, walkClipUrl: 'walk.glb' }, loadFile);
    a.dispose();
    const b = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb' }, walkClipUrl: 'walk.glb' }, loadFile);
    expect(cache.size).toBe(2);
    expect(scene.getTransformNodeByName('walk_clip')).toBeNull(); // the clip's sampling copy is gone
    expect(a.root.isDisposed()).toBe(true);
    expect(scene.materials).toContain(b.root.getChildMeshes(false).find((m) => m.material)!.material); // still in the scene, shared
    b.dispose();
  });

  it('no walk clip, a clip that fails or walk: false: the character stands (and slides); a bad file rejects', async () => {
    const none = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb' } }, loadFile);
    const failed = await createPlayerCharacter(scene, { character: { url: 'mixamo.glb' }, walkClipUrl: 'missing.glb' }, loadFile);
    const off = await createPlayerCharacter(scene, { character: { url: 'ue.glb', rig: 'ue' }, walkClipUrl: 'walk.glb', walk: false }, loadFile);
    for (const c of [none, failed, off]) {
      expect(c.kind).toBe('full');
      expect(c.walkSpeed).toBeNull();
      c.update(0.016, 4.2, false);
      expect(c.walking).toBe(false);
    }
    expect(loads).not.toContain('walk.glb'); // walk: false doesn't even download it
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not load the walk clip missing.glb'), expect.anything());
    await expect(createPlayerCharacter(scene, { character: { url: 'nobody.glb' } }, loadFile)).rejects.toThrow('404');
  });
});
