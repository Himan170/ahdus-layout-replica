/**
 * react/LayoutViewer.tsx
 *
 * <LayoutViewer />: a company layout to look at (mode "view": orbit and zoom)
 * or walk through (mode "walkthrough": Preview's character, W A S D, mouse,
 * E). Nothing can change the layout. No Workplace Studio code is loaded.
 *
 *   <LayoutViewer layout={json} mode="walkthrough"
 *     onReady={(engine) => …} onEnterRoom={(e) => …} onInteract={(e) => …} />
 *
 * The layout: `layout` (JSON the app shell fetched: a save, an exported file
 * or v2), else `companyId` + `layoutId` (a layout saved in this browser; for
 * our test page). The viewer is connected to layoutBridge (connectEngine),
 * so teammates' modules and their "Press E" actions work in it.
 *
 * A big layout is built a slice at a time, the floor you start on first
 * ("Building your workplace… 40 %" until it shows); onProgress follows it and
 * onReady comes when everything is built.
 *
 * People: `people` ([{ personId, deskId, name, department, character }],
 * LayoutEngine.setPeople) sit at their desks. Pointing at a desk with a
 * person (view mode), or walking up to one, shows a small card with their
 * name and department (text only). A click or a tap on a desk (or a person)
 * keeps their card open until the next click or tap elsewhere: phones have no
 * pointing. `player` is the signed-in person: on their own card, if they never
 * chose a character, "Choose your character" links to `chooseCharacterUrl`.
 * Walking through, they are their own `player.character` (walking with the
 * clip at `walkClipUrl`; none: the simple figure) and their seated figure hides.
 *
 * Walking through (v0.14.0, easy controls): the view takes the keys when
 * walking starts, and again after a click on its own buttons; they also work
 * while the mouse is over it (never while typing in a text field). Drag to
 * look (the cursor stays); click the floor to walk there, a person for their
 * card. A double-click or L captures the mouse (mouse-look mode, a crosshair);
 * Esc releases it, the next Esc gives the keys back to the page. A one-time
 * hint says so; the "?" button lists every key. Tab to the view: a focus ring.
 *
 * Touch (v0.14.1): a joystick at the bottom left walks (push further = faster, let go =
 * stop), a finger dragging anywhere else looks around, a tap on the floor walks there, on a
 * person opens their card. The hint and the "?" help then use touch words, and the HUD is one short
 * line beside the joystick ("Outside · Ground Floor", v0.14.2). Touch
 * words show while the last press was a finger (or, before any press, on a device whose main
 * pointer is coarse); a mouse brings back the keys and mouse words at once.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { LayoutEngine } from '../LayoutEngine';
import type {
  EngineMode, QualityLevel, InteractEvent, EnterRoomEvent, ExitRoomEvent, BuildProgress, Person, PlacedPerson,
  CharacterFile, NavigationEvent,
} from '../LayoutEngine';
import { progressPercent } from '../../play/buildSchedule';
import { connectEngine } from '../../integration/layoutBridge';
// Not apiService: that would bundle saving (the Supabase client) into every viewer
import { readSavedLayout } from '../../services/savedLayouts';
import { PlaceSearch } from './PlaceSearch';
import { AUTO_FOCUS_ATTR } from '../systems/WalkthroughSystem';
import { TouchControls, STICK_SIZE, STICK_MARGIN } from './TouchControls';

export interface LayoutViewerProps {
  /** The layout: a save, an exported layout file or v2 JSON. */
  layout?: unknown;
  /** Or a layout saved in this browser (used when `layout` is not given). */
  companyId?: string;
  layoutId?: string;
  /** 'view' (orbit, default) or 'walkthrough'. */
  mode?: Exclude<EngineMode, 'edit'>;
  /** 'high' (default): realistic look (real models, photo textures, sky); 'low': simple look for slow computers. */
  quality?: QualityLevel;
  /** Where the real assets are (models/, textures/, env/). Default: the app's public/assets/. */
  assetBaseUrl?: string;
  /**
   * Who sits at which desk: [{ personId, deskId, name, department, character:
   * { url, rig: 'mixamo' | 'ue', height } | null }]. Not drawn with quality 'low'.
   */
  people?: Person[];
  /**
   * The person looking (the signed-in user): their own card can offer "Choose your character"; walking through,
   * they are `character` ({ url, rig, height }; null: the simple figure). `walk: false`: they don't walk (slide).
   */
  player?: { personId?: string | number | null; character?: CharacterFile | null; walk?: boolean } | null;
  /** The walk clip (an animation-only .glb, Mixamo bone names) your character walks with; none: the standing pose. */
  walkClipUrl?: string;
  /** Where people choose their character (http(s) or relative to the page); none = no link. */
  chooseCharacterUrl?: string;
  /** The search box ("Find a person, room or place", a toolbar button); false hides it. Default true. */
  search?: boolean;
  /**
   * Descriptions of departments for the search box's menu (v0.14.2): [{ name, description }] (AHDUS:
   * GET /api/teams/departments). Shown under each department of that name that exists here.
   */
  departments?: { name: string; description?: string }[];
  /** The engine is ready and the layout is fully built (focusOn, highlight, getAnchors, …). */
  onReady?: (engine: LayoutEngine) => void;
  /** Building the layout: { done, total, floor, currentFloorReady, allBuilt } (the last one has allBuilt). */
  onProgress?: (progress: BuildProgress) => void;
  onInteract?: (event: InteractEvent) => void;
  onEnterRoom?: (event: EnterRoomEvent) => void;
  onExitRoom?: (event: ExitRoomEvent) => void;
  /** The layout could not be loaded (not found, or not a layout), or the 3D view could not start. */
  onError?: (error: Error) => void;
  /** A card was shown (the default card of E, layoutBridge.showCard): to show it in your own panel too. */
  onCard?: (card: { title: string; body?: string; text?: string; duration?: number }) => void;
  /**
   * The mode changed inside the viewer: "Show route" / "Take me there" from above starts a walk
   * ('walkthrough'). Keep your `mode` prop in step with it.
   */
  onModeChange?: (mode: Exclude<EngineMode, 'edit'>) => void;
  /** Show route / Take me there: { state: 'started' | 'progress' | 'arrived' | 'stopped' | 'failed', place, … }. */
  onNavigation?: (event: NavigationEvent) => void;
  className?: string;
  style?: CSSProperties;
}

