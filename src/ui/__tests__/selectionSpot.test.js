// The floating selection bar's place (v0.15.1): above the item, clear of it and of room labels.
import { describe, expect, it } from 'vitest';
import { selectionSpot, SPOT_GAP } from '../selectionSpot';

const card = { cw: 800, ch: 600, w: 320, h: 36 };
const desk = { left: 280, top: 290, right: 360, bottom: 330 };
const over = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const rect = (s) => ({ left: s.x, top: s.y, right: s.x + card.w, bottom: s.y + card.h });

describe('selectionSpot', () => {
  it('above the item, centred on it, its own gap clear of the top edge', () => {
    const s = selectionSpot({ ...card, box: desk });
    expect(s.below).toBe(false);
    expect(s.y + card.h).toBe(desk.top - SPOT_GAP);
    expect(s.x + card.w / 2).toBe(320);
  });

  it('steps up past room labels it would cover, and never covers the item', () => {
    const labels = [{ left: 100, top: 250, right: 200, bottom: 266 }, { left: 440, top: 210, right: 520, bottom: 226 }];
    const s = selectionSpot({ ...card, box: desk, avoid: labels });
    for (const l of labels) expect(over(rect({ ...s, h: card.h }), l)).toBe(false);
    expect(over({ left: s.x, top: s.y, right: s.x + card.w, bottom: s.y + card.h }, desk)).toBe(false);
  });

  it('no room above (item at the top of the view): below it, clear of it', () => {
    const s = selectionSpot({ ...card, box: { left: 300, top: 20, right: 380, bottom: 60 } });
    expect(s.below).toBe(true);
    expect(s.y).toBe(60 + SPOT_GAP);
  });

  it('stays inside the card sideways', () => {
    expect(selectionSpot({ ...card, box: { left: 0, top: 300, right: 20, bottom: 320 } }).x).toBe(8);
    expect(selectionSpot({ ...card, box: { left: 780, top: 300, right: 800, bottom: 320 } }).x).toBe(800 - 320 - 8);
  });
});
