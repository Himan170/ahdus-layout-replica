import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceMonitor } from '../performanceOptimiser';

/** A Babylon engine as the monitor sees it: an FPS to read, a scaling level to set. */
function fakeEngine(fps) {
  return { fps, getFps() { return this.fps; }, setHardwareScalingLevel: vi.fn() };
}

describe('performance monitor (auto resolution)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { devicePixelRatio: 1 }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('lowers the resolution when the FPS stays low', () => {
    const engine = fakeEngine(10);
    const monitor = createPerformanceMonitor(engine);
    vi.advanceTimersByTime(1000);
    expect(engine.setHardwareScalingLevel).toHaveBeenCalledTimes(1);
    expect(monitor.getScaleFactor()).toBe(1.25);
    monitor.dispose();
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
});
