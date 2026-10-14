import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { moveWithSteps } from '../movement';
import { splitWall, roomWalls, roomOpenings, WALL_THICKNESS } from '../geometry';

/** Same wall pieces roomBuilder makes (without materials), for a room with a south door */
function sceneWithRoom() {
  const scene = new Scene(new NullEngine());
  scene.collisionsEnabled = true;
  const room = { x: 0, z: 0, width: 6, depth: 4, wallHeight: 3, doors: [{ wall: 'south', offset: 0, width: 1 }] };
  const root = new TransformNode('room', scene);
  for (const wall of roomWalls(room)) {
    const holes = roomOpenings(room).filter((o) => o.wall === wall.name);
    for (const p of splitWall(wall.length, 3, holes)) {
      const len = p.u1 - p.u0;
      const box = MeshBuilder.CreateBox('w', {
        width: wall.alongX ? len : WALL_THICKNESS, depth: wall.alongX ? WALL_THICKNESS : len, height: p.y1 - p.y0,
      }, scene);
      const mid = (p.u0 + p.u1) / 2;
      box.position.set(wall.alongX ? wall.cx + mid : wall.cx, (p.y0 + p.y1) / 2, wall.alongX ? wall.cz : wall.cz + mid);
      box.parent = root;
      box.checkCollisions = true;
    }
  }
  // No render loop in Node: compute wall positions once (the browser does this every frame)
  scene.meshes.forEach((m) => m.computeWorldMatrix(true));
  const player = MeshBuilder.CreateBox('player', { size: 0.2 }, scene);
  player.ellipsoid = new Vector3(0.32, 0.9, 0.32);
  player.ellipsoidOffset = new Vector3(0, 0.9, 0);
  return { scene, player };
}

describe('walking into walls', () => {
  it('a solid wall stops you, even with one big move (slow frame)', () => {
    const { player } = sceneWithRoom();
    player.position.set(2, 0, -5);            // in front of the south wall, away from the door
    moveWithSteps(player, 0, 4);              // try to walk 4 m north in one frame
    expect(player.position.z).toBeLessThan(-2 - WALL_THICKNESS / 2);
    expect(player.position.z).toBeGreaterThan(-2.6);
  });

  it('the doorway lets you through', () => {
    const { player } = sceneWithRoom();
    player.position.set(0, 0, -5);            // lined up with the door
    moveWithSteps(player, 0, 4);
    expect(player.position.z).toBeCloseTo(-1, 1);
  });

  it('many small moves in one frame also stop at the wall', () => {
    const { player } = sceneWithRoom();
    player.position.set(-2, 0, -5);
    for (let i = 0; i < 20; i++) moveWithSteps(player, 0, 0.2);
    expect(player.position.z).toBeLessThan(-2 - WALL_THICKNESS / 2);
  });
});

describe('moveWithSteps afterStep', () => {
  it('calls afterStep once per small step (so stairs are checked every 10 cm)', async () => {
    const { moveWithSteps, MAX_STEP } = await import('../movement');
    let calls = 0;
    const fake = { computeWorldMatrix() {}, moveWithCollisions() {} };
    moveWithSteps(fake, 1.0, 0, () => { calls++; });
    expect(calls).toBe(Math.ceil(1.0 / MAX_STEP));
  });
});
