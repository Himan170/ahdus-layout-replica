/**
 * cameraManager.js
 *
 * Manages the dual-camera system for the Workplace Editor:
 *   - 3D Mode: ArcRotateCamera (orbit around the workplace)
 *   - 2D Mode: ArcRotateCamera locked to top-down orthographic view
 *
 * We use ONE ArcRotateCamera and switch its properties instead of
 * two cameras, which avoids issues with input attachment/detachment.
 */

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// Saved 3D state of each camera, so we can restore it when switching back
// from 2D (two engines on one page each have a camera)
const saved3DStates = new WeakMap();

/**
 * Create the main camera.
 * Starts in 3D perspective mode.
 */
export function createCamera(scene, canvas) {
  const camera = new ArcRotateCamera(
    'mainCamera',
    -Math.PI / 3,     // alpha  — horizontal rotation
    Math.PI / 4,      // beta   — vertical angle (45°)
    30,               // radius — distance from target
    new Vector3(0, 0, 0), // target — center of the workspace
    scene
  );

  // Limits so the user can't flip below the ground
  camera.lowerBetaLimit = 0.1;
  camera.upperBetaLimit = Math.PI / 2 - 0.05;

  // Zoom limits
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 80;

  // Smooth inertia
  camera.inertia = 0.7;
  camera.panningInertia = 0.7;

  // Enable panning with right-click
  camera.panningSensibility = 50;

  // Attach controls
  camera.attachControl(canvas, true);

  // Mouse wheel zoom speed
  camera.wheelPrecision = 15;

  return camera;
}

/**
 * Switch to 2D top-down orthographic view.
 */
export function switchTo2D(camera) {
  // Save current 3D state
  saved3DStates.set(camera, {
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    target: camera.target.clone(),
    mode: camera.mode,
  });

  // Animate to top-down: beta = 0 (straight down), alpha doesn't matter
  camera.alpha = -Math.PI / 2;
  camera.beta = 0.01; // nearly straight down (0 causes gimbal issues)
  camera.radius = 40;

  // Switch to orthographic projection
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;

  // Set orthographic bounds based on radius
  const aspect = camera.getEngine().getAspectRatio(camera);
  const orthoSize = 20;
  camera.orthoLeft = -orthoSize * aspect;
  camera.orthoRight = orthoSize * aspect;
  camera.orthoTop = orthoSize;
  camera.orthoBottom = -orthoSize;

  // Lock rotation in 2D mode — user can only pan and zoom
  camera.lowerAlphaLimit = camera.alpha;
  camera.upperAlphaLimit = camera.alpha;
  camera.lowerBetaLimit = camera.beta;
  camera.upperBetaLimit = camera.beta;
}

/**
 * Switch back to 3D perspective view.
 */
export function switchTo3D(camera) {
  // Restore perspective
  camera.mode = ArcRotateCamera.PERSPECTIVE_CAMERA;

  // Remove alpha/beta locks
  camera.lowerAlphaLimit = null;
  camera.upperAlphaLimit = null;
  camera.lowerBetaLimit = 0.1;
  camera.upperBetaLimit = Math.PI / 2 - 0.05;

  // Restore saved state if we have one
  const saved3DState = saved3DStates.get(camera);
  if (saved3DState) {
    camera.alpha = saved3DState.alpha;
    camera.beta = saved3DState.beta;
    camera.radius = saved3DState.radius;
    camera.target = saved3DState.target;
  } else {
    // Default 3D position
    camera.alpha = -Math.PI / 3;
    camera.beta = Math.PI / 4;
    camera.radius = 30;
  }
}
