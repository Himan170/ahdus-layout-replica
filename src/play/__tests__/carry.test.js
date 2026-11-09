// What an item takes along when it moves or turns (v0.15.1): a desk its chair and what stands on it.
import { describe, expect, it } from 'vitest';
import { carriedBy, carryMoves } from '../carry';
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
