/**
 * react/PerfTipCard.tsx (v0.18.10): the performance tip's own small card (engine/perfTip.ts says when). Not a dialog:
 * the view stays usable, nothing behind it is blocked. "Got it" closes it; "Don't show again" closes it for good (the
 * caller stores it). Used by the viewer (LayoutViewer) and Studio (WorkplaceEditor), which place it (`style`). The
 * AHDUS look, as inline styles (the viewer has no stylesheet). Text only.
 */

import type { CSSProperties } from 'react';

import { PERF_TIP_TEXT } from '../perfTip';

export interface PerfTipCardProps {
  /** Where it sits (position, left / right / bottom, width): the caller's. */
  style?: CSSProperties;
  /** Smaller text and buttons (a short view). */
  compact?: boolean;
  onGotIt: () => void;
  onOff: () => void;
}

export function PerfTipCard({ style, compact = false, onGotIt, onOff }: PerfTipCardProps) {
  return (
    <div
      data-perf-tip="card"
      role="note"
      aria-label="Tip: smoother 3D view"
      style={{ ...styles.card, ...(compact ? styles.cardCompact : null), ...style }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p data-perf-tip-text style={compact ? styles.textCompact : styles.text}>{PERF_TIP_TEXT}</p>
      <div style={styles.row}>
        <button type="button" data-perf-tip-action="ok" style={{ ...styles.button, ...styles.primary }} onClick={onGotIt}>
          Got it
        </button>
        <button type="button" data-perf-tip-action="off" style={styles.button} onClick={onOff}>
          Don't show again
        </button>
      </div>
    </div>
  );
}

const C = {
  panel: '#ffffff', text: '#25382f', border: '#e3e8e0', accent: '#28664f', accentSoft: '#eaf2e6',
  shadow: '0 12px 32px rgba(25, 59, 47, 0.2)', font: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
};
const styles: Record<string, CSSProperties> = {
  card: {
    position: 'absolute', zIndex: 3, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box',
    width: 340, maxWidth: 'calc(100% - 24px)', padding: '12px 14px', background: C.panel, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, font: `13.5px/1.45 ${C.font}`,
    pointerEvents: 'auto',
  },
  cardCompact: { gap: 8, padding: '10px 12px' },
  text: { margin: 0, fontSize: 13.5, lineHeight: 1.45, overflowWrap: 'anywhere' },
  textCompact: { margin: 0, fontSize: 12.5, lineHeight: 1.4, overflowWrap: 'anywhere' },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  button: {
    flex: '1 1 auto', minHeight: 36, padding: '6px 12px', borderRadius: 10, border: `1px solid ${C.border}`,
    background: C.accentSoft, color: C.accent, font: `600 13px/1.25 ${C.font}`, cursor: 'pointer',
  },
  primary: { background: C.accent, borderColor: C.accent, color: '#fff' },
};
