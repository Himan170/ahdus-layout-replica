import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

import { FloorSystem } from '../systems/FloorSystem';
import type { RoomSystem } from '../systems/RoomSystem';
import type { ObjectSystem } from '../systems/ObjectSystem';

const FLOORS = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
};
const room = (id: string, floor: number, x = 0) => ({ id, name: id, floor, x, z: 0, width: 4, depth: 4 });

let scene: Scene | null = null;
afterEach(() => {
  scene?.dispose();
  scene = null;
});

/** Room nodes with a roof, ceiling and band each (as roomBuilder tags them), and one item per floor. */
function setup(rooms: ReturnType<typeof room>[]) {
  scene = new Scene(new NullEngine());
  const roomMeshes = new Map<string, TransformNode>();
  for (const r of rooms) {
    const node = new TransformNode(r.id, scene);
    for (const part of ['wall', 'roof', 'ceiling', 'band']) {
      const mesh = MeshBuilder.CreateBox(`${r.id}_${part}`, {}, scene);
      mesh.metadata = { part };
      mesh.parent = node;
    }
    roomMeshes.set(r.id, node);
  }
  const objects = [{ id: 'o0', assetType: 'DESK', floor: 0, x: 0, z: 0 }, { id: 'o1', assetType: 'DESK', floor: 1, x: 0, z: 0 }];
  const objectMeshes = new Map(objects.map((o) => [o.id, new TransformNode(o.id, scene!)]));
  const layout = { rooms, objects, floors: FLOORS };
  const floorSystem = new FloorSystem(
    { meshes: roomMeshes } as unknown as RoomSystem,
    { meshes: objectMeshes } as unknown as ObjectSystem,
    () => layout,
  );
  const part = (roomId: string, name: string) =>
    roomMeshes.get(roomId)!.getChildMeshes(false).find((m) => m.metadata.part === name)!.isEnabled();
  return { floorSystem, roomMeshes, objectMeshes, part };
}

describe('FloorSystem', () => {
  it('planner view: floors up to the one being edited, without its roof', () => {
    const { floorSystem, roomMeshes, objectMeshes, part } = setup([room('g', 0), room('u', 1)]);
    floorSystem.setFloor(0);
    expect(roomMeshes.get('u')!.isEnabled(false)).toBe(false);
    expect(objectMeshes.get('o1')!.isEnabled(false)).toBe(false);
    expect(part('g', 'roof')).toBe(false);
    expect(part('g', 'ceiling')).toBe(false);

    floorSystem.setFloor(1);
    expect(floorSystem.getView()).toEqual({ mode: 'planner', level: 1 });
    expect(roomMeshes.get('u')!.isEnabled(false)).toBe(true);
    expect(objectMeshes.get('o1')!.isEnabled(false)).toBe(true);
    expect(part('u', 'roof')).toBe(false);
    // the ground-floor room is covered by the one above: its band shows, its roof doesn't
    expect(part('g', 'roof')).toBe(false);
    expect(part('g', 'band')).toBe(true);
  });

  it('outside: every floor with roofs on uncovered rooms; inside: ceilings too', () => {
    const { floorSystem, part } = setup([room('g', 0), room('side', 0, 10), room('u', 1)]);
    floorSystem.setView({ mode: 'outside', level: 0 });
    expect(part('u', 'roof')).toBe(true);
    expect(part('side', 'roof')).toBe(true);
    expect(part('g', 'roof')).toBe(false);
    expect(part('u', 'ceiling')).toBe(false);

    floorSystem.setView({ mode: 'inside', level: 0 });
    expect(part('g', 'ceiling')).toBe(true);
    expect(part('u', 'ceiling')).toBe(true);
  });
});
