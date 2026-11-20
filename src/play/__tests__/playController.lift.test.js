// @vitest-environment jsdom
// v0.18.3: in a lift car the third-person camera sat right behind your head (the head filled the view and covered
// the floor panel). Standing in a lift shaft room the camera is first person and your character hidden; stepping
// out gives the view back (the real controller on a NullEngine).
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createPlayController } from '../playController';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const rooms = [
  { id: 'hall', type: 'OFFICE', name: 'Hall', floor: 0, x: 0, z: 0, width: 16, depth: 10, wallHeight: 3.2, doors: [], windows: [] },
  { id: 'lift', type: 'LIFT', name: 'Lift', floor: 0, x: 4, z: 2, width: 2.2, depth: 2.2, wallHeight: 3.2,
    doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [] },
];

let engine;
afterEach(() => engine?.dispose());

function setup() {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const world = { rooms, objects: [], floors, anchorData: {}, currentFloor: 0 };
  const huds = [];
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => world, actions: {}, readOnly: true, isEngaged: () => false, onHud: (info) => huds.push(info),
  });
  return { scene, huds, play };
}
/** How far the camera is from your eyes, sideways (m): first person ≈ 0.12, third person ≈ 3. */
const camAway = (scene, play) => {
  const c = scene.activeCamera.position;
  const p = play.getPosition();
  return Math.hypot(c.x - p.x, c.z - p.z);
};
const playerVisible = (scene) => scene.meshes.filter((m) => /player|character/i.test(m.name)).some((m) => m.isEnabled() && m.isVisible);

describe('the camera in a lift car (v0.18.3)', () => {
  it('in the car: first person, your character hidden; out of it: third person again', () => {
    const { scene, huds, play } = setup();
    play.activate();
    play.setPose({ x: 0, z: -2, yaw: 0 }); // in the hall
    scene.render();
    expect(play.isLiftView()).toBe(false);
    expect(camAway(scene, play)).toBeGreaterThan(1);
    const shownBefore = playerVisible(scene);

    play.setPose({ x: 4, z: 2, yaw: Math.PI }); // in the car, facing its doors
    scene.render();
    expect(play.isLiftView()).toBe(true);
    expect(camAway(scene, play)).toBeLessThan(0.3);
    expect(playerVisible(scene)).toBe(false);
    expect(huds.at(-1)).toMatchObject({ liftView: true, firstPerson: false, roomType: 'LIFT' }); // V is still yours

    play.setPose({ x: 0, z: -2, yaw: 0 }); // stepped out
    scene.render();
    expect(play.isLiftView()).toBe(false);
    expect(camAway(scene, play)).toBeGreaterThan(1);
    expect(playerVisible(scene)).toBe(shownBefore);
  });

  it('flying through a lift shaft keeps your own view', () => {
    const { scene, play } = setup();
    play.activate();
    play.setPose({ x: 4, z: 2, yaw: 0, fly: true, y: 1.5 });
    scene.render();
    expect(play.isLiftView()).toBe(false);
  });
});
