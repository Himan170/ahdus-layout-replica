/**
 * play/dragLook.js
 *
 * PURE (no Babylon, no DOM): looking around by dragging, and telling a click
 * from a drag (v0.14.0, private-docs/EXPERIENCE_PLAN.md 3.2). Used by
 * playController's `look: 'drag'` (a viewer's walkthrough); Studio's Preview
 * keeps pointer lock.
 *
 *   press → release within CLICK_PX and CLICK_MS                 = a click
 *   press → moved more than CLICK_PX                             = a drag: every move turns the view
 *   press held longer than CLICK_MS without moving               = nothing (not a click)
 *   two clicks within DOUBLE_CLICK_MS and DOUBLE_CLICK_PX        = a double click (the second is not a click)
 *
 * Touch (v0.14.1): a finger is a press too (`touch: true` on down). A tap may wander a little
 * further and last a little longer than a mouse click (TAP_PX, TAP_MS: fingers are never quite
 * still), and two taps are two taps, never a double click (a phone has no mouse to capture).
 *
 * Positions are in CSS pixels, times in ms; the caller passes both (tests use their own clock).
 */

/** A click: released at most this far (px) from where it was pressed… */
export const CLICK_PX = 6;
/** …and at most this long (ms) after. */
export const CLICK_MS = 250;
/** A second click this soon (ms) after the first, this close to it (px): a double click. */
export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_PX = 10;
/** A tap (touch): released at most this far (px) from where the finger went down… */
export const TAP_PX = 10;
/** …and at most this long (ms) after. */
export const TAP_MS = 500;

/** Was this press and release a click (a tap, for a press with `touch`), not a drag or a long press? */
export function isClick(down, up) {
  if (!down || !up) return false;
  const px = down.touch ? TAP_PX : CLICK_PX;
  const ms = down.touch ? TAP_MS : CLICK_MS;
  return Math.hypot(up.x - down.x, up.y - down.y) <= px && up.t - down.t <= ms;
}

/**
 * Follows one pointer at a time (the first one pressed).
 * @param {{ look: (dx:number, dy:number, touch:boolean) => void,
 *           click?: (p:{x:number,y:number,button:number,touch:boolean}) => void,
 *           doubleClick?: (p:{x:number,y:number,button:number}) => void }} handlers
 */
export function createDragLook({ look, click = () => {}, doubleClick = () => {} }) {
  let press = null; // { id, x, y, t, button, touch, lastX, lastY, dragging }
  let lastClick = null; // { x, y, t, button }

  return {
    /** A button (or a finger: touch) went down at (x, y). */
    down({ id = 0, x, y, t, button = 0, touch = false }) {
      if (press) return; // another button or pointer: the first one leads
      press = { id, x, y, t, button, touch: !!touch, lastX: x, lastY: y, dragging: false };
    },

    /** The pointer moved; true while it is a drag (the view turned). */
    move({ id = 0, x, y }) {
      if (!press || press.id !== id) return false;
      if (!press.dragging) {
        if (Math.hypot(x - press.x, y - press.y) <= (press.touch ? TAP_PX : CLICK_PX)) return false;
        press.dragging = true;
        // the few pixels held back to tell a click from a drag count too
        look(x - press.x, y - press.y, press.touch);
      } else {
        look(x - press.lastX, y - press.lastY, press.touch);
      }
      press.lastX = x;
      press.lastY = y;
      return true;
    },

    /** The button was released: 'click' | 'double' | 'drag' | null (a long press, or another pointer). */
    up({ id = 0, x, y, t }) {
      if (!press || press.id !== id) return null;
      const was = press;
      press = null;
      if (was.dragging) { lastClick = null; return 'drag'; }
      if (!isClick(was, { x, y, t })) { lastClick = null; return null; }
      const at = { x, y, button: was.button, touch: was.touch };
      if (was.touch) { lastClick = null; click(at); return 'click'; } // a tap is a tap: no double tap
      if (lastClick && lastClick.button === was.button && t - lastClick.t <= DOUBLE_CLICK_MS
        && Math.hypot(x - lastClick.x, y - lastClick.y) <= DOUBLE_CLICK_PX) {
        lastClick = null;
        doubleClick(at);
        return 'double';
      }
      lastClick = { x, y, t, button: was.button };
      click(at);
      return 'click';
    },

    /** The press ended some other way (pointercancel, the view lost the pointer). */
    cancel() {
      press = null;
    },

    /** A button is held and the pointer has moved more than CLICK_PX. */
    get dragging() {
      return !!press?.dragging;
    },
    get pressed() {
      return !!press;
    },
  };
}

// ── The joystick (v0.14.1, touch): where the knob is → how to walk ──

/** The middle part of the joystick does nothing (a resting thumb never creeps you forward): a fraction of its radius. */
export const STICK_DEAD = 0.15;

/**
 * A press on the joystick at (dx, dy) px from its centre (screen: +y is down), its radius r px →
 * { x, y, magnitude, knobX, knobY }: x = right, y = forward (−1…1, already scaled by how far it is
 * pushed past the dead zone: push further = faster), magnitude 0…1, the knob kept inside the ring.
 */
export function stickVector(dx, dy, r) {
  const d = Math.hypot(dx, dy);
  if (!(r > 0) || d < 1e-9) return { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 };
  const k = Math.min(1, r / d);
  const knobX = dx * k;
  const knobY = dy * k;
  const pushed = Math.min(1, d / r);
  const magnitude = pushed <= STICK_DEAD ? 0 : (pushed - STICK_DEAD) / (1 - STICK_DEAD);
  return { x: (dx / d) * magnitude, y: (-dy / d) * magnitude, magnitude, knobX, knobY };
}
