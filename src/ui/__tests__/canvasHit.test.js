// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { canvasIsUnder, pasteOverView } from '../canvasHit';

function setup() {
  document.body.innerHTML = `
    <div class="canvas-card">
      <canvas id="c"></canvas>
      <div class="room-labels"><span id="label">Office</span></div>
      <div class="camera-controls"><button id="reset" aria-label="Reset view"><svg><path id="icon"/></svg></button></div>
      <div role="toolbar" class="selection-toolbar"><span id="sep"></span></div>
    </div>`;
  const canvas = document.getElementById('c');
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 });
  return canvas;
}
const at = (id) => ({ elementFromPoint: () => (id ? document.getElementById(id) : null) });

describe('canvasIsUnder (v0.18.2: a drop over a control edits nothing)', () => {
  it('the canvas itself, or a plain overlay (a room name), is the canvas', () => {
    const canvas = setup();
    expect(canvasIsUnder(canvas, 400, 300, at('c'))).toBe(true);
    expect(canvasIsUnder(canvas, 400, 300, at('label'))).toBe(true);
  });
  it('a control over the canvas (Reset view, its icon, the selection bar) is not', () => {
    const canvas = setup();
    expect(canvasIsUnder(canvas, 400, 300, at('reset'))).toBe(false);
    expect(canvasIsUnder(canvas, 400, 300, at('icon'))).toBe(false);
    expect(canvasIsUnder(canvas, 400, 300, at('sep'))).toBe(false);
  });
  it('outside the canvas is not, whatever is there', () => {
    const canvas = setup();
    expect(canvasIsUnder(canvas, 50, 300, at('c'))).toBe(false);
    expect(canvasIsUnder(canvas, 400, 700, at('c'))).toBe(false);
  });
});

describe('pasteOverView (v0.18.9: Ctrl+V at the mouse)', () => {
  it('the canvas, a room name, the floating selection bar and its buttons are the view', () => {
    const canvas = setup();
    for (const id of ['c', 'label', 'sep', 'reset', 'icon']) expect(pasteOverView(canvas, 400, 300, at(id))).toBe(true);
  });
  it('outside the canvas, or over a panel / menu / dialog over it: not the view', () => {
    const canvas = setup();
    expect(pasteOverView(canvas, 50, 300, at('c'))).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<aside class="inspector"><input id="field"></aside><div class="ui-pop"><span id="menu"></span></div>');
    expect(pasteOverView(canvas, 400, 300, at('field'))).toBe(false);
    expect(pasteOverView(canvas, 400, 300, at('menu'))).toBe(false);
  });
});
