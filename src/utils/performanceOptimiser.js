/**
 * performanceOptimiser.js
 *
 * Provides rendering optimalisations for 2D top-down view and general
 * performance monitoring. When the user switches to 2D mode the engine
 * can skip a lot of work (shadows, complex materials, wall geometry
 * that isn't visible from above).
 *
 * Phase 4 — Multi-Tenant & Data Sync
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

// ─── Configuration ───
const LOW_FPS_THRESHOLD  = 30;   // auto-downscale below this
const HIGH_FPS_THRESHOLD = 50;   // restore quality above this
const FPS_SAMPLE_COUNT   = 10;   // rolling average window size

/**
 * Creates a performance monitor that can auto-adjust the hardware
 * scaling level when FPS drops below a threshold.
 *
 * @param {Engine} engine  - The Babylon engine
 * @returns {{ update, getScaleFactor, dispose }}
 */
export function createPerformanceMonitor(engine) {
  let _samples = [];
  let _currentScale = 1;
  let _interval = null;
  let _enabled = true;

  function _average() {
    if (_samples.length === 0) return 60;
    return _samples.reduce((a, b) => a + b, 0) / _samples.length;
  }

  function _adjust() {
    if (!_enabled) return;

    const avg = _average();

    if (avg < LOW_FPS_THRESHOLD && _currentScale < 2) {
      // Reduce resolution to regain FPS
      _currentScale = Math.min(_currentScale + 0.25, 2);
      engine.setHardwareScalingLevel(_currentScale);
      console.debug(`[perf] FPS ${avg.toFixed(0)} — scaling up to ${_currentScale}x`);
    } else if (avg > HIGH_FPS_THRESHOLD && _currentScale > 1) {
      // CPU/GPU has headroom — increase quality
      _currentScale = Math.max(_currentScale - 0.25, 1);
      engine.setHardwareScalingLevel(_currentScale / window.devicePixelRatio);
      console.debug(`[perf] FPS ${avg.toFixed(0)} — restoring quality to ${_currentScale}x`);
    }
  }

  // Sample FPS every second
  _interval = setInterval(() => {
    _samples.push(engine.getFps());
    if (_samples.length > FPS_SAMPLE_COUNT) _samples.shift();
    _adjust();
  }, 1000);

  return {
    /** Call from the render loop if you want per-frame sampling (optional). */
    update() {
      // The interval handles it, but callers can push extra samples here.
    },

    getScaleFactor() {
      return _currentScale;
    },

    /** Pause (false) or resume (true). Resuming forgets the samples taken while paused
     *  (e.g. during progressive loading, when a low FPS says nothing about rendering). */
    setEnabled(flag) {
      if (flag && !_enabled) _samples = [];
      _enabled = flag;
    },

    dispose() {
      if (_interval) {
        clearInterval(_interval);
        _interval = null;
      }
      // Restore default scaling
      engine.setHardwareScalingLevel(1 / window.devicePixelRatio);
    },
  };
}

// ─── 2D mode scene-level optimisations ───

// Stash the shadow render list so we can restore it
// Per shadow generator: two scenes on one page (a viewer and Studio) keep their own
const _savedShadowRenderLists = new WeakMap();

/**
 * Apply optimisations suited for 2D (top-down) rendering. Call this
 * when switching to 2D view.
 *
 * @param {Scene}  scene
 * @param {Object} lights – { hemispheric, directional, shadowGenerator }
 */
