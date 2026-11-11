// @vitest-environment jsdom
// Walk through with the easy controls (v0.15.2): Studio's Preview uses look 'drag'. Everything is aimed
// at the MOUSE; an empty hand walks, an item in your hand is placed where the mouse points; G takes a
// desk with its chair and what stands on it. The REAL controller on the REAL room and item meshes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Collisions/collisionCoordinator';
import '@babylonjs/core/Culling/ray';

import { RoomSystem } from '../../engine/systems/RoomSystem';
import { ObjectSystem } from '../../engine/systems/ObjectSystem';
import { createPlayController } from '../playController';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { deskSeat } from '../people';

vi.mock('../../utils/materialLibrary', async (orig) => ({
  ...(await orig()),
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'structure', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
  getAssetMaterial: () => null,
}));

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const room = { id: 'r', type: 'OFFICE', name: 'Office', floor: 0, x: 0, z: 0, width: 10, depth: 10, wallHeight: 3.2, wallThickness: 0.15, doors: [], windows: [] };
const deskTop = ASSET_TYPES.DESK_STANDARD.defaultHeight;
// (every field the store gives an item: a missing scale makes its mesh's matrix NaN)
const item = (o) => ({ floor: 0, y: 0.02, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...o });
const items = () => [
  item({ id: 'desk', assetType: 'DESK_STANDARD', x: 0, z: 1.5 }),
  item({ id: 'chair', assetType: 'CHAIR_OFFICE', x: 0, z: 2.2, rotationY: Math.PI }),
  item({ id: 'mon', assetType: 'MONITOR_DUAL', x: 0.1, y: 0.02 + deskTop, z: 1.5 }),
];

let engine = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

function world({ look = 'drag' } = {}) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  engine.getDeltaTime = () => 16;
  const objects = items();
  const byId = Object.fromEntries(objects.map((o) => [o.id, o]));
  new RoomSystem(scene).sync({ rooms: { r: room }, objects: byId, floors });
  const objectSystem = new ObjectSystem(scene);
  objectSystem.sync({ objects: byId, floors });
  const actions = {
    addObject: vi.fn(), updateObject: vi.fn(), moveObjects: vi.fn(), deleteObject: vi.fn(), toggleLock: vi.fn(),
  };
  const calls = { click: vi.fn(), emptyHand: vi.fn(), hud: null };
  const canvas = document.createElement('canvas');
  const play = createPlayController(scene, canvas, {
    getState: () => ({ rooms: [room], objects, floors, currentFloor: 0 }),
    actions,
    getObjectMesh: (id) => objectSystem.getObjectMesh(id),
    look,
    onPointClick: calls.click,
    onEmptyHand: calls.emptyHand,
    onHud: (hud) => { calls.hud = hud; },
  });
  play.activate();
  // stand in the south of the room, looking north and a little down at the desk
  play.setPose({ x: 0, z: -3, yaw: 0, pitch: -0.35, floor: 0 });
  scene.render();
  scene.render();
  /** Where a world point is on the view (the pixels the mouse would be at). */
  const screenOf = (x, y, z) => {
    const cam = scene.activeCamera;
    const p = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(),
      cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return { x: p.x, y: p.y };
  };
  const pointAt = (x, y, z) => {
    const s = screenOf(x, y, z);
    play.setPointer(s.x, s.y);
    scene.render();
    return s;
  };
  const key = (code, more = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...more }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, ...more }));
  };
  return { scene, play, actions, calls, objects, objectSystem, screenOf, pointAt, key };
}

