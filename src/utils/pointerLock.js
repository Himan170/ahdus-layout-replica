// Asks the browser to lock the mouse to an element, quietly.
// Browsers may refuse (a click right after Esc, an embedded frame, a page that isn't focused): today's browsers
// then REJECT the promise requestPointerLock returns, and a rejection nobody catches is a red "Uncaught (in promise)"
// in the console. A refusal isn't an error for us: the next click asks again. Older browsers return nothing or throw.

/** Requests pointer lock on `element`; resolves true when the browser accepted, false when it refused or can't. */
export function lockPointer(element) {
  if (!element || typeof element.requestPointerLock !== 'function') return Promise.resolve(false);
  try {
    const asked = element.requestPointerLock();
    if (asked && typeof asked.then === 'function') return asked.then(() => true, () => false);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}
