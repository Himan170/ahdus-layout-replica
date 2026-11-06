// @vitest-environment jsdom
// Where walking starts (navigation/entrance.js) and never landing in a wall or a desk (v0.13.0).
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createPlayController } from '../playController';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
// A reception with its door on the south wall (z = −4), an office upstairs with a desk at (2, 1)
const rooms = [
  { id: 'room_reception', type: 'RECEPTION', name: 'Reception', floor: 0, x: 0, z: 0, width: 10, depth: 8, wallHeight: 3.2,
    doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }], windows: [] },
  { id: 'room_up', type: 'OFFICE', name: 'Upstairs office', floor: 1, x: 0, z: 0, width: 10, depth: 8, wallHeight: 3.2, doors: [], windows: [] },
];
const objects = [
  { id: 'obj_desk_up', assetType: 'DESK_STANDARD', floor: 1, x: 2, y: 0, z: 1, rotationY: 0 },
  { id: 'obj_desk', assetType: 'DESK_STANDARD', floor: 0, x: -2, y: 0, z: 1, rotationY: 0 },
];

let engine;
afterEach(() => engine?.dispose());

function setup(options = {}) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const world = { rooms, objects, floors, anchorData: {}, currentFloor: 1 }; // looking at Floor 1
  const levels = [];
  const huds = [];
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => world, actions: {}, readOnly: true, isEngaged: () => true,
    onLevelChange: (id) => { levels.push(id); world.currentFloor = id; },
    onHud: (info) => huds.push(info),
    ...options,
  });
  return { scene, world, levels, huds, play };
}

const ENTRANCE_Z = -4 - 0.075 - 3;

describe('where walking starts', () => {
  it('on the ground floor, 3 m outside the main entrance, facing it, whatever floor was shown', () => {
    const { play, levels, world } = setup({ respawnOnActivate: true });
    play.activate();
    expect(play.getLevel()).toBe(0);
    expect(levels).toEqual([0]);
    expect(world.currentFloor).toBe(0);
    expect(play.isFlying()).toBe(false);
    const p = play.getPosition();
    expect(p.x).toBeCloseTo(0, 1);
    expect(p.z).toBeCloseTo(ENTRANCE_Z, 1);
    expect(p.y).toBeCloseTo(0, 1);
    expect(play.getYaw()).toBeCloseTo(0, 2); // facing +Z: the door
    expect(play.isFree(p.x, p.z, 0)).toBe(true);
  });

  it('the walkthrough (respawnOnActivate) starts there every time; Preview only the first time', () => {
    const walk = setup({ respawnOnActivate: true });
    walk.play.activate();
    walk.play.setPose({ x: 3, z: -2, yaw: 1 });
    walk.play.deactivate();
    walk.play.activate();
    expect(walk.play.getPosition().z).toBeCloseTo(ENTRANCE_Z, 1);
    engine.dispose();

    const preview = setup();
    preview.play.activate();
    expect(preview.play.getPosition().z).toBeCloseTo(ENTRANCE_Z, 1);
    preview.play.setPose({ x: 3, z: -2, yaw: 1 });
    preview.play.deactivate();
    preview.play.activate();
    expect(preview.play.getPosition().x).toBeCloseTo(3);
    expect(preview.play.getPosition().z).toBeCloseTo(-2);
  });

  it('Home goes back there and says so', () => {
    const { scene, play, huds } = setup({ respawnOnActivate: true });
    play.activate();
    play.setPose({ x: 3, z: -2, yaw: 1 });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home' }));
    expect(play.getPosition().z).toBeCloseTo(ENTRANCE_Z, 1);
    expect(play.getYaw()).toBeCloseTo(0, 2);
    scene.render();
    expect(huds.at(-1).message).toBe('Back at the entrance');
  });
});

describe('never in a wall or a desk', () => {
  it('setPose into a desk lands on the nearest free spot; exact: true puts you exactly there', () => {
    const { play } = setup();
    play.activate();
    play.setPose({ x: -2, z: 1, floor: 0 });
    const p = play.getPosition();
    expect(play.isFree(p.x, p.z, 0)).toBe(true);
    expect(Math.hypot(p.x + 2, p.z - 1)).toBeGreaterThan(0.7);
    expect(Math.hypot(p.x + 2, p.z - 1)).toBeLessThan(0.9);
    play.setPose({ x: -2, z: 1, exact: true });
    expect(play.getPosition().x).toBeCloseTo(-2);
    expect(play.getPosition().z).toBeCloseTo(1);
  });

  it('setPose into a wall lands beside it', () => {
    const { play } = setup();
    play.activate();
    play.setPose({ x: 5, z: 0, floor: 0 }); // the east wall
    const p = play.getPosition();
    expect(play.isFree(p.x, p.z, 0)).toBe(true);
    expect(Math.abs(p.x - 5)).toBeLessThan(0.6);
  });

  it('Page Up under the upstairs desk lands beside it, standing', () => {
    const { play } = setup();
    play.activate();
    play.setPose({ x: 2, z: 1.2, floor: 0 }); // free downstairs, the desk is above
    play.stepFloor(1);
    const p = play.getPosition();
    expect(play.getLevel()).toBe(1);
    expect(play.isFlying()).toBe(false);
    expect(play.isFree(p.x, p.z, 1)).toBe(true);
    expect(p.y).toBeGreaterThan(3.4);
  });
});
