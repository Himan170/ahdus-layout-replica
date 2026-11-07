// Drag to look, and a click told from a drag (v0.14.0, private-docs/EXPERIENCE_PLAN.md 3.2): ≤ 6 px and ≤ 250 ms = a click.
import { describe, expect, it, vi } from 'vitest';
import { createDragLook, isClick, stickVector, CLICK_PX, CLICK_MS, DOUBLE_CLICK_MS, TAP_PX, TAP_MS, STICK_DEAD } from '../dragLook';

function tracker() {
  const look = vi.fn();
  const click = vi.fn();
  const doubleClick = vi.fn();
  return { look, click, doubleClick, d: createDragLook({ look, click, doubleClick }) };
}

describe('isClick', () => {
  it('at most 6 px and 250 ms from press to release', () => {
    expect(CLICK_PX).toBe(6);
    expect(CLICK_MS).toBe(250);
    const down = { x: 100, y: 100, t: 0 };
    expect(isClick(down, { x: 100, y: 100, t: 10 })).toBe(true);
    expect(isClick(down, { x: 106, y: 100, t: 250 })).toBe(true);
    expect(isClick(down, { x: 104, y: 105, t: 100 })).toBe(false); // 6.4 px
    expect(isClick(down, { x: 100, y: 100, t: 251 })).toBe(false); // held too long
    expect(isClick(null, { x: 0, y: 0, t: 0 })).toBe(false);
  });
});

describe('createDragLook', () => {
  it('a press and release in place is a click (no look)', () => {
    const { look, click, d } = tracker();
    d.down({ x: 50, y: 60, t: 0, button: 0 });
    expect(d.move({ x: 53, y: 62 })).toBe(false); // jitter: still a click
    expect(d.up({ x: 53, y: 62, t: 120 })).toBe('click');
    expect(click).toHaveBeenCalledWith({ x: 53, y: 62, button: 0, touch: false });
    expect(look).not.toHaveBeenCalled();
  });

  it('moving more than 6 px is a drag: the view turns by every pixel moved, the held-back ones too; no click', () => {
    const { look, click, d } = tracker();
    d.down({ x: 50, y: 50, t: 0 });
    d.move({ x: 54, y: 50 });
    expect(look).not.toHaveBeenCalled();
    expect(d.move({ x: 60, y: 48 })).toBe(true);
    expect(look).toHaveBeenLastCalledWith(10, -2, false); // from the press
    expect(d.dragging).toBe(true);
    d.move({ x: 75, y: 50 });
    expect(look).toHaveBeenLastCalledWith(15, 2, false);
    // even a quick drag that ends near where it started is a drag
    d.move({ x: 51, y: 50 });
    expect(d.up({ x: 51, y: 50, t: 100 })).toBe('drag');
    expect(click).not.toHaveBeenCalled();
    expect(d.pressed).toBe(false);
  });

  it('a long press without moving is nothing (not a click)', () => {
    const { click, d } = tracker();
    d.down({ x: 10, y: 10, t: 0 });
    expect(d.up({ x: 10, y: 10, t: 400 })).toBe(null);
    expect(click).not.toHaveBeenCalled();
  });

  it('two clicks close together are a double click (the second is not a click)', () => {
    const { click, doubleClick, d } = tracker();
    d.down({ x: 10, y: 10, t: 0 });
    d.up({ x: 10, y: 10, t: 80 });
    d.down({ x: 12, y: 11, t: 200 });
    expect(d.up({ x: 12, y: 11, t: 260 })).toBe('double');
    expect(click).toHaveBeenCalledTimes(1);
    expect(doubleClick).toHaveBeenCalledWith({ x: 12, y: 11, button: 0, touch: false });
    // a third click starts over
    d.down({ x: 12, y: 11, t: 300 });
    expect(d.up({ x: 12, y: 11, t: 320 })).toBe('click');
  });

  it('clicks too far apart in time or place are two clicks', () => {
    const { click, doubleClick, d } = tracker();
    d.down({ x: 10, y: 10, t: 0 }); d.up({ x: 10, y: 10, t: 50 });
    d.down({ x: 10, y: 10, t: 50 + DOUBLE_CLICK_MS + 1 }); d.up({ x: 10, y: 10, t: 60 + DOUBLE_CLICK_MS + 1 });
    d.down({ x: 40, y: 10, t: 1000 }); d.up({ x: 40, y: 10, t: 1050 });
    d.down({ x: 70, y: 10, t: 1100 }); d.up({ x: 70, y: 10, t: 1150 });
    expect(click).toHaveBeenCalledTimes(4);
    expect(doubleClick).not.toHaveBeenCalled();
  });

  it('the first pointer leads: a second one changes nothing; cancel ends the press', () => {
    const { look, click, d } = tracker();
    d.down({ id: 1, x: 0, y: 0, t: 0 });
    d.down({ id: 2, x: 100, y: 100, t: 5 });
    expect(d.move({ id: 2, x: 200, y: 100 })).toBe(false);
    expect(d.up({ id: 2, x: 200, y: 100, t: 10 })).toBe(null);
    expect(look).not.toHaveBeenCalled();
    d.cancel();
    expect(d.up({ id: 1, x: 0, y: 0, t: 20 })).toBe(null);
    expect(click).not.toHaveBeenCalled();
  });

  it('the button is passed on (the view uses left clicks only)', () => {
    const { click, d } = tracker();
    d.down({ x: 0, y: 0, t: 0, button: 2 });
    d.up({ x: 0, y: 0, t: 10 });
    expect(click).toHaveBeenCalledWith({ x: 0, y: 0, button: 2, touch: false });
  });
});

