/**
 * ui/canvasHit.js (v0.18.2)
 *
 * Is the 3D canvas really under a screen point, or is a control drawn over it there (Reset view, the
 * selection bar, a menu, the Inspector)? A library drop or a placement released over a control must
 * not edit the layout behind it. Elements that let the mouse through (pointer-events: none: room
 * labels, measurement labels, the drop hint) are skipped by elementFromPoint itself.
 * Tests: ui/__tests__/canvasHit.test.js.
 */

/** What counts as a control over the canvas. */
export const CONTROL_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', '[contenteditable="true"]',
  '[role="button"]', '[role="toolbar"]', '[role="menu"]', '[role="menuitem"]', '[role="dialog"]',
  '[role="listbox"]', '[role="slider"]', '[role="tablist"]', '[role="group"]',
  'aside', 'header', 'nav', '.ui-pop',
].join(', ');

/**
 * true: a press / release at client (x, y) reaches the canvas (it is the topmost element there, or the
 * topmost element is a plain overlay that is not a control); false: outside the canvas or over a control.
 */
export function canvasIsUnder(canvas, clientX, clientY, doc = globalThis.document) {
  if (!canvas || !doc) return false;
  const r = canvas.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(clientX, clientY) : null;
  if (!hit || hit === canvas) return true; // nothing reported (jsdom) or the canvas itself
  if (canvas.contains?.(hit)) return true;
  return !hit.closest?.(CONTROL_SELECTOR);
}

/** What hides the view for a paste: panels, menus, dialogs (the view's own floating bar and buttons do not). */
export const PANEL_SELECTOR = [
  'aside', 'header', 'nav', '.ui-pop', '[role="dialog"]', '[role="menu"]', '[role="listbox"]',
  '.inspector',
].join(', ');

/**
 * v0.18.9: is the mouse at client (x, y) over the view, for Ctrl+V "at the mouse"? Inside the canvas and not over
 * a panel, menu or dialog. The selection bar floating over the view, room labels and the hover card are the view:
 * a paste with the mouse on them still goes to the floor under the mouse (it went 0.5 m aside of the copy).
 */
export function pasteOverView(canvas, clientX, clientY, doc = globalThis.document) {
  if (!canvas || !doc) return false;
  const r = canvas.getBoundingClientRect();
  if (!(r.width > 0) || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(clientX, clientY) : null;
  if (!hit || hit === canvas) return true;
  return !hit.closest?.(PANEL_SELECTOR);
}
