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
 *   workplace.setPeople([{ personId, deskId, name, department, assetReference }]);  // option characters: { manifestUrl }
 *   workplace.setPlayer({ personId, assetReference });  // the signed-in person: walking through they are their own
 *                                      // character (characters.walkClipUrl); their card offers characters.chooseUrl
 *   workplace.find('Kavya');           // search people, rooms and places (the viewer's "Find" box does the same;
 *                                      // option navigation: { search: false } hides the box)
 *   workplace.goTo('Kavya Iyer', { walk: 'auto' });  // walk there: 'guide' = Show route (a line on the floor),
 *                                      // 'auto' = Take me there; onEvent('navigation', { state, … }); stopRoute()
 *   workplace.startTour({ follow: 'auto' }); // the company tour from the main entrance ('self' = "I'll walk");
 *                                      // onEvent('tour', { type, state, index, count, stop, … }); stopTour()
 *   mount(element, { startMode: 'walkthrough', openAt: { personId } }) // v0.14.6: walk by default with the
 *                                      // welcome card, the Overview / Walk button top right, the last choice
 *                                      // remembered, weak devices from above; openAt = a deep link (no card)
 *   workplace.live.add({ personId, floor, x, z, yaw, state }); // v0.16.1: someone on the page now, walking there
 *   workplace.live.update(personId, { floor, x, z, yaw, state }); workplace.live.remove(personId); // back to their desk
 *   onEvent('pose', { state, floor, x, y, z, yaw })     // your own walk, ≤ 5 a second: the page sends it on
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
import { readLayout, modeProblem, actionMatcher, filterAnchors, cleanDepartments, cleanOpenAt } from './embedLayout';
import { parseManifest, readManifest, resolvePeople, resolvePlayer, resolveLive, walkClipUrlOf } from './characterManifest';
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

/** The 'tour' event for the page: the stop's public part (not the whole plan). */
function tourEvent(ev) {
  const st = ev.stop;
  return {
    type: ev.type, state: ev.state, follow: ev.follow, index: ev.index, count: ev.count, visited: [...ev.visited],
    remaining: ev.remaining, message: ev.message, mention: ev.mention ? { name: ev.mention.name, text: ev.mention.text, side: ev.mention.side } : null,
    stop: st ? { id: st.id, n: st.n, kind: st.kind, name: st.name, floor: st.floor, floorName: st.floorName, text: st.text } : null,
  };
}

