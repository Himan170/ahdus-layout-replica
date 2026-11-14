/**
 * LayoutEngine.ts
 *
 * The public API for the AHDUS Company Layout Engine.
 * Pure Babylon.js + TypeScript — no React dependency.
 *
 * Usage:
 *   const engine = await LayoutEngine.create(canvas, { mode: 'edit' });
 *   engine.loadLayout(jsonData);
 *   engine.on('select', handler);
 *   engine.dispose();
 *
 * React wrappers (<LayoutEditor />, <LayoutViewer />) delegate to this class.
 *
 * Each engine keeps its own copy of the layout in its own workspace store
 * (store/workspaceStore.createWorkspaceStore: the app's store shape, v1 field
 * names), so a viewer and Workplace Studio can be open on one page. It draws
 * that copy with the same systems as Studio (systems/SceneSetup, RoomSystem,
 * ObjectSystem, FloorSystem) and redraws whatever changes in it.
 *
 * STATUS (22 Oct 2026): being built (TEAM_TASKS H2).
 *   Real:  model/ (v2 schema, v1 → v2 migration and back: toV1, anchor ids),
 *          commands/ (the editor's undo/redo, through store/editorHistory.js),
 *          systems/SceneSetup, RoomSystem, ObjectSystem, FloorSystem,
 *          systems/CameraSystem, HighlightSystem,
 *          loadLayout (saves, export files, v2) draws the layout; getLayout
 *          returns it as v2; setFloor, setView, focusOn, fitView, highlight, clearHighlights;
 *          modes (setMode); `editor` (store/editorHistory.js on this engine's
 *          store) refuses every edit outside edit mode;
 *          people at their desks (setPeople: systems/CharacterSystem; none
 *          with quality 'low'); walking through as your own character
 *          (setPlayer: systems/PlayerCharacter, the walk clip retargeted).
 *   Stubs (TODO):  systems/PlacementSystem, SelectionSystem.
 *
 * Modes:
 *   edit         orbit camera; `editor` changes the layout (undoable)
 *   view         orbit camera; nothing can change the layout
 *   walkthrough  Preview's character (W A S D, mouse, E, Page Up / Down:
 *                systems/WalkthroughSystem); nothing can change the layout;
 *                fires enterRoom, exitRoom, interact, walkClick. The view takes
 *                the keys when walking starts (options.focusTarget); drag to
 *                look, click the floor to walk there (v0.14.0)
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';

import type { Layout, Anchor, LayoutObject, AnchorKind } from './model/schema';
import { loadLayout as parseLayout } from './model/migrate';
import { toV1, storeFloorIds, mergeV2Extras } from './model/toV1';
import { NavigationSystem } from './systems/NavigationSystem';
import type { NavigationEvent, DepartmentInfo } from './systems/NavigationSystem';
import { RouteLineSystem } from './systems/RouteLineSystem';
import { TourSystem, TOUR_HIGHLIGHT } from './systems/TourSystem';
import type { TourEvent } from './systems/TourSystem';
import { CommandHistory } from './commands/CommandHistory';
import type { Command } from './commands/CommandHistory';
import { createLayoutScene } from './systems/SceneSetup';
import type { LayoutScene } from './systems/SceneSetup';
import { RoomSystem } from './systems/RoomSystem';
import type { V1Room } from './systems/RoomSystem';
import { ObjectSystem } from './systems/ObjectSystem';
import { FloorSystem } from './systems/FloorSystem';
import { setCameraView, flyTo, boundsOf } from './systems/CameraSystem';
import type { GroundBox } from './systems/CameraSystem';
import { HighlightSystem } from './systems/HighlightSystem';
import { CharacterSystem, validCharacter } from './systems/CharacterSystem';
import type { Person, PlacedPerson, CharacterFile, Clothing } from './systems/CharacterSystem';
import { cleanClothing } from '../play/outfit';
import { createPlayerCharacter } from './systems/PlayerCharacter';
import { LiveSystem } from './systems/LiveSystem';
import type { LivePersonInput, LiveInfo } from './systems/LiveSystem';
import { FullCapMonitor } from './systems/FullCap';
import { createPoseThrottle, poseOf, liveStateOf } from '../play/live';
import { seatPose } from '../play/people';
import { SceneBuilder } from './systems/SceneBuilder';
import type { BuildProgress } from './systems/SceneBuilder';
import { elevationOf } from '../play/building';
import { WalkthroughSystem } from './systems/WalkthroughSystem';
import type { WalkthroughTarget, WalkthroughClick } from './systems/WalkthroughSystem';
import { createWorkspaceStore } from '../store/workspaceStore';
import { createEditorHistory } from '../store/editorHistory';
import { primaryAnchor } from '../integration/anchorsFromStore';
import { softwareRenderer } from './startMode';

/** Item types only Studio shows (markers for the editor): hidden in view and walkthrough mode (v0.13.1). */
export const STUDIO_ONLY_TYPES = ['SPAWN_POINT'];
/** v0.17.0: full characters start this many frames after the start floor is drawn (the building first). */
export const CHARACTERS_AFTER_FRAMES = 10;

// ── Types ────────────────────────────────────────────────────────────────

export type EngineMode = 'edit' | 'view' | 'walkthrough';
export type ViewMode = '3d' | '2d';
export type QualityLevel = 'high' | 'low';

export interface EngineOptions {
  mode?: EngineMode;
  /** create(): aborted before the engine is ready = it is disposed at once and create() rejects (an AbortError). */
  signal?: AbortSignal;
  /** 'high' (default): realistic look (real furniture models, photo textures, HDRI sky); 'low': simple models and materials. */
  quality?: QualityLevel;
  /** Where the real assets are (models/, textures/, env/). Default: the app's public/assets/. */
  assetBaseUrl?: string;
  /**
   * Walkthrough mode: the view's box. The keys are the view's while it is
   * engaged: its canvas has the mouse, focus is in this element, or the mouse
   * is over it. Walking starts with the focus in it (it is made focusable).
   * Default: the canvas.
   */
  focusTarget?: HTMLElement | null;
  /**
   * Time per build slice in ms (default 10): a layout is built a slice at a
   * time, the start floor first, so the page never freezes. Infinity builds
   * it at once.
   */
  buildBudgetMs?: number;
  /**
   * v0.16.1: at most this many full characters (seated + live). Default: measured from the frame rate
   * (FullCapMonitor: 12, up to 24 while frames stay smooth; weak devices 12).
   */
  fullCharacters?: number;
}

