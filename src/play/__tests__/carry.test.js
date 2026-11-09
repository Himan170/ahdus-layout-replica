// What an item takes along when it moves or turns (v0.15.1): a desk its chair and what stands on it.
import { describe, expect, it } from 'vitest';
import { carriedBy, carryMoves, carryDrop } from '../carry';
import { ridersOf } from '../../utils/itemRiders';
import { deskSeat } from '../people';

const desk = { id: 'desk', assetType: 'DESK_STANDARD', x: 2, z: 3, rotationY: 0, floor: 0 };
// in front of the desk's work side (+Z), facing it
const chair = { id: 'chair', assetType: 'CHAIR_OFFICE', x: 2, z: 3.7, rotationY: Math.PI, floor: 0 };
const monitor = { id: 'mon', assetType: 'MONITOR', x: 2.2, z: 2.9, y: 0.75, rotationY: 0, floor: 0 };
const far = { id: 'far', assetType: 'CHAIR_OFFICE', x: 9, z: 9, rotationY: 0, floor: 0 };

const apply = (objects, moves) => {
  const byId = Object.fromEntries(objects.map((o) => [o.id, { ...o }]));
  for (const [id, patch] of moves) Object.assign(byId[id], patch);
  return byId;
};

describe('carriedBy', () => {
  it('a desk takes its chair (the people-at-desks pairing) and what stands on it', () => {
    const got = carriedBy(desk, [desk, chair, monitor, far], [monitor]);
    expect(got.map((c) => [c.item.id, c.onTop])).toEqual([['mon', true], ['chair', false]]);
  });

  it('a locked chair, a chair on another floor and a chair that faces away stay', () => {
    expect(carriedBy(desk, [desk, { ...chair, isLocked: true }])).toEqual([]);
    expect(carriedBy(desk, [desk, { ...chair, floor: 1 }])).toEqual([]);
    expect(carriedBy(desk, [desk, { ...chair, rotationY: 0 }])).toEqual([]);
  });

  it('a chair or a table carries only what stands on it; nothing twice', () => {
    expect(carriedBy(chair, [desk, chair])).toEqual([]);
    const table = { id: 't', assetType: 'TABLE_MEETING', x: 0, z: 0, floor: 0 };
    expect(carriedBy(table, [table, monitor], [monitor, monitor]).map((c) => c.item.id)).toEqual(['mon']);
  });
});

describe('carryMoves', () => {
  it('a move: the chair and the monitor keep their place at the desk', () => {
    const moves = carryMoves(desk, carriedBy(desk, [desk, chair, monitor], [monitor]), { x: 5, z: 1 });
    expect(moves[0]).toEqual(['desk', { x: 5, z: 1 }]);
    const after = apply([desk, chair, monitor], moves);
    expect(after.chair).toMatchObject({ x: 5, z: 1.7, rotationY: Math.PI });
    expect(after.mon).toMatchObject({ x: 5.2, z: 0.9, y: 0.75 });
  });

  it('a quarter turn swings the chair around the desk, and it still belongs to it', () => {
    const moves = carryMoves(desk, carriedBy(desk, [desk, chair]), { rotationY: Math.PI / 2 });
    const after = apply([desk, chair], moves);
    expect(after.desk).toMatchObject({ x: 2, z: 3, rotationY: Math.PI / 2 });
    expect(after.chair.x).toBeCloseTo(2.7);
    expect(after.chair.z).toBeCloseTo(3);
    expect(after.chair.rotationY).toBeCloseTo(Math.PI * 1.5);
    expect(deskSeat(after.desk, Object.values(after))?.id).toBe('chair');
  });

  it('15° turns and a move together; four quarter turns come back to the start', () => {
    let state = { desk, chair };
    for (let i = 0; i < 4; i++) {
      const d = state.desk;
      state = apply(Object.values(state), carryMoves(d, [state.chair], { rotationY: d.rotationY + Math.PI / 2 }));
    }
    expect(state.chair.x).toBeCloseTo(chair.x);
    expect(state.chair.z).toBeCloseTo(chair.z);
    const turned = apply([desk, chair], carryMoves(desk, [chair], { x: 4, z: 3, rotationY: Math.PI / 12 }));
    expect(Math.hypot(turned.chair.x - 4, turned.chair.z - 3)).toBeCloseTo(0.7);
    expect(deskSeat(turned.desk, Object.values(turned))?.id).toBe('chair');
  });

  it('no turn: no rotationY in the patches (only what changed)', () => {
    const moves = carryMoves(desk, [chair], { x: 3 });
    expect(moves.every(([, p]) => !('rotationY' in p))).toBe(true);
  });
});

