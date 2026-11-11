import { describe, it, expect } from 'vitest';
import {
  groupMembers, groupCentre, groupMoves, groupTurn, copyItems, pasteOffset, pasteItems, lockedNote,
} from '../group';

const item = (id, x, z, extra = {}) => ({
  id, assetType: 'DESK_STANDARD', floor: 0, x, y: 0, z, rotationY: 0, rotationX: 0, rotationZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, label: '', roomId: 'r1', metadata: {}, ...extra,
});

const desk = item('desk', 0, 0);
const chair = item('chair', 0, 0.7, { assetType: 'CHAIR_OFFICE' });
const monitor = item('mon', 0, 0, { assetType: 'MONITOR_DUAL', y: 0.75 });
const plant = item('plant', 4, 2, { assetType: 'PLANT_LARGE' });
const lockedSofa = item('sofa', -3, 1, { assetType: 'SOFA_3SEAT', isLocked: true });
const objects = { desk, chair, mon: monitor, plant, sofa: lockedSofa };
const carried = (o) => (o.id === 'desk' ? [{ item: chair, onTop: false }, { item: monitor, onTop: true }] : []);

describe('groupMembers', () => {
  it('takes the unlocked items and what they carry, once each; counts the locked', () => {
    const { items, locked } = groupMembers(objects, ['desk', 'plant', 'sofa', 'chair'], carried);
    expect(items.map((m) => m.item.id)).toEqual(['desk', 'plant', 'chair', 'mon']);
    expect(items.find((m) => m.item.id === 'chair').selected).toBe(true);
    expect(items.find((m) => m.item.id === 'mon')).toMatchObject({ selected: false, onTop: true });
    expect(locked.map((o) => o.id)).toEqual(['sofa']);
  });
  it('a locked chair stays when its desk moves', () => {
    const lockedChair = { ...chair, isLocked: true };
    const { items } = groupMembers({ ...objects, chair: lockedChair }, ['desk'], () => [{ item: lockedChair }]);
    expect(items.map((m) => m.item.id)).toEqual(['desk']);
  });
});

describe('groupMoves and groupTurn', () => {
  it('moves every member by the same amount', () => {
    const { items } = groupMembers(objects, ['desk', 'plant'], carried);
    const moves = Object.fromEntries(groupMoves(items, 1, -0.5));
    expect(moves.desk).toEqual({ x: 1, z: -0.5 });
    expect(moves.chair).toEqual({ x: 1, z: 0.2 });
    expect(moves.plant).toEqual({ x: 5, z: 1.5 });
  });
  it('turns about the middle of the selected items, each item turned as much', () => {
    expect(groupCentre([desk, plant])).toEqual({ x: 2, z: 1 });
    const { items } = groupMembers(objects, ['desk', 'plant'], carried);
    const turn = Object.fromEntries(groupTurn(items, Math.PI / 2));
    // (x, z) − (2, 1) turned a quarter (Babylon's rotationY): (ox, oz) → (oz, −ox)
    expect(turn.desk).toEqual({ x: 1, z: 3, rotationY: Math.PI / 2 });
    expect(turn.plant).toEqual({ x: 3, z: -1, rotationY: Math.PI / 2 });
    // the chair keeps its place at the desk: 0.7 m along the desk's turned +Z
    expect(turn.chair.x - turn.desk.x).toBeCloseTo(0.7);
    expect(turn.chair.z - turn.desk.z).toBeCloseTo(0);
  });
  it('four quarter turns bring the group back', () => {
    let state = { ...objects };
    for (let i = 0; i < 4; i += 1) {
      const { items } = groupMembers(state, ['desk', 'plant'], (o) => (o.id === 'desk' ? [{ item: state.chair }] : []));
      for (const [id, p] of groupTurn(items, Math.PI / 2)) state = { ...state, [id]: { ...state[id], ...p } };
    }
    expect(state.desk.x).toBeCloseTo(0);
    expect(state.plant.z).toBeCloseTo(2);
    expect(state.chair.z).toBeCloseTo(0.7);
  });
});

describe('copy and paste', () => {
  it('copies the selection with its chair and monitor, no ids, no room', () => {
    const clip = copyItems(objects, ['desk'], carried);
    expect(clip.items.map((d) => d.assetType)).toEqual(['DESK_STANDARD', 'CHAIR_OFFICE', 'MONITOR_DUAL']);
    expect(clip.items.every((d) => !('id' in d) && !('roomId' in d) && !('isSelected' in d))).toBe(true);
    expect(clip.centre).toEqual({ x: 0, z: 0 });
    expect(clip.floor).toBe(0);
    expect(copyItems(objects, ['nope'])).toBeNull();
  });
  it('locked items are copied too (copying moves nothing)', () => {
    expect(copyItems(objects, ['sofa']).items).toHaveLength(1);
  });
  it('pastes with new ids, on the floor asked, in the room it lands in', () => {
    const clip = copyItems(objects, ['desk', 'plant'], carried);
    let n = 0;
    const added = pasteItems(clip, {
      floor: 1, offset: pasteOffset(clip, { same: true }), newId: () => `obj_new${++n}`,
      roomAt: (x) => (x > 3 ? 'room-east' : null),
    });
    expect(added.map((o) => o.id)).toEqual(['obj_new1', 'obj_new2', 'obj_new3', 'obj_new4']);
    expect(added.every((o) => o.floor === 1)).toBe(true);
    expect(added.find((o) => o.assetType === 'PLANT_LARGE')).toMatchObject({ x: 4, z: 2, roomId: 'room-east' });
    expect(added.find((o) => o.assetType === 'MONITOR_DUAL').y).toBe(0.75); // still on the desk
    // pasted data never shares an object with the original
    added[0].metadata.x = 1;
    expect(desk.metadata.x).toBeUndefined();
  });
  it('lands at the mouse, at the same spot, or 0.5 m aside', () => {
    const clip = copyItems(objects, ['desk', 'plant'], carried); // middle (2, 1)
    expect(pasteOffset(clip, { at: { x: 10, z: 10 } })).toEqual({ x: 8, z: 9 });
    expect(pasteOffset(clip, { same: true })).toEqual({ x: 0, z: 0 });
    expect(pasteOffset(clip)).toEqual({ x: 0.5, z: 0.5 });
    expect(pasteOffset(clip, { times: 3 })).toEqual({ x: 1.5, z: 1.5 });
    expect(pasteOffset(clip, { at: { x: NaN, z: 0 } })).toEqual({ x: 0.5, z: 0.5 });
  });
});

describe('lockedNote', () => {
  it('says how many locked items stayed', () => {
    expect(lockedNote(0)).toBeNull();
    expect(lockedNote(1)).toBe('1 locked item was not moved');
    expect(lockedNote(2, 'deleted')).toBe('2 locked items were not deleted');
  });
});
