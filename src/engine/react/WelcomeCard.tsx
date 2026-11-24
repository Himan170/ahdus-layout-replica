/**
 * react/WelcomeCard.tsx (v0.14.6, private-docs/EXPERIENCE_PLAN.md 3.1): the card a viewer with `startMode` shows when it
 * starts walking: "Welcome to Meridian HQ" · Start the tour · Explore · Find someone. It never takes the keys: the
 * view keeps them, and a movement key, a press on the view or Esc closes it (= Explore). LayoutViewer decides when
 * it shows (startMode.chooseStart) and what each button does. The AHDUS look, as inline styles (no stylesheet).
 *
 * Compact (v0.14.7): a short view box (AHDUS's 3D Company page gives a phone about 490 px) gets a smaller title and
 * smaller lines, so it never covers the toolbar row and nothing in it needs scrolling. LayoutViewer decides by the box's
 * own height.
 *
 * v0.17.1 ("simple"): Explore is the main button; "Start the tour" (its stops and minutes) a second, smaller one: the
 * tour is what a new joiner (and a demo) wants first. It is in More too; Find starts from the toolbar only (the card says
 * where). On a first visit it also says how to walk (the keys, or the joystick): the keys are explained once, here, and
 * the one-time hint then doesn't show (LayoutViewer).
 */

import { Fragment, useId } from 'react';
import type { CSSProperties } from 'react';

import { welcomeTitle, welcomeTip, weakNote, weakReason } from '../startMode';
import type { WeakKind } from '../startMode';
import { PERF_TIP_TEXT } from '../perfTip';

/** v0.17.1: Explore (the main one) and the company tour (with the viewer's tour option). */
export type WelcomeAction = 'explore' | 'tour';

export interface WelcomeCardProps {
  /** The layout's name ("Welcome to …"). */
  name?: string | null;
  /** Where the tour / Find are (the viewer's tour / search options): the card's pointer line. */
  tour?: boolean;
  search?: boolean;
  /** The tour's size ("5 stops · about 1 min", tourDetail): the tour button's second line. */
  tourDetail?: string | null;
  /** How to walk (a first visit: the one-time hint's words); null: not said again. */
  keys?: string | null;
  /** A narrow view (a phone): full width at the bottom, this far up (px: above the joystick or the HUD). */
  narrow?: boolean;
  bottom?: number;
  /** A short view (v0.14.7): a smaller title, one short line, the actions in one row without their detail lines. */
  compact?: boolean;
  onAction: (action: WelcomeAction) => void;
}

const LINE = 'You are at the main entrance.';
/**
 * A narrow card (at the bottom) keeps this much of the box's top clear (px): the toolbar row, on a phone two lines of
 * buttons (12 + 2 × 32 + 8), and a gap. A card still taller than what is left scrolls, never over the row.
 */
export const WELCOME_TOOLBAR_ROOM = 96;

