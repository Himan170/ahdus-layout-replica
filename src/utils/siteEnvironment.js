/**
 * siteEnvironment.js
 *
 * Switches the scene between the PLANNER look (dark background, grid) and the
 * PLAY look (sky, fog, grass land around a paved building plot).
 * With the realistic look (realLook.js), a photographed sky (HDRI, env/sky.env)
 * is drawn on a clear day and lights the photo-textured rooms.
 *
 * In Play mode the grid comes back only while a building tool (Room / Wall /
 * Door / Window) is held, so you can line things up — like a build overlay.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Materials/Textures/Loaders/envTextureLoader';
import { getMaterials, scaleUVs, TILE_SIZE, markShared } from './materialLibrary';
import { ENV_FILE } from './modelRegistry';
import { isRealistic, onLookChange, assetUrl, trackLoad } from './realLook';

const SKY = {
  day: '#b9d3ea',
  office: '#c9d2dc',
  night: '#141a2a',
};
const PLANNER_BG = new Color4(0.06, 0.08, 0.12, 1);
/** How strongly the HDRI sky lights the photo-textured rooms, per preset. */
const ENV_INTENSITY = { day: 0.7, office: 0.45, night: 0.08 };

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

  // ── Realistic look: the HDRI sky (env/sky.env) lights the PBR room surfaces
  // (reflections, soft light) and is drawn as the sky on a clear day. Until it
  // has loaded, or if it fails, the plain sky colour stays.
  let skyTexture = null; // prefiltered cube map, once loaded
  let skybox = null;
  let skyFailed = false;
  let skyLoading = false;
  function loadSky() {
    if (skyTexture || skyFailed || skyLoading) return;
    skyLoading = true;
    let settle;
    trackLoad(scene, new Promise((res) => { settle = res; }));
    let tex = null;
    const loaded = () => {
      if (scene.isDisposed || skyFailed) return settle();
      skyTexture = tex;
      skybox = MeshBuilder.CreateBox('skyBox', { size: 1000 }, scene);
      const m = new PBRMaterial('mat_skyBox', scene);
      m.backFaceCulling = false;
      m.reflectionTexture = tex.clone();
      m.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
      m.microSurface = 1; // sharp
      m.disableLighting = true;
      m.twoSidedLighting = true;
      skybox.material = markShared(m);
      skybox.isPickable = false;
      skybox.infiniteDistance = true;
      skybox.ignoreCameraMaxZ = true;
      skybox.applyFog = false;
      applySky();
      settle();
    };
    const failed = (message) => {
      if (skyTexture || skyFailed) return;
      skyFailed = true;
      console.warn(`[realistic look] the sky (${ENV_FILE}) could not be loaded: ${message ?? ''}`);
      settle();
    };
    // Start on the next task, and only if the scene still exists. React's
    // StrictMode (dev) disposes the first scene of a canvas at once and makes a
    // second one on the same WebGL context. Babylon fetches the file after that
    // dispose, so the disposed engine would still decode it, and its rgbdDecode
    // shader would take over the live engine's (they share the context's shader
    // cache): with parallel shader compile that shader then never gets ready and
    // the sky never shows ("Unable to compile effect ... rgbdDecode" after 120 s).
    setTimeout(() => {
      if (scene.isDisposed || scene.getEngine().isDisposed) return settle();
      // a prefiltered .env cube map (CubeTexture.CreateFromPrefilteredData, with an onError)
      tex = new CubeTexture(assetUrl(scene, ENV_FILE), scene, null, false, null, () => queueMicrotask(loaded), failed,
        undefined, true, '.env', true);
    });
  }
  onLookChange(scene, () => applySky());

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
    const realistic = isRealistic(scene);
    if (realistic) loadSky();
    // the HDRI lights the photo-textured rooms in every preset (dimmer at night / indoors)
    scene.environmentTexture = realistic && skyTexture ? skyTexture : null;
    scene.environmentIntensity = ENV_INTENSITY[preset] ?? ENV_INTENSITY.day;
    skybox?.setEnabled(realistic && playLook && preset === 'day');
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
      skybox?.dispose(false, true);
    },
  };
}
