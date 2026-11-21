// v0.18.7 (Astra audit 12): 2D ↔ 3D never switches the sun's shadows off. Doing so (sun.shadowEnabled = false) left
// every material drawing with its shadow shader until it compiled again, with no shadow map bound: Direct3D's ANGLE
// rejected those draws ("Mismatch between texture format and sampler type", 40+ per switch). Now 2D only hides the
// shadows (darkness 1) and stops drawing the shadow map; 3D puts both back.
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { createLighting, setLighting2D, setLighting3D } from '../lightingSetup';

describe('2D lighting keeps the shadow shader valid (v0.18.7)', () => {
  it('2D: shadows still enabled (no material changes), invisible, the map not drawn; 3D: back as they were', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const { hemispheric, directional, shadowGenerator } = createLighting(scene);
    const map = shadowGenerator.getShadowMap();
    const darkness = shadowGenerator.getDarkness();
    const rate = map.refreshRate;

    setLighting2D(hemispheric, directional, shadowGenerator);
    expect(directional.shadowEnabled).toBe(true);
    expect(shadowGenerator.getDarkness()).toBe(1);
    expect(map.refreshRate).toBe(RenderTargetTexture.REFRESHRATE_RENDER_ONCE);
    setLighting2D(hemispheric, directional, shadowGenerator); // twice: still restores the real values

    setLighting3D(hemispheric, directional, shadowGenerator);
    expect(directional.shadowEnabled).toBe(true);
    expect(shadowGenerator.getDarkness()).toBe(darkness);
    expect(map.refreshRate).toBe(rate);
    expect(hemispheric.intensity).toBeCloseTo(0.6);
    scene.dispose();
    engine.dispose();
  });
});
