// The hint for a walking click that walks nowhere (v0.17.3): clickHint.js.
import { describe, it, expect } from 'vitest';
import {
  CLICK_HINT, CLICK_HINT_TOUCH, CLICK_HINT_GAP_MS, NO_WALK_PARTS,
  clickFeedback, clickHintText, createHintGate, hintSpot,
} from '../clickHint';

describe('clickHint', () => {
  it('the words: a mouse clicks, a phone taps', () => {
    expect(clickHintText(false)).toBe('Click the floor or the stairs to walk there');
    expect(clickHintText(true)).toBe('Tap the floor or the stairs');
    expect([CLICK_HINT, CLICK_HINT_TOUCH]).toEqual([clickHintText(), clickHintText(true)]);
  });

  it('nothing to walk to (a wall, a ceiling, the sky) = the hint; a walk started = nothing to say', () => {
    expect(clickFeedback({ walkTo: null })).toBe('hint');
    expect(clickFeedback({ walkTo: { x: 0, z: 0, floor: 0 } })).toBeNull();
  });

  it('a room nobody can reach keeps its own message; any other spot no route reaches gets the hint', () => {
    const to = { x: 0, z: 0, floor: 0 };
    for (const problem of ['NO_DOOR', 'START_NO_DOOR', 'NO_STAIRS']) expect(clickFeedback({ walkTo: to, problem })).toBe('message');
    for (const problem of ['NO_ROUTE', 'GOAL_BLOCKED', 'NO_FLOOR', 'START_BLOCKED']) expect(clickFeedback({ walkTo: to, problem })).toBe('hint');
  });

  it('walls, windows, ceilings, roofs walk nowhere; floors and doors do', () => {
    for (const part of ['wall', 'window', 'ceiling', 'roof', 'slab', 'band', 'skirting']) expect(NO_WALK_PARTS.has(part)).toBe(true);
    for (const part of ['floor', 'door']) expect(NO_WALK_PARTS.has(part)).toBe(false);
  });

  it('at most one hint every few seconds', () => {
    const gate = createHintGate();
    expect(gate.allow(1000)).toBe(true);
    expect(gate.allow(1500)).toBe(false);
    expect(gate.allow(1000 + CLICK_HINT_GAP_MS - 1)).toBe(false);
    expect(gate.allow(1000 + CLICK_HINT_GAP_MS)).toBe(true);
    gate.reset();
    expect(gate.allow(1000 + CLICK_HINT_GAP_MS + 1)).toBe(true);
  });

  it('sits just above the click, kept inside the view (a phone too)', () => {
    const view = { width: 1000, height: 600 };
    expect(hintSpot({ x: 500, y: 300 }, view)).toEqual({ x: 500, y: 272 });
    expect(hintSpot({ x: 5, y: 2 }, view)).toEqual({ x: 148, y: 24 });       // top left corner: pulled in
    expect(hintSpot({ x: 995, y: 599 }, view)).toEqual({ x: 852, y: 571 });  // bottom right
    expect(hintSpot({ x: 380, y: 400 }, { width: 390, height: 844 }, { half: 120 }).x).toBe(262);
    expect(hintSpot({ x: 50, y: 50 }, { width: 200, height: 300 }).x).toBe(100); // too narrow: the middle
  });
});
