/**
 * siteEnvironment.js
 *
 * Switches the scene between the PLANNER look (dark background, grid) and the
 * PLAY look (sky, fog, grass land around a paved building plot).
 *
 * In Play mode the grid comes back only while a building tool (Room / Wall /
 * Door / Window) is held, so you can line things up — like a build overlay.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { getMaterials, scaleUVs, TILE_SIZE } from './materialLibrary';

const SKY = {
  day: '#b9d3ea',
  office: '#c9d2dc',
  night: '#141a2a',
};
const PLANNER_BG = new Color4(0.06, 0.08, 0.12, 1);

/**
 * @param {Scene} scene
 * @param {Mesh} ground  the 60 m ground created by gridBuilder (uses GridMaterial)
 * @param {object|null} [lights]  createLighting's result (the ground lights walls from below)
 */
export function createSiteEnvironment(scene, ground, lights = null) {
  const mats = getMaterials(scene);
  const gridMaterial = ground.material;
  const groundSize = ground.getBoundingInfo().boundingBox.extendSize.x * 2;

  // Paved plot: same size as the planner ground, real-world texture scale
  const pavingUVsScaled = { done: false };

  // Land around the plot
  const land = MeshBuilder.CreateGround('siteLand', { width: 400, height: 400 }, scene);
  land.position.y = -0.03;
  land.isPickable = false;
  land.receiveShadows = true;
  land.setEnabled(false);

  let playLook = false;
  let preset = 'day';
  let gridVisible = false;

  function applyGroundMaterial() {
    if (!playLook || gridVisible) {
      ground.material = gridMaterial;
      return;
    }
    if (!pavingUVsScaled.done) {
      scaleUVs(ground, groundSize, groundSize, TILE_SIZE.paving);
      pavingUVsScaled.done = true;
    }
    ground.material = mats.paving();
  }

  function applySky() {
    if (!playLook) {
      scene.clearColor = PLANNER_BG;
      scene.fogMode = Scene.FOGMODE_NONE;
      return;
    }
    const sky = Color3.FromHexString(SKY[preset] ?? SKY.day);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = sky;
    scene.fogDensity = preset === 'night' ? 0.02 : 0.009;
  }

  return {
    /** true = Play look (sky, land, paving), false = planner look */
    setPlayLook(on) {
      playLook = on;
      if (on && !land.material) {
        land.material = mats.grass();
        scaleUVs(land, 400, 400, TILE_SIZE.grass);
      }
      land.setEnabled(on);
      // Planner-only helpers (axis lines) are hidden in the real-world view
      scene.getMeshByName('xAxis')?.setEnabled(!on);
      scene.getMeshByName('zAxis')?.setEnabled(!on);
      applyGroundMaterial();
      applySky();
      // Outdoors, light bounces off the ground: brighten walls that face away
      // from the sun so they read as white plaster, not grey
      if (lights?.hemispheric) {
        lights.hemispheric.groundColor = on
          ? new Color3(0.55, 0.53, 0.5)
          : new Color3(0.15, 0.15, 0.2);
      }
    },
    /** Show the build grid on the plot (while a building tool is held) */
    setBuildGrid(on) {
      gridVisible = on;
      applyGroundMaterial();
    },
    /** 'day' | 'office' | 'night' */
    setPreset(p) {
      preset = p;
      applySky();
    },
    dispose() {
      land.dispose();
    },
  };
}
