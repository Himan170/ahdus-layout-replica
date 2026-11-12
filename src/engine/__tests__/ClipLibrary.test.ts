import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { registerGltfExtensions } from '../../utils/gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../../utils/modelLoader';
import { copyCharacter } from '../systems/CharacterSystem';
import type { CharacterFile, LoadedFile } from '../systems/CharacterSystem';
import { Animator, ClipLibrary, CLIP_NAMES, refreshChain } from '../systems/ClipLibrary';
import { createPlayerCharacter, legsOf, liftLegs } from '../systems/PlayerCharacter';
import type { Leg } from '../systems/PlayerCharacter';

// v0.16.0: clips baked once per character file, cloned per person, played with cross-fades. Our own figures.
const FILES: Record<string, Uint8Array> = {
  'suit.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-suit.glb')),
  'clips.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-clips.glb')),
  'mixamo.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-mixamo.glb')),
};

let engine: NullEngine;
let scene: Scene;
let loads: string[];
const files = new Map<string, Promise<LoadedFile>>();

const loadFile = (url: string): Promise<LoadedFile> => {
  if (!files.has(url)) {
    loads.push(url);
    files.set(url, registerGltfExtensions().then(() =>
      LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], scene, GLB_LOAD_OPTIONS)).then((container: AssetContainer): LoadedFile => ({ container })));
  }
  return files.get(url)!;
};

const suit: CharacterFile = { url: '/c/suit.glb', height: 1.74, outfit: 'rocketbox', clips: '/c/clips.glb' };

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  loads = [];
  files.clear();
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('ClipLibrary (v0.16.0)', () => {
  it('bakes every clip of the set onto the character, matching all bones that share a name', async () => {
    const lib = new ClipLibrary(scene, loadFile);
    const file = await loadFile(suit.url);
    const clips = await lib.clips(suit, file, CLIP_NAMES);
    expect([...clips.keys()]).toEqual(['Idle', 'Walk', 'Run', 'Wave', 'Sit', 'Type']);
    const walk = clips.get('Walk')!;
    // not only the 22 bones the poses use: the toes' and fingers' ends too
    const keys = walk.tracks.map((t) => t.key);
    expect(keys).toContain('LeftHandMiddle4');
    expect(keys).toContain('HeadTop_End');
    expect(keys.length).toBeGreaterThan(22);
    // the face bone is only in the character: not animated
    expect(keys).not.toContain('Bip01 MJaw');
    // walking and running move (m/s at the character's size), the rest don't
    expect(walk.speed).toBeGreaterThan(0.8);
    expect(walk.speed).toBeLessThan(1.6);
    expect(clips.get('Run')!.speed).toBeGreaterThan(walk.speed! * 2);
    for (const n of ['Idle', 'Wave', 'Sit', 'Type']) expect(clips.get(n)!.speed).toBeNull();
    // the clip's forward motion is taken out (the controls move you), the bob stays
    const hips = walk.tracks.find((t) => t.key === 'Hips' && t.animation.targetProperty === 'position')!.animation;
    const first = hips.evaluate(0) as Vector3;
    const last = hips.evaluate(walk.frames) as Vector3;
    expect(Math.abs(last.z - first.z)).toBeLessThan(0.01);
  });

  it('sitting lowers the hips; the clip set is loaded once and each clip baked once per character', async () => {
    const lib = new ClipLibrary(scene, loadFile);
    const file = await loadFile(suit.url);
    const [a, b] = await Promise.all([lib.clip(suit, file, 'Sit'), lib.clip(suit, file, 'sit')]);
    expect(a).toBe(b);
    await lib.clip(suit, file, 'Idle');
    expect(lib.bakes).toBe(2);
    // the copies made for baking are gone again
    expect(scene.transformNodes.filter((n) => n.name.startsWith('clip_'))).toHaveLength(0);
    expect(loads).toEqual(['/c/suit.glb', '/c/clips.glb']);
    const hipsY = (clip: typeof a) => (clip!.tracks.find((t) => t.key === 'Hips' && t.animation.targetProperty === 'position')!
      .animation.evaluate(clip!.frames / 2) as Vector3).y;
    const idle = await lib.clip(suit, file, 'Idle');
    expect(hipsY(idle) - hipsY(a)).toBeGreaterThan(0.25);
  });

  it('no clip set and none in its own file: nothing to play (the held pose)', async () => {
    const lib = new ClipLibrary(scene, loadFile);
    const old: CharacterFile = { url: '/c/mixamo.glb', height: 1.75 };
    expect(ClipLibrary.sourceOf(old)).toBe('/c/mixamo.glb');
    expect(await lib.clip(old, await loadFile(old.url), 'Walk')).toBeNull();
    expect(await lib.clip(suit, await loadFile(suit.url), 'Dance')).toBeNull();
  });
});

