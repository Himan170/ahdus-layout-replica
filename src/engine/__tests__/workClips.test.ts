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
import { HIPS_ABOVE_SEAT, SEAT_HEIGHT } from '../../play/people';

// v0.16.0: people at desks posed by their clips: Type at a desk with a keyboard, Sit at another, Idle standing;
// the nearest few play it, the rest hold its first frame. Our own placeholder figure + clip set.
const FILES: Record<string, Uint8Array> = {
  'suit.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-suit.glb')),
  'clips.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-clips.glb')),
  'mixamo.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-mixamo.glb')),
};

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0) =>
  ({ id, assetType, floor: 0, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects = {
  d1: obj('d1', 'DESK_STANDARD', 0, 0),
  c1: obj('c1', 'CHAIR_OFFICE', 0, 0.7, Math.PI),
  k1: { ...obj('k1', 'KEYBOARD', 0.1, -0.1), y: 0.75 }, // on d1: its person types
  d3: obj('d3', 'DESK_STANDARD', 0, 3),
  c3: obj('c3', 'CHAIR_OFFICE', 0, 3.7, Math.PI), // nothing on d3: sits
  d2: obj('d2', 'DESK_STANDARD', 4, 0), // no chair: stands
};

let engine: NullEngine;
let scene: Scene;

function system(extra: Partial<ConstructorParameters<typeof CharacterSystem>[1]> = {}) {
  return new CharacterSystem(scene, {
    getLayout: () => ({ objects, floors, currentFloor: 0 }),
    getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    loadFile: (url, sc) => registerGltfExtensions().then(() =>
      LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], sc, GLB_LOAD_OPTIONS)),
    ...extra,
  });
}

const suit = { url: '/c/suit.glb', height: 1.74, outfit: 'rocketbox' as const, clips: '/c/clips.glb' };
const person = (personId: string, deskId: string, character: Person['character'] = suit): Person =>
  ({ personId, deskId, name: personId, department: 'Engineering', character });

/** Until every full character is posed by its clip (baking pauses between clips). */
async function settled(cs: CharacterSystem, ids: string[]) {
  for (let i = 0; i < 200; i++) {
    cs.update();
    await cs.whenSettled();
    (cs as any).lastChoice = -Infinity;
    cs.update();
    if (ids.every((id) => cs.fullState(id)?.clip)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('not posed by their clips');
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.activeCamera = new FreeCamera('cam', new Vector3(0, 1.6, -3), scene);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('people at desks with clips (v0.16.0)', () => {
  it('types at a desk with a keyboard, sits at another, stands idle at a desk with no chair; all play', async () => {
    const cs = system();
    cs.setPeople([person('typist', 'd1'), person('sitter', 'd3'), person('stander', 'd2')]);
    await settled(cs, ['typist', 'sitter', 'stander']);
    expect(cs.fullState('typist')).toMatchObject({ clip: 'Type', playing: true });
    expect(cs.fullState('sitter')).toMatchObject({ clip: 'Sit', playing: true });
    expect(cs.fullState('stander')).toMatchObject({ clip: 'Idle', playing: true });
    expect(cs.animatedCount).toBe(3);
    // each person plays their own clone; the clip data is baked once per clip
    expect(cs.clipLibrary.bakes).toBe(3);
    cs.dispose();
    expect(scene.animationGroups).toHaveLength(0);
  });

  it('the hips go onto the seat in the clip\'s own sitting pose', async () => {
    const cs = system();
    cs.setPeople([person('sitter', 'd3')]);
    await settled(cs, ['sitter']);
    const hips = cs.fullState('sitter')!.bones.get('Hips')!;
    const size = 1.74 / 1.75;
    expect(hips.getAbsolutePosition().y).toBeCloseTo(SEAT_HEIGHT + HIPS_ABOVE_SEAT * size, 2);
    cs.dispose();
  });

  it('only the nearest maxAnimated play; the others hold the first frame, and swap as the camera moves', async () => {
    const cs = system({ maxAnimated: 1 });
    cs.setPeople([person('typist', 'd1'), person('sitter', 'd3')]);
    await settled(cs, ['typist', 'sitter']);
    expect(cs.fullState('typist')!.playing).toBe(true); // nearer the camera (z −3)
    expect(cs.fullState('sitter')!.playing).toBe(false);
    expect(cs.animatedCount).toBe(1);
    scene.activeCamera!.position.set(0, 1.6, 6);
    (scene.activeCamera as FreeCamera).computeWorldMatrix();
    (cs as any).lastChoice = -Infinity;
    cs.update();
    expect(cs.fullState('sitter')!.playing).toBe(true);
    expect(cs.fullState('typist')!.playing).toBe(false);
    cs.dispose();
  });

  it('a character with no clips (an old Mixamo file) keeps the procedural pose', async () => {
    const cs = system();
    cs.setPeople([person('old', 'd1', { url: '/c/mixamo.glb', height: 1.75 })]);
    for (let i = 0; i < 20; i++) {
      cs.update();
      await cs.whenSettled();
      (cs as any).lastChoice = -Infinity;
      await new Promise((r) => setTimeout(r, 10));
    }
    cs.update();
    expect(cs.fullCount).toBe(1);
    expect(cs.fullState('old')).toMatchObject({ clip: null, playing: false });
    cs.dispose();
  });
});
