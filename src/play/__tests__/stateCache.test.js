import { describe, expect, it } from 'vitest';
import { cachedLayoutState, lastResult } from '../stateCache';
import { createNearbyMeshes, NEAR_RADIUS, NEAR_REFRESH_MS } from '../movement';

describe('cachedLayoutState (v0.17.0)', () => {
  it('makes the arrays again only when the store gives new records', () => {
    let s = { rooms: { a: { id: 'a' } }, objects: { o: { id: 'o' } }, currentFloor: 0, floors: { 0: {} } };
    const get = cachedLayoutState(() => s);
    const one = get();
    const two = get();
    expect(two.rooms).toBe(one.rooms);
    expect(two.objects).toBe(one.objects);
    expect(one.rooms).toEqual([{ id: 'a' }]);
    s = { ...s, objects: { ...s.objects, p: { id: 'p' } }, currentFloor: 1 };
    const three = get();
    expect(three.rooms).toBe(one.rooms); // rooms unchanged
    expect(three.objects).not.toBe(one.objects);
    expect(three.objects.map((o) => o.id)).toEqual(['o', 'p']);
    expect(three.currentFloor).toBe(1);
  });
});

describe('lastResult (v0.17.0)', () => {
  it('keeps the result until the list or the key changes', () => {
    let calls = 0;
    const onFloor = lastResult((list, floor) => { calls++; return list.filter((r) => r.floor === floor); });
    const rooms = [{ floor: 0 }, { floor: 1 }];
    const a = onFloor(rooms, 0);
    expect(onFloor(rooms, 0)).toBe(a);
    expect(calls).toBe(1);
    expect(onFloor(rooms, 1)).toEqual([{ floor: 1 }]);
    expect(onFloor([...rooms], 1)).toEqual([{ floor: 1 }]);
    expect(calls).toBe(3);
  });
});

const mesh = (name, lo, hi) => ({
  name,
  getBoundingInfo: () => ({ boundingBox: { minimumWorld: { x: lo[0], y: lo[1], z: lo[2] }, maximumWorld: { x: hi[0], y: hi[1], z: hi[2] } } }),
});

describe('createNearbyMeshes (v0.17.0)', () => {
  const wall = mesh('long wall', [-50, 0, 3], [50, 3, 3.2]); // its middle is far, its side is 3 m away
  const desk = mesh('desk', [1, 0, 1], [2, 0.8, 2]);
  const far = mesh('far desk', [30, 0, 30], [31, 0.8, 31]);
  const upstairs = mesh('two floors up', [0, 9, 0], [1, 12, 1]);
  const player = mesh('player', [0, 0, 0], [0.2, 1.8, 0.2]);

  it('keeps the meshes whose box is within reach on this floor, by the box (not its middle)', () => {
    const scene = { meshes: [wall, desk, far, upstairs, player] };
    const near = createNearbyMeshes(scene, { exclude: (m) => m === player });
    expect(near.refresh({ x: 0, y: 0, z: 0 }, 0)).toBe(true);
    expect(near.list.map((m) => m.name)).toEqual(['long wall', 'desk']);
    expect(near.has(desk)).toBe(true);
    expect(near.has(far)).toBe(false);
  });

  it('looks again after 1 m, after a while, or when the meshes or the layout change', () => {
    const scene = { meshes: [desk, far] };
    const near = createNearbyMeshes(scene);
    near.refresh({ x: 0, y: 0, z: 0 }, 0);
    // meshes new since the last look (the first one too): looked at again on the next frame, then not
    expect(near.refresh({ x: 0, y: 0, z: 0 }, 5)).toBe(true);
    expect(near.refresh({ x: 0.5, y: 0, z: 0 }, 10)).toBe(false);
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 20)).toBe(true);
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 20 + NEAR_REFRESH_MS)).toBe(true);
    scene.meshes = [desk, far, mesh('new', [0, 0, 0], [1, 1, 1])];
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 30 + NEAR_REFRESH_MS)).toBe(true);
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 35 + NEAR_REFRESH_MS)).toBe(true); // the next frame, again
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 40 + NEAR_REFRESH_MS, 'edited')).toBe(true);
    expect(near.refresh({ x: 1.2, y: 0, z: 0 }, 50 + NEAR_REFRESH_MS, 'edited')).toBe(false);
    // walking to the far desk brings it in
    near.refresh({ x: 30 - NEAR_RADIUS + 1, y: 0, z: 30 }, 60 + NEAR_REFRESH_MS);
    expect(near.has(far)).toBe(true);
  });
});
