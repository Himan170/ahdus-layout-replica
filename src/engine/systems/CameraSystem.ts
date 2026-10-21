/**
 * CameraSystem.ts
 *
 * The camera of a layout scene: 3D (orbit) or 2D (from above, orthographic,
 * with flatter light), and flying it to a box (Studio's Fit view, and
 * LayoutEngine.focusOn). Used by Workplace Studio and LayoutEngine.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Camera } from '@babylonjs/core/Cameras/camera';

import { switchTo2D, switchTo3D } from '../../utils/cameraManager';
import { setLighting2D, setLighting3D } from '../../utils/lightingSetup';
import { apply2DOptimisations, restore3DRendering } from '../../utils/performanceOptimiser';
import type { LayoutScene } from './SceneSetup';

/** A box on the ground (world x, z). */
export interface GroundBox {
  min: { x: number; z: number };
  max: { x: number; z: number };
}

/** Switch the camera (and the light that goes with it) to 3D or 2D. */
export function setCameraView(layoutScene: Pick<LayoutScene, 'scene' | 'camera' | 'lights'>, view: '3d' | '2d'): void {
  const { scene, camera, lights } = layoutScene;
  if (view === '2d') {
    switchTo2D(camera);
    setLighting2D(lights.hemispheric, lights.directional, lights.shadowGenerator);
    apply2DOptimisations(scene, lights);
  } else {
    switchTo3D(camera);
    setLighting3D(lights.hemispheric, lights.directional, lights.shadowGenerator);
    restore3DRendering(scene, lights);
  }
}

/** Where the camera ends up to show a box: its centre, and how far out (3D) or how wide (2D). */
export function framing(camera: ArcRotateCamera, { min, max }: GroundBox) {
  const span = Math.max(max.x - min.x, max.z - min.z, 2);
  return {
    x: (min.x + max.x) / 2,
    z: (min.z + max.z) / 2,
    r: Math.min(camera.upperRadiusLimit ?? 80, Math.max(camera.lowerRadiusLimit ?? 5, span * 1.5 + 6)),
    top: Math.max(4, span * 0.65 + 1.5),
  };
}

/**
 * Fly the camera so the box fills the view (300 ms, easing out). With
 * `duration: 0` it jumps there at once.
 */
export function flyTo(camera: ArcRotateCamera, scene: Scene, box: GroundBox, { duration = 300 } = {}): void {
  const from = { x: camera.target.x, z: camera.target.z, r: camera.radius, top: camera.orthoTop ?? 0 };
  const ortho = camera.mode === Camera.ORTHOGRAPHIC_CAMERA;
  const to = framing(camera, box);
  const step = (k: number) => {
    camera.target.x = from.x + (to.x - from.x) * k;
    camera.target.z = from.z + (to.z - from.z) * k;
    if (ortho) {
      const top = from.top + (to.top - from.top) * k;
      const aspect = scene.getEngine().getAspectRatio(camera);
      camera.orthoTop = top; camera.orthoBottom = -top;
      camera.orthoLeft = -top * aspect; camera.orthoRight = top * aspect;
    } else {
      camera.radius = from.r + (to.r - from.r) * k;
    }
  };
  if (duration <= 0) {
    step(1);
    return;
  }
  const start = performance.now();
  const obs = scene.onBeforeRenderObservable.add(() => {
    const t = Math.min(1, (performance.now() - start) / duration);
    step(1 - (1 - t) ** 3);
    if (t >= 1) scene.onBeforeRenderObservable.remove(obs);
  });
}

/** World box of a room or item node (its enabled parts only); null if it has none (Babylon then gives ±MAX_VALUE). */
export function boundsOf(node: TransformNode | null): GroundBox | null {
  if (!node) return null;
  const { min, max } = node.getHierarchyBoundingVectors(true, (m) => m.isEnabled());
  return min.x <= max.x ? { min: { x: min.x, z: min.z }, max: { x: max.x, z: max.z } } : null;
}
