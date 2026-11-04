// @vitest-environment jsdom
// Walking again after another floor was chosen (Studio's floor switcher, a viewer's setFloor):
// you start on that floor, not where you left off.
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createPlayController } from '../playController';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const rooms = [
  { id: 'room_open', type: 'OFFICE', name: 'Open office', floor: 0, x: 0, z: 0, width: 20, depth: 13, wallHeight: 3.2, doors: [], windows: [] },
  { id: 'room_up', type: 'OFFICE', name: 'Upstairs office', floor: 1, x: 0, z: 0, width: 12, depth: 8, wallHeight: 3.2, doors: [], windows: [] },
];

let engine;
afterEach(() => engine?.dispose());

function setup() {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const world = { rooms, objects: [], floors, anchorData: {}, currentFloor: 0 };
  const levels = [];
  const huds = [];
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => world, actions: {}, readOnly: true, isEngaged: () => false,
    onLevelChange: (id) => { levels.push(id); world.currentFloor = id; },
    onHud: (info) => huds.push(info),
  });
  return { scene, world, levels, huds, play };
}

describe('starting to walk again on the chosen floor', () => {
  it('flying on Floor 1, the ground floor chosen meanwhile: you start standing on the ground floor', () => {
    const { scene, world, levels, huds, play } = setup();
    play.activate();
    play.setPose({ x: 0, z: -9, yaw: 0 }); // outside, south of the building
    play.stepFloor(1); // Page Up: no room above that spot
    expect(play.isFlying()).toBe(true);
    scene.render();
    expect(huds.at(-1).message).toBe('Floor 1: no room here, so you are flying (F lands)');
    play.deactivate();

    world.currentFloor = 0; // chosen in the view from above
    levels.length = 0;
    play.activate();
    expect(play.getLevel()).toBe(0);
    expect(play.isFlying()).toBe(false);
    expect(play.getPosition().y).toBeCloseTo(0, 1);
    expect(play.getPosition().z).toBeCloseTo(-9); // same spot
    scene.render();
    scene.render();
    expect(levels).toEqual([]); // nothing takes you back to Floor 1
    expect(world.currentFloor).toBe(0);
    // the message from the last walk is gone (it was still running: 2 s)
    expect(huds.at(-1)).toMatchObject({ message: null, flying: false, floor: { index: 1, count: 2 } });
  });

  it('Floor 1 chosen meanwhile: you start there (on its room, or flying where it has none)', () => {
    const { world, play } = setup();
    play.activate();
    play.setPose({ x: 0, z: 0, yaw: 0 }); // inside the open office
    play.deactivate();
    world.currentFloor = 1;
    play.activate();
    expect(play.getLevel()).toBe(1);
    expect(play.isFlying()).toBe(false); // the upstairs office is above you
    expect(play.getPosition().y).toBeGreaterThan(3.4);
  });

  it('the same floor: you start where you left off', () => {
    const { play } = setup();
    play.activate();
    play.setPose({ x: 4, z: 2, yaw: 1 });
    play.deactivate();
    play.activate();
    expect(play.getLevel()).toBe(0);
    expect(play.getPosition().x).toBeCloseTo(4);
    expect(play.getPosition().z).toBeCloseTo(2);
  });
});
