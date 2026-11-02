import { describe, it, expect } from 'vitest';
import { nearestAngle, zoomedRadius, zoomedOrthoTop, setPanMode, VIEW_ANGLES, ZOOM_STEP } from '../cameraControls';

describe('cameraControls', () => {
  it('turns the short way round', () => {
    expect(nearestAngle(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    // after many turns the other way, it stays near where the camera is
    expect(nearestAngle(6 * Math.PI, -Math.PI / 2)).toBeCloseTo(6 * Math.PI - Math.PI / 2);
    expect(nearestAngle(-7, 0)).toBeCloseTo(-2 * Math.PI);
  });

  it('zooms in and out inside the limits', () => {
    expect(zoomedRadius(30, 1)).toBeCloseTo(30 / ZOOM_STEP);
    expect(zoomedRadius(30, -1)).toBeCloseTo(30 * ZOOM_STEP);
    expect(zoomedRadius(5.5, 1, 5, 320)).toBe(5);
    expect(zoomedRadius(300, -1, 5, 320)).toBe(320);
    expect(zoomedOrthoTop(2.1, 1)).toBe(2);
    expect(zoomedOrthoTop(190, -1)).toBe(200);
  });

  it('has a top view looking down, north up like the 2D view', () => {
    expect(VIEW_ANGLES.top.alpha).toBeCloseTo(-Math.PI / 2);
    expect(VIEW_ANGLES.top.beta).toBeLessThan(0.2);
    expect(VIEW_ANGLES.front.beta).toBeLessThan(Math.PI / 2 - 0.05);
  });

  it('keeps pan mode when the controls are attached again', () => {
    const camera = { attachControl() { this._panningMouseButton = 2; } };
    setPanMode(camera, true);
    expect(camera._panningMouseButton).toBe(0);
    camera.attachControl({}, true);
    expect(camera._panningMouseButton).toBe(0);
    setPanMode(camera, false);
    camera.attachControl({}, true);
    expect(camera._panningMouseButton).toBe(2);
  });
});
