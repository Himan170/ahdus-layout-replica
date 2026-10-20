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
 * STATUS (20 Oct 2026): being built (TEAM_TASKS H2). The editor app does NOT
 * use this class yet.
 *   Real and used:  model/ (v2 schema, v1 → v2 migration, anchor ids),
 *                   commands/ (CommandHistory and LayoutCommands: the editor's
 *                   undo/redo, through store/editorHistory.js),
 *                   systems/SceneSetup, RoomSystem, ObjectSystem, FloorSystem
 *                   (Workplace Studio draws with them).
 *   Stubs (TODO):   this class's scene work (loadLayout builds no meshes;
 *                   setFloor, setView, focusOn, highlight, setMode do nothing yet)
 *                   and systems/PlacementSystem, SelectionSystem, WalkthroughSystem.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
// Side-effect imports (tree-shaking)
import '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Meshes/csg';
import '@babylonjs/core/Collisions/collisionCoordinator';

import type { Layout, Anchor, LayoutObject, AnchorKind } from './model/schema';
import { loadLayout } from './model/migrate';
import { CommandHistory } from './commands/CommandHistory';
import type { Command } from './commands/CommandHistory';

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

// ── LayoutEngine ─────────────────────────────────────────────────────────

export class LayoutEngine {
  // Core Babylon
  readonly babylonEngine: Engine;
  readonly scene: Scene;

  // Config
  private _mode: EngineMode;
  private _quality: QualityLevel;
  private _view: ViewMode = '3d';

  // Data
  private _layout: Layout | null = null;
  private _currentFloorId: string | number = 0;

  // Command history (undo/redo)
  readonly history: CommandHistory;

  // Event bus (one Set per event name; typed at the on/off/emit boundary)
  private _listeners = new Map<keyof EventMap, Set<(event: any) => void>>();

  // Window resize handler, kept so dispose() can remove it
  private _onResize: () => void;

  // ── Factory ────────────────────────────────────────────────────────────

  /**
   * Create a new LayoutEngine attached to a canvas element.
   * This is the main entry point.
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: EngineOptions = {},
  ): Promise<LayoutEngine> {
    const engine = new LayoutEngine(canvas, options);
    // Allow one frame for the scene to initialise
    await new Promise<void>((resolve) => {
      engine.scene.executeWhenReady(() => resolve());
    });
    return engine;
  }

  private constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this._mode = options.mode ?? 'edit';
    this._quality = options.quality ?? 'high';

    // Babylon Engine
    this.babylonEngine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.babylonEngine.setHardwareScalingLevel(1 / window.devicePixelRatio);

    // Scene
    this.scene = new Scene(this.babylonEngine);
    this.scene.clearColor = new Color4(0.06, 0.08, 0.12, 1);

    // Default editor camera. Babylon throws "No camera defined" on every
    // frame if the scene renders without one, so the engine always has one.
    const camera = new ArcRotateCamera(
      'layoutCamera', -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), this.scene,
    );
    camera.attachControl(canvas, true);

    // Command History
    this.history = new CommandHistory({ maxSize: 200 });

    // Render loop
    this.babylonEngine.runRenderLoop(() => {
      this.scene.render();
    });

    // Resize
    this._onResize = () => this.babylonEngine.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ── Layout Data ────────────────────────────────────────────────────────

  /**
   * Load a layout from JSON. Handles both v1 (legacy) and v2 formats.
   */
  loadLayout(data: unknown): void {
    this._layout = loadLayout(data);
    this.history.clear();
    this._currentFloorId = this._layout.floors[0]?.id ?? 0;
    // TODO: rebuild all Babylon meshes from _layout
    this._emitChange('loadLayout', 'root');
  }

  /**
   * Get the current layout state as a v2 JSON-serializable object.
   */
  getLayout(): Layout | null {
    return this._layout;
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  /** Switch the displayed floor */
  setFloor(floorId: string | number): void {
    this._currentFloorId = floorId;
    // TODO: show/hide meshes for this floor
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
    if (!this._layout) return [];
    const anchors = this._layout.anchors;
    if (filter?.kind) {
      return anchors.filter((a) => a.kind === filter.kind);
    }
    return [...anchors];
  }

  /** Get all anchors in a specific room */
  getAnchorsByRoom(roomId: string): Anchor[] {
    if (!this._layout) return [];
    return this._layout.anchors.filter((a) => a.roomId === roomId);
  }

  /** Look up a placed object by ID */
  getObjectById(objectId: string): LayoutObject | undefined {
    if (!this._layout) return undefined;
    return this._layout.objects.find((o) => o.id === objectId);
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

  dispose(): void {
    window.removeEventListener('resize', this._onResize);

    this.babylonEngine.stopRenderLoop();
    this.scene.dispose();
    this.babylonEngine.dispose();

    this._listeners.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private _emitChange(type: string, entityId: string): void {
    this.emit('change', {
      type,
      entityId,
      timestamp: Date.now(),
    });
  }
}
