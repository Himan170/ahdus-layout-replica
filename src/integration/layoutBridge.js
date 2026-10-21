/**
 * integration/layoutBridge.js
 *
 * THE way other AHDUS modules connect to the company layout.
 *
 *   import { layoutBridge } from '@/integration/layoutBridge';
 *
 * The layout module says WHERE things are (anchors: seats, workstations,
 * machines, reception desks, spawn points) and WHEN the user does something
 * (presses E on an object, walks into a room). Each teammate's module decides
 * WHAT to do (play a video, start a conversation, show handover notes).
 * Nobody has to change the layout code to plug in.
 *
 * Reading      getAnchors(filter), getAnchor(id), getObject(id), getRoom(id), getRooms(filter),
 *              getCurrentFloor(), getPlayer(), getScene()
 * Writing      setPositionRef(anchorId, positionId), setAnchorLabel(anchorId, label)   (undoable)
 * Events       on('interact' | 'enterRoom' | 'exitRoom' | 'anchorsChange', handler) → unsubscribe
 * Press E      addInteraction({ id, label, when, run }) → remove
 * UI helper    showCard({ title, body, duration })
 * Positions    setPositionProvider(() => [{ id, title, department? }])   (Yashashwi)
 *
 * Which layout: Workplace Studio and every viewer (a LayoutEngine connected
 * with connectEngine, e.g. by <LayoutViewer />) attach a context. The bridge
 * reads and writes the ACTIVE one: the last attached of those in edit or
 * walkthrough mode, else the last attached (so with Studio and a view-only
 * viewer on one page, Studio). With none attached: the app's store.
 * In view and walkthrough mode the layout can't be changed (writes return false).
 *
 * See docs/TEAM_INTEGRATION.md for examples per teammate.
 */

import { useWorkspaceStore } from '../store/workspaceStore';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { ROOM_TYPES } from '../utils/roomStore';
import { anchorsFromStore, anchorsForObject, primaryAnchor } from './anchorsFromStore';
import { elevationOf } from '../play/building';

export const EVENTS = ['interact', 'enterRoom', 'exitRoom', 'anchorsChange'];

const listeners = new Map(EVENTS.map((e) => [e, new Set()]));
let interactions = [];
let positionProvider = null;

// Contexts attached by Workplace Studio and connected engines, oldest first:
//   { store?, editor?, scene?, play?, showCard?, onPositionsChange?, mode? }
// store: a workspace store (default the app's); editor: its editorHistory;
// play: the character (isActive, getPosition, getYaw, getRoomId);
// mode: 'edit' (default) | 'view' | 'walkthrough' (may be a getter).
let contexts = [];

const modeOf = (c) => c.mode ?? 'edit';

/** The context the bridge works on (see the top of this file), or null. */
function activeContext() {
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (modeOf(contexts[i]) !== 'view') return contexts[i];
  }
  return contexts.at(-1) ?? null;
}

const storeOf = (c) => c?.store ?? useWorkspaceStore;
const state = () => storeOf(activeContext()).getState();

// ── Public views (plain data, safe to keep; never the live store objects) ──

function objectView(o, s = state()) {
  if (!o) return null;
  return {
    id: o.id,
    assetType: o.assetType,
    label: o.label || ASSET_TYPES[o.assetType]?.label || o.assetType,
    category: ASSET_TYPES[o.assetType]?.category ?? null,
    department: o.department || null,
    roomId: o.roomId ?? null,
    floorId: o.floor ?? 0,
    // world position (y includes the floor's height)
    position: { x: o.x, y: elevationOf(s.floors, o.floor ?? 0) + (o.y ?? 0), z: o.z },
    rotationY: o.rotationY ?? 0,
    isLocked: !!o.isLocked,
  };
}

function roomView(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    typeLabel: ROOM_TYPES[r.type]?.label ?? r.type,
    floorId: r.floor ?? 0,
    center: { x: r.x, z: r.z },
    width: r.width,
    depth: r.depth,
  };
}

function allAnchors() {
  const s = state();
  return anchorsFromStore(s.objects, s.anchorData, s.floors);
}

