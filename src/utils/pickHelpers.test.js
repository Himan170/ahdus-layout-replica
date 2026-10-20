import { describe, expect, it } from 'vitest';
import { itemOverFloorPoint } from './pickHelpers';

// Just what itemOverFloorPoint reads of a mesh: its item id, enabled, world bounds
const item = (objectId, [x0, y0, z0], [x1, y1, z1]) => ({
  metadata: { objectId },
  isEnabled: () => true,
  getBoundingInfo: () => ({ boundingBox: { minimumWorld: { x: x0, y: y0, z: z0 }, maximumWorld: { x: x1, y: y1, z: z1 } } }),
});

describe('itemOverFloorPoint: the floor under an item means that item', () => {
  const desk = item('desk', [-0.7, 0, -0.35], [0.7, 0.75, 0.35]);
  const monitor = item('monitor', [-0.5, 0.75, -0.2], [0.5, 1.3, 0.1]);   // stands on the desk, taller
  const chair = item('chair', [0.2, 0, 0.1], [0.8, 0.95, 0.7]);           // pushed half under it

  it('the desk, not the monitor standing on it', () => {
    expect(itemOverFloorPoint({ meshes: [monitor, desk] }, { x: 0, z: 0 })).toBe('desk');
    expect(itemOverFloorPoint({ meshes: [desk, monitor] }, { x: 0, z: 0 })).toBe('desk');
  });

  it('of two items on the floor, the taller one', () => {
    expect(itemOverFloorPoint({ meshes: [desk, chair] }, { x: 0.5, z: 0.2 })).toBe('chair');
  });

  it('nothing there: null; skipped meshes do not count', () => {
    expect(itemOverFloorPoint({ meshes: [desk] }, { x: 3, z: 0 })).toBeNull();
    expect(itemOverFloorPoint({ meshes: [desk, monitor] }, { x: 0, z: 0 }, (m) => m !== desk)).toBe('monitor');
  });
});
