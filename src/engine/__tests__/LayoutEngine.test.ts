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
  TILE_SIZE: { wood: 1, carpet: 1, tile: 1, smallTile: 1, concrete: 1, raised: 1, plaster: 2, ceiling: 1.2 },
  FLOOR_BY_ROOM_TYPE: {},
  floorKindOf: () => 'wood',
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'structure', 'skirting', 'doorFrame', 'windowFrame',
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
// where a new walkthrough's character stands (tests of routes set it before walking starts)
const walkerStart = vi.hoisted(() => ({ x: 1, y: 0, z: 2, floor: 0 }));
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
      pos: { ...walkerStart },
      getLevel: () => c.pos.floor ?? 0,
      getYaw: () => 0.5,
      getPosition: () => ({ x: c.pos.x, y: c.pos.y, z: c.pos.z }),
      setAutopilot: vi.fn((p: any) => { c.pilot = p; }),
      stepFloor: vi.fn(),
      setCharacter: vi.fn((ch: any, opts: any) => { c.character = ch; c.eyeHeight = opts?.eyeHeight; }),
      getCharacter: () => c.character ?? null,
      dispose: vi.fn(),
    };
    controllers.push(c);
    return c;
  }),
}));

// The player's character: systems/PlayerCharacter is tested with real files in PlayerCharacter.test.ts
const made = vi.hoisted(() => [] as any[]);
vi.mock('../systems/PlayerCharacter', () => ({
  createPlayerCharacter: vi.fn(async (_scene: unknown, spec: any) => {
    if (spec.character.url.includes('broken')) throw new Error('404');
    const c = { spec, eyeHeight: 1.5, kind: 'full', root: {}, dispose: vi.fn() };
    made.push(c);
    return c;
  }),
}));

const { LayoutEngine, READ_ONLY } = await import('../LayoutEngine');
const { CANT_GET_PAST } = await import('../systems/NavigationSystem');
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

/**
 * An engine on a NullEngine scene (no canvas, no GPU). It builds a layout at
 * once (buildBudgetMs: Infinity) unless a test asks for slices.
 */
