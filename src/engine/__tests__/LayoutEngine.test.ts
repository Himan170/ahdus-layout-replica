import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

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
  // which looks an item has (the real one swaps its instance for a clone)
  setItemLook: vi.fn((root: TransformNode, reason: string, on: boolean) => {
    const looks: Set<string> = (root.metadata.looks ??= new Set());
    if (on) looks.add(reason); else looks.delete(reason);
    return null;
  }),
}));
vi.mock('../../utils/lockIndicator', () => ({
  applyLockVisual: vi.fn(),
  removeLockVisual: vi.fn(),
}));
// Preview's controller needs a browser window; e2e/viewer-smoke.mjs walks for real.
// Here: what the engine gives it and does with what it reports.
const controllers = vi.hoisted(() => [] as any[]);
vi.mock('../../play/playController', () => ({
  createPlayController: vi.fn((_scene: unknown, _canvas: unknown, options: any) => {
    const c: any = {
      options, active: false,
      activate: vi.fn(() => { c.active = true; }),
      deactivate: vi.fn(() => { c.active = false; }),
      isActive: () => c.active,
      respawn: vi.fn(),
      setPose: vi.fn(),
      getRoomId: () => null,
      getLevel: () => 0,
      getYaw: () => 0.5,
      getPosition: () => ({ x: 1, y: 0, z: 2 }),
      stepFloor: vi.fn(),
      dispose: vi.fn(),
    };
    controllers.push(c);
    return c;
  }),
}));

const { LayoutEngine, READ_ONLY } = await import('../LayoutEngine');
const { loadLayout } = await import('../model/migrate');
const { useWorkspaceStore } = await import('../../store/workspaceStore');
const { createLighting } = await import('../../utils/lightingSetup');
const { anchorId } = await import('../model/anchors');
const { layoutBridge, connectEngine } = await import('../../integration/layoutBridge');
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
  const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 4, 30, Vector3.Zero(), scene);
  const layoutScene = {
    engine, scene, camera, lights: createLighting(scene), siteEnv: null,
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

describe('camera: setView and focusOn', () => {
  it("setView('2d') looks straight down (orthographic); '3d' goes back to where the camera was", () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    const alpha = camera.alpha;
    engine.setView('2d');
    expect(engine.view).toBe('2d');
    expect(camera.mode).toBe(Camera.ORTHOGRAPHIC_CAMERA);
    expect(camera.beta).toBeLessThan(0.05);
    engine.setView('3d');
    expect(camera.mode).toBe(Camera.PERSPECTIVE_CAMERA);
    expect(camera.alpha).toBeCloseTo(alpha);
  });

  it("focusOn a room on an upper floor: the camera centres on it at that floor's height, and the floor shows", () => {
    const engine = makeEngine();
    const layout = save();
    layout.rooms[1] = { ...layout.rooms[1], x: 10, z: -4 };
    engine.loadLayout(layout);
    engine.setFloor(0);
    expect(engine.focusOn('room_b', { animate: false })).toBe(true);
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    expect(camera.target.x).toBeCloseTo(10);
    expect(camera.target.z).toBeCloseTo(-4);
    expect(camera.target.y).toBeCloseTo(3.5);
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(true);
  });

  it('focusOn an anchor flies to its item; an unknown id changes nothing', () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    expect(engine.focusOn(anchorId('obj_desk', 'workstation'), { animate: false })).toBe(true);
    expect(camera.target.x).toBeCloseTo(1, 0);
    expect(camera.target.z).toBeCloseTo(1, 0);
    expect(engine.focusOn('nothing', { animate: false })).toBe(false);
    expect(camera.target.x).toBeCloseTo(1, 0);
  });

  it('with animation the camera gets there over the next frames', async () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    engine.focusOn('room_a');
    await new Promise((r) => setTimeout(r, 350));
    engine.scene.render();
    expect(camera.target.x).toBeCloseTo(0);
    expect(camera.target.z).toBeCloseTo(0);
  });
});

