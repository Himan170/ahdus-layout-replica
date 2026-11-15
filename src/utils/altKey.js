/**
 * utils/altKey.js
 *
 * Is Alt held right now? (v0.17.4: Alt = place the stairs exactly where they are dropped.) Kept from
 * the window's key and pointer events, so a drop from the library or a click on the canvas both know.
 */

let down = false;
let installed = false;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const key = (e) => { if (e.key === 'Alt') down = e.type === 'keydown'; };
  const pointer = (e) => { down = !!e.altKey; };
  window.addEventListener('keydown', key, true);
  window.addEventListener('keyup', key, true);
  window.addEventListener('pointermove', pointer, true);
  window.addEventListener('pointerdown', pointer, true);
  window.addEventListener('pointerup', pointer, true);
  window.addEventListener('blur', () => { down = false; });
}

install();

export function isAltDown() {
  install();
  return down;
}
