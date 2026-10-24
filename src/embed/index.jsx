/**
 * embed/index.jsx — AHDUSWorkplace: the 3D workplace on a plain HTML page
 * (no React, no build step). docs/EMBED_GUIDE.md.
 *
 *   <script src="ahdus-workplace.js"></script>
 *   const workplace = AHDUSWorkplace.mount(element, {
 *     layoutUrl: '/api/v1/workplace/layouts/…', mode: 'walkthrough',
 *     onEvent: (name, data) => { … }, onError: (err) => { … },
 *   });
 *   workplace.registerAction('CNC_MACHINE', { label: 'Watch CNC training video', run: (target) => { … } });
 *
 * `npm run build:embed` (vite.embed.config.js) makes one IIFE file with React
 * and Babylon inside. It shows <LayoutViewer /> and works through layoutBridge
 * (the same events and "Press E" actions teammates' modules use); it adds no
 * engine logic and has no Workplace Studio code (e2e/embed-smoke.mjs checks).
 * Mode 'edit' is refused: admins edit in Workplace Studio.
 */

import { createRoot } from 'react-dom/client';

import { LayoutViewer } from '../engine/react/LayoutViewer';
import { layoutBridge } from '../integration/layoutBridge';
import { anchorsFromStore } from '../integration/anchorsFromStore';
import { readLayout, modeProblem, actionMatcher, filterAnchors } from './embedLayout';
import css from './embed.css?inline';

/** layoutBridge, for modules on the page (docs/TEAM_INTEGRATION.md): the same object our modules use. */
export const bridge = layoutBridge;

const STYLE_ID = 'ahdus-workplace-style';

/**
 * Where the real assets are (models/, textures/, env/) unless mount() is told:
 * the assets/ folder next to this script (the build puts it there). Read while
 * the script runs: document.currentScript is gone later.
 */
const SCRIPT_ASSETS = (() => {
  try {
    const src = document.currentScript?.src;
    return src ? new URL('assets/', src).href : undefined;
  } catch {
    return undefined;
  }
})();
let mounted = 0;
let mountCount = 0;

/** Add the embed's rules first in <head> (unless the page links ahdus-workplace.css); removed with the last viewer. */
function addStyles() {
  mounted += 1;
  if (document.getElementById(STYLE_ID) || document.querySelector('link[rel="stylesheet"][href*="ahdus-workplace"]')) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.prepend(style);
}

function removeStyles() {
  mounted -= 1;
  if (mounted === 0) document.getElementById(STYLE_ID)?.remove();
}

/** Call a page's callback; its errors are logged, never thrown into the viewer. */
function call(fn, ...args) {
  try {
    fn(...args);
  } catch (err) {
    console.error('[AHDUSWorkplace] your callback failed:', err);
  }
}

/**
 * Show a layout in `element` (give it a size). Returns at once; the layout is
 * drawn a little later (the 'ready' event, `handle.ready`). If it can't be
 * loaded, onError(err) is called and the element is left as it was, so the page
 * can show its own fallback.
 *
 * @param {HTMLElement} element
 * @param {{
 *   layout?: object,                  // v2 layout JSON or an exported .ahdus.json file
 *   layoutUrl?: string,               // or where to fetch it (with the page's cookies)
 *   headers?: Record<string, string>, // extra request headers for layoutUrl (e.g. Authorization)
 *   mode?: 'view' | 'walkthrough',    // default 'view'; 'edit' is refused
 *   quality?: 'high' | 'low',         // 'low': simple models and materials, no downloads (slow PCs)
 *   assetBaseUrl?: string,            // where models/, textures/, env/ are; default: assets/ next to this script
 *   onEvent?: (name: string, data: object) => void,
 *   onError?: (error: Error) => void,
 * }} [options]
 */
