// v0.18.1: glass walls. A new Meeting room starts solid and its FIRST door makes that wall glass, in the same undo
// step (A2); a choice made by hand wins; later doors, Cabins and Meeting rooms from before v0.18.1 are left alone;
// turning the room turns its glass walls. Plan view marks them; clicks in the viewer go through glass.
import { describe, it, expect, beforeEach } from 'vitest';
import { createEditorHistory } from '../../store/editorHistory';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isGlassWall, planOpening, planRoomTurn } from '../geometry';
import { roomWallPieces } from '../../floorplan/planMath';
import { hitIsGlass } from '../../utils/pickHelpers';
import { normaliseLayout, fileLayout } from '../../store/layoutData';

const st = () => useWorkspaceStore.getState();
let editor;
beforeEach(() => {
  useWorkspaceStore.setState({ rooms: {}, objects: {}, selectedRoomId: null, currentFloor: 0,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } } });
  editor = createEditorHistory();
});

const draw = (type, x = 0, extra = {}) => {
  editor.addRoom({ type, name: `${type} ${x}`, floor: 0, x, z: 0, width: 6, depth: 5, wallHeight: 3.2, ...extra });
  return st().selectedRoomId;
};
const addDoor = (id, wall, point) => {
  const rooms = Object.values(st().rooms);
  const plan = planOpening(rooms, st().rooms[id], wall, point, 'door');
  expect(plan.problem).toBeNull();
  editor.addOpenings(plan.list);
};

describe('a new Meeting room: its first door makes that wall glass (A2)', () => {
  it('starts solid, remembers the rule (saved too), the first door = glass in ONE undo step, redo too', () => {
    const id = draw('MEETING');
    expect(st().rooms[id].glassWalls).toBeUndefined();
    expect(st().rooms[id].glassOnFirstDoor).toBe(true);
    // saved before the door: the rule survives a reload
    const file = fileLayout({ rooms: Object.values(st().rooms), objects: [], floors: [] });
    const saved = normaliseLayout(JSON.parse(JSON.stringify(file)));
    expect(saved.rooms[0].glassOnFirstDoor).toBe(true);

    addDoor(id, 'south', { x: 0, z: -2.5 });
    expect(st().rooms[id].glassWalls).toEqual(['south']);
    expect(st().rooms[id].glassOnFirstDoor).toBeUndefined();
    editor.undo();
    expect(st().rooms[id].doors).toHaveLength(0);
    expect(st().rooms[id].glassWalls).toBeUndefined();
    expect(st().rooms[id].glassOnFirstDoor).toBe(true);
    editor.redo();
    expect(st().rooms[id].glassWalls).toEqual(['south']);
    expect(st().rooms[id].doors).toHaveLength(1);
  });

  it('a later door leaves the walls alone', () => {
    const id = draw('MEETING');
    addDoor(id, 'south', { x: 0, z: -2.5 });
    addDoor(id, 'north', { x: 0, z: 2.5 });
    expect(st().rooms[id].glassWalls).toEqual(['south']);
  });

  it('a choice made by hand wins: the rule is gone', () => {
    const id = draw('MEETING');
    editor.updateRoom(id, { glassWalls: ['east'], glassOnFirstDoor: undefined });
    addDoor(id, 'south', { x: 0, z: -2.5 });
    expect(st().rooms[id].glassWalls).toEqual(['east']);
    const solid = draw('MEETING', 20);
    editor.updateRoom(solid, { glassWalls: [], glassOnFirstDoor: undefined });
    addDoor(solid, 'south', { x: 20, z: -2.5 });
    expect(st().rooms[solid].glassWalls).toEqual([]);
  });

  it('Cabins, Offices and Meeting rooms from older layouts stay solid', () => {
    const cabin = draw('CABIN');
    addDoor(cabin, 'south', { x: 0, z: -2.5 });
    expect(st().rooms[cabin].glassWalls).toBeUndefined();
    useWorkspaceStore.setState({ rooms: { old: { id: 'old', type: 'MEETING', name: 'Old', floor: 0, x: 40, z: 0, width: 6,
      depth: 5, wallHeight: 3.2, doors: [], windows: [] } } });
    addDoor('old', 'south', { x: 40, z: -2.5 });
    expect(st().rooms.old.glassWalls).toBeUndefined();
  });

  it("a door between a new Meeting room and its neighbour: the meeting room's side turns glass", () => {
    const office = draw('OFFICE');
    const meet = draw('MEETING', 6.15);
    addDoor(office, 'east', { x: 3, z: 0 });
    expect(st().rooms[meet].glassWalls).toEqual(['west']);
    expect(st().rooms[office].glassWalls).toBeUndefined();
  });

  it('turning the room keeps the rule and turns its glass walls', () => {
    const id = draw('MEETING');
    const turn = (rid) => {
      const plan = planRoomTurn(st().rooms[rid], Object.values(st().rooms), []);
      expect(plan.problem).toBeNull();
      editor.turnRoom(rid, plan);
    };
    turn(id);
    expect(st().rooms[id].glassOnFirstDoor).toBe(true);
    const other = draw('OFFICE', 30, { glassWalls: ['south', 'west'] });
    turn(other);
    expect(st().rooms[other].glassWalls).toEqual(['north', 'west']); // south → west, west → north
  });
});

describe('where glass shows', () => {
  it("isGlassWall: its own list, or the neighbour's side of a shared wall", () => {
    const a = { id: 'a', glassWalls: ['north'] };
    const b = { id: 'b', glassWalls: ['west'] };
    expect(isGlassWall(a, 'north', { shared: false })).toBe(true);
    expect(isGlassWall(a, 'east', { shared: true, partnerRoom: b, partnerWall: 'west' })).toBe(true);
    expect(isGlassWall(a, 'south', { shared: false })).toBe(false);
  });

  it('Plan view: the wall pieces of a glass wall are marked', () => {
    const room = { id: 'r', x: 0, z: 0, width: 6, depth: 4, glassWalls: ['north'],
      doors: [{ wall: 'north', offset: 0, width: 1, height: 2.1 }], windows: [] };
    const walls = roomWallPieces(room).walls;
    expect(walls.filter((w) => w.glass).map((w) => w.wall)).toEqual(['north', 'north']);
    expect(walls.filter((w) => !w.glass)).toHaveLength(3);
  });

  it('a pick on a glass sub-mesh is glass, a frame is not', () => {
    const glass = { metadata: { glass: true } };
    const frame = { metadata: {} };
    const mesh = { material: { subMaterials: [frame, glass] }, subMeshes: [{ materialIndex: 0 }, { materialIndex: 1 }] };
    expect(hitIsGlass({ pickedMesh: mesh, subMeshId: 1 })).toBe(true);
    expect(hitIsGlass({ pickedMesh: mesh, subMeshId: 0 })).toBe(false);
    expect(hitIsGlass({ pickedMesh: { material: glass } })).toBe(true);
    expect(hitIsGlass(null)).toBe(false);
  });
});