/**
 * v0.16.1: your own pose for the page to send to the others (live presence): walking { state: 'idle' | 'walk' |
 * 'run' | 'wave', floor, x, y (above the floor), z, yaw }, from above { state: 'overview', floor }. At most 5 a
 * second, only when it changed, and a keepalive every 4 s (play/live.js createPoseThrottle).
 */
export interface PoseEvent {
  state: 'idle' | 'walk' | 'run' | 'wave' | 'overview';
  floor: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
}

export interface SelectEvent {
  entityId: string;
  entityType: 'room' | 'object' | 'anchor';
}

export interface ChangeEvent {
  type: string;           // 'addObject' | 'deleteObject' | 'transform' | ...
  entityId: string;
  timestamp: number;
}

export interface InteractEvent {
  anchorId: string | null;
  objectId: string | null;
  position: { x: number; y: number; z: number };
  roomId: string;
  /** 'door' or 'window' when E was pressed on one; null on an item. */
  part: string | null;
  /** How far the character stood from it (m). */
  distance: number;
}

export interface EnterRoomEvent {
  roomId: string;
  floorId: string | number;
  roomName: string;
  roomType: string;
  /** The room the character came from (null: from outside). */
  fromRoomId: string | null;
}

export interface ExitRoomEvent {
  roomId: string;
  floorId: string | number;
  /** The room the character went into (null: outside). */
  toRoomId: string | null;
}

type EventMap = {
  select: SelectEvent;
  change: ChangeEvent;
  interact: InteractEvent;
  enterRoom: EnterRoomEvent;
  exitRoom: ExitRoomEvent;
  /** What Preview's HUD would show while walking through (aim, hint, floor). */
  hud: unknown;
  /** How far building the layout is (after loadLayout, and big changes); allBuilt: everything is drawn. */
  progress: BuildProgress;
  /** Show route / Take me there: started, progress, arrived, stopped, failed (v0.13.4). */
  navigation: NavigationEvent;
  /** The mode changed (setMode, or "Take me there" from above starting a walk). */
  mode: { mode: EngineMode };
  /** A plain click on the walking view (v0.14.0): what it did. */
  walkClick: WalkClickEvent;
  /** (v0.14.7) E near the person a walk arrived at: show their details (the viewer pins their card). */
  personDetails: PersonDetailsEvent;
  /** The company tour (v0.14.4): started, walking, arrived, paused, resumed, follow, mention, progress, done, ended, problem. */
  tour: TourEvent;
  /** v0.16.1: your own pose, for the page to send to the others (PoseEvent). */
  pose: PoseEvent;
};

/**
 * A plain click (not a drag) on the walking view, and what it did (v0.14.0):
 * 'person' (their card: the viewer pins it), 'interact' (a module's action, as E),
 * 'walk' (a route there, walk 'auto', source 'click'), 'none' (nothing there, or no way there: message).
 */
export interface WalkClickEvent {
  action: 'person' | 'interact' | 'walk' | 'none';
  /** Where it was clicked (CSS px from the canvas's top left). */
  at: { x: number; y: number };
  person?: PlacedPerson;
  objectId?: string | null;
  to?: { x: number; z: number; floor: number };
  problem?: string;
  message?: string;
}

/** E after a walk arrived at a person (v0.14.7): their details. Placed (with where they sit) when drawn. */
export interface PersonDetailsEvent {
  person: PlacedPerson | Person;
}

export type { NavigationEvent, TourEvent };

export type { BuildProgress };
export type { Person, PlacedPerson, CharacterFile, Clothing };
export type { LivePersonInput, LiveInfo };

/**
 * The person looking (the signed-in user). Walking through, they are their
 * own `character` (null: Preview's simple figure), walking with the clip at
 * `walkClipUrl` (none, or `walk: false`: the standing pose); their figure at
 * their desk (`personId`, as in setPeople) isn't drawn meanwhile.
 */
export interface Player {
  personId?: string | null;
  character?: CharacterFile | null;
  /** v0.16.0: what they wear (AHDUS's Wardrobe; play/outfit.js), for a Rocketbox outfit file. */
  clothing?: Clothing | null;
  walkClipUrl?: string | null;
  walk?: boolean;
}

/** What every edit answers outside edit mode. */
export const READ_ONLY = 'This layout is view-only here';

/** Editor calls that change nothing, so they work in every mode. */
const ALWAYS_ALLOWED = new Set(['clear', 'endBurst']);
/** Overview (v0.14.6): at least this far (m) around where you stood, looking down at least this steeply. */
/**
 * (v0.14.7) After a walk arrives at a person, E means them (their details, as a click on them) until you walk this far
 * (m) from where it arrived: the viewer keeps their card that long too (ARRIVED_CARD_M).
 */
export const ARRIVED_NEAR_M = 3;
const OVERVIEW_AROUND = 6;
const OVERVIEW_BETA = 0.75;

/** The editor's commands (store/editorHistory.js), on an engine's own store. */
export type LayoutEditorApi = ReturnType<typeof createEditorHistory>;

type EventHandler<K extends keyof EventMap> = (event: EventMap[K]) => void;

/** An engine's own workspace store (the app's store shape, v1 field names). */
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

/** create() was aborted (options.signal). */
function abortError(): Error {
  const err = new Error('The engine was not needed any more (aborted)');
  err.name = 'AbortError';
  return err;
}

// ── LayoutEngine ─────────────────────────────────────────────────────────

export class LayoutEngine {
  // Core Babylon
  readonly babylonEngine: Engine;
  readonly scene: Scene;
  private _layoutScene: LayoutScene;

  // Config
  private _mode: EngineMode;
  private _quality: QualityLevel;
  private _view: ViewMode = '3d';
  private _focusTarget: HTMLElement | null;

  // Data: this engine's copy of the layout (v1 field names), and the v2
  // layout as loaded (for what only v2 has: routes, floor links, …)
  private _store: WorkspaceStore;
  private _loaded: Layout | null = null;
  private _cachedLayout: Layout | null = null;
  private _unsubscribe: () => void;
  private _unsubscribeFloor: () => void;

