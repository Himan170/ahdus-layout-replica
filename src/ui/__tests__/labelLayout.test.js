import { describe, expect, it } from 'vitest';
import { fitLabels, LABEL_GAP } from '../labelLayout';

describe('fitLabels', () => {
  it('draws labels that are apart', () => {
    expect(fitLabels([
      { x: 0, y: 0, w: 40, h: 16 },
      { x: 100, y: 0, w: 40, h: 16 },
      { x: 0, y: 50, w: 40, h: 16 },
    ])).toEqual([true, true, true]);
  });

  it('leaves out a label that overlaps one placed before it (the first wins)', () => {
    expect(fitLabels([
      { x: 0, y: 0, w: 60, h: 16 },
      { x: 30, y: 5, w: 60, h: 16 },
      { x: 200, y: 0, w: 60, h: 16 },
    ])).toEqual([true, false, true]);
  });

  it('keeps a gap between labels', () => {
    // 40 px wide at x 0 and x 42: 2 px apart, less than the gap
    expect(fitLabels([{ x: 0, y: 0, w: 40, h: 16 }, { x: 42, y: 0, w: 40, h: 16 }])).toEqual([true, false]);
    expect(fitLabels([{ x: 0, y: 0, w: 40, h: 16 }, { x: 40 + LABEL_GAP + 1, y: 0, w: 40, h: 16 }])).toEqual([true, true]);
  });

  it('a hidden label (off screen) takes no place', () => {
    expect(fitLabels([
      { x: 0, y: 0, w: 60, h: 16, visible: false },
      { x: 10, y: 0, w: 60, h: 16 },
    ])).toEqual([false, true]);
  });

  it('a pile of labels at one spot shows only the first', () => {
    const pile = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i, w: 50, h: 16 }));
    expect(fitLabels(pile).filter(Boolean)).toHaveLength(1);
  });
});
