import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

vi.mock('./materialLibrary', () => ({
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1 },
  FLOOR_BY_ROOM_TYPE: {},
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
}));

const { buildRoomMesh } = await import('./roomBuilder');

let scene;
afterEach(() => {
  scene?.dispose();
  scene = null;
});

function build(room, rooms = [room]) {
  scene = new Scene(new NullEngine());
  return buildRoomMesh(room, scene, { rooms });
}

function wallMeshes(root, wallName) {
  return root.getChildMeshes(false).filter((mesh) =>
    mesh.name.startsWith('wall_') &&
    mesh.metadata?.part === 'wall' && mesh.metadata.wallName === wallName);
}

// The pieces of one wall (or one door / window frame) are merged into one mesh
// with their positions baked in, so measure world bounds and cast rays.
const bounds = (mesh) => mesh.getBoundingInfo().boundingBox;
const size = (mesh, axis) => bounds(mesh).maximumWorld[axis] - bounds(mesh).minimumWorld[axis];
const centre = (mesh) => bounds(mesh).centerWorld;
/** Where a ray going +X from x = 2 at (y, z) first hits `mesh`, or null. */
function hitX(mesh, y, z) {
  const hit = new Ray(new Vector3(2, y, z), new Vector3(1, 0, 0), 10).intersectsMesh(mesh);
  return hit.hit ? hit.pickedPoint.x : null;
}

describe('roomBuilder shared-wall meshes', () => {
  const west = { id: 'a', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3, doors: [], windows: [] };
  const east = { id: 'b', floor: 0, x: 5.15, z: 0, width: 4, depth: 4, wallHeight: 3.5, doors: [], windows: [] };

  it('builds one 0.15 m physical wall at the shared boundary', () => {
    const westRoot = build(west, [west, east]);
    const eastRoot = buildRoomMesh(east, scene, { rooms: [west, east] });
    const shared = wallMeshes(westRoot, 'east');

    expect(shared).toHaveLength(1);
    expect(centre(shared[0]).x).toBeCloseTo(3.075);
    expect(size(shared[0], 'x')).toBeCloseTo(0.15);
    expect(size(shared[0], 'z')).toBeCloseTo(3.85);
    expect(size(shared[0], 'y')).toBeCloseTo(3.5);
    expect(wallMeshes(eastRoot, 'west')).toHaveLength(0);
  });

  it('builds the shared portion of a partial wall and leaves the outer section', () => {
    const shortEast = { ...east, z: -1, depth: 2 };
    const root = build(west, [west, shortEast]);
    const eastWalls = wallMeshes(root, 'east');

    expect(eastWalls).toHaveLength(1); // one mesh per wall
    // shared portion (z -1.925 .. -0.075): the 0.15 m wall at x 3.0 .. 3.15
    expect(hitX(eastWalls[0], 1, -1.9)).toBeCloseTo(3.0);
    expect(hitX(eastWalls[0], 1, -0.1)).toBeCloseTo(3.0);
    // the rest stays this room's own wall at x 2.925 .. 3.075
    expect(hitX(eastWalls[0], 1, 0.1)).toBeCloseTo(2.925);
    expect(hitX(eastWalls[0], 1, 1.9)).toBeCloseTo(2.925);
  });

  it('builds one passable door and one correctly tagged pane for paired references', () => {
    const a = { ...west, doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] };
    const b = { ...east, doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] };
    const root = build(a, [a, b]);
    const doorMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'door');
    const pane = doorMeshes.find((mesh) => mesh.metadata.pickPane);
    const [wall] = wallMeshes(root, 'east');

    expect(pane).toBeTruthy();
    expect(centre(pane).x).toBeCloseTo(3.075);
    expect(centre(pane).z).toBeCloseTo(0.25);
    expect(doorMeshes).toHaveLength(2); // one frame + one pane, not one of each per room
    expect(pane.checkCollisions).toBe(false);
    expect(hitX(wall, 1, 0.25)).toBeNull();      // a hole where the door is
    expect(hitX(wall, 1, -1.5)).toBeCloseTo(3.0); // solid beside it
  });

  it('builds a partner-only window at its world position and sill height', () => {
    const a = { ...west, windows: [] };
    const b = { ...east, windows: [{ wall: 'west', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }] };
    const root = build(a, [a, b]);
    const windowMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'window');
    const pane = windowMeshes.find((mesh) => mesh.metadata.pickPane);

    expect(windowMeshes).toHaveLength(2); // frame + glass in one mesh, and the pane
    expect(centre(pane).x).toBeCloseTo(3.075);
    expect(centre(pane).z).toBeCloseTo(0.5);
    expect(centre(pane).y).toBeCloseTo(1.5);
    expect(pane.metadata).toMatchObject({ roomId: 'b', wallName: 'west', openingIndex: 0 });
  });
});