describe('Animator (v0.16.0)', () => {
  async function person(name: string) {
    const lib = (globalThis as any).__lib ??= new ClipLibrary(scene, loadFile);
    const file = await loadFile(suit.url);
    const copy = copyCharacter(scene, file, suit, name);
    const animator = new Animator(scene, copy.allBones, name);
    for (const clip of (await lib.clips(suit, file, CLIP_NAMES)).values()) animator.add(clip);
    return { copy, animator };
  }
  afterEach(() => { delete (globalThis as any).__lib; });

  it('each person plays clones on their own bones; the keys are shared', async () => {
    const a = await person('a');
    const b = await person('b');
    const ga = a.animator.groupOf('Walk')!;
    const gb = b.animator.groupOf('Walk')!;
    expect(ga).not.toBe(gb);
    expect(ga.targetedAnimations[0].animation).toBe(gb.targetedAnimations[0].animation);
    const hipsA = ga.targetedAnimations.find((t) => t.animation.targetProperty === 'position')!.target;
    expect(hipsA).toBe(a.copy.allBones.get('Hips'));
    expect(hipsA).not.toBe(b.copy.allBones.get('Hips'));
  });

  it('cross-fades: Idle → Walk over 0.25 s, the old clip stops when it has faded out', async () => {
    const { animator } = await person('p');
    expect(animator.play('Idle', { fade: 0 })).toBe(true);
    expect(animator.weights()).toMatchObject({ Idle: 1, Walk: 0 });
    animator.play('Walk', { speed: 1.5 });
    expect(animator.current).toBe('Walk');
    animator.update(0.125);
    expect(animator.weights()).toMatchObject({ Idle: 0.5, Walk: 0.5 });
    expect(animator.groupOf('Walk')!.speedRatio).toBe(1.5);
    animator.update(0.2);
    expect(animator.weights()).toMatchObject({ Idle: 0, Walk: 1 });
    expect(animator.groupOf('Idle')!.isPlaying).toBe(false);
    expect(animator.groupOf('Walk')!.isPlaying).toBe(true);
    expect(animator.play('Moonwalk')).toBe(false);
    expect(animator.current).toBe('Walk');
  });

  it('a wave plays once, then back to what was playing', async () => {
    const { animator } = await person('w');
    animator.play('Idle', { fade: 0 });
    animator.play('Wave', { once: true });
    animator.update(0.3);
    expect(animator.current).toBe('Wave');
    animator.update(2); // the placeholder wave is 2 s
    expect(animator.current).toBe('Idle');
    animator.update(0.3);
    expect(animator.weights()).toMatchObject({ Wave: 0, Idle: 1 });
    animator.stop(0);
    expect(Object.values(animator.weights()).every((w) => w === 0)).toBe(true);
    animator.dispose();
    expect(scene.animationGroups.filter((g) => g.name.startsWith('w_'))).toHaveLength(0);
  });
});

describe('your character with clips (v0.16.0)', () => {
  const spec = { character: suit, walkClipUrl: null };

  it('stands in its Idle, walks, runs with Shift, stands while flying', async () => {
    const lib = new ClipLibrary(scene, loadFile);
    const me = await createPlayerCharacter(scene, spec, loadFile, lib);
    expect(me.kind).toBe('full');
    expect(me.gait).toBe('Idle');
    expect(me.walking).toBe(false);
    expect(me.walkSpeed).toBeGreaterThan(0.8);
    me.update(0.05, 2.2, false);
    expect(me.gait).toBe('Walk');
    expect(me.walking).toBe(true);
    // played as fast as you move (no foot sliding)
    expect(me.walkGroup!.speedRatio).toBeCloseTo(2.2 / me.walkSpeed!, 5);
    me.update(0.05, 4.5, false);
    expect(me.gait).toBe('Run');
    me.update(0.05, 4.5, true);
    expect(me.gait).toBe('Idle');
    me.dispose();
    expect(scene.animationGroups.filter((g) => g.name.startsWith('player_'))).toHaveLength(0);
  });

  it('waves standing still (H), then back to Idle; not while walking', async () => {
    const me = await createPlayerCharacter(scene, spec, loadFile, new ClipLibrary(scene, loadFile));
    me.update(0.05, 2.2, false);
    expect(me.wave!()).toBe(false);
    me.update(0.05, 0, false);
    expect(me.wave!()).toBe(true);
    expect(me.gait).toBe('Wave');
    for (let i = 0; i < 12; i++) me.update(0.25, 0, false); // the placeholder wave is 2 s
    expect(me.gait).toBe('Idle');
    me.dispose();
  });

  it('no clips (an old Mixamo file, no walk clip): the standing pose, as in v0.12', async () => {
    const old: CharacterFile = { url: '/c/mixamo.glb', height: 1.75 };
    const me = await createPlayerCharacter(scene, { character: old }, loadFile, new ClipLibrary(scene, loadFile));
    expect(me.walkGroup).toBeNull();
    me.update(0.05, 2.2, false);
    expect(me.walking).toBe(false);
    me.dispose();
  });

  it('on stairs the forward leg is lifted: its foot higher, the other leg as it was', async () => {
    const file = await loadFile(suit.url);
    const copy = copyCharacter(scene, file, suit, 'stairs');
    const legs = legsOf(copy);
    expect(legs).toHaveLength(2);
    const [left, right] = legs;
    // the left leg swung forward (as in a walk), the right one straight down
    turn(left, 0.5);
    const leftBefore = footOf(left);
    const rightBefore = footOf(right);
    liftLegs(copy, legs, 0); // no lift: nothing moves
    expect(footOf(left).subtract(leftBefore).length()).toBeLessThan(1e-6);
    liftLegs(copy, legs, 1);
    expect(footOf(left).y - leftBefore.y).toBeGreaterThan(0.05);
    expect(footOf(right).subtract(rightBefore).length()).toBeLessThan(0.01);
  });
});

function footOf(leg: Leg): Vector3 {
  refreshChain(leg.foot);
  return leg.foot.getAbsolutePosition().clone();
}

/** Swing a thigh forward by `a` (about the character's right axis, the leg's own sign). */
function turn(leg: Leg, a: number): void {
  const parent = leg.thigh.parent as TransformNode;
  refreshChain(parent);
  const axis = Vector3.TransformNormal(new Vector3(1, 0, 0), parent.getWorldMatrix().clone().invert()).normalize();
  leg.thigh.rotationQuaternion = Quaternion.RotationAxis(axis, leg.hipSign * a).multiply(leg.thigh.rotationQuaternion!);
}