export function WelcomeCard({
  name, tour = true, search = true, tourDetail = null, keys = null, narrow = false, bottom = 12, compact = false, onAction,
}: WelcomeCardProps) {
  const id = useId();
  const tip = welcomeTip({ tour, search });
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
          <p id={`${id}-line`} style={compact ? styles.lineCompact : styles.line}>
            {LINE}
            {keys && <span data-welcome-keys style={styles.keys}>{keys}</span>}
            {tip && <span data-welcome-tip style={styles.tip}>{tip}</span>}
          </p>
        </div>
        <button type="button" aria-label="Close and explore" title="Close (Esc)" style={compact ? styles.closeCompact : styles.close}
          onClick={() => onAction('explore')}>×</button>
      </div>
      <div style={styles.list}>
        <button type="button" data-welcome-action="explore" style={{ ...styles.primary, ...styles.optionCompact, flex: '2 1 0' }}
          onClick={() => onAction('explore')}>
          <strong style={compact ? styles.labelCompact : styles.label}>Explore</strong>
        </button>
        {tour && (
          <button type="button" data-welcome-action="tour" style={{ ...styles.option, ...styles.optionCompact, ...styles.second }}
            aria-label={tourDetail ? `Start the tour, ${tourDetail}` : 'Start the tour'} title={tourDetail ?? undefined}
            onClick={() => onAction('tour')}>
            <span style={compact ? styles.secondLabelCompact : styles.secondLabel}>Start the tour</span>
            {tourDetail && !compact && (
              <span data-welcome-tour-detail style={styles.secondDetail}>
                {/* a narrow button breaks it at a dot only ("5 stops ·" / "about 1 min"), never inside "1 min" */}
                {tourDetail.split(' · ').map((part, i, all) => (
                  <Fragment key={i}><span style={styles.nowrap}>{part}{i < all.length - 1 ? ' ·' : ''}</span>{i < all.length - 1 ? ' ' : ''}</Fragment>
                ))}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export interface WeakDeviceNoteProps {
  /** Why it started from above: WebGL drawn by software, or quality 'low'. */
  kind: WeakKind;
  /** As the welcome card's. */
  narrow?: boolean;
  bottom?: number;
  compact?: boolean;
  /** "Walk anyway" (walk from the entrance, then the welcome card) / "Stay above" (close the note). */
  onWalk: () => void;
  onStay: () => void;
  /**
   * v0.18.10: the performance tip goes in this note (one note, not two): why it started from above, the tip's words, and
   * "Don't show again" (onTipOff: the tip never shows again in this browser; the note closes).
   */
  tip?: boolean;
  onTipOff?: () => void;
}

/**
 * The note a weak device's start shows (v0.14.8, private-docs/EXPERIENCE_PLAN.md 3.1 guard 2): why it started from
 * above, in the welcome card's look. A status, not a dialog: the view stays usable; Esc or a press on the view closes it
 * (LayoutViewer). Text only.
 */
export function WeakDeviceNote({ kind, narrow = false, bottom = 12, compact = false, onWalk, onStay, tip = false, onTipOff }: WeakDeviceNoteProps) {
  const place: CSSProperties = narrow
    ? { ...styles.narrow, bottom, maxHeight: `calc(100% - ${bottom + WELCOME_TOOLBAR_ROOM}px)` }
    : { ...styles.wide, width: 460 };
  const button = compact ? styles.optionCompact : styles.noteButton;
  return (
    <div
      data-weak-note={kind}
      data-weak-note-place={narrow ? 'narrow' : 'wide'}
      data-weak-note-compact={compact ? '' : undefined}
      role="status"
      style={{ ...styles.card, ...place, ...(compact ? styles.cardCompact : null) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p data-weak-note-text style={compact ? styles.noteTextCompact : styles.noteText}>{tip ? weakReason(kind) : weakNote(kind)}</p>
      {tip && (
        <p data-perf-tip-text style={compact ? styles.tipTextCompact : styles.tipText}>{PERF_TIP_TEXT}</p>
      )}
      <div style={styles.list}>
        <button type="button" data-weak-note-action="walk" style={{ ...styles.primary, ...button }} onClick={onWalk}>
          <strong style={compact ? styles.labelCompact : styles.label}>Walk anyway</strong>
        </button>
        <button type="button" data-weak-note-action="stay" style={{ ...styles.option, ...button }} onClick={onStay}>
          <strong style={compact ? styles.labelCompact : styles.label}>Stay above</strong>
        </button>
      </div>
      {tip && onTipOff && (
        <button type="button" data-perf-tip-action="off" style={styles.tipOff} onClick={onTipOff}>Don't show again</button>
      )}
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
  // v0.17.1: the keys (first visit) and where Find / the tour are, each on a line of its own
  keys: { display: 'block', marginTop: 6, color: C.text, fontWeight: 600 },
  tip: { display: 'block', marginTop: 4 },
  close: {
    flex: 'none', width: 32, height: 32, border: 'none', borderRadius: 8, background: 'transparent', color: C.muted,
    font: '20px/1 system-ui, sans-serif', cursor: 'pointer',
  },
  list: { display: 'flex', gap: 8 },
  option,
  primary: { ...option, background: C.accent, border: `1px solid ${C.accent}`, color: '#fff' },
  label: { font: `700 14px/1.3 ${C.font}` },
  // v0.17.1: the tour, the second (smaller) button
  second: { flex: '1 1 0', background: C.panel },
  secondLabel: { font: `600 13px/1.25 ${C.font}`, overflowWrap: 'anywhere' },
  secondLabelCompact: { font: `600 12.5px/1.25 ${C.font}`, overflowWrap: 'anywhere' },
  secondDetail: { font: `11.5px/1.25 ${C.font}`, color: C.muted },
  nowrap: { whiteSpace: 'nowrap' },
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
  // the weak device's note (v0.14.8)
  noteText: { margin: 0, fontSize: 14, lineHeight: 1.45, color: C.text, overflowWrap: 'anywhere' },
  noteTextCompact: { margin: 0, fontSize: 13, lineHeight: 1.4, color: C.text, overflowWrap: 'anywhere' },
  noteButton: { alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 44 },
  // v0.18.10: the performance tip inside the note
  tipText: { margin: 0, fontSize: 13.5, lineHeight: 1.45, color: C.muted, overflowWrap: 'anywhere' },
  tipTextCompact: { margin: 0, fontSize: 12.5, lineHeight: 1.4, color: C.muted, overflowWrap: 'anywhere' },
  tipOff: {
    alignSelf: 'flex-start', minHeight: 32, margin: '-4px 0 -4px -6px', padding: '4px 6px', border: 'none', borderRadius: 8,
    background: 'transparent', color: C.accent, font: `600 13px/1.3 ${C.font}`, textDecoration: 'underline', cursor: 'pointer',
  },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
};
