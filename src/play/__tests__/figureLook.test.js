// v0.17.2: the simple figure's colours (play/figureLook.js).
import { describe, it, expect } from 'vitest';
import { figureColors, cleanColors, rgba, SUITS, TOPS, TROUSERS, WHITE_SHIRT } from '../figureLook';
import { TROUSER_TINTS } from '../outfit';

describe('figureColors', () => {
  it("the Wardrobe's clothing first: a shirt / T-shirt in its colour, trousers black or blue", () => {
    expect(figureColors({ personId: 'a', clothing: { schemaVersion: 1, upperBody: 'tshirt', upperColor: '#AA3322', pantsColor: 'blue' } }))
      .toEqual({ top: '#aa3322', bottom: TROUSER_TINTS.blue, from: 'clothing' });
    expect(figureColors({ personId: 'a', clothing: { schemaVersion: 1, upperBody: 'shirt', upperColor: null, pantsColor: 'black' } }))
      .toEqual({ top: WHITE_SHIRT, bottom: TROUSER_TINTS.black, from: 'clothing' });
  });

  it('Office formal (chosen, or a Rocketbox file with no clothing) = a suit: top and trousers alike', () => {
    const chosen = figureColors({ personId: 'b', clothing: { schemaVersion: 1, upperBody: null, pantsColor: 'black' } });
    expect(SUITS).toContain(chosen.top);
    expect(chosen.bottom).toBe(chosen.top);
    const file = figureColors({ personId: 'b', character: { outfit: 'rocketbox' } });
    expect(file).toEqual({ ...chosen, from: 'suit' });
  });

  it("the manifest's colours of the file, when it gives them", () => {
    expect(figureColors({ personId: 'c', character: { colors: { top: '#123456', bottom: '#654321' } } }))
      .toEqual({ top: '#123456', bottom: '#654321', from: 'file' });
    expect(figureColors({ personId: 'c', character: { colors: { top: '#123456' } } }).bottom).toBe('#123456');
  });

  it('nothing known: a calm office colour by id, the same every time, and people differ', () => {
    const one = figureColors({ personId: 'p_1' });
    expect(one.from).toBe('id');
    expect(TOPS).toContain(one.top);
    expect(TROUSERS).toContain(one.bottom);
    expect(figureColors({ personId: 'p_1', name: 'Someone else' })).toEqual(one);
    const tops = new Set(Array.from({ length: 40 }, (_, i) => figureColors({ personId: `p_${i}` }).top));
    expect(tops.size).toBeGreaterThanOrEqual(6); // not one grey office
  });

  it('cleanColors keeps #rrggbb only; rgba for the colour buffer', () => {
    expect(cleanColors({ top: '#ABCDEF', bottom: 'red' })).toEqual({ top: '#abcdef' });
    expect(cleanColors({ top: 'blue' })).toBeNull();
    expect(cleanColors(null)).toBeNull();
    expect(rgba('#ff0000')).toEqual([1, 0, 0, 1]);
  });
});
