import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';

import { StaticShadows, casterSignature, READY_CHECK_FRAMES } from '../systems/StaticShadows';

// v0.17.0: the viewer's shadows are drawn once, and again only when what casts them changes.
let engine: NullEngine;
afterEach(() => engine?.dispose());

function setup() {
  engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera('cam', new Vector3(0, 5, -10), scene);
  const sun = new DirectionalLight('sun', new Vector3(-0.6, -1.6, 1.1), scene);
  const generator = new ShadowGenerator(256, sun);
  const box = MeshBuilder.CreateBox('desk', { size: 1 }, scene);
  generator.addShadowCaster(box, false);
  let key: unknown[] = ['layout 1'];
  const shadows = new StaticShadows(scene, generator, sun, { layoutKey: () => key });
  const frames = (n: number) => { for (let i = 0; i < n; i++) scene.render(); };
  return { scene, sun, generator, box, shadows, frames, setKey: (k: unknown[]) => { key = k; } };
}

describe('StaticShadows (v0.17.0)', () => {
  it('draws the map once (then once more when its shaders are ready), and keeps the sun\'s box', () => {
    const { sun, generator, shadows, frames } = setup();
    expect(generator.getShadowMap()!.refreshRate).toBe(RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
    let drawn = 0;
    generator.getShadowMap()!.onBeforeRenderObservable.add(() => { drawn++; });
    frames(1);
    expect(drawn).toBe(1);
    expect(shadows.refreshes).toBe(1);
    expect(sun.autoUpdateExtends).toBe(false);
    frames(READY_CHECK_FRAMES + 2);
    const settled = shadows.refreshes;
    expect(settled).toBeLessThanOrEqual(2);
    const drawnSettled = drawn;
    frames(50);
    expect(shadows.refreshes).toBe(settled);
    expect(drawn).toBe(drawnSettled); // the map itself is not drawn again
  });

  it('draws again when a caster is added, removed, hidden, the layout changes or shadows come back on', () => {
    const { scene, sun, generator, box, shadows, frames, setKey } = setup();
    frames(READY_CHECK_FRAMES + 2);
    let n = shadows.refreshes;
    const chair = MeshBuilder.CreateBox('chair', { size: 0.5 }, scene);
    generator.addShadowCaster(chair, false);
    frames(1);
    expect(shadows.refreshes).toBe(++n);
    frames(READY_CHECK_FRAMES + 2);
    n = shadows.refreshes;
    box.setEnabled(false); // another floor shown
    frames(1);
    expect(shadows.refreshes).toBe(n + 1);
    frames(READY_CHECK_FRAMES + 2);
    n = shadows.refreshes;
    setKey(['layout 2']);
    frames(1);
    expect(shadows.refreshes).toBe(n + 1);
    frames(READY_CHECK_FRAMES + 2);
    n = shadows.refreshes;
    sun.shadowEnabled = false;
    frames(3);
    expect(shadows.refreshes).toBe(n); // nothing drawn while off
    sun.shadowEnabled = true;
    frames(1);
    expect(shadows.refreshes).toBe(n + 1);
    frames(READY_CHECK_FRAMES + 2);
    n = shadows.refreshes;
    chair.dispose();
    frames(1);
    expect(shadows.refreshes).toBe(n + 1);
  });

  it('the signature counts only the shown casters; dispose puts the generator back', () => {
    const { box, generator, shadows } = setup();
    const list = generator.getShadowMap()!.renderList!;
    const on = casterSignature(list);
    box.isVisible = false;
    expect(casterSignature(list)).not.toBe(on);
    expect(casterSignature(null)).toBe('');
    const wrapped = generator.addShadowCaster;
    shadows.dispose();
    expect(generator.addShadowCaster).not.toBe(wrapped);
  });
});