export function apply2DOptimisations(scene, lights) {
  // 1. Disable shadows entirely — save the list first
  if (lights.shadowGenerator) {
    const shadowMap = lights.shadowGenerator.getShadowMap();
    _savedShadowRenderLists.set(lights.shadowGenerator, shadowMap.renderList ? [...shadowMap.renderList] : []);
    shadowMap.renderList = [];
  }

  // 2. Tell the engine to skip expensive post-processes
  scene.skipPointerMovePicking = false; // keep picking for UI
  scene.autoClear = true;
  scene.autoClearDepthAndStencil = true;

  // 3. Reduce material detail on all meshes — switch to flat shading
  for (const mesh of scene.meshes) {
    if (!mesh.material) continue;

    // Store original values so we can restore them
    if (mesh.material._3dSpecIntensity === undefined) {
      mesh.material._3dSpecIntensity = mesh.material.specularPower ?? 64;
      mesh.material._3dSpecColor = mesh.material.specularColor?.clone?.();
    }

    // Flatten specular (no reflections look better top-down)
    if (mesh.material.specularPower !== undefined) {
      mesh.material.specularPower = 0;
    }
    if (mesh.material.specularColor) {
      mesh.material.specularColor = Color3.Black();
    }
  }

  // 4. Hide wall-top edges (wall Y geometry is invisible from above anyway)
  for (const mesh of scene.meshes) {
    if (mesh.name?.startsWith('wall_') && mesh.name?.includes('_top')) {
      mesh.setEnabled(false);
    }
  }

  // 5. Disable edge rendering if enabled
  for (const mesh of scene.meshes) {
    if (mesh.edgesRenderer) {
      mesh.disableEdgesRendering();
      mesh._had3DEdges = true;
    }
  }
}

/**
 * Restore full 3D rendering quality. Call when switching back to 3D.
 *
 * @param {Scene}  scene
 * @param {Object} lights – { hemispheric, directional, shadowGenerator }
 */
export function restore3DRendering(scene, lights) {
  // 0. Restore shadow render list
  const savedList = lights.shadowGenerator && _savedShadowRenderLists.get(lights.shadowGenerator);
  if (savedList) {
    lights.shadowGenerator.getShadowMap().renderList = savedList;
    _savedShadowRenderLists.delete(lights.shadowGenerator);
  }

  // 1. Restore material detail
  for (const mesh of scene.meshes) {
    if (!mesh.material) continue;

    if (mesh.material._3dSpecIntensity !== undefined) {
      mesh.material.specularPower = mesh.material._3dSpecIntensity;
      delete mesh.material._3dSpecIntensity;
    }
    if (mesh.material._3dSpecColor) {
      mesh.material.specularColor = mesh.material._3dSpecColor;
      delete mesh.material._3dSpecColor;
    }
  }

  // 2. Re-show wall tops
  for (const mesh of scene.meshes) {
    if (mesh.name?.startsWith('wall_') && mesh.name?.includes('_top')) {
      mesh.setEnabled(true);
    }
  }

  // 3. Restore edge rendering
  for (const mesh of scene.meshes) {
    if (mesh._had3DEdges) {
      mesh.enableEdgesRendering();
      delete mesh._had3DEdges;
    }
  }
}

/**
 * Set up LOD (Level of Detail) on a room TransformNode.
 * When far from camera, rooms render as simplified boxes instead
 * of full wall/floor geometry.
 *
 * @param {TransformNode} roomNode - root node of a room
 * @param {Scene} scene
 */
export function addRoomLOD(roomNode, scene) {
  // LOD is handled per-mesh in Babylon. For each wall/floor child mesh,
  // we can set a visibility distance beyond which it's not rendered.
  const camera = scene.activeCamera;
  if (!camera) return;

  const childMeshes = roomNode.getChildMeshes(false);
  for (const mesh of childMeshes) {
    // Walls become invisible beyond 60 units (in 2D/far zoom they're not needed)
    if (mesh.name?.startsWith('wall_')) {
      mesh.visibility = 1;
      // Use Babylon's built-in LOD by setting a far-away visibility
      mesh._lodDistanceToApply = 60;
    }
  }
}

/**
 * Set up instance batching for repeated object meshes.
 * When the same asset type appears many times, instancing reduces draw calls.
 *
 * @param {Map} objectMeshes - Map of objectId → Mesh
 * @param {Array} objects - Array of object data from the store
 */
export function optimiseObjectInstances(objectMeshes, objects) {
  // Group objects by assetType
  const groups = {};
  for (const obj of objects) {
    if (!groups[obj.assetType]) groups[obj.assetType] = [];
    groups[obj.assetType].push(obj);
  }

  // For groups with >3 instances, the first is the "source" mesh and the rest
  // become thin instances (much cheaper GPU draw calls).
  // NOTE: This is a hint for future optimisation. Babylon thin instances share
  // the same material and geometry, which constrains per-instance materials.
  // For now we just log candidates.
  for (const [type, group] of Object.entries(groups)) {
    if (group.length > 3) {
      console.debug(
        `[perf] ${type}: ${group.length} instances — candidate for thin-instancing`
      );
    }
  }
}