  // Drawing (the same systems as Workplace Studio)
  readonly rooms: RoomSystem;
  readonly objects: ObjectSystem;
  readonly floors: FloorSystem;
  readonly highlights: HighlightSystem;
  /** People at their desks (null with quality 'low': no people at all). */
  readonly characters: CharacterSystem | null;
  /**
   * v0.16.1: the people on the page now, drawn where they walk (add / update / remove: LiveSystem). With
   * quality 'low' too (simple figures and name tags only).
   */
  readonly live: LiveSystem;
  /** v0.16.1: how many full characters this device draws (measured from its frame rate). */
  readonly fullCap: FullCapMonitor;
  private _liveTick: (() => void) | null = null;
  private _capTick: (() => void) | null = null;
  private _pose = createPoseThrottle();
  private _poseWas: { x: number; z: number; t: number; speed: number } | null = null;
  /** Search, show and go to places (find, show, clear: v0.13.3; routeTo, stop: v0.13.4). */
  readonly navigation: NavigationSystem;
  /** The company tour (v0.14.4): start({ follow }), pause, resume, next, previous, skip, stop; the 'tour' event. */
  readonly tour: TourSystem;
  private _tourTick: (() => void) | null = null;
  /** The route line of Show route / Take me there (made when first shown). */
  private _routeLine: RouteLineSystem | null = null;
  private _warmed: Promise<void> = Promise.resolve();
  /** Where Overview left you walking (resumeWalk goes back there); a new layout forgets it. */
  private _walkPlace: { x: number; z: number; yaw: number; pitch: number; floor: number } | null = null;
  /** Builds the layout in slices (progressive loading). */
  private _builder: SceneBuilder;

  // Edits: the editor's commands on this engine's store, refused outside edit mode
  readonly editor: LayoutEditorApi;
  /** The undo/redo history of `editor` (and executeCommand). */
  readonly history: CommandHistory;

  // Walkthrough mode (made the first time it is needed: it needs the canvas)
  private _walkthrough: WalkthroughSystem | null = null;
  private _player: Player | null = null;
  /** setPeople's list (E's person details, also with quality 'low'). */
  private _people: Person[] = [];
  /** (v0.14.7) The person the last walk arrived at, and where it arrived: E means them while you stay near. */
  private _arrived: { personId: string; name: string; x: number; z: number; floor: number } | null = null;
  /** What the walkthrough's character was made from ('' = the simple figure). */
  private _playerKey = '';
  private _playerToken = 0;
  private _playerReady: Promise<void> = Promise.resolve();

  /**
   * What E would do on what the character looks at, for the walkthrough's
   * prompt; layoutBridge.connectEngine sets it (modules' "Press E" actions).
   */
  describeInteraction: ((target: WalkthroughTarget) => { label: string; name: string; handled: boolean } | null) | null = null;
  private _loading = false;

  // Event bus (one Set per event name; typed at the on/off/emit boundary)
  private _listeners = new Map<keyof EventMap, Set<(event: any) => void>>();

  // ── Factory ────────────────────────────────────────────────────────────

  /**
   * Create a new LayoutEngine attached to a canvas element.
   * This is the main entry point.
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: EngineOptions = {},
  ): Promise<LayoutEngine> {
    const { signal } = options;
    if (signal?.aborted) throw abortError();
    const engine = new LayoutEngine(createLayoutScene(canvas, { quality: options.quality, assetBaseUrl: options.assetBaseUrl }), options);
    // Allow one frame for the scene to initialise. Aborted meanwhile (React StrictMode unmounts at once): disposed
    // NOW, not when ready. Two engines on one canvas share its WebGL context: one still drawing (or decoding the
    // sky) while the next starts breaks the next one's first sky face (v0.14.0: a black part of the sky in dev).
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        engine.dispose();
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      engine.scene.executeWhenReady(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
    });
    return engine;
  }

  /**
   * An engine on a scene made elsewhere (unit tests use a NullEngine). The
   * engine owns it from now on: dispose() disposes it.
   */
  static fromScene(layoutScene: LayoutScene, options: EngineOptions = {}): LayoutEngine {
    return new LayoutEngine(layoutScene, options);
  }

