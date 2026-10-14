import { describe, it, expect } from 'vitest';
import {
  resizeOpening, resetOpeningSize, openingData, openingPartner, formatOpeningSize,
  planOpening, roomOpenings, OPENING_LIMITS, WALL_THICKNESS,
} from '../geometry';

// A 6 × 4 m office with a door in the middle of its north wall (x = 0, z = 2)
const office = (extra = {}) => ({
  id: 'r1', name: 'Office', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3,
  doors: [{ wall: 'north', offset: 0, width: 1.0, height: 2.1 }],
  windows: [],
  ...extra,
});

describe('openingData', () => {
  it('fills in sizes old saves did not store', () => {
    const room = office({ doors: [{ wall: 'east' }], windows: [{ wall: 'south', offset: 1 }] });
    expect(openingData(room, 'door', 0)).toMatchObject({ wall: 'east', offset: 0, width: 1.0, height: 2.1, sill: 0 });
    expect(openingData(room, 'window', 0)).toMatchObject({ offset: 1, width: 1.4, height: 1.2, sill: 0.9 });
    expect(openingData(room, 'door', 3)).toBeNull();
  });

  it('formats the size for the hint', () => {
    expect(formatOpeningSize('door', 0.9, 2.1)).toBe('Door 0.9 × 2.1 m');
    expect(formatOpeningSize('window', 1.4, 1.2)).toBe('Window 1.4 × 1.2 m');
  });
});