function emit(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[layoutBridge] "${event}" handler failed:`, err);
    }
  }
}

// ── anchorsChange: watch the active store only while someone is listening ──

let unsubscribeStore = null;
let watchedStore = null;
let anchorsKey = '';
let pendingAnchorsEmit = false;

function keyOf(anchors) {
  return JSON.stringify(anchors.map((a) => [a.id, a.position.x, a.position.y, a.position.z,
    a.rotationY, a.roomId, a.floorId, a.positionRef ?? '', a.label ?? '']));
}

/** Tell anchorsChange listeners if the anchors are no longer the ones they had. */
function anchorsMayHaveChanged() {
  if (pendingAnchorsEmit) return;
  pendingAnchorsEmit = true;
  // Batch: several store updates in one action → one event
  queueMicrotask(() => {
    pendingAnchorsEmit = false;
    if (!unsubscribeStore) return;
    const anchors = allAnchors();
    const key = keyOf(anchors);
    if (key === anchorsKey) return;
    anchorsKey = key;
    emit('anchorsChange', { anchors });
  });
}

function watchAnchors() {
  if (unsubscribeStore) return;
  watchedStore = storeOf(activeContext());
  anchorsKey = keyOf(allAnchors());
  unsubscribeStore = watchedStore.subscribe((s, prev) => {
    if (s.objects === prev.objects && s.anchorData === prev.anchorData) return;
    anchorsMayHaveChanged();
  });
}

function unwatchAnchors() {
  unsubscribeStore?.();
  unsubscribeStore = null;
  watchedStore = null;
}

function unwatchAnchorsIfUnused() {
  if (unsubscribeStore && listeners.get('anchorsChange').size === 0) unwatchAnchors();
}

/** Another context became active: watch its store; its anchors are news if they differ. */
function contextsChanged() {
  if (!unsubscribeStore || watchedStore === storeOf(activeContext())) return;
  const key = anchorsKey;
  unwatchAnchors();
  watchAnchors();
  const next = anchorsKey;
  anchorsKey = key;
  if (next !== key) anchorsMayHaveChanged();
}

// ─────────────────────────────────────────────────────────────────────────

export const layoutBridge = {
  version: 1,

  // ── Reading the layout ─────────────────────────────────────────────────

  /**
   * Hook points in the layout.
   * @param {{kind?: string, roomId?: string, floorId?: number|string, objectId?: string}} [filter]
   * @returns {Array<{id, kind, floorId, roomId, position:{x,y,z}, rotationY, objectId?, positionRef?, label?}>}
   */
  getAnchors(filter = {}) {
    return allAnchors().filter((a) =>
      (filter.kind === undefined || a.kind === filter.kind) &&
      (filter.roomId === undefined || a.roomId === filter.roomId) &&
      (filter.floorId === undefined || a.floorId === filter.floorId) &&
      (filter.objectId === undefined || a.objectId === filter.objectId));
  },

  getAnchor(anchorId) {
    return allAnchors().find((a) => a.id === anchorId) ?? null;
  },

  getAnchorsByRoom(roomId) {
    return this.getAnchors({ roomId });
  },

  getObject(objectId) {
    const s = state();
    return objectView(s.objects[objectId], s);
  },

  getRoom(roomId) {
    return roomView(state().rooms[roomId]);
  },

  /** @param {{floorId?: number|string}} [filter] */
  getRooms(filter = {}) {
    return Object.values(state().rooms)
      .filter((r) => filter.floorId === undefined || r.floor === filter.floorId)
      .map(roomView);
  },

  getCurrentFloor() {
    const s = state();
    return { id: s.currentFloor, name: s.floors[s.currentFloor]?.name ?? '' };
  },

  /** Where the user's character is (null when not in Build mode). */
  getPlayer() {
    const play = activeContext()?.play;
    if (!play?.isActive()) return null;
    const p = play.getPosition();
    return { position: { x: p.x, y: p.y, z: p.z }, yaw: play.getYaw(), roomId: play.getRoomId?.() ?? null };
  },

  /**
   * The Babylon.js scene, for modules that draw in 3D (e.g. Harsh's characters).
   * Add your own meshes; never dispose or change the layout's meshes or materials.
   */
  getScene() {
    return activeContext()?.scene ?? null;
  },

  // ── Writing (undoable, saved with the layout) ──────────────────────────

  /**
   * Link a workstation (or any anchor) to an org position, e.g. "Engineering Head".
   * Pass null to remove the link. Returns false if the anchor doesn't exist, or
   * the layout can't be changed (a viewer in view or walkthrough mode).
   */
  setPositionRef(anchorId, positionId) {
    if (!this.getAnchor(anchorId)) return false;
    return applyAnchorData(anchorId, { positionRef: positionId || null },
      positionId ? 'Link position' : 'Remove position link');
  },

  /** Human-readable name for an anchor, e.g. "Reception Desk A". */
  setAnchorLabel(anchorId, label) {
    if (!this.getAnchor(anchorId)) return false;
    return applyAnchorData(anchorId, { label: label || null }, 'Rename hook point');
  },

  // ── Events ─────────────────────────────────────────────────────────────

  /**
   * @param {'interact'|'enterRoom'|'exitRoom'|'anchorsChange'} event
   * @param {(payload) => void} handler
   * @returns {() => void} call it to stop listening
   */
  on(event, handler) {
    const set = listeners.get(event);
    if (!set) throw new Error(`[layoutBridge] unknown event "${event}". Use one of: ${EVENTS.join(', ')}`);
    set.add(handler);
    if (event === 'anchorsChange') watchAnchors();
    return () => this.off(event, handler);
  },

  off(event, handler) {
    listeners.get(event)?.delete(handler);
    if (event === 'anchorsChange') unwatchAnchorsIfUnused();
  },

  // ── Press E ────────────────────────────────────────────────────────────

  /**
   * Offer an action when the user looks at something and presses E.
   * The first registered interaction whose `when` matches wins; its label is
   * shown on screen ("E  Watch operation video").
   *
   * @param {{
   *   id: string,
   *   label: string | ((target) => string),
   *   when: (target) => boolean,
   *   run: (target) => void,
   * }} interaction
   * @returns {() => void} call it to remove the interaction
   */
  addInteraction(interaction) {
    if (!interaction?.id || typeof interaction.run !== 'function') {
      throw new Error('[layoutBridge] addInteraction needs { id, run } (and usually when, label)');
    }
    interactions = interactions.filter((i) => i.id !== interaction.id).concat(interaction);
    return () => { interactions = interactions.filter((i) => i !== interaction); };
  },

  // ── UI helper ──────────────────────────────────────────────────────────

  /**
   * Show a message card in Build mode (until Dhruv's app shell provides its own UI).
   * @param {{title: string, body?: string, duration?: number}} card  duration in ms (default 6000)
   */
  showCard(card) {
    activeContext()?.showCard?.(card);
  },

  // ── Positions (org chart) ──────────────────────────────────────────────

  /**
   * Yashashwi's module tells the layout which positions exist, so the planner
   * can offer them in a dropdown when linking a desk.
   * @param {() => Array<{id: string, title: string, department?: string}>} provider
   */
  setPositionProvider(provider) {
    positionProvider = provider;
    for (const c of contexts) c.onPositionsChange?.();
  },

  getPositions() {
    try {
      return positionProvider?.() ?? [];
    } catch (err) {
      console.error('[layoutBridge] position provider failed:', err);
      return [];
    }
  },

  // ── Used by the layout editor itself (not for other modules) ───────────

  _attach(context) {
    contexts = contexts.filter((c) => c !== context).concat(context);
    contextsChanged();
  },
  _detach(context) {
    contexts = contexts.filter((c) => c !== context);
    contextsChanged();
  },
  _emit: emit,
  /** Only for tests: the context the bridge works on. */
  _activeContext: activeContext,

  /**
   * Turn what the player is looking at into the payload modules receive.
   * @param {{objectId?: string, roomId?: string, part?: string, point?: {x,y,z}, distance?: number}} raw
   * @param {object} [context]  whose layout it is in (default the active one)
   */
  _describeTarget(raw, context = activeContext()) {
    const s = storeOf(context).getState();
    const obj = raw.objectId ? s.objects[raw.objectId] : null;
    const anchors = obj ? anchorsForObject(obj, s.anchorData, s.floors) : [];
    const anchor = primaryAnchor(anchors);
    const roomId = obj?.roomId ?? raw.roomId ?? null;
    const room = roomId ? s.rooms[roomId] : null;
    return {
      kind: obj ? 'object' : (raw.part ?? 'unknown'),
      objectId: obj?.id ?? null,
      object: objectView(obj, s),
      anchors,
      anchor,
      anchorId: anchor?.id ?? null,
      anchorKind: anchor?.kind ?? null,
      positionRef: anchor?.positionRef ?? null,
      roomId,
      room: roomView(room),
      floorId: obj?.floor ?? room?.floor ?? s.currentFloor,
      point: raw.point ?? null,
      distance: raw.distance ?? null,
    };
  },

  /** The interaction that would run for a target, or null. */
  _interactionFor(target) {
    for (const i of interactions) {
      try {
        if (i.when && !i.when(target)) continue;
        const label = typeof i.label === 'function' ? i.label(target) : i.label;
        if (label === null || label === false) continue;
        return { id: i.id, label: label || 'Interact', run: i.run };
      } catch (err) {
        console.error(`[layoutBridge] interaction "${i.id}" failed:`, err);
      }
    }
    return null;
  },

  /** Card shown when no module has an action for what you pressed E on. */
  _defaultCard(t) {
    const name = t.object?.label ?? (t.kind === 'door' ? 'Door' : t.kind === 'window' ? 'Window' : 'This');
    const facts = [];
    if (t.anchorKind) facts.push(`Hook point: ${ANCHOR_KIND_LABEL[t.anchorKind] ?? t.anchorKind}`);
    if (t.room) facts.push(t.room.name);
    if (t.positionRef) {
      const pos = this.getPositions().find((p) => p.id === t.positionRef);
      facts.push(`Linked position: ${pos?.title ?? t.positionRef}`);
    }
    return {
      title: name,
      body: `${facts.join(' · ')}${facts.length ? '\n' : ''}No module has an action for this yet.`,
    };
  },

  /** What E would do on a raw target, for the prompt ("E  Watch operation video"). */
  _prompt(raw, context = activeContext()) {
    const t = this._describeTarget(raw, context);
    const action = this._interactionFor(t);
    return {
      label: action?.label ?? 'Details',
      name: t.object?.label ?? (t.kind === 'door' ? 'Door' : t.kind === 'window' ? 'Window' : ''),
      handled: !!action,
    };
  },

  /** A room as modules see it, from a context's layout (enterRoom / exitRoom payloads). */
  _roomView(roomId, context = activeContext()) {
    return roomView(storeOf(context).getState().rooms[roomId]);
  },

  /** E on a target: tell the modules, run the first matching action, else show the default card. */
  _interact(raw, context = activeContext()) {
    const t = this._describeTarget(raw, context);
    emit('interact', t);
    const action = this._interactionFor(t);
    if (action) {
      try {
        action.run(t);
      } catch (err) {
        console.error(`[layoutBridge] interaction "${action.id}" failed:`, err);
      }
    } else {
      context?.showCard?.(this._defaultCard(t));
    }
  },

  /** Only for tests: forget all listeners, interactions, providers and contexts. */
  _resetForTests() {
    for (const set of listeners.values()) set.clear();
    interactions = [];
    positionProvider = null;
    unwatchAnchors();
    contexts = [];
  },
};

const ANCHOR_KIND_LABEL = {
  machine: 'Machine', workstation: 'Workstation', seat: 'Seat',
  reception: 'Reception', spawn: 'Spawn point', 'info-point': 'Info point',
};

function applyAnchorData(anchorId, patch, label) {
  const ctx = activeContext();
  if (ctx?.editor) {
    // refused outside edit mode (a LayoutEngine's editor answers { problem })
    return !ctx.editor.setAnchorData(anchorId, patch, { label })?.problem;
  }
  if (ctx && modeOf(ctx) !== 'edit') return false;
  // No editor open (e.g. a background module): write directly, not undoable
  state().setAnchorData(anchorId, patch);
  return true;
}

/**
 * Connect a LayoutEngine (a viewer) to the bridge: modules read its layout
 * and get its walkthrough's events (enterRoom, exitRoom, interact), and their
 * "Press E" actions run in it. <LayoutViewer /> and <LayoutEditor /> do this;
 * call it yourself only when you use LayoutEngine without them.
 * @param {import('../engine/LayoutEngine').LayoutEngine} engine
 * @param {{ showCard?: (card: {title: string, body?: string, duration?: number}) => void }} [options]
 *   showCard: how this viewer shows a card (the default card of E, layoutBridge.showCard)
 * @returns {() => void} disconnect (call before engine.dispose())
 */
export function connectEngine(engine, { showCard } = {}) {
  const context = {
    store: engine.getStore(),
    editor: engine.editor,
    scene: engine.scene,
    get play() { return engine.walkthrough; },
    get mode() { return engine.mode; },
    showCard,
  };
  const room = (id) => layoutBridge._roomView(id, context);
  const offs = [
    engine.on('enterRoom', (e) => emit('enterRoom', {
      roomId: e.roomId, room: room(e.roomId), floorId: e.floorId, fromRoomId: e.fromRoomId,
    })),
    engine.on('exitRoom', (e) => emit('exitRoom', {
      roomId: e.roomId, room: room(e.roomId), floorId: e.floorId, toRoomId: e.toRoomId,
    })),
    engine.on('interact', (e) => layoutBridge._interact({
      objectId: e.objectId ?? undefined, roomId: e.roomId || undefined, part: e.part ?? undefined,
      point: e.position, distance: e.distance,
    }, context)),
  ];
  // What E would do, for the walkthrough's prompt ("E  Watch operation video")
  engine.describeInteraction = (raw) => layoutBridge._prompt(raw, context);
  layoutBridge._attach(context);
  return () => {
    for (const off of offs) off();
    engine.describeInteraction = null;
    layoutBridge._detach(context);
  };
}
