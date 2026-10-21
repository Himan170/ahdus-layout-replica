import { describe, it, expect } from 'vitest';
import {
  planRoom, planRoomMove, planRoomResize, planOpening, planRemoveOpening, wallSegmentData, resizeItem,
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

  it('allows a meeting room fully inside an office without snapping it outside', () => {
    const outer = { ...office(), width: 12, depth: 10 };
    const { rect, blocker } = planRoom({ x: -2, z: -1.5 }, { x: 2, z: 1.5 }, [outer]);
    expect(rect).toEqual({ x: 0, z: 0, width: 4, depth: 3 });
    expect(blocker).toBeNull();
  });

  it('allows multiple fully-contained rooms but still blocks overlapping inner rooms', () => {
    const outer = { ...office(), width: 12, depth: 10 };
    const first = { id: 'meeting-1', floor: 0, x: -3, z: 0, width: 3, depth: 3 };
    const second = planRoom({ x: 1.5, z: -1.5 }, { x: 4.5, z: 1.5 }, [outer, first]);
    expect(second.blocker).toBeNull();

    const overlapping = planRoom({ x: -2, z: -1.5 }, { x: 2, z: 1.5 }, [
      outer,
      { id: 'cabin', floor: 0, x: 0, z: 0, width: 3, depth: 2 },
    ]);
    expect(overlapping.blocker?.id).toBe('cabin');
  });

  it('a room drawn up to the outer wall stands on it; one sticking out further is blocked', () => {
    const outer = { ...office(), width: 12, depth: 10 };   // x -6..6
    const nearWall = planRoom({ x: 1.85, z: -1.5 }, { x: 5.85, z: 1.5 }, [outer]);
    expect(nearWall.blocker).toBeNull();
    expect(nearWall.rect.x + nearWall.rect.width / 2).toBeCloseTo(6); // on the outer wall's line

    const clear = planRoom({ x: 1.5, z: -1.5 }, { x: 5.5, z: 1.5 }, [outer]); // 0.5 m in: stays
    expect(clear.rect.x + clear.rect.width / 2).toBeCloseTo(5.5);
    expect(clear.blocker).toBeNull();

    const tooFar = planRoom({ x: 2.5, z: -1.5 }, { x: 6.5, z: 1.5 }, [outer]);
    expect(tooFar.blocker?.id).toBe(outer.id);
    expect(tooFar.rect.x).toBeCloseTo(4.5);
  });

  it('does not snap a boundary-crossing nested attempt to the office exterior', () => {
    const outer = { ...office(), width: 12, depth: 10 };
    const plan = planRoom({ x: 5.8, z: -1 }, { x: 7.3, z: 1 }, [outer]);
    expect(plan.rect).toEqual({ x: 6.55, z: 0, width: 1.5, depth: 2 });
    expect(plan.blocker?.id).toBe(outer.id);
  });

  it('validates nesting on upper floors without blocking against rooms on other floors', () => {
    const upstairs = { ...office(), floor: 1, width: 12, depth: 10 };
    const groundRoom = { ...office(), id: 'ground', floor: 0, width: 12, depth: 10 };
    const rooms = [upstairs, groundRoom];
    const inside = planRoom({ x: -2, z: -1.5 }, { x: 2, z: 1.5 }, rooms);
    expect(inside.rect).toEqual({ x: 0, z: 0, width: 4, depth: 3 });
    expect(inside.blocker).toBeNull();

    const outside = planRoom({ x: 2.5, z: -1.5 }, { x: 6.5, z: 1.5 }, rooms);
    expect(outside.blocker?.id).toBe('office');
  });
});

describe('planRoomMove', () => {
  const outer = { id: 'office', name: 'Office', floor: 0, x: 0, z: 0, width: 12, depth: 10 };
  const meeting = { id: 'meeting', name: 'Meeting', floor: 0, x: 0, z: 0, width: 3, depth: 3 };

  it('moves a nested room inside its enclosing room', () => {
    expect(planRoomMove(meeting, 2, 1, [outer, meeting])).toEqual({
      rect: { x: 2, z: 1, width: 3, depth: 3 },
      blocker: null,
    });
  });

  it('prevents moving a nested room beyond its enclosing room', () => {
    const plan = planRoomMove(meeting, 6, 0, [outer, meeting]);
    expect(plan.rect).toEqual({ x: 6, z: 0, width: 3, depth: 3 });
    expect(plan.blocker?.id).toBe('office');
  });

  it('still rejects overlap with another inner room', () => {
    const cabin = { id: 'cabin', name: 'Cabin', floor: 0, x: 3, z: 0, width: 3, depth: 3 };
    expect(planRoomMove(meeting, 2.5, 0, [outer, meeting, cabin]).blocker?.id).toBe('cabin');
  });
});

describe('planRoomResize', () => {
  const outer = { id: 'office', name: 'Office', floor: 0, x: 0, z: 0, width: 12, depth: 10 };
  const meeting = { id: 'meeting', name: 'Meeting', floor: 0, x: 0, z: 0, width: 3, depth: 3 };

  it('allows a nested room resize that remains inside the usable boundary', () => {
    expect(planRoomResize(meeting, 5, 4, [outer, meeting]).blocker).toBeNull();
  });

  it('rejects a nested room resize that crosses the enclosing wall', () => {
    expect(planRoomResize(meeting, 13, 3, [outer, meeting]).blocker?.id).toBe('office');
  });

  it('a resize that ends near the outer walls makes the room stand on them (wall to wall)', () => {
    const plan = planRoomResize(meeting, 11.8, 3, [outer, meeting]);
    expect(plan.blocker).toBeNull();
    expect(plan.rect).toEqual({ x: 0, z: 0, width: 12, depth: 3 });
  });

  it('keeps children inside when resizing their enclosing room', () => {
    const cabin = { id: 'cabin', name: 'Cabin', floor: 0, x: 3, z: 0, width: 3, depth: 3 };
    expect(planRoomResize(outer, 10, 10, [outer, cabin]).blocker).toBeNull();
    expect(planRoomResize(outer, 6, 10, [outer, cabin]).blocker?.id).toBe('cabin');
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
