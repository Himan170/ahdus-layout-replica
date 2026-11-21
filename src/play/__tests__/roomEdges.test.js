// v0.18.7 (Astra audit 3c): resizing a room by one edge (Plan view and 2D): the opposite wall stays put.
import { describe, expect, it } from 'vitest';
import {
  edgeMidpoint, edgeLength, edgeCoordinate, edgeTargetFor, parseLength, edgeTargetAt, edgeResize, edgeResizeTo, handleAt, lengthText, roundMm,
} from '../roomEdges';

const room = (more = {}) => ({
  id: 'a', name: 'Office', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 6, depth: 4, wallHeight: 3.2,
  doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [], ...more,
});

describe('one edge of a room (v0.18.7)', () => {
  it('handles in the middle of each edge; the length each one changes', () => {
    const r = room();
    expect(edgeMidpoint(r, 'east')).toEqual({ x: 3, z: 0 });
    expect(edgeMidpoint(r, 'north')).toEqual({ x: 0, z: 2 });
    expect(edgeLength(r, 'west')).toBe(6);
    expect(edgeLength(r, 'south')).toBe(4);
    expect(edgeCoordinate(r, 'west')).toBe(-3);
    expect(edgeCoordinate(r, 'north')).toBe(2);
  });

  it('dragging the east edge: the west wall stays where it was', () => {
    const r = room();
    const res = edgeResize(r, 'east', 5, { rooms: [r] });
    expect(res.problem).toBeNull();
    expect(res.rect.x - res.rect.width / 2).toBeCloseTo(-3); // the west wall
    expect(res.rect.width).toBeCloseTo(8);
    expect(res.length).toBeCloseTo(8);
  });

  it('typing a length: the moving edge goes there, the opposite one stays, kept to the millimetre', () => {
    const r = room({ x: 1.1, z: 0.35 });
    const res = edgeResizeTo(r, 'west', 6.65, { rooms: [r] });
    expect(res.rect.width).toBe(6.65); // not 6.6499999999999995
    expect(roundMm(res.rect.x + res.rect.width / 2)).toBe(4.1); // the east wall
    const n = edgeResizeTo(r, 'north', 2.5, { rooms: [r] });
    expect(n.rect.depth).toBe(2.5);
    expect(roundMm(n.rect.z - n.rect.depth / 2)).toBe(-1.65); // the south wall
    expect(edgeTargetFor(r, 'south', 2.5)).toBeCloseTo(2.35 - 2.5);
  });

  it('the same rules as the wall drag: too small and overlaps are refused with why', () => {
    const r = room();
    const other = room({ id: 'b', name: 'Store', x: 8, z: 0, width: 4, depth: 4, doors: [] });
    expect(edgeResizeTo(r, 'east', 1, { rooms: [r] }).problem).toMatch(/Too small/);
    expect(edgeResizeTo(r, 'east', 10, { rooms: [r, other] }).problem).toMatch(/Would overlap Store/);
  });

  it('typed lengths: "6.4", "6,4", "6.4 m"; nonsense is none', () => {
    expect(parseLength('6.4')).toBe(6.4);
    expect(parseLength('6,4')).toBe(6.4);
    expect(parseLength(' 6.4 m ')).toBe(6.4);
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('-2')).toBeNull();
    expect(parseLength('')).toBeNull();
  });

  it('a pointer drags the edge along its own axis, on the grid step', () => {
    expect(edgeTargetAt('east', { x: 4.37, z: 9 }, { step: 0.5 })).toBe(4.5);
    expect(edgeTargetAt('north', { x: 4.37, z: 1.12 })).toBe(1.12);
  });

  it('the handle under the mouse (within 12 px), the nearest of two', () => {
    const r = room();
    const project = (x, z) => ({ x: 100 + x * 10, y: 100 - z * 10 }); // 10 px a metre, north up
    expect(handleAt(r, { x: 131, y: 101 }, project)).toBe('east');
    expect(handleAt(r, { x: 100, y: 78 }, project)).toBe('north');
    expect(handleAt(r, { x: 100, y: 100 }, project)).toBeNull();
    expect(lengthText(6.4)).toBe('6.40 m');
  });
});
