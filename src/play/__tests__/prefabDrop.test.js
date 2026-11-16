import { describe, expect, it } from 'vitest';
import { planPrefabDrop, prefabPlacement, roomHolding } from '../prefabDrop';
import { prefabById } from '../../catalog/manifest';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { groupOf } from '../prefab';
import { deskSeats } from '../people';

const office = { id: 'r_open', name: 'Open Office', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 16, depth: 12, doors: [], windows: [] };
const meeting = { id: 'r_meet', name: 'Meeting Room', type: 'MEETING', floor: 0, x: 11, z: 0, width: 4, depth: 5, doors: [], windows: [] };
const layout = (objects = [], floor = 0) => ({ rooms: [office, meeting, { ...office, id: 'r_up', name: 'Upstairs', floor: 1 }], objects, floor });
const drop = (id, point, objects, floor) => planPrefabDrop(prefabById(id), point, layout(objects, floor), { catalog: ASSET_TYPES });

describe('dropping a prefab (v0.18.0)', () => {
  it('fits in the open office', () => {
    const plan = drop('WS_CLUSTER_6', { x: -2, z: 1 });
    expect(plan.problem).toBeNull();
    expect(plan.rect.width).toBeGreaterThan(4);
  });

  it('says what is in the way', () => {
    const desk = { id: 'd', assetType: 'DESK_STANDARD', floor: 0, x: -2, z: 1, rotationY: 0, scaleX: 1, scaleZ: 1 };
    expect(drop('WS_CLUSTER_6', { x: -2, z: 1 }, [desk]).problem).toBe('Overlaps Standard Desk');
    // a desk on another floor is not in the way
    expect(drop('WS_CLUSTER_6', { x: -2, z: 1 }, [{ ...desk, floor: 1 }]).problem).toBeNull();
  });

  it('never through a wall, never bigger than its room', () => {
    expect(drop('WS_CLUSTER_8', { x: 7, z: 0 }).problem).toMatch(/^Too big for Open Office|^Crosses the wall/);
    expect(drop('WS_CLUSTER_8', { x: 11, z: 0 }).problem).toBe('Too big for Meeting Room here');
    // outside every room, reaching into one
    expect(drop('WS_CLUSTER_4', { x: 0, z: 6.8 }).problem).toBe('Crosses the wall of Open Office');
  });

  it('a cabin: its own room, snapped like a drawn room, refused over another', () => {
    const outside = drop('WS_CABIN', { x: 0, z: 20 });
    expect(outside.problem).toBeNull();
    expect(outside.room).toMatchObject({ width: expect.any(Number), depth: expect.any(Number) });
    expect(drop('WS_CABIN', { x: 9.5, z: 0 }).problem).toMatch(/^Overlaps/);
    // inside the open office it stands in it (a nested room)
    expect(drop('WS_CABIN', { x: -4, z: -2 }).problem).toBeNull();
  });

  it('works on an upper floor', () => {
    expect(drop('WS_CLUSTER_4', { x: 0, z: 0 }, [], 1).problem).toBeNull();
    expect(roomHolding(layout().rooms, 1, 0, 0).id).toBe('r_up');
  });

  it('makes items in their room, grouped, with seats; a cabin with its room and door', () => {
    let n = 0;
    const plan = drop('WS_CLUSTER_4', { x: 1, z: 1 });
    const { room, objects } = prefabPlacement(prefabById('WS_CLUSTER_4'), {}, ASSET_TYPES, plan.at, layout().rooms,
      { groupId: 'grp_a', newId: () => `obj_${++n}` });
    expect(room).toBeNull();
    expect(objects).toHaveLength(8);
    for (const o of objects) {
      expect(o.roomId).toBe('r_open');
      expect(groupOf(o).id).toBe('grp_a');
      expect(o.category).toBeTruthy();
    }
    expect(deskSeats(objects).size).toBe(4);

    const cab = drop('WS_CABIN', { x: 0, z: 20 });
    const placed = prefabPlacement(prefabById('WS_CABIN'), {}, ASSET_TYPES, cab.at, layout().rooms,
      { groupId: 'grp_c', newId: () => `obj_${++n}`, roomId: 'room_cab', roomRect: cab.room });
    expect(placed.room).toMatchObject({ id: 'room_cab', type: 'OFFICE', name: 'Cabin', floor: 0 });
    expect(placed.room.doors).toHaveLength(1);
    const door = placed.room.doors[0];
    expect(Math.abs(door.offset) + door.width / 2).toBeLessThanOrEqual(placed.room.width / 2 - 0.1);
    for (const o of placed.objects) {
      expect(o.roomId).toBe('room_cab');
      expect(Math.abs(o.x - placed.room.x)).toBeLessThan(placed.room.width / 2);
      expect(Math.abs(o.z - placed.room.z)).toBeLessThan(placed.room.depth / 2);
    }
  });
});
