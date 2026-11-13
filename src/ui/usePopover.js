/**
 * ui/usePopover.js
 *
 * Shared behaviour for menus and popovers: Esc or a click outside
 * closes them. Esc is caught before the editor's own shortcuts, so closing a
 * menu doesn't also leave the active tool.
 */

import { useEffect } from 'react';
import { isComposing } from '../utils/keys';

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {Array<React.RefObject<HTMLElement>>} insideRefs  clicks inside these don't close it
 */
export function usePopover(open, onClose, insideRefs) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || isComposing(e)) return; // an IME's Esc drops its word, not the popover
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    const onPointer = (e) => {
      const inside = insideRefs.some((r) => r.current && r.current.contains(e.target));
      if (!inside) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
    // insideRefs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}
