/**
 * react/PlaceSearch.tsx
 *
 * The viewer's search box (v0.13.3): "Find a person, room or place". A button
 * in the viewer's toolbar opens it; results come as you type (one search is a
 * few ms: engine.navigation, play/navigation/places.js), grouped People /
 * Rooms / Facilities, each with its floor and room. Picking one shows it
 * (engine.navigation.show): from above, its floor, the camera flies to it and
 * it is outlined; walking, it is outlined and the walk there is measured
 * ("Nearest washroom" = the nearest by walking from where you stand).
 *
 * Keyboard: ↑ ↓ choose, Enter picks, Esc closes (the focus goes back to the
 * button). A combobox + listbox for screen readers, with a live status line.
 * The AHDUS look (white panel, AHDUS green), inline styles: the viewer brings
 * no stylesheet of its own. Full width on a phone (the toolbar's width).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import type { LayoutEngine } from '../LayoutEngine';
import type { PlaceResult, SearchGroups, ShowResult } from '../systems/NavigationSystem';

const GROUP_TITLES = { people: 'People', rooms: 'Rooms', facilities: 'Facilities' } as const;
/** Shown before anything is typed: one tap fills the box. */
const QUICK = ['Washroom', 'Meeting room', 'Reception', 'Stairs'];
export const SEARCH_LABEL = 'Find a person, room or place';

export interface PlaceSearchProps {
  engine: LayoutEngine | null;
  walking: boolean;
  /** Changes when the people change (a new search then). */
  people?: unknown;
  /** The toolbar's other buttons (walking: the keys hint, Back to entrance), before the search button. */
  children?: ReactNode;
}

/** "about 40 s" / "about 2 min" on foot. */
export function walkTime(seconds: number): string {
  if (seconds < 50) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  return `about ${Math.max(1, Math.round(seconds / 60))} min`;
}

/** The line under a place shown while walking: how far, or why you can't walk there. */
export function walkLine(shown: ShowResult): string | null {
  if (shown.message) return shown.message;
  if (!shown.route) return null;
  const { length, seconds, floors } = shown.route;
  const stairs = new Set(floors).size > 1 ? ' · by the stairs' : '';
  return `${Math.round(length)} m walk, ${walkTime(seconds)}${stairs}`;
}

