import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

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

describe('roomBuilder shared-wall meshes', () => {
  const west = { id: 'a', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3, doors: [], windows: [] };
  const east = { id: 'b', floor: 0, x: 5.15, z: 0, width: 4, depth: 4, wallHeight: 3.5, doors: [], windows: [] };

  it('builds one 0.15 m physical wall at the shared boundary', () => {
    const westRoot = build(west, [west, east]);
    const eastRoot = buildRoomMesh(east, scene, { rooms: [west, east] });
    const shared = wallMeshes(westRoot, 'east');

    expect(shared).toHaveLength(1);
    expect(shared[0].position.x).toBeCloseTo(3.075);
    expect(shared[0].getBoundingInfo().boundingBox.extendSize.x * 2).toBeCloseTo(0.15);
    expect(shared[0].getBoundingInfo().boundingBox.extendSize.z * 2).toBeCloseTo(3.85);
    expect(shared[0].getBoundingInfo().boundingBox.extendSize.y * 2).toBeCloseTo(3.5);
    expect(wallMeshes(eastRoot, 'west')).toHaveLength(0);
  });

  it('builds the shared portion of a partial wall and leaves both outer sections', () => {
    const shortEast = { ...east, z: -1, depth: 2 };
    const root = build(west, [west, shortEast]);
    const eastWalls = wallMeshes(root, 'east');
    const middle = eastWalls.find((mesh) => Math.abs(mesh.position.x - 3.075) < 1e-6);

    expect(middle).toBeTruthy();
    expect(middle.getBoundingInfo().boundingBox.extendSize.z * 2).toBeCloseTo(1.85);
    expect(eastWalls).toHaveLength(2);
  });

  it('builds one passable door and one correctly tagged pane for paired references', () => {
    const a = { ...west, doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] };
    const b = { ...east, doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] };
    const root = build(a, [a, b]);
    const doorMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'door');
    const pane = doorMeshes.find((mesh) => mesh.metadata.pickPane);
    const wallMeshesEast = wallMeshes(root, 'east');

    expect(pane).toBeTruthy();
    expect(pane.position.x).toBeCloseTo(3.075);
    expect(pane.position.z).toBeCloseTo(0.25);
    expect(doorMeshes).toHaveLength(4);
    expect(pane.checkCollisions).toBe(false);
    expect(wallMeshesEast.some((mesh) => {
      const extent = mesh.getBoundingInfo().boundingBox.extendSize;
      return Math.abs(mesh.position.z - 0.25) < extent.z &&
        Math.abs(mesh.position.y - 1) < extent.y;
    })).toBe(false);
  });

  it('builds a partner-only window at its world position and sill height', () => {
    const a = { ...west, windows: [] };
    const b = { ...east, windows: [{ wall: 'west', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }] };
    const root = build(a, [a, b]);
    const windowMeshes = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.part === 'window');
    const pane = windowMeshes.find((mesh) => mesh.metadata.pickPane);

    expect(windowMeshes).toHaveLength(7);
    expect(pane.position.x).toBeCloseTo(3.075);
    expect(pane.position.z).toBeCloseTo(0.5);
    expect(pane.position.y).toBeCloseTo(1.5);
    expect(pane.metadata).toMatchObject({ roomId: 'b', wallName: 'west', openingIndex: 0 });
  });
});
