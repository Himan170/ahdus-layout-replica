// The page side of scripts/make-thumbs.mjs: the dev server serves this file, and the
// headless page imports it (await import('/scripts/thumbs-scene.js')). It draws one
// item at a time the way Studio does (createItemMesh, "Realistic look" on: the real
// model if the type has one, else its primitive model) on a transparent canvas, seen
// from the front right like the old Kenney previews, and returns it as a PNG.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { configureLook, whenLoaded } from '../src/utils/realLook';
import { createItemMesh } from '../src/utils/assetInstances';
import { modelPartsFor } from '../src/utils/modelRegistry';
import { createLighting } from '../src/utils/lightingSetup';

const SIZE = 512; // rendered size; make-thumbs.mjs crops and shrinks it
const ALPHA = Math.PI / 4;  // front right (an item's front faces +z)
const BETA = 1.05;          // from a little above

let engine = null;
let scene = null;
let camera = null;

function setUp() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.replaceChildren(canvas);
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false });
  engine.setHardwareScalingLevel(1);
  scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  configureLook(scene, { realistic: true });
  camera = new ArcRotateCamera('thumb', ALPHA, BETA, 10, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  // Studio's lights (its sun lights the fronts), a little brighter and with no shadows: there is no floor
  const { hemispheric, directional } = createLighting(scene);
  hemispheric.intensity = 0.9;
  directional.shadowEnabled = false;
}

const frame = () => new Promise((res) => requestAnimationFrame(() => res()));

/** Point the camera at the item and make it fill the picture (orthographic: no perspective). */
function fit(root, alpha) {
  const { min, max } = root.getHierarchyBoundingVectors(true);
  camera.target = min.add(max).scale(0.5);
  camera.alpha = alpha; // after the target: setting it works the angles out again from the old position
  camera.beta = BETA;
  camera.radius = Vector3.Distance(min, max) * 2 + 1;
  camera.getViewMatrix(true);
  const view = camera.getViewMatrix();
  let half = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const p = Vector3.TransformCoordinates(new Vector3(x, y, z), view);
    half = Math.max(half, Math.abs(p.x), Math.abs(p.y));
  }
  half *= 1.05;
  camera.orthoLeft = -half;
  camera.orthoRight = half;
  camera.orthoTop = half;
  camera.orthoBottom = -half;
}

/** Draw one item and return its picture (PNG data URL); alpha: the camera's angle round it (default front right). */
export async function renderThumb(assetType, alpha = ALPHA) {
  if (!scene) setUp();
  const root = createItemMesh(assetType, scene, `thumb_${assetType}`);
  await whenLoaded(scene);
  // The item switches to its real model right after the load
  for (let i = 0; i < 100 && modelPartsFor(assetType) && !root.getChildMeshes()[0]?.metadata?.model; i++) await frame();
  const model = root.getChildMeshes()[0]?.metadata?.model ?? null;
  fit(root, alpha);
  // Draw until every texture is there (not scene.whenReadyAsync: Studio's shadow generator, off here, keeps it waiting)
  for (let i = 0; i < 200; i++) {
    scene.render();
    await frame();
    if (i >= 3 && scene.textures.every((t) => t.isReady?.() ?? true)) break;
  }
  const png = engine.getRenderingCanvas().toDataURL('image/png');
  root.dispose(false, false);
  return { png, model };
}
