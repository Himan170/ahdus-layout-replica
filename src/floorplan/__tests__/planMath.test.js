import { describe, it, expect } from 'vitest';
import { itemSize, itemContains, planDrop } from '../planMath';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const desk = { id: 'desk', assetType: 'DESK_STANDARD', x: 0, y: 0, z: 0, rotationY: 0 };
const deskTop = ASSET_TYPES.DESK_STANDARD.defaultHeight;
const room = { id: 'r', x: 0, z: 0, width: 6, depth: 4 };

describe('planDrop: moving an item in the plan follows Studio\'s rules', () => {
  it('snaps to the snap step (and not when snapping is off)', () => {
    const chair = { id: 'c', assetType: 'CHAIR_OFFICE', x: 2, y: 0, z: 1 };
    expect(planDrop(chair, { x: 2.26, z: -1.2 }, { rooms: [room], snap: { enabled: true, step: 0.5 } }))
      .toMatchObject({ x: 2.5, z: -1 });
    expect(planDrop(chair, { x: 2.26, z: -1.2 }, { rooms: [room], snap: { enabled: false, step: 0.5 } }))
      .toMatchObject({ x: 2.26, z: -1.2 });
  });

  it('a locked item does not move', () => {
    expect(planDrop({ ...desk, isLocked: true }, { x: 1, z: 1 }, {})).toBeNull();
  });

  it('dropped on a desk it sits on the desk top; else on the floor (placementHeight)', () => {
    const laptop = { id: 'm', assetType: 'LAPTOP', x: 3, y: 0, z: 3 };
    expect(planDrop(laptop, { x: 0.1, z: 0 }, { objects: [desk, laptop], rooms: [room] }).y).toBeCloseTo(deskTop);
    expect(planDrop(laptop, { x: 2.5, z: 1.5 }, { objects: [desk, laptop], rooms: [room] }).y).toBeCloseTo(0.02);
  });

  it('on the ground floor, outside every room, it stands on the ground', () => {
    const chair = { id: 'c', assetType: 'CHAIR_OFFICE', x: 0, y: 0, z: 0 };
    expect(planDrop(chair, { x: 20, z: 20 }, { rooms: [room], ground: true }).y).toBe(0);
    expect(planDrop(chair, { x: 20, z: 20 }, { rooms: [room], ground: false }).y).toBeCloseTo(0.02);
  });

  it('never stacks an item on itself', () => {
    expect(planDrop(desk, { x: 0, z: 0 }, { objects: [desk], rooms: [room] }).y).toBeCloseTo(0.02);
  });
});

describe('item footprints', () => {
  it('size = catalogue size × scale', () => {
    const t = ASSET_TYPES.DESK_STANDARD;
    expect(itemSize({ ...desk, scaleX: 2 })).toEqual({ width: t.defaultWidth * 2, depth: t.defaultDepth, height: t.defaultHeight });
  });

  it('a turned item covers the turned rectangle', () => {
    const long = { ...desk, scaleX: 3 }; // about 4 m wide, 0.7 m deep
    const half = itemSize(long).width / 2 - 0.1;
    expect(itemContains(long, { x: half, z: 0 })).toBe(true);
    expect(itemContains(long, { x: 0, z: half })).toBe(false);
    const turned = { ...long, rotationY: Math.PI / 2 }; // local x along (0, −1)
    expect(itemContains(turned, { x: 0, z: -half })).toBe(true);
    expect(itemContains(turned, { x: half, z: 0 })).toBe(false);
  });
});