export function mount(element, options = {}) {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('AHDUSWorkplace.mount(element, options): element must be an HTML element on the page');
  }
  const { onEvent, onError } = options;
  const quality = options.quality === 'low' ? 'low' : 'high';
  const assetBaseUrl = options.assetBaseUrl ?? SCRIPT_ASSETS;
  const id = ++mountCount;
  let mode = options.mode ?? 'view';
  let layout = null; // the validated v2 layout, once read
  let engine = null; // the LayoutEngine, once the layout is drawn
  let root = null;
  let closed = false;
  let actionCount = 0;
  const pending = []; // calls made before the layout was drawn
  const offs = []; // engine / store subscriptions
  const actions = new Set(); // removers of this viewer's "Press E" actions
  const abort = new AbortController();

  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {}); // only a page that awaits it hears about a failure (onError always does)

  const emit = (name, data) => { if (onEvent) call(onEvent, name, data); };

  // Our own box in the element: the viewer, and "Loading…" until it is drawn
  addStyles();
  const box = document.createElement('div');
  box.className = 'ahdus-workplace';
  const view = document.createElement('div');
  view.className = 'ahdus-workplace__view';
  const loading = document.createElement('div');
  loading.className = 'ahdus-workplace__loading';
  loading.textContent = 'Loading the workplace…';
  box.append(view, loading);
  element.append(box);
  // The canvas follows the element's size (Babylon only listens to the window)
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => engine?.babylonEngine.resize()) : null;
  resize?.observe(box);

  /** Take everything out again: the element is as the page gave it. */
  function close() {
    closed = true;
    abort.abort();
    for (const remove of [...actions]) remove();
    for (const off of offs.splice(0)) off();
    pending.length = 0;
    resize?.disconnect();
    root?.unmount(); // LayoutViewer disconnects from layoutBridge and disposes the engine
    root = null;
    engine = null;
    box.remove();
    removeStyles();
  }

  function fail(err) {
    if (closed) return;
    const error = err instanceof Error ? err : new Error(String(err));
    // LayoutViewer reports from inside its effect: unmount it after that
    queueMicrotask(() => {
      if (closed) return;
      close();
      rejectReady(error);
      if (onError) call(onError, error);
      else console.error(`[AHDUSWorkplace] ${error.message}`);
    });
  }

  function render() {
    root?.render(
      <LayoutViewer
        layout={layout} mode={mode} quality={quality} assetBaseUrl={assetBaseUrl}
        onReady={onReady} onError={fail}
        onCard={(card) => emit('card', { title: card.title, body: card.body ?? card.text ?? '' })}
        style={{ width: '100%', height: '100%' }}
      />,
    );
  }

  function onReady(e) {
    if (closed) return;
    engine = e;
    loading.remove();
    const store = e.getStore();
    const context = { store }; // for layoutBridge's views of this viewer's layout
    const room = (roomId) => layoutBridge._roomView(roomId, context);
    const floor = (floorId) => ({ floorId, name: store.getState().floors[floorId]?.name ?? '' });
    // The payloads layoutBridge sends modules, from this viewer only
    offs.push(
      e.on('enterRoom', (ev) => emit('enterRoom', {
        roomId: ev.roomId, room: room(ev.roomId), floorId: ev.floorId, fromRoomId: ev.fromRoomId,
      })),
      e.on('exitRoom', (ev) => emit('exitRoom', {
        roomId: ev.roomId, room: room(ev.roomId), floorId: ev.floorId, toRoomId: ev.toRoomId,
      })),
      e.on('interact', (ev) => emit('interact', layoutBridge._describeTarget({
        objectId: ev.objectId ?? undefined, roomId: ev.roomId || undefined, part: ev.part ?? undefined,
        point: ev.position, distance: ev.distance,
      }, context))),
      store.subscribe((s) => s.currentFloor, (floorId) => emit('floorChange', floor(floorId))),
    );
    const s = store.getState();
    emit('ready', {
      name: s.layoutName ?? '',
      mode,
      floors: Object.values(s.floors).sort((a, b) => a.id - b.id).map((f) => ({ id: f.id, name: f.name })),
      rooms: Object.keys(s.rooms).map(room),
    });
    for (const fn of pending.splice(0)) fn();
    resolveReady(handle);
  }

  /** Run now if the layout is drawn, else when it is (undefined until then; false once destroyed). */
  const whenReady = (fn) => {
    if (engine) return fn();
    if (!closed) pending.push(fn);
    return closed ? false : undefined;
  };

  /** Show a floor: in view mode the building up to it, walking through Page Up / Down until there. */
  function goToFloor(floorId) {
    const target = Number(floorId);
    const floors = engine.getStore().getState().floors;
    if (!floors[target]) return false;
    const walk = engine.walkthrough;
    if (engine.mode === 'walkthrough' && walk?.isActive()) {
      for (let i = Object.keys(floors).length; i > 0 && walk.getLevel() !== target; i--) {
        walk.stepFloor(walk.getLevel() < target ? 1 : -1);
      }
      return walk.getLevel() === target;
    }
    engine.setFloor(target);
    return true;
  }

  const handle = {
    /** Resolves (with this handle) when the layout is drawn; rejects if it can't be loaded. */
    ready,

    get mode() {
      return mode;
    },

    /** 'view' or 'walkthrough' (false: refused, e.g. 'edit'). */
    setMode(next) {
      const problem = modeProblem(next);
      if (problem) {
        console.warn(`[AHDUSWorkplace] ${problem}`);
        return false;
      }
      if (closed) return false;
      mode = next;
      engine?.setMode(next); // at once, so a focusOn right after it works (LayoutViewer follows on render)
      render();
      return true;
    },

    setFloor(floorId) {
      return whenReady(() => goToFloor(floorId));
    },

    /** Fly the view-mode camera to a room, an item or a hook point (false in walkthrough mode or for an unknown id). */
    focusOn(entityId, { animate = true } = {}) {
      return whenReady(() => engine.mode === 'view' && engine.focusOn(entityId, { animate }));
    },

    /** Outline these rooms / items / hook points (replaces the ones before; [] clears). */
    highlight(entityIds, color) {
      return whenReady(() => {
        const ids = [].concat(entityIds ?? []);
        engine.clearHighlights();
        if (ids.length) engine.highlight(ids, color);
        return true;
      });
    },

    /** Hook points (layoutBridge's shape), filtered by { kind, roomId, floorId, objectId }; [] until ready. */
    anchors(filter) {
      if (!engine) return [];
      const s = engine.getStore().getState();
      return filterAnchors(anchorsFromStore(s.objects, s.anchorData, s.floors), filter);
    },

    /**
     * A "Press E" action in this viewer: registerAction('CNC_MACHINE', { label, run }).
     * The first argument: asset type, hook-point kind, item or hook-point id,
     * 'door' / 'window', a list of those or a function (target) => boolean.
     * @returns {() => void} remove it
     */
    registerAction(match, { label, run, when } = {}) {
      if (typeof run !== 'function') throw new TypeError('registerAction(match, { label, run }): run must be a function');
      const matches = actionMatcher(match);
      // Only on things in this viewer's layout (several viewers can be on one page)
      const mine = (t) => {
        const s = engine?.getStore().getState();
        return !!s && (t.objectId ? !!s.objects[t.objectId] : !!(t.roomId && s.rooms[t.roomId]));
      };
      const remove = layoutBridge.addInteraction({
        id: `ahdus-embed-${id}-${++actionCount}`,
        label: label ?? 'Interact',
        when: (t) => mine(t) && matches(t) && (when ? when(t) : true),
        run,
      });
      const off = () => {
        remove();
        actions.delete(off);
      };
      if (closed) off();
      else actions.add(off);
      return off;
    },

    /** Remove the viewer: the element, the 3D engine, its actions and listeners. */
    destroy() {
      if (closed) return;
      close();
      rejectReady(new Error('The workplace was removed before it was ready'));
    },

    /** For tests and debugging (not part of the embed's API): the LayoutEngine, null until ready. */
    get _engine() {
      return engine;
    },
  };

  // Load: refuse edit, read the layout, then draw it (always after mount() returns)
  (async () => {
    const problem = modeProblem(mode);
    if (problem) throw new Error(problem);
    layout = await readLayout(options, { signal: abort.signal });
    if (closed) return;
    root = createRoot(view);
    render();
  })().catch((err) => {
    if (err?.name !== 'AbortError') fail(err);
  });

  return handle;
}
