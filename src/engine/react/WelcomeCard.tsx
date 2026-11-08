/**
 * react/WelcomeCard.tsx (v0.14.6, private-docs/EXPERIENCE_PLAN.md 3.1): the card a viewer with `startMode` shows when it
 * starts walking: "Welcome to Meridian HQ" · Start the tour · Explore · Find someone. It never takes the keys: the
 * view keeps them, and a movement key, a press on the view or Esc closes it (= Explore). LayoutViewer decides when
 * it shows (startMode.chooseStart) and what each button does. The AHDUS look, as inline styles (no stylesheet).
 *
 * Compact (v0.14.7): a short view box (AHDUS's 3D Company page gives a phone about 490 px) gets a smaller title, one
 * short line and the three actions in one row with no detail lines (still read out), so it covers neither the toolbar
 * row nor the Overview button, and nothing in it needs scrolling. LayoutViewer decides by the box's own height.
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';

import { welcomeTitle, welcomeActions } from '../startMode';

export type WelcomeAction = 'tour' | 'explore' | 'find';

export interface WelcomeCardProps {
  /** The layout's name ("Welcome to …"). */
  name?: string | null;
  /** Its Start the tour / Find someone buttons (the viewer's tour / search options). */
  tour?: boolean;
  search?: boolean;
  /** The tour's size ("20 stops · about 8 min"); null: not planned yet. */
  tourDetail?: string | null;
  /** Touch words (the joystick, not the keys). */
  touch?: boolean;
  /** A narrow view (a phone): full width at the bottom, this far up (px: above the joystick or the HUD). */
  narrow?: boolean;
  bottom?: number;
  /** A short view (v0.14.7): a smaller title, one short line, the actions in one row without their detail lines. */
  compact?: boolean;
  onAction: (action: WelcomeAction) => void;
}

const DETAIL: Record<WelcomeAction, (touch: boolean) => string> = {
  tour: () => 'From the main entrance, stop by stop',
  explore: (touch) => (touch ? 'Joystick to walk, drag to look' : 'W A S D to walk, drag to look'),
  find: () => 'A person, room or place',
};
const LABEL: Record<WelcomeAction, string> = { tour: 'Start the tour', explore: 'Explore', find: 'Find someone' };
const LINE = 'You are at the main entrance. How would you like to start?';
const LINE_SHORT = 'You are at the main entrance.';
/**
 * A narrow card (at the bottom) keeps this much of the box's top clear (px): the toolbar row, on a phone two lines of
 * buttons (12 + 2 × 32 + 8), and a gap. A card still taller than what is left scrolls, never over the row.
 */
export const WELCOME_TOOLBAR_ROOM = 96;

export function WelcomeCard({
  name, tour = true, search = true, tourDetail, touch = false, narrow = false, bottom = 12, compact = false, onAction,
}: WelcomeCardProps) {
  const id = useId();
  const actions = welcomeActions({ tour, search });
  const place: CSSProperties = narrow
    ? { ...styles.narrow, bottom, maxHeight: `calc(100% - ${bottom + WELCOME_TOOLBAR_ROOM}px)` }
    : styles.wide;
  return (
    <div
      data-welcome={narrow ? 'narrow' : 'wide'}
      data-welcome-compact={compact ? '' : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-line`}
      style={{ ...styles.card, ...place, ...(compact ? styles.cardCompact : null) }}
      // a press here is the card's, not the view's (that would close it)
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={styles.head}>
        <div style={{ minWidth: 0 }}>
          <h2 id={`${id}-title`} data-welcome-title style={compact ? styles.titleCompact : styles.title}>{welcomeTitle(name)}</h2>
          <p id={`${id}-line`} style={compact ? styles.lineCompact : styles.line}>{compact ? LINE_SHORT : LINE}</p>
        </div>
        <button type="button" aria-label="Close and explore" title="Close (Esc)" style={compact ? styles.closeCompact : styles.close}
          onClick={() => onAction('explore')}>×</button>
      </div>
      <div style={compact || !narrow ? styles.list : styles.listNarrow}>
        {actions.map((a) => {
          const detail = a === 'tour' && tourDetail ? tourDetail : DETAIL[a](touch);
          const look = a === 'explore' ? styles.primary : styles.option;
          return (
            <button key={a} type="button" data-welcome-action={a} style={compact ? { ...look, ...styles.optionCompact } : look}
              title={compact ? detail : undefined} onClick={() => onAction(a)}>
              <strong style={compact ? styles.labelCompact : styles.label}>{LABEL[a]}</strong>
              {/* compact: no detail line on screen, but still read out ("Start the tour, 4 stops · about 1 min") */}
              <span style={compact ? styles.srOnly : a === 'explore' ? styles.detailOn : styles.detail}>{compact ? `, ${detail}` : detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The AHDUS look (as PlaceSearch's)
const C = {
  panel: '#ffffff', text: '#25382f', muted: '#55625a', border: '#e3e8e0', hover: '#f0f3ed',
  accent: '#28664f', accentSoft: '#eaf2e6', shadow: '0 12px 32px rgba(25, 59, 47, 0.2)',
  font: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
};
const option: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, flex: '1 1 0', minWidth: 0, padding: '10px 12px',
  boxSizing: 'border-box', textAlign: 'left', borderRadius: 12, border: `1px solid ${C.border}`, background: C.accentSoft,
  color: C.accent, font: `13px/1.3 ${C.font}`, cursor: 'pointer',
};
const styles: Record<string, CSSProperties> = {
  card: {
    position: 'absolute', zIndex: 3, display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box',
    padding: '16px 16px 14px', background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16,
    boxShadow: C.shadow, font: `14px/1.4 ${C.font}`, pointerEvents: 'auto',
  },
  wide: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 520, maxWidth: 'calc(100% - 24px)' },
  narrow: { left: 12, right: 12, overflowY: 'auto' },
  head: { display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' },
  title: { margin: 0, font: `700 18px/1.3 ${C.font}`, color: C.text, overflowWrap: 'anywhere' },
  line: { margin: '4px 0 0', fontSize: 13.5, color: C.muted },
  close: {
    flex: 'none', width: 32, height: 32, border: 'none', borderRadius: 8, background: 'transparent', color: C.muted,
    font: '20px/1 system-ui, sans-serif', cursor: 'pointer',
  },
  list: { display: 'flex', gap: 8 },
  listNarrow: { display: 'flex', flexDirection: 'column', gap: 6 },
  option,
  primary: { ...option, background: C.accent, border: `1px solid ${C.accent}`, color: '#fff' },
  label: { font: `700 14px/1.3 ${C.font}` },
  detail: { color: C.muted, overflowWrap: 'anywhere' },
  detailOn: { color: '#e4efe8', overflowWrap: 'anywhere' },
  // compact (v0.14.7): a short view box
  cardCompact: { gap: 10, padding: '10px 12px 12px', borderRadius: 14 },
  titleCompact: { margin: 0, font: `700 15px/1.3 ${C.font}`, color: C.text, overflowWrap: 'anywhere' },
  lineCompact: { margin: '2px 0 0', fontSize: 12.5, lineHeight: 1.35, color: C.muted },
  closeCompact: {
    flex: 'none', width: 28, height: 28, margin: '-4px -4px 0 0', border: 'none', borderRadius: 8, background: 'transparent',
    color: C.muted, font: '20px/1 system-ui, sans-serif', cursor: 'pointer',
  },
  optionCompact: {
    position: 'relative', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 44, padding: 6,
    gap: 0, borderRadius: 10,
  },
  labelCompact: { font: `700 13px/1.25 ${C.font}`, overflowWrap: 'anywhere' },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
};