function makeEngine(options = {}) {
  options = { buildBudgetMs: Infinity, ...options };
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

  it('shows the ground floor from above at first (no roof, nothing above); setFloor shows the floors up to that one', () => {
    const engine = makeEngine({ mode: 'view' });
    engine.loadLayout(save());
    expect(engine.floors.getView()).toEqual({ mode: 'planner', level: 0 });
    expect(enabled(engine.rooms.getRoomMesh('room_a'))).toBe(true);
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(false);
    engine.setFloor(1);
    expect(engine.floors.getView()).toEqual({ mode: 'planner', level: 1 });
    // a new layout starts on its ground floor again
    engine.loadLayout(save());
    expect(engine.floors.getView()).toEqual({ mode: 'planner', level: 0 });
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

  it('builds in slices: progress events, whenBuilt() and finishBuild()', async () => {
    const engine = makeEngine({ buildBudgetMs: 0 }); // one room or item per slice
    const progress: { done: number; total: number; currentFloorReady: boolean; allBuilt: boolean }[] = [];
    engine.on('progress', (p) => progress.push(p));
    let built = false;
    engine.loadLayout(save());
    const done = engine.whenBuilt().then(() => { built = true; });
    expect(engine.buildProgress.allBuilt).toBe(false);
    expect(engine.rooms.meshes.size + engine.objects.meshes.size).toBeLessThan(5);
    await Promise.resolve();
    expect(built).toBe(false);
    engine.finishBuild();
    await done;
    expect(engine.rooms.meshes.size + engine.objects.meshes.size).toBe(5);
    expect(engine.buildProgress).toMatchObject({ done: 5, total: 5, currentFloorReady: true, allBuilt: true });
    expect(progress.at(-1)).toMatchObject({ allBuilt: true });
    expect(progress.some((p) => !p.allBuilt)).toBe(true);
  });

  it('dispose() during a build stops it without errors', () => {
    const engine = makeEngine({ buildBudgetMs: 0 });
    engine.loadLayout(save());
    expect(() => { engines.pop()!.dispose(); }).not.toThrow();
    expect(engine.buildProgress.allBuilt).toBe(false);
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

  it('fitView centres the camera on the whole building', () => {
    const engine = makeEngine();
    const layout = save();
    layout.rooms[1] = { ...layout.rooms[1], x: 20 }; // upper floor room further east
    engine.loadLayout(layout);
    engine.fitView({ animate: false });
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    expect(camera.target.x).toBeCloseTo(10); // rooms span -3 … 23
    expect(camera.target.z).toBeCloseTo(0);
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
  applyProposedLayout: [{
    schemaVersion: 2,
    units: 'meters',
    building: { name: 'HQ' },
    floors: [{ id: '0', name: 'Ground Floor', height: 3.5 }],
    rooms: [{ id: 'room_prop', floorId: '0', name: 'Proposed Room', type: 'OFFICE', x: 25, z: 25, width: 4, depth: 4, wallHeight: 3 }],
    openings: [],
    objects: [],
    anchors: [],
    routes: [],
    floorLinks: [],
  }],
  restoreVersion: [{
    floors: { '0': { id: 0, name: 'Ground Floor', height: 3.5 } },
    rooms: [{ id: 'room_restored', name: 'Restored Room', x: 50, z: 50, width: 5, depth: 5, floor: 0, doors: [], windows: [] }],
    objects: [],
  }],
  undo: [],
  redo: [],
};
const HARMLESS = ['clear', 'endBurst']; // change nothing: allowed in every mode

describe('navigation: search and show places (v0.13.3)', () => {
  const people = [{ personId: 'p1', deskId: 'obj_desk', name: 'Asha Patel', department: 'Engineering', email: 'asha@example.com' }];

  it('find: people (name and department only, also with quality low), rooms, facilities; the people can change', () => {
    const engine = makeEngine({ mode: 'view', quality: 'low' });
    engine.loadLayout(save());
    engine.setPeople(people as any);
    const [asha] = engine.navigation.find('asha');
    expect(asha).toEqual({
      id: 'person:p1', kind: 'person', group: 'people', name: 'Asha Patel', detail: 'Engineering · Ground Floor, Office 1',
      floorId: 0, floorName: 'Ground Floor', roomId: 'room_a', roomName: 'Office 1', department: 'Engineering',
      facility: null, personId: 'p1', deskId: 'obj_desk', entityId: 'obj_desk',
    });
    expect(engine.navigation.find('meeting').map((p) => `${p.group}:${p.name}:${p.floorName}`)).toEqual(['facilities:Meeting 1:Floor 1']);
    expect(engine.navigation.find('office').map((p) => p.name)).toEqual(['Office 1']);
    expect(engine.navigation.find('stairs').map((p) => p.id)).toEqual(['item:obj_stairs']);
    engine.setPeople([]);
    expect(engine.navigation.find('asha')).toEqual([]);
  });

  it('show from above: its floor, the camera on it (looking down), outlined; clear takes the outline away', () => {
    const engine = makeEngine({ mode: 'view', quality: 'low' });
    engine.loadLayout(save());
    engine.setPeople(people as any);
    const camera = engine.scene.activeCamera as ArcRotateCamera;
    camera.beta = 1.2;
    const shown = engine.navigation.show('room:room_b', { animate: false });
    expect(shown?.place.name).toBe('Meeting 1');
    expect(shown?.route).toBeUndefined();
    expect(engine.getStore().getState().currentFloor).toBe(1);
    expect(engine.highlights.ids()).toEqual(['room_b']);
    expect(camera.target.y).toBeCloseTo(3.5);
    expect(camera.beta).toBeLessThanOrEqual(0.75 + 1e-6);

    engine.navigation.show('person:p1', { animate: false });
    expect(engine.getStore().getState().currentFloor).toBe(0);
    expect(engine.highlights.ids()).toEqual(['obj_desk']);
    expect(camera.target.x).toBeCloseTo(1, 0);
    expect(camera.target.z).toBeCloseTo(1, 0);
    expect(engine.navigation.current).toBe('person:p1');

    expect(engine.navigation.show('person:nobody')).toBeNull();
    engine.navigation.clear();
    expect(engine.highlights.ids()).toEqual([]);
    expect(engine.navigation.current).toBeNull();
  });

  it('show while walking: outlined and the walk there measured; the camera is left alone', () => {
    controllers.length = 0;
    const engine = makeEngine({ mode: 'walkthrough', quality: 'low' });
    engine.loadLayout(save());
    const camera = engine.scene.activeCamera;
    const shown = engine.navigation.show('room:room_a', { animate: false });
    expect(engine.highlights.ids()).toEqual(['room_a']);
    expect(shown?.route?.length ?? shown?.message).toBeTruthy();
    expect(engine.scene.activeCamera).toBe(camera);
    // walking, "washroom"-like words offer the nearest one first (here: the only meeting room)
    expect(engine.navigation.find('meeting')[0]).toMatchObject({ kind: 'nearest', name: 'Nearest meeting room', places: ['room:room_b'] });
  });
});

describe('navigation: going there (v0.13.4)', () => {
  const people = [{ personId: 'p1', deskId: 'obj_desk', name: 'Asha Patel', department: 'Engineering' }];
  const outside = { x: -1.5, y: 0, z: -5, floor: 0 }; // in front of Office 1's door (south wall)

  function walking(options: Record<string, unknown> = { mode: 'view' }) {
    controllers.length = 0;
    Object.assign(walkerStart, outside);
    const engine = makeEngine({ quality: 'low', ...options });
    engine.loadLayout(save());
    engine.setPeople(people as any);
    const events: any[] = [];
    engine.on('navigation', (e) => events.push(e));
    const modes: string[] = [];
    engine.on('mode', (e) => modes.push(e.mode));
    return { engine, events, modes, controller: () => controllers[controllers.length - 1] };
  }
  const frame = (c: any, more: Record<string, unknown> = {}) => ({ ...c.pos, yaw: c.yaw ?? 0, userMoving: false, flying: false, ...more });
  /** Walk as the controller would: the pilot's direction and speed, dt at a time (no collisions here). */
  function follow(c: any, frames = 400, dt = 1 / 20) {
    let last = null;
    for (let i = 0; i < frames && c.pilot; i++) {
      const d = c.pilot.drive(dt, frame(c));
      last = d;
      if (!d) continue;
      if (d.yaw !== undefined) c.yaw = d.yaw;
      c.pos.x += d.dirX * d.speed * dt;
      c.pos.z += d.dirZ * d.speed * dt;
    }
    return last;
  }
  const states = (events: any[]) => events.map((e) => e.state).filter((st, i, a) => st !== a[i - 1]);

  it('from above, Show route starts walking at the entrance and draws the line; walking there yourself arrives', () => {
    const { engine, events, modes, controller } = walking();
    const answer = engine.navigation.routeTo('person:p1', { walk: 'guide' });
    expect(answer).toMatchObject({ walk: 'guide', place: { name: 'Asha Patel' } });
    expect(answer.length).toBeGreaterThan(2);
    expect(modes).toEqual(['walkthrough']);
    expect(engine.mode).toBe('walkthrough');
    const c = controller();
    expect(c.pilot).toBeTruthy();
    expect(events[0]).toMatchObject({ state: 'started', walk: 'guide', remaining: answer.length });
    expect((engine as any)._routeLine.counts.markers).toBe(1);
    expect((engine as any)._routeLine.counts.chevrons).toBeGreaterThan(0);
    expect(engine.highlights.ids()).toEqual(['obj_desk']);
    // Show route: you walk (the pilot moves nothing)
    expect(c.pilot.drive(0.1, frame(c))).toBeNull();
    expect(engine.navigation.walking!.walk).toBe('guide');
    // there: where the route ends (beside the desk)
    const points = (engine.navigation as any).active.follower.path.points;
    const end = points[points.length - 1];
    Object.assign(c.pos, { x: end.x + 0.3, z: end.z });
    for (let i = 0; i < 3 && c.pilot; i++) c.pilot.drive(0.1, frame(c));
    expect(states(events)).toEqual(['started', 'arrived']);
    expect(c.setAutopilot).toHaveBeenLastCalledWith(null);
    expect((engine as any)._routeLine.counts).toEqual({ chevrons: 0, markers: 0 });
    expect(engine.highlights.ids()).toEqual(['obj_desk']); // still outlined
  });

  it('Take me there walks it, arrives within 1 m, turns to face them and stops', () => {
    const { engine, events, controller } = walking({ mode: 'walkthrough' });
    const answer = engine.navigation.routeTo({ deskId: 'obj_desk' }, { walk: 'auto' });
    expect(answer.walk).toBe('auto');
    const c = controller();
    expect(c.pilot.drive(0.05, frame(c)).speed).toBeGreaterThan(0);
    const last = follow(c);
    expect(c.pilot ?? null).toBeNull();
    expect(events[0].state).toBe('started');
    expect(events[events.length - 1]).toMatchObject({ state: 'arrived', remaining: 0, place: { name: 'Asha Patel' } });
    expect(last).toMatchObject({ speed: 0, pitch: expect.any(Number) });
    expect(Math.hypot(c.pos.x - 1, c.pos.z - 1)).toBeLessThan(2);
    expect(engine.navigation.walking).toBeNull();
  });

  it('a movement key pauses it (Press G to continue), G goes on, Esc ends it', () => {
    const { engine, events, controller } = walking({ mode: 'walkthrough' });
    engine.navigation.routeTo('room:room_a', { walk: 'auto' });
    const c = controller();
    expect(c.pilot.drive(0.05, frame(c, { userMoving: true }))).toBeNull();
    expect(events[events.length - 1]).toMatchObject({ state: 'progress', paused: true });
    expect(engine.navigation.walking!.paused).toBe(true);
    expect(c.pilot.drive(0.05, frame(c))).toBeNull(); // still paused
    expect(c.pilot.key('KeyG')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ state: 'progress', paused: false });
    expect(c.pilot.drive(0.05, frame(c)).speed).toBeGreaterThan(0);
    c.pilot.key('Escape');
    expect(events[events.length - 1]).toMatchObject({ state: 'stopped' });
    expect(c.pilot).toBeNull();
    expect(engine.highlights.ids()).toEqual([]);
    expect(engine.navigation.stop()).toBe(false); // nothing to stop: free walking
  });

  it('stuck (no progress in 1.5 s): a new route; stuck twice: the walk stops', () => {
    const { engine, events, controller } = walking({ mode: 'walkthrough' });
    engine.navigation.routeTo('room:room_a', { walk: 'auto' });
    const c = controller();
    for (let i = 0; i < 60 && c.pilot; i++) c.pilot.drive(0.1, frame(c));
    expect(events.some((e) => e.state === 'progress' && e.rerouted)).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ state: 'failed', problem: 'STUCK', message: CANT_GET_PAST });
    expect(c.pilot).toBeNull();
  });

  it('nothing to go to, or no way there: a clear answer; leaving the walk stops the route', () => {
    const { engine, events, controller } = walking({ mode: 'walkthrough' });
    expect(engine.navigation.routeTo('person:nobody')).toMatchObject({ problem: 'NOT_FOUND' });
    const noDoor = engine.navigation.routeTo('room:room_b', { walk: 'auto' });
    expect(noDoor.problem).toBeTruthy();
    expect(events[events.length - 1]).toMatchObject({ state: 'failed', message: noDoor.message });
    // a kind of place, and a spot
    expect(engine.navigation.routeTo({ type: 'STAIRS' })).toMatchObject({ walk: 'guide', place: { id: 'item:obj_stairs' } });
    expect(engine.navigation.routeTo({ x: 0, z: -1, floor: 0 })).toMatchObject({ place: { name: 'Office 1' } });
    engine.setMode('view');
    expect(events[events.length - 1]).toMatchObject({ state: 'stopped' });
    expect(controller().pilot).toBeNull();
  });

  it('the walk maps are one cache, shared with walking, built in idle time after a layout loads', async () => {
    const { engine, controller } = walking({ mode: 'walkthrough' });
    expect(controller().options.walkMaps).toBe(engine.navigation.walkMaps);
    await engine.whenNavigationReady();
    const s = engine.getStore().getState();
    const t0 = performance.now();
    engine.navigation.walkMaps.get(s, 0);
    engine.navigation.walkMaps.get(s, 1);
    expect(performance.now() - t0).toBeLessThan(5); // already built
  });
});

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

  it("the keys are the page's until the view is engaged (Preview passes no isEngaged; no page here: never)", () => {
    makeEngine({ mode: 'walkthrough' });
    const [c] = controllers;
    expect(c.options.isEngaged).toEqual(expect.any(Function));
    expect(c.options.isEngaged()).toBe(false);
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
    expect(engine.floors.getView()).toEqual({ mode: 'planner', level: 0 });
    expect(controllers).toHaveLength(1); // made once, reused
    engine.setMode('walkthrough');
    expect(controllers[0].active).toBe(true);
  });

  it('the spawn point (a Studio marker) is hidden in view and walkthrough mode, shown in edit mode', () => {
    const withSpawn = () => {
      const layout = save();
      layout.objects.push({ id: 'obj_spawn', assetType: 'SPAWN_POINT', name: 'SPAWN_POINT 1', floor: 0, roomId: '',
        x: 0, y: 0, z: -6, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, label: '' });
      return layout;
    };
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(withSpawn());
    const spawn = () => engine.objects.getObjectMesh('obj_spawn');
    expect(spawn()).not.toBeNull(); // built (anchors, focusOn), just not shown
    expect(enabled(spawn())).toBe(false);
    expect(enabled(engine.objects.getObjectMesh('obj_desk'))).toBe(true);
    controllers[0].options.onViewChange({ inside: true, level: 0 }); // walking's own views keep it hidden
    expect(enabled(spawn())).toBe(false);
    engine.setMode('view');
    expect(enabled(spawn())).toBe(false);
    engine.setFloor(1);
    expect(enabled(spawn())).toBe(false);
    engine.setMode('edit');
    expect(enabled(spawn())).toBe(true);
    const view = makeEngine({ mode: 'view' });
    view.loadLayout(withSpawn());
    expect(enabled(view.objects.getObjectMesh('obj_spawn'))).toBe(false);
  });

  it('back from walking: the floor you walked to, seen from above (its roof off)', () => {
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    controllers[0].options.onViewChange({ inside: false, level: 0 });
    controllers[0].options.onLevelChange(1); // walked up the stairs
    expect(engine.floors.getView().mode).toBe('outside'); // walking keeps its own view
    engine.setMode('view');
    expect(engine.floors.getView()).toEqual({ mode: 'planner', level: 1 });
    expect(enabled(engine.rooms.getRoomMesh('room_b'))).toBe(true);
  });

  it('setPlayer: walking through, you are your own character (made when walking starts); your desk figure hides', async () => {
    made.length = 0;
    const engine = makeEngine({ mode: 'view' });
    engine.loadLayout(save());
    const hidden = vi.spyOn(engine.characters!, 'setHiddenPerson');
    const me = { personId: 'u1', character: { url: 'https://x/aj.glb', rig: 'mixamo' as const, height: 1.8 }, walkClipUrl: 'https://x/walk.glb' };
    engine.setPlayer(me);
    await engine.whenPlayerReady();
    expect(made).toHaveLength(0); // nothing downloaded until walking
    engine.setMode('walkthrough');
    await engine.whenPlayerReady();
    expect(made).toHaveLength(1);
    expect(made[0].spec).toEqual({ character: me.character, walkClipUrl: 'https://x/walk.glb', walk: undefined });
    expect(controllers[0].setCharacter).toHaveBeenLastCalledWith(made[0], { eyeHeight: 1.5 });
    expect(hidden).toHaveBeenLastCalledWith('u1');
    // the same player again: nothing made again
    engine.setPlayer({ ...me });
    await engine.whenPlayerReady();
    expect(made).toHaveLength(1);
    engine.setMode('view');
    expect(hidden).toHaveBeenLastCalledWith(null);
    // no character (never chose one): the simple figure
    engine.setMode('walkthrough');
    engine.setPlayer({ personId: 'u1', character: null });
    await engine.whenPlayerReady();
    expect(controllers[0].setCharacter).toHaveBeenLastCalledWith(null, { eyeHeight: undefined });
  });

  it("setPlayer: a file that can't be loaded, or quality 'low' = the simple figure; a newer player wins", async () => {
    made.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = makeEngine({ mode: 'walkthrough' });
    engine.loadLayout(save());
    engine.setPlayer({ personId: 'u1', character: { url: 'https://x/broken.glb' } });
    await engine.whenPlayerReady();
    expect(controllers[0].setCharacter).toHaveBeenLastCalledWith(null, { eyeHeight: undefined });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the simple figure walks'), '404');
    // two quick changes: only the last one is used, the first is disposed
    engine.setPlayer({ personId: 'u1', character: { url: 'https://x/a.glb' } });
    const first = engine.whenPlayerReady();
    engine.setPlayer({ personId: 'u1', character: { url: 'https://x/b.glb' } });
    await first;
    await engine.whenPlayerReady();
    expect(made.map((m) => m.spec.character.url)).toEqual(['https://x/a.glb', 'https://x/b.glb']);
    expect(made[0].dispose).toHaveBeenCalled();
    expect(controllers[0].setCharacter).toHaveBeenLastCalledWith(made[1], { eyeHeight: 1.5 });
    warn.mockRestore();

    const low = makeEngine({ mode: 'walkthrough', quality: 'low' });
    low.loadLayout(save());
    low.setPlayer({ personId: 'u1', character: { url: 'https://x/aj.glb' } });
    await low.whenPlayerReady();
    expect(made).toHaveLength(2);
    expect(controllers[1].setCharacter).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'full' }), expect.anything());
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
