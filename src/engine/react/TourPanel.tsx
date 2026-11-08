/**
 * react/TourPanel.tsx
 *
 * The company tour's panel (v0.14.4, private-docs/EXPERIENCE_PLAN.md 3.5): shown while engine.tour runs.
 * "Stop 4 of 20 · Marketing", the stop's text (at a stop) or the walk's directions (on the way), the next
 * leg's directions, the last passing mention ("On your left: Restrooms"); Pause / Resume (P), Previous, Next,
 * Skip the walk, "Walk me" | "I'll walk", the stops with a tick for each one visited (a click goes there),
 * Restart, Exit (Esc); a speaker button reads each stop aloud (the browser's speech, off by default).
 * Desktop: top right. A narrow view (a phone): full width at the bottom, above the joystick (touch) or the HUD.
 * The AHDUS look as inline styles (the viewer has no stylesheet), as PlaceSearch.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { LayoutEngine } from '../LayoutEngine';
import type { TourEvent, TourStatus } from '../systems/TourSystem';

/** A passing mention shows this long (ms). */
export const MENTION_MS = 6000;
export const TOUR_LABEL = 'Company tour';

/** "Stop 4 of 20 · Marketing". PURE: tested. */
export function stopTitle(status: Pick<TourStatus, 'index' | 'count' | 'stop'>): string {
  if (!status.stop) return TOUR_LABEL;
  return `Stop ${status.index + 1} of ${status.count} · ${status.stop.name}`;
}

/** The line under the title: what the tour is doing now, in touch or key words. PURE: tested. */
export function stateLine(status: Pick<TourStatus, 'state' | 'follow' | 'pausedFrom' | 'remaining' | 'dwell'>, touch = false): string {
  const go = touch ? 'Tap Resume to go on' : 'Press P to go on';
  switch (status.state) {
    case 'walking': {
      const m = status.remaining !== null ? ` · ${Math.max(0, Math.round(status.remaining))} m` : '';
      return status.follow === 'auto'
        ? `On the way${m} · ${touch ? 'the joystick pauses' : 'a movement key pauses'}`
        : `Follow the line${m}`;
    }
    case 'stop':
      return status.dwell !== null && status.dwell > 0
        ? `${status.follow === 'auto' ? 'Walking on' : 'The way on shows'} in ${Math.ceil(status.dwell)} s`
        : 'Here';
    case 'paused':
      return `Paused · ${go}`;
    case 'done':
      return 'Tour complete';
    default:
      return '';
  }
}

/** What is read aloud at a stop (narration): its lines as sentences. */
export function spokenText(status: Pick<TourStatus, 'stop' | 'index' | 'count'>): string {
  const s = status.stop;
  if (!s) return '';
  return [`Stop ${status.index + 1} of ${status.count}`, ...s.lines].map((l) => l.replace(/[·]/g, ',')).join('. ');
}

function speak(text: string): void {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || !text || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch { /* no voice here */ }
}
function hush(): void {
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
}

export interface TourPanelProps {
  engine: LayoutEngine;
  /** Touch words (Tap, the joystick), as the viewer's. */
  touch?: boolean;
  /** A narrow view (a phone): full width at the bottom. */
  narrow?: boolean;
  /** Where it sits at the bottom (px) when narrow: above the joystick or the HUD. */
  bottom?: number;
  /** Where it sits at the top (px) when wide (v0.14.6: under the viewer's Overview button). */
  top?: number;
  /** The stop list is open (the toolbar's Tour button toggles it). */
  listOpen?: boolean;
  onListOpenChange?: (open: boolean) => void;
  /** Give the view the keys back after a button (P, Esc, walking). */
  focusView?: () => void;
}

