// @vitest-environment jsdom
// Easy controls in a viewer's walkthrough (v0.14.0, private-docs/EXPERIENCE_PLAN.md 3.2): the keys work
// as soon as walking starts and after the view's own buttons, never while typing; drag to look; a plain
// click is a click; double-click / L = mouse look, the first Esc releases the mouse, the next the keys.
// Touch (v0.14.1): a finger drags to look, a tap is a click, the joystick (setStick) walks.
// The real controller (play/playController.js) on a NullEngine scene. e2e/controls-smoke.mjs does it in Chrome.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Collisions/collisionCoordinator'; // walking collides (SceneSetup imports it in the app)

import { WalkthroughSystem, isTextField } from '../systems/WalkthroughSystem';
import { createPlayController } from '../../play/playController';
import { FLY_SPEED, RUN_SPEED, WALK_SPEED } from '../../play/speeds';

const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
const world = { rooms: {}, objects: {}, floors, currentFloor: 0, anchorData: {} } as any;

let engine: NullEngine;
let scene: Scene;
let canvas: HTMLCanvasElement;
let box: HTMLDivElement;
let button: HTMLButtonElement;
let pageInput: HTMLInputElement;
let lockEl: Element | null = null;
const systems: { dispose(): void }[] = [];

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  engine.getDeltaTime = () => 100; // 0.1 s a frame
  MeshBuilder.CreateGround('ground', { width: 200, height: 200 }, scene);
  box = document.createElement('div');
  canvas = document.createElement('canvas');
  button = document.createElement('button');
  button.textContent = 'Back to entrance';
  box.append(canvas, button);
  pageInput = document.createElement('input');
  document.body.append(box, pageInput);
  // pointer lock as a browser does it
  lockEl = null;
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => lockEl });
  (canvas as any).requestPointerLock = vi.fn(() => {
    lockEl = canvas;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  });
  (document as any).exitPointerLock = vi.fn(() => {
    lockEl = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  });
});

afterEach(() => {
  while (systems.length) systems.pop()!.dispose();
  scene.dispose();
  engine.dispose();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function walk(callbacks = {}) {
  const w = new WalkthroughSystem(scene, canvas, () => world, () => null, callbacks, box);
  systems.push(w);
  w.activate();
  w.setPose({ x: 0, z: -20, yaw: 0, pitch: -0.3 });
  return w;
}
const key = (code: string, type = 'keydown', target: EventTarget = document.activeElement ?? document.body) => {
  const e = new KeyboardEvent(type, { code, key: code === 'Escape' ? 'Escape' : code, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
/** Hold a key for a few frames: how far the character went. */
function hold(w: WalkthroughSystem, code: string, frames = 3, target?: EventTarget) {
  const from = w.getPosition();
  key(code, 'keydown', target);
  for (let i = 0; i < frames; i++) scene.render();
  key(code, 'keyup', target);
  scene.render();
  const to = w.getPosition();
  return Math.hypot(to.x - from.x, to.z - from.z);
}
const pointer = (type: string, x: number, y: number, more: Record<string, unknown> = {}) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...more });
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'mouse', ...more })) Object.defineProperty(e, k, { value: v });
  canvas.dispatchEvent(e);
};

