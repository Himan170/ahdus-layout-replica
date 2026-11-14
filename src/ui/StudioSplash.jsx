/**
 * ui/StudioSplash.jsx
 *
 * The full-screen loading screen of Workplace Studio (all modes), v0.17.2: ONE screen from the click to Studio
 * ready. index.html draws the same markup from the first paint (#boot-splash, before this JS has arrived), the
 * 3D Company page draws it while it creates a workplace, and this component takes over in the same place. The
 * name, then the steps (ui/splashSteps.js): "Creating your workplace" (after Create a workplace) → "Loading
 * Studio…" → "Ready". App shows it until the layout is loaded AND the editor has drawn its first full frame
 * (ui/firstFrame.js), then it fades out over FADE_MS (at once with prefers-reduced-motion). If opening fails it
 * becomes the error card, with "Try again" (and a way back), never an endless spinner. Styles: ui/splash.css
 * (light AHDUS look; dark only when AHDUS is in dark mode: `theme`).
 *
 * phase: 'loading' | 'done' | 'error'
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Building2, RotateCcw } from 'lucide-react';
import { splashSteps, splashStatus } from './splashSteps';
import './splash.css';

export const FADE_MS = 300;

/** How long the fade-out lasts (0: the user asked the system for less motion). */
export function splashFadeMs(win = typeof window !== 'undefined' ? window : null) {
  try {
    if (win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch { /* no matchMedia: fade */ }
  return FADE_MS;
}

export default function StudioSplash({
  phase, ahdus = false, created = false, theme = 'light', text = null, newName = null,
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

  const brand = (
    <div className="studio-splash__brand">
      <span className="studio-splash__logo" aria-hidden><Building2 strokeWidth={1.75} /></span>
      <div className="studio-splash__name">
        {ahdus && <span className="studio-splash__ahdus">AHDUS</span>}
        <span>Workplace Studio</span>
      </div>
    </div>
  );

  if (phase === 'error') {
    return (
      <div className="studio-splash is-error" role="alert" data-splash="error" data-splash-theme={theme}>
        {brand}
        <div className="studio-splash__card">
          <AlertTriangle strokeWidth={1.75} aria-hidden />
          <h1 className="studio-splash__title">{errorTitle}</h1>
          {error && <p className="studio-splash__text">{error}</p>}
          <div className="studio-splash__buttons">
            {onRetry && (
              <button type="button" className="studio-splash__button is-primary" onClick={onRetry} autoFocus>
                <RotateCcw strokeWidth={1.75} aria-hidden /> Try again
              </button>
            )}
            {onBack && (
              <button type="button" className="studio-splash__button" onClick={onBack}>
                <ArrowLeft strokeWidth={1.75} aria-hidden /> {backLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const steps = splashSteps({ created, phase: leaving ? 'done' : 'loading' });
  return (
    <div
      className={`studio-splash${leaving ? ' is-leaving' : ''}`}
      style={{ '--splash-fade': `${FADE_MS}ms` }}
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
      aria-label={text ?? splashStatus(steps)}
      data-splash={leaving ? 'leaving' : 'loading'}
      data-splash-theme={theme}
    >
      {brand}
      {text ? (
        <ol className="studio-splash__steps">
          <li className="studio-splash__step" data-step="login" data-step-state="active">
            <span className="studio-splash__mark" aria-hidden />{text}
          </li>
        </ol>
      ) : (
        <ol className="studio-splash__steps">
          {steps.map((s) => (
            <li key={s.key} className="studio-splash__step" data-step={s.key} data-step-state={s.state}>
              <span className="studio-splash__mark" aria-hidden />{s.label}
            </li>
          ))}
        </ol>
      )}
      {created && newName && (
        <p className="studio-splash__hint" data-splash-hint>
          <strong>{newName}</strong> is ready. To rename it, click its name in Studio&apos;s top bar.
        </p>
      )}
    </div>
  );
}
