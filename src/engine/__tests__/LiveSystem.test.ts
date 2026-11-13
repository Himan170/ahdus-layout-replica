// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: no Node types in this project (vitest runs in Node)
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { registerGltfExtensions } from '../../utils/gltfExtensions';
import { GLB_LOAD_OPTIONS } from '../../utils/modelLoader';
import { CharacterSystem } from '../systems/CharacterSystem';
import type { Person } from '../systems/CharacterSystem';
import { LiveSystem, clampTagX, TAG_EDGE } from '../systems/LiveSystem';
import { FullCapMonitor } from '../systems/FullCap';
import { STAND_BEHIND_SEAT, LIVE_DELAY_MS, SILENT_MS } from '../../play/live';

// v0.16.1: live presence with FAKE live people (no server): our own placeholder figure + clip set.
const FILES: Record<string, Uint8Array> = {
  'suit.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-suit.glb')),
  'clips.glb': new Uint8Array(readFileSync('public/assets/characters/placeholder-clips.glb')),
};

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const obj = (id: string, assetType: string, x: number, z: number, rotationY = 0, floor = 0) =>
  ({ id, assetType, floor, x, y: 0, z, rotationY, rotationX: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 });
const objects = {
  d1: obj('d1', 'DESK_STANDARD', 0, 0),
  c1: obj('c1', 'CHAIR_OFFICE', 0, 0.7, Math.PI), // faces the desk (−Z)
  d3: obj('d3', 'DESK_STANDARD', 0, 3),
  c3: obj('c3', 'CHAIR_OFFICE', 0, 3.7, Math.PI),
};
const suit = { url: '/c/suit.glb', height: 1.74, outfit: 'rocketbox' as const, clips: '/c/clips.glb' };
const person = (personId: string, deskId: string): Person => ({ personId, deskId, name: personId, department: 'Sales', character: suit });

let engine: NullEngine;
let scene: Scene;
let clock: number;
let walker: { x: number; z: number; floor: number } | null;
let me: string | null;
let layout: { objects: typeof objects; floors: typeof floors; currentFloor: number };

