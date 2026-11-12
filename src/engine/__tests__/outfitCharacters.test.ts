import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { registerGltfExtensions } from '../../utils/gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../../utils/modelLoader';
import { CharacterSystem } from '../systems/CharacterSystem';
import type { Person } from '../systems/CharacterSystem';
import { createPlayerCharacter } from '../systems/PlayerCharacter';
import { TROUSER_TINTS } from '../../play/outfit';

// v0.16.0: the Wardrobe's outfit on people at desks and on you, with our Rocketbox-like test figures
const FILES: Record<string, Uint8Array> = {
  'suit.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-suit.glb')),
  'own.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-own.glb')),
  'mixamo.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-mixamo.glb')),
};

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0) =>
  ({ id, assetType, floor: 0, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects = {
  d1: obj('d1', 'DESK_STANDARD', 0, 0), c1: obj('c1', 'CHAIR_OFFICE', 0, 0.7, Math.PI),
  d2: obj('d2', 'DESK_STANDARD', 2, 0), c2: obj('c2', 'CHAIR_OFFICE', 2, 0.7, Math.PI),
  d3: obj('d3', 'DESK_STANDARD', 4, 0), c3: obj('c3', 'CHAIR_OFFICE', 4, 0.7, Math.PI),
  d4: obj('d4', 'DESK_STANDARD', 6, 0), c4: obj('c4', 'CHAIR_OFFICE', 6, 0.7, Math.PI),
};

let engine: NullEngine;
let scene: Scene;

const load = async (url: string, sc: Scene) => {
  await registerGltfExtensions();
  return LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], sc, GLB_LOAD_OPTIONS);
};

function system() {
  return new CharacterSystem(scene, {
    getLayout: () => ({ objects, floors, currentFloor: 0 }),
    getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    loadFile: load,
  });
}

async function settle(cs: CharacterSystem) {
  cs.update();
  await cs.whenSettled();
  (cs as any).lastChoice = -Infinity;
  cs.update();
}

const rocketbox = (file: string) => ({ url: `/chars/${file}`, height: 1.74, outfit: 'rocketbox' as const });
const person = (personId: string, deskId: string, character: Person['character'], clothing: Person['clothing'] = null): Person =>
  ({ personId, deskId, name: personId, department: 'HR', character, clothing });

/** A person's meshes by part name. */
function parts(personId: string): Map<string, AbstractMesh> {
  const root = scene.getTransformNodeByName(`person_${personId}`)!;
  return new Map(root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0).map((m) => [m.name, m]));
}
const shownParts = (p: Map<string, AbstractMesh>) => [...p].filter(([, m]) => m.isEnabled()).map(([n]) => n).sort();
const albedo = (m: AbstractMesh) => (m.material as unknown as { albedoColor: Color3 }).albedoColor;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.activeCamera = new FreeCamera('cam', new Vector3(3, 1.6, -3), scene);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('outfits in 3D (v0.16.0)', () => {
  it('people at desks wear what they chose: suit, own suit, shirt, T-shirt; tints shared, the file untouched', async () => {
    const cs = system();
    cs.setPeople([
      person('formal', 'd1', rocketbox('suit.glb')), // never chose: Office formal
      person('own', 'd2', rocketbox('own.glb'), { upperBody: null }),
      person('shirt', 'd3', rocketbox('suit.glb'), { pantsColor: 'blue', upperBody: 'shirt', upperColor: '#336699' }),
      person('shirt2', 'd4', rocketbox('suit.glb'), { pantsColor: 'blue', upperBody: 'shirt', upperColor: '#336699' }),
    ]);
    await settle(cs);
    expect(cs.fullCount).toBe(4);

    expect(shownParts(parts('formal'))).toEqual(['Body', 'Hair', 'Outfit_formal', 'Skin_formal']);
    expect(shownParts(parts('own'))).toEqual(['Body', 'Hair', 'Outfit_original', 'Skin_original']);
    const shirt = parts('shirt');
    expect(shownParts(shirt)).toEqual(['Body', 'Hair', 'Shoes', 'Skin_shirt', 'Top_shirt', 'Trousers']);

    // trousers: their own colour (light grey) × the blue tint, in linear space
    const grey = albedo(parts('formal').get('Trousers')!); // a hidden part keeps the file's material
    const blue = Color3.FromHexString(TROUSER_TINTS.blue).toLinearSpace();
    const trousers = albedo(shirt.get('Trousers')!);
    expect(trousers.r).toBeCloseTo(grey.r * blue.r, 5);
    expect(trousers.b).toBeCloseTo(grey.b * blue.b, 5);
    expect(albedo(shirt.get('Top_shirt')!).b).toBeCloseTo(Color3.FromHexString('#336699').toLinearSpace().b * albedo(parts('formal').get('Top_shirt')!).b, 5);
    // two people in the same look share the tinted materials; the file's own material is not changed
    expect(parts('shirt2').get('Trousers')!.material).toBe(shirt.get('Trousers')!.material);
    expect(parts('formal').get('Trousers')!.material).not.toBe(shirt.get('Trousers')!.material);
    expect(albedo(parts('formal').get('Trousers')!)).toEqual(grey);
    cs.dispose();
    expect(scene.materials.filter((m) => m.name.includes('#'))).toHaveLength(0);
  });

  it('clothing changed = made again; an older character keeps its own outfit', async () => {
    const cs = system();
    cs.setPeople([person('a', 'd1', rocketbox('suit.glb')), person('m', 'd2', { url: '/chars/mixamo.glb' }, { upperBody: 'shirt' })]);
    await settle(cs);
    expect(shownParts(parts('a'))).toContain('Outfit_formal');
    const mixamoParts = [...parts('m').values()];
    expect(mixamoParts.every((m) => m.isEnabled())).toBe(true);

    cs.setPeople([person('a', 'd1', rocketbox('suit.glb'), { upperBody: 'tshirt' }), person('m', 'd2', { url: '/chars/mixamo.glb' })]);
    await settle(cs);
    expect(shownParts(parts('a'))).toEqual(['Body', 'Hair', 'Shoes', 'Skin_tee', 'Top_tee', 'Trousers']);
    cs.dispose();
  });

  it('your character walking through wears your clothing too', async () => {
    const cs = system();
    const me = await createPlayerCharacter(scene, {
      character: rocketbox('suit.glb'), clothing: { pantsColor: 'black', upperBody: 'tshirt', upperColor: '#aa0000' },
    }, (url) => cs.loadFile(url));
    const mine = new Map(me.root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0).map((m) => [m.name, m]));
    expect([...mine].filter(([, m]) => m.isEnabled()).map(([n]) => n).sort())
      .toEqual(['Body', 'Hair', 'Shoes', 'Skin_tee', 'Top_tee', 'Trousers']);
    expect(albedo(mine.get('Top_tee')!).g).toBeCloseTo(0, 5); // white × #aa0000
    me.dispose();
    cs.dispose();
  });
});