export function PlaceSearch({ engine, walking, people, children }: PlaceSearchProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<(ShowResult & { nearest?: string }) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const result: SearchGroups | null = useMemo(() => {
    if (!engine || !open || !query.trim()) return null;
    const t0 = performance.now();
    const r = engine.navigation.search(query);
    const ms = performance.now() - t0;
    // for tests and the curious: how long the last search took
    queueMicrotask(() => panelRef.current?.setAttribute('data-search-ms', ms.toFixed(2)));
    return r;
    // walking changes "nearest first"; people change who can be found
  }, [engine, open, query, walking, people]);

  // the order shown (Rooms first for "Engineering"): up / down follow it
  const options = useMemo(() => (result ? result.order.flatMap((g) => result.groups[g]) : []), [result]);
  useEffect(() => { setActive(0); }, [result]);

  // A new layout or engine: nothing is shown any more
  useEffect(() => () => { setShown(null); }, [engine]);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Keep the chosen option in view
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, uid]);

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus({ preventScroll: true });
  };

  const pick = (place: PlaceResult | undefined) => {
    if (!engine || !place) return;
    const r = engine.navigation.show(place.id);
    if (!r) return;
    setShown({ ...r, nearest: place.kind === 'nearest' ? place.name : undefined });
    close();
  };

  const clearShown = () => {
    engine?.navigation.clear();
    setShown(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active] ?? options[0]);
    } else if (e.key === 'Escape') {
      // ours, not the walkthrough's (Esc there gives the keys back to the page)
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const status = !query.trim() ? ''
    : !result?.total ? `Nothing found for “${query.trim()}”`
      : `${result.total} ${result.total === 1 ? 'result' : 'results'}`;
  const activeId = options.length ? `${uid}-opt-${active}` : undefined;
  let n = -1;

  return (
    <>
      <div style={styles.row}>
        {children}
        <button
          ref={buttonRef}
          type="button"
          data-place-search-button
          aria-label={SEARCH_LABEL}
          aria-expanded={open}
          aria-controls={open ? `${uid}-panel` : undefined}
          title={SEARCH_LABEL}
          style={{ ...styles.toolButton, ...(open ? styles.toolButtonOn : null) }}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <SearchIcon /> <span>Find</span>
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          id={`${uid}-panel`}
          data-place-search
          role="search"
          style={styles.panel}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={styles.field}>
            <SearchIcon color="#55625a" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={SEARCH_LABEL}
              aria-expanded={options.length > 0}
              aria-controls={`${uid}-list`}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              placeholder={SEARCH_LABEL}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              value={query}
              style={styles.input}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" aria-label="Close search" title="Close (Esc)" style={styles.iconButton} onClick={() => close()}>
              <CloseIcon />
            </button>
          </div>

          {!query.trim() && (
            <div style={styles.hint}>
              <div>Type a name, a department or a room.</div>
              <div style={styles.quick}>
                {QUICK.map((q) => (
                  <button key={q} type="button" data-quick={q} style={styles.chip}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setQuery(q); inputRef.current?.focus(); }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div id={`${uid}-list`} role="listbox" aria-label="Search results" style={styles.list}>
            {result && result.order.map((g) => {
              const items = result.groups[g];
              const title = GROUP_TITLES[g];
              if (!items.length) return null;
              return (
                <div key={g} role="group" aria-labelledby={`${uid}-${g}`} data-group={g}>
                  <div id={`${uid}-${g}`} role="presentation" style={styles.groupTitle}>{title}</div>
                  {items.map((p) => {
                    n += 1;
                    const i = n;
                    return (
                      <div
                        key={p.id}
                        id={`${uid}-opt-${i}`}
                        role="option"
                        aria-selected={i === active}
                        data-place={p.id}
                        style={{ ...styles.option, ...(i === active ? styles.optionOn : null) }}
                        onMouseDown={(e) => e.preventDefault()} // the focus stays in the box
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(p)}
                      >
                        <span style={styles.name}>{p.name}</span>
                        <span style={styles.detail}>{p.detail}</span>
                      </div>
                    );
                  })}
                  {result.more[g] > 0 && (
                    <div role="presentation" style={styles.more}>
                      and {result.more[g]} more: type more of the name
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {query.trim() && !result?.total && <div style={styles.hint}>Nothing found. Try another name, or “washroom”.</div>}
          <div aria-live="polite" role="status" style={styles.srOnly} data-search-status>{status}</div>
        </div>
      )}

      {!open && shown && (
        <div data-place-shown={shown.place.id} role="status" style={styles.shown}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {shown.nearest && <span style={styles.badge}>{shown.nearest}</span>}
            <span style={styles.name}>{shown.place.name}</span>
            <span style={styles.detail}>{shown.place.detail}</span>
            {walking && walkLine(shown) && (
              <span data-walk={shown.problem ? 'problem' : 'route'} style={shown.problem ? styles.problem : styles.walk}>
                {walkLine(shown)}
              </span>
            )}
          </div>
          <button type="button" aria-label="Clear the place found" title="Clear" style={styles.iconButton} onClick={clearShown}>
            <CloseIcon />
          </button>
        </div>
      )}
    </>
  );
}

function SearchIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
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

// The AHDUS look (src/ui/theme.css tokens, as values: the viewer has no stylesheet)
const C = {
  panel: '#ffffff', text: '#25382f', muted: '#55625a', border: '#e3e8e0', hover: '#f0f3ed',
  accent: '#28664f', accentSoft: '#eaf2e6', danger: '#b3261e', shadow: '0 8px 24px rgba(25, 59, 47, 0.14)',
  font: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const styles: Record<string, CSSProperties> = {
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', pointerEvents: 'none' },
  toolButton: {
    pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
    border: `1px solid ${C.border}`, borderRadius: 999, background: C.panel, color: C.accent,
    font: `600 13px/1 ${C.font}`, cursor: 'pointer', boxShadow: '0 1px 3px rgba(25, 59, 47, 0.12)',
  },
  toolButtonOn: { background: C.accent, color: '#fff', border: `1px solid ${C.accent}` },
  panel: {
    position: 'relative', pointerEvents: 'auto', marginTop: 8, width: '100%', maxWidth: 400, minHeight: 0, maxHeight: '100%',
    display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
    background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow,
    font: `14px/1.4 ${C.font}`, overflow: 'hidden',
  },
  field: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', borderBottom: `1px solid ${C.border}` },
  input: {
    flex: 1, minWidth: 0, height: 36, border: 'none', outline: 'none', background: 'transparent',
    color: C.text, font: `15px/1.2 ${C.font}`,
  },
  iconButton: {
    pointerEvents: 'auto', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, border: 'none', borderRadius: 8, background: 'transparent', color: C.muted, cursor: 'pointer',
  },
  hint: { padding: '10px 12px', color: C.muted, fontSize: 13 },
  quick: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    height: 30, padding: '0 12px', border: `1px solid ${C.border}`, borderRadius: 999, background: C.accentSoft,
    color: C.accent, font: `600 13px/1 ${C.font}`, cursor: 'pointer',
  },
  list: { overflowY: 'auto', minHeight: 0, flex: '0 1 auto' },
  groupTitle: {
    padding: '10px 12px 4px', color: C.muted, font: `600 11px/1.2 ${C.font}`, letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  option: {
    display: 'flex', flexDirection: 'column', gap: 1, padding: '8px 12px', minHeight: 40, boxSizing: 'border-box',
    justifyContent: 'center', cursor: 'pointer', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
  },
  optionOn: { background: C.accentSoft, borderLeftColor: C.accent },
  name: { display: 'block', fontWeight: 600, color: C.text, overflowWrap: 'anywhere' },
  detail: { display: 'block', fontSize: 12.5, color: C.muted, overflowWrap: 'anywhere' },
  more: { padding: '4px 12px 8px 15px', fontSize: 12.5, color: C.muted, fontStyle: 'italic' },
  shown: {
    pointerEvents: 'auto', marginTop: 8, width: '100%', maxWidth: 400, boxSizing: 'border-box',
    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 6px 8px 12px',
    background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.accent}`,
    borderRadius: 12, boxShadow: C.shadow, font: `14px/1.4 ${C.font}`,
  },
  badge: { display: 'block', color: C.accent, font: `600 11px/1.4 ${C.font}`, letterSpacing: '0.04em', textTransform: 'uppercase' },
  walk: { display: 'block', marginTop: 2, fontSize: 12.5, color: C.accent, fontWeight: 600 },
  problem: { display: 'block', marginTop: 2, fontSize: 12.5, color: C.danger },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
};

export default PlaceSearch;