function systems(opts: { characters?: boolean } = {}) {
  const characters = opts.characters === false ? null : new CharacterSystem(scene, {
    getLayout: () => layout,
    getObjectMesh: () => ({ isEnabled: () => true, isDisposed: () => false }),
    loadFile: (url, sc) => registerGltfExtensions().then(() => LoadAssetContainerAsync(FILES[url.replace(/^.*\//, '')], sc, GLB_LOAD_OPTIONS)),
  });
  const live = new LiveSystem(scene, {
    getLayout: () => layout,
    characters,
    seatOf: (id) => characters?.getPlaced().find((p) => p.personId === id) ?? null,
    getWalker: () => walker,
    getMe: () => me,
    now: () => clock,
  });
  return { characters, live };
}

/** Frames every 16 ms until `t` (the fake clock). */
function runTo(live: LiveSystem, t: number) {
  while (clock < t) {
    clock = Math.min(t, clock + 16);
    live.frame();
  }
}

/** Someone walking along +x at 2 m/s from x0, a sample every 200 ms from now to `until`. */
function walk(live: LiveSystem, id: string, x0: number, until: number, z = 6) {
  const start = clock;
  for (let t = start; t <= until; t += 200) {
    runTo(live, t);
    live.update(id, { floor: 0, x: x0 + ((t - start) / 1000) * 2, z, yaw: Math.PI / 2, state: 'walk' });
  }
}

const at = (live: LiveSystem, id: string) => live.list().find((p) => p.personId === id)!;
const seatedShown = (cs: CharacterSystem) => cs.getPlaced().filter((p) => (cs as any).isShown(p)).map((p) => p.personId);

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.activeCamera = new FreeCamera('cam', new Vector3(0, 1.6, -3), scene);
  clock = 1000;
  walker = null;
  me = null;
  layout = { objects, floors, currentFloor: 0 };
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('live people (v0.16.1)', () => {
  it('a live person leaves their desk, is drawn where they walk, and sits back down when removed', () => {
    const { characters, live } = systems();
    characters!.setPeople([person('asha', 'd1'), person('ravi', 'd3')]);
    expect(seatedShown(characters!).sort()).toEqual(['asha', 'ravi']);
    live.add({ personId: 'asha', name: 'Asha Patel', floor: 0, x: 1, z: 6, yaw: 0, state: 'idle' });
    expect(seatedShown(characters!)).toEqual(['ravi']);
    runTo(live, 1500);
    expect(at(live, 'asha')).toMatchObject({ name: 'Asha Patel', floor: 0, drawn: 'figure', at: { x: 1, z: 6 } });
    const figure = scene.getMeshByName('live_people') as Mesh;
    expect(figure.isEnabled()).toBe(true);
    expect(figure.thinInstanceCount).toBe(1);
    expect(live.remove('asha')).toBe(true);
    runTo(live, 1600);
    expect(seatedShown(characters!).sort()).toEqual(['asha', 'ravi']);
    expect(figure.isEnabled()).toBe(false);
    live.dispose();
    characters!.dispose();
  });

  it(`glides ${LIVE_DELAY_MS} ms behind the samples, and snaps a jump over 5 m`, () => {
    const { live } = systems({ characters: false });
    live.add({ personId: 'p1', floor: 0, x: 0, z: 6, state: 'walk' });
    walk(live, 'p1', 0, 3000);
    const x = at(live, 'p1').at!.x;
    // the last sample: x 4 at t 3000; drawn 250 ms behind ≈ 3.5, the spring a little behind that
    expect(x).toBeGreaterThan(3.2);
    expect(x).toBeLessThan(3.55);
    // every frame moves a little, never a jump
    let prev = x;
    for (let i = 0; i < 20; i++) {
      runTo(live, clock + 16);
      const now = at(live, 'p1').at!.x;
      expect(Math.abs(now - prev)).toBeLessThan(0.1);
      prev = now;
    }
    // Back to entrance: 30 m away = a snap when its time comes, never a slide through the walls
    live.update('p1', { floor: 0, x: 30, z: 6, state: 'idle' });
    runTo(live, clock + LIVE_DELAY_MS - 40);
    expect(at(live, 'p1').at!.x).toBeLessThan(5);
    runTo(live, clock + 80);
    expect(at(live, 'p1').at!.x).toBe(30);
    live.dispose();
  });

  it(`silent for ${SILENT_MS / 1000} s: back to their desk by themselves; an update keeps them`, () => {
    const { characters, live } = systems();
    characters!.setPeople([person('asha', 'd1')]);
    live.add({ personId: 'asha', floor: 0, x: 1, z: 6, state: 'idle' });
    runTo(live, clock + 8000);
    live.update('asha', { floor: 0, x: 1, z: 6, state: 'idle' }); // the keepalive
    runTo(live, clock + 8000);
    expect(live.count).toBe(1);
    runTo(live, clock + 2100);
    expect(live.count).toBe(0);
    expect(seatedShown(characters!)).toEqual(['asha']);
    live.dispose();
    characters!.dispose();
  });

  it('on the page but looking from above: standing beside their desk', () => {
    const { characters, live } = systems();
    characters!.setPeople([person('asha', 'd1')]);
    live.add({ personId: 'asha', state: 'overview', floor: 0 });
    runTo(live, clock + 400);
    const p = at(live, 'asha');
    expect(p.atDesk).toBe(true);
    // the chair at z 0.7 faces −Z (the desk): they stand behind it
    expect(p.at!.x).toBeCloseTo(0);
    expect(p.at!.z).toBeCloseTo(0.7 + STAND_BEHIND_SEAT);
    expect(p.drawn).not.toBeNull();
    // then they start walking: drawn there
    live.update('asha', { floor: 0, x: 8, z: 8, state: 'walk' });
    runTo(live, clock + 400);
    expect(at(live, 'asha')).toMatchObject({ atDesk: false, at: { x: 8, z: 8 } });
    live.dispose();
    characters!.dispose();
  });

  it('the nearest 30 on the floor shown; another floor, no position or yourself: not drawn', () => {
    const { live } = systems({ characters: false });
    for (let i = 0; i < 40; i++) live.add({ personId: `p${String(i).padStart(2, '0')}`, floor: 0, x: i, z: 0, state: 'idle' });
    live.add({ personId: 'upstairs', floor: 1, x: 0, z: 0, state: 'idle' });
    live.add({ personId: 'elsewhere', floor: 1 }); // walking on another floor: no position here
    live.add({ personId: 'me', floor: 0, x: 0.5, z: 0, state: 'idle' });
    me = 'me';
    walker = { x: 0, z: 0, floor: 0 };
    runTo(live, clock + 400);
    const drawn = live.list().filter((p) => p.drawn).map((p) => p.personId);
    expect(drawn).toHaveLength(30);
    expect(drawn).toContain('p00');
    expect(drawn).not.toContain('p35');
    expect(drawn).not.toContain('upstairs');
    expect(drawn).not.toContain('elsewhere');
    expect(drawn).not.toContain('me');
    expect((scene.getMeshByName('live_people') as Mesh).thinInstanceCount).toBe(30);
    walker = { x: 0, z: 0, floor: 1 };
    runTo(live, clock + 400);
    expect(live.list().filter((p) => p.drawn).map((p) => p.personId)).toEqual(['upstairs']);
    live.dispose();
  });

  it('near ones are full characters (up to the cap), walking with their clips; the wave plays once', async () => {
    const { characters, live } = systems();
    live.setFullCap(1);
    live.add({ personId: 'near', name: 'Near', character: suit, floor: 0, x: 0, z: 2, state: 'idle' });
    live.add({ personId: 'far', name: 'Far', character: suit, floor: 0, x: 0, z: 5, state: 'idle' });
    for (let i = 0; i < 300 && !scene.getTransformNodeByName('live_near'); i++) {
      clock += 300;
      live.frame();
      await characters!.whenSettled();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(scene.getTransformNodeByName('live_near')).toBeTruthy();
    expect(scene.getTransformNodeByName('live_far')).toBeNull();
    expect(at(live, 'near').drawn).toBe('full');
    expect(at(live, 'far').drawn).toBe('figure');
    expect(live.fullCount).toBe(1);
    expect(live.wantedFull).toBe(2);
    const walkerOf = () => (live as any).entries.get('near').walker;
    walk(live, 'near', 0, clock + 1000, 2);
    expect(walkerOf().gait).toBe('Walk');
    live.update('near', { floor: 0, x: 2.4, z: 2, state: 'wave' });
    runTo(live, clock + 600);
    expect(walkerOf().gait).toBe('Wave');
    // the cap raised: the far one becomes a full character too
    live.setFullCap(2);
    for (let i = 0; i < 300 && !scene.getTransformNodeByName('live_far'); i++) {
      clock += 300;
      live.frame();
      await characters!.whenSettled();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(at(live, 'far').drawn).toBe('full');
    live.remove('near');
    expect(scene.getTransformNodeByName('live_near')).toBeNull();
    live.dispose();
    characters!.dispose();
  });

  it('name tags: one per person drawn, in the tag layer, gone when they leave', () => {
    const { live } = systems({ characters: false });
    const layer = document.createElement('div');
    live.setTagLayer(layer);
    live.add({ personId: 'asha', name: 'Asha Patel', floor: 0, x: 0, z: 4, state: 'idle' });
    live.add({ personId: 'nameless', floor: 0, x: 1, z: 4, state: 'idle' });
    runTo(live, clock + 400);
    // NullEngine draws nothing: place the tags as after a frame
    (live as any).placeTags();
    expect([...layer.querySelectorAll('[data-live-tag]')].map((t) => t.getAttribute('data-live-tag'))).toEqual(['asha']);
    expect(layer.textContent).toBe('Asha Patel');
    live.remove('asha');
    (live as any).placeTags();
    expect(layer.querySelectorAll('[data-live-tag]')).toHaveLength(0);
    live.dispose();
  });
});

describe('the full-character cap (v0.16.1)', () => {
  it('rises on a smooth device while more are wanted, stays 12 on a weak one, measures only while built', () => {
    let weak = false;
    let measuring = true;
    const cap = new FullCapMonitor({ weak: () => weak, wanted: () => 30, measuring: () => measuring });
    let t = 0;
    const frames = (fps: number, ms: number) => { for (const end = t + ms; t < end; t += 1000 / fps) cap.frame(1000 / fps, t); };
    expect(cap.cap).toBe(12);
    frames(60, 7000);
    expect(cap.cap).toBe(16);
    frames(60, 20_000);
    expect(cap.cap).toBe(24);
    frames(25, 3500);
    expect(cap.cap).toBe(20);
    measuring = false;
    frames(10, 10_000); // building, or a hidden tab: says nothing
    expect(cap.cap).toBe(20);
    measuring = true;
    weak = true;
    frames(60, 3500);
    expect(cap.cap).toBe(12);
    expect(new FullCapMonitor({ weak: () => false, wanted: () => 30, measuring: () => true, fixed: 6 }).cap).toBe(6);
  });
});

describe('name tags near the side of the view (v0.16.1)', () => {
  it('a tag stays inside the view; a view narrower than the tag leaves it where it is', () => {
    expect(clampTagX(200, 40, 390)).toBe(200);
    expect(clampTagX(380, 40, 390)).toBe(390 - 40 - TAG_EDGE);
    expect(clampTagX(10, 40, 390)).toBe(40 + TAG_EDGE);
    expect(clampTagX(50, 100, 150)).toBe(50);
    expect(clampTagX(50, 40, 0)).toBe(50);
  });
});

describe('the v0.16.1 review', () => {
  it('a name with HTML in it is shown as plain text, never as markup', () => {
    const { live } = systems({ characters: false });
    const layer = document.createElement('div');
    live.setTagLayer(layer);
    const evil = '<img src=x onerror=alert(1)>';
    live.add({ personId: 'mallory', name: evil, floor: 0, x: 0, z: 4, state: 'idle' });
    runTo(live, clock + 400);
    (live as any).placeTags();
    expect(layer.textContent).toBe(evil);
    expect(layer.querySelector('img')).toBeNull();
    expect(layer.querySelector('[data-live-tag="mallory"]')!.innerHTML).toContain('&lt;img');
    // a new name later: the same, as text
    live.update('mallory', { name: '<script>alert(2)</script>' });
    (live as any).placeTags();
    expect(layer.querySelector('script')).toBeNull();
    expect(layer.textContent).toBe('<script>alert(2)</script>');
    live.dispose();
  });

  it('a live person with no desk: removed or silent 10 s, they simply disappear (no desk to sit at)', () => {
    const { characters, live } = systems();
    characters!.setPeople([person('asha', 'd1')]);
    const layer = document.createElement('div');
    live.setTagLayer(layer);
    live.add({ personId: 'visitor', name: 'Visitor', floor: 0, x: 1, z: 5, state: 'idle' });
    live.add({ personId: 'guest', name: 'Guest', floor: 0, x: -1, z: 5, state: 'idle' });
    live.add({ personId: 'deskless', name: 'Deskless', floor: 0, state: 'overview' }); // from above, no desk
    runTo(live, clock + 400);
    (live as any).placeTags();
    expect(live.list().filter((p) => p.drawn).map((p) => p.personId).sort()).toEqual(['guest', 'visitor']);
    expect(at(live, 'deskless')).toMatchObject({ drawn: null, at: null }); // nowhere to stand up from
    expect(seatedShown(characters!)).toEqual(['asha']); // nobody else is seated, Asha untouched
    expect(live.remove('visitor')).toBe(true);
    runTo(live, clock + 400);
    (live as any).placeTags();
    expect(live.list().map((p) => p.personId).sort()).toEqual(['deskless', 'guest']);
    expect(layer.querySelector('[data-live-tag="visitor"]')).toBeNull();
    expect(seatedShown(characters!)).toEqual(['asha']);
    // the others go silent
    runTo(live, clock + SILENT_MS + 500);
    (live as any).placeTags();
    expect(live.list()).toEqual([]);
    expect(layer.querySelectorAll('[data-live-tag]')).toHaveLength(0);
    expect((scene.getMeshByName('live_people') as Mesh | null)?.isEnabled() ?? false).toBe(false);
    expect(seatedShown(characters!)).toEqual(['asha']);
    live.dispose();
    characters!.dispose();
  });

  it('bad live data is ignored safely: nothing thrown, nothing drawn at NaN, nobody on a floor that does not exist', () => {
    const { characters, live } = systems();
    characters!.setPeople([person('asha', 'd1')]);
    for (const raw of [null, undefined, 7, 'x', {}, { personId: '' }]) expect(live.add(raw as any)).toBe(false);
    expect(live.add({ personId: 'nan', floor: 0, x: NaN, z: 1, yaw: NaN, state: 'walk' } as any)).toBe(true);
    expect(live.add({ personId: 'far', floor: 99, x: 1, z: 1, state: 'walk' })).toBe(true);
    expect(live.add({ personId: 'odd', floor: -3 as any, x: Infinity, z: 'a' as any, state: 'fly' as any, name: 'N'.repeat(9999) })).toBe(true);
    expect(live.update('nan', null as any)).toBe(true);
    expect(live.update('nan', { x: Infinity, z: -Infinity, y: NaN } as any)).toBe(true);
    expect(live.update('nobody', { x: 1, z: 1 })).toBe(false);
    expect(() => runTo(live, clock + 1000)).not.toThrow();
    const list = live.list();
    expect(list.map((p) => p.personId).sort()).toEqual(['far', 'nan', 'odd']);
    expect(list.every((p) => !p.drawn)).toBe(true); // no position here, or a floor that isn't shown
    expect(list.find((p) => p.personId === 'odd')!.name).toHaveLength(120);
    for (const p of list) if (p.at) expect([p.at.x, p.at.y, p.at.z].every(Number.isFinite)).toBe(true);
    const figure = scene.getMeshByName('live_people') as Mesh | null;
    if (figure?.thinInstanceCount) expect([...figure.thinInstanceGetWorldMatrices().flatMap((m) => [...m.m])].every(Number.isFinite)).toBe(true);
    expect(seatedShown(characters!)).toEqual(['asha']);
    live.dispose();
    characters!.dispose();
  });

  it('the cap never goes above 24, even when a page asks for more', () => {
    expect(new FullCapMonitor({ weak: () => false, wanted: () => 99, measuring: () => true, fixed: 100 }).cap).toBe(24);
    expect(new FullCapMonitor({ weak: () => false, wanted: () => 99, measuring: () => true, fixed: NaN }).cap).toBe(12);
  });
});
