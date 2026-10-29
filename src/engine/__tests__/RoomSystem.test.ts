import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

vi.mock('../../utils/materialLibrary', () => ({
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1, plaster: 2, ceiling: 1.2 },
  FLOOR_BY_ROOM_TYPE: {},
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'structure', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
}));

const { RoomSystem } = await import('../systems/RoomSystem');

const FLOORS = {
  0: { id: 0, name: 'Ground Floor', height: 3.5 },
  1: { id: 1, name: 'Floor 1', height: 3.5 },
};

const room = (id: string, x: number, z: number, extra = {}) => ({
  id, name: id, type: 'OFFICE', floor: 0, x, z, width: 4, depth: 4, wallHeight: 3.2,
  doors: [], windows: [], ...extra,
});

let scene: Scene | null = null;
afterEach(() => {
  scene?.dispose();
  scene = null;
});

function system() {
  scene = new Scene(new NullEngine());
  return new RoomSystem(scene);
}

describe('RoomSystem', () => {
  it('builds every room, each floor at its own height', () => {
    const rooms = system();
    const a = room('a', 0, 0);
    const up = room('up', 0, 0, { floor: 1 });
    const result = rooms.sync({ rooms: { a, up }, objects: {}, floors: FLOORS });
    expect(result.rebuilt).toBe(2);
    expect([...rooms.meshes.keys()].sort()).toEqual(['a', 'up']);
    const bottom = (id: string) => rooms.getRoomMesh(id)!.getHierarchyBoundingVectors(true).min.y;
    expect(bottom('up') - bottom('a')).toBeGreaterThan(3);
  });

  it('rebuilds only the rooms a change touches, and removes deleted rooms', () => {
    const rooms = system();
    // a and b back to back (a shared wall); c far away
    const a = room('a', 0, 0);
    const b = room('b', 4.15, 0);
    const c = room('c', 20, 0);
    rooms.sync({ rooms: { a, b, c }, objects: {}, floors: FLOORS });
    const cNode = rooms.getRoomMesh('c');

    expect(rooms.sync({ rooms: { a, b, c }, objects: {}, floors: FLOORS }).rebuilt).toBe(0);

    const a2 = { ...a, name: 'Renamed', depth: 5 };
    expect(rooms.sync({ rooms: { a: a2, b, c }, objects: {}, floors: FLOORS }).rebuilt).toBe(2); // a and b
    expect(rooms.getRoomMesh('c')).toBe(cNode);

    const bNode = rooms.getRoomMesh('b')!;
    rooms.sync({ rooms: [a2, c], objects: [], floors: FLOORS }); // lists work too
    expect(rooms.getRoomMesh('b')).toBeNull();
    expect(bNode.isDisposed()).toBe(true);
  });

  it('rebuilds a room when a staircase cuts its floor', () => {
    const rooms = system();
    const up = room('up', 0, 0, { floor: 1, width: 8, depth: 8 });
    rooms.sync({ rooms: { up }, objects: {}, floors: FLOORS });
    const stair = { id: 's', assetType: 'STAIRCASE', floor: 0, x: 0, y: 0, z: 0, rotationY: 0 };
    expect(rooms.sync({ rooms: { up }, objects: { s: stair }, floors: FLOORS }).rebuilt).toBe(1);
  });

  it('outlines the selected room only', () => {
    const rooms = system();
    const a = room('a', 0, 0);
    const c = room('c', 20, 0);
    rooms.sync({ rooms: { a, c }, objects: {}, floors: FLOORS }, 'a');
    const outlined = (id: string) => rooms.getRoomMesh(id)!.getChildMeshes(false)
      .some((m) => m.metadata?.part === 'wall' && m.renderOutline);
    expect(outlined('a')).toBe(true);
    expect(outlined('c')).toBe(false);
    rooms.sync({ rooms: { a, c }, objects: {}, floors: FLOORS }, 'c');
    expect(outlined('a')).toBe(false);
    expect(outlined('c')).toBe(true);
  });

  describe('progressive loading (floors + budget)', () => {
    // A budget that allows n builds (play/buildSchedule.createBudget, without a clock)
    const budget = (n: number) => {
      let taken = 0;
      return { take: () => (taken < n ? (taken++, true) : false), hasTime: () => taken < n, unlimited: false };
    };
    const layout = {
      rooms: {
        a: room('a', 0, 0), b: room('b', 10, 0), c: room('c', 20, 0),
        up: room('up', 0, 0, { floor: 1 }),
      },
      objects: {},
      floors: FLOORS,
    };

    it('builds only the floors asked for, until the budget runs out, and counts the rest', () => {
      const rooms = system();
      const first = rooms.sync(layout, null, { floors: [0], budget: budget(2) });
      expect(first).toMatchObject({ rebuilt: 2, pending: 1, complete: false });
      expect(rooms.getRoomMesh('up')).toBeNull();

      const second = rooms.sync(layout, null, { floors: [0], budget: budget(2) });
      expect(second).toMatchObject({ rebuilt: 1, pending: 0 }); // the built two are not built again
      expect([...rooms.meshes.keys()].sort()).toEqual(['a', 'b', 'c']);

      expect(rooms.sync(layout, null, { floors: [1], budget: budget(2) })).toMatchObject({ rebuilt: 1, pending: 0 });
      expect(rooms.sync(layout).rebuilt).toBe(0); // all up to date
    });

    it('builds a room from the latest layout, and removes deleted rooms even when out of time', () => {
      const rooms = system();
      rooms.sync(layout, null, { floors: [0], budget: budget(1) }); // only a
      const nodeA = rooms.getRoomMesh('a')!;
      // edited while loading: b grew, a was deleted
      const edited = { ...layout, rooms: { b: { ...layout.rooms.b, width: 6 }, c: layout.rooms.c, up: layout.rooms.up } };
      expect(rooms.sync(edited, null, { floors: [0], budget: budget(0) })).toMatchObject({ rebuilt: 0, pending: 2 });
      expect(nodeA.isDisposed()).toBe(true);
      expect(rooms.getRoomMesh('a')).toBeNull();

      rooms.sync(edited, null, { floors: [0], budget: budget(5) });
      const b = rooms.getRoomMesh('b')!;
      const box = b.getHierarchyBoundingVectors(true);
      expect(box.max.x - box.min.x).toBeGreaterThan(6); // the new width (plus walls), not 4
    });

    it('a changed room that does not fit in the budget keeps its old mesh until it is rebuilt', () => {
      const rooms = system();
      rooms.sync(layout);
      const old = rooms.getRoomMesh('c')!;
      const edited = { ...layout, rooms: { ...layout.rooms, c: { ...layout.rooms.c, depth: 6 } } };
      // out of time: c is not checked, so the floor is not complete
      expect(rooms.sync(edited, null, { floors: [0], budget: budget(0) }))
        .toMatchObject({ rebuilt: 0, pending: 0, complete: false });
      expect(rooms.getRoomMesh('c')).toBe(old);
      expect(old.isDisposed()).toBe(false);
      expect(rooms.sync(edited, null, { floors: [0], budget: budget(1) }))
        .toMatchObject({ rebuilt: 1, pending: 0, complete: true });
      expect(old.isDisposed()).toBe(true);
    });

    it('lists the materials of the rooms on a floor as separate steps', () => {
      const rooms = system();
      expect(rooms.materialSteps(layout, [0]).length).toBeGreaterThanOrEqual(3);
      expect(rooms.materialSteps(layout, [5])).toEqual([]);
      for (const step of rooms.materialSteps(layout)) step();
    });
  });

  it('disposeAll removes every room', () => {
    const rooms = system();
    rooms.sync({ rooms: { a: room('a', 0, 0) }, objects: {}, floors: FLOORS });
    const node = rooms.getRoomMesh('a')!;
    rooms.disposeAll();
    expect(rooms.meshes.size).toBe(0);
    expect(node.isDisposed()).toBe(true);
  });
});
