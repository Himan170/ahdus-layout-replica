import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
// the placeholder figures REQUIRE these two, like the office characters (utils/modelLoader.js registers them for the
// app; e2e:characters checks that path)
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';

import { CharacterSystem } from '../systems/CharacterSystem';
import type { Person } from '../systems/CharacterSystem';
import { canonicalBoneName } from '../../play/people';

// The placeholder characters (scripts/make-placeholder-character.mjs): real skinned glTF files
const FILES: Record<string, Uint8Array> = {
  'mixamo.glb': readFileSync('public/assets/characters/placeholder-mixamo.glb'),
  'ue.glb': readFileSync('public/assets/characters/placeholder-ue.glb'),
};

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0, floor = 0) =>
  ({ id, assetType, floor, x, y: 0, z, rotationY, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects = {
  d1: obj('d1', 'DESK_STANDARD', 0, 0),
  c1: obj('c1', 'CHAIR_OFFICE', 0, 0.7, Math.PI), // faces the desk (-Z)
  d2: obj('d2', 'DESK_STANDARD', 4, 0), // no chair: they stand at its +Z side
  d3: obj('d3', 'DESK_STANDARD', 0, 3),
  c3: obj('c3', 'CHAIR_OFFICE', 0, 3.7, Math.PI),
  d4: obj('d4', 'DESK_STANDARD', 0, 0, 0, 1), // upstairs
};

let engine: NullEngine;
let scene: Scene;
let shown: Record<string, boolean>;
let loads: string[];
let active: number;
let most: number;

function system(extra: Partial<ConstructorParameters<typeof CharacterSystem>[1]> = {}) {
  return new CharacterSystem(scene, {
    getLayout: () => ({ objects, floors, currentFloor: 0 }),
    getObjectMesh: (id) => (id in shown ? { isEnabled: () => shown[id], isDisposed: () => false } : null),
    loadFile: async (url, sc) => {
      loads.push(url);
      active++;
      most = Math.max(most, active);
      try {
        await new Promise((r) => setTimeout(r, 5));
        const data = FILES[url.replace(/^.*\//, '')];
        if (!data) throw new Error(`404 ${url}`);
        return await LoadAssetContainerAsync(new Uint8Array(data), sc, { pluginExtension: '.glb' });
      } finally {
        active--;
      }
    },
    ...extra,
  });
}

async function settle(cs: CharacterSystem) {
  cs.update();
  await cs.whenSettled();
  (cs as any).lastChoice = -Infinity;
  cs.update();
}

/** A full character's bones by their Mixamo name. */
function bonesOf(personId: string, rig: 'mixamo' | 'ue' = 'mixamo') {
  const root = scene.getTransformNodeByName(`person_${personId}`)!;
  const map = new Map<string, TransformNode>();
  for (const n of root.getDescendants(false) as TransformNode[]) {
    const key = canonicalBoneName(n.name, rig);
    if (key && !map.has(key)) map.set(key, n);
  }
  return map;
}
const dirOf = (bones: Map<string, TransformNode>, a: string, b: string) =>
  bones.get(b)!.getAbsolutePosition().subtract(bones.get(a)!.getAbsolutePosition()).normalize();

const person = (personId: string, deskId: string, file: string | null, rig: 'mixamo' | 'ue' = 'mixamo'): Person => ({
  personId, deskId, name: `Name ${personId}`, department: 'Engineering',
  character: file ? { url: `/chars/${file}`, rig, height: 1.75 } : null,
});

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  const camera = new FreeCamera('cam', new Vector3(1, 1.6, -3), scene);
  scene.activeCamera = camera;
  shown = { d1: true, d2: true, d3: true, d4: true };
  loads = [];
  active = 0;
  most = 0;
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('CharacterSystem', () => {
  it('seats a Mixamo character on the chair: thighs forward, shins down, hips on the seat', async () => {
    const cs = system();
    cs.setPeople([person('p1', 'd1', 'mixamo.glb')]);
    await settle(cs);
    expect(cs.fullCount).toBe(1);
    const bones = bonesOf('p1');
    // the chair faces -Z (towards the desk): forward is -Z
    expect(dirOf(bones, 'LeftUpLeg', 'LeftLeg').z).toBeLessThan(-0.9);
    expect(dirOf(bones, 'RightUpLeg', 'RightLeg').z).toBeLessThan(-0.9);
    expect(dirOf(bones, 'LeftLeg', 'LeftFoot').y).toBeLessThan(-0.9);
    expect(dirOf(bones, 'Spine', 'Spine1').y).toBeGreaterThan(0.9);
    expect(dirOf(bones, 'LeftForeArm', 'LeftHand').z).toBeLessThan(-0.8); // onto the desk
    const hips = bones.get('Hips')!.getAbsolutePosition();
    expect(hips.y).toBeCloseTo(0.46 + 0.1, 2);
    expect(hips.x).toBeCloseTo(0, 2);
    expect(hips.z).toBeCloseTo(0.7 + 0.08, 2); // a little behind the seat's centre
    // the left leg is still on the person's left (the side they face from: -Z forward → left is +X)
    expect(bones.get('LeftUpLeg')!.getAbsolutePosition().x).toBeGreaterThan(0);
    // not pickable: a pick goes to the desk
    expect(scene.meshes.filter((m) => m.metadata?.personId).every((m) => !m.isPickable)).toBe(true);
    cs.dispose();
  });

  it('poses an Unreal-style rig (Victoria) through the same bone table', async () => {
    const cs = system();
    cs.setPeople([person('v', 'd1', 'ue.glb', 'ue')]);
    await settle(cs);
    expect(cs.fullCount).toBe(1);
    const bones = bonesOf('v', 'ue');
    expect(bones.has('Hips') && bones.has('LeftUpLeg')).toBe(true);
    expect(dirOf(bones, 'LeftUpLeg', 'LeftLeg').z).toBeLessThan(-0.9);
    expect(dirOf(bones, 'RightLeg', 'RightFoot').y).toBeLessThan(-0.9);
    expect(bones.get('Hips')!.getAbsolutePosition().y).toBeCloseTo(0.56, 2);
    cs.dispose();
  });

  it('stands a person at a desk with no chair: on the floor, arms down, facing the desk', async () => {
    const cs = system();
    cs.setPeople([person('s', 'd2', 'mixamo.glb')]);
    await settle(cs);
    const bones = bonesOf('s');
    expect(dirOf(bones, 'LeftArm', 'LeftForeArm').y).toBeLessThan(-0.9);
    expect(dirOf(bones, 'RightArm', 'RightForeArm').y).toBeLessThan(-0.9);
    const root = scene.getTransformNodeByName('person_s')!;
    const body = root.getChildMeshes(false).find((m) => m.getTotalVertices() > 0)!;
    body.refreshBoundingInfo({ applySkeleton: true });
    const bb = body.getBoundingInfo().boundingBox;
    expect(bb.minimumWorld.y).toBeCloseTo(0, 1);
    expect(bb.maximumWorld.y).toBeCloseTo(1.75, 1);
    expect(root.position.z).toBeCloseTo(0.75, 1); // the desk's work side (+Z, where a chair would be)
    // facing -Z (towards the desk): their left is +X
    expect(bones.get('LeftUpLeg')!.getAbsolutePosition().x).toBeGreaterThan(4);
    cs.dispose();
  });

  it('loads each file once, at most 3 at once, and copies it with its own skeleton per person', async () => {
    // two people sharing one file
    const cs = system();
    cs.setPeople([person('p1', 'd1', 'mixamo.glb'), person('p3', 'd3', 'mixamo.glb')]);
    await settle(cs);
    expect(loads).toEqual(['/chars/mixamo.glb']);
    expect(cs.fullCount).toBe(2);
    const skeletons = new Set(scene.meshes.filter((m) => m.metadata?.personId && m.skeleton).map((m) => m.skeleton));
    expect(skeletons.size).toBe(2);
    cs.dispose();

    // six people near the camera, six different files (all missing): never more than 3 downloads at once
    loads = [];
    const row = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`r${i}`, obj(`r${i}`, 'DESK_STANDARD', i * 2 - 5, 0)]));
    const many = system({ getLayout: () => ({ objects: row, floors, currentFloor: 0 }), getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }) });
    many.setPeople(Object.keys(row).map((deskId, i) => ({ personId: `m${i}`, deskId, character: { url: `/chars/missing${i}.glb` } })));
    await settle(many);
    expect(loads).toHaveLength(6);
    expect(most).toBe(3);
    expect(many.fullCount).toBe(0);
    many.dispose();
  });

  it('loadFile waits its turn while every slot is busy, ahead of the people still queued (the walk clip)', async () => {
    // AHDUS: three seated people's files filled the 3 slots when walking started, and the walk clip was refused
    FILES['clip.glb'] = FILES['mixamo.glb'];
    const cs = system({ maxDownloads: 1 });
    cs.setPeople([person('p1', 'd1', 'mixamo.glb'), person('p3', 'd3', 'ue.glb')]);
    cs.update(); // mixamo.glb downloading, ue.glb queued
    const clip = cs.loadFile('/chars/clip.glb');
    const again = cs.loadFile('/chars/clip.glb');
    const loaded = await clip;
    expect(loaded.container).toBeTruthy();
    expect(await again).toBe(loaded);
    await settle(cs);
    expect(loads).toEqual(['/chars/mixamo.glb', '/chars/clip.glb', '/chars/ue.glb']);
    expect(cs.fullCount).toBe(2);
    // a file that can't be loaded still rejects after waiting
    const busy = system({ maxDownloads: 1 });
    busy.setPeople([person('p1', 'd1', 'mixamo.glb')]);
    busy.update();
    await expect(busy.loadFile('/chars/missing.glb')).rejects.toThrow('404');
    // closed while waiting: rejects
    const closed = system({ maxDownloads: 1 });
    closed.setPeople([person('p1', 'd1', 'mixamo.glb')]);
    closed.update();
    const waiting = closed.loadFile('/chars/clip.glb');
    closed.dispose();
    await expect(waiting).rejects.toThrow('closed');
    await expect(closed.loadFile('/chars/clip.glb')).rejects.toThrow('closed');
    cs.dispose();
    busy.dispose();
    delete FILES['clip.glb'];
  });

  it('keeps the simple figure when a file fails, and draws people with no character as simple figures', async () => {
    const cs = system();
    cs.setPeople([person('n', 'd1', null), { ...person('f', 'd3', null), character: { url: '/chars/broken.glb' } }, person('s', 'd2', null)]);
    await settle(cs);
    expect(cs.fullCount).toBe(0);
    const seated = scene.getMeshByName('people_seated') as Mesh;
    const standing = scene.getMeshByName('people_standing') as Mesh;
    expect(seated.thinInstanceCount).toBe(2);
    expect(standing.thinInstanceCount).toBe(1);
    expect(seated.isPickable).toBe(false);
    cs.dispose();
  });

  it('follows the desk: hidden floor or unbuilt desk = not drawn; the simple look = nothing at all', async () => {
    const cs = system();
    cs.setPeople([person('p1', 'd1', 'mixamo.glb'), person('up', 'd4', null)]);
    await settle(cs);
    const seated = scene.getMeshByName('people_seated') as Mesh;
    const standing = scene.getMeshByName('people_standing') as Mesh;
    expect(cs.fullCount).toBe(1);
    expect(standing.thinInstanceCount).toBe(1); // upstairs, no chair
    shown.d4 = false; // its floor hidden
    shown.d1 = false;
    cs.update();
    expect(standing.isEnabled()).toBe(false);
    expect(cs.fullCount).toBe(0);
    shown.d1 = true;
    shown.d4 = true;
    cs.update();
    expect(cs.fullCount).toBe(1);
    cs.setEnabled(false);
    expect(cs.fullCount).toBe(0);
    expect(seated.isEnabled() || standing.isEnabled()).toBe(false);
    expect(scene.meshes.filter((m) => m.metadata?.personId)).toHaveLength(0);
    cs.dispose();
  });

  it('finds the person at a desk or chair, and near a point on their floor', () => {
    const cs = system();
    cs.setPeople([person('p1', 'd1', null), person('up', 'd4', null), person('ghost', 'nope', null)]);
    expect(cs.getPlaced().map((p) => p.personId)).toEqual(['p1', 'up']); // no desk 'nope'
    expect(cs.personForObject('d1')?.personId).toBe('p1');
    expect(cs.personForObject('c1')?.personId).toBe('p1');
    expect(cs.personForObject('d2')).toBeNull();
    expect(cs.personAt({ x: 0.2, z: 0.7 }, 0)?.name).toBe('Name p1');
    // the same spot upstairs: the person standing at d4 (no chair there)
    expect(cs.personAt({ x: 0.2, z: 0.7 }, 1)?.name).toBe('Name up');
    expect(cs.personAt({ x: 0.2, z: -0.7 }, 1)).toBeNull();
    // one desk, one person
    cs.setPeople([person('a', 'd1', null), person('b', 'd1', null)]);
    expect(cs.getPlaced().map((p) => p.personId)).toEqual(['a']);
    cs.dispose();
  });

  it('seats people again when their desk moves', async () => {
    const cs = system();
    const layout = { objects: { ...objects }, floors, currentFloor: 0 };
    const moving = new CharacterSystem(scene, {
      getLayout: () => layout,
      getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    });
    moving.setPeople([person('p', 'd2', null)]);
    expect(moving.getPlaced()[0].x).toBe(4);
    layout.objects = { ...layout.objects, d2: { ...objects.d2, x: 6 } };
    expect(moving.getPlaced()[0].x).toBe(6);
    moving.dispose();
    cs.dispose();
  });
});
