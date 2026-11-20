// v0.18.3: L-shaped stairs (building.js stairParts / stairEnds / stairRects / stairOpenings): what is walked on,
// what blocks, where they arrive, routes over them and the fit check. A straight flight is unchanged (its tests).
import { describe, it, expect } from 'vitest';
import {
  stairShape, stairSize, stairParts, stairEnds, stairRects, stairOpenings, stairTop, stairHeightAt, stairDimsFor,
  stairPushOut, supportHeight, stairDims, L_STAIR, STEP_UP, rectContains,
} from '../building';
import { findRoute, floorLinks, stairBottom } from '../navigation/route';
import { createWalkMapCache, STAIRS as STAIRS_CELL } from '../navigation/walkMap';
import { stairFit } from '../stairFit';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const stair = (shape, extra = {}) => ({
  id: 's1', assetType: 'STAIRCASE', floor: 0, x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1, metadata: shape ? { stairShape: shape } : undefined, ...extra,
});
const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
const hall = (floor) => ({
  id: `hall_${floor}`, name: floor ? 'Upstairs' : 'Hall', type: 'OFFICE', floor, x: 0, z: 0, width: 14, depth: 12, wallHeight: 3.2,
  doors: floor === 0 ? [{ wall: 'south', offset: 4, width: 1.2, height: 2.1 }] : [], windows: [],
});
const layoutWith = (s) => ({ rooms: { hall_0: hall(0), hall_1: hall(1) }, objects: { s1: s }, floors });
const close = (p, q, d = 1e-6) => Math.hypot(p.x - q.x, p.z - q.z) < d;

