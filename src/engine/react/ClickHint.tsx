/**
 * ClickHint (v0.17.3): "Click the floor or the stairs to walk there" next to a walking click that walks
 * nowhere (a wall, a ceiling, the sky, a spot no route reaches). Small, never in the way (pointer-events
 * none), shown for CLICK_HINT_MS, its last CLICK_HINT_FADE_MS fading (none with prefers-reduced-motion).
 * The words and the once-per-few-seconds rule: play/clickHint.js. Used by <LayoutViewer> (viewer, embed)
 * and Studio's Walk through (WorkplaceEditor). Inline styles: the viewer has no stylesheet.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { CLICK_HINT_MS, CLICK_HINT_FADE_MS, hintSpot } from '../../play/clickHint';

/** One hint: its words, the click (CSS px in the view), the view's size; `id` differs for each hint. */
export interface ClickHintData {
  id: number;
  text: string;
  at: { x: number; y: number };
  view: { width: number; height: number };
}

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ClickHint({ hint }: { hint: ClickHintData | null }) {
  const [state, setState] = useState<'shown' | 'fading' | 'gone'>('gone');
  useEffect(() => {
    if (!hint) { setState('gone'); return undefined; }
    setState('shown');
    const fade = window.setTimeout(() => setState('fading'), CLICK_HINT_MS - CLICK_HINT_FADE_MS);
    const gone = window.setTimeout(() => setState('gone'), CLICK_HINT_MS);
    return () => { window.clearTimeout(fade); window.clearTimeout(gone); };
  }, [hint]);
  if (!hint || state === 'gone') return null;
  const spot = hintSpot(hint.at, hint.view, { half: Math.min(140, hint.view.width / 2 - 8) });
  const style: CSSProperties = {
    ...box,
    left: spot.x,
    top: spot.y,
    opacity: state === 'fading' ? 0 : 1,
    transition: reduced() ? 'none' : `opacity ${CLICK_HINT_FADE_MS}ms ease`,
  };
  return <div role="status" data-click-hint={state} style={style}>{hint.text}</div>;
}

const box: CSSProperties = {
  position: 'absolute', transform: 'translate(-50%, -50%)', zIndex: 5, pointerEvents: 'none',
  maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box', padding: '5px 10px', borderRadius: 8,
  background: 'rgba(17, 24, 20, 0.82)', color: '#fff', font: '500 13px/1.3 Inter, system-ui, sans-serif',
  textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
};
