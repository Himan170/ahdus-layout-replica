// v0.18.7 (Astra audit 2c): a click on a big table walks to its edge, not "there's no room to stand there".
import { describe, expect, it } from 'vitest';
import { itemWalkGoal, edgeSpot, EDGE_GAP } from '../itemGoal';
import { findRoute } from '../route';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const hall = {
  id: 'hall', name: 'Hall', type: 'OFFICE', floor: 0, x: 0, z: 0, width: 36, depth: 24, wallHeight: 3.2, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [],
};
const table = (more = {}) => ({
  id: 'big', assetType: 'TABLE_MEETING', floor: 0, roomId: 'hall', x: 0, y: 0.02, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0,
  scaleX: 3, scaleY: 1, scaleZ: 3, ...more,
});
const layoutWith = (obj) => ({ rooms: [hall], objects: [obj], floors });

describe('a click on an item walks to its edge (v0.18.7)', () => {
  it('the audit: a 9.6 × 4.2 m table, the click 0.4 m from its middle: the old goal is refused, the edge is reached', () => {
    const obj = table();
    const from = { x: 0, z: -7, floor: 0 };
    // what the click used to ask for: the spot clicked (0.4 m back towards you)
    const old = findRoute(layoutWith(obj), from, { x: 0, z: -0.4, floor: 0 }, { catalog: ASSET_TYPES });
    expect(old.problem).toBe('GOAL_BLOCKED');
    const goal = itemWalkGoal(obj, { x: 0, z: -0.4 }, { catalog: ASSET_TYPES, towards: from });
    // the south edge (2.1 m from the middle), just outside it
    expect(goal.x).toBeCloseTo(0);
    expect(goal.z).toBeCloseTo(-2.1 - EDGE_GAP);
    const route = findRoute(layoutWith(obj), from, { ...goal, floor: 0 }, { catalog: ASSET_TYPES });
    expect(route.problem).toBeUndefined();
    expect(route.length).toBeGreaterThan(4);
  });

  it('two edges as near: the one facing the camera', () => {
    const r = { x: 0, z: 0, hw: 1, hd: 1, rot: 0 };
    expect(edgeSpot(r, { x: 0, z: 0 }, { towards: { x: 0, z: 9 } }).z).toBeCloseTo(1 + EDGE_GAP);
    expect(edgeSpot(r, { x: 0, z: 0 }, { towards: { x: -9, z: 0 } }).x).toBeCloseTo(-1 - EDGE_GAP);
  });

  it('a turned table: the spot is outside it along its own axes', () => {
    const obj = table({ rotationY: Math.PI / 2 }); // its 9.6 m side along Z now
    const goal = itemWalkGoal(obj, { x: 0.5, z: 1 }, { catalog: ASSET_TYPES });
    // the nearest edge is the one at x = +2.1
    expect(goal.x).toBeCloseTo(2.1 + EDGE_GAP);
    expect(goal.z).toBeCloseTo(1);
  });

  it('a point already clear of the item: unchanged; a point just beside it: pushed out to where the body fits', () => {
    const r = { x: 0, z: 0, hw: 1, hd: 0.5, rot: 0 };
    expect(edgeSpot(r, { x: 3, z: 0 })).toMatchObject({ x: 3, z: 0, distance: 0 });
    const near = edgeSpot(r, { x: 1.1, z: 0 });
    expect(near.x).toBeCloseTo(1 + EDGE_GAP);
  });

  it("a corner desk: never a spot in its other arm", () => {
    const desk = { id: 'c', assetType: 'DESK_CORNER', floor: 0, x: 0, z: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
    const goal = itemWalkGoal(desk, { x: -1.0, z: -1.0 }, { catalog: ASSET_TYPES });
    // the outer corner of the L: out of the −X or −Z side
    expect(goal.x < -1.2 || goal.z < -1.2).toBe(true);
  });
});
