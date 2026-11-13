/**
 * utils/keys.js (v0.16.2)
 *
 * Keys in a text field while an IME is composing (Hindi, Japanese, Chinese input tools …): the
 * Enter that picks a word, the Esc that drops it and the arrows that choose one belong to the IME,
 * not to us. Acting on them saved names half typed. Pure, no React: the viewer and the embed use it
 * too. Works on DOM events and React's (React's has no `isComposing`: its `nativeEvent` does).
 */

/**
 * Is an IME composing text while this key is pressed? (`keyCode` 229 = Safari's and old browsers'
 * way of saying so: their keydown ends a composition with `isComposing` already false.)
 * @param {{ isComposing?: boolean, keyCode?: number, nativeEvent?: { isComposing?: boolean } } | null | undefined} e
 * @returns {boolean}
 */
export function isComposing(e) {
  if (!e) return false;
  return Boolean(e.isComposing || e.nativeEvent?.isComposing) || e.keyCode === 229;
}

/**
 * Enter that commits what was typed (save, pick, done), never one that ends an IME composition.
 * @param {{ key?: string, isComposing?: boolean, keyCode?: number, nativeEvent?: { isComposing?: boolean } } | null | undefined} e
 * @returns {boolean}
 */
export function isCommitEnter(e) {
  return !!e && e.key === 'Enter' && !isComposing(e);
}
