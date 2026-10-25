import { describe, expect, it } from 'vitest';
import {
  distanceBetweenPoints,
  roomArea,
  wallMeasurementSegments,
} from '../measurements';

describe('measurement geometry', () => {
  it('calculates horizontal, vertical and diagonal distances in metres', () => {
    expect(distanceBetweenPoints({ x: 1, z: 2 }, { x: 4, z: 2 })).toBe(3);
    expect(distanceBetweenPoints({ x: 1, z: 2 }, { x: 1, z: 6 })).toBe(4);
    expect(distanceBetweenPoints({ x: 0, z: 0 }, { x: 4, z: 3 })).toBe(5);
  });

  it('rejects invalid point coordinates', () => {
    expect(distanceBetweenPoints({ x: NaN, z: 0 }, { x: 1, z: 1 })).toBeNull();
  });

  it('calculates positive rectangular room area and ignores invalid dimensions', () => {
    expect(roomArea({ width: 5, depth: 4 })).toBe(20);
    expect(roomArea({ width: -5, depth: 4 })).toBeNull();
    expect(roomArea({ width: Infinity, depth: 4 })).toBeNull();
  });

  it('merges shared and overlapping room boundaries without duplicate wall runs', () => {
    const rooms = [
      { x: 0, z: 0, width: 4, depth: 4 },
      { x: 4, z: 0, width: 4, depth: 4 },
    ];
    const runs = wallMeasurementSegments(rooms);
    const sharedLine = runs.filter((run) =>
      Math.abs(run.a.x - 2) < 1e-5 && Math.abs(run.b.x - 2) < 1e-5);
    expect(sharedLine).toHaveLength(1);
    expect(sharedLine[0].length).toBe(4);
  });

  it('uses the scaled asset length for standalone WALL_SEGMENT objects', () => {
    const runs = wallMeasurementSegments([], [{
      assetType: 'WALL_SEGMENT', x: 2, z: 3, rotationY: 0, scaleX: 2,
    }]);
    expect(runs).toHaveLength(1);
    expect(runs[0].length).toBe(6);
    expect(runs[0].a).toEqual({ x: -1, z: 3 });
    expect(runs[0].b).toEqual({ x: 5, z: 3 });
  });

  it('merges a standalone wall that duplicates a room boundary', () => {
    const runs = wallMeasurementSegments(
      [{ x: 0, z: 0, width: 4, depth: 4 }],
      [{ assetType: 'WALL_SEGMENT', x: 0, z: 2, rotationY: 0, scaleX: 4 / 3 }],
    );
    expect(runs.filter((run) => Math.abs(run.a.z - 2) < 1e-5)).toHaveLength(1);
  });
});