describe('highlight and clearHighlights', () => {
  const outlined = (engine: Engine, roomId: string) => engine.rooms.getRoomMesh(roomId)!.getChildMeshes(false)
    .filter((m) => ['wall', 'floor'].includes(m.metadata?.part))
    .map((m) => m.renderOutline);

  it("outlines a room's walls and floor in the colour, also after it is rebuilt; clear takes it away", () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    engine.highlight(['room_a'], '#ff0000');
    expect(outlined(engine, 'room_a').every(Boolean)).toBe(true);
    expect(outlined(engine, 'room_b').some(Boolean)).toBe(false);
    const wall = engine.rooms.getRoomMesh('room_a')!.getChildMeshes(false).find((m) => m.metadata?.part === 'wall')!;
    expect(wall.outlineColor.toHexString()).toBe('#FF0000');

    engine.getStore().getState().updateRoom('room_a', { width: 7 });
    expect(outlined(engine, 'room_a').every(Boolean)).toBe(true);

    engine.clearHighlights();
    expect(outlined(engine, 'room_a').some(Boolean)).toBe(false);
    expect(engine.highlights.ids()).toEqual([]);
  });

  it('a wall shared with a neighbour is outlined whichever of the two rooms builds it', () => {
    for (const [west, east] of [['room_w', 'room_x'], ['room_x', 'room_w']]) {
      const engine = makeEngine();
      const layout = save();
      layout.rooms = [
        { ...layout.rooms[0], id: west, x: 0, doors: [], windows: [] },
        { ...layout.rooms[0], id: east, x: 6.15, doors: [], windows: [] },
      ];
      engine.loadLayout(layout);
      engine.highlight([east]);
      const shared = [...engine.rooms.meshes.values()].flatMap((n) => n.getChildMeshes(false))
        .filter((m) => m.metadata?.sharedWall);
      expect(shared.length).toBeGreaterThan(0);
      expect(shared.every((m) => m.renderOutline)).toBe(true);
    }
  });

  it("an anchor's id highlights its item (own look while outlined), and clear gives the look back", () => {
    const engine = makeEngine();
    engine.loadLayout(save());
    engine.highlight([anchorId('obj_desk', 'workstation')]);
    const desk = engine.objects.getObjectMesh('obj_desk')!;
    expect(desk.metadata.looks.has('highlight')).toBe(true);
    expect(engine.highlights.ids()).toEqual(['obj_desk']);
    engine.clearHighlights();
    expect(desk.metadata.looks.has('highlight')).toBe(false);
  });
});

/**
 * Every editor command, with arguments that change the layout in edit mode.
 * A command added to editorHistory later must be added here (the first test checks).
 */
const EDITS: Record<string, unknown[]> = {
  addObject: [{ assetType: 'DESK_STANDARD', x: 3, z: 3 }],
  updateObject: ['obj_desk', { x: 2 }],
  deleteObject: ['obj_desk'],
  duplicateObject: ['obj_desk'],
  toggleLock: ['obj_desk'],
  addRoom: [{ type: 'OFFICE', x: 20, z: 0, width: 4, depth: 4 }],
  deleteRoom: ['room_b'],
  updateRoom: ['room_a', { name: 'Renamed' }],
  setWallHeight: ['room_a', 3.0],
  setFloorHeight: [0, 4.0],
  toggleDoor: ['room_a', 'west'],
  addOpenings: [[{ roomId: 'room_a', kind: 'window', wall: 'east', offset: 0, width: 1, height: 1, sill: 1 }]],
  removeOpenings: [[{ roomId: 'room_a', kind: 'door', index: 0 }]],
  resizeOpening: [[{ roomId: 'room_a', kind: 'door', index: 0, patch: { width: 1.0 } }]],
  setAnchorData: [anchorId('obj_desk', 'workstation'), { positionRef: 'P-9' }],
  addFloor: [{ copyRooms: true }],
  removeFloor: [1],
  renameFloor: [1, 'Top'],
  undo: [],
  redo: [],
};
const HARMLESS = ['clear', 'endBurst']; // change nothing: allowed in every mode

describe('modes: only edit mode can change the layout (H3)', () => {
  it('the list above has every editor command', () => {
    const engine = makeEngine();
    const commands = Object.entries(engine.editor).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    expect(commands.filter((k) => !HARMLESS.includes(k)).sort()).toEqual(Object.keys(EDITS).sort());
  });

  it('in edit mode each command changes the layout', () => {
    for (const [name, args] of Object.entries(EDITS)) {
      if (name === 'undo' || name === 'redo') continue;
      const engine = makeEngine({ mode: 'edit' });
      engine.loadLayout(save());
      const before = JSON.stringify(engine.getLayout());
      (engine.editor as any)[name](...args);
      expect(JSON.stringify(engine.getLayout()), name).not.toBe(before);
    }
  });

  it('edit mode: undo and redo work, and every edit is a change event', () => {
    const engine = makeEngine({ mode: 'edit' });
    engine.loadLayout(save());
    const changes: string[] = [];
    engine.on('change', (e) => changes.push(e.type));
    engine.editor.updateRoom('room_a', { name: 'Renamed' });
    expect(changes).toContain('edit');
    expect(engine.undo()).toBe(true);
    expect(engine.getLayout()!.rooms.find((r) => r.id === 'room_a')!.name).toBe('Office 1');
    expect(engine.redo()).toBe(true);
    expect(engine.getLayout()!.rooms.find((r) => r.id === 'room_a')!.name).toBe('Renamed');
  });

  for (const mode of ['view', 'walkthrough'] as const) {
    it(`${mode} mode refuses every edit command: nothing changes, no change event`, () => {
      const engine = makeEngine({ mode: 'edit' });
      engine.loadLayout(save());
      engine.editor.updateRoom('room_a', { name: 'Edited first' }); // something to undo
      engine.editor.undo();                                           // and to redo
      engine.setMode(mode);
      expect(engine.canEdit).toBe(false);
      const before = engine.getLayout();
      const changes: unknown[] = [];
      engine.on('change', (e) => changes.push(e));

      for (const [name, args] of Object.entries(EDITS)) {
        expect((engine.editor as any)[name](...args), name).toEqual({ problem: READ_ONLY });
      }
      expect(engine.undo()).toBe(false);
      expect(engine.redo()).toBe(false);
      expect(engine.executeCommand({ label: 'x', execute: () => engine.getStore().getState().removeRoom('room_a'), undo: () => {} })).toBe(false);
      expect(engine.getLayout()).toEqual(before);
      expect(changes).toEqual([]);

      // back in edit mode the same commands work again
      engine.setMode('edit');
      engine.editor.updateRoom('room_a', { name: 'Allowed' });
      expect(engine.getLayout()!.rooms.find((r) => r.id === 'room_a')!.name).toBe('Allowed');
    });
  }
});

