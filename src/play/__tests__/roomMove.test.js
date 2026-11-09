// Moving a room takes what is in it along (v0.15.1): its items and the rooms inside it.
import { describe, expect, it } from 'vitest';
import { planRoomMove, roomsInside, itemInRoom } from '../geometry';

const room = (id, x, z, width, depth, extra = {}) => ({ id, name: id, floor: 0, x, z, width, depth, ...extra });
const item = (id, x, z, extra = {}) => ({ id, assetType: 'DESK_STANDARD', floor: 0, x, z, ...extra });

describe('planRoomMove carries what is in the room', () => {
  const office = room('office', 0, 0, 10, 8);
  const items = [
    item('d1', 1, 1), item('d2', -4, 3), item('chair', 1, 1.7, { assetType: 'CHAIR_OFFICE' }),
    item('locked', 2, -2, { isLocked: true }),
    item('outside', 7, 0), item('upstairs', 1, 1, { floor: 1 }),
  ];

  it('a 4 m move takes all 12 items along by 4 m (and none outside it, nor upstairs)', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => item(`i${i}`, -4 + i * 0.7, (i % 3) - 1));
    const plan = planRoomMove(office, 4, 0, [office], [...twelve, item('outside', 7, 0)]);
    expect(plan.blocker).toBeNull();
    expect(plan.objects).toHaveLength(12);
    for (const [id, to] of plan.objects) {
      const from = twelve.find((o) => o.id === id);
      expect(to.x).toBeCloseTo(from.x + 4);
      expect(to.z).toBeCloseTo(from.z);
    }
  });

  it('locked items go with their room; other floors and outside items stay', () => {
    const plan = planRoomMove(office, 0, 3, [office], items);
    const ids = plan.objects.map(([id]) => id).sort();
    expect(ids).toEqual(['chair', 'd1', 'd2', 'locked']);
    expect(Object.fromEntries(plan.objects).d2).toEqual({ x: -4, z: 6 });
    expect([plan.dx, plan.dz]).toEqual([0, 3]);
  });

  it('rooms inside it (two levels) go along and do not block the move', () => {
    const cabin = room('cabin', 2, 1, 4, 4);
    const booth = room('booth', 2, 1, 2, 2);
    const neighbour = room('neighbour', 20, 0, 4, 4);
    const plan = planRoomMove(office, -3, 0, [office, cabin, booth, neighbour], [item('inBooth', 2, 1)]);
    expect(plan.blocker).toBeNull();
    expect(Object.fromEntries(plan.rooms)).toEqual({ cabin: { x: -1, z: 1 }, booth: { x: -1, z: 1 } });
    expect(plan.objects).toEqual([['inBooth', { x: -1, z: 1 }]]);
  });

  it('a move onto another room is still refused', () => {
    const neighbour = room('neighbour', 12, 0, 6, 6);
    expect(planRoomMove(office, 6, 0, [office, neighbour], items).blocker?.id).toBe('neighbour');
  });

  it('it lands back to back on a neighbour, and the items move by the snapped amount', () => {
    const neighbour = room('neighbour', 12, 0, 6, 6);
    const plan = planRoomMove(office, 3.8, 0, [office, neighbour], [item('d', 0, 0)]);
    expect(plan.blocker).toBeNull();
    expect(plan.rect.x).toBeCloseTo(3.85); // back to back: its east edge one wall (0.15 m) from the neighbour's (9)
    expect(plan.objects[0][1].x).toBeCloseTo(plan.dx);
  });

  it('a nested room moves inside its outer room with its own items only', () => {
    const cabin = room('cabin', 2, 1, 4, 4);
    const plan = planRoomMove(cabin, 1, 1, [office, cabin], [item('inCabin', 2, 1), item('inOffice', -4, 3)]);
    expect(plan.blocker).toBeNull();
    expect(plan.objects).toEqual([['inCabin', { x: 1, z: 1 }]]);
    expect(plan.rooms).toEqual([]);
  });
});

describe('roomsInside / itemInRoom', () => {
  it('finds rooms inside at any depth, never the room itself or a room of the same size', () => {
    const office = room('office', 0, 0, 10, 8);
    expect(roomsInside(office, [office, room('twin', 0, 0, 10, 8), room('c', 1, 1, 3, 3)]).map((r) => r.id)).toEqual(['c']);
  });

  it('an item on the wall line is not in the room', () => {
    const office = room('office', 0, 0, 10, 8);
    expect(itemInRoom(office, item('a', 4.9, 0))).toBe(true);
    expect(itemInRoom(office, item('b', 5, 0))).toBe(false);
  });
});
