/**
 * ui/typing.js (v0.15.5)
 *
 * Is a key meant for a text field, a dropdown or a search box? Then Studio's shortcuts leave it
 * alone (Page Up / Down, Delete, Ctrl+C / Ctrl+V, …): the field gets its own copy and paste.
 */

/** @param {EventTarget | null} target */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName ?? '').toUpperCase();
  // every input (as before v0.15.5: a slider or a checkbox too), text areas and dropdowns
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'listbox';
}
