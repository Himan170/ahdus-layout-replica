import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { getMaterials } from '../materialLibrary';
import { configureLook, setRealistic } from '../realLook';

// Node has no canvas: a texture whose 2D context takes every drawing call
vi.mock('@babylonjs/core/Materials/Textures/dynamicTexture', () => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : () => ctx), set: () => true });
  class DynamicTexture {
    constructor(name) { this.name = name; }
    getContext() { return ctx; }
    update() {}
    dispose() {}
  }
  return { DynamicTexture };
});

// v0.17.0: with the realistic look, room surfaces are not painted while their photo textures load (painting the
// tiles was 13 % of a slow laptop's loading): a flat colour first, the picture only when it is needed.
let engine;
let scene;
beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('room surfaces painted only when needed (v0.17.0)', () => {
  it('realistic look on: a flat colour while the photos load; the look off: painted', () => {
    configureLook(scene, { realistic: true, baseUrl: 'http://127.0.0.1:9/never/' });
    const lib = getMaterials(scene);
    const wall = lib.plaster();
    const floor = lib.floor('carpet');
    expect(wall.name).toBe('mat_plaster');
    expect(wall.diffuseTexture).toBeFalsy();
    expect(floor.diffuseTexture).toBeFalsy();
    expect(wall.diffuseColor.r).toBeGreaterThan(0.8); // about the plaster's colour, not black
    setRealistic(scene, false);
    expect(wall.diffuseTexture).toBeTruthy();
    expect(floor.diffuseTexture).toBeTruthy();
  });

  it('realistic look off from the start: painted at once, as before', () => {
    configureLook(scene, { realistic: false });
    const wall = getMaterials(scene).plaster();
    expect(wall.diffuseTexture).toBeTruthy();
  });

  it('grass and paving (no photo twin) are always painted', () => {
    configureLook(scene, { realistic: true, baseUrl: 'http://127.0.0.1:9/never/' });
    const lib = getMaterials(scene);
    expect(lib.grass().diffuseTexture).toBeTruthy();
    expect(lib.paving().diffuseTexture).toBeTruthy();
  });
});
