/**
 * placementManager.js
 *
 * Advanced drag-and-drop placement system for the 3D Workspace Builder.
 *
 * Features:
 *  - Drag item from sidebar panel → drop on 3D canvas
 *  - Ghost preview mesh follows cursor with live position
 *  - Grid snapping (configurable step, default 0.5m)
 *  - Scroll wheel adjusts Y height while hovering (raise/lower off ground)
 *  - Surface snapping: the floor, or the TOP of other furniture (monitor on a desk),
 *    decided by placementHeight() in play/building.js, same as Build mode
 *  - Rotate preview with R key (45° steps)
 *  - Escape to cancel placement
 *  - Ctrl+D to duplicate last placed object
 *  - Right-click context menu integration (handled in WorkplaceEditor)
 *
 * Phase 6 — Full 3D World Builder
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildAssetMesh } from './assetCatalog';
import { disposeMaterialIfOwned } from './materialLibrary';
import { placementHeight } from '../play/building';

// ─── Ghost visual config ───
const GHOST_ALPHA = 0.48;
const GHOST_COLOR = new Color3(0.3, 0.6, 1.0);
const GHOST_INVALID_COLOR = new Color3(1.0, 0.25, 0.25);
const SNAP_STEP = 0.5; // meters — grid snap resolution

/**
 * Create the two shared ghost materials (valid = blue, invalid = red).
 * They are created ONCE per placement manager and reused for every ghost,
 * instead of creating a new material per child mesh on every mouse move.
 */
function createGhostMaterials(scene) {
  const make = (name, color) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = color;
    m.alpha = GHOST_ALPHA;
    m.backFaceCulling = false;
    m.emissiveColor = color.scale(0.2);
    return m;
  };
  return {
    valid: make('ghost_valid', GHOST_COLOR),
    invalid: make('ghost_invalid', GHOST_INVALID_COLOR),
  };
}

/**
 * Apply the translucent ghost material to all child meshes of a root node.
 * The meshes' own materials are disposed (the ghost is a throwaway copy).
 */
function applyGhostMaterial(root, material) {
  root.getChildMeshes(false).forEach(mesh => {
    if (mesh.material === material) return;
    if (mesh.material && !mesh.material.name.startsWith('ghost_')) {
      disposeMaterialIfOwned(mesh.material); // furniture materials are shared
    }
    mesh.material = material;
    mesh.isPickable = false;
  });
}

/**
 * Snap a value to grid.
 */
function snap(v, step = SNAP_STEP) {
  return Math.round(v / step) * step;
}

/**
 * Create the placement manager controller.
 *
 * @param {Scene} scene - Babylon.js scene
 * @param {{ snapEnabled: boolean, snapStep: number }} options
 * @returns {Object} placement controller
 */
