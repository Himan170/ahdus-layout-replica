import { describe, it, expect } from 'vitest';
import {
  planRoom, planOpening, planRemoveOpening, wallSegmentData, resizeItem,
  WALL_THICKNESS, DOOR_DEFAULTS, WINDOW_DEFAULTS, MAX_ITEM_SCALE,
} from '../geometry';
import { placementHeight, STOREY_HEIGHT } from '../building';

// Office: x -3..3, z -2.5..2.5
const office = (extra = {}) => ({
  id: 'office', name: 'Office', floor: 0, x: 0, z: 0, width: 6, depth: 5, doors: [], windows: [], ...extra,
});
// Meeting room back-to-back on the office's east side: x 3.15..7.15
const meeting = () => ({
  id: 'meeting', name: 'Meeting', floor: 0, x: 5.15, z: 0, width: 4, depth: 5, doors: [], windows: [],
});

describe('planRoom (Build mode clicks and planner drags)', () => {
  it('two corners make the room rectangle', () => {
    const { rect, blocker } = planRoom({ x: 0, z: 0 }, { x: 6, z: 4 }, []);
    expect(rect).toEqual({ x: 3, z: 2, width: 6, depth: 4 });
    expect(blocker).toBeNull();
  });
  it('snaps back-to-back onto a neighbour', () => {
    const { rect } = planRoom({ x: 3.1, z: -2 }, { x: 7, z: 2 }, [office()]);
    expect(rect.x - rect.width / 2).toBeCloseTo(3 + WALL_THICKNESS);
  });
  it('reports the room it would overlap', () => {
    const { blocker } = planRoom({ x: 1, z: 1 }, { x: 5, z: 5 }, [office()]);
    expect(blocker?.id).toBe('office');
  });
});

describe('planOpening', () => {
  it('a door aimed at a wall is ready for addOpenings', () => {
    const plan = planOpening([office()], office(), 'south', { x: 1, z: -2.5 }, 'door');
    expect(plan.problem).toBeNull();
    expect(plan.list).toEqual([{ roomId: 'office', kind: 'door', wall: 'south', offset: 1, width: DOOR_DEFAULTS.width, height: DOOR_DEFAULTS.height }]);
  });
  it('a door on a shared wall cuts both rooms', () => {
    const rooms = [office(), meeting()];
    const plan = planOpening(rooms, office(), 'east', { x: 3, z: 1 }, 'door');
    expect(plan.problem).toBeNull();
    expect(plan.list.map((o) => [o.roomId, o.wall])).toEqual([['office', 'east'], ['meeting', 'west']]);
  });
  it('windows keep their sill; a too-low wall refuses them', () => {
    const plan = planOpening([office()], office(), 'north', { x: 0, z: 2.5 }, 'window');
    expect(plan.list[0].sill).toBe(WINDOW_DEFAULTS.sill);
    const low = office({ wallHeight: 1.5 });
    expect(planOpening([low], low, 'north', { x: 0, z: 2.5 }, 'window').problem).toMatch(/too low/);
  });
  it('refuses to overlap an existing door', () => {
    const r = office({ doors: [{ wall: 'south', offset: 0, width: 1 }] });
    expect(planOpening([r], r, 'south', { x: 0.2, z: -2.5 }, 'door').problem).toMatch(/Too close/);
  });
});

describe('planRemoveOpening', () => {
  it('removes the matching door in the neighbour too', () => {
    const o = office({ doors: [{ wall: 'east', offset: 1, width: 1 }] });
    const m = { ...meeting(), doors: [{ wall: 'west', offset: 1, width: 1 }] };
    expect(planRemoveOpening([o, m], o, 'east', { x: 3, z: 1 }, 'door', 0)).toEqual([
      { roomId: 'office', kind: 'door', index: 0 },
      { roomId: 'meeting', kind: 'door', index: 0 },
    ]);
  });
  it('only this room when there is no neighbour', () => {
    expect(planRemoveOpening([office()], office(), 'south', { x: 0, z: -2.5 }, 'window', 2))
      .toEqual([{ roomId: 'office', kind: 'window', index: 2 }]);
  });
});

describe('wallSegmentData', () => {
  it('a free-standing wall between two points, in the room it stands in', () => {
    const { data, length } = wallSegmentData({ x: -1, z: 0 }, { x: 2, z: 0 }, [office()]);
    expect(length).toBeCloseTo(3);
    expect(data).toMatchObject({ assetType: 'WALL_SEGMENT', x: 0.5, y: 0, z: 0, scaleX: 1, roomId: 'office', label: 'Wall 3.0 m' });
  });
});

describe('resizeItem (Edit item tool, + / −)', () => {
  it('keeps the proportions', () => {
    expect(resizeItem({ scaleX: 2, scaleY: 1, scaleZ: 1 }, 1.5)).toEqual({ scaleX: 3, scaleY: 1.5, scaleZ: 1.5 });
  });
  it('defaults missing scales to 1', () => {
    expect(resizeItem({}, 0.5)).toEqual({ scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 });
  });
  it('stops at the size limits', () => {
    expect(resizeItem({ scaleX: MAX_ITEM_SCALE }, 1.1)).toBeNull();
    expect(resizeItem({ scaleY: 0.2 }, 0.9)).toBeNull();
  });
});

describe('placementHeight (furniture on floors and table tops)', () => {
  it('on the ground floor the item stands on the room floor', () => {
    expect(placementHeight({ surface: 'floor', pointY: 0.02, elevation: 0 })).toEqual({ worldY: 0.02, y: 0.02, onTop: false });
    expect(placementHeight({ surface: 'ground' }).worldY).toBe(0);
  });
  it('on an upper floor the stored height is relative to that floor', () => {
    const h = placementHeight({ surface: 'floor', elevation: STOREY_HEIGHT });
    expect(h.worldY).toBeCloseTo(STOREY_HEIGHT + 0.02);
    expect(h.y).toBeCloseTo(0.02);
  });
  it('on top of a desk it stacks at the desk top', () => {
    const h = placementHeight({ surface: 'object', normalY: 1, pointY: STOREY_HEIGHT + 0.75, elevation: STOREY_HEIGHT });
    expect(h.onTop).toBe(true);
    expect(h.y).toBeCloseTo(0.75);
  });
  it('the side of furniture is not a place', () => {
    expect(placementHeight({ surface: 'object', normalY: 0.1, pointY: 0.4 })).toBeNull();
  });
});