describe('walkthrough mode', () => {
  beforeEach(() => { controllers.length = 0; });

  it("walks with Preview's controller, read-only and with every action refused", () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    const [c] = controllers;
    expect(c.options.readOnly).toBe(true);
    expect(c.active).toBe(true);
    expect(c.options.actions.addObject({ assetType: 'DESK_STANDARD' })).toEqual({ problem: expect.any(String) });
    expect(c.options.actions.deleteRoom('room_a')).toEqual({ problem: expect.any(String) });
    // it walks through this engine's layout, and starts at its spawn point
    engine.loadLayout(save());
    expect(c.options.getState().rooms.map((r: any) => r.id).sort()).toEqual(['room_a', 'room_b']);
    expect(c.respawn).toHaveBeenCalled();
  });

  it('walking into and out of rooms fires enterRoom / exitRoom', () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    const events: [string, unknown][] = [];
    engine.on('enterRoom', (e) => events.push(['enter', e]));
    engine.on('exitRoom', (e) => events.push(['exit', e]));
    const { rooms } = engine.getStore().getState();
    controllers[0].options.onRoomChange(null, rooms.room_a);
    controllers[0].options.onRoomChange(rooms.room_a, null);
    expect(events).toEqual([
      ['enter', { roomId: 'room_a', floorId: 0, roomName: 'Office 1', roomType: 'OFFICE', fromRoomId: null }],
      ['exit', { roomId: 'room_a', floorId: 0, toRoomId: null }],
    ]);
  });

  it("E on an item fires interact with the item's main anchor and its room", () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    const events: unknown[] = [];
    engine.on('interact', (e) => events.push(e));
    controllers[0].options.onInteract({ objectId: 'obj_desk', point: { x: 1, y: 0.7, z: 1 }, distance: 1 });
    controllers[0].options.onInteract({ roomId: 'room_a', part: 'door', point: { x: 0, y: 1, z: -2 }, distance: 1 });
    expect(events).toEqual([
      { anchorId: anchorId('obj_desk', 'workstation'), objectId: 'obj_desk', position: { x: 1, y: 0.7, z: 1 }, roomId: 'room_a', part: null, distance: 1 },
      { anchorId: null, objectId: null, position: { x: 0, y: 1, z: -2 }, roomId: 'room_a', part: 'door', distance: 1 },
    ]);
  });

  it('inside a room the ceilings show; another mode gives the orbit camera back', () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    controllers[0].options.onViewChange({ inside: true, level: 0 });
    expect(engine.floors.getView().mode).toBe('inside');
    engine.setMode('view');
    expect(controllers[0].deactivate).toHaveBeenCalled();
    expect(engine.floors.getView().mode).toBe('outside');
    expect(controllers).toHaveLength(1); // made once, reused
    engine.setMode('walkthrough');
    expect(controllers[0].active).toBe(true);
  });

  it('the 2D view goes back to 3D for walking', () => {
    const engine = makeEngine({ mode: 'view' });
    engine.loadLayout(save());
    engine.setView('2d');
    engine.setMode('walkthrough');
    expect(engine.view).toBe('3d');
  });
});

describe('a real engine connected to layoutBridge', () => {
  beforeEach(() => { controllers.length = 0; layoutBridge._resetForTests(); });

  it('modules read its layout; in walkthrough the bridge cannot change it, in edit mode it can (undoably)', () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    const disconnect = connectEngine(engine);
    const ws = layoutBridge.getAnchors({ kind: 'workstation' })[0];
    expect(ws.objectId).toBe('obj_desk');
    expect(layoutBridge.setPositionRef(ws.id, 'pos-1')).toBe(false);
    expect(engine.getAnchors({ kind: 'workstation' })[0].positionRef).toBeUndefined();

    engine.setMode('edit');
    expect(layoutBridge.setPositionRef(ws.id, 'pos-1')).toBe(true);
    expect(engine.getAnchors({ kind: 'workstation' })[0].positionRef).toBe('pos-1');
    engine.undo();
    expect(engine.getAnchors({ kind: 'workstation' })[0].positionRef).toBeUndefined();
    disconnect();
  });

  it('walking into a room reaches the modules', () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    connectEngine(engine);
    const got: string[] = [];
    layoutBridge.on('enterRoom', (e: any) => got.push(e.room.name));
    controllers[0].options.onRoomChange(null, engine.getStore().getState().rooms.room_a);
    expect(got).toEqual(['Office 1']);
  });
});
