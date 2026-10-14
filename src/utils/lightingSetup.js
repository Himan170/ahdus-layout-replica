/**
 * lightingSetup.js
 *
 * Creates the hemispheric (ambient) and directional (sun) lights
 * for the Workplace Editor scene.
 */

import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/**
 * Set up the scene lighting.
 *
 * @param {Scene} scene
 * @returns {{ hemispheric, directional, shadowGenerator }}
 */
export function createLighting(scene) {
  // --- Hemispheric light (soft ambient fill from above) ---
  const hemispheric = new HemisphericLight(
    'ambientLight',
    new Vector3(0, 1, 0),
    scene
  );
  hemispheric.intensity = 0.6;
  hemispheric.diffuse = new Color3(0.95, 0.95, 1.0);       // cool white
  hemispheric.groundColor = new Color3(0.15, 0.15, 0.2);   // subtle ground bounce

  // --- Directional light (main sun/shadow caster) ---
  // Sun from the south-east, behind you when you start (you face north),
  // so the walls you see first are in sunlight rather than shade
  const directional = new DirectionalLight(
    'sunLight',
    new Vector3(-0.6, -1.6, 1.1).normalize(),
    scene
  );
  directional.position = new Vector3(12, 25, -18);
  directional.intensity = 0.8;
  directional.diffuse = new Color3(1.0, 0.98, 0.92);       // warm sunlight

  // --- Shadow generator (attached to directional light) ---
  // We create this now so future phases can simply add meshes as shadow casters.
  let shadowGenerator = null;
  try {
    shadowGenerator = new ShadowGenerator(2048, directional);
    shadowGenerator.usePercentageCloserFiltering = true;
    shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadowGenerator.bias = 0.0015;
    shadowGenerator.normalBias = 0.02;
    shadowGenerator.darkness = 0.35;
    directional.autoCalcShadowZBounds = true;
  } catch (e) {
    // Shadow support may not be available on all devices — that's OK
    console.warn('Shadows not available:', e.message);
  }

  return { hemispheric, directional, shadowGenerator };
}

/**
 * Switch lighting for 2D mode (flatter, no shadows, cleaner top-down look).
 */
export function setLighting2D(hemispheric, directional, shadowGenerator) {
  hemispheric.intensity = 0.9;
  directional.intensity = 0.3;
  // Turn shadows off without forgetting which meshes cast them
  directional.shadowEnabled = false;
}

/**
 * Restore lighting for 3D mode.
 */
export function setLighting3D(hemispheric, directional, shadowGenerator) {
  hemispheric.intensity = 0.6;
  directional.intensity = 0.8;
  directional.shadowEnabled = true;
}
