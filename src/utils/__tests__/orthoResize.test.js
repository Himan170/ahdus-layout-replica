import { describe, it, expect } from 'vitest';
import { keepOrthoView, shiftToShow } from '../orthoResize';

const ortho = (halfW, halfH) => ({ orthoLeft: -halfW, orthoRight: halfW, orthoTop: halfH, orthoBottom: -halfH });

describe('keepOrthoView (v0.18.9: the 2D view when the Inspector opens)', () => {
  it('a narrower canvas: the same scale, the left edge stays, the middle moves left', () => {
    // 1280 × 720 showing 40 m high (scale 40 / 720), the Inspector takes 360 px
    const k = keepOrthoView(ortho(20 * 1280 / 720, 20), 1280, 720, 920, 720);
    const scale = 40 / 720;
    expect(k.halfH).toBeCloseTo(20);
    expect(k.halfW).toBeCloseTo((920 * scale) / 2);
    // left edge before: middle − halfW0; after: middle + shiftX − halfW: the same
    expect(-(20 * 1280 / 720)).toBeCloseTo(k.shiftX - k.halfW);
    expect(k.shiftY).toBeCloseTo(0);
  });

  it('a world point under a pixel stays under it (both axes)', () => {
    const before = ortho(30, 20);
    const [w0, h0, w1, h1] = [1200, 800, 900, 700];
    const k = keepOrthoView(before, w0, h0, w1, h1);
    for (const [px, py] of [[0, 0], [100, 50], [600, 400], [899, 699]]) {
      const x0 = before.orthoLeft + (px / w0) * 60;
      const y0 = before.orthoTop - (py / h0) * 40;
      const x1 = k.shiftX - k.halfW + (px / w1) * 2 * k.halfW;
      const y1 = k.shiftY + k.halfH - (py / h1) * 2 * k.halfH;
      expect(x1).toBeCloseTo(x0);
      expect(y1).toBeCloseTo(y0);
    }
  });

  it('a wider canvas (the Inspector closes) shows more on the right, nothing moves', () => {
    const k = keepOrthoView(ortho(10, 10), 500, 500, 800, 500);
    expect(k.halfW).toBeCloseTo(16);
    expect(k.shiftX - k.halfW).toBeCloseTo(-10);
  });

  it('nothing to keep: a zero-sized canvas or no bounds', () => {
    expect(keepOrthoView(ortho(10, 10), 0, 500, 800, 500)).toBeNull();
    expect(keepOrthoView(ortho(10, 10), 500, 500, 0, 500)).toBeNull();
    expect(keepOrthoView({}, 500, 500, 800, 500)).toBeNull();
  });
});

describe('shiftToShow (v0.18.9: the selection stays in view when the Inspector opens)', () => {
  it('a point past the right edge comes back inside, the margin from it; one inside stays', () => {
    expect(shiftToShow(9, 0, 10, 10, 2)).toEqual({ x: 1, y: 0 });
    expect(shiftToShow(14, -12, 10, 10, 2)).toEqual({ x: 6, y: -4 });
    expect(shiftToShow(3, 4, 10, 10, 2)).toEqual({ x: 0, y: 0 });
  });
  it('a margin bigger than the view: at most a little under half of it', () => {
    const s = shiftToShow(12, 0, 4, 4, 10);
    expect(s.x).toBeCloseTo(12 - 4 * 0.55);
  });
});