interface Card { title: string; body?: string; text?: string; duration?: number }
interface Hud {
  locked?: boolean;
  /** The keys are the view's (mouse captured, or the view has focus). */
  engaged?: boolean;
  hint?: { title?: string; detail?: string };
  message?: string | null;
  roomName?: string;
  /** building.floorPosition: the HUD shows the floor's own name */
  floor?: { index: number; count: number; name?: string };
  prompt?: { label: string; name: string } | null;
}

/** How often the person under the pointer (or next to the walker) is looked up (ms). */
const PERSON_EVERY_MS = 50;
const NEAR_EVERY_MS = 250;
/** After a walk arrives at a person, their card stays while you are this close (m; across a counter too). */
const ARRIVED_CARD_M = 3;
/** A click or tap, not a drag of the view: at most this far (px) and this long (ms) from press to release. */
const TAP_PX = 8;
const TAP_MS = 600;
/** A card kept by a click while walking goes when you walk this far (m) from where you clicked. */
const PINNED_WALK_M = 4;

/** The one-time hint when walking starts (per browser; shown again if storage is blocked). */
export const WALK_HINT = 'W A S D to walk · drag to look · click the floor to go there';
/** …on a touch screen (v0.14.1). */
export const WALK_HINT_TOUCH = 'Joystick to walk · drag to look · tap the floor to go there';
const WALK_HINT_KEY = 'ahdus.walkHintSeen';
/** Seen apart from the mouse one: a laptop with a touch screen gets each once. */
const WALK_HINT_TOUCH_KEY = 'ahdus.walkHintSeen.touch';
/** The hint stays this long (ms), then fades out over HINT_FADE_MS. */
const HINT_MS = 6000;
const HINT_FADE_MS = 800;

/** The "?" help: every key and mouse action while walking. */
export const WALK_HELP: [string, string][] = [
  ['W A S D / arrows', 'Walk'],
  ['Shift', 'Run'],
  ['Drag', 'Look around'],
  ['Click the floor', 'Walk there'],
  ['Click a person', 'Their name card'],
  ['E', 'Use what you look at'],
  ['Space', 'Jump'],
  ['F', 'Fly (Space up, C down, F lands)'],
  ['V', 'First / third person'],
  ['Page Up / Page Down', 'Floor above / below'],
  ['Home', 'Back to the entrance'],
  ['G', 'Walk on along a route'],
  ['Double-click or L', 'Mouse look (Esc releases)'],
  ['Esc', 'Stop a route · give the keys back to the page'],
];

