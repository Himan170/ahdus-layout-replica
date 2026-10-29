import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

vi.mock('../../utils/materialLibrary', () => ({
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1, plaster: 2, ceiling: 1.2 },
  FLOOR_BY_ROOM_TYPE: {},
  getAssetMaterial: () => null,
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'structure', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
}));
vi.mock('../../utils/assetInstances', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/assetInstances')>()),
  createItemMesh: vi.fn((assetType: string, scene: Scene, objectId: string, { floorId = 0 }: any = {}) => {
    const root = new TransformNode(`item_${objectId}`, scene);
    root.metadata = { assetType, objectId, floorId };
    return root;
  }),
  disposeItemMesh: vi.fn((root: TransformNode) => root.dispose()),
}));
vi.mock('../../utils/lockIndicator', () => ({ applyLockVisual: vi.fn(), removeLockVisual: vi.fn() }));

const { RoomSystem } = await import('../systems/RoomSystem');
const { ObjectSystem } = await import('../systems/ObjectSystem');
const { FloorSystem } = await import('../systems/FloorSystem');
const { SceneBuilder } = await import('../systems/SceneBuilder');
const { createItemMesh } = await import('../../utils/assetInstances');
type Progress = import('../systems/SceneBuilder').BuildProgress;

const FLOORS = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
  2: { id: 2, name: 'Floor 2', height: 3.5 },
};
const room = (id: string, floor: number, x: number, extra = {}) => ({
  id, name: id, type: 'OFFICE', floor, x, z: 0, width: 4, depth: 4, wallHeight: 3.2, doors: [], windows: [], ...extra,
});
const item = (id: string, floor: number) => ({
  id, assetType: 'DESK', floor, x: 0, y: 0, z: 0,
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false,
});

/** Three floors: two rooms and one desk on each. */
function bigLayout(currentFloor = 0) {
  const rooms: Record<string, any> = {};
  const objects: Record<string, any> = {};
  for (const f of [0, 1, 2]) {
    rooms[`r${f}a`] = room(`r${f}a`, f, 0);
    rooms[`r${f}b`] = room(`r${f}b`, f, 10);
    objects[`d${f}`] = item(`d${f}`, f);
  }
  return { rooms, objects, floors: FLOORS, currentFloor, selectedRoomId: null as string | null };
}

let scene: Scene | null = null;
afterEach(() => {
  scene?.dispose();
  scene = null;
  vi.mocked(createItemMesh).mockClear();
});

/** A builder whose slices run only when the test says (tasks.run()); each slice does one piece of work. */
function setup(initial: ReturnType<typeof bigLayout> | any = bigLayout()) {
  scene = new Scene(new NullEngine());
  const state = { current: initial };
  const rooms = new RoomSystem(scene);
  const objects = new ObjectSystem(scene);
  const floors = new FloorSystem(rooms, objects, () => state.current);
  const queue: (() => void)[] = [];
  const tasks = {
    get size() { return queue.length; },
    run() { const fn = queue.shift(); fn?.(); return !!fn; },
    runAll() { let n = 0; while (this.run()) if (++n > 500) throw new Error('the build never ends'); return n; },
    until(done: () => boolean) { for (let n = 0; !done(); n++) if (n > 500 || !this.run()) throw new Error('never happened'); },
  };
  const progress: Progress[] = [];
  const builder = new SceneBuilder({
    rooms, objects, floors,
    getLayout: () => state.current,
    budgetMs: 0, // one piece of work per slice
    onProgress: (p) => progress.push(p),
    nextTask: (fn) => {
      queue.push(fn);
      return () => { const i = queue.indexOf(fn); if (i >= 0) queue.splice(i, 1); };
    },
  });
  const built = () => [...rooms.meshes.keys(), ...objects.meshes.keys()].sort();
  return { state, rooms, objects, builder, tasks, progress, built };
}

