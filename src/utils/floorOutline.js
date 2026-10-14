/**
 * floorOutline.js
 *
 * A faint outline of the rooms on the floor below, drawn on the floor you are
 * building on (Workplace Studio and Preview), so new rooms can line up with the
 * walls under them. Room tools also snap to these lines (geometry.snapRectToOutline).
 *
 *   const outline = createFloorOutline(scene);
 *   outline.show(roomsBelow, elevation);   // rebuilt only when something changed
 *   outline.hide();
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

const LIFT = 0.035; // just above the room floors (they sit 0.02 up)

export function createFloorOutline(scene) {
  let mesh = null;
  let key = '';

  function dispose() {
    mesh?.dispose();
    mesh = null;
    key = '';
  }

  return {
    /** Outline `rooms` (store shape) at the height of the floor being built on. */
    show(rooms, elevation) {
      const next = JSON.stringify([elevation, rooms.map((r) => [r.x, r.z, r.width, r.depth])]);
      if (next !== key) {
        dispose();
        key = next;
        if (rooms.length === 0) return;
        const y = elevation + LIFT;
        const lines = rooms.map((r) => {
          const x0 = r.x - r.width / 2, x1 = r.x + r.width / 2;
          const z0 = r.z - r.depth / 2, z1 = r.z + r.depth / 2;
          return [
            new Vector3(x0, y, z0), new Vector3(x1, y, z0), new Vector3(x1, y, z1),
            new Vector3(x0, y, z1), new Vector3(x0, y, z0),
          ];
        });
        mesh = MeshBuilder.CreateLineSystem('floorBelowOutline', { lines }, scene);
        mesh.color = Color3.FromHexString('#d6e6ff');
        mesh.alpha = 0.6;
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        mesh.metadata = { floorOutline: true };
      }
      mesh?.setEnabled(true);
    },
    hide() {
      mesh?.setEnabled(false);
    },
    dispose,
  };
}
