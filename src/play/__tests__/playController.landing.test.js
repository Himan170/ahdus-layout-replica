// @vitest-environment jsdom
// v0.18.6 (Astra audit 2b): ending a flight (F) right over a table never leaves you standing inside it. You come
// down at the nearest spot where the body fits, as walking does: people don't stand on furniture.
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createPlayController } from '../playController';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const rooms = [
  { id: 'room_meet', type: 'MEETING', name: 'Meeting', floor: 0, x: 0, z: 0, width: 12, depth: 10, wallHeight: 3.2, doors: [], windows: [] },
];
const table = {
  id: 'obj_round', assetType: 'TABLE_ROUND', label: 'Round Table', x: 3, y: 0, z: 0, floor: 0, roomId: 'room_meet',
  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
};

let engine;
afterEach(() => engine?.dispose());

function setup() {
  engine = new NullEngine();
  engine.getDeltaTime = () => 50; // 20 frames a second: the fall takes a few frames
  const scene = new Scene(engine);
  const world = { rooms, objects: [table], floors, anchorData: {}, currentFloor: 0 };
  const play = createPlayController(scene, document.createElement('canvas'), {
    getState: () => world, actions: {}, readOnly: true,
  });
  return { scene, play };
}

const press = (code) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
};

describe('ending a flight (v0.18.6)', () => {
  it('over a round table: you land beside it, not inside it', () => {
    const { scene, play } = setup();
    play.activate();
    play.setPose({ x: 3, z: 0, y: 2, fly: true, exact: true }); // the audit's spot: right over the table's middle
    expect(play.isFlying()).toBe(true);
    press('KeyF');
    expect(play.isFlying()).toBe(false);
    for (let i = 0; i < 20; i++) scene.render();
    const p = play.getPosition();
    expect(p.y).toBeLessThan(0.1); // on the floor
    // the body (0.32 m) clear of the table's round top (0.5 m)
    expect(Math.hypot(p.x - 3, p.z)).toBeGreaterThanOrEqual(0.5 + 0.32 - 0.01);
    expect(Math.hypot(p.x - 3, p.z)).toBeLessThan(1.5); // the nearest spot, not somewhere far away
    play.deactivate();
  });

  it('over free floor: you land right where you are', () => {
    const { scene, play } = setup();
    play.activate();
    play.setPose({ x: -3, z: 2, y: 2, fly: true, exact: true });
    press('KeyF');
    for (let i = 0; i < 20; i++) scene.render();
    expect(play.getPosition().x).toBeCloseTo(-3);
    expect(play.getPosition().z).toBeCloseTo(2);
    play.deactivate();
  });
});