describe('Walk through, easy controls: the mouse aims (look "drag")', () => {
  it('starts without capturing the mouse, the keys live at once, the HUD says so', () => {
    const { calls, play, pointAt } = world();
    expect(play.isLocked()).toBe(false);
    expect(calls.hud).toMatchObject({ mouseAim: true, engaged: true, locked: false });
    // (before the mouse has moved, the middle of the view is the aim: here the chair)
    expect(play.aimsAtMouse()).toBe(false);
    pointAt(3, 0.02, -2);
    expect(play.aimsAtMouse()).toBe(true);
    expect(calls.hud.hint.title).toBe('Walking');
  });

  it('an empty hand: a click on the floor asks to walk there, and builds nothing', () => {
    const { play, actions, calls, pointAt } = world();
    const s = pointAt(2, 0.02, -1);
    play.clickAt(s.x, s.y, 0);
    expect(calls.click).toHaveBeenCalledTimes(1);
    const click = calls.click.mock.calls[0][0];
    expect(click.walkTo.x).toBeCloseTo(2, 1);
    expect(click.walkTo.z).toBeCloseTo(-1, 1);
    expect(click.walkTo.floor).toBe(0);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it('an empty hand: left-click walks up to a desk; right-click removes the aimed desk', () => {
    const { play, actions, calls, pointAt } = world();
    const s = pointAt(0, deskTop + 0.02, 1.4);
    expect(calls.hud.hint.title).toBe('Standard Desk');
    expect(play.getAim()).toBeNull();
    play.clickAt(s.x, s.y, 0);
    expect(calls.click).toHaveBeenCalledTimes(1);
    expect(calls.click.mock.calls[0][0].kind).toBe('item');
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    play.clickAt(s.x, s.y, 2);
    expect(actions.deleteObject).toHaveBeenCalledWith('desk');
  });

  it('an item in your hand: a click places it where the mouse points, not in the middle of the view', () => {
    const { play, actions, calls, pointAt, screenOf } = world();
    play.setTool({ kind: 'object', assetType: 'CHAIR_OFFICE', label: 'Office Chair' });
    const s = pointAt(-2.5, 0.02, 0);
    // the middle of the view looks somewhere else
    const middle = screenOf(0, 0.02, 0);
    expect(Math.abs(s.x - middle.x)).toBeGreaterThan(40);
    play.clickAt(s.x, s.y, 0);
    expect(actions.addObject).toHaveBeenCalledTimes(1);
    expect(actions.addObject.mock.calls[0][0]).toMatchObject({ assetType: 'CHAIR_OFFICE', x: -2.5, z: 0, floor: 0, roomId: 'r' });
    expect(calls.click).not.toHaveBeenCalled(); // never a walk with something in your hand
  });

  it('a click right after the mouse moved (no frame between) still places at the new spot', () => {
    const { play, actions, screenOf } = world();
    play.setTool({ kind: 'object', assetType: 'CHAIR_OFFICE', label: 'Office Chair' });
    const s = screenOf(2.5, 0.02, -1);
    play.clickAt(s.x, s.y, 0);
    expect(actions.addObject.mock.calls[0][0]).toMatchObject({ x: 2.5, z: -1 });
  });

  it('a floor-only item over the desk top: red, "Large Plant stands on the floor", the click places nothing', () => {
    const { play, actions, calls, pointAt } = world();
    play.setTool({ kind: 'object', assetType: 'PLANT_LARGE', label: 'Large Plant' });
    const s = pointAt(-0.5, deskTop + 0.02, 1.5);
    expect(calls.hud.hint).toMatchObject({ detail: 'Large Plant stands on the floor', bad: true });
    play.clickAt(s.x, s.y, 0);
    expect(actions.addObject).not.toHaveBeenCalled();
    // a Desk Plant may
    play.setTool({ kind: 'object', assetType: 'PLANT_SMALL', label: 'Desk Plant' });
    play.clickAt(s.x, s.y, 0);
    expect(actions.addObject).toHaveBeenCalledTimes(1);
    expect(actions.addObject.mock.calls[0][0].y).toBeCloseTo(0.02 + deskTop, 1);
  });

  it('Esc puts the item away (an empty hand); the number of the held slot is the caller\'s', () => {
    const { play, calls, key } = world();
    play.setTool({ kind: 'object', assetType: 'CHAIR_OFFICE', label: 'Office Chair' });
    key('Escape');
    expect(calls.emptyHand).toHaveBeenCalledTimes(1);
  });

  it('a dialog over the view (setKeysPaused): no key, no click reaches the walk', () => {
    const { play, actions, calls, pointAt, key } = world();
    play.setTool({ kind: 'object', assetType: 'CHAIR_OFFICE', label: 'Office Chair' });
    const s = pointAt(2, 0.02, -1);
    play.setKeysPaused(true);
    key('Escape');
    play.clickAt(s.x, s.y, 0);
    expect(calls.emptyHand).not.toHaveBeenCalled();
    expect(actions.addObject).not.toHaveBeenCalled();
    play.setKeysPaused(false);
    play.clickAt(s.x, s.y, 0);
    expect(actions.addObject).toHaveBeenCalledTimes(1);
  });
});

describe('Walk through: G takes a desk with its chair and what stands on it (v0.15.2)', () => {
  it('picked up at the mouse, put down with a click: ONE moveObjects for the desk, its monitor and its chair', () => {
    const { play, actions, objects, objectSystem, pointAt, key, calls } = world();
    pointAt(0, deskTop + 0.02, 1.4);
    key('KeyG');
    const s = pointAt(-2.5, 0.02, -0.5);
    expect(calls.hud.hint.title).toBe('Moving Standard Desk');
    expect(calls.hud.hint.detail).toBe('with its chair · with the item on it');
    // the chair and the monitor follow at once (meshes), before anything is saved
    const chairMesh = objectSystem.getObjectMesh('chair');
    const deskMesh = objectSystem.getObjectMesh('desk');
    expect(deskMesh.position.x).toBeCloseTo(-2.5);
    expect(chairMesh.position.x).toBeCloseTo(-2.5);
    expect(chairMesh.position.z - deskMesh.position.z).toBeCloseTo(0.7);
    expect(actions.moveObjects).not.toHaveBeenCalled();

    play.clickAt(s.x, s.y, 0);
    expect(actions.moveObjects).toHaveBeenCalledTimes(1);
    expect(actions.updateObject).not.toHaveBeenCalled();
    const [moves, options] = actions.moveObjects.mock.calls[0];
    expect(options.label).toBe('Move Standard Desk');
    const to = Object.fromEntries(moves);
    expect(Object.keys(to).sort()).toEqual(['chair', 'desk', 'mon']);
    expect(to.desk).toMatchObject({ x: -2.5, z: -0.5, y: 0.02, floor: 0, roomId: 'r' });
    expect(to.chair).toMatchObject({ x: -2.5, z: 0.2, y: 0.02 });
    expect(to.mon).toMatchObject({ x: -2.4, z: -0.5 });
    expect(to.mon.y).toBeCloseTo(0.02 + deskTop);
    // and the chair still belongs to the desk
    const after = objects.map((o) => ({ ...o, ...to[o.id] }));
    expect(deskSeat(after[0], after)?.id).toBe('chair');
  });

  it('the desk never lands on its own chair: over the chair\'s old spot it stays on the floor', () => {
    const { play, actions, pointAt, key } = world();
    pointAt(0, deskTop + 0.02, 1.4);
    key('KeyG');
    const s = pointAt(0, 0.02, 2.2); // where its chair stood
    play.clickAt(s.x, s.y, 0);
    const to = Object.fromEntries(actions.moveObjects.mock.calls[0][0]);
    expect(to.desk.y).toBeCloseTo(0.02);
  });

  it('R while carrying turns the group; Esc cancels and every mesh goes back', () => {
    const { play, actions, objectSystem, pointAt, key } = world();
    pointAt(0, deskTop + 0.02, 1.4);
    key('KeyG');
    key('KeyR');
    const s = pointAt(-2.5, 0.02, -0.5);
    const chairMesh = objectSystem.getObjectMesh('chair');
    // a quarter turn: the chair is now beside the desk (+X), not behind it
    expect(chairMesh.position.x).toBeCloseTo(-1.8);
    expect(chairMesh.position.z).toBeCloseTo(-0.5);
    key('Escape');
    expect(chairMesh.position.x).toBeCloseTo(0);
    expect(chairMesh.position.z).toBeCloseTo(2.2);
    expect(objectSystem.getObjectMesh('desk').position.z).toBeCloseTo(1.5);
    play.clickAt(s.x, s.y, 0);
    expect(actions.moveObjects).not.toHaveBeenCalled();
  });
});

describe('the old mouse capture is unchanged (look "lock", the default)', () => {
  it('no mouse aim: the HUD says so, a click on the view is not a walk', () => {
    const { calls, play } = world({ look: 'lock' });
    expect(calls.hud.mouseAim).toBe(false);
    expect(play.aimsAtMouse()).toBe(false);
    play.clickAt(10, 10, 0);
    expect(calls.click).not.toHaveBeenCalled();
  });
});