describe('touch (v0.14.1)', () => {
  it('a tap may wander up to 10 px and last up to 500 ms (fingers are never quite still)', () => {
    expect(TAP_PX).toBe(10);
    expect(TAP_MS).toBe(500);
    const down = { x: 100, y: 100, t: 0, touch: true };
    expect(isClick(down, { x: 108, y: 100, t: 400 })).toBe(true); // too far / long for a mouse click
    expect(isClick({ ...down, touch: false }, { x: 108, y: 100, t: 400 })).toBe(false);
    expect(isClick(down, { x: 111, y: 100, t: 100 })).toBe(false);
    expect(isClick(down, { x: 100, y: 100, t: 501 })).toBe(false);
  });

  it('a finger that moves more than 10 px drags to look (touch passed on); a tap is a click with touch', () => {
    const { look, click, d } = tracker();
    d.down({ id: 7, x: 50, y: 50, t: 0, touch: true });
    expect(d.move({ id: 7, x: 58, y: 50 })).toBe(false); // 8 px: still a tap
    expect(d.move({ id: 7, x: 70, y: 50 })).toBe(true);
    expect(look).toHaveBeenLastCalledWith(20, 0, true);
    expect(d.up({ id: 7, x: 70, y: 50, t: 200 })).toBe('drag');
    d.down({ id: 8, x: 30, y: 30, t: 1000, touch: true });
    expect(d.up({ id: 8, x: 36, y: 34, t: 1400 })).toBe('click');
    expect(click).toHaveBeenCalledWith({ x: 36, y: 34, button: 0, touch: true });
  });

  it('two quick taps are two taps, never a double click (nothing captures a phone mouse)', () => {
    const { click, doubleClick, d } = tracker();
    for (let i = 0; i < 2; i++) { d.down({ x: 10, y: 10, t: i * 100, touch: true }); d.up({ x: 10, y: 10, t: i * 100 + 50 }); }
    expect(click).toHaveBeenCalledTimes(2);
    expect(doubleClick).not.toHaveBeenCalled();
  });
});

describe('stickVector (the joystick)', () => {
  it('up is forward, right is right; push further = faster; the ring holds the knob', () => {
    const r = 64;
    expect(stickVector(0, 0, r)).toMatchObject({ x: 0, y: 0, magnitude: 0 });
    const up = stickVector(0, -r, r);
    expect(up.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);
    const right = stickVector(r, 0, r);
    expect(right.x).toBeCloseTo(1);
    const half = stickVector(0, r / 2, r); // pulled back half way: slower, backwards
    expect(half.y).toBeLessThan(0);
    expect(half.magnitude).toBeGreaterThan(0.3);
    expect(half.magnitude).toBeLessThan(0.5);
    const far = stickVector(300, -400, r); // past the ring: full speed, knob on the ring
    expect(far.magnitude).toBe(1);
    expect(Math.hypot(far.knobX, far.knobY)).toBeCloseTo(r);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
  });

  it('a resting thumb in the middle does nothing (the dead zone)', () => {
    const r = 64;
    expect(stickVector(0, -r * STICK_DEAD * 0.9, r).magnitude).toBe(0);
    expect(stickVector(0, -r * (STICK_DEAD + 0.05), r).magnitude).toBeGreaterThan(0);
    expect(stickVector(5, 5, 0).magnitude).toBe(0); // no ring yet
  });
});
