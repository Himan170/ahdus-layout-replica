// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { tabEntersPreview, setFocusByKeyboard } from '../useStudioKeyboard';

describe('Tab and Walk through (v0.18.2)', () => {
  afterEach(() => { document.body.innerHTML = ''; setFocusByKeyboard(false); });

  it('goes to Walk through from the 3D view or with nothing focused', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    expect(tabEntersPreview(canvas)).toBe(true);
    expect(tabEntersPreview(document.body)).toBe(true);
    expect(tabEntersPreview(null)).toBe(true);
    setFocusByKeyboard(true);
    expect(tabEntersPreview(canvas)).toBe(true);
  });

  it('a button clicked with the mouse keeps the shortcut', () => {
    const b = document.createElement('button');
    document.body.append(b);
    setFocusByKeyboard(false);
    expect(tabEntersPreview(b)).toBe(true);
  });

  it('a button reached with the keyboard moves the focus on', () => {
    const b = document.createElement('button');
    document.body.append(b);
    setFocusByKeyboard(true);
    expect(tabEntersPreview(b)).toBe(false);
  });

  it('with a popover open Tab moves the focus, even after a click', () => {
    const b = document.createElement('button');
    const pop = document.createElement('div');
    pop.className = 'ui-pop';
    document.body.append(b, pop);
    expect(tabEntersPreview(b)).toBe(false);
    const inner = document.createElement('button');
    pop.append(inner);
    expect(tabEntersPreview(inner)).toBe(false);
  });
});