describe('SceneBuilder', () => {
  it('builds in slices: the start floor first, then the floors below, then above', () => {
    const { builder, tasks, progress, built } = setup(bigLayout(1));
    builder.start();
    expect(builder.isBuilding).toBe(true);
    tasks.runAll();
    expect(builder.isBuilding).toBe(false);
    expect(built()).toEqual(['d0', 'd1', 'd2', 'r0a', 'r0b', 'r1a', 'r1b', 'r2a', 'r2b']);

    // The order things appeared in: floor 1, then 0, then 2
    const ready = progress.findIndex((p) => p.currentFloorReady);
    const all = progress.findIndex((p) => p.allBuilt);
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(ready).toBeLessThan(all);
    const floorsBuilt = progress.filter((p) => !p.allBuilt).map((p) => p.floor);
    expect([...new Set(floorsBuilt)]).toEqual([1, 0, 2]);
    expect(progress.at(-1)).toEqual({ done: 9, total: 9, floor: 1, currentFloorReady: true, allBuilt: true });
  });

  it('never builds anything twice', () => {
    const { builder, tasks } = setup();
    const roomBuilds = vi.spyOn(RoomSystem.prototype, 'sync');
    builder.start();
    tasks.runAll();
    builder.request(); // nothing changed
    expect(createItemMesh).toHaveBeenCalledTimes(3);
    expect(roomBuilds.mock.results.reduce((n, r) => n + (r.value as { rebuilt: number }).rebuilt, 0)).toBe(6);
    roomBuilds.mockRestore();
  });

  it('builds from the latest layout: edits while it builds are part of the build', () => {
    const { state, builder, tasks, rooms, built } = setup();
    builder.start();
    tasks.run();
    // While floor 0 is still building: delete a room upstairs (not built yet),
    // add a room on floor 0, and make r0a wider
    const { r2b: _gone, ...rest } = state.current.rooms;
    state.current = {
      ...state.current,
      rooms: { ...rest, r0a: { ...rest.r0a, width: 6 }, new0: room('new0', 0, 20) },
    };
    builder.request();
    tasks.runAll();
    expect(built()).toEqual(['d0', 'd1', 'd2', 'new0', 'r0a', 'r0b', 'r1a', 'r1b', 'r2a']);
    const box = rooms.getRoomMesh('r0a')!.getHierarchyBoundingVectors(true);
    expect(box.max.x - box.min.x).toBeGreaterThan(6);
  });

  it('a deleted room disappears at once, even mid-build', () => {
    const { state, builder, tasks, rooms } = setup();
    builder.start();
    tasks.until(() => !!rooms.getRoomMesh('r0a'));
    const node = rooms.getRoomMesh('r0a')!;
    const { r0a: _gone, ...rest } = state.current.rooms;
    state.current = { ...state.current, rooms: rest };
    builder.request();
    expect(node.isDisposed()).toBe(true);
    expect(rooms.getRoomMesh('r0a')).toBeNull();
  });

  it('switching to a floor that is not built yet builds it next', () => {
    const { state, builder, tasks, objects } = setup();
    builder.start();
    tasks.run();
    state.current = { ...state.current, currentFloor: 2 };
    builder.request();
    // floor 2 before floor 1
    tasks.until(() => {
      expect(objects.getObjectMesh('d1')).toBeNull();
      return !!objects.getObjectMesh('d2');
    });
    expect(builder.progress.currentFloorReady).toBe(true);
    expect(builder.progress.allBuilt).toBe(false);
    tasks.runAll();
    expect(builder.progress.allBuilt).toBe(true);
  });

  it('whenBuilt resolves when everything is built; finish() builds the rest at once', async () => {
    const { builder, tasks, built } = setup();
    let done = false;
    builder.start();
    const p = builder.whenBuilt().then(() => { done = true; });
    tasks.run();
    await Promise.resolve();
    expect(done).toBe(false);
    builder.finish();
    await p;
    expect(done).toBe(true);
    expect(built()).toHaveLength(9);
    expect(tasks.size).toBe(0);
    await builder.whenBuilt(); // resolves at once when built
  });

  it('dispose() stops a running build cleanly', () => {
    const { builder, tasks, built } = setup();
    builder.start();
    tasks.run();
    const before = built().length;
    builder.dispose();
    expect(tasks.size).toBe(0); // the next slice was cancelled
    builder.request();
    builder.start();
    builder.finish();
    expect(built().length).toBe(before);
    expect(builder.isBuilding).toBe(false);
  });

  it('after the first build, a small change is built at once and a big one in slices', () => {
    const { state, builder, tasks, rooms, objects } = setup();
    builder.start();
    tasks.runAll();
    state.current = { ...state.current, rooms: { ...state.current.rooms, extra: room('extra', 0, 30) } };
    builder.request();
    expect(rooms.getRoomMesh('extra')).not.toBeNull(); // at once
    expect(tasks.size).toBe(0);

    const many: Record<string, any> = {};
    for (let i = 0; i < 60; i++) many[`x${i}`] = item(`x${i}`, 1);
    state.current = { ...state.current, objects: { ...state.current.objects, ...many } };
    builder.request();
    expect(builder.isBuilding).toBe(true); // in slices
    expect(objects.meshes.size).toBeLessThan(63);
    tasks.runAll();
    expect(objects.meshes.size).toBe(63);
  });

  it('an empty layout is built at once', () => {
    const { builder, tasks, progress } = setup({ rooms: {}, objects: {}, floors: { 0: FLOORS[0] }, currentFloor: 0, selectedRoomId: null });
    builder.start();
    expect(tasks.size).toBe(0);
    expect(builder.isBuilding).toBe(false);
    expect(progress.at(-1) ?? builder.progress).toMatchObject({ allBuilt: true, currentFloorReady: true });
  });
});