describe('isTextField', () => {
  it('text inputs, text areas, selects and editable text are; buttons, checkboxes and divs are not', () => {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild!; };
    expect(isTextField(el('<input>'))).toBe(true);
    expect(isTextField(el('<input type="search">'))).toBe(true);
    expect(isTextField(el('<textarea></textarea>'))).toBe(true);
    expect(isTextField(el('<select></select>'))).toBe(true);
    expect(isTextField(el('<input type="checkbox">'))).toBe(false);
    expect(isTextField(el('<button>x</button>'))).toBe(false);
    expect(isTextField(el('<div></div>'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe('the keys (v0.14.0)', () => {
  it('walking starts with the keys: the view takes the focus and W walks, with no click', () => {
    const w = walk();
    expect(document.activeElement).toBe(box);
    expect(box.tabIndex).toBe(0); // focusable, one Tab stop
    expect(w.isEngaged()).toBe(true);
    expect(hold(w, 'KeyW')).toBeGreaterThan(0.5);
    expect(lockEl).toBeNull(); // the mouse is never captured by itself
  });

  it('never while typing: a text field on the page keeps the focus at start; W typed there doesn\'t walk', () => {
    pageInput.focus();
    const w = walk();
    expect(document.activeElement).toBe(pageInput);
    expect(hold(w, 'KeyW', 3, pageInput)).toBe(0);
    // even with the mouse over the view
    box.dispatchEvent(new MouseEvent('pointerenter'));
    expect(w.isEngaged()).toBe(true);
    expect(hold(w, 'KeyW', 3, pageInput)).toBe(0);
  });

  it('a click on one of the view\'s own buttons gives the keys back to the view; a keyboard press keeps the focus on it', () => {
    vi.useFakeTimers();
    const w = walk();
    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(box);
    expect(hold(w, 'KeyW')).toBeGreaterThan(0.5);
    // Enter / Space on a focused button (detail 0): the focus stays, so Tab goes on from there
    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(button);
  });

  it('a button that opened a text field (Find): the focus stays in the field', () => {
    vi.useFakeTimers();
    walk();
    const field = document.createElement('input');
    box.append(field);
    button.addEventListener('click', () => field.focus());
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(field);
  });

  it('arrows walk and stop the page from scrolling only while the view is engaged', () => {
    const w = walk();
    expect(key('ArrowUp').defaultPrevented).toBe(true);
    key('ArrowUp', 'keyup');
    (document.activeElement as HTMLElement).blur();
    expect(w.isEngaged()).toBe(false);
    expect(key('ArrowDown', 'keydown', document.body).defaultPrevented).toBe(false);
    expect(key('Space', 'keydown', document.body).defaultPrevented).toBe(false);
    expect(hold(w, 'KeyW', 3, document.body)).toBe(0);
  });

  it('the mouse over the view gives it the keys; Esc gives them back until the mouse leaves and comes back', () => {
    const w = walk();
    box.dispatchEvent(new MouseEvent('pointerenter'));
    key('Escape');
    expect(document.activeElement).not.toBe(box);
    expect(w.isEngaged()).toBe(false); // the mouse is still over it, but Esc said "give the keys back"
    expect(hold(w, 'KeyW', 3, document.body)).toBe(0);
    box.dispatchEvent(new MouseEvent('pointerleave'));
    box.dispatchEvent(new MouseEvent('pointerenter'));
    expect(w.isEngaged()).toBe(true);
    expect(hold(w, 'KeyW', 3, document.body)).toBeGreaterThan(0.5);
  });

  it('a press on the view takes the keys back (no mouse capture)', () => {
    const w = walk();
    (document.activeElement as HTMLElement).blur();
    pointer('pointerdown', 10, 10);
    expect(document.activeElement).toBe(box);
    expect(lockEl).toBeNull();
    pointer('pointerup', 10, 10);
    expect(w.isEngaged()).toBe(true);
  });
});

describe('the mouse (v0.14.0)', () => {
  it('drag to look: the view turns, the mouse is not captured, and it is not a click', () => {
    const onPointClick = vi.fn();
    const w = walk({ onPointClick });
    const yaw = w.getYaw();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);
    expect(w.getYaw()).toBeGreaterThan(yaw + 0.2); // dragging right turns right
    expect(lockEl).toBeNull();
    expect(onPointClick).not.toHaveBeenCalled();
  });

  it('a plain click tells what is under it: on the ground, where to walk', () => {
    const onPointClick = vi.fn();
    walk({ onPointClick });
    scene.render(); // the camera behind the character
    const h = engine.getRenderHeight();
    pointer('pointerdown', engine.getRenderWidth() / 2, h - 5);
    pointer('pointerup', engine.getRenderWidth() / 2, h - 5);
    expect(onPointClick).toHaveBeenCalledTimes(1);
    const click = onPointClick.mock.calls[0][0];
    expect(click.kind).toBe('ground');
    expect(click.target).toBeNull();
    expect(click.walkTo).toMatchObject({ floor: 0 });
    expect(click.walkTo.z).toBeGreaterThan(-25);
    expect(click.walkTo.z).toBeLessThan(-15);
  });

  it('double-click: mouse-look mode (the mouse is captured); the first Esc releases it, the keys stay; the next Esc gives them back', () => {
    const onDoubleClick = vi.fn();
    const w = walk({ onDoubleClick });
    for (let i = 0; i < 2; i++) { pointer('pointerdown', 50, 50); pointer('pointerup', 50, 50); }
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
    expect(lockEl).toBe(canvas);
    expect(w.isMouseLocked()).toBe(true);
    key('Escape');
    expect(lockEl).toBeNull();
    expect(document.activeElement).toBe(box); // still walking with the keys
    expect(hold(w, 'KeyW')).toBeGreaterThan(0.5);
    // the browser released the mouse itself on Esc (and then sent the key): the keys stay too
    w.lockMouse();
    (document as any).exitPointerLock();
    key('Escape');
    expect(document.activeElement).toBe(box);
    w.setPose({ x: 0, z: -20 }); // (time moves on)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    key('Escape');
    expect(document.activeElement).not.toBe(box);
  });

  it('L switches mouse-look mode on and off', () => {
    const w = walk();
    key('KeyL');
    expect(w.isMouseLocked()).toBe(true);
    key('KeyL');
    expect(w.isMouseLocked()).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('Esc while a route is followed only ends it: the view keeps the keys', () => {
    const w = walk();
    const pilot = { drive: () => null, key: vi.fn((code: string) => code === 'Escape') };
    w.setAutopilot(pilot);
    key('Escape');
    expect(pilot.key).toHaveBeenCalledWith('Escape');
    expect(document.activeElement).toBe(box);
  });
});

describe('touch (v0.14.1)', () => {
  it('a finger drags to look (further than with the mouse per pixel); it is not a click, nothing is captured', () => {
    const onPointClick = vi.fn();
    const w = walk({ onPointClick });
    const yaw = w.getYaw();
    pointer('pointerdown', 100, 100, { pointerType: 'touch' });
    pointer('pointermove', 140, 100, { pointerType: 'touch' });
    pointer('pointermove', 200, 100, { pointerType: 'touch' });
    pointer('pointerup', 200, 100, { pointerType: 'touch' });
    const touchTurn = w.getYaw() - yaw;
    expect(touchTurn).toBeGreaterThan(0.3);
    expect(onPointClick).not.toHaveBeenCalled();
    expect(lockEl).toBeNull();
    const before = w.getYaw();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);
    expect(w.getYaw() - before).toBeLessThan(touchTurn); // the mouse turns less per pixel
  });

  it('a tap is a click (the floor: where to walk); two taps never capture the mouse', () => {
    const onPointClick = vi.fn();
    const onDoubleClick = vi.fn();
    walk({ onPointClick, onDoubleClick });
    scene.render();
    const x = engine.getRenderWidth() / 2;
    const y = engine.getRenderHeight() - 5;
    for (let i = 0; i < 2; i++) {
      pointer('pointerdown', x, y, { pointerType: 'touch' });
      pointer('pointerup', x + 4, y + 3, { pointerType: 'touch' }); // a finger wanders a little
    }
    expect(onPointClick).toHaveBeenCalledTimes(2);
    expect(onPointClick.mock.calls[0][0]).toMatchObject({ kind: 'ground', walkTo: { floor: 0 } });
    expect(onDoubleClick).not.toHaveBeenCalled();
    expect(lockEl).toBeNull();
  });

  it('the joystick walks: forward, further = faster, let go = stop', () => {
    const w = walk();
    const go = (x: number, y: number, frames = 5) => {
      const from = w.getPosition();
      w.setStick(x, y);
      for (let i = 0; i < frames; i++) scene.render();
      const to = w.getPosition();
      return { d: Math.hypot(to.x - from.x, to.z - from.z), dz: to.z - from.z, dx: to.x - from.x };
    };
    scene.render();
    const full = go(0, 1);
    expect(full.dz).toBeCloseTo(WALK_SPEED * 0.5, 1); // yaw 0 = +Z: forward; its top speed = the walking speed, for 0.5 s
    const half = go(0, 0.5);
    expect(half.d).toBeGreaterThan(0.25);
    expect(half.d).toBeLessThan(full.d * 0.7);
    expect(go(1, 0).dx).toBeCloseTo(WALK_SPEED * 0.5, 1); // right
    expect(go(0, 0).d).toBeLessThan(0.01); // let go
    w.setStick(5, 5); // too far: as far as it goes
    expect(Math.hypot(w.getStick().x, w.getStick().y)).toBeCloseTo(1);
  });

  it('the speeds (v0.14.5): one set of constants, W, Shift + W and flying', () => {
    expect([WALK_SPEED, RUN_SPEED, FLY_SPEED]).toEqual([2.2, 4.5, 6]);
    const w = walk();
    scene.render();
    expect(hold(w, 'KeyW', 5)).toBeCloseTo(WALK_SPEED * 0.5, 1);
    key('ShiftLeft');
    expect(hold(w, 'KeyW', 5)).toBeCloseTo(RUN_SPEED * 0.5, 1);
    key('ShiftLeft', 'keyup');
    key('KeyF'); // fly
    key('KeyF', 'keyup');
    expect(w.isFlying?.() ?? true).toBe(true);
    expect(hold(w, 'KeyW', 5)).toBeCloseTo(FLY_SPEED * 0.5, 1);
  });

  it('the joystick works without the keys (a phone has none) and counts as moving: a route pauses', () => {
    const w = walk();
    (document.activeElement as HTMLElement | null)?.blur();
    const frames: { userMoving: boolean }[] = [];
    w.setAutopilot({ drive: (_dt: number, me: { userMoving: boolean }) => { frames.push(me); return null; }, key: () => false } as any);
    const from = w.getPosition();
    w.setStick(0, 1);
    scene.render();
    expect(frames.at(-1)?.userMoving).toBe(true);
    expect(w.getPosition().z).toBeGreaterThan(from.z);
    w.setStick(0, 0);
    scene.render();
    expect(frames.at(-1)?.userMoving).toBe(false);
  });

  it('touch words: the HUD line says joystick, drag, tap', () => {
    const huds: any[] = [];
    const w = walk({ onHud: (h: unknown) => huds.push(h) });
    scene.render();
    expect(huds.at(-1).hint.detail).toMatch(/W A S D/);
    w.setTouch(true);
    scene.render();
    expect(huds.at(-1).hint.detail).toMatch(/^Joystick to walk, drag to look, tap the floor/);
    expect(huds.at(-1).hint.detail).not.toMatch(/W A S D|click|E uses/);
    w.setTouch(false);
    scene.render();
    expect(huds.at(-1).hint.detail).toMatch(/W A S D/);
  });

  it('walking ends: the joystick is let go', () => {
    const w = walk();
    w.setStick(0, 1);
    w.deactivate();
    expect(w.getStick()).toEqual({ x: 0, y: 0 });
  });
});

describe('the tour’s stop view (v0.14.4)', () => {
  it('the camera eases higher and further back, looking a little more down; off: back to the usual camera', () => {
    const w = walk();
    w.setPose({ x: 0, z: -20, yaw: 0, pitch: -0.12 });
    scene.render();
    const cam = () => scene.activeCamera!.position.clone();
    const usual = cam();
    w.setStopView(true);
    scene.render();
    const easing = cam();
    for (let i = 0; i < 40; i++) scene.render();
    const stop = cam();
    expect(easing.y).toBeGreaterThan(usual.y); // on its way, not there at once
    expect(easing.y).toBeLessThan(stop.y);
    expect(stop.y - usual.y).toBeGreaterThan(0.8); // higher
    expect(usual.z - stop.z).toBeGreaterThan(1); // further back (facing +Z: behind is −Z)
    const t = (scene.activeCamera as any).getTarget();
    expect(t.y - stop.y).toBeLessThan(Math.sin(-0.12) - 0.1); // looking further down than the walker
    w.setStopView(false, true); // reduced motion: at once
    scene.render();
    expect(cam().subtract(usual).length()).toBeLessThan(0.01);
  });
});

describe("Studio's Preview keeps pointer lock (look 'lock')", () => {
  it('a press asks for the mouse; dragging without it doesn\'t turn the view; no clicks reported', () => {
    const onPointClick = vi.fn();
    const play = createPlayController(scene, canvas, {
      getState: () => ({ rooms: [], objects: [], floors, currentFloor: 0 }), actions: {}, onPointClick,
    } as any);
    systems.push(play);
    play.activate(); // Preview captures the mouse as it starts
    expect((canvas as any).requestPointerLock).toHaveBeenCalledTimes(1);
    (document as any).exitPointerLock();
    const yaw = play.getYaw();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);
    expect(play.getYaw()).toBe(yaw);
    expect(onPointClick).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect((canvas as any).requestPointerLock).toHaveBeenCalledTimes(2);
  });
});
