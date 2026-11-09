// The Inspector's item size in metres (v0.15.1): saved as the scale, shown and typed in metres.
import { describe, expect, it } from 'vitest';
import { itemSize, scaleForSize, sizeLimits } from '../itemSize';
import { ASSET_TYPES } from '../../utils/assetCatalog';

const desk = ASSET_TYPES.DESK_STANDARD; // 1.6 × 0.75 × 0.8 m

describe('itemSize', () => {
  it('a desk at scale 1 is 1.6 m wide, 0.75 m high, 0.8 m deep', () => {
    expect(itemSize({}, desk)).toEqual({ width: 1.6, height: 0.75, depth: 0.8 });
  });

  it('the scale multiplies the catalogue size', () => {
    const s = itemSize({ scaleX: 1.5, scaleY: 1, scaleZ: 0.5 }, desk);
    expect(s.width).toBeCloseTo(2.4);
    expect(s.depth).toBeCloseTo(0.4);
  });

  it('every catalogue item has a size', () => {
    for (const def of Object.values(ASSET_TYPES)) {
      const s = itemSize({}, def);
      expect(s.width > 0 && s.height > 0 && s.depth > 0).toBe(true);
    }
  });
});

describe('scaleForSize', () => {
  it('typing 2 m of width on its own sets only scaleX', () => {
    expect(scaleForSize({}, desk, 'width', 2)).toEqual({ scaleX: 1.25 });
  });

  it('keep proportions: every side by the same factor', () => {
    expect(scaleForSize({ scaleX: 1, scaleY: 1, scaleZ: 1 }, desk, 'depth', 1.2, true))
      .toEqual({ scaleX: 1.5, scaleY: 1.5, scaleZ: 1.5 });
  });

  it('stays within the scale limits (0.1 to 5 ×), also with proportions', () => {
    expect(scaleForSize({}, desk, 'width', 100)).toEqual({ scaleX: 5 });
    expect(scaleForSize({}, desk, 'width', 0.01)).toEqual({ scaleX: 0.1 });
    const p = scaleForSize({ scaleX: 1, scaleY: 4, scaleZ: 1 }, desk, 'width', 3.2, true);
    expect(p.scaleY).toBe(5);
    expect(p.scaleX).toBeCloseTo(1.25);
    expect(sizeLimits(desk, 'width')).toEqual({ min: 0.16, max: 8 });
  });

  it('nothing for a size that is not a number above 0', () => {
    expect(scaleForSize({}, desk, 'width', 0)).toBeNull();
    expect(scaleForSize({}, desk, 'width', NaN)).toBeNull();
  });
});
