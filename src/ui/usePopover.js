/**
 * ui/usePopover.js
 *
 * Shared behaviour for menus and popovers: Esc or a click outside
 * closes them. Esc is caught before the editor's own shortcuts, so closing a
 * menu doesn't also leave the active tool. v0.18.2: one Esc closes one level: only the popover opened
 * last (Settings opened from the phone's More menu) takes it; the next Esc closes the one under it.
 */

import { useEffect, useRef } from 'react';
import { isComposing } from '../utils/keys';

/** The open popovers, the one opened last at the end. */
const openStack = [];
/** How many popovers are open (tests). */
export const openPopovers = () => openStack.length;

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {Array<React.RefObject<HTMLElement>>} insideRefs  clicks inside these don't close it
 */
export function usePopover(open, onClose, insideRefs) {
  // the latest onClose, so a new function on a re-render never moves this popover in the stack
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return undefined;
    const entry = {};
    openStack.push(entry);
    const onKey = (e) => {
      if (e.key !== 'Escape' || isComposing(e)) return; // an IME's Esc drops its word, not the popover
      if (openStack[openStack.length - 1] !== entry) return; // a popover opened over this one takes it
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
    };
    const onPointer = (e) => {
      const inside = insideRefs.some((r) => r.current && r.current.contains(e.target));
      if (!inside) closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      const i = openStack.indexOf(entry);
      if (i >= 0) openStack.splice(i, 1);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
    // insideRefs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
