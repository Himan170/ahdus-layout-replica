import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// Rooms are built for real (procedural textures stubbed); items are plain
// nodes standing in for instances, as in ObjectSystem.test.ts.
vi.mock('../../utils/materialLibrary', () => ({
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1 },
  FLOOR_BY_ROOM_TYPE: {},
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
  getAssetMaterial: () => null,
}));
vi.mock('../../utils/assetInstances', async (importOriginal) => ({
  ...(await importOriginal<object>()),   // rooms merge their parts with mergeByMaterial
  createItemMesh: vi.fn((assetType: string, scene: Scene, objectId: string, { rise, floorId = 0 }: any = {}) => {
    const root = new TransformNode(`item_${objectId}`, scene);
    root.metadata = { assetType, objectId, floorId, ...(rise !== undefined ? { rise } : {}) };
    return root;
  }),
  disposeItemMesh: vi.fn((root: TransformNode) => root.dispose()),
}));
vi.mock('../../utils/lockIndicator', () => ({
  applyLockVisual: vi.fn(),
  removeLockVisual: vi.fn(),
}));

const { LayoutEngine } = await import('../LayoutEngine');
const { loadLayout } = await import('../model/migrate');
const { useWorkspaceStore } = await import('../../store/workspaceStore');
type Engine = ReturnType<typeof LayoutEngine.fromScene>;

/** A save as the app writes it: two storeys, a door and a window, a desk and stairs. */
function save() {
  return {
    layoutName: 'Head office',
    layoutVersion: 1,
    floors: {
      0: { id: 0, name: 'Ground Floor', height: 3.5 },
      1: { id: 1, name: 'Floor 1', height: 4 },
    },
    rooms: [
      { id: 'room_a', type: 'OFFICE', name: 'Office 1', floor: 0, x: 0, z: 0, width: 6, depth: 4,
        wallHeight: 3.2, color: '#4a7dff', doors: [{ wall: 'south', offset: 1, width: 0.9, height: 2.1 }],
        windows: [{ wall: 'north', offset: 2, width: 1.4, height: 1.2, sill: 0.9 }] },
      { id: 'room_b', type: 'MEETING', name: 'Meeting 1', floor: 1, x: 0, z: 0, width: 6, depth: 4,
        wallHeight: 3.7, color: '#38b764', doors: [], windows: [] },
    ],
    objects: [
      { id: 'obj_desk', assetType: 'DESK_STANDARD', name: 'DESK_STANDARD 1', floor: 0, roomId: 'room_a',
        x: 1, y: 0, z: 1, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, label: '' },
      { id: 'obj_stairs', assetType: 'STAIRCASE', name: 'STAIRCASE 1', floor: 0, roomId: 'room_a',
        x: -2, y: 0, z: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, label: '' },
      { id: 'obj_chair', assetType: 'OFFICE_CHAIR', name: 'OFFICE_CHAIR 1', floor: 1, roomId: 'room_b',
        x: 1, y: 0, z: 1, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, label: '' },
    ],
    anchorData: {},
  };
}

/** The same layout as v2 with what only v2 has (routes, floor links, a free anchor, an underlay). */
function v2Layout() {
  const v2 = loadLayout(save());
  return {
    ...v2,
    building: { name: 'Head office', address: '1 Main Road', northAngle: 15 },
    floors: v2.floors.map((f) => (f.id === 0
      ? { ...f, underlay: { path: 'plans/ground.png', scale: 20, offsetX: 1, offsetZ: 2, opacity: 0.4 } }
      : f)),
    anchors: [
      { id: '11111111-1111-4111-8111-111111111111', kind: 'info-point' as const, floorId: 0, roomId: 'room_a',
        position: { x: 0, y: 1, z: 0 }, rotationY: 0, label: 'Safety board' },
      ...v2.anchors,
    ],
    routes: [{ id: 'route-1', floorId: 0, kind: 'evacuation' as const, label: 'Exit',
      waypoints: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -5 }] }],
    floorLinks: [{ id: 'link-1', kind: 'stairs' as const, fromObjectId: 'obj_stairs', toObjectId: 'obj_stairs' }],
  };
}

const engines: Engine[] = [];
afterEach(() => {
  while (engines.length) engines.pop()!.dispose();
  useWorkspaceStore.getState().resetWorkspace();
});

/** An engine on a NullEngine scene (no canvas, no GPU). */
function makeEngine(options = {}) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const layoutScene = {
    engine, scene, camera: null, lights: { shadowGenerator: null }, siteEnv: null,
    dispose() { scene.dispose(); engine.dispose(); },
  } as any;
  const layoutEngine = LayoutEngine.fromScene(layoutScene, options);
  engines.push(layoutEngine);
  return layoutEngine;
}

