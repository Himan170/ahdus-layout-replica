// @vitest-environment jsdom
// A door you can walk through is open on the walk map: the same rule as the real collision (v0.14.5). The REAL
// room meshes (RoomSystem: what collides) and the REAL controller, with W and with Take me there's follower.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Collisions/collisionCoordinator';

import { RoomSystem } from '../../engine/systems/RoomSystem';
import { ObjectSystem } from '../../engine/systems/ObjectSystem';
import { createPlayController } from '../playController';
import { createWalkMapCache } from '../navigation/walkMap';
import { findRoute } from '../navigation/route';
import { createFollower } from '../navigation/follow';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { planWallSegmentOpening } from '../geometry';

vi.mock('../../utils/materialLibrary', async (orig) => ({
  ...(await orig()),
  getMaterials: () => Object.fromEntries([
    'floor', 'plaster', 'structure', 'skirting', 'doorFrame', 'windowFrame',
    'glass', 'roofTop', 'ceiling', 'lightPanel',
  ].map((key) => [key, () => null])),
  getAssetMaterial: () => null,
}));

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const office = (doors) => ({
  id: 'r', type: 'OFFICE', name: 'Office', floor: 0, x: 0, z: 0, width: 8, depth: 8, wallHeight: 3.2, wallThickness: 0.15, doors, windows: [],
});

let engine = null;
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  engine?.dispose();
  engine = null;
});

function world(doors, objects = []) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  engine.getDeltaTime = () => 50;
  const rooms = [office(doors)];
  const layout = { rooms, objects, floors };
  new RoomSystem(scene).sync({ rooms: { r: rooms[0] }, objects: Object.fromEntries(objects.map((o) => [o.id, o])), floors });
  new ObjectSystem(scene).sync({ objects: Object.fromEntries(objects.map((o) => [o.id, o])), floors });
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => ({ ...layout, anchorData: {}, currentFloor: 0 }), actions: {}, readOnly: true, isEngaged: () => true, look: 'drag',
  });
  play.activate();
  return { scene, play, layout };
}

/** Hold W from outside the south wall, straight at the door: did the body get inside? */
function walksIn(doors, objects, x = 0) {
  const { scene, play } = world(doors, objects);
  play.setPose({ x, z: -6, yaw: 0, pitch: 0, floor: 0, exact: true });
  const down = new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true });
  document.dispatchEvent(down);
  window.dispatchEvent(down);
  for (let i = 0; i < 60; i++) scene.render();
  const up = new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true });
  document.dispatchEvent(up);
  window.dispatchEvent(up);
  const z = play.getPosition().z;
  play.dispose?.();
  engine.dispose();
  engine = null;
  return z > -3.5;
}

/** Find a route from outside to inside; Take me there's follower walks it with the real collisions. */
function takeMeIn(doors, objects = [], from = { x: 6, z: -7 }) {
  const { scene, play, layout } = world(doors, objects);
  const maps = createWalkMapCache({ catalog: ASSET_TYPES });
  const route = findRoute(layout, { ...from, floor: 0 }, { x: 0, z: 2, floor: 0 }, { maps });
  if (route.problem) return { problem: route.problem, message: route.message };
  const follower = createFollower(route, { mapFor: (f) => maps.get(layout, f) });
  let arrived = false;
  play.setPose({ ...from, yaw: 0, pitch: 0, floor: 0 });
  play.setAutopilot({
    drive: (dt, me) => {
      const s = follower.step(me, dt);
      if (s.arrived) { arrived = true; return null; }
      return { dirX: s.dirX, dirZ: s.dirZ, speed: s.speed, yaw: s.yaw };
    },
    key: () => false,
  });
  for (let i = 0; i < 400 && !arrived; i++) scene.render();
  return { arrived, p: play.getPosition() };
}

