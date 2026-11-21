// @vitest-environment jsdom
// v0.18.6 (Astra audit 1a): Find closes when the view is clicked or tapped, and on Esc when the focus has
// left its box (a click on the view gave the focus to the canvas). What was typed is kept for next time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaceSearch, SEARCH_LABEL } from '../react/PlaceSearch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Find closes like a menu (v0.18.6)', () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let root: Root;
  const panel = () => container.querySelector('[data-place-search]');
  const openFind = () => act(() => {
    (container.querySelector('[data-place-search-button]') as HTMLButtonElement).click();
  });
  const input = () => container.querySelector(`input[aria-label="${SEARCH_LABEL}"]`) as HTMLInputElement;
  const pointerDown = (el: Element) => act(() => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  });
  const esc = (el: Element) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });

  beforeEach(() => {
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.append(container, canvas);
    root = createRoot(container);
    act(() => root.render(<PlaceSearch engine={null} walking={false} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    canvas.remove();
  });

  it('a press on the view closes it; a press inside it does not', () => {
    openFind();
    expect(panel()).not.toBeNull();
    pointerDown(input());
    expect(panel()).not.toBeNull();
    pointerDown(canvas);
    expect(panel()).toBeNull();
  });

  it('Esc closes it when the focus is on the view, and the view keeps the focus', () => {
    openFind();
    act(() => canvas.focus());
    esc(canvas);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it('Esc in the box still closes it (the focus goes back to the Find button)', () => {
    openFind();
    act(() => input().focus());
    esc(input());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-place-search-button]'));
  });
});
