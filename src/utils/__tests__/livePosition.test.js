// Where the dragged item is right now, for the Inspector's X / Z (v0.15.2)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { livePosition } from '../livePosition';

afterEach(() => livePosition.clear());

describe('livePosition', () => {
  it('tells its listeners where the dragged item is, rounded to a centimetre', () => {
    const heard = vi.fn();
    const stop = livePosition.subscribe(heard);
    livePosition.set('desk', 1.2345, -3.001);
    expect(livePosition.get()).toEqual({ id: 'desk', x: 1.23, z: -3 });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('says nothing again for a move under a centimetre', () => {
    const heard = vi.fn();
    const stop = livePosition.subscribe(heard);
    livePosition.set('desk', 1, 2);
    livePosition.set('desk', 1.001, 2.004);
    expect(heard).toHaveBeenCalledTimes(1);
    livePosition.set('desk', 1.02, 2);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('clear ends it (once), and an unsubscribed listener hears nothing', () => {
    const heard = vi.fn();
    const stop = livePosition.subscribe(heard);
    livePosition.set('desk', 1, 2);
    livePosition.clear();
    livePosition.clear();
    expect(livePosition.get()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    livePosition.set('desk', 5, 5);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
