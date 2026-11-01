/**
 * ui/Toast.jsx
 *
 * One short message at the top of the page: green check (tone 'ok') or red warning
 * (tone 'bad'), an optional link, a close button. It goes after `duration` ms (about
 * 6 s); a new toast replaces the old one. Screen readers announce it: the live region
 * is always there, errors are role="alert". Styles: ui/overlays.css.
 *
 * toast = { id, tone: 'ok' | 'bad', text, link?: { href, label } } (a new id restarts the timer)
 */

import { useEffect, useRef } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import './overlays.css';

export const TOAST_MS = 6000;

export default function Toast({ toast, onClose, duration = TOAST_MS }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = toast?.id;

  useEffect(() => {
    if (id == null || !duration) return undefined;
    const timer = setTimeout(() => closeRef.current?.(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration]);

  const bad = toast?.tone === 'bad';
  return (
    <div className="ui-toast-region" aria-live="polite" aria-atomic="true">
      {toast && (
        <div className={`ui-pop ui-toast${bad ? ' is-bad' : ' is-ok'}`} role={bad ? 'alert' : 'status'} data-toast={toast.tone}>
          {bad
            ? <AlertTriangle size={18} strokeWidth={1.75} aria-hidden className="ui-toast__icon" />
            : <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden className="ui-toast__icon" />}
          <p className="ui-toast__text">
            {toast.text}
            {toast.link && (
              <>
                {' '}
                <a className="ui-toast__link" href={toast.link.href}>{toast.link.label}</a>
              </>
            )}
          </p>
          <button className="ui-icon-btn ui-toast__close" aria-label="Close message" title="Close"
            onClick={() => onClose?.(toast.id)}>
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