  private constructor(layoutScene: LayoutScene, options: EngineOptions) {
    this._mode = options.mode ?? 'edit';
    this._quality = options.quality ?? 'high';
    this._focusTarget = options.focusTarget ?? null;

    this._layoutScene = layoutScene;
    this.babylonEngine = layoutScene.engine;
    this.scene = layoutScene.scene;

    this._store = createWorkspaceStore();
    const shadowGenerator = layoutScene.lights?.shadowGenerator;
    this.rooms = new RoomSystem(this.scene, { shadowGenerator });
    this.objects = new ObjectSystem(this.scene, { shadowGenerator });
    this.floors = new FloorSystem(this.rooms, this.objects, () => this._store.getState());
    // Seen from above (view / edit): the chosen floor without its roof, the floors above hidden,
    // so its desks and people show. Walking switches to inside / outside (onViewChange).
    this.floors.setFloor(this._store.getState().currentFloor);
    this.highlights = new HighlightSystem(this.rooms, this.objects);
    this.characters = this._quality === 'low' ? null : new CharacterSystem(this.scene, {
      getLayout: () => this._store.getState(),
      getObjectMesh: (id) => this.objects.getObjectMesh(id),
      // v0.17.0: the building first: full characters (files, clips) only once the start floor is drawn and has had
      // a few frames (the simple figures show meanwhile)
      ready: () => this._charactersReady(),
    });
    this.live = new LiveSystem(this.scene, {
      getLayout: () => this._store.getState(),
      characters: this.characters,
      seatOf: (personId) => {
        const placed = this.characters?.getPlaced().find((p) => p.personId === personId);
        if (placed) return placed;
        const deskId = this._people.find((p) => p.personId === personId)?.deskId;
        const s = this._store.getState();
        return deskId ? seatPose(deskId, s.objects, s.floors) : null;
      },
      getWalker: () => {
        const walk = this._walkthrough;
        if (this._mode !== 'walkthrough' || !walk?.isActive()) return null;
        const p = walk.getPosition();
        return { x: p.x, z: p.z, floor: walk.getLevel() };
      },
      getMe: () => (this._player?.personId != null ? String(this._player.personId) : null),
    });
    this.fullCap = new FullCapMonitor({
      weak: () => this.weakDevice,
      wanted: () => (this.characters?.wantedFull ?? 0) + this.live.wantedFull,
      measuring: () => !!this._builder?.progress.allBuilt && !(typeof document !== 'undefined' && document.hidden),
      fixed: options.fullCharacters ?? null,
    });
    this.characters?.setMaxFull(this.fullCap.cap);
    this.live.setFullCap(this.fullCap.cap);
    // the cap shared: the live people first (they move), the seated ones the rest; your pose for the page
    this._liveTick = () => {
      this.characters?.setMaxFull(Math.max(0, this.fullCap.cap - this.live.fullCount));
      this._poseTick();
    };
    this.scene.onBeforeRenderObservable.add(this._liveTick);
    this._capTick = () => {
      if (this.fullCap.frame(this.babylonEngine.getDeltaTime?.() ?? 16, performance.now())) this.live.setFullCap(this.fullCap.cap);
    };
    this.scene.onAfterRenderObservable.add(this._capTick);
    this.navigation = new NavigationSystem({
      getLayout: () => this._store.getState(),
      getWalker: () => {
        const walk = this._walkthrough;
        if (!walk?.isActive()) return null;
        const p = walk.getPosition();
        return { x: p.x, z: p.z, floor: walk.getLevel() };
      },
      focusOn: (id, options) => this.focusOn(id, options),
      highlight: (ids, color) => this.highlight(ids, color),
      clearHighlights: () => this.clearHighlights(),
      // From above, a route starts a walk at the entrance (walkthrough mode)
      startWalking: () => {
        if (this._mode !== 'walkthrough') this.setMode('walkthrough');
        return this._walkthrough?.isActive() ? this._walkthrough : null;
      },
      routeLine: () => (this._routeLine ??= new RouteLineSystem(this.scene)),
      getMe: () => (this._player?.personId != null ? String(this._player.personId) : null),
      emit: (event) => {
        this._noteArrival(event);
        this.tour.onNavigation(event); // the tour's own walks, or another one taking over
        this.emit('navigation', event);
      },
    });
    const walker = () => {
      const walk = this._walkthrough;
      if (!walk?.isActive()) return null;
      const p = walk.getPosition();
      return { x: p.x, z: p.z, floor: walk.getLevel() };
    };
    this.tour = new TourSystem({
      plan: () => this.navigation.tourPlan(),
      startWalking: () => {
        if (this._mode !== 'walkthrough') this.setMode('walkthrough');
        return !!this._walkthrough?.isActive();
      },
      isWalking: () => this._mode === 'walkthrough' && !!this._walkthrough?.isActive(),
      getWalker: walker,
      setPose: (pose) => this._walkthrough?.setPose(pose),
      routeTo: (spot, o) => this.navigation.routeTo(spot, { ...o, source: 'tour' }),
      navigation: this.navigation,
      highlight: (ids) => this.highlight(ids, TOUR_HIGHLIGHT),
      clearHighlights: () => this.clearHighlights(),
      setKeys: (handler) => this._walkthrough?.setKeyHandler(handler),
      stopView: (on, instant) => this._walkthrough?.setStopView(on, instant),
      emit: (event) => this.emit('tour', event),
      // the ticks of one layout: its name (and the building's): layouts carry no id of their own
      layoutKey: () => [this._store.getState().layoutName, this._loaded?.building?.name].filter(Boolean).join(' · ') || 'layout',
      reducedMotion: () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    // the tour's countdown at a stop and its passing mentions: every frame (a slow frame counts at most 0.25 s)
    this._tourTick = () => this.tour.tick(Math.min(0.25, (this.babylonEngine.getDeltaTime?.() ?? 16) / 1000));
    this.scene.onBeforeRenderObservable.add(this._tourTick);
    this._builder = new SceneBuilder({
      rooms: this.rooms,
      objects: this.objects,
      floors: this.floors,
      getLayout: () => this._store.getState(),
      budgetMs: options.buildBudgetMs,
      onProgress: (progress) => {
        // No frames until the start floor is built (SceneSetup.holdRendering)
        this._layoutScene.holdRendering?.(!progress.currentFloorReady);
        this.emit('progress', progress);
      },
      onChange: () => this.highlights.apply(),
    });

    // Redraw whatever changes in this engine's layout; an edit is a 'change'
    this._unsubscribe = this._store.subscribe((s, prev) => {
      const edited = s.rooms !== prev.rooms || s.objects !== prev.objects || s.floors !== prev.floors
        || s.anchorData !== prev.anchorData || s.ignoredChecks !== prev.ignoredChecks;
      if (!edited && s.selectedRoomId === prev.selectedRoomId) return;
      this._cachedLayout = null;
      if (this._loading) return; // loadLayout builds it (in slices)
      this._draw();
      if (edited) this._emitChange('edit', 'layout');
    });

    // A floor chosen in the store (setFloor, a new layout, the floor you walked to) is the one shown from above
    this._unsubscribeFloor = this._store.subscribe((s) => s.currentFloor, (floorId) => {
      if (!this._walkthrough?.isActive()) this.floors.setFloor(floorId);
    });

    const editor = createEditorHistory(undefined, { workspace: this._store });
    this.history = editor.history;
    this.editor = this._guarded(editor);

    this._applyMode();
  }

  // ── Layout Data ────────────────────────────────────────────────────────

  /**
   * Load a layout and draw it. Takes a save (v1, as apiService keeps it), an
   * exported layout file ({ format: 'ahdus-layout', layout }) or v2 JSON.
   * Throws (a ZodError naming the bad field) if the data is not a layout;
   * then the layout shown before stays.
   */
  loadLayout(data: unknown): void {
    const v2 = parseLayout(data);
    const v1 = toV1(v2);
    const store = this._store.getState();
    this._arrived = null;
    this._loading = true;
    try {
      store.loadWorkspace(v1);
      store.setTenant(null, null, v1.layoutName, v1.layoutVersion);
    } finally {
      this._loading = false;
    }
    this.tour.stop(); // nor does a tour of it
    this.navigation.stop(); // a route through the old layout means nothing in this one
    this.live.clear(); // positions in the old layout mean nothing in this one (the page adds them again)
    this._pose.reset();
    this._loaded = v2;
    this._cachedLayout = null;
    this._walkPlace = null; // a place in the old layout means nothing in this one
    this.history.clear();
    // Built a slice at a time, the start floor first ('progress' events; whenBuilt())
    this._builder.start();
    this.highlights.apply();
    // Walking through: start at this layout's entrance
    if (this._walkthrough?.isActive()) this._walkthrough.respawn();
    // Then, in idle time, the walk maps: the first route or "Take me there" doesn't freeze
    const own = this._store;
    const rooms = own.getState().rooms;
    this._warmed = this._builder.whenBuilt().then(() => {
      if (own.getState().rooms === rooms && !this.scene.isDisposed) return this.navigation.warm();
      return undefined;
    });
    this._emitChange('loadLayout', 'root');
  }

  /** Resolves when the walk maps of the layout loaded last are built (in idle time, after whenBuilt). */
  whenNavigationReady(): Promise<void> {
    return this._warmed;
  }

  /**
   * The current layout as v2 JSON (null before loadLayout). Includes any
   * change made in the engine since it was loaded.
   */
  getLayout(): Layout | null {
    if (!this._loaded) return null;
    if (!this._cachedLayout) this._cachedLayout = this._exportLayout(this._loaded);
    return this._cachedLayout;
  }

  /**
   * This engine's workspace store (v1 field names, the app's store shape).
   * For the systems and the bridge (integration/layoutBridge.js); modules
   * use the methods of this class instead.
   */
  getStore(): WorkspaceStore {
    return this._store;
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  /** Show the building up to this floor, without its roof (as Studio does). */
  setFloor(floorId: string | number): void {
    const id = this._loaded ? storeFloorIds(this._loaded.floors)(floorId) : Number(floorId);
    this._store.getState().selectFloor(id);
    this.floors.setFloor(id);
  }

  /** Switch between 3D (orbit) and 2D (from above, as Studio's 2D). */
  setView(view: ViewMode): void {
    if (view === this._view) return;
    this._view = view;
    if (this._layoutScene.camera) setCameraView(this._layoutScene, view);
  }

  /** The current camera view, '3d' or '2d'. */
  get view(): ViewMode {
    return this._view;
  }

  /**
   * Fly the camera to a room, an item or an anchor (300 ms; animate: false
   * jumps). Shows its floor as setFloor does, so nothing above hides it.
   * `around`: show at least this far (m) around an item or anchor (search: a
   * person's desk among its neighbours); `beta`: look down at least this
   * steeply (rad from straight down), so walls don't hide it.
   * @returns false if no room, item or anchor has this id
   */
  focusOn(entityId: string, { animate = true, around: margin = 0, beta }: { animate?: boolean; around?: number; beta?: number } = {}): boolean {
    const { rooms, objects, floors } = this._store.getState();
    const anchor = rooms[entityId] || objects[entityId] ? undefined : this.getAnchors().find((a) => a.id === entityId);
    const room = rooms[entityId];
    const obj = objects[anchor?.objectId ?? entityId];
    const around = (x: number, z: number, d: number): GroundBox => ({ min: { x: x - d, z: z - d }, max: { x: x + d, z: z + d } });
    const grow = (b: GroundBox, x: number, z: number, d: number): GroundBox => ({
      min: { x: Math.min(b.min.x, x - d), z: Math.min(b.min.z, z - d) },
      max: { x: Math.max(b.max.x, x + d), z: Math.max(b.max.z, z + d) },
    });

    let floor: number;
    let box: () => GroundBox;
    if (room) {
      floor = room.floor;
      box = () => ({
        min: { x: room.x - room.width / 2, z: room.z - room.depth / 2 },
        max: { x: room.x + room.width / 2, z: room.z + room.depth / 2 },
      });
    } else if (obj) {
      floor = obj.floor ?? 0;
      box = () => grow(boundsOf(this.objects.getObjectMesh(obj.id)) ?? around(obj.x, obj.z, 0.5), obj.x, obj.z, margin);
    } else if (anchor) {
      floor = storeFloorIds(this._loaded!.floors)(anchor.floorId);
      box = () => grow(around(anchor.position.x, anchor.position.z, 1), anchor.position.x, anchor.position.z, margin);
    } else {
      return false;
    }

    this.setFloor(floor);
    const camera = this._layoutScene.camera;
    if (camera) {
      camera.target.y = elevationOf(floors, floor);
      flyTo(camera, this.scene, box(), { duration: animate ? 300 : 0, beta });
    }
    return true;
  }

  /** Fit the whole building in view (Studio's Fit view, for every floor). */
  fitView({ animate = true } = {}): void {
    const camera = this._layoutScene.camera;
    const rooms = Object.values(this._store.getState().rooms) as V1Room[];
    if (!camera || rooms.length === 0) return;
    flyTo(camera, this.scene, {
      min: { x: Math.min(...rooms.map((r) => r.x - r.width / 2)), z: Math.min(...rooms.map((r) => r.z - r.depth / 2)) },
      max: { x: Math.max(...rooms.map((r) => r.x + r.width / 2)), z: Math.max(...rooms.map((r) => r.z + r.depth / 2)) },
    }, { duration: animate ? 300 : 0 });
  }

  /**
   * Outline rooms and items (an anchor's id outlines its item) in a colour,
   * e.g. for training, explanations or search results. Adds to the ones
   * highlighted already; they stay while the layout changes.
   */
  highlight(entityIds: string[], color = '#FFD700'): void {
    const anchors = new Map(this.getAnchors().map((a) => [a.id, a.objectId]));
    this.highlights.add(entityIds.map((id) => anchors.get(id) ?? id), color);
  }

  /** Remove all highlights. */
  clearHighlights(): void {
    this.highlights.clear();
    this._draw();
  }

  // ── People ─────────────────────────────────────────────────────────────

  /**
   * Who sits at which desk (replaces the list before): [{ personId, deskId,
   * name, department, character: { url, rig, height } | null }]. Seated on
   * the desk's chair, else standing at it; no character = the simple figure.
   * Nothing is drawn with quality 'low'. Not part of the layout (never saved).
   */
  setPeople(people: Person[]): void {
    this._people = [...people];
    this.characters?.setPeople(people);
    this.navigation.setPeople(people); // searched by name and department (also with quality 'low')
  }

  /**
   * Descriptions of the departments (replaces the list before): [{ name, description }] (AHDUS:
   * GET /api/teams/departments). The Find box's menu shows one under each department of that name
   * that exists in the layout or among the people. Not part of the layout (never saved).
   */
  setDepartments(departments: DepartmentInfo[] | null): void {
    this.navigation.setDepartments(departments ?? []);
  }

  /**
   * The person looking (Player): walking through, they are their own
   * character, made when walking starts (each file loads once, with the
   * people's); null = the simple figure, as with quality 'low' or a file that
   * can't be loaded. Their seated figure is hidden while they walk.
   */
  setPlayer(player: Player | null): void {
    this._player = player ? { ...player } : null;
    this._syncPlayer();
  }

  /**
   * v0.16.1: your pose now, as sent (PoseEvent; the 'pose' event gives it at most 5 a second): walking, where
   * you are; else { state: 'overview', floor }. null before a layout is loaded.
   */
  getPose(): PoseEvent | null {
    if (!this._loaded) return null;
    const walk = this._walkthrough;
    const s = this._store.getState();
    if (this._mode !== 'walkthrough' || !walk?.isActive()) return { state: 'overview', floor: s.currentFloor ?? 0 };
    const p = walk.getPosition();
    const floor = walk.getLevel();
    const now = performance.now();
    const was = this._poseWas;
    let speed = was?.speed ?? 0;
    if (was && now > was.t) {
      const v = Math.hypot(p.x - was.x, p.z - was.z) / ((now - was.t) / 1000);
      speed += (v - speed) * Math.min(1, (now - was.t) / 200);
    }
    if (!was || now > was.t) this._poseWas = { x: p.x, z: p.z, t: now, speed };
    const gait = (walk.getCharacter() as { gait?: string | null } | null)?.gait ?? null;
    const state = liveStateOf(gait, speed, walk.isFlying()) as PoseEvent['state'];
    return poseOf({ x: p.x, y: p.y - elevationOf(s.floors, floor), z: p.z, yaw: walk.getYaw(), floor, state }) as PoseEvent;
  }

  /** Each frame: your pose to the page when it is time to send it (the 'pose' event, only while someone listens). */
  private _poseTick(): void {
    if (!this._loaded || !this._builder.progress.currentFloorReady || !this._listeners.get('pose')?.size) return;
    const pose = this.getPose();
    const out = pose && this._pose.next(pose, performance.now());
    if (out) this.emit('pose', out as PoseEvent);
  }

  /** Resolves when the walkthrough's character is made (or the simple figure stays): tests. */
  whenPlayerReady(): Promise<void> {
    return this._playerReady;
  }

  /** The person under a screen point (CSS px in the canvas: their desk, chair or them), or null. */
  pickPerson(x: number, y: number): PlacedPerson | null {
    return this.characters?.pickPerson(x, y) ?? null;
  }

  /**
   * Walking through: the person the character stands next to (within `radius` m on its floor), or null.
   * With `personId`: that person only (the viewer keeps the card of the person a walk arrived at).
   */
  personNearWalker(radius = 1.8, personId: string | null = null): PlacedPerson | null {
    const walk = this._walkthrough;
    if (!this.characters || !walk?.isActive()) return null;
    if (personId === null) return this.characters.personAt(walk.getPosition(), walk.getLevel(), radius);
    // one person (the one a walk arrived at): within radius on your floor
    const at = walk.getPosition();
    const p = this.characters.getPlaced().find((q) => q.personId === personId);
    return p && p.floor === walk.getLevel() && Math.hypot(p.x - at.x, p.z - at.z) <= radius ? p : null;
  }

  /**
   * (v0.14.7) Walking through: the person the last walk (Take me there, Show route) arrived at, while you are within
   * ARRIVED_NEAR_M of where it arrived, on that floor; else null (and forgotten). E means them meanwhile.
   */
  arrivedPerson(): { personId: string; name: string } | null {
    const a = this._arrived;
    const walk = this._walkthrough;
    if (!a || !walk?.isActive() || this._mode !== 'walkthrough') return null;
    const at = walk.getPosition();
    if (walk.getLevel() !== a.floor || Math.hypot(at.x - a.x, at.z - a.z) > ARRIVED_NEAR_M) {
      this._arrived = null; // walked away
      return null;
    }
    return { personId: a.personId, name: a.name };
  }

  /** A walk arrived at a person: remember them (and where); a new walk forgets them. */
  private _noteArrival(event: NavigationEvent): void {
    if (event.state === 'started') this._arrived = null;
    if (event.state !== 'arrived') return;
    const place = event.place as { personId?: string | number; name?: string } | undefined;
    const walk = this._walkthrough;
    if (place?.personId == null || !walk?.isActive()) { this._arrived = null; return; }
    const at = walk.getPosition();
    this._arrived = { personId: String(place.personId), name: place.name ?? '', x: at.x, z: at.z, floor: walk.getLevel() };
  }

  /** E near the person a walk arrived at: their details (the viewer pins their card). */
  private _personDetails(personId: string): void {
    const placed = this.characters?.getPlaced().find((p) => p.personId === personId) ?? null;
    const person = placed ?? this._people.find((p) => String(p.personId) === personId) ?? null;
    if (person) this.emit('personDetails', { person });
  }

  // ── Querying ───────────────────────────────────────────────────────────

  /** Get all anchors, optionally filtered by kind */
  getAnchors(filter?: { kind?: AnchorKind }): Anchor[] {
    const anchors = this.getLayout()?.anchors ?? [];
    if (filter?.kind) {
      return anchors.filter((a) => a.kind === filter.kind);
    }
    return [...anchors];
  }

  /** Get all anchors in a specific room */
  getAnchorsByRoom(roomId: string): Anchor[] {
    return (this.getLayout()?.anchors ?? []).filter((a) => a.roomId === roomId);
  }

  /** Look up a placed object by ID */
  getObjectById(objectId: string): LayoutObject | undefined {
    return this.getLayout()?.objects.find((o) => o.id === objectId);
  }

  // ── Mode ───────────────────────────────────────────────────────────────

  get mode(): EngineMode {
    return this._mode;
  }

  /** Whether the layout can be changed now (edit mode). */
  get canEdit(): boolean {
    return this._mode === 'edit';
  }

  /**
   * Switch mode: 'edit', 'view' (orbit, read-only) or 'walkthrough'
   * (Preview's character, read-only). The app shell decides it from the
   * user's role (admin: edit, employee: walkthrough).
   */
  setMode(mode: EngineMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this._applyMode();
    this.emit('mode', { mode });
  }

  /**
   * Overview (v0.14.6): the view from above, on the floor you walked to, looking at where you were. Your
   * place is kept: resumeWalk() takes you back there. Not walking: just the view from above.
   */
  overview({ animate = true }: { animate?: boolean } = {}): void {
    const walk = this._walkthrough;
    if (this._mode === 'walkthrough' && walk?.isActive()) {
      const p = walk.getPosition();
      const floor = walk.getLevel();
      this._walkPlace = { x: p.x, z: p.z, yaw: walk.getYaw(), pitch: walk.getPitch(), floor };
      this.setMode('view');
      this.setFloor(floor);
      const camera = this._layoutScene.camera;
      if (camera) {
        camera.target.y = elevationOf(this._store.getState().floors, floor);
        const d = OVERVIEW_AROUND;
        flyTo(camera, this.scene, { min: { x: p.x - d, z: p.z - d }, max: { x: p.x + d, z: p.z + d } }, {
          duration: animate ? 300 : 0, beta: OVERVIEW_BETA,
        });
      }
      return;
    }
    this.setMode('view');
  }

  /**
   * Walk again (v0.14.6): where Overview left you (same layout), else at the entrance as every walk starts.
   * @returns true if you went back to where you were
   */
  resumeWalk(): boolean {
    const place = this._walkPlace;
    this._walkPlace = null;
    this.setMode('walkthrough');
    if (!place || !this._walkthrough?.isActive()) return false;
    this._walkthrough.setPose(place);
    return true;
  }

  /** Where Overview left you walking (resumeWalk goes back there), or null. */
  get walkPlace(): { x: number; z: number; yaw: number; pitch: number; floor: number } | null {
    return this._walkPlace ? { ...this._walkPlace } : null;
  }

  /**
   * A device that walking would be slow on (v0.14.6): quality 'low', or WebGL drawn by the CPU (no graphics
   * card in use: SwiftShader, llvmpipe, …). A viewer with startMode starts in Overview there.
   */
  get weakDevice(): boolean {
    if (this._quality === 'low') return true;
    try {
      return softwareRenderer(this.babylonEngine.getGlInfo?.()?.renderer);
    } catch {
      return false;
    }
  }

  /** The walkthrough (character, its room and floor); null until walkthrough mode is first used. */
  get walkthrough(): WalkthroughSystem | null {
    return this._walkthrough;
  }

  // ── Undo/Redo ──────────────────────────────────────────────────────────

  /** Execute a command through the history system. Refused (false) outside edit mode. */
  executeCommand(cmd: Command): boolean {
    if (!this.canEdit) return false;
    this.history.execute(cmd);
    this._emitChange(cmd.label, 'command');
    return true;
  }

  /** Undo the last edit. Refused (false) outside edit mode. */
  undo(): boolean {
    if (!this.canEdit) return false;
    const cmd = this.history.undo();
    if (cmd) {
      this._emitChange(`Undo: ${cmd.label}`, 'command');
    }
    return !!cmd;
  }

  /** Redo the last undone edit. Refused (false) outside edit mode. */
  redo(): boolean {
    if (!this.canEdit) return false;
    const cmd = this.history.redo();
    if (cmd) {
      this._emitChange(`Redo: ${cmd.label}`, 'command');
    }
    return !!cmd;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<K>): void {
    this._listeners.get(event)?.delete(handler);
  }

  /** Emit an event to all registered listeners */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(data);
        } catch (e) {
          console.error(`LayoutEngine event handler error [${event}]:`, e);
        }
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /** v0.17.0: the frame the start floor was first drawn in (null: not yet, or a new layout is being built). */
  private _floorReadyFrame: number | null = null;

  /** v0.17.0: full characters may come: the start floor is built and CHARACTERS_AFTER_FRAMES frames were drawn since. */
  private _charactersReady(): boolean {
    if (!this._builder?.progress.currentFloorReady) {
      this._floorReadyFrame = null;
      return false;
    }
    const frame = this.scene.getFrameId();
    this._floorReadyFrame ??= frame;
    return frame - this._floorReadyFrame >= CHARACTERS_AFTER_FRAMES;
  }

  /** How far building the layout is: { done, total, floor, currentFloorReady, allBuilt }. */
  get buildProgress(): BuildProgress {
    return this._builder.progress;
  }

  /** Resolves when the layout is fully built (at once if it is). */
  whenBuilt(): Promise<void> {
    return this._builder.whenBuilt();
  }

  /** Build whatever is left now, in one go (tests; a screenshot that must show everything). */
  finishBuild(): void {
    this._builder.finish();
  }

  /** Stop rendering and dispose the scene and the Babylon engine. */
  dispose(): void {
    this._playerToken++; // a character still loading is dropped
    this._builder.dispose();
    this.tour.dispose();
    this.navigation.stop();
    this._walkthrough?.dispose();
    this._walkthrough = null;
    this._routeLine?.dispose();
    this._routeLine = null;
    if (this._liveTick) this.scene.onBeforeRenderObservable.removeCallback(this._liveTick);
    if (this._capTick) this.scene.onAfterRenderObservable.removeCallback(this._capTick);
    this.live.dispose();
    this.characters?.dispose();
    this._unsubscribe();
    this._unsubscribeFloor();
    this._listeners.clear();
    // The scene takes every room and item mesh with it; forget them
    this.rooms.meshes.clear();
    this.objects.meshes.clear();
    this._layoutScene.dispose();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * The editor with every command that changes something refused outside
   * edit mode: it changes nothing and answers { problem: READ_ONLY }.
   */
  private _guarded(editor: LayoutEditorApi): LayoutEditorApi {
    const guarded: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(editor)) {
      guarded[name] = typeof value === 'function' && !ALWAYS_ALLOWED.has(name)
        ? (...args: unknown[]) => (this.canEdit ? (value as (...a: unknown[]) => unknown)(...args) : { problem: READ_ONLY })
        : value;
    }
    return guarded as LayoutEditorApi;
  }

  /** Walk through in walkthrough mode; give the orbit camera back otherwise. */
  private _applyMode(): void {
    // The spawn point (a blue disc) is a Studio marker: hidden in view and walkthrough mode
    this.objects.setHiddenTypes(this._mode === 'edit' ? [] : STUDIO_ONLY_TYPES);
    this.floors.apply();
    if (this._mode === 'walkthrough') {
      if (this._view === '2d') this.setView('3d'); // walking is always 3D
      this._ensureWalkthrough().activate();
    } else if (this._walkthrough?.isActive()) {
      this.tour.stop(); // a tour is walked
      this.navigation.stop(); // a route is walked, never followed from above
      this._walkthrough.deactivate();
      // Back to the view from above, on the floor you walked to (its floorChange came from onLevelChange)
      this.floors.setFloor(this._store.getState().currentFloor);
    }
    this._syncPlayer();
  }

  /** The walkthrough's character for the player now, and their seated figure hidden while walking. */
  private _syncPlayer(): void {
    const walk = this._walkthrough;
    this.characters?.setHiddenPerson(walk?.isActive() ? (this._player?.personId ?? null) : null);
    if (!walk) return; // made when walking starts
    const p = this._player;
    const character = this.characters ? validCharacter(p?.character) : null;
    const key = character
      ? JSON.stringify([character.url, character.rig, character.height, character.outfit ?? null, cleanClothing(p?.clothing),
        p?.walkClipUrl ?? null, p?.walk !== false])
      : '';
    if (key === this._playerKey) return;
    this._playerKey = key;
    const token = ++this._playerToken;
    if (!character) {
      walk.setCharacter(null);
      this._playerReady = Promise.resolve();
      return;
    }
    const files = this.characters!;
    this._playerReady = createPlayerCharacter(this.scene, {
      character, clothing: cleanClothing(p?.clothing), walkClipUrl: p?.walkClipUrl ?? null, walk: p?.walk,
    }, (url) => files.loadFile(url), files.clipLibrary).then((made) => {
      if (token !== this._playerToken || this._walkthrough !== walk) { made.dispose(); return; }
      walk.setCharacter(made);
    }, (err) => {
      if (token !== this._playerToken) return;
      console.warn(`[characters] could not make your character from ${character.url}: the simple figure walks`, err?.message ?? err);
      walk.setCharacter(null);
    });
  }

  private _ensureWalkthrough(): WalkthroughSystem {
    if (this._walkthrough) return this._walkthrough;
    const state = () => this._store.getState();
    this._walkthrough = new WalkthroughSystem(
      this.scene,
      this.babylonEngine.getRenderingCanvas() as HTMLCanvasElement,
      state,
      (id) => this.objects.getObjectMesh(id),
      {
        onRoomChange: (from, to) => {
          if (from) this.emit('exitRoom', { roomId: from.id, floorId: from.floor, toRoomId: to?.id ?? null });
          if (to) {
            this.emit('enterRoom', {
              roomId: to.id, floorId: to.floor, roomName: to.name ?? '', roomType: to.type ?? '',
              fromRoomId: from?.id ?? null,
            });
          }
        },
        onInteract: (target) => {
          if (target.personId) this._personDetails(target.personId);
          else this.emit('interact', this._interactEvent(target));
        },
        onLevelChange: (floorId) => state().selectFloor(floorId),
        onViewChange: ({ inside, level }) => this.floors.setView({ mode: inside ? 'inside' : 'outside', level }),
        onHud: (info) => this.emit('hud', info),
        describeInteraction: (target) => (target.personId
          ? { label: 'Details', name: this.arrivedPerson()?.name || 'This person', handled: false }
          : this.describeInteraction?.(target) ?? null),
        // after a walk arrived at a person, E means them (not the window behind their desk), v0.14.7
        nearTarget: () => {
          const who = this.arrivedPerson();
          const walk = this._walkthrough;
          if (!who || !walk) return null;
          const p = walk.getPosition();
          return { personId: who.personId, point: { x: p.x, y: p.y, z: p.z }, distance: 0 };
        },
        onPointClick: (click) => this._walkClick(click),
        // the double-click's first click started a walk there: mouse-look mode is what was meant
        onDoubleClick: () => { if (this.navigation.walking?.source === 'click') this.navigation.stop(); },
      },
      this._focusTarget,
      this.navigation.walkMaps,
    );
    return this._walkthrough;
  }

  /**
   * A plain click while walking (v0.14.0): on a person, their card; on something within reach that a
   * module has an action for, that action (as E); else walk there (Take me there to that spot, ended
   * by a movement key). The 'walkClick' event says which.
   */
  private _walkClick(click: WalkthroughClick): void {
    const walk = this._walkthrough;
    if (!walk?.isActive()) return;
    const at = click.screen;
    const person = this.pickPerson(at.x, at.y);
    if (person) {
      this.emit('walkClick', { action: 'person', at, person });
      return;
    }
    if (click.target && this.describeInteraction?.(click.target)?.handled) {
      this.emit('interact', this._interactEvent(click.target));
      this.emit('walkClick', { action: 'interact', at, objectId: click.target.objectId ?? null });
      return;
    }
    if (!click.walkTo) {
      this.emit('walkClick', { action: 'none', at });
      return;
    }
    const to = click.walkTo;
    const r = this.navigation.routeTo({ x: to.x, z: to.z, floor: to.floor }, { walk: 'auto', source: 'click' });
    if (r.problem) {
      walk.say(r.message ?? 'No way to walk there', 2500);
      this.emit('walkClick', { action: 'none', at, to, problem: r.problem, message: r.message });
      return;
    }
    this.emit('walkClick', { action: 'walk', at, to });
  }

  /** E on an item (its main anchor, as layoutBridge picks it) or on a door / window. */
  private _interactEvent(target: WalkthroughTarget): InteractEvent {
    const obj = target.objectId ? this._store.getState().objects[target.objectId] : null;
    const anchor = obj ? primaryAnchor(this.getAnchors().filter((a) => a.objectId === obj.id)) : null;
    return {
      anchorId: anchor?.id ?? null,
      objectId: obj?.id ?? null,
      position: target.point,
      roomId: obj?.roomId ?? target.roomId ?? this._walkthrough?.getRoomId() ?? '',
      part: obj ? null : target.part ?? null,
      distance: target.distance,
    };
  }

  /** Bring the meshes up to date with this engine's layout. */
  private _draw(): void {
    if (this.scene.isDisposed) return;
    this._builder.request();
    this.highlights.apply();
  }

  /** The store's layout as v2, plus what only v2 has (model/toV1.mergeV2Extras). */
  private _exportLayout(loaded: Layout): Layout {
    return mergeV2Extras(parseLayout(this._store.getState().exportWorkspace()), loaded);
  }

  private _emitChange(type: string, entityId: string): void {
    this.emit('change', {
      type,
      entityId,
      timestamp: Date.now(),
    });
  }
}