/** The "?" help on a touch screen (v0.14.1). */
export const WALK_HELP_TOUCH: [string, string][] = [
  ['Joystick (bottom left)', 'Walk · push further to go faster'],
  ['Let go of the joystick', 'Stop'],
  ['Drag anywhere else', 'Look around'],
  ['Tap the floor', 'Walk there'],
  ['Tap a person', 'Their name card'],
  ['Tap a machine near you', 'Use it'],
  ['Find', 'A person, room or place'],
  ['Back to entrance', 'Start again at the entrance'],
  ['Joystick on a route', 'Pauses it (Continue walks on)'],
];
/** The help's name: keys and mouse, or touch. */
const HELP_TITLE = 'Keys and mouse';
const HELP_TITLE_TOUCH = 'Touch controls';

/** Does this device point with a finger first (before any press tells)? */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

/** Has this browser seen the walking hint (the touch one: touch)? (storage blocked: no) */
function walkHintSeen(touch: boolean): boolean {
  try { return window.localStorage.getItem(touch ? WALK_HINT_TOUCH_KEY : WALK_HINT_KEY) === '1'; } catch { return false; }
}
function markWalkHintSeen(touch: boolean): void {
  try { window.localStorage.setItem(touch ? WALK_HINT_TOUCH_KEY : WALK_HINT_KEY, '1'); } catch { /* shown again next time */ }
}