describe('L-shaped stairs (v0.18.3)', () => {
  it('no shape (every old save) = straight; an L is 3.2 × 3.2 m whatever its saved scale', () => {
    expect(stairShape(stair())).toBe('straight');
    expect(stairShape(stair('U-turn'))).toBe('straight');
    expect(stairShape(stair('L-left'))).toBe('L-left');
    expect(stairSize(stair('L-right', { scaleX: 2, scaleZ: 2 }))).toEqual({ width: L_STAIR.width, length: L_STAIR.length });
    expect(stairParts(stair(), stairDims(3.5))).toHaveLength(1);
  });

  it('half the steps, a landing, the rest: every step at most one riser up, ending at the floor above', () => {
    for (const shape of ['L-right', 'L-left']) {
      const s = stair(shape);
      const dims = stairDimsFor(floors, s);
      const [first, landing, second] = stairParts(s, dims);
      expect(first.steps + second.steps).toBe(dims.steps);
      expect(landing.h0).toBeCloseTo(first.h1);
      expect(second.h1).toBeCloseTo(dims.rise);
      // walk the line: bottom → landing → top, every 2 cm
      const { bottom, top } = stairEnds(s, dims);
      const mid = { x: (landing.x0 + landing.x1) / 2, z: (landing.z0 + landing.z1) / 2 };
      const line = [];
      for (let t = 0.01; t <= 1; t += 0.01) line.push({ x: bottom.x + (mid.x - bottom.x) * t, z: bottom.z + (mid.z - bottom.z) * t });
      for (let t = 0; t <= 0.99; t += 0.01) line.push({ x: mid.x + (top.x - mid.x) * t, z: mid.z + (top.z - mid.z) * t });
      let last = 0;
      for (const p of line) {
        const h = stairHeightAt(s, p.x, p.z, dims);
        expect(h, `${shape} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).not.toBeNull();
        expect(h - last).toBeLessThanOrEqual(dims.rise / dims.steps + 1e-9);
        expect(h).toBeGreaterThanOrEqual(last - 1e-9);
        last = h;
      }
      expect(last).toBeCloseTo(dims.rise);
    }
  });

  it('turned right: the bottom at −Z of its left column, the top on the +X side; left: mirrored', () => {
    const half = L_STAIR.width / 2;
    const f = L_STAIR.flight;
    const r = stairEnds(stair('L-right'));
    expect(close(r.bottom, { x: -half + f / 2, z: -half })).toBe(true);
    expect(close(r.top, { x: half, z: half - f / 2 })).toBe(true);
    expect(close(stairTop(stair('L-right')), { x: half + 0.6, z: half - f / 2 })).toBe(true);
    expect(close(stairTop(stair('L-left')), { x: -half - 0.6, z: half - f / 2 })).toBe(true);
    expect(close(stairBottom(stair('L-left')), { x: half - f / 2, z: -half - 0.6 })).toBe(true);
    // turned 90°: everything turns with it (local +Z = world +X)
    const t = stairTop(stair('L-right', { rotationY: Math.PI / 2 }));
    expect(close(t, { x: half - f / 2, z: -(half + 0.6) }, 1e-6)).toBe(true);
  });

  it('the corner the L leaves free is floor: no step there, no opening above it, nothing pushes you', () => {
    const s = stair('L-right');
    const corner = { x: 0.6, z: -0.6 }; // right of the first flight, under the second one's reach
    expect(stairHeightAt(s, corner.x, corner.z)).toBeNull();
    const holes = stairOpenings(s);
    expect(holes).toHaveLength(2);
    expect(holes.some((h) => rectContains(h, corner.x, corner.z))).toBe(false);
    expect(holes.some((h) => rectContains(h, -1, -1))).toBe(true); // over the first flight
    const rooms = Object.values(layoutWith(s).rooms);
    expect(stairPushOut({ x: corner.x, z: corner.z, y: 0, floors, rooms, stairs: [s] })).toBeNull();
    // upstairs the corner is floor to stand on; over the first flight it is the opening
    expect(supportHeight({ x: corner.x, z: corner.z, y: 3.6, floors, rooms, stairs: [s] })).toBeCloseTo(3.5, 1);
  });

  it('the second flight is a block from the side and from below (you step on only at its start)', () => {
    const s = stair('L-right');
    const rooms = Object.values(layoutWith(s).rooms);
    // standing on the floor, just in front (−Z) of the second flight's high end
    const out = stairPushOut({ x: 1.2, z: 0.2, y: 0, floors, rooms, stairs: [s] });
    expect(out).not.toBeNull();
    expect(out.dz).toBeLessThan(0); // pushed back out, away from the flight
    // on the bottom of the first flight: free to step on
    expect(stairPushOut({ x: -1.0, z: -1.7, y: 0, floors, rooms, stairs: [s] })).toBeNull();
    // standing on the landing (feet at its height) the second flight's first step is a step up, not a wall
    const landingY = stairHeightAt(s, -1.0, 1.0);
    expect(stairPushOut({ x: -0.3, z: 1.0, y: landingY, floors, rooms, stairs: [s] })).toBeNull();
    expect(stairHeightAt(s, -0.3, 1.0) - landingY).toBeLessThanOrEqual(STEP_UP);
  });

  it('the walk map: its two arms are STAIRS cells, the free corner is not', () => {
    const s = stair('L-right');
    const maps = createWalkMapCache({ catalog: ASSET_TYPES });
    const map = maps.get(layoutWith(s), 0);
    const at = (x, z) => map.cells[map.indexOf ? map.indexOf(x, z) : (Math.floor((z - map.z0) / map.cell) * map.cols + Math.floor((x - map.x0) / map.cell))];
    expect(at(-1.0, -0.5)).toBe(STAIRS_CELL);
    expect(at(1.0, 1.0)).toBe(STAIRS_CELL);
    expect(at(0.6, -0.8)).not.toBe(STAIRS_CELL);
    expect(stairRects(s)).toHaveLength(2);
  });

  it('routes climb it: in front of its bottom step, up through the landing, off at the side', () => {
    for (const shape of ['L-right', 'L-left']) {
      const s = stair(shape);
      const layout = layoutWith(s);
      const opts = { maps: createWalkMapCache({ catalog: ASSET_TYPES }) };
      const [link] = floorLinks(layout, opts);
      expect(link, shape).toMatchObject({ kind: 'stairs', objectId: 's1', from: { floor: 0 }, to: { floor: 1 } });
      expect(link.via).toHaveLength(3); // bottom, the landing's middle, top
      const r = findRoute(layout, { x: 4, z: -4, floor: 0 }, { x: 4, z: 4, floor: 1 }, opts);
      expect(r.problem, shape).toBeUndefined();
      expect(r.legs.map((l) => l.floor)).toEqual([0, 1]);
      const top = stairTop(s);
      const first = r.legs[1].points[0];
      expect(Math.hypot(first.x - top.x, first.z - top.z), shape).toBeLessThan(0.6);
    }
  });

  it('the fit check knows its turned top: in a big room it is fine; with a wall at the top it says so', () => {
    expect(stairFit(stair('L-right'), layoutWith(stair('L-right')), { catalog: ASSET_TYPES }).ok).toBe(true);
    // the walls upstairs leave 0.3 m past the L's +X side: no room to step off there
    const s = stair('L-right', { x: 5.0 }); // its +X side 0.3 m from the hall's wall (x 7)
    const layout = layoutWith(s);
    const fit = stairFit(s, layout, { catalog: ASSET_TYPES });
    expect(fit.problems.map((p) => p.code)).toContain('NO_LANDING');
    // a straight flight there has its top at +Z, nowhere near that wall
    const straight = { ...s, metadata: undefined };
    expect(stairFit(straight, layoutWith(straight), { catalog: ASSET_TYPES }).problems.map((p) => p.code)).not.toContain('NO_LANDING');
  });
});
