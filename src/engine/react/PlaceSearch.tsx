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
 * While the box is empty it is a browse menu (v0.14.2, engine.navigation.browse,
 * play/navigation/browse.js): chips for the facility kinds this workplace has
 * (walking: "Nearest washroom · 8 m"), My desk, recent searches (per browser),
 * departments ("Engineering · 2 rooms · Floor 1 · 92 people", + the page's
 * description), places by kind and by floor; opening one lists its places. At its top (v0.14.4): "Take the
 * company tour · 20 stops · about 8 min" (engine.tour; the plan is made in idle time, so it starts at once).
 *
 * The card of the place shown has "Show route" (a line on the floor, you walk)
 * and "Take me there" (your character walks it): engine.navigation.routeTo,
 * from above walking starts at the entrance (v0.13.4). While a route is
 * followed a strip says "Going to Kavya Iyer · 42 m" with Stop (paused by a
 * movement key: "Press G to continue" + Continue); then "You have arrived" or
 * why it stopped.
 *
 * Keyboard: ↑ ↓ choose, Enter picks or opens, ← / Backspace (empty box) or Esc
 * in a list goes back, Esc closes (the focus goes back to the button). A
 * combobox + listbox for screen readers, with a live status line. The AHDUS
 * look (white panel, AHDUS green), inline styles: the viewer brings no
 * stylesheet of its own. Full width on a phone (the toolbar's width).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import type { LayoutEngine } from '../LayoutEngine';
import type { BrowseMenu, PlaceResult, SearchGroups, ShowResult, NavigationEvent, WalkMode } from '../systems/NavigationSystem';
import { addRecent, RECENT_MAX } from '../../play/navigation/browse';

const GROUP_TITLES = { people: 'People', rooms: 'Rooms', facilities: 'Facilities' } as const;
export const SEARCH_LABEL = 'Find a person, room or place';
/** The recent searches (place ids, newest first), per browser. */
export const RECENT_KEY = 'ahdus.findRecent';

export interface PlaceSearchProps {
  engine: LayoutEngine | null;
  walking: boolean;
  /** Changes when the people change (a new search then). */
  people?: unknown;
  /** Changes when the departments' descriptions change (a new menu then). */
  departments?: unknown;
  /** The signed-in person's personId ("My desk"); changes make a new menu. */
  me?: string | null;
  /** The toolbar's other buttons (walking: the keys hint, Back to entrance), before the search button. */
  children?: ReactNode;
  /** Give the view the keys (after Show route / Take me there: W pauses, G continues, Esc stops). */
  focusView?: () => void;
  /** A touch screen (v0.14.1): the strip says "the joystick" and "Continue", not keys. */
  touch?: boolean;
  /** The box opened or closed (the viewer keeps its one-time hint out of the way meanwhile). */
  onOpenChange?: (open: boolean) => void;
  /** The tour's entry at the top of the menu (v0.14.4; default true): its pick calls onStartTour. */
  tour?: boolean;
  onStartTour?: () => void;
  /** More of the toolbar's buttons, after Find (the viewer's Tour button). */
  after?: ReactNode;
}

/** The tour's entry: how many stops, about how long, how many visited (null: none to offer). */
export interface TourOffer { count: number | null; minutes: number | null; visited: number }

/** "20 stops · about 8 min · 3 visited" (the plan not made yet: "From the main entrance"). PURE: tested. */
export function tourDetail(t: TourOffer): string {
  const parts = t.count ? [count(t.count, 'stop'), `about ${t.minutes ?? 1} min`] : ['From the main entrance'];
  if (t.visited) parts.push(`${t.visited} visited`);
  return parts.join(' · ');
}

/** "Going to Kavya Iyer · 42 m · Floor 1": the strip's line (the floor when it isn't yours). */
export function goingLine(nav: NavigationEvent, floorName?: string | null): string {
  const m = Math.max(0, Math.round(nav.remaining ?? 0));
  const floor = floorName && nav.place.floorId !== nav.floor ? ` · ${nav.place.floorName || floorName}` : '';
  return `Going to ${nav.place.name} · ${m} m${floor}`;
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

// ── The browse menu (v0.14.2): its lists as sections of entries ──

/** Where the menu is: the start, or one department / kind / floor opened. */
export type BrowseView = { type: 'home' } | { type: 'department' | 'kind' | 'floor'; id: string };
type Chip = BrowseMenu['chips'][number];
export type BrowseEntry =
  | { type: 'place'; key: string; place: PlaceResult; name?: string; detail?: string; tag?: 'my-desk' | 'recent' }
  | { type: 'open'; key: string; view: BrowseView; name: string; detail: string; description?: string | null; count?: number }
  | { type: 'back'; key: string }
  | { type: 'chip'; key: string; chip: Chip; name: string }
  | { type: 'tour'; key: string; name: string; detail: string };
export interface BrowseSection { key: string; title?: string; chips?: boolean; entries: BrowseEntry[] }
export interface BrowseScreen {
  view: BrowseView;
  /** A list opened: its name, a line about it and the description (a department's). */
  head: { name: string; detail: string; description?: string | null } | null;
  sections: BrowseSection[];
  /** What the status line says (screen readers). */
  status: string;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A chip's words: walking, "Nearest washroom · 8 m"; else the kind ("Washroom"). */
export function chipLabel(chip: Chip, walking: boolean): string {
  if (walking && chip.nearest) return `${chip.nearest.place.name} · ${Math.max(1, Math.round(chip.nearest.length))} m`;
  return chip.label;
}

/** What the menu shows for a view (the start if what was opened is gone). PURE: tested. */
export function browseScreen(menu: BrowseMenu, view: BrowseView, { walking = false, tour = null }: { walking?: boolean; tour?: TourOffer | null } = {}): BrowseScreen {
  const place = (key: string, p: PlaceResult, more: Partial<Extract<BrowseEntry, { type: 'place' }>> = {}): BrowseEntry =>
    ({ type: 'place', key: `${key}:${p.id}`, place: p, ...more });
  const back: BrowseEntry = { type: 'back', key: 'back' };
  const total = (sections: BrowseSection[]) => sections.reduce((n, s) => n + s.entries.filter((e) => e.type !== 'back').length, 0);

  if (view.type === 'department') {
    const d = menu.departments.find((x) => x.id === view.id);
    if (d) {
      const sections: BrowseSection[] = [{ key: 'back', entries: [back] }];
      if (d.place?.kind === 'department') {
        sections.push({ key: 'all', entries: [place('all', d.place, { name: `All of ${d.name}`, detail: d.place.detail })] });
      }
      if (d.rooms.length) sections.push({ key: 'rooms', title: d.rooms.length === 1 ? 'Room' : 'Rooms', entries: d.rooms.map((p) => place('room', p)) });
      if (d.people.length) sections.push({ key: 'people', title: `People (${d.people.length})`, entries: d.people.map((p) => place('person', p)) });
      return { view, head: { name: d.name, detail: d.detail, description: d.description }, sections, status: `${d.name}: ${d.detail}` };
    }
  } else if (view.type === 'kind') {
    const k = menu.kinds.find((x) => x.id === view.id);
    if (k) {
      const sections: BrowseSection[] = [{ key: 'back', entries: [back] }];
      for (const f of k.floors) sections.push({ key: `floor-${f.floorId}`, title: f.floorName, entries: f.places.map((p) => place(`k${f.floorId}`, p)) });
      return { view, head: { name: k.name, detail: `${k.count} · ${k.detail}` }, sections, status: `${k.name}: ${k.count}, ${k.detail}` };
    }
  } else if (view.type === 'floor') {
    const f = menu.floors.find((x) => x.id === view.id);
    if (f) {
      const sections: BrowseSection[] = [{ key: 'back', entries: [back] }, { key: 'rooms', entries: f.places.map((p) => place('f', p)) }];
      return { view, head: { name: f.name, detail: f.detail }, sections, status: `${f.name}: ${f.detail}` };
    }
  }

  // The start: the tour first (v0.14.4)
  const sections: BrowseSection[] = [];
  if (tour) {
    sections.push({ key: 'tour', entries: [{ type: 'tour', key: 'tour', name: 'Take the company tour', detail: tourDetail(tour) }] });
  }
  if (menu.chips.length) {
    sections.push({ key: 'quick', title: walking ? 'Nearest' : 'Quick picks', chips: true,
      entries: menu.chips.map((c) => ({ type: 'chip', key: `chip:${c.facility}`, chip: c, name: chipLabel(c, walking) })) });
  }
  const mine: BrowseEntry[] = [];
  if (menu.myDesk) {
    mine.push(place('mine', menu.myDesk, { name: 'My desk', detail: [menu.myDesk.floorName, menu.myDesk.roomName].filter(Boolean).join(', '), tag: 'my-desk' }));
  }
  if (mine.length) sections.push({ key: 'mine', entries: mine });
  if (menu.recent.length) sections.push({ key: 'recent', title: 'Recent', entries: menu.recent.map((p) => place('recent', p, { tag: 'recent' })) });
  if (menu.departments.length) {
    sections.push({ key: 'departments', title: 'Departments', entries: menu.departments.map((d) => ({
      type: 'open', key: d.id, view: { type: 'department', id: d.id }, name: d.name, detail: d.detail, description: d.description,
    })) });
  }
  if (menu.kinds.length) {
    sections.push({ key: 'kinds', title: 'Places', entries: menu.kinds.map((k) => ({
      type: 'open', key: k.id, view: { type: 'kind', id: k.id }, name: k.name, detail: k.detail, count: k.count,
    })) });
  }
  if (menu.floors.length) {
    sections.push({ key: 'floors', title: 'By floor', entries: menu.floors.map((f) => ({
      type: 'open', key: f.id, view: { type: 'floor', id: f.id }, name: f.name, detail: f.detail,
    })) });
  }
  const n = total(sections);
  return {
    view: { type: 'home' }, head: null, sections,
    status: n ? `Type to search, or choose from ${count(n, 'item')} below` : 'Type a name to search',
  };
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* private window: kept for this visit only */ }
}

export function PlaceSearch({
  engine, walking, people, departments, me = null, children, focusView, touch = false, onOpenChange, tour: offerTour = true, onStartTour, after,
}: PlaceSearchProps) {
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [view, setView] = useState<BrowseView>({ type: 'home' });
  const [recent, setRecent] = useState<string[]>(readRecent);
  // after the menu changes, the entry to choose (the one opened, when going back)
  const chooseRef = useRef<string | null>(null);
  const [shown, setShown] = useState<(ShowResult & { nearest?: string }) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // the route being followed (engine 'navigation' events), and what screen readers hear about it
  const [nav, setNav] = useState<NavigationEvent | null>(null);
  const [said, setSaid] = useState('');

  useEffect(() => {
    if (!engine) return undefined;
    return engine.on('navigation', (e) => {
      // a click on the floor (v0.14.0) or the tour (v0.14.4, its own panel): no strip; it replaced a route shown here
      if (e.source === 'click' || e.source === 'tour') {
        if (e.state === 'started') setNav(null);
        return;
      }
      setNav((was) => {
        if (e.state === 'stopped') return null;
        // what changed is said once (not every metre)
        if (e.state === 'started') setSaid(`Going to ${e.place.name}`);
        else if (e.state === 'arrived') setSaid(`You have arrived: ${e.place.name}`);
        else if (e.state === 'failed') setSaid(e.message ?? 'The route stopped');
        else if (e.paused && !was?.paused) setSaid(touchRef.current ? 'Paused. Tap Continue to walk on' : 'Paused. Press G to continue');
        else if (!e.paused && was?.paused) setSaid(`Going to ${e.place.name}`);
        return e;
      });
      if (e.state !== 'stopped') setShown(null); // the strip takes the card's place
    });
  }, [engine]);

  const typed = query.trim() !== '';
  const result: SearchGroups | null = useMemo(() => {
    if (!engine || !open || !typed) return null;
    const t0 = performance.now();
    const r = engine.navigation.search(query);
    const ms = performance.now() - t0;
    // for tests and the curious: how long the last search took
    queueMicrotask(() => panelRef.current?.setAttribute('data-search-ms', ms.toFixed(2)));
    return r;
    // walking changes "nearest first"; people change who can be found
  }, [engine, open, query, typed, walking, people]);

  // The browse menu (the box empty): made when it opens, and when what it shows changes
  const menu: BrowseMenu | null = useMemo(() => {
    if (!engine || !open || typed) return null;
    return engine.navigation.browse({ recent });
  }, [engine, open, typed, walking, people, departments, me, recent]);
  // the tour's entry (not while a tour runs: its panel is open)
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (!engine) return undefined;
    setTouring(engine.tour.running);
    return engine.on('tour', (e) => setTouring(e.state !== 'idle'));
  }, [engine]);
  const tourOffer: TourOffer | null = useMemo(() => {
    if (!engine || !menu || !offerTour || !onStartTour || touring) return null;
    const plan = engine.navigation.tourPlanReady; // never planned here: the menu doesn't wait
    if (plan && !plan.stops.length) return null;
    const ids = new Set(plan?.stops.map((st) => st.id) ?? []);
    const visited = engine.tour.visitedNow().filter((id) => !plan || ids.has(id)).length;
    return { count: plan?.stops.length ?? null, minutes: plan?.minutes ?? null, visited };
  }, [engine, menu, offerTour, onStartTour, touring]);
  const screen = useMemo(() => (menu ? browseScreen(menu, view, { walking, tour: tourOffer }) : null), [menu, view, walking, tourOffer]);
  const entries = useMemo(() => (screen ? screen.sections.flatMap((s) => s.entries) : []), [screen]);

  // the order shown (Rooms first for "Engineering"): up / down follow it
  const options = useMemo(() => (result ? result.order.flatMap((g) => result.groups[g]) : []), [result]);
  const optionCount = typed ? options.length : entries.length;
  useEffect(() => { setActive(0); }, [result]);
  useEffect(() => {
    const key = chooseRef.current;
    chooseRef.current = null;
    const i = key ? entries.findIndex((e) => e.key === key) : -1;
    // a list opened: its first entry after Back
    setActive(i >= 0 ? i : entries[0]?.type === 'back' && entries.length > 1 ? 1 : 0);
  }, [entries]);

  // A new layout or engine: nothing is shown any more
  useEffect(() => () => { setShown(null); }, [engine]);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (open) {
      inputRef.current?.focus({ preventScroll: true });
      setRecent(readRecent()); // another tab of this browser may have added some
    } else {
      setView({ type: 'home' }); // opening again starts at the start
    }
    onOpenChangeRef.current?.(open);
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
    // found: Find opens on its menu next time (with this place under Recent); Esc keeps what was typed
    setQuery('');
    // a recent search: the place itself ("Nearest washroom" = the one it chose)
    setRecent((was) => {
      const next = addRecent(was, r.place.id);
      saveRecent(next);
      return next;
    });
    close();
  };

  const openView = (next: BrowseView) => {
    setView(next);
    inputRef.current?.focus({ preventScroll: true });
  };
  const goBack = () => {
    if (view.type === 'home') return false;
    chooseRef.current = view.id; // the entry that opened it
    openView({ type: 'home' });
    return true;
  };

  /** Enter or a click on an entry of the menu. */
  const activate = (entry: BrowseEntry | undefined) => {
    if (!entry) return;
    if (entry.type === 'back') goBack();
    else if (entry.type === 'open') openView(entry.view);
    else if (entry.type === 'place') pick(entry.place);
    else if (entry.type === 'tour') {
      setQuery('');
      close(false);
      onStartTour?.();
    }
    else if (entry.type === 'chip') {
      const c = entry.chip;
      if (walking && c.nearest) pick(c.nearest.place); // "Nearest washroom · 8 m": the nearest by walking
      else if (c.place) pick(c.place); // the only one
      else openView({ type: 'kind', id: `kind:${c.kind}` });
    }
  };

  const clearShown = () => {
    engine?.navigation.clear();
    setShown(null);
  };

  /** Show route / Take me there (from above: walking starts at the entrance). */
  const go = (walk: WalkMode) => {
    if (!engine || !shown) return;
    const target = shown.nearest && shown.place.facility ? `nearest:${shown.place.facility}` : shown.place.id;
    const r = engine.navigation.routeTo(target, { walk });
    if (r.problem) {
      setShown({ ...shown, problem: r.problem, message: r.message });
      return;
    }
    focusView?.(); // the keys are the view's: W pauses, G continues, Esc stops
  };

  const stopRoute = () => {
    engine?.navigation.stop();
    setNav(null);
  };
  const closeNav = () => {
    engine?.navigation.clear();
    setNav(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!optionCount) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + optionCount) % optionCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (typed) pick(options[active] ?? options[0]);
      else activate(entries[active] ?? entries[0]);
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && !query && view.type !== 'home') {
      e.preventDefault();
      goBack();
    } else if (e.key === 'Escape') {
      // ours, not the walkthrough's (Esc there gives the keys back to the page)
      e.preventDefault();
      e.stopPropagation();
      if (!typed && goBack()) return; // in a list: back to the start
      close();
    }
  };

  const status = !typed ? (screen?.status ?? '')
    : !result?.total ? `Nothing found for “${query.trim()}”`
      : `${result.total} ${result.total === 1 ? 'result' : 'results'}`;
  const activeId = optionCount ? `${uid}-opt-${Math.min(active, optionCount - 1)}` : undefined;
  let n = -1;

  /** One option of the menu (an entry). */
  const entryOption = (entry: BrowseEntry, i: number) => {
    const on = i === active;
    const common = {
      id: `${uid}-opt-${i}`, role: 'option', 'aria-selected': on,
      onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(), // the focus stays in the box
      onMouseEnter: () => setActive(i),
      onClick: () => activate(entry),
    } as const;
    if (entry.type === 'chip') {
      return (
        <div key={entry.key} {...common} data-quick={entry.chip.label} data-quick-nearest={walking && entry.chip.nearest ? '' : undefined}
          style={{ ...styles.chip, ...(on ? styles.chipOn : null) }}>
          {entry.name}
        </div>
      );
    }
    if (entry.type === 'tour') {
      return (
        <div key={entry.key} {...common} data-tour-offer style={{ ...styles.option, ...styles.openRow, ...styles.tourRow, ...(on ? styles.optionOn : null) }}>
          <span aria-hidden style={styles.tourIcon}><FlagIcon /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={styles.name}>{entry.name}</span>
            <span data-tour-offer-detail style={styles.detail}>{entry.detail}</span>
          </span>
        </div>
      );
    }
    if (entry.type === 'back') {
      return (
        <div key={entry.key} {...common} data-browse-back aria-label="Back to all" style={{ ...styles.option, ...styles.back, ...(on ? styles.optionOn : null) }}>
          <span style={styles.backText}><ChevronIcon left /> All</span>
        </div>
      );
    }
    if (entry.type === 'open') {
      return (
        <div key={entry.key} {...common} data-browse-open={entry.key} style={{ ...styles.option, ...styles.openRow, ...(on ? styles.optionOn : null) }}>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={styles.name}>{entry.name}</span>
            {entry.detail && <span style={styles.detail}>{entry.detail}</span>}
            {entry.description && <span data-description style={styles.description}>{entry.description}</span>}
          </span>
          {entry.count !== undefined && <span aria-hidden style={styles.count}>{entry.count}</span>}
          <span style={styles.srOnly}>, opens a list</span>
          <ChevronIcon />
        </div>
      );
    }
    return (
      <div key={entry.key} {...common} data-place={entry.place.id} data-my-desk={entry.tag === 'my-desk' ? '' : undefined}
        data-recent={entry.tag === 'recent' ? '' : undefined}
        style={{ ...styles.option, ...(on ? styles.optionOn : null) }}>
        <span style={styles.name}>{entry.name ?? entry.place.name}</span>
        <span style={styles.detail}>{entry.detail ?? entry.place.detail}</span>
      </div>
    );
  };

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
        {after}
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
              aria-expanded={optionCount > 0}
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

          {!typed && screen?.view.type === 'home' && (
            <div style={styles.hint}>Type a name, a department or a room, or choose below.</div>
          )}
          {!typed && screen?.head && (
            <div data-browse-head style={styles.head}>
              <span style={styles.headName}>{screen.head.name}</span>
              <span style={styles.detail}>{screen.head.detail}</span>
              {screen.head.description && <span data-description style={styles.headDescription}>{screen.head.description}</span>}
            </div>
          )}

          <div id={`${uid}-list`} role="listbox" aria-label={typed ? 'Search results' : (screen?.head?.name ?? 'Browse')}
            data-browse={!typed && screen ? screen.view.type : undefined} style={styles.list}>
            {typed && result && result.order.map((g) => {
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
            {!typed && screen && screen.sections.map((s) => {
              const titleId = `${uid}-b-${s.key}`;
              return (
                <div key={s.key} role="group" aria-labelledby={s.title ? titleId : undefined} aria-label={s.title ? undefined : s.key === 'mine' ? 'My desk' : undefined}
                  data-browse-group={s.key} style={s.chips ? styles.quick : undefined}>
                  {s.title && <div id={titleId} role="presentation" style={s.chips ? styles.chipsTitle : styles.groupTitle}>{s.title}</div>}
                  {s.entries.map((entry) => {
                    n += 1;
                    return entryOption(entry, n);
                  })}
                </div>
              );
            })}
          </div>
          {typed && !result?.total && <div style={styles.hint}>Nothing found. Try another name, or “washroom”.</div>}
          <div aria-live="polite" role="status" style={styles.srOnly} data-search-status>{status}</div>
        </div>
      )}

      {!open && shown && !nav && (
        <div data-place-shown={shown.place.id} role="status" style={styles.shown}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {shown.nearest && <span style={styles.badge}>{shown.nearest}</span>}
            <span style={styles.name}>{shown.place.name}</span>
            <span style={styles.detail}>{shown.place.detail}</span>
            {(walking || shown.problem) && walkLine(shown) && (
              <span data-walk={shown.problem ? 'problem' : 'route'} style={shown.problem ? styles.problem : styles.walk}>
                {walkLine(shown)}
              </span>
            )}
            {!shown.problem && (
              <div style={styles.actions}>
                <button type="button" data-route="guide" style={styles.secondary} onClick={() => go('guide')}
                  title={walking ? 'A line on the floor shows the way; you walk' : 'Walk from the entrance, with a line on the floor'}>
                  Show route
                </button>
                <button type="button" data-route="auto" style={styles.primary} onClick={() => go('auto')}
                  title={walking ? 'Your character walks there' : 'Walk there from the entrance'}>
                  Take me there
                </button>
              </div>
            )}
          </div>
          <button type="button" aria-label="Clear the place found" title="Clear" style={styles.iconButton} onClick={clearShown}>
            <CloseIcon />
          </button>
        </div>
      )}

      {!open && nav && (
        <div
          data-nav-strip={nav.state}
          data-nav-walk={nav.walk}
          data-nav-paused={nav.paused ? '' : undefined}
          style={{ ...styles.shown, ...(nav.state === 'failed' ? styles.stripFailed : null) }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            {nav.state === 'arrived' && (
              <>
                <span style={styles.badge}>You have arrived</span>
                <span style={styles.name}>{nav.place.name}</span>
                <span style={styles.detail}>{nav.place.detail}</span>
              </>
            )}
            {nav.state === 'failed' && (
              <>
                <span style={styles.name}>{nav.place.name}</span>
                <span data-nav-problem style={styles.problem}>{nav.message ?? 'The route stopped'}</span>
              </>
            )}
            {(nav.state === 'started' || nav.state === 'progress') && (
              <>
                <span data-nav-going style={styles.name}>{goingLine(nav, nav.place.floorName)}</span>
                {nav.paused ? (
                  touch ? <span style={styles.walk}>Paused · Tap Continue to walk on</span>
                    : <span style={styles.walk}>Paused · Press <kbd style={styles.kbd}>G</kbd> to continue</span>
                ) : touch ? (
                  <span style={styles.detail}>{nav.walk === 'auto' ? 'Walking there · the joystick pauses' : 'Follow the line'}</span>
                ) : (
                  <span style={styles.detail}>{nav.walk === 'auto' ? 'Walking there · a movement key pauses' : 'Follow the line · G walks you there'}</span>
                )}
                <div style={styles.actions}>
                  {(nav.paused || nav.walk === 'guide') && (
                    <button type="button" data-nav-continue style={styles.secondary}
                      onClick={() => { engine?.navigation.resume(); focusView?.(); }}>
                      {nav.paused ? 'Continue' : 'Take me there'}
                    </button>
                  )}
                  <button type="button" data-nav-stop style={styles.primary} onClick={stopRoute}>Stop</button>
                </div>
              </>
            )}
          </div>
          {(nav.state === 'arrived' || nav.state === 'failed') && (
            <button type="button" aria-label="Close" title="Close" style={styles.iconButton} onClick={closeNav}>
              <CloseIcon />
            </button>
          )}
        </div>
      )}
      <div aria-live="polite" role="status" style={styles.srOnly} data-nav-said>{said}</div>
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

function FlagIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22V4M4 4h12l-2 4 2 4H4" />
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

function ChevronIcon({ left = false }: { left?: boolean }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', color: '#55625a' }}>
      <path d={left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
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
  hint: { padding: '10px 12px 4px', color: C.muted, fontSize: 13 },
  head: { display: 'flex', flexDirection: 'column', gap: 1, padding: '10px 12px 6px', borderBottom: `1px solid ${C.border}` },
  headName: { display: 'block', fontWeight: 700, fontSize: 15, color: C.text, overflowWrap: 'anywhere' },
  headDescription: { display: 'block', marginTop: 4, fontSize: 13, color: C.text, overflowWrap: 'anywhere' },
  quick: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 12px 8px' },
  chipsTitle: {
    flexBasis: '100%', color: C.muted, font: `600 11px/1.2 ${C.font}`, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 4,
  },
  chip: {
    display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 12px', boxSizing: 'border-box',
    border: `1px solid ${C.border}`, borderRadius: 999, background: C.accentSoft,
    color: C.accent, font: `600 13px/1 ${C.font}`, cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: '100%',
  },
  // the chip ↑ ↓ is on (Enter picks it): a ring, not "pressed"
  chipOn: { border: `1px solid ${C.accent}`, boxShadow: `0 0 0 2px ${C.accent}33` },
  list: { overflowY: 'auto', minHeight: 0, flex: '0 1 auto', paddingBottom: 4 },
  groupTitle: {
    padding: '10px 12px 4px', color: C.muted, font: `600 11px/1.2 ${C.font}`, letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  option: {
    position: 'relative', display: 'flex', flexDirection: 'column', gap: 1, padding: '8px 12px', minHeight: 40, boxSizing: 'border-box',
    justifyContent: 'center', cursor: 'pointer', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
  },
  optionOn: { background: C.accentSoft, borderLeftColor: C.accent },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { minHeight: 36, borderBottom: `1px solid ${C.border}` },
  backText: { display: 'inline-flex', alignItems: 'center', gap: 4, color: C.accent, fontWeight: 600 },
  count: {
    flex: 'none', minWidth: 24, height: 22, padding: '0 7px', boxSizing: 'border-box', borderRadius: 999,
    background: C.hover, color: C.text, font: `600 12px/22px ${C.font}`, textAlign: 'center',
  },
  name: { display: 'block', fontWeight: 600, color: C.text, overflowWrap: 'anywhere' },
  detail: { display: 'block', fontSize: 12.5, color: C.muted, overflowWrap: 'anywhere' },
  description: {
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
    marginTop: 2, fontSize: 12.5, color: C.text, overflowWrap: 'anywhere',
  },
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
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  primary: {
    height: 32, padding: '0 14px', border: `1px solid ${C.accent}`, borderRadius: 999, background: C.accent, color: '#fff',
    font: `600 13px/1 ${C.font}`, cursor: 'pointer',
  },
  secondary: {
    height: 32, padding: '0 14px', border: `1px solid ${C.border}`, borderRadius: 999, background: C.accentSoft, color: C.accent,
    font: `600 13px/1 ${C.font}`, cursor: 'pointer',
  },
  kbd: { border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 5px', background: '#fff', font: `600 12px/1.4 ${C.font}` },
  stripFailed: { borderLeft: `4px solid ${C.danger}` },
  tourRow: { borderBottom: `1px solid ${C.border}` },
  tourIcon: {
    flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
    borderRadius: 999, background: C.accent, color: '#fff',
  },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
};

export default PlaceSearch;

/** The toolbar's pill buttons (Find's look), for the viewer's other ones (Tour). */
export const toolButtonStyles = { off: styles.toolButton, on: styles.toolButtonOn };
