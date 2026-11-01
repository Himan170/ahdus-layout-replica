/**
 * ui/Dialog.jsx
 *
 * A small modal dialog (Publish, leaving with unpublished changes): a title, text and
 * buttons over a dimmed page. Focus stays inside it (Tab / Shift+Tab go round), Escape
 * is Cancel, and focus goes back where it was when it closes. While it is open no key
 * reaches Studio's shortcuts (Tab would open Preview). Styles: ui/overlays.css.
 */

import { useEffect, useId, useRef } from 'react';
import './overlays.css';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, children, actions, onCancel, label }) {
  const boxRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const before = document.activeElement;
    const box = boxRef.current;
    const first = box?.querySelector('[data-autofocus]') ?? box?.querySelector(FOCUSABLE);
    (first ?? box)?.focus();

    const onKey = (e) => {
      e.stopPropagation(); // Studio's shortcuts (Tab = Preview, 1–6, Delete…) wait until it closes
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <div className="ui-dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div
        ref={boxRef}
        className="ui-pop ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        aria-label={label}
        tabIndex={-1}
      >
        <h2 className="ui-dialog__title" id={titleId}>{title}</h2>
        <div className="ui-dialog__text" id={textId}>{children}</div>
        <div className="ui-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
