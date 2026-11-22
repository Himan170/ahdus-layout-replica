import { describe, it, expect } from 'vitest';
import { pickCandidates, nextPick, isSameSpot, SAME_SPOT_PX, CYCLE_MS } from '../pickCycle';

const objects = {
  chair: { id: 'chair', assetType: 'CHAIR_OFFICE', floor: 0 },
  desk: { id: 'desk', assetType: 'DESK_STANDARD', floor: 0 },
  wseg: { id: 'wseg', assetType: 'WALL_SEGMENT', floor: 0 },
  up: { id: 'up', assetType: 'PLANT_LARGE', floor: 1 },
  far: { id: 'far', assetType: 'SOFA_3SEAT', floor: 0 },
};
const ids = (list) => list.map((c) => `${c.kind}:${c.id}`);

describe('pickCycle (v0.18.9): what a click selects', () => {
  it('furniture first, then a Wall-tool wall, then the room, whatever is nearest', () => {
    const hits = [{ roomId: 'office', part: 'wall', glass: true }, { objectId: 'wseg' }, { objectId: 'chair' }, { roomId: 'office', part: 'floor' }];
    expect(ids(pickCandidates(hits, objects))).toEqual(['object:chair', 'object:wseg', 'room:office']);
  });

  it('nothing behind a solid wall or under a floor; items of another floor are not there', () => {
    const behind = [{ objectId: 'chair' }, { roomId: 'office', part: 'wall' }, { objectId: 'far' }, { roomId: 'board', part: 'floor' }];
    expect(ids(pickCandidates(behind, objects))).toEqual(['object:chair', 'room:office', 'room:board']);
    const under = [{ roomId: 'office', part: 'floor' }, { objectId: 'far' }, { roomId: 'below', part: 'floor' }];
    expect(ids(pickCandidates(under, objects))).toEqual(['room:office']);
    expect(ids(pickCandidates([{ objectId: 'up' }, { ground: true }, { roomId: 'x', part: 'floor' }], objects))).toEqual([]);
    expect(ids(pickCandidates([{ objectId: 'up' }], objects, { floor: 1 }))).toEqual(['object:up']);
  });

  it('a click selects the first; a second click on the same spot the next one, round again', () => {
    const c = pickCandidates([{ objectId: 'chair' }, { roomId: 'office', part: 'floor' }], objects);
    expect(nextPick(c, null)).toEqual({ kind: 'object', id: 'chair' });
    // the room selected, a click on the chair in it: the chair (not the selected room)
    expect(nextPick(c, { kind: 'room', id: 'office' })).toEqual({ kind: 'object', id: 'chair' });
    expect(nextPick(c, { kind: 'object', id: 'chair' }, { sameSpot: true })).toEqual({ kind: 'room', id: 'office' });
    expect(nextPick(c, { kind: 'room', id: 'office' }, { sameSpot: true })).toEqual({ kind: 'object', id: 'chair' });
    expect(nextPick(c, { kind: 'object', id: 'desk' }, { sameSpot: true })).toEqual({ kind: 'object', id: 'chair' });
    expect(nextPick([], { kind: 'object', id: 'chair' }, { sameSpot: true })).toBeNull();
  });

  it('the same spot: a few pixels, not long after', () => {
    const last = { x: 100, y: 100, t: 1000 };
    expect(isSameSpot(last, { x: 100 + SAME_SPOT_PX - 1, y: 100, t: 1500 })).toBe(true);
    expect(isSameSpot(last, { x: 100 + SAME_SPOT_PX + 2, y: 100, t: 1500 })).toBe(false);
    expect(isSameSpot(last, { x: 100, y: 100, t: 1000 + CYCLE_MS + 1 })).toBe(false);
    expect(isSameSpot(null, { x: 100, y: 100, t: 1 })).toBe(false);
  });
});
