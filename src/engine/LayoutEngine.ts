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
 *          loadLayout (saves, export files, v2) draws the layout; getLayout
 *          returns it as v2; setFloor.
 *   Stubs (TODO):  setView, focusOn, highlight, clearHighlights, setMode,
 *          systems/PlacementSystem, SelectionSystem, WalkthroughSystem.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';

import type { Layout, Anchor, LayoutObject, AnchorKind } from './model/schema';
import { loadLayout as parseLayout } from './model/migrate';
import { toV1, storeFloorIds } from './model/toV1';
import { CommandHistory } from './commands/CommandHistory';
import type { Command } from './commands/CommandHistory';
import { createLayoutScene } from './systems/SceneSetup';
import type { LayoutScene } from './systems/SceneSetup';
import { RoomSystem } from './systems/RoomSystem';
import { ObjectSystem } from './systems/ObjectSystem';
import { FloorSystem } from './systems/FloorSystem';
import { createWorkspaceStore } from '../store/workspaceStore';

// ── Types ────────────────────────────────────────────────────────────────

export type EngineMode = 'edit' | 'view' | 'walkthrough';
export type ViewMode = '3d' | '2d';
export type QualityLevel = 'high' | 'low';

export interface EngineOptions {
  mode?: EngineMode;
  quality?: QualityLevel;
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
}

export interface EnterRoomEvent {
  roomId: string;
  floorId: string | number;
  roomName: string;
  roomType: string;
}

type EventMap = {
  select: SelectEvent;
  change: ChangeEvent;
  interact: InteractEvent;
  enterRoom: EnterRoomEvent;
};

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

  // Command history (undo/redo)
  readonly history: CommandHistory;

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
    const engine = new LayoutEngine(createLayoutScene(canvas, { quality: options.quality }), options);
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

    // Redraw whatever changes in this engine's layout
    this._unsubscribe = this._store.subscribe((s, prev) => {
      if (s.rooms === prev.rooms && s.objects === prev.objects && s.floors === prev.floors
        && s.anchorData === prev.anchorData && s.selectedRoomId === prev.selectedRoomId) return;
      this._cachedLayout = null;
      this._draw();
    });

    // Command History
    this.history = new CommandHistory({ maxSize: 200 });
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
    store.loadWorkspace(v1);
    store.setTenant(null, null, v1.layoutName, v1.layoutVersion);
    this._loaded = v2;
    this._cachedLayout = null;
    this.history.clear();
    this._draw();
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

  /** Switch between 3D perspective and 2D top-down */
  setView(view: ViewMode): void {
    this._view = view;
    // TODO: camera animation
  }

  /** Animate the camera to fly to an entity */
  focusOn(entityId: string): void {
    // TODO: look up entity position, animate camera
  }

  /** Highlight entities with an outline glow */
  highlight(entityIds: string[], color?: string): void {
    // TODO: HighlightLayer per entity
  }

  /** Remove all highlights */
  clearHighlights(): void {
    // TODO: clear HighlightLayer
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

  setMode(mode: EngineMode): void {
    this._mode = mode;
    // TODO: enable/disable editing controls based on mode
  }

  // ── Undo/Redo ──────────────────────────────────────────────────────────

  /** Execute a command through the history system */
  executeCommand(cmd: Command): void {
    this.history.execute(cmd);
    this._emitChange(cmd.label, 'command');
  }

  undo(): void {
    const cmd = this.history.undo();
    if (cmd) {
      this._emitChange(`Undo: ${cmd.label}`, 'command');
    }
  }

  redo(): void {
    const cmd = this.history.redo();
    if (cmd) {
      this._emitChange(`Redo: ${cmd.label}`, 'command');
    }
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
    this._unsubscribe();
    this._listeners.clear();
    // The scene takes every room and item mesh with it; forget them
    this.rooms.meshes.clear();
    this.objects.meshes.clear();
    this._layoutScene.dispose();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Bring the meshes up to date with this engine's layout. */
  private _draw(): void {
    if (this.scene.isDisposed) return;
    const state = this._store.getState();
    this.rooms.sync(state, state.selectedRoomId);
    this.objects.sync(state);
    this.floors.apply();
  }

  /**
   * The store's layout as v2, plus what only v2 has, from the layout as it
   * was loaded: the building's address and north angle, routes, floor links,
   * floor underlays and anchors that aren't on an object.
   */
  private _exportLayout(loaded: Layout): Layout {
    const layout = parseLayout(this._store.getState().exportWorkspace());
    const floorOf = storeFloorIds(loaded.floors);
    const underlays = new Map(loaded.floors.filter((f) => f.underlay).map((f) => [floorOf(f.id), f.underlay]));
    return {
      ...layout,
      building: { ...loaded.building, name: layout.building.name },
      floors: layout.floors.map((f) => (underlays.has(Number(f.id)) ? { ...f, underlay: underlays.get(Number(f.id)) } : f)),
      anchors: [
        ...loaded.anchors.filter((a) => !a.objectId).map((a) => ({ ...a, floorId: floorOf(a.floorId) })),
        ...layout.anchors,
      ],
      routes: loaded.routes.map((r) => ({ ...r, floorId: floorOf(r.floorId) })),
      floorLinks: loaded.floorLinks,
    };
  }

  private _emitChange(type: string, entityId: string): void {
    this.emit('change', {
      type,
      entityId,
      timestamp: Date.now(),
    });
  }
}
