/**
 * ui/StudioSplash.jsx
 *
 * The full-screen loading screen of Workplace Studio (all modes): the name, a spinner
 * and "Opening Workplace Studio…" (inside AHDUS the brand reads "AHDUS", as in the top
 * bar). App shows it until the layout is loaded AND the editor has drawn its first
 * full frame (ui/firstFrame.js), then it fades out over FADE_MS (at once with
 * prefers-reduced-motion). If opening fails it becomes the error card, with "Try
 * again" (and a way back), never an endless spinner. Styles: ui/overlays.css.
 *
 * phase: 'loading' | 'done' | 'error'
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Building2, RotateCcw } from 'lucide-react';
import './overlays.css';

export const FADE_MS = 300;

/** How long the fade-out lasts (0: the user asked the system for less motion). */
export function splashFadeMs(win = typeof window !== 'undefined' ? window : null) {
  try {
    if (win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch { /* no matchMedia: fade */ }
  return FADE_MS;
}

export default function StudioSplash({
  phase, ahdus = false, text = 'Opening Workplace Studio…',
  errorTitle = 'Workplace Studio could not be opened', error, onRetry, onBack, backLabel,
}) {
  const [gone, setGone] = useState(false);
  const leaving = phase === 'done';

  useEffect(() => {
    if (!leaving) { setGone(false); return undefined; }
    const ms = splashFadeMs();
    if (!ms) { setGone(true); return undefined; }
    const timer = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (leaving && gone) return null;

  if (phase === 'error') {
    return (
      <div className="studio-splash is-error" role="alert" data-splash="error">
        <div className="editor-error__card">
          <AlertTriangle size={28} strokeWidth={1.75} aria-hidden className="editor-error__icon" />
          <h1 className="editor-error__title">{errorTitle}</h1>
          {error && <p className="editor-error__text">{error}</p>}
          <div className="studio-splash__actions">
            {onRetry && (
              <button className="ui-btn is-primary" onClick={onRetry} autoFocus>
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden /> Try again
              </button>
            )}
            {onBack && (
              <button className="ui-btn" onClick={onBack}>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> {backLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`studio-splash${leaving ? ' is-leaving' : ''}`}
      style={{ '--splash-fade': `${FADE_MS}ms` }}
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
      data-splash={leaving ? 'leaving' : 'loading'}
    >
      <div className="studio-splash__brand">
        <Building2 size={40} strokeWidth={1.5} aria-hidden className="studio-splash__logo" />
        <div className="studio-splash__name">
          {ahdus && <span className="studio-splash__ahdus">AHDUS</span>}
          <span>Workplace Studio</span>
        </div>
      </div>
      <div className="studio-splash__spinner" aria-hidden />
      <p className="studio-splash__text">{leaving ? 'Ready' : text}</p>
    </div>
  );
}
