// v0.18.1: DoorSystem on a NullEngine: Studio half open, the viewer's doors open for a walker only (A5), at most a
// handful of meshes for every door of the building, never pickable, hidden with their room.
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { DoorSystem, type DoorMover } from '../systems/DoorSystem';
import { STUDIO_OPEN, MAX_ANIMATED_DOORS } from '../../play/doorSwing';

let engine: NullEngine;
afterEach(() => engine?.dispose());

function setup(doorCount = 1, { studio = false } = {}) {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const doors = Array.from({ length: doorCount }, (_, i) => ({
    wall: 'south', offset: -9 + i * 2.5, width: 1, height: 2.1, ...(i % 2 ? { style: 'glass' } : {}),
  }));
  const rooms = { r: { id: 'r', floor: 0, x: 0, z: 0, width: 20, depth: 6, wallHeight: 3, doors, windows: [] } };
  const node = new TransformNode('room_r', scene);
  const state = { studio, movers: [] as DoorMover[] };
  const system = new DoorSystem(scene, {
    getLayout: () => ({ rooms }),
    roomNode: (id) => (id === 'r' ? node : null),
    studio: () => state.studio,
    shownFloor: () => 0,
    movers: () => state.movers,
  });
  return { scene, system, node, state };
}

const instances = (system: DoorSystem) =>
  Object.fromEntries(system.leafMeshes.map((m) => [m.name, m.isEnabled() ? m.thinInstanceCount : 0]));

describe('DoorSystem', () => {
  it('Studio: every door half open; a few thin-instance meshes for all of them, not pickable, no collisions', () => {
    const { system } = setup(8, { studio: true });
    system.update(0.016);
    expect(system.list).toHaveLength(8);
    expect(system.openOf(system.list[0].key)).toBe(STUDIO_OPEN);
    expect(system.leafMeshes.length).toBeLessThanOrEqual(4);
    expect(instances(system).door_leaves_wood).toBe(4);
    for (const m of system.leafMeshes) {
      expect(m.isPickable).toBe(false);
      expect(m.checkCollisions).toBe(false);
    }
    expect(system.animated).toBe(0);
  });

  it('the viewer: shut with nobody walking; a walker opens the door they come to and no other', () => {
    const { system, state } = setup(8);
    for (let i = 0; i < 20; i++) system.update(0.05);
    expect(system.animated).toBe(0);
    const d = system.list[3];
    for (let i = 0, z = d.centre.z - 4; i < 80; i++, z += 0.05) {
      state.movers = [{ id: 'me', x: d.centre.x, z, floor: 0, local: true }];
      system.update(0.05);
    }
    expect(system.openOf(d.key)).toBe(1);
    expect(system.animated).toBe(1);
  });

  it(`many people walking: at most ${MAX_ANIMATED_DOORS} doors open`, () => {
    const { system, state } = setup(8);
    for (let i = 0; i < 40; i++) {
      state.movers = system.list.map((d, k) => ({ id: `p${k}`, x: d.centre.x, z: d.centre.z - 1, floor: 0, speed: 1.2 }));
      system.update(0.05);
      expect(system.animated).toBeLessThanOrEqual(MAX_ANIMATED_DOORS);
    }
    expect(system.animated).toBe(MAX_ANIMATED_DOORS);
  });

  it('a hidden room hides its doors', () => {
    const { system, node } = setup(2, { studio: true });
    system.update(0.016);
    expect(instances(system).door_leaves_wood).toBe(1);
    node.setEnabled(false);
    system.update(0.016);
    expect(Object.values(instances(system)).every((n) => n === 0)).toBe(true);
  });
});