const enabled = (node: TransformNode | null) => !!node?.isEnabled();

describe('LayoutEngine.loadLayout draws a layout', () => {
  it('builds every room and item of a save, each floor at its own height', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    expect([...engine.rooms.meshes.keys()].sort()).toEqual(['room_a', 'room_b']);
    expect([...engine.objects.meshes.keys()].sort()).toEqual(['obj_chair', 'obj_desk', 'obj_stairs']);
    expect(engine.objects.getObjectMesh('obj_chair')!.position.y).toBeCloseTo(3.5);
    const bottom = (id: string) => engine.rooms.getRoomMesh(id)!.getHierarchyBoundingVectors(true).min.y;
    expect(bottom('room_b') - bottom('room_a')).toBeGreaterThan(3);
    // the stairs climb their floor's height
    expect(engine.objects.getObjectMesh('obj_stairs')!.metadata.rise).toBe(3.5);
  });

  it('takes an exported layout file too', () => {
    const engine = makeEngine();
    engine.loadLayout({ format: 'ahdus-layout', formatVersion: 1, layout: save() });
    expect(engine.rooms.meshes.size).toBe(2);
    expect(engine.getLayout()!.building.name).toBe('Head office');
  });

  it('shows the whole building at first; setFloor shows the floors up to that one', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(true);
    engine.setFloor(0);
    expect(enabled(engine.rooms.getRoomMesh('room_a'))).toBe(true);
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(false);
    expect(enabled(engine.objects.getObjectMesh('obj_chair'))).toBe(false);
    engine.setFloor(1);
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(true);
    expect(enabled(engine.objects.getObjectMesh('obj_chair'))).toBe(true);
  });

  it('a second layout replaces the first (meshes of rooms no longer there are removed)', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    const smaller = save();
    smaller.rooms = smaller.rooms.slice(0, 1);
    smaller.objects = smaller.objects.slice(0, 1);
    engine.loadLayout(smaller);
    expect([...engine.rooms.meshes.keys()]).toEqual(['room_a']);
    expect([...engine.objects.meshes.keys()]).toEqual(['obj_desk']);
  });

  it('refuses data that is not a layout and keeps the one shown', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    expect(() => engine.loadLayout({ schemaVersion: 2, rooms: [{ id: 'x', floorId: 0, width: 'wide' }] })).toThrow();
    expect(engine.rooms.meshes.size).toBe(2);
    expect(engine.getLayout()!.rooms).toHaveLength(2);
  });
});

describe('LayoutEngine.getLayout returns the layout as v2', () => {
  it('is null before a layout is loaded', () => {
    expect(makeEngine().getLayout()).toBeNull();
  });

  it('v2 in, the same v2 out (including routes, floor links, free anchors, underlays, the address)', () => {
    const engine = makeEngine();
    const input = v2Layout();
    engine.loadLayout(input);
    expect(engine.getLayout()).toEqual(loadLayout(input));
  });

  it('a save in gives the same v2 as the migration', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    expect(engine.getLayout()).toEqual(loadLayout(save()));
  });

  it('includes changes made in the engine since, and redraws them', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    const before = engine.rooms.getRoomMesh('room_a');
    engine.getStore().getState().updateRoom('room_a', { width: 8 });
    engine.getStore().getState().updateObject('obj_desk', { x: 2.5 });
    expect(engine.getLayout()!.rooms.find((r) => r.id === 'room_a')!.width).toBe(8);
    expect(engine.getObjectById('obj_desk')!.x).toBe(2.5);
    expect(engine.rooms.getRoomMesh('room_a')).not.toBe(before);
    expect(engine.objects.getObjectMesh('obj_desk')!.position.x).toBe(2.5);
    // the workstation anchor moved with its desk
    expect(engine.getAnchors({ kind: 'workstation' })[0].position.x).not.toBe(
      loadLayout(save()).anchors.find((a) => a.kind === 'workstation')!.position.x);
  });
});

describe('each engine keeps its own copy of the layout', () => {
  it('two engines and the app store never share rooms', () => {
    const a = makeEngine();
    const b = makeEngine();
    a.loadLayout(save());
    expect(b.getLayout()).toBeNull();
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(0);
    b.loadLayout({ ...save(), rooms: [] });
    expect(a.getLayout()!.rooms).toHaveLength(2);
    expect(b.getLayout()!.rooms).toHaveLength(0);
  });

  it('dispose() disposes the scene', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    engines.pop();
    engine.dispose();
    expect(engine.scene.isDisposed).toBe(true);
    expect(engine.rooms.meshes.size).toBe(0);
  });
});