describe('resizeOpening: width and height', () => {
  it('+0.1 m width keeps the centre', () => {
    const r = resizeOpening([office()], office(), 'door', 0, { width: 1.1 });
    expect(r.problem).toBeNull();
    expect(r.list).toEqual([{ roomId: 'r1', kind: 'door', index: 0, patch: { offset: 0, width: 1.1, height: 2.1 } }]);
  });

  it('a side drag keeps the other side where it is', () => {
    const r = resizeOpening([office()], office(), 'door', 0, { width: 1.4, keep: 'start' });
    // start edge stays at -0.5, so the centre moves to +0.2
    expect(r.list[0].patch).toEqual({ offset: 0.2, width: 1.4, height: 2.1 });
    const e = resizeOpening([office()], office(), 'door', 0, { width: 1.4, keep: 'end' });
    expect(e.list[0].patch.offset).toBeCloseTo(-0.2);
  });

  it('height changes and the old size is kept on a problem', () => {
    expect(resizeOpening([office()], office(), 'door', 0, { height: 2.4 }).list[0].patch.height).toBe(2.4);
    const tooTall = resizeOpening([office()], office(), 'door', 0, { height: 3.0 });
    expect(tooTall.problem).toBe('Doors can be at most 2.9 m high on this wall');
    expect(tooTall.list).toEqual([]);
    expect([tooTall.width, tooTall.height]).toEqual([1.0, 2.1]);
  });

  it('door height limit follows the wall height', () => {
    const low = office({ wallHeight: 2.5 });
    expect(resizeOpening([low], low, 'door', 0, { height: 2.4 }).problem).toBeNull();
    expect(resizeOpening([low], low, 'door', 0, { height: 2.5 }).problem).toMatch(/at most 2.4 m/);
  });

  it('minimum sizes: door 0.6 m wide, window 0.4 m wide', () => {
    expect(resizeOpening([office()], office(), 'door', 0, { width: 0.6 }).problem).toBeNull();
    expect(resizeOpening([office()], office(), 'door', 0, { width: 0.5 }).problem).toBe('Doors are at least 0.6 m wide');
    const win = office({ doors: [], windows: [{ wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] });
    expect(resizeOpening([win], win, 'window', 0, { width: 0.4 }).problem).toBeNull();
    expect(resizeOpening([win], win, 'window', 0, { width: 0.3 }).problem).toBe('Windows are at least 0.4 m wide');
    expect(OPENING_LIMITS.door.minWidth).toBe(0.6);
  });

  it('a window keeps its sill and may not reach the top of the wall', () => {
    const win = office({ doors: [], windows: [{ wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] });
    expect(resizeOpening([win], win, 'window', 0, { height: 2.0 }).problem).toBeNull(); // top 2.9
    expect(resizeOpening([win], win, 'window', 0, { height: 2.1 }).problem).toBe('The window would reach the top of the wall');
  });
});

describe('resizeOpening: limits along the wall', () => {
  it('stays 0.1 m from each corner', () => {
    // north wall is 6 m: at most 5.8 m wide when centred
    expect(resizeOpening([office()], office(), 'door', 0, { width: 5.8 }).problem).toBeNull();
    expect(resizeOpening([office()], office(), 'door', 0, { width: 5.9 }).problem).toBe('Too wide for this 6.0 m wall');
    const nearCorner = office({ doors: [{ wall: 'north', offset: 2.3, width: 1.0, height: 2.1 }] });
    // edge at 2.8 now; 2.9 is the limit
    expect(resizeOpening([nearCorner], nearCorner, 'door', 0, { width: 1.2 }).problem).toBeNull();
    expect(resizeOpening([nearCorner], nearCorner, 'door', 0, { width: 1.4 }).problem).toBe('Too close to the corner of the room');
  });

  it('never overlaps another door or window on the wall', () => {
    const room = office({ windows: [{ wall: 'north', offset: 1.8, width: 1.4, height: 1.2, sill: 0.9 }] });
    // window starts at 1.1; door end must stay ≤ 1.1 - 0.2 = 0.9
    expect(resizeOpening([room], room, 'door', 0, { width: 1.8 }).problem).toBeNull();
    expect(resizeOpening([room], room, 'door', 0, { width: 2.0 }).problem).toBe('Too close to the window next to it');
    // openings on other walls don't matter
    const other = office({ windows: [{ wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] });
    expect(resizeOpening([other], other, 'door', 0, { width: 3 }).problem).toBeNull();
  });

  it('never runs into stairs next to the wall (only stairs on the same floor)', () => {
    // a staircase along the north wall, east of the door: x 0.9..2.1 (rotated 90°), z 1.4..? no: use rotation 0
    // rotation 0: 1.2 wide along X, 4 long along Z. Centre x = 1.4 → x 0.8..2.0, z -2..2 (touches the wall)
    const stairs = [{ assetType: 'STAIRCASE', floor: 0, x: 1.4, z: 0, rotationY: 0 }];
    expect(resizeOpening([office()], office(), 'door', 0, { width: 1.4 }, { stairs }).problem).toBeNull();
    expect(resizeOpening([office()], office(), 'door', 0, { width: 1.8 }, { stairs }).problem).toBe('The stairs are in the way');
    const upstairs = [{ ...stairs[0], floor: 1 }];
    expect(resizeOpening([office()], office(), 'door', 0, { width: 1.8 }, { stairs: upstairs }).problem).toBeNull();
  });

  it('reset goes back to the standard size', () => {
    const big = office({ doors: [{ wall: 'north', offset: 0, width: 2.0, height: 2.6 }] });
    expect(resetOpeningSize([big], big, 'door', 0).list[0].patch).toEqual({ offset: 0, width: 1.0, height: 2.1 });
  });
});

describe('resizeOpening: a door shared by two back-to-back rooms', () => {
  // Office A (x -3..3, z -2..2) and office B behind its north wall (z 2.15..6.15)
  const a = { ...office(), doors: [] };
  const b = { id: 'r2', name: 'Meeting', floor: 0, x: 0, z: 4.15, width: 6, depth: 4, wallHeight: 3, doors: [], windows: [] };
  const plan = planOpening([a, b], a, 'north', { x: 1, z: 2 }, 'door');
  const withDoor = (room) => ({
    ...room,
    doors: plan.list.filter((o) => o.roomId === room.id).map(({ roomId: _r, kind: _k, ...o }) => o),
  });
  const A = withDoor(a);
  const B = withDoor(b);

  it('finds the other half', () => {
    expect(plan.partner?.room.id).toBe('r2');
    expect(openingPartner([A, B], A, 'door', 0)).toEqual({ room: B, index: 0 });
    expect(openingPartner([A, B], B, 'door', 0)).toEqual({ room: A, index: 0 });
  });

  it('resizes both halves together, from either side', () => {
    const r = resizeOpening([A, B], A, 'door', 0, { width: 1.3, height: 2.3, keep: 'start' });
    expect(r.problem).toBeNull();
    expect(r.list.map((o) => o.roomId)).toEqual(['r1', 'r2']);
    const [pa, pb] = r.list.map((o) => o.patch);
    expect(pa).toEqual(pb); // same room centre x, so same offset
    expect(pa).toMatchObject({ width: 1.3, height: 2.3 });
    expect(resizeOpening([A, B], B, 'door', 0, { width: 1.3 }).list).toHaveLength(2);
  });

  it('is blocked if it does not fit in the neighbour', () => {
    const lowB = { ...B, wallHeight: 2.5 };
    const r = resizeOpening([A, lowB], A, 'door', 0, { height: 2.6 });
    expect(r.problem).toBe('Doors can be at most 2.4 m high on this wall (in Meeting)');
    expect(r.list).toEqual([]);
  });
});

describe('the walls are rebuilt around the new size', () => {
  it('roomOpenings uses the stored width and height', () => {
    const room = office({ doors: [{ wall: 'north', offset: 0.2, width: 1.4, height: 2.4 }] });
    expect(roomOpenings(room)[0]).toMatchObject({ offset: 0.2, width: 1.4, bottom: 0, top: 2.4 });
    expect(WALL_THICKNESS).toBeGreaterThan(0);
  });
});