export function createPlacementManager(scene, options = {}) {
  let ghostRoot = null;
  let currentAssetType = null;
  let currentYOffset = 0;     // user-controlled height from scroll
  let currentRotationY = 0;   // rotation in radians, set by R key
  let snapEnabled = options.snapEnabled !== false; // default true
  let snapStep = options.snapStep || SNAP_STEP;
  let _valid = true;
  let _pendingConfirm = null; // function to call on drop confirm
  let _lastPlacedData = null; // for Ctrl+D duplicate
  let _surfaceY = 0;          // height of the surface under the pointer
  let pickFilter = null;      // (mesh) => boolean: only place on the floor being edited
  let getElevation = () => 0; // elevation of the floor being edited
  const ghostMaterials = createGhostMaterials(scene);

  // ── Ghost cleanup ──
  function clearGhost() {
    if (ghostRoot) {
      ghostRoot.getChildMeshes(false).forEach(m => m.dispose());
      ghostRoot.dispose();
      ghostRoot = null;
    }
    currentYOffset = 0;
    currentRotationY = 0;
    _valid = true;
  }

  const objectIdOf = (m) => m.metadata?.objectId ?? m.parent?.metadata?.objectId ?? null;

  // ── Raycast onto the floor, the ground, or placed furniture ──
  function raycastSurface(pointerX, pointerY) {
    return scene.pick(
      pointerX,
      pointerY,
      mesh => mesh.isPickable && mesh.isEnabled() && (!pickFilter || pickFilter(mesh)) && (
        mesh.name === 'ground' ||
        mesh.metadata?.part === 'floor' ||
        !!objectIdOf(mesh)
      )
    );
  }

  // ── Start placement mode ──
  /**
   * Begin placing an asset by building its ghost.
   *
   * @param {string} assetType - key in ASSET_TYPES
   * @param {function} [onConfirm] - optional, called with { assetType, x, y, z, rotationY }.
   *   confirmPlacement() also RETURNS that data, so callers can use either.
   */
  function startPlacement(assetType, onConfirm) {
    cancelPlacement(); // clear any existing placement
    currentAssetType = assetType;
    _pendingConfirm = onConfirm ?? null;
    currentYOffset = 0;
    currentRotationY = 0;
    _surfaceY = 0;

    // Build ghost mesh
    ghostRoot = buildAssetMesh(assetType, scene, 'ghost_preview');
    applyGhostMaterial(ghostRoot, ghostMaterials.valid);

    // Canvas cursor
    scene.getEngine().getRenderingCanvas().style.cursor = 'crosshair';
  }

  // ── Update ghost position based on current pointer ──
  function updatePointer(pointerX, pointerY) {
    if (!ghostRoot) return;

    const pick = raycastSurface(pointerX, pointerY);
    if (pick?.hit) {
      let x = pick.pickedPoint.x;
      let z = pick.pickedPoint.z;
      // On the floor, or stacked on top of furniture; the side of furniture is not a place
      const surface = objectIdOf(pick.pickedMesh) ? 'object' : pick.pickedMesh.name === 'ground' ? 'ground' : 'floor';
      const height = placementHeight({
        surface,
        normalY: pick.getNormal(true)?.y ?? 0,
        pointY: pick.pickedPoint.y,
        elevation: getElevation(),
      });
      const baseY = height ? height.worldY : pick.pickedPoint.y;

      if (snapEnabled) {
        x = snap(x, snapStep);
        z = snap(z, snapStep);
      }

      _surfaceY = baseY;
      ghostRoot.position.set(x, baseY + currentYOffset, z);
      ghostRoot.rotation.y = currentRotationY;

      _valid = !!height && (baseY + currentYOffset) >= -0.05;
      applyGhostMaterial(ghostRoot, _valid ? ghostMaterials.valid : ghostMaterials.invalid);
    }
  }

  // ── Scroll wheel: adjust height ──
  function adjustHeight(delta) {
    if (!ghostRoot) return;
    currentYOffset = Math.max(0, currentYOffset + delta * 0.1);
    ghostRoot.position.y = _surfaceY + currentYOffset;
  }

  // ── R key: rotate 45° ──
  function rotatePreview() {
    if (!ghostRoot) return;
    currentRotationY += Math.PI / 4; // 45 degrees
    ghostRoot.rotation.y = currentRotationY;
  }

  // ── Confirm placement (mouse click / drop) ──
  /**
   * Confirm current ghost position and call onConfirm.
   * Returns placed object data or null if invalid/inactive.
   */
  function confirmPlacement() {
    if (!ghostRoot || !_valid) return null;

    const data = {
      assetType: currentAssetType,
      x: ghostRoot.position.x,
      y: ghostRoot.position.y,
      z: ghostRoot.position.z,
      rotationY: currentRotationY,
    };

    _lastPlacedData = { ...data };
    const callback = _pendingConfirm;
    clearGhost();
    currentAssetType = null;
    _pendingConfirm = null;
    scene.getEngine().getRenderingCanvas().style.cursor = 'default';
    callback?.(data);
    return data;
  }

  // ── Cancel placement ──
  function cancelPlacement() {
    clearGhost();
    currentAssetType = null;
    _pendingConfirm = null;
    if (scene.getEngine?.()?.getRenderingCanvas?.()) {
      scene.getEngine().getRenderingCanvas().style.cursor = 'default';
    }
  }

  // ── Duplicate last placed object ──
  /**
   * Returns the last placed object's data so WorkplaceEditor can
   * create a copy slightly offset from the original.
   */
  function duplicateLast() {
    if (!_lastPlacedData) return null;
    return {
      ..._lastPlacedData,
      x: _lastPlacedData.x + 1.0, // offset 1m to the right
      z: _lastPlacedData.z + 1.0,
    };
  }

  // ── Snap control ──
  /** Restrict placement to some surfaces (e.g. only the current storey). */
  function setPickFilter(fn) { pickFilter = fn; }
  /** Where the floor being edited is (furniture heights are kept relative to it). */
  function setElevationSource(fn) { getElevation = fn; }
  function setSnapEnabled(v) { snapEnabled = v; }
  function setSnapStep(v) { snapStep = v; }
  function isSnapEnabled() { return snapEnabled; }

  // ── State queries ──
  function isActive() {
    return ghostRoot !== null;
  }

  function getGhostPosition() {
    if (!ghostRoot) return null;
    return { x: ghostRoot.position.x, y: ghostRoot.position.y, z: ghostRoot.position.z };
  }

  // ── Cleanup ──
  function dispose() {
    cancelPlacement();
    ghostMaterials.valid.dispose();
    ghostMaterials.invalid.dispose();
  }

  return {
    startPlacement,
    updatePointer,
    confirmPlacement,
    cancelPlacement,
    adjustHeight,
    rotatePreview,
    duplicateLast,
    setSnapEnabled,
    setPickFilter,
    setElevationSource,
    setSnapStep,
    isSnapEnabled,
    isActive,
    getGhostPosition,
    dispose,
  };
}