/**
 * Show a layout in `element` (give it a size). Returns at once; the layout is
 * built a slice at a time, the start floor first ('progress' events), and
 * 'ready' / `handle.ready` come when everything is built. If it can't be
 * loaded, onError(err) is called and the element is left as it was, so the page
 * can show its own fallback.
 *
 * @param {HTMLElement} element
 * @param {{
 *   layout?: object,                  // v2 layout JSON or an exported .ahdus.json file
 *   layoutUrl?: string,               // or where to fetch it (with the page's cookies)
 *   headers?: Record<string, string>, // extra request headers for layoutUrl (e.g. Authorization)
 *   mode?: 'view' | 'walkthrough',    // default 'view'; 'edit' is refused
 *   startMode?: 'walkthrough' | 'view', // v0.14.6, instead of mode: the viewer decides the start (walking + the
 *                                     // welcome card; the person's last choice, a weak device = from above) and
 *                                     // shows its own Overview / Walk button; onEvent('mode', { mode }) follows it;
 *                                     // v0.14.8: onEvent('start', { mode, reason, weak }) says why it started so
 *   openAt?: { personId } | { roomId } | string, // v0.14.6, with startMode: open at a person or room (a deep
 *                                     // link): from above shown, walking Show route from the entrance; no card
 *   weakDevice?: boolean,             // v0.14.6: the weak-device test's answer, given (default: tested)
 *   quality?: 'high' | 'low',         // 'low': simple models and materials, no downloads (slow PCs)
 *   assetBaseUrl?: string,            // where models/, textures/, env/ are; default: assets/ next to this script
 *   characters?: { manifestUrl?: string, manifest?: object, chooseUrl?: string, walkClipUrl?: string },
 *                                     // the manifest: assetReference → { url, rig, height } (setPeople, player);
 *                                     // chooseUrl: where people choose their character; walkClipUrl: the walk clip
 *   player?: { personId?: string, assetReference?: string | null, clothing?: object | null }, // the signed-in person (setPlayer): walking
 *                                     // through they are their own character; "Choose your character" on their card
 *   navigation?: { search?: boolean, tour?: boolean }, // search: the "Find a person, room or place" box; tour: the Tour
 *                                     // button and Find's "Take the company tour" (each default true; false hides it)
 *   departments?: { name: string, description?: string }[], // descriptions in the Find box's menu (setDepartments)
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
  // startMode (v0.14.6): the viewer decides the start; `mode` follows it ('mode' events)
  const startMode = options.startMode ?? null;
  const openAt = cleanOpenAt(options.openAt);
  let mode = startMode ? null : options.mode ?? 'view';
  let started = null; // how it started and why (v0.14.8: the 'start' event), startMode only
  let layout = null; // the validated v2 layout, once read
  let engine = null; // the LayoutEngine, once the layout is drawn
  let root = null;
  let closed = false;
  let actionCount = 0;
  const pending = []; // calls made before the layout was drawn
  const offs = []; // engine / store subscriptions
  const actions = new Set(); // removers of this viewer's "Press E" actions
  const abort = new AbortController();
  let people = []; // who sits where (setPeople), resolved through the manifest
  let peopleGiven = new Map(); // setPeople's entries as the page gave them, by personId (who a live person is)
  const liveGiven = new Map(); // v0.16.1: the live people as the page gave them (added again when the viewer is ready)
  let manifest = null; // Promise of the character manifest, read on the first setPeople / player's character
  let manifestRead = null; // …and its result, once read
  let playerGiven = options.player ?? null; // the signed-in person (setPlayer), as the page gave it
  let player = resolvePlayer(playerGiven, new Map()); // …as the viewer takes it ({ personId, character, walk })
  const walkClipUrl = walkClipUrlOf(options.characters, document.baseURI);
  const search = options.navigation?.search !== false;
  const tour = options.navigation?.tour !== false;
  let departments = cleanDepartments(options.departments); // descriptions in the Find box's menu (setDepartments)

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

  /** The character manifest (option characters), read once: parseManifest's result (v1 or v2). */
  function characterMap() {
    manifest ??= readManifest(options.characters, { headers: options.headers, signal: abort.signal, pageUrl: document.baseURI })
      .then((m) => {
        if (m.problems.length) console.warn(`[AHDUSWorkplace] character manifest: ${m.problems.join('; ')}`);
        return m;
      }, (err) => {
        if (err?.name !== 'AbortError') console.warn(`[AHDUSWorkplace] ${err.message}: everyone is a simple figure`);
        return parseManifest({});
      }).then((m) => {
        manifestRead = m;
        // the live people added before it was read get their characters now
        if (engine && !closed) for (const raw of liveGiven.values()) addLive(raw);
        return m;
      });
    return manifest;
  }

  /** v0.16.1: a live person into the viewer (their character from the manifest once it is read). */
  function addLive(raw) {
    const person = resolveLive(raw, manifestRead ?? new Map(), peopleGiven);
    return !!person && !!engine?.live.add(person);
  }

  /** The signed-in person: at once by personId, then with their character once the manifest is read. */
  async function updatePlayer(given) {
    if (closed) return;
    playerGiven = given;
    player = resolvePlayer(given, new Map());
    render();
    if (typeof given?.assetReference !== 'string' && (given?.personId ?? '') === '') return; // (v0.16.0: no character = their neutral one)
    const characters = await characterMap();
    if (closed || playerGiven !== given) return;
    player = resolvePlayer(given, characters);
    render();
  }

  function render() {
    root?.render(
      <LayoutViewer
        layout={layout} mode={mode ?? undefined} startMode={startMode ?? undefined} openAt={openAt}
        weakDevice={typeof options.weakDevice === 'boolean' ? options.weakDevice : undefined} onModeChange={onModeChange}
        onStart={onStart}
        quality={quality} assetBaseUrl={assetBaseUrl} people={people}
        player={player} chooseCharacterUrl={options.characters?.chooseUrl} walkClipUrl={walkClipUrl ?? undefined}
        search={search} tour={tour} departments={departments} onReady={onReady} onError={fail} onProgress={onProgress}
        onCard={(card) => emit('card', { title: card.title, body: card.body ?? card.text ?? '' })}
        style={{ width: '100%', height: '100%' }}
      />,
    );
  }

  /** The viewer's mode changed (its start, Overview / Walk, "Take me there" from above): the page hears it. */
  function onModeChange(next) {
    if (closed || next === mode || next === 'edit') return;
    mode = next;
    render();
    emit('mode', { mode: next });
  }

  /**
   * How it started and why (v0.14.8, startMode only; before the first 'mode' event): reason 'start' (startMode),
   * 'remembered' (the person's last Overview / Walk), 'weak' (a weak device: from above; weak = 'software' | 'low')
   * or 'link' (openAt).
   */
  function onStart(start) {
    if (closed) return;
    started = { mode: start.mode, reason: start.reason, weak: start.weak ?? null };
    emit('start', { ...started });
  }

  /** Building the layout: the viewer shows its own "Building your workplace… 40 %" from now on. */
  function onProgress(progress) {
    if (closed) return;
    loading.remove();
    emit('progress', { ...progress });
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
      // Show route / Take me there: started, progress, arrived, stopped, failed
      e.on('navigation', (ev) => emit('navigation', { ...ev })),
      // the company tour (v0.14.4): what changed, and where the tour is (the plan itself stays inside)
      e.on('tour', (ev) => emit('tour', tourEvent(ev))),
      // v0.16.1: your own walk for the page to send to the others (≤ 5 a second, a keepalive every 4 s)
      e.on('pose', (pose) => emit('pose', { ...pose })),
      // ("Take me there" from above starts walking: the page's mode follows through onModeChange)
    );
    const s = store.getState();
    emit('ready', {
      name: s.layoutName ?? '',
      mode: mode ?? e.mode,
      floors: Object.values(s.floors).sort((a, b) => a.id - b.id).map((f) => ({ id: f.id, name: f.name })),
      rooms: Object.keys(s.rooms).map(room),
    });
    for (const fn of pending.splice(0)) fn();
    // v0.16.1: the live people given while it was loading
    if (liveGiven.size) {
      characterMap();
      for (const raw of liveGiven.values()) addLive(raw);
    }
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
      return mode ?? startMode;
    },

    /** How it started and why (v0.14.8): { mode, reason, weak }, or null (no startMode, or not started yet). */
    get start() {
      return started ? { ...started } : null;
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

    /**
     * Who sits at which desk: [{ personId, deskId, name, department, assetReference, clothing }]
     * (clothing, v0.16.0: what they chose in the Wardrobe, { pantsColor, upperBody, upperColor }: play/outfit.js)
     * (replaces the list before; [] = nobody). A person's character comes from the
     * manifest (option characters) by assetReference; unknown or null = the
     * neutral simple figure. Only name and department are ever shown. Nothing is
     * drawn with quality 'low'.
     * @returns {Promise<number>} how many people were given (after the manifest is read)
     */
    async setPeople(list) {
      if (closed) return 0;
      const given = resolvePeople(list, new Map()).length; // a bad list is refused before waiting
      peopleGiven = new Map(list.filter((p) => p && typeof p === 'object' && p.personId != null).map((p) => [String(p.personId).trim(), p]));
      const characters = await characterMap();
      if (closed) return 0;
      people = resolvePeople(list, characters);
      render();
      return given;
    },

    /**
     * The person looking at the workplace (the signed-in user): { personId } (as in setPeople), or null.
     * If they sit at a desk and never chose a character, their card links to characters.chooseUrl.
     */
    setPlayer(next) {
      return updatePlayer(next ?? null);
    },

    /**
     * Descriptions of the departments for the Find box's menu: [{ name, description }] (replaces the
     * list before; AHDUS: GET /api/teams/departments). Shown under each department of that name that
     * exists in the layout (rooms' departmentRef) or among the people (setPeople). Text only.
     * @returns {number} how many were taken
     */
    setDepartments(list) {
      if (closed) return 0;
      departments = cleanDepartments(list);
      render();
      return departments.length;
    },

    /**
     * Search people (name and department), rooms, departments and facilities ("washroom", "meeting",
     * "reception", "stairs"): the results in the order the search box shows them (People, Rooms,
     * Facilities; at most `limit` per group, default 6), each { id, kind, group, name, detail, floorId,
     * floorName, roomId, roomName, department, facility, entityId, personId?, deskId? }. [] until ready.
     * Show one with focusOn(result.entityId) and highlight(result.entityId).
     */
    find(query, { limit } = {}) {
      if (!engine || closed) return [];
      return engine.navigation.find(String(query ?? ''), { limit });
    },

    /**
     * Go to a person, room or place: a search result's id ('person:p1', 'room:room_a', 'nearest:RESTROOM'),
     * { personId }, { roomId }, { deskId }, { type: 'RESTROOM' } or a name ('Kavya Iyer', the first search result).
     * walk 'guide' (default) = Show route: a line on the floor, you walk; 'auto' = Take me there: you are walked
     * there (a movement key pauses, G goes on, Esc stops). From above it starts walking at the entrance.
     * Answers { place, walk, length, seconds, floors } or { problem, message }; undefined until ready.
     * onEvent('navigation', { state: 'started' | 'progress' | 'arrived' | 'stopped' | 'failed', place, remaining, … }).
     */
    goTo(target, { walk } = {}) {
      return whenReady(() => {
        let to = target;
        if (typeof to === 'string' && !/^(person|room|item|department|nearest|spot):/.test(to)) {
          to = engine.navigation.find(to, { limit: 1 })[0]?.id ?? to;
        }
        return engine.navigation.routeTo(to, { walk: walk === 'auto' ? 'auto' : 'guide' });
      });
    },

    /** End Show route / Take me there (false: there was none). */
    stopRoute() {
      return whenReady(() => engine.navigation.stop());
    },

    /**
     * The company tour (v0.14.4): from the main entrance (from above too), each department once, a washroom and
     * a meeting room per floor, floor by floor. follow 'auto' ("Walk me", default) or 'self' ("I'll walk": the
     * line shows the way). Answers { count, minutes, length } or { problem, message }; undefined until ready.
     * onEvent('tour', { type: 'started' | 'walking' | 'arrived' | 'paused' | 'resumed' | 'done' | 'ended' | …,
     * state, follow, index, count, stop: { id, name, kind, floor, text } | null, visited }).
     */
    startTour({ follow } = {}) {
      return whenReady(() => engine.tour.start({ follow: follow === 'self' ? 'self' : 'auto' }));
    },

    /** End the tour (false: none). You stay where you are, walking. */
    stopTour() {
      return whenReady(() => engine.tour.stop());
    },

    /**
     * v0.16.1, live presence: the people who have the page open now (AHDUS: its WebSocket), drawn where they walk,
     * ~250 ms behind and gliding, with a name tag; everyone else sits at their desk. Nothing is saved.
     * - add({ personId, floor, x, z, y?, yaw, state, name?, department?, assetReference?, clothing? }): someone came
     *   (or again: their samples start again). state: 'idle' | 'walk' | 'run' | 'wave', or 'overview' (looking from
     *   above: they stand up beside their desk). No x / z: on the page, but not on a floor you can see (not drawn).
     *   name, department, assetReference and clothing default to setPeople's entry of the same personId.
     * - update(personId, { floor, x, z, y, yaw, state }): a new sample (false: never added). Someone who sat back
     *   down after 10 s of silence is live again with it.
     * - remove(personId): they left: back to their desk. clear(): everyone (the connection dropped).
     * Silent for 10 s (no update): they sit back down by themselves. The nearest 30 on the floor shown are drawn.
     */
    live: {
      add(person) {
        if (closed) return false;
        const id = person && typeof person === 'object' ? String(person.personId ?? '').trim() : '';
        if (!id) return false;
        liveGiven.set(id, { ...person, personId: id });
        if (!engine) return true; // added when the viewer is ready
        if (!manifestRead) characterMap();
        return addLive(liveGiven.get(id));
      },
      update(personId, sample) {
        const id = String(personId ?? '').trim();
        const was = liveGiven.get(id);
        if (closed || !was || !sample || typeof sample !== 'object') return false;
        liveGiven.set(id, { ...was, ...sample, personId: id });
        if (!engine) return true;
        const patch = resolveLive({ ...sample, personId: id }, manifestRead ?? new Map(), peopleGiven, { sampleOnly: true });
        if (patch && engine.live.update(id, patch)) return true;
        // silent for 10 s, they sat back down: heard again = live again
        return addLive(liveGiven.get(id));
      },
      remove(personId) {
        const id = String(personId ?? '').trim();
        const had = liveGiven.delete(id);
        engine?.live.remove(id);
        return had;
      },
      clear() {
        liveGiven.clear();
        engine?.live.clear();
      },
      /** Who is live now: [{ personId, name, floor, state, drawn: 'full' | 'figure' | null, atDesk }]. */
      list() {
        if (!engine) return [...liveGiven.keys()].map((personId) => ({ personId, name: '', floor: null, state: null, drawn: null, at: null, atDesk: false }));
        return engine.live.list();
      },
      get count() {
        return engine ? engine.live.count : liveGiven.size;
      },
    },

    /** v0.16.1: your own pose now ({ state, floor, x?, y?, z?, yaw? }; the 'pose' event sends it as it changes), or null. */
    get pose() {
      return engine?.getPose() ?? null;
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
    const problem = modeProblem(startMode ?? mode);
    if (problem) throw new Error(problem);
    layout = await readLayout(options, { signal: abort.signal });
    if (closed) return;
    root = createRoot(view);
    render();
    // the player option's character, from the manifest (unless setPlayer came first)
    if (playerGiven === (options.player ?? null)) updatePlayer(playerGiven);
  })().catch((err) => {
    if (err?.name !== 'AbortError') fail(err);
  });

  return handle;
}
