/**
 * SceneSetup.ts
 *
 * The Babylon engine, scene, camera, lights and site (sky, grass, paving,
 * build grid) of a layout, with the render loop and resizing. Used by
 * Workplace Studio (components/WorkplaceEditor.jsx) and by LayoutEngine, so
 * both draw a layout the same way.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
// Side-effect imports: Babylon tree-shakes aggressively
import '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Meshes/csg';
import '@babylonjs/core/Collisions/collisionCoordinator';

import { createCamera } from '../../utils/cameraManager';
import { createLighting } from '../../utils/lightingSetup';
import { createGrid } from '../../utils/gridBuilder';
import { createSiteEnvironment } from '../../utils/siteEnvironment';
import { configureLook } from '../../utils/realLook';

export interface LayoutScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  /** { hemispheric, directional, shadowGenerator } (utils/lightingSetup.js) */
  lights: ReturnType<typeof createLighting>;
  /** Sky, grass, paving, build grid (utils/siteEnvironment.js) */
  siteEnv: ReturnType<typeof createSiteEnvironment>;
  /**
   * Pause drawing frames (true) or draw again (false). Progressive loading holds
   * them while the floor you start on is built: a frame of a half-built floor
   * shows nothing useful, and without a GPU one frame costs more than the
   * building. The page itself (progress text, clicks) keeps working. A hold ends
   * by itself after HOLD_RENDER_MAX_MS, so the view can never stay blank.
   */
  holdRendering(hold: boolean): void;
  /** Stops rendering and disposes the site, the scene and the engine. */
  dispose(): void;
}

/** The longest a holdRendering(true) lasts. */
export const HOLD_RENDER_MAX_MS = 30000;

export interface LayoutSceneOptions {
  /** 'high' (default): realistic look (real models, photo textures, HDRI sky); 'low': simple models and materials. */
  quality?: 'high' | 'low';
  /** Where the real assets are (models/, textures/, env/). Default: the app's public/assets/. */
  assetBaseUrl?: string;
}

/**
 * Create the engine and scene on a canvas and start rendering. The scene has
 * the real-world look (sky, grass, paving); the build grid starts hidden.
 */
export function createLayoutScene(canvas: HTMLCanvasElement, options: LayoutSceneOptions = {}): LayoutScene {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });
  engine.setHardwareScalingLevel(1 / window.devicePixelRatio);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.06, 0.08, 0.12, 1);
  configureLook(scene, { realistic: options.quality !== 'low', baseUrl: options.assetBaseUrl });

  const camera = createCamera(scene, canvas);
  const lights = createLighting(scene);
  const { ground } = createGrid(scene, 60);
  const siteEnv = createSiteEnvironment(scene, ground, lights);
  siteEnv.setPlayLook(true);

  let heldUntil = 0; // holdRendering: no frames until then (performance.now())
  engine.runRenderLoop(() => {
    if (heldUntil && performance.now() < heldUntil) return;
    heldUntil = 0;
    scene.render();
  });

  // Resize whenever the CANVAS changes size (window resize, or panels hiding
  // in Preview). Otherwise Babylon keeps rendering at the old size and the
  // picture is stretched, so the crosshair no longer matches the aim.
  const onResize = () => {
    engine.resize();
    // 2D view: keep the picture's proportions when the canvas changes size
    // (an Inspector opening or closing must not stretch it)
    if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA && camera.orthoTop) {
      const aspect = engine.getAspectRatio(camera);
      camera.orthoLeft = -camera.orthoTop * aspect;
      camera.orthoRight = camera.orthoTop * aspect;
    }
  };
  window.addEventListener('resize', onResize);
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas);

  return {
    engine,
    scene,
    camera,
    lights,
    siteEnv,
    holdRendering(hold: boolean) {
      heldUntil = hold ? performance.now() + HOLD_RENDER_MAX_MS : 0;
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      siteEnv.dispose();
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    },
  };
}
