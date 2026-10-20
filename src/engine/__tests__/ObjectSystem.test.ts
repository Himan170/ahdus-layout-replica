import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// Items are instances of procedurally built templates; a plain node stands in
// for one here (utils/assetInstances.js has its own look and merge logic).
vi.mock('../../utils/materialLibrary', () => ({ getAssetMaterial: () => null }));
vi.mock('../../utils/assetInstances', () => ({
  createItemMesh: vi.fn((assetType: string, scene: Scene, objectId: string, { rise, floorId = 0 }: any = {}) => {
    const root = new TransformNode(`item_${objectId}`, scene);
    root.metadata = { assetType, objectId, floorId, ...(rise !== undefined ? { rise } : {}) };
    return root;
  }),
  disposeItemMesh: vi.fn((root: TransformNode) => root.dispose()),
}));
vi.mock('../../utils/lockIndicator', () => ({
  applyLockVisual: vi.fn((root: TransformNode) => { root.metadata.locked = true; }),
  removeLockVisual: vi.fn((root: TransformNode) => { root.metadata.locked = false; }),
}));

const { ObjectSystem } = await import('../systems/ObjectSystem');
const { createItemMesh } = await import('../../utils/assetInstances');

const FLOORS = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 4 },
};

const item = (id: string, extra = {}) => ({
  id, assetType: 'DESK', floor: 0, x: 1, y: 0, z: 2,
  rotationX: 0, rotationY: 0.5, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...extra,
});

let scene: Scene | null = null;
afterEach(() => {
  scene?.dispose();
  scene = null;
  vi.mocked(createItemMesh).mockClear();
});

function system() {
  scene = new Scene(new NullEngine());
  return new ObjectSystem(scene);
}

describe('ObjectSystem', () => {
  it('places items at world height (their floor + their own height)', () => {
    const objects = system();
    objects.sync({ objects: { d: item('d'), up: item('up', { floor: 1, y: 0.75 }) }, floors: FLOORS });
    const d = objects.getObjectMesh('d')!;
    expect([d.position.x, d.position.y, d.position.z]).toEqual([1, 0, 2]);
    expect(d.rotation.y).toBe(0.5);
    expect(objects.getObjectMesh('up')!.position.y).toBeCloseTo(3.5 + 0.75);
  });

  it('moves changed items without rebuilding them, and removes deleted ones', () => {
    const objects = system();
    objects.sync({ objects: { d: item('d'), e: item('e') }, floors: FLOORS });
    const d = objects.getObjectMesh('d')!;
    const e = objects.getObjectMesh('e')!;
    objects.sync({ objects: [item('d', { x: 5, isLocked: true })], floors: FLOORS });
    expect(objects.getObjectMesh('d')).toBe(d);
    expect(d.position.x).toBe(5);
    expect(d.metadata.locked).toBe(true);
    expect(objects.getObjectMesh('e')).toBeNull();
    expect(e.isDisposed()).toBe(true);
    expect(createItemMesh).toHaveBeenCalledTimes(2);
  });

  it('rebuilds a staircase when its floor height changes or it moves to another floor', () => {
    const objects = system();
    const stair = item('s', { assetType: 'STAIRCASE' });
    objects.sync({ objects: { s: stair }, floors: FLOORS });
    const first = objects.getObjectMesh('s')!;
    expect(first.metadata.rise).toBe(3.5);

    objects.sync({ objects: { s: stair }, floors: { ...FLOORS, 0: { ...FLOORS[0], height: 4.2 } } });
    const taller = objects.getObjectMesh('s')!;
    expect(taller).not.toBe(first);
    expect(taller.metadata.rise).toBe(4.2);

    objects.sync({ objects: { s: { ...stair, floor: 1 } }, floors: FLOORS });
    expect(objects.getObjectMesh('s')!.metadata).toMatchObject({ floorId: 1, rise: 4 });
  });

  it('disposeAll removes every item', () => {
    const objects = system();
    objects.sync({ objects: { d: item('d') }, floors: FLOORS });
    const d = objects.getObjectMesh('d')!;
    objects.disposeAll();
    expect(objects.meshes.size).toBe(0);
    expect(d.isDisposed()).toBe(true);
  });
});