export function TourPanel({ engine, touch = false, narrow = false, bottom = 12, top = 12, listOpen = false, onListOpenChange, focusView }: TourPanelProps) {
  const [status, setStatus] = useState<TourStatus>(() => engine.tour.status);
  const [speakOn, setSpeakOn] = useState(false);
  const [, setNow] = useState(0);
  const speakRef = useRef(speakOn);
  speakRef.current = speakOn;
  const [said, setSaid] = useState('');
  // a phone, walking between stops: one line unless tapped open (v0.14.4); each new walk starts as one line
  const [expanded, setExpanded] = useState(false);

  useEffect(() => engine.on('tour', (e: TourEvent) => {
    setStatus(e);
    if (e.type === 'walking') setExpanded(false);
    if (e.type === 'arrived') {
      setSaid(stopTitle(e));
      if (speakRef.current) speak(spokenText(e));
    } else if (e.type === 'mention' && e.mention) {
      setSaid(e.mention.text);
      if (speakRef.current) speak(e.mention.text);
    } else if (e.type === 'paused') setSaid('Paused');
    else if (e.type === 'done') setSaid('Tour complete');
    else if (e.type === 'ended') hush();
  }), [engine]);
  useEffect(() => () => hush(), []);

  // the countdown at a stop and the mention's time: redrawn twice a second while it matters
  const ticking = status.state === 'stop' || (status.mention && performance.now() - status.mentionAt < MENTION_MS);
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => { setStatus(engine.tour.status); setNow(performance.now()); }, 500);
    return () => clearInterval(t);
  }, [engine, ticking]);

  if (status.state === 'idle' || !status.plan) return null;
  const { plan, stop, index, count, state, follow } = status;
  const atStop = state === 'stop' || state === 'done' || (state === 'paused' && status.pausedFrom === 'stop');
  const next = atStop ? plan.stops[index + 1] ?? null : null;
  const directions = atStop ? next?.leg?.directions : stop?.leg?.directions;
  const mention = status.mention && performance.now() - status.mentionAt < MENTION_MS ? status.mention : null;
  const visited = new Set(status.visited);
  const act = (fn: () => unknown) => () => { fn(); focusView?.(); };

  const box: CSSProperties = narrow
    ? { ...styles.panel, left: 12, right: 12, bottom, maxHeight: '48%' }
    : { ...styles.panel, top, right: 12, width: 360, maxHeight: `calc(100% - ${top + 12}px)` };
  // walking between stops on a phone: one line ("Stop 2 of 20 · Lobby & Reception · Pause · ⌃"), so the view shows
  const walkingOn = state === 'walking' || (state === 'paused' && status.pausedFrom === 'walking');
  const compact = narrow && walkingOn && !expanded && !listOpen;
  const pauseButton = (
    <button type="button" data-tour-pause aria-label={state === 'paused' ? 'Resume the tour' : 'Pause the tour'}
      title={touch ? undefined : state === 'paused' ? 'Resume (P)' : 'Pause (P)'} style={compact ? styles.compactPause : styles.primary}
      onClick={act(() => (state === 'paused' ? engine.tour.resume() : engine.tour.pause()))}>
      {state === 'paused' ? 'Resume' : 'Pause'}
    </button>
  );

  if (compact) {
    return (
      <section
        data-tour-panel={state}
        data-tour-follow={follow}
        data-tour-index={index}
        data-tour-narrow=""
        data-tour-compact=""
        aria-label={TOUR_LABEL}
        style={{ ...box, ...styles.compact }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" data-tour-expand aria-expanded={false} aria-label={`${stopTitle(status)}. Show the tour`}
          style={styles.compactTitle} onClick={() => setExpanded(true)}>
          <span data-tour-title style={styles.compactText}>{stopTitle(status)}</span>
          {state === 'paused' && <span style={styles.compactPaused}> · Paused</span>}
        </button>
        {pauseButton}
        <button type="button" data-tour-expand-icon aria-label="Show the tour" title="Show the tour" style={styles.icon}
          onClick={() => setExpanded(true)}>
          <ChevronIcon up />
        </button>
        <div aria-live="polite" role="status" data-tour-said style={styles.srOnly}>{said}</div>
      </section>
    );
  }

  return (
    <section
      data-tour-panel={state}
      data-tour-follow={follow}
      data-tour-index={index}
      data-tour-narrow={narrow ? '' : undefined}
      aria-label={TOUR_LABEL}
      style={box}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={styles.head}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={styles.badge}>{TOUR_LABEL}</span>
          <h2 data-tour-title style={styles.title}>{stopTitle(status)}</h2>
          <span data-tour-state style={state === 'paused' ? styles.paused : styles.state}>{stateLine(status, touch)}</span>
        </div>
        <button type="button" data-tour-speak aria-pressed={speakOn} aria-label={speakOn ? 'Stop reading aloud' : 'Read the stops aloud'}
          title={speakOn ? 'Stop reading aloud' : 'Read the stops aloud'} style={{ ...styles.icon, ...(speakOn ? styles.iconOn : null) }}
          onClick={act(() => {
            const on = !speakOn;
            setSpeakOn(on);
            if (on) speak(spokenText(status));
            else hush();
          })}>
          <SpeakerIcon on={speakOn} />
        </button>
        {narrow && walkingOn && (
          <button type="button" data-tour-collapse aria-label="Show less" title="Show less" style={styles.icon}
            onClick={() => { setExpanded(false); onListOpenChange?.(false); }}>
            <ChevronIcon />
          </button>
        )}
        <button type="button" data-tour-exit aria-label="Exit the tour" title={touch ? 'Exit the tour' : 'Exit the tour (Esc)'} style={styles.icon}
          onClick={act(() => engine.tour.stop())}>
          <CloseIcon />
        </button>
      </div>

      <div style={styles.body}>
        {atStop && stop && (
          <div data-tour-text style={styles.text}>
            {stop.lines.slice(1).map((l, i) => <p key={i} style={styles.line}>{l}</p>)}
          </div>
        )}
        {mention && <div data-tour-mention style={styles.mention}>{mention.text}</div>}
        {state === 'done' ? (
          <p style={styles.line}>That was the whole tour: {count} stops.</p>
        ) : directions ? (
          <div data-tour-directions style={styles.directions}>
            {next && <strong style={{ display: 'block' }}>Next: {next.name}</strong>}
            {directions}
          </div>
        ) : null}
        {status.message && <div data-tour-problem style={styles.problem}>{status.message}</div>}
      </div>

      <div role="group" aria-label="How to follow the tour" style={styles.segment}>
        {(['auto', 'self'] as const).map((f) => (
          <button key={f} type="button" data-tour-mode={f} aria-pressed={follow === f}
            style={{ ...styles.segmentButton, ...(follow === f ? styles.segmentOn : null) }}
            onClick={act(() => engine.tour.setFollow(f))}>
            {f === 'auto' ? 'Walk me' : "I'll walk"}
          </button>
        ))}
      </div>

      <div style={styles.actions}>
        {state === 'done' ? (
          <button type="button" data-tour-restart style={styles.primary} onClick={act(() => engine.tour.restart())}>Restart</button>
        ) : (
          <>
            {pauseButton}
            <button type="button" data-tour-previous style={sec(index <= 0)} disabled={index <= 0}
              onClick={act(() => engine.tour.previous())}>Previous</button>
            <button type="button" data-tour-next style={sec(index >= count - 1)} disabled={index >= count - 1}
              onClick={act(() => engine.tour.next())}>Next</button>
            <button type="button" data-tour-skip style={sec(atStop && index >= count - 1)} disabled={atStop && index >= count - 1}
              title="Go there at once" onClick={act(() => engine.tour.skip())}>Skip the walk</button>
          </>
        )}
        <button type="button" data-tour-list-toggle aria-expanded={listOpen} style={styles.link}
          onClick={() => onListOpenChange?.(!listOpen)}>
          {listOpen ? 'Hide the stops' : `All stops (${visited.size} of ${count} visited)`}
        </button>
      </div>

      {listOpen && (
        <ol data-tour-list aria-label="The tour's stops" style={styles.list}>
          {plan.stops.map((s, i) => (
            <li key={`${s.id}:${i}`} style={styles.item}>
              <button type="button" data-tour-stop-item={s.id} data-visited={visited.has(s.id) ? '' : undefined}
                aria-current={i === index ? 'step' : undefined}
                style={{ ...styles.itemButton, ...(i === index ? styles.itemOn : null) }}
                onClick={act(() => engine.tour.goTo(i))}>
                <span aria-hidden style={visited.has(s.id) ? styles.tick : styles.noTick}>{visited.has(s.id) ? '✓' : i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={styles.itemName}>{s.name}</span>
                  <span style={styles.itemDetail}>{s.lines[1] ?? s.floorName}</span>
                </span>
                {visited.has(s.id) && <span style={styles.srOnly}>, visited</span>}
              </button>
            </li>
          ))}
          <li style={styles.item}>
            <button type="button" data-tour-restart style={styles.link} onClick={act(() => engine.tour.restart())}>Restart the tour</button>
          </li>
        </ol>
      )}
      {!touch && <div data-tour-keys style={styles.keys}>P pauses · Esc ends the tour</div>}
      <div aria-live="polite" role="status" data-tour-said style={styles.srOnly}>{said}</div>
    </section>
  );
}

/** A secondary button, faded and not clickable-looking when disabled. */
function sec(disabled: boolean): CSSProperties {
  return disabled ? { ...styles.secondary, opacity: 0.45, cursor: 'default' } : styles.secondary;
}

function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
    </svg>
  );
}