/** A link the page gave: only http(s), absolute or relative to the page (never javascript: and the like). */
function safeLink(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url, document.baseURI);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The layout to show, from the props (throws if it can't be found). */
function layoutFrom({ layout, companyId, layoutId }: LayoutViewerProps): unknown {
  if (layout !== undefined && layout !== null) return layout;
  if (companyId && layoutId) {
    const saved = readSavedLayout(companyId, layoutId);
    if (!saved) throw new Error('This layout no longer exists');
    return saved;
  }
  throw new Error('No layout given: pass layout, or companyId and layoutId');
}

export function LayoutViewer(props: LayoutViewerProps) {
  const { mode = 'view', quality = 'high', assetBaseUrl, className, style, search = true } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const keysHintId = useId();
  const [engine, setEngine] = useState<LayoutEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  // the engine's mode: the prop, or a walk started from above (Show route / Take me there)
  const [shownMode, setShownMode] = useState<EngineMode>(mode);
  // the person pointed at (view) or walked up to (walkthrough); at: the cursor in the box (px);
  // pinned: clicked or tapped (stays until the next click or tap, and its link can be clicked)
  const [person, setPerson] = useState<{ who: PlacedPerson; at: { x: number; y: number } | null; pinned?: boolean } | null>(null);
  // walking: the "?" help, and the one-time hint ('shown' → 'fading' → gone)
  const [helpOpen, setHelpOpen] = useState(false);
  const [hint, setHint] = useState<'shown' | 'fading' | null>(null);
  // the Find box is open: the one-time hint waits under it (v0.14.2)
  const [findOpen, setFindOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  // touch words and the joystick (v0.14.1): the last press was a finger (before any: a coarse main pointer)
  const [touchUI, setTouchUI] = useState(coarsePointer);
  const touchRef = useRef(touchUI);
  touchRef.current = touchUI;
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') setTouchUI(true);
      else if (e.pointerType === 'mouse') setTouchUI(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onPointer, { capture: true });
    };
  }, []);
  /** Did the last key or press before a focus come from Tab? The focus ring is for Tab only (not :focus-visible:
   *  after typing in Find, Chrome counts the view's own focus as a keyboard focus). */
  const tabbedRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) tabbedRef.current = e.key === 'Tab'; };
    const onDown = () => { tabbedRef.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  /** Where the walker stood when a click kept a person's card (walking). */
  const pinnedFromRef = useRef<{ x: number; z: number } | null>(null);
  // the latest callbacks, so the engine's handlers never call stale ones
  const propsRef = useRef(props);
  /** The person the last walk (Take me there / Show route) arrived at, while you stay near them. */
  const arrivedRef = useRef<string | null>(null);
  propsRef.current = props;
  const readyFor = useRef<LayoutEngine | null>(null); // onReady once per engine

  // The engine lives as long as the component (React StrictMode mounts twice)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let created: LayoutEngine | null = null;
    let disconnect: (() => void) | null = null;
    let cardTimer: ReturnType<typeof setTimeout> | undefined;
    const offs: (() => void)[] = [];
    // unmounted before the engine is ready (StrictMode): it is disposed at once, so it never shares the canvas's
    // WebGL context with the next one (that broke the next one's sky: a black part in dev)
    const abort = new AbortController();

    LayoutEngine.create(canvas, { mode, quality, assetBaseUrl, focusTarget: boxRef.current, signal: abort.signal }).then((e) => {
      if (disposed) {
        e.dispose();
        return;
      }
      created = e;
      disconnect = connectEngine(e, {
        showCard: (c: Card) => {
          propsRef.current.onCard?.(c);
          clearTimeout(cardTimer);
          setCard(c);
          cardTimer = setTimeout(() => setCard(null), c.duration ?? 6000);
        },
      });
      offs.push(
        e.on('interact', (ev) => propsRef.current.onInteract?.(ev)),
        e.on('enterRoom', (ev) => propsRef.current.onEnterRoom?.(ev)),
        e.on('exitRoom', (ev) => propsRef.current.onExitRoom?.(ev)),
        e.on('hud', (info) => setHud(info as Hud)),
        e.on('mode', ({ mode: m }) => {
          setShownMode(m);
          if (m !== 'edit') propsRef.current.onModeChange?.(m);
        }),
        // A click while walking: on a person, their card stays (as a click from above); elsewhere it goes
        e.on('walkClick', (ev) => {
          if (ev.action === 'person' && ev.person) {
            const p = e.walkthrough?.getPosition();
            pinnedFromRef.current = p ? { x: p.x, z: p.z } : null;
            setPerson({ who: ev.person, at: ev.at, pinned: true });
          } else {
            pinnedFromRef.current = null;
            setPerson((was) => (was?.pinned ? null : was));
          }
        }),
        e.on('navigation', (ev) => {
          if (ev.state === 'arrived') arrivedRef.current = ev.place?.personId != null ? String(ev.place.personId) : null;
          else if (ev.state === 'started') arrivedRef.current = null;
          propsRef.current.onNavigation?.(ev);
        }),
        e.on('progress', (p) => {
          setProgress(p);
          propsRef.current.onProgress?.(p);
        }),
      );
      setEngine(e);
    }).catch((err) => {
      // e.g. no WebGL in this browser
      if (disposed) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError('This browser could not start the 3D view');
      propsRef.current.onError?.(e);
    });

    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(cardTimer);
      offs.forEach((off) => off());
      disconnect?.();
      created?.dispose();
      setEngine(null);
    };
    // mode and quality are applied below / fixed at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or reload) the layout when it changes
  const { layout, companyId, layoutId } = props;
  useEffect(() => {
    if (!engine) return undefined;
    let live = true;
    try {
      engine.loadLayout(layoutFrom({ layout, companyId, layoutId }));
      engine.fitView({ animate: false });
      setError(null);
      // ready = everything built (whenBuilt never resolves once the engine is disposed)
      engine.whenBuilt().then(() => {
        if (!live || readyFor.current === engine) return;
        readyFor.current = engine;
        propsRef.current.onReady?.(engine);
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      // a ZodError's message is the list of bad fields: too much for this card
      setError(e.name === 'ZodError' ? 'This is not an AHDUS layout' : e.message);
      propsRef.current.onError?.(e);
    }
    return () => { live = false; };
  }, [engine, layout, companyId, layoutId]);

  useEffect(() => {
    engine?.setMode(mode);
    if (engine) setShownMode(engine.mode);
  }, [engine, mode]);

  const { people, departments } = props;
  useEffect(() => {
    engine?.setPeople(people ?? []);
  }, [engine, people]);
  useEffect(() => {
    engine?.setDepartments(departments ?? []);
  }, [engine, departments]);

  // You, walking through: your own character (the engine makes it when walking starts)
  const playerKey = JSON.stringify([
    props.player?.personId ?? null, props.player?.character ?? null, props.walkClipUrl ?? null, props.player?.walk ?? true,
  ]);
  useEffect(() => {
    if (!engine) return;
    const [personId, character, walkClipUrl, walk] = JSON.parse(playerKey);
    engine.setPlayer(personId === null && !character ? null
      : { personId: personId === null ? null : String(personId), character, walkClipUrl, walk });
  }, [engine, playerKey]);

  // The person card: pointing at a desk (view mode), walking up to it (walkthrough)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !canvas || !people?.length) { setPerson(null); return undefined; }
    const same = (a: PlacedPerson | null | undefined, b: PlacedPerson | null | undefined) => (a?.personId ?? null) === (b?.personId ?? null);
    if (shownMode === 'walkthrough') {
      const timer = setInterval(() => {
        // a card kept by a click stays until the next click, or until you walk away from it
        const from = pinnedFromRef.current;
        const me = engine.walkthrough?.getPosition();
        if (from && me && Math.hypot(me.x - from.x, me.z - from.z) > PINNED_WALK_M) pinnedFromRef.current = null;
        if (pinnedFromRef.current) return;
        let who = engine.personNearWalker();
        if (!who && arrivedRef.current !== null) {
          who = engine.personNearWalker(ARRIVED_CARD_M, arrivedRef.current);
          if (!who) arrivedRef.current = null; // walked away: back to the usual 1.8 m
        }
        setPerson((was) => (same(was?.who, who) && !was?.pinned ? was : who ? { who, at: null } : null));
      }, NEAR_EVERY_MS);
      return () => { clearInterval(timer); pinnedFromRef.current = null; setPerson(null); };
    }
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pos: { x: number; y: number } | null = null;
    const look = () => {
      timer = undefined;
      last = performance.now();
      const who = pos ? engine.pickPerson(pos.x, pos.y) : null;
      const at = pos;
      setPerson((was) => {
        if (was?.pinned) return was; // a clicked card stays until the next click
        return who && at ? (same(was?.who, who) && was?.at?.x === at.x && was?.at?.y === at.y ? was : { who, at }) : null;
      });
    };
    const spot = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    let down: { x: number; y: number; t: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) { // turning the view (a tap's small jitter too: its release shows the card again)
        pos = null;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_PX) return;
        setPerson(null);
        return;
      }
      pos = spot(e);
      if (timer) return;
      timer = setTimeout(look, Math.max(0, PERSON_EVERY_MS - (performance.now() - last)));
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    // A click or tap: the person there (their card stays), or nobody (the card goes)
    const onUp = (e: PointerEvent) => {
      const was = down;
      down = null;
      if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > TAP_PX || performance.now() - was.t > TAP_MS) return;
      const at = spot(e);
      const who = engine.pickPerson(at.x, at.y);
      setPerson(who ? { who, at, pinned: true } : null);
    };
    // Leaving the canvas (onto a clicked card, to use its link) keeps a clicked card
    const onLeave = () => { pos = null; clearTimeout(timer); timer = undefined; setPerson((was) => (was?.pinned ? was : null)); };
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerdown', onDown, { passive: true });
    canvas.addEventListener('pointerup', onUp, { passive: true });
    canvas.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      clearTimeout(timer);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      setPerson(null);
    };
  }, [engine, shownMode, people]);

  const walking = shownMode === 'walkthrough';
  const engaged = !!(hud?.engaged ?? hud?.locked);
  const floorReady = !progress || progress.currentFloorReady;

  // The HUD's walking line in the same words (the controller writes it)
  useEffect(() => {
    if (walking) engine?.walkthrough?.setTouch(touchUI);
  }, [engine, walking, touchUI]);

  // The one-time hint, when walking starts and the floor shows (once per browser, the touch one apart; StrictMode-safe)
  const hintRef = useRef<{ show: boolean | null; done: boolean; touch: boolean }>({ show: null, done: false, touch: false });
  useEffect(() => {
    const h = hintRef.current;
    if (!walking || error || !engine || !floorReady || h.done) return undefined;
    if (h.show === null) {
      // in the words of how you walk now: keys and mouse, or the joystick (touch, v0.14.1)
      h.touch = touchRef.current;
      h.show = !walkHintSeen(h.touch);
      if (h.show) markWalkHintSeen(h.touch);
    }
    if (!h.show) return undefined;
    setHint('shown');
    const fade = setTimeout(() => setHint('fading'), HINT_MS);
    const gone = setTimeout(() => { h.done = true; setHint(null); }, HINT_MS + HINT_FADE_MS);
    return () => { clearTimeout(fade); clearTimeout(gone); setHint(null); };
  }, [walking, engine, floorReady, error]);

  // The "?" help closes when walking ends, or on a press anywhere else
  useEffect(() => {
    if (!walking) setHelpOpen(false);
  }, [walking]);
  useEffect(() => {
    if (!helpOpen) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (helpButtonRef.current?.contains(t) || (t as Element).closest?.('[data-walk-help]'))) return;
      setHelpOpen(false);
    };
    // Esc closes the help (wherever the focus is), and does nothing else: not the walkthrough's Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setHelpOpen(false);
      if (boxRef.current?.contains(document.activeElement)) helpButtonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [helpOpen]);
  const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Their own card, no character chosen yet: "Choose your character"
  const me = props.player?.personId;
  const chooseUrl = safeLink(props.chooseCharacterUrl);
  const touchWalk = walking && touchUI;
  // walking, the search panel stops above the joystick (touch) or the HUD (mouse): it never covers them
  const toolbarStyle: CSSProperties = walking && !error
    ? { ...styles.topLeft, bottom: touchWalk ? STICK_MARGIN + STICK_SIZE + 12 : TOOLBAR_BOTTOM_WALKING }
    : styles.topLeft;
  const helpTitle = touchUI ? HELP_TITLE_TOUCH : HELP_TITLE;
  const offerChoice = !!(person && chooseUrl && me != null && String(me) === person.who.personId
    && !(person.who.characterChosen ?? !!person.who.character));
  return (
    <div
      ref={boxRef}
      className={className}
      style={{ position: 'relative', overflow: 'hidden', outline: 'none', ...style }}
      data-layout-viewer={shownMode}
      // Walking through: one Tab stop; focus in it gives the view the keys (WalkthroughSystem)
      tabIndex={walking ? 0 : undefined}
      role={walking ? 'application' : undefined}
      aria-label={walking ? 'Layout walkthrough' : undefined}
      aria-describedby={walking ? keysHintId : undefined}
      // the search box is typing, not walking: no focus ring for it; nor when walking or a click gave the
      // view the keys (the ring is for Tab only: tabbedRef)
      onFocus={(e) => {
        const t = e.target as HTMLElement;
        setFocused(!t.closest?.('[data-place-search]') && !t.hasAttribute?.(AUTO_FOCUS_ATTR) && tabbedRef.current);
      }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      <canvas
        ref={canvasRef}
        aria-label={walking ? 'Layout walkthrough' : 'Layout view'}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' }}
      />
      {error && <div role="alert" style={styles.center}>{error}</div>}
      {!error && progress && !progress.currentFloorReady && (
        <div role="status" data-build-progress="start" style={styles.center}>
          Building your workplace… {progressPercent(progress)} %
        </div>
      )}
      {!error && progress?.currentFloorReady && !progress.allBuilt && (
        <div role="status" data-build-progress="rest" style={styles.quiet}>
          Building the rest… {progressPercent(progress)} %
        </div>
      )}
      {(() => {
        // The toolbar, top left: walking, the keys hint and Back to entrance; the search button
        const walkBar = walking && !error && hud ? (
          <>
            {/* the view's description for screen readers (always); the pill shows only in mouse look (v0.14.0):
                the cursor is gone then, and Esc is how to get it back. Otherwise Esc still releases the keys */}
            <span id={keysHintId} data-hud="keys-state" style={styles.srOnly}>
              {touchUI ? 'Use the joystick to walk, drag to look, tap the floor to go there'
                : hud.locked ? 'Mouse look · Esc to release' : engaged ? 'Esc to release' : 'Click the view to walk'}
            </span>
            {hud.locked && <div aria-hidden data-hud="keys" style={styles.keys}>Mouse look · Esc to release</div>}
            <button
              type="button"
              data-hud="entrance"
              style={styles.button}
              title="Back to entrance (Home)"
              onClick={() => engine?.walkthrough?.backToEntrance()}
            >
              Back to entrance
            </button>
            <button
              ref={helpButtonRef}
              type="button"
              data-hud="help"
              aria-label={helpTitle}
              aria-expanded={helpOpen}
              aria-controls={helpOpen ? `${keysHintId}-help` : undefined}
              title={helpTitle}
              style={{ ...styles.button, ...styles.helpButton }}
              onClick={() => setHelpOpen((o) => !o)}
            >
              ?
            </button>
          </>
        ) : null;
        const help = walking && helpOpen && !error ? (
          <div
            id={`${keysHintId}-help`}
            data-walk-help={touchUI ? 'touch' : 'mouse'}
            role="dialog"
            aria-label={helpTitle}
            style={styles.help}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // ours, not the walkthrough's (Esc there gives the keys back to the page)
              e.preventDefault();
              e.stopPropagation();
              setHelpOpen(false);
              helpButtonRef.current?.focus({ preventScroll: true });
            }}
          >
            <div style={styles.helpHead}>
              <strong>{helpTitle}</strong>
              <button type="button" aria-label={`Close ${helpTitle.toLowerCase()}`} title="Close (Esc)" style={styles.helpClose}
                onClick={() => setHelpOpen(false)}>×</button>
            </div>
            <dl style={styles.helpList}>
              {(touchUI ? WALK_HELP_TOUCH : WALK_HELP).map(([key, what]) => (
                <div key={key} style={styles.helpRow}>
                  <dt style={styles.helpKey}>{key}</dt>
                  <dd style={styles.helpWhat}>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null;
        if (search && engine && !error) {
          return (
            <div style={toolbarStyle} data-viewer-toolbar>
              <PlaceSearch engine={engine} walking={walking} people={people} touch={touchUI}
                departments={departments} me={me == null ? null : String(me)} onOpenChange={setFindOpen}
                focusView={() => {
                  // from above the box is no Tab stop yet (walking starts this moment): make it one, then focus it
                  const box = boxRef.current;
                  if (box && box.tabIndex < 0) box.tabIndex = 0;
                  box?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
                }}>{walkBar}</PlaceSearch>
              {help}
            </div>
          );
        }
        return walkBar ? <div style={toolbarStyle} data-viewer-toolbar><div style={styles.row}>{walkBar}</div>{help}</div> : null;
      })()}
      {walking && !error && hud && (
        <>
          {/* mouse-look mode: what a click or E is on (dragging to look needs none: the cursor is there) */}
          {hud.locked && <div aria-hidden data-crosshair style={styles.crosshair}>+</div>}
          {hint && !findOpen && (
            <div role="status" data-walk-hint={hint} data-walk-hint-words={hintRef.current.touch ? 'touch' : 'mouse'}
              style={{
                ...styles.walkHint, ...(hintRef.current.touch ? styles.walkHintTouch : null),
                opacity: hint === 'fading' ? 0 : 1, transition: reducedMotion ? 'none' : `opacity ${HINT_FADE_MS}ms ease`,
              }}>
              {hintRef.current.touch ? WALK_HINT_TOUCH : WALK_HINT}
            </div>
          )}
          {touchWalk && engine && <TouchControls engine={engine} />}
          {touchWalk ? (
            // a touch screen (v0.14.2): ONE short line beside the joystick, never over it (a knob pushed
            // forward rises above the ring): a message or what a tap does, else "Outside · Ground Floor".
            // How to walk is in the hint, the "?" help and the screen readers' line.
            <div data-hud-line="touch" style={styles.hudTouch} aria-live="polite">
              {hud.message ? <span data-hud="hint">{hud.message}</span>
                : hud.prompt ? <span data-hud="prompt">Tap it: {hud.prompt.label}{hud.prompt.name ? `: ${hud.prompt.name}` : ''}</span>
                  : (
                    <>
                      <span data-hud="room"><strong>{hud.roomName}</strong></span>
                      {hud.floor && hud.floor.count > 1 && <span data-hud="floor"> · {hud.floor.name ?? `Floor ${hud.floor.index}`}</span>}
                    </>
                  )}
            </div>
          ) : (
            <div style={styles.hud} aria-live="polite">
              <span data-hud="room"><strong>{hud.roomName}</strong></span>
              {hud.floor && hud.floor.count > 1 && <span data-hud="floor"> · {hud.floor.name ?? `Floor ${hud.floor.index}`}</span>}
              {/* while the one-time hint shows, the keys aren't said twice (a message still shows) */}
              {(hud.message ?? (hint ? null : hud.hint?.detail)) && <div data-hud="hint">{hud.message ?? hud.hint?.detail}</div>}
              {engaged && hud.prompt && (
                <div data-hud="prompt"><kbd style={styles.key}>E</kbd> {hud.prompt.label}{hud.prompt.name ? `: ${hud.prompt.name}` : ''}</div>
              )}
            </div>
          )}
        </>
      )}
      {walking && focused && <div aria-hidden data-focus-ring style={styles.focusRing} />}
      {person && !error && (
        // text only (React escapes it): name and department, nothing else
        <div
          data-person-card={person.who.personId}
          data-pinned={person.pinned ? '' : undefined}
          style={{
            ...styles.person,
            ...(person.at ? personSpot(person.at, boxRef.current, offerChoice ? 80 : 56)
              : touchWalk ? { ...styles.personNear, ...styles.personNearTouch } : styles.personNear),
            ...(person.pinned ? { pointerEvents: 'auto' } : null),
          }}
        >
          <strong style={{ display: 'block' }}>{person.who.name || 'Someone'}</strong>
          {person.who.department && <span>{person.who.department}</span>}
          {offerChoice && chooseUrl && (
            <a href={chooseUrl} data-choose-character style={styles.link}>Choose your character</a>
          )}
        </div>
      )}
      {card && (
        <div role="status" data-viewer-card style={styles.card}>
          <strong>{card.title}</strong>
          <div style={{ whiteSpace: 'pre-line' }}>{card.body ?? card.text}</div>
        </div>
      )}
    </div>
  );
}

/** Next to the cursor, kept inside the box. */
function personSpot(at: { x: number; y: number }, box: HTMLElement | null, height = 56): CSSProperties {
  const w = box?.clientWidth ?? 0;
  const h = box?.clientHeight ?? 0;
  const left = at.x + 14 + 220 > w ? Math.max(4, at.x - 14 - 220) : at.x + 14;
  const top = at.y + 14 + height > h ? Math.max(4, at.y - 14 - height) : at.y + 14;
  return { left, top };
}

/** Walking with a mouse: the toolbar column (the search panel) ends this far from the bottom, above the HUD. */
const TOOLBAR_BOTTOM_WALKING = 100;

// Inline styles: the viewer brings no stylesheet of its own (the app shell has its own look)
const panel: CSSProperties = {
  position: 'absolute', background: 'rgba(15, 23, 42, 0.78)', color: '#fff',
  font: '14px/1.4 Inter, system-ui, sans-serif', borderRadius: 8, padding: '8px 12px', pointerEvents: 'none',
};
const styles: Record<string, CSSProperties> = {
  center: { ...panel, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
  crosshair: {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    color: '#fff', font: '22px/1 system-ui, sans-serif', textShadow: '0 0 3px #000', pointerEvents: 'none',
  },
  hud: { ...panel, left: 12, bottom: 12, maxWidth: 'calc(100% - 24px)' },
  // touch (v0.14.2): one line to the right of the joystick, level with its bottom: the knob, pushed
  // forward, rises half a knob above the ring, and a HUD above the ring hid it
  hudTouch: {
    ...panel, left: STICK_MARGIN + STICK_SIZE + 12, bottom: STICK_MARGIN, maxWidth: `calc(100% - ${STICK_MARGIN + STICK_SIZE + 24}px)`,
    boxSizing: 'border-box', padding: '6px 10px', font: '13px/18px Inter, system-ui, sans-serif',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  // a column: the toolbar row, then the search panel (as wide as the box allows, so full width on a phone)
  topLeft: {
    position: 'absolute', left: 12, right: 12, top: 12, bottom: 12, display: 'flex', flexDirection: 'column',
    alignItems: 'flex-start', pointerEvents: 'none',
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  keys: { ...panel, position: 'static', padding: '4px 10px', fontSize: 13 },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap', border: 0,
  },
  button: {
    ...panel, position: 'static', padding: '4px 10px', fontSize: 13, pointerEvents: 'auto', cursor: 'pointer',
    border: '1px solid #fff6',
  },
  // The view has the keys: drawn over the canvas (an outline would be clipped by the page's box)
  focusRing: {
    position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 'inherit',
    boxShadow: 'inset 0 0 0 2px #fff, inset 0 0 0 4px #2563eb',
  },
  card: { ...panel, top: 12, right: 12, maxWidth: 320 },
  helpButton: { minWidth: 30, fontWeight: 700, textAlign: 'center' },
  // under the toolbar, as the search panel
  help: {
    ...panel, position: 'relative', pointerEvents: 'auto', marginTop: 8, width: '100%', maxWidth: 360, maxHeight: '100%',
    boxSizing: 'border-box', overflowY: 'auto', padding: '8px 12px 10px', background: 'rgba(15, 23, 42, 0.9)',
  },
  helpHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  helpClose: {
    border: 'none', background: 'transparent', color: '#fff', font: '20px/1 system-ui, sans-serif', cursor: 'pointer',
    width: 28, height: 28, borderRadius: 6,
  },
  helpList: { margin: 0, display: 'grid', gap: 3, fontSize: 13 },
  helpRow: { display: 'flex', gap: 10, justifyContent: 'space-between' },
  helpKey: { fontWeight: 600, whiteSpace: 'nowrap' },
  helpWhat: { margin: 0, textAlign: 'right', opacity: 0.9 },
  // the one-time hint: over the middle of the view, near the bottom
  walkHint: {
    ...panel, left: '50%', bottom: 64, transform: 'translateX(-50%)', textAlign: 'center', padding: '8px 14px',
    maxWidth: 'calc(100% - 24px)', boxSizing: 'border-box', width: 'max-content',
  },
  // touch: clear of the joystick and the HUD beside it
  walkHintTouch: { bottom: 'auto', top: '40%' },
  quiet: { ...panel, right: 12, bottom: 12, padding: '4px 10px', fontSize: 12, opacity: 0.8 },
  key: { border: '1px solid #fff8', borderRadius: 4, padding: '0 5px', marginRight: 4 },
  person: { ...panel, maxWidth: 220, padding: '6px 10px', fontSize: 13, overflowWrap: 'anywhere' },
  link: { display: 'block', marginTop: 4, color: '#a7f3d0', textDecoration: 'underline', fontWeight: 600 },
  // walking up to a desk: above the HUD, in the middle
  personNear: { left: '50%', bottom: 96, transform: 'translateX(-50%)', textAlign: 'center' },
  // touch: above the joystick and its knob pushed forward (the HUD is beside it)
  personNearTouch: { bottom: STICK_MARGIN + STICK_SIZE + 44 },
};

export default LayoutViewer;
