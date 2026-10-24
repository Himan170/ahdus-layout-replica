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
 *          store) refuses every edit outside edit mode.
 *   Stubs (TODO):  systems/PlacementSystem, SelectionSystem.
 *
 * Modes:
 *   edit         orbit camera; `editor` changes the layout (undoable)
 *   view         orbit camera; nothing can change the layout
 *   walkthrough  Preview's character (W A S D, mouse, E, Page Up / Down:
 *                systems/WalkthroughSystem); nothing can change the layout;
 *                fires enterRoom, exitRoom, interact. The keys are the page's
 *                until the view is clicked or focused (options.focusTarget)
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';

import type { Layout, Anchor, LayoutObject, AnchorKind } from './model/schema';
import { loadLayout as parseLayout } from './model/migrate';
import { toV1, storeFloorIds, mergeV2Extras } from './model/toV1';
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
import { elevationOf } from '../play/building';
import { WalkthroughSystem } from './systems/WalkthroughSystem';
import type { WalkthroughTarget } from './systems/WalkthroughSystem';
import { createWorkspaceStore } from '../store/workspaceStore';
import { createEditorHistory } from '../store/editorHistory';
import { primaryAnchor } from '../integration/anchorsFromStore';

// ── Types ────────────────────────────────────────────────────────────────

export type EngineMode = 'edit' | 'view' | 'walkthrough';
export type ViewMode = '3d' | '2d';
export type QualityLevel = 'high' | 'low';

export interface EngineOptions {
  mode?: EngineMode;
  /** 'high' (default): realistic look (real furniture models, photo textures, HDRI sky); 'low': simple models and materials. */
  quality?: QualityLevel;
  /** Where the real assets are (models/, textures/, env/). Default: the app's public/assets/. */
  assetBaseUrl?: string;
  /**
   * Walkthrough mode: the view's box. The keys are the page's until the view
   * is engaged: its canvas has the mouse, or focus is in this element (make it
   * focusable). Default: the canvas.
   */
  focusTarget?: HTMLElement | null;
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
};

/** What every edit answers outside edit mode. */
export const READ_ONLY = 'This layout is view-only here';

/** Editor calls that change nothing, so they work in every mode. */
const ALWAYS_ALLOWED = new Set(['clear', 'endBurst']);

/** The editor's commands (store/editorHistory.js), on an engine's own store. */
export type LayoutEditorApi = ReturnType<typeof createEditorHistory>;

type EventHandler<K extends keyof EventMap> = (event: EventMap[K]) => void;

/** An engine's own workspace store (the app's store shape, v1 field names). */
export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

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

  // Drawing (the same systems as Workplace Studio)
  readonly rooms: RoomSystem;
  readonly objects: ObjectSystem;
  readonly floors: FloorSystem;
  readonly highlights: HighlightSystem;

  // Edits: the editor's commands on this engine's store, refused outside edit mode
  readonly editor: LayoutEditorApi;
  /** The undo/redo history of `editor` (and executeCommand). */
  readonly history: CommandHistory;

  // Walkthrough mode (made the first time it is needed: it needs the canvas)
  private _walkthrough: WalkthroughSystem | null = null;

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
    const engine = new LayoutEngine(createLayoutScene(canvas, { quality: options.quality, assetBaseUrl: options.assetBaseUrl }), options);
    // Allow one frame for the scene to initialise
    await new Promise<void>((resolve) => {
      engine.scene.executeWhenReady(() => resolve());
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
    // Until a floor is chosen, the whole building shows, with roofs
    this.floors.setView({ mode: 'outside', level: 0 });
    this.highlights = new HighlightSystem(this.rooms, this.objects);

    // Redraw whatever changes in this engine's layout; an edit is a 'change'
    this._unsubscribe = this._store.subscribe((s, prev) => {
      const edited = s.rooms !== prev.rooms || s.objects !== prev.objects || s.floors !== prev.floors
        || s.anchorData !== prev.anchorData;
      if (!edited && s.selectedRoomId === prev.selectedRoomId) return;
      this._cachedLayout = null;
      this._draw();
      if (edited && !this._loading) this._emitChange('edit', 'layout');
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
    this._loading = true;
    try {
      store.loadWorkspace(v1);
      store.setTenant(null, null, v1.layoutName, v1.layoutVersion);
    } finally {
      this._loading = false;
    }
    this._loaded = v2;
    this._cachedLayout = null;
    this.history.clear();
    this._draw();
    // Walking through: start at this layout's spawn point
    if (this._walkthrough?.isActive()) this._walkthrough.respawn();
    this._emitChange('loadLayout', 'root');
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
   * @returns false if no room, item or anchor has this id
   */
  focusOn(entityId: string, { animate = true } = {}): boolean {
    const { rooms, objects, floors } = this._store.getState();
    const anchor = rooms[entityId] || objects[entityId] ? undefined : this.getAnchors().find((a) => a.id === entityId);
    const room = rooms[entityId];
    const obj = objects[anchor?.objectId ?? entityId];
    const around = (x: number, z: number, d: number): GroundBox => ({ min: { x: x - d, z: z - d }, max: { x: x + d, z: z + d } });

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
      box = () => boundsOf(this.objects.getObjectMesh(obj.id)) ?? around(obj.x, obj.z, 0.5);
    } else if (anchor) {
      floor = storeFloorIds(this._loaded!.floors)(anchor.floorId);
      box = () => around(anchor.position.x, anchor.position.z, 1);
    } else {
      return false;
    }

    this.setFloor(floor);
    const camera = this._layoutScene.camera;
    if (camera) {
      camera.target.y = elevationOf(floors, floor);
      flyTo(camera, this.scene, box(), { duration: animate ? 300 : 0 });
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

  /** Stop rendering and dispose the scene and the Babylon engine. */
  dispose(): void {
    this._walkthrough?.dispose();
    this._walkthrough = null;
    this._unsubscribe();
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
    if (this._mode === 'walkthrough') {
      if (this._view === '2d') this.setView('3d'); // walking is always 3D
      this._ensureWalkthrough().activate();
    } else if (this._walkthrough?.isActive()) {
      this._walkthrough.deactivate();
      this.floors.setView({ mode: 'outside', level: 0 });
    }
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
        onInteract: (target) => this.emit('interact', this._interactEvent(target)),
        onLevelChange: (floorId) => state().selectFloor(floorId),
        onViewChange: ({ inside, level }) => this.floors.setView({ mode: inside ? 'inside' : 'outside', level }),
        onHud: (info) => this.emit('hud', info),
        describeInteraction: (target) => this.describeInteraction?.(target) ?? null,
      },
      this._focusTarget,
    );
    return this._walkthrough;
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
    const state = this._store.getState();
    this.rooms.sync(state, state.selectedRoomId);
    this.objects.sync(state);
    this.floors.apply();
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
