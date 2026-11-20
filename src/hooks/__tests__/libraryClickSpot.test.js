// v0.18.5: a library tile clicked while the Plan is shown lands in the middle of the Plan, not in the
// middle of the hidden 3D view.
import { describe, expect, it } from 'vitest';
import { clickSpot } from '../useLibraryDrop';
import { planViewCentre, zoomViewBox } from '../../floorplan/planMath';

describe('where a clicked library tile goes', () => {
  it('the Plan: its middle, in metres (pan and zoom included)', () => {
    const base = { x: -10, y: -6, width: 20, height: 12 }; // plan y = −z
    expect(planViewCentre(zoomViewBox(base, 1, { x: 0, y: 0 }))).toEqual({ x: 0, z: 0 });
    const panned = planViewCentre(zoomViewBox(base, 2, { x: 4, y: -3 }));
    expect(panned.x).toBeCloseTo(4);
    expect(panned.z).toBeCloseTo(3);
    expect(planViewCentre(null)).toBeNull();
  });

  it("Plan shown: the Plan's middle; the 3D / 2D view: the canvas middle in pixels", () => {
    const canvas = { clientWidth: 800, clientHeight: 600 };
    expect(clickSpot({ canvas, planCentre: { x: 4, z: 3 } })).toEqual({ world: { x: 4, z: 3 } });
    expect(clickSpot({ canvas, planCentre: null })).toEqual({ x: 400, y: 300 });
    expect(clickSpot({ canvas: null, planCentre: null })).toBeNull();
  });
});