describe('doors in Studio: the walk map follows the real collision', () => {
  it.each([0.6, 0.7, 0.8, 1])('a %d m door: W walks through it, and so does Take me there', (width) => {
    const doors = [{ wall: 'south', offset: 0, width, height: 2.1 }];
    expect(walksIn(doors)).toBe(true);
    const r = takeMeIn(doors);
    expect(r.problem, r.message).toBeUndefined();
    expect(r.arrived).toBe(true);
    expect(r.p.z).toBeGreaterThan(0);
  });

  it('a door off-centre on its wall, on every side of the room', () => {
    for (const wall of ['south', 'east', 'west', 'north']) {
      const r = takeMeIn([{ wall, offset: 1.3, width: 0.7, height: 2.1 }]);
      expect(r.problem, `${wall}: ${r.message}`).toBeUndefined();
      expect(r.arrived, wall).toBe(true);
      engine.dispose();
      engine = null;
    }
  });

  it('no door: the wall stops W, and there is no route', () => {
    expect(walksIn([])).toBe(false);
    expect(takeMeIn([]).problem).toBe('NO_DOOR');
  });

  it('a window is not a door: W stops at it, and no route goes through it', () => {
    const { scene, play, layout } = world([]);
    layout.rooms[0].windows = [{ wall: 'south', offset: 0, width: 2, height: 1.2, sill: 0.9 }];
    new RoomSystem(scene).sync({ rooms: { r: layout.rooms[0] }, objects: {}, floors });
    play.setPose({ x: 0, z: -6, yaw: 0, pitch: 0, floor: 0, exact: true });
    const down = new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true });
    document.dispatchEvent(down);
    window.dispatchEvent(down);
    for (let i = 0; i < 60; i++) scene.render();
    expect(play.getPosition().z).toBeLessThan(-3.5);
    expect(findRoute(layout, { x: 0, z: -6, floor: 0 }, { x: 0, z: 2, floor: 0 }, { catalog: ASSET_TYPES }).problem).toBe('NO_DOOR');
  });

  it('a door item (an old save) standing in the doorway: not solid in the walkthrough, open on the map', () => {
    const doors = [{ wall: 'south', offset: 0, width: 1, height: 2.1 }];
    const item = { id: 'd', assetType: 'DOOR_SINGLE', floor: 0, x: 0, y: 0, z: -4, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
    expect(ASSET_TYPES.DOOR_SINGLE.solid).toBe(false);
    expect(walksIn(doors, [item])).toBe(true);
    const r = takeMeIn(doors, [item]);
    expect(r.problem, r.message).toBeUndefined();
    expect(r.arrived).toBe(true);
  });

  it('a solid item in the doorway stops both: the same answer', () => {
    const doors = [{ wall: 'south', offset: 0, width: 1, height: 2.1 }];
    const item = { id: 'c', assetType: 'FILING_CABINET', floor: 0, x: 0, y: 0, z: -4, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 3, scaleY: 1, scaleZ: 1 };
    expect(walksIn(doors, [item])).toBe(false);
    expect(takeMeIn(doors, [item]).problem).toBe('NO_ROUTE');
  });
});

describe('walls drawn with the Wall tool', () => {
  const item = (o) => ({ floor: 0, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...o });
  it('a passable door looks open: no visible panel across the doorway', () => {
    const { scene } = world([], [item({ id: 'door', assetType: 'DOOR_SINGLE' })]);
    const ray = new Ray(new Vector3(0, 1, -1), new Vector3(0, 0, 1), 2);
    const hit = scene.pickWithRay(ray, (m) => m.metadata?.objectId === 'door');
    expect(hit?.hit).toBe(false);
  });
  function walkAcross(objects, reverse = false, x = 0) {
    const { scene, play } = world([{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], objects.map(item));
    play.setPose({ x, z: reverse ? 2 : -2, yaw: reverse ? Math.PI : 0, pitch: 0, floor: 0, exact: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    for (let n = 0; n < 45; n++) scene.render();
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    const z = play.getPosition().z;
    play.dispose();
    engine.dispose(); engine = null;
    return reverse ? -z : z;
  }
  for (const reverse of [false, true]) {
    for (const kind of ['door', 'window']) {
      it(`a cut ${kind} works from ${reverse ? 'behind' : 'in front'}`, () => {
        const plan = planWallSegmentOpening(item({ id: 'wall', assetType: 'WALL_SEGMENT', scaleX: 2 }), { x: 0, z: 0 }, kind);
        const pieces = plan.add.map((o, i) => ({ ...o, id: 'piece' + i }));
        const z = walkAcross(pieces, reverse);
        if (kind === 'door') expect(z).toBeGreaterThan(0.5);
        else expect(z).toBeLessThan(-0.3);
        expect(walkAcross(pieces, reverse, 1.5)).toBeLessThan(-0.3);
      });
    }
    it(`a solid wall stops you from ${reverse ? 'behind' : 'in front'}`, () => {
      expect(walkAcross([{ id: 'wall', assetType: 'WALL_SEGMENT', scaleX: 2 }], reverse)).toBeLessThan(-0.3);
    });
  }
});