describe('carryDrop: putting a desk down in Walk through with what goes with it (v0.15.2)', () => {
  const d = { ...desk, y: 0.02 };
  const c = { ...chair, y: 0.02 };
  const carried = carriedBy(d, [d, c, monitor], [monitor]);

  it('the desk, its chair and its monitor in one list: the chair keeps its place and its height', () => {
    const moves = carryDrop(d, carried, { x: 6, y: 0.02, z: -1, rotationY: 0 }, { floor: 0 });
    expect(moves.map(([id]) => id)).toEqual(['desk', 'mon', 'chair']);
    const after = apply([d, c, monitor], moves);
    expect(after.desk).toMatchObject({ x: 6, y: 0.02, z: -1, rotationY: 0, floor: 0 });
    expect(after.chair).toMatchObject({ x: 6, z: -0.3, y: 0.02, floor: 0 });
    expect(after.mon).toMatchObject({ x: 6.2, z: -1.1, y: 0.75 });
    expect(deskSeat(after.desk, Object.values(after))?.id).toBe('chair');
  });

  it('turned while carried (R): the chair swings round the desk and still belongs to it', () => {
    const after = apply([d, c, monitor], carryDrop(d, carried, { x: 6, y: 0.02, z: -1, rotationY: Math.PI / 2 }));
    expect(after.desk.rotationY).toBeCloseTo(Math.PI / 2);
    expect(after.chair.x).toBeCloseTo(6.7);
    expect(after.chair.z).toBeCloseTo(-1);
    expect(deskSeat(after.desk, Object.values(after))?.id).toBe('chair');
  });

  it('what stands on it rises and sinks with it; its chair does not', () => {
    // from the room's floor (0.02) onto the ground outside (0)
    const after = apply([d, c, monitor], carryDrop(d, carried, { x: 30, y: 0, z: 0 }));
    expect(after.desk.y).toBe(0);
    expect(after.mon.y).toBeCloseTo(0.73);
    expect(after.chair.y).toBe(0.02);
  });

  it('an item alone: just itself, with its height and angle', () => {
    expect(carryDrop(far, [], { x: 1, y: 0.02, z: 2, rotationY: 1 })).toEqual([['far', { x: 1, z: 2, y: 0.02, rotationY: 1 }]]);
  });
});

describe('ridersOf: what stands on an item, from its mesh (Studio and Walk through)', () => {
  // a desk 1.6 × 0.8 m, 0.75 m high, on a floor whose elevation is 3.5 m
  const box = (x, z) => ({
    position: { x, z },
    getHierarchyBoundingVectors: () => ({ min: { x: x - 0.8, y: 3.5, z: z - 0.4 }, max: { x: x + 0.8, y: 4.25, z: z + 0.4 } }),
  });
  const up = { id: 'desk', assetType: 'DESK_STANDARD', x: 2, z: 3, y: 0, floor: 1 };
  const on = (more) => ({ id: 'm', assetType: 'MONITOR_DUAL', x: 2.2, z: 2.9, y: 0.75, floor: 1, ...more });

  it('an item with its foot at the top, inside the outline', () => {
    expect(ridersOf(up, box(2, 3), [up, on()], 3.5).map((o) => o.id)).toEqual(['m']);
  });

  it('not: beside it, on the floor, on another floor, locked, a wall, the stairs', () => {
    const none = [on({ x: 4 }), on({ y: 0.02 }), on({ floor: 0 }), on({ isLocked: true }),
      on({ assetType: 'WALL_SEGMENT' }), on({ assetType: 'STAIRCASE' })];
    for (const o of none) expect(ridersOf(up, box(2, 3), [up, o], 3.5)).toEqual([]);
  });

  it('a mesh already dragged away still finds what stood on it (the outline is moved back)', () => {
    expect(ridersOf(up, box(7, 9), [up, on()], 3.5).map((o) => o.id)).toEqual(['m']);
  });

  it('no mesh: nothing', () => {
    expect(ridersOf(up, null, [up, on()], 3.5)).toEqual([]);
  });
});

describe('R turns (v0.15.1)', () => {
  it('R = 90°, Shift+R = 15°', async () => {
    const { turnStep, turnText } = await import('../carry');
    expect(turnStep()).toBeCloseTo(Math.PI / 2);
    expect(turnStep(true)).toBeCloseTo(Math.PI / 12);
    expect([turnText(), turnText(true)]).toEqual(['90°', '15°']);
  });
});
