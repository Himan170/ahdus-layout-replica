// v0.18.6 (Astra audit 2a, 14): Plan view drops on what the table really is: the corner desk's two arms (not its
// open corner), the round table's round top (not the corners of its square), a wall shelf's bare board (lower
// than its books). Plan draws the same outlines.
import { describe, it, expect } from 'vitest';
import { planDrop, planCarried } from '../planMath';
import { surfaceTopAt, planOutline } from '../../play/surfaces';

const item = (assetType, x, z, over = {}) => ({
  id: `${assetType}_${x}_${z}`, assetType, floor: 0, x, y: 0, z, rotationX: 0, rotationY: 0, rotationZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...over,
});
const plant = item('PLANT_SMALL', 9, 9);
const room = { id: 'r', name: 'Office', floor: 0, x: 0, z: 0, width: 20, depth: 20, doors: [], windows: [] };

describe('drops on real table tops', () => {
  const lDesk = item('DESK_CORNER', 0, 0);   // 2.4 x 2.4 m: the arms along −Z and −X, the +X +Z corner open
  const round = item('TABLE_ROUND', 3, 0);   // a 1 m round top

  it("the corner desk's open corner is the floor; its arms are its top", () => {
    const drop = (x, z) => planDrop(plant, { x, z }, { objects: [lDesk, round, plant], rooms: [room] });
    expect(drop(0.75, 0.75).y).toBeLessThan(0.1); // the floor
    expect(drop(0.75, -0.8).y).toBeCloseTo(0.75, 6);
    expect(drop(-0.8, 0.75).y).toBeCloseTo(0.75, 6);
  });
  it("the round table's corner is the floor; its middle and its rim are its top", () => {
    const drop = (x, z) => planDrop(plant, { x, z }, { objects: [lDesk, round, plant], rooms: [room] });
    expect(drop(3.44, 0.44).y).toBeLessThan(0.1);
    expect(drop(3, 0).y).toBeCloseTo(0.75, 6);
    expect(drop(3.45, 0).y).toBeCloseTo(0.75, 6);
  });
  it('turned and mirrored like the mesh', () => {
    const turned = item('DESK_CORNER', 0, 0, { rotationY: Math.PI }); // the open corner is now at −X, −Z
    expect(surfaceTopAt(turned, { x: -0.75, z: -0.75 }, { width: 2.4, depth: 2.4, height: 0.75 })).toBeNull();
    expect(surfaceTopAt(turned, { x: 0.75, z: 0.75 }, { width: 2.4, depth: 2.4, height: 0.75 })).toBeCloseTo(0.75);
    const mirrored = item('DESK_CORNER', 0, 0, { scaleX: -1 }); // the open corner at −X, +Z
    expect(surfaceTopAt(mirrored, { x: -0.75, z: 0.75 }, { width: -2.4, depth: 2.4, height: 0.75 })).toBeNull();
    expect(surfaceTopAt(mirrored, { x: 0.75, z: 0.75 }, { width: -2.4, depth: 2.4, height: 0.75 })).toBeCloseTo(0.75);
  });
  it("a wall shelf: on its bare board at the board's height, on its books higher", () => {
    const shelf = item('WALL_SHELF', 5, 5, { y: 1.35 }); // 1.0 x 0.25 x 0.3 m
    const drop = (x) => { const d = planDrop(plant, { x, z: 5 }, { objects: [shelf, plant], rooms: [room] }); if (d.y === undefined) throw new Error(JSON.stringify(d)); return d; };
    expect(drop(5.25).y).toBeCloseTo(1.35 + 0.15, 6);
    expect(drop(4.8).y).toBeCloseTo(1.35 + 0.3, 6);
  });
  it('what stands on the bare board moves with the shelf', () => {
    const shelf = item('WALL_SHELF', 5, 5, { y: 1.35 });
    const onBoard = item('PLANT_SMALL', 5.25, 5, { y: 1.5 });
    expect(planCarried(shelf, [shelf, onBoard]).map((o) => o.id)).toContain(onBoard.id);
  });
  it('Plan draws the L and the round top', () => {
    expect(planOutline('TABLE_ROUND').kind).toBe('ellipse');
    expect(planOutline('DESK_CORNER').points).toHaveLength(6);
    expect(planOutline('DESK_STANDARD').kind).toBe('rect');
  });
});