// The AHDUS look (as PlaceSearch's)
const C = {
  panel: '#ffffff', text: '#25382f', muted: '#55625a', border: '#e3e8e0', hover: '#f0f3ed',
  accent: '#28664f', accentSoft: '#eaf2e6', danger: '#b3261e', mention: '#7a5b00', mentionBg: '#fff7d6',
  shadow: '0 8px 24px rgba(25, 59, 47, 0.14)', font: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const button: CSSProperties = {
  height: 32, padding: '0 12px', borderRadius: 999, font: `600 13px/1 ${C.font}`, cursor: 'pointer', whiteSpace: 'nowrap',
};
const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 8, boxSizing: 'border-box',
    padding: '10px 12px 10px', overflowY: 'auto', background: C.panel, color: C.text, border: `1px solid ${C.border}`,
    borderLeft: `4px solid ${C.accent}`, borderRadius: 14, boxShadow: C.shadow, font: `14px/1.4 ${C.font}`, pointerEvents: 'auto',
  },
  head: { display: 'flex', alignItems: 'flex-start', gap: 4 },
  badge: { display: 'block', color: C.accent, font: `600 11px/1.4 ${C.font}`, letterSpacing: '0.04em', textTransform: 'uppercase' },
  title: { margin: 0, font: `700 15px/1.3 ${C.font}`, color: C.text, overflowWrap: 'anywhere' },
  state: { display: 'block', fontSize: 12.5, color: C.accent, fontWeight: 600 },
  paused: { display: 'block', fontSize: 12.5, color: C.danger, fontWeight: 600 },
  icon: {
    flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
    border: 'none', borderRadius: 8, background: 'transparent', color: C.muted, cursor: 'pointer',
  },
  iconOn: { background: C.accentSoft, color: C.accent },
  body: { display: 'flex', flexDirection: 'column', gap: 6 },
  text: { display: 'flex', flexDirection: 'column', gap: 2 },
  line: { margin: 0, fontSize: 13.5, overflowWrap: 'anywhere' },
  directions: { fontSize: 13, color: C.muted, overflowWrap: 'anywhere' },
  mention: { alignSelf: 'flex-start', padding: '3px 8px', borderRadius: 6, background: C.mentionBg, color: C.mention, fontSize: 13, fontWeight: 600 },
  problem: { fontSize: 12.5, color: C.danger },
  segment: { display: 'inline-flex', alignSelf: 'flex-start', padding: 2, borderRadius: 999, background: C.hover, gap: 2 },
  segmentButton: { ...button, height: 28, border: 'none', background: 'transparent', color: C.muted },
  segmentOn: { background: C.panel, color: C.accent, boxShadow: '0 1px 3px rgba(25, 59, 47, 0.18)' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  primary: { ...button, border: `1px solid ${C.accent}`, background: C.accent, color: '#fff' },
  secondary: { ...button, border: `1px solid ${C.border}`, background: C.accentSoft, color: C.accent },
  link: { ...button, height: 28, padding: '0 4px', border: 'none', background: 'transparent', color: C.accent, textDecoration: 'underline' },
  list: { listStyle: 'none', margin: 0, padding: '4px 0 0', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 2 },
  item: { margin: 0 },
  itemButton: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 6px', boxSizing: 'border-box', textAlign: 'left',
    border: 'none', borderRadius: 8, background: 'transparent', color: C.text, font: `13px/1.3 ${C.font}`, cursor: 'pointer',
  },
  itemOn: { background: C.accentSoft },
  tick: {
    flex: 'none', width: 22, height: 22, borderRadius: 999, background: C.accent, color: '#fff', font: `700 12px/22px ${C.font}`, textAlign: 'center',
  },
  noTick: {
    flex: 'none', width: 22, height: 22, borderRadius: 999, background: C.hover, color: C.muted, font: `600 11px/22px ${C.font}`, textAlign: 'center',
  },
  itemName: { display: 'block', fontWeight: 600, overflowWrap: 'anywhere' },
  itemDetail: { display: 'block', fontSize: 12, color: C.muted, overflowWrap: 'anywhere' },
  keys: { fontSize: 12, color: C.muted },
  // the phone's one line while walking
  compact: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: '5px 6px 5px 10px', maxHeight: 'none', overflowY: 'hidden' },
  compactTitle: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', height: 36, padding: 0, border: 'none', background: 'transparent',
    color: C.text, font: `700 14px/36px ${C.font}`, textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  compactText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  compactPaused: { flex: 'none', color: C.danger, fontWeight: 600, fontSize: 13 },
  compactPause: { ...button, flex: 'none', border: `1px solid ${C.accent}`, background: C.accent, color: '#fff' },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
};

export default TourPanel;
