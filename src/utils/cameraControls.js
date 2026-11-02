/**
 * cameraControls.js
 *
 * The AHDUS look's camera buttons (ui/CameraControls.jsx) and their keys: Top / Front / Side,
 * Reset view, zoom in / out, and whether the left mouse button (one finger on a touch screen)
 * turns the camera (orbit) or slides it (pan). They only move the camera: nothing in the
 * layout changes, so there is nothing to undo. The angle maths is pure (tested in
 * utils/__tests__/cameraControls.test.js).
 */

/** Babylon ArcRotateCamera angles: alpha = around the vertical axis, beta = down from straight up. */
export const VIEW_ANGLES = {
  top: { alpha: -Math.PI / 2, beta: 0.1 },        // from above, north up (as the 2D view)
  front: { alpha: -Math.PI / 2, beta: 1.2 },      // from the south, a little above
  side: { alpha: 0, beta: 1.2 },                  // from the east
  home: { alpha: -Math.PI / 3, beta: Math.PI / 4 }, // as a layout opens
};

export const ZOOM_STEP = 1.25; // one press of + / −

/** `to` moved by whole turns so the camera takes the short way round from `from`. */
export function nearestAngle(from, to) {
  const turn = 2 * Math.PI;
  return to + Math.round((from - to) / turn) * turn;
}

/** Distance after zooming (`dir` +1 = in, −1 = out), kept inside the camera's limits. */
export function zoomedRadius(radius, dir, lower = 5, upper = 320) {
  const next = dir > 0 ? radius / ZOOM_STEP : radius * ZOOM_STEP;
  return Math.min(upper ?? Infinity, Math.max(lower ?? 0, next));
}

/** Half-height of the 2D (orthographic) view after zooming, 2 to 200 m. */
export function zoomedOrthoTop(top, dir) {
  const next = dir > 0 ? top / ZOOM_STEP : top * ZOOM_STEP;
  return Math.min(200, Math.max(2, next));
}

/** Runs step(k) with k going 0 → 1 (easing out) over `duration` ms, on the scene's frames. */
function animate(scene, duration, step) {
  const start = performance.now();
  const obs = scene.onBeforeRenderObservable.add(() => {
    const t = Math.min(1, (performance.now() - start) / duration);
    step(1 - (1 - t) ** 3);
    if (t >= 1) scene.onBeforeRenderObservable.remove(obs);
  });
}

/** Turn the 3D camera to one of VIEW_ANGLES (300 ms). */
export function turnCameraTo(camera, scene, which, { duration = 300 } = {}) {
  const want = VIEW_ANGLES[which];
  if (!camera || !scene || !want) return;
  const from = { alpha: camera.alpha, beta: camera.beta };
  const alpha = nearestAngle(from.alpha, want.alpha);
  const beta = Math.min(camera.upperBetaLimit ?? Math.PI, Math.max(camera.lowerBetaLimit ?? 0, want.beta));
  camera.inertialAlphaOffset = 0;
  camera.inertialBetaOffset = 0;
  animate(scene, duration, (k) => {
    camera.alpha = from.alpha + (alpha - from.alpha) * k;
    camera.beta = from.beta + (beta - from.beta) * k;
  });
}

/** Zoom in (`dir` +1) or out (−1), in 3D (distance) and in 2D (how much of the floor shows). */
export function zoomCamera(camera, scene, dir, { duration = 150 } = {}) {
  if (!camera || !scene) return;
  camera.inertialRadiusOffset = 0;
  if (camera.mode === 1 /* Camera.ORTHOGRAPHIC_CAMERA */) {
    const from = camera.orthoTop ?? 20;
    const to = zoomedOrthoTop(from, dir);
    const aspect = scene.getEngine().getAspectRatio(camera);
    animate(scene, duration, (k) => {
      const top = from + (to - from) * k;
      camera.orthoTop = top; camera.orthoBottom = -top;
      camera.orthoLeft = -top * aspect; camera.orthoRight = top * aspect;
    });
    return;
  }
  const from = camera.radius;
  const to = zoomedRadius(from, dir, camera.lowerRadiusLimit, camera.upperRadiusLimit);
  animate(scene, duration, (k) => { camera.radius = from + (to - from) * k; });
}

/**
 * Pan mode: the left button (one finger) slides the camera and the right button turns it;
 * orbit mode (the default) the other way round. The Studio tools attach the camera's controls
 * again after a drag (which sets Babylon's default, right = pan), so the choice is kept on the
 * camera and put back each time.
 */
export function setPanMode(camera, pan) {
  if (!camera) return;
  camera.__ahdusPan = !!pan;
  if (!camera.__ahdusPanKept) {
    const attach = camera.attachControl.bind(camera);
    camera.attachControl = (...args) => {
      attach(...args);
      camera._panningMouseButton = camera.__ahdusPan ? 0 : 2;
    };
    camera.__ahdusPanKept = true;
  }
  camera._panningMouseButton = pan ? 0 : 2;
}
