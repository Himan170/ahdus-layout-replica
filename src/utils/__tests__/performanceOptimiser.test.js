import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceMonitor } from '../performanceOptimiser';

/** A Babylon engine as the monitor sees it: an FPS to read, a scaling level to set. */
function fakeEngine(fps) {
  return { fps, getFps() { return this.fps; }, setHardwareScalingLevel: vi.fn() };
}

describe('performance monitor (auto resolution)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { devicePixelRatio: 1 }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('lowers the resolution when the FPS stays low (after a few samples, not one slow second)', () => {
    const engine = fakeEngine(25);
    const monitor = createPerformanceMonitor(engine);
    vi.advanceTimersByTime(1000);
    expect(engine.setHardwareScalingLevel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(engine.setHardwareScalingLevel).toHaveBeenCalledTimes(1);
    expect(monitor.getScaleFactor()).toBe(1.5); // sqrt(40 / 25) = 1.26 → the next 0.25 up
    monitor.dispose();
  });

  it('v0.18.7: a very slow machine gets ONE resize to the level it needs, not four in a row (each a long task)', () => {
    const engine = fakeEngine(7);
    const monitor = createPerformanceMonitor(engine);
    vi.advanceTimersByTime(10000);
    expect(engine.setHardwareScalingLevel).toHaveBeenCalledTimes(1);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(2);
    expect(monitor.getScaleFactor()).toBe(2);
    monitor.dispose();
  });

  it('v0.18.7: a change forgets the samples before it (the next decision is made on the new resolution)', () => {
    const engine = fakeEngine(20);
    const monitor = createPerformanceMonitor(engine);
    vi.advanceTimersByTime(3000); // 20 FPS → 1.5
    expect(monitor.getScaleFactor()).toBe(1.5);
    engine.fps = 45; // between the thresholds: stays
    vi.advanceTimersByTime(10000);
    expect(engine.setHardwareScalingLevel).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });

  it('v0.18.7: the resolution comes back in steps once the FPS stays high; the pixel ratio is kept (≤ 2)', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const engine = fakeEngine(10);
    const monitor = createPerformanceMonitor(engine);
    vi.advanceTimersByTime(3000);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1); // scale 2 at a pixel ratio of 2
    engine.fps = 60;
    vi.advanceTimersByTime(5000);
    expect(monitor.getScaleFactor()).toBe(1.75);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.75 / 2);
    monitor.dispose();
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1 / 2);
  });

  it('paused (a layout is being built), a low FPS changes nothing', () => {
    const engine = fakeEngine(5);
    const monitor = createPerformanceMonitor(engine);
    monitor.setEnabled(false);
    vi.advanceTimersByTime(10000);
    expect(engine.setHardwareScalingLevel).not.toHaveBeenCalled();
    expect(monitor.getScaleFactor()).toBe(1);
    monitor.dispose();
  });

  it('resuming forgets the samples taken while paused', () => {
    const engine = fakeEngine(5);
    const monitor = createPerformanceMonitor(engine);
    monitor.setEnabled(false);
    vi.advanceTimersByTime(10000); // ten low samples while building
    engine.fps = 60;
    monitor.setEnabled(true);
    vi.advanceTimersByTime(3000);
    expect(engine.setHardwareScalingLevel).not.toHaveBeenCalled();
    expect(monitor.getScaleFactor()).toBe(1);
    monitor.dispose();
  });

  it('v0.18.7: made paused, it measures nothing until it is turned on', () => {
    const engine = fakeEngine(5);
    const monitor = createPerformanceMonitor(engine, { enabled: false });
    vi.advanceTimersByTime(10000);
    expect(engine.setHardwareScalingLevel).not.toHaveBeenCalled();
    monitor.setEnabled(true);
    vi.advanceTimersByTime(3000);
    expect(engine.setHardwareScalingLevel).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });
});
