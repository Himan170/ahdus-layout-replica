/**
 * ui/firstFrame.js
 *
 * When Workplace Studio is ready to be seen: the first frame drawn AFTER the floor
 * you are on is built (SceneBuilder's progress.currentFloorReady) whose shown meshes
 * can all be drawn (Babylon skips a mesh while its shader is still compiling, so a
 * frame right after the build can still show only the ground). Downloads still on
 * their way (the realistic look's textures and models) don't count: they swap in later.
 * Frames before that don't count. If the scene still isn't ready MAX_WAIT_MS after
 * the floor was built (a texture that never loads), that frame counts anyway: the
 * loading screen never waits forever. Used by WorkplaceEditor to hide the loading
 * screen (ui/StudioSplash.jsx); tested in ui/__tests__/studioSplash.test.jsx.
 */

export const MAX_WAIT_MS = 4000;

/** Every enabled, visible mesh with something to draw is ready (its shaders compiled). */
export function meshesDrawable(scene) {
  for (const mesh of scene?.meshes ?? []) {
    if (!mesh.subMeshes?.length || !mesh.isVisible || !mesh.isEnabled()) continue;
    if (!mesh.isReady(true)) return false;
  }
  return true;
}

/**
 * Call onReady once, after the first frame the scene draws while isReady() is true
 * and its meshes can be drawn (or MAX_WAIT_MS after isReady() first was).
 * @param {{ onAfterRenderObservable: { add(fn): any, remove(observer): void }, meshes?: object[] }} scene
 * @param {() => boolean} isReady  the floor you are on is built
 * @param {() => void} onReady
 * @param {{ drawable?: () => boolean, maxWaitMs?: number, now?: () => number }} [options]
 * @returns {() => void} stop watching (also safe after onReady)
 */
export function watchFirstFrame(scene, isReady, onReady, {
  drawable = () => meshesDrawable(scene), maxWaitMs = MAX_WAIT_MS, now = () => performance.now(),
} = {}) {
  const observable = scene?.onAfterRenderObservable;
  if (!observable) return () => {};
  let done = false;
  let builtAt = null;
  let observer = null;
  const stop = () => {
    if (observer) observable.remove(observer);
    observer = null;
  };
  observer = observable.add(() => {
    if (done || !isReady()) return;
    if (builtAt === null) builtAt = now();
    if (!drawable() && now() - builtAt < maxWaitMs) return;
    done = true;
    stop();
    onReady();
  });
  return () => { done = true; stop(); };
}
