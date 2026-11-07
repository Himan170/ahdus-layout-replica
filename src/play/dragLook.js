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
 * Positions are in CSS pixels, times in ms; the caller passes both (tests use their own clock).
 */

/** A click: released at most this far (px) from where it was pressed… */
export const CLICK_PX = 6;
/** …and at most this long (ms) after. */
export const CLICK_MS = 250;
/** A second click this soon (ms) after the first, this close to it (px): a double click. */
export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_PX = 10;

/** Was this press and release a click (not a drag, not a long press)? */
export function isClick(down, up) {
  if (!down || !up) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_PX && up.t - down.t <= CLICK_MS;
}

/**
 * Follows one pointer at a time (the first one pressed).
 * @param {{ look: (dx:number, dy:number) => void, click?: (p:{x:number,y:number,button:number}) => void,
 *           doubleClick?: (p:{x:number,y:number,button:number}) => void }} handlers
 */
export function createDragLook({ look, click = () => {}, doubleClick = () => {} }) {
  let press = null; // { id, x, y, t, button, lastX, lastY, dragging }
  let lastClick = null; // { x, y, t, button }

  return {
    /** A button went down at (x, y). */
    down({ id = 0, x, y, t, button = 0 }) {
      if (press) return; // another button or pointer: the first one leads
      press = { id, x, y, t, button, lastX: x, lastY: y, dragging: false };
    },

    /** The pointer moved; true while it is a drag (the view turned). */
    move({ id = 0, x, y }) {
      if (!press || press.id !== id) return false;
      if (!press.dragging) {
        if (Math.hypot(x - press.x, y - press.y) <= CLICK_PX) return false;
        press.dragging = true;
        // the few pixels held back to tell a click from a drag count too
        look(x - press.x, y - press.y);
      } else {
        look(x - press.lastX, y - press.lastY);
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
      const at = { x, y, button: was.button };
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
