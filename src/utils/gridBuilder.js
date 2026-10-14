/**
 * gridBuilder.js
 *
 * Creates the ground plane and visible grid lines for the Workplace Editor.
 * The grid serves as a spatial reference and snapping guide for the
 * administrator when placing rooms and objects.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * Create the ground plane with a grid overlay.
 *
 * @param {Scene} scene - The Babylon.js scene
 * @param {number} size - Width/depth of the ground in world units (default 60)
 * @returns {{ ground: Mesh }} references to the created meshes
 */
export function createGrid(scene, size = 60) {
  // --- Ground Plane ---
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: size, height: size, subdivisions: 1 },
    scene
  );
  ground.position.y = 0;
  ground.isPickable = true; // needed later for raycasting object placement

  // --- Grid Material ---
  // GridMaterial from @babylonjs/materials gives us a clean infinite-looking
  // grid without manually drawing lines.
  const gridMat = new GridMaterial('gridMat', scene);
  gridMat.majorUnitFrequency = 5;       // bold line every 5 units
  gridMat.minorUnitVisibility = 0.4;    // faint minor lines
  gridMat.gridRatio = 1;                // 1 unit per cell
  gridMat.backFaceCulling = false;
  gridMat.mainColor = new Color3(0.15, 0.18, 0.25);   // dark grid surface
  gridMat.lineColor = new Color3(0.35, 0.45, 0.55);   // blue-grey grid lines
  gridMat.opacity = 0.98;

  ground.material = gridMat;

  // --- Axis Indicators ---
  // Short colored lines at origin to show X (red) and Z (blue) directions
  const axisLength = 3;

  // X axis (red)
  const xAxis = MeshBuilder.CreateLines(
    'xAxis',
    {
      points: [Vector3.Zero(), new Vector3(axisLength, 0.01, 0)],
      colors: [
        new Color4(1, 0.3, 0.3, 1),
        new Color4(1, 0.3, 0.3, 0.3),
      ],
    },
    scene
  );
  xAxis.isPickable = false;

  // Z axis (blue)
  const zAxis = MeshBuilder.CreateLines(
    'zAxis',
    {
      points: [Vector3.Zero(), new Vector3(0, 0.01, axisLength)],
      colors: [
        new Color4(0.3, 0.5, 1, 1),
        new Color4(0.3, 0.5, 1, 0.3),
      ],
    },
    scene
  );
  zAxis.isPickable = false;

  return { ground };
}
