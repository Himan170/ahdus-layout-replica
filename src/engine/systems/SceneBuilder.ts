/**
 * SceneBuilder.ts
 *
 * Builds a layout's rooms and items in slices of ~10 ms (progressive
 * loading), so opening a big layout never freezes the page: the floor you
 * start on first, then the floors below and above it (play/buildSchedule.js).
 * Between slices the browser draws frames and handles input.
 *
 * The layout (the store) is the only truth: every slice reads the LATEST
 * layout, so edits, undo and floor changes made while it builds are simply
 * part of what it builds. A room not built yet is built as it is now; nothing
 * is built twice (RoomSystem's geometry key); a deleted room or item is
 * removed at once. A change to the start floor moves that floor to the front.
 *
 * After the first build, small changes are built at once, as before; a change
 * that brings many new rooms / items (another layout loaded) is built in
 * slices again. dispose() stops a running build (leaving a layout, React
 * StrictMode's unmount). Used by Workplace Studio and LayoutEngine.
 */

import {
  floorBuildOrder, createBudget, UNLIMITED, isBigChange, buildProgress, BUILD_BUDGET_MS,
} from '../../play/buildSchedule';
import type { RoomSystem, LayoutRecords, BuildBudget } from './RoomSystem';
import type { ObjectSystem } from './ObjectSystem';
import type { FloorSystem } from './FloorSystem';

/** How far a build is (the 'progress' event, the "Building your workplace… 40 %" text). */
export interface BuildProgress {
  /** Rooms + items built. */
  done: number;
  /** Rooms + items in the layout. */
  total: number;
  /** The floor being built now (the start floor once everything is built). */
  floor: number;
  /** Everything on the floor the user is on is built. */
  currentFloorReady: boolean;
  /** Everything is built. */
  allBuilt: boolean;
}

/** The store's state as the builder reads it. */
export type BuildLayout = LayoutRecords & { selectedRoomId?: string | null; currentFloor?: number };

export interface SceneBuilderOptions {
  rooms: RoomSystem;
  objects: ObjectSystem;
  floors: FloorSystem;
  getLayout: () => BuildLayout;
  /** The floor to build first (default: the layout's currentFloor). */
  getStartFloor?: () => number;
  /** Time per slice (ms); Infinity builds everything at once. */
  budgetMs?: number;
  onProgress?: (progress: BuildProgress) => void;
  /** Meshes were added, changed or removed (e.g. re-apply highlights). */
  onChange?: () => void;
  /** Run fn as a new task (lets the browser draw and handle input first); returns a cancel function. */
  nextTask?: (fn: () => void) => () => void;
}

/**
 * Run `fn` as a new task, soon: scheduler.postTask where there is one (Chrome,
 * Edge), else a MessageChannel message (Safari, Firefox; setTimeout(0) would be
 * clamped to 4 ms and slow the build down). Returns a cancel function.
 */
export function nextTask(fn: () => void): () => void {
  const scheduler = (globalThis as { scheduler?: { postTask?: (cb: () => void, o: object) => Promise<unknown> } }).scheduler;
  if (typeof scheduler?.postTask === 'function') {
    const controller = new AbortController();
    scheduler.postTask(fn, { priority: 'user-visible', signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }
  if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    let live = true;
    channel.port1.onmessage = () => {
      channel.port1.close();
      if (live) fn();
    };
    channel.port2.postMessage(null);
    return () => {
      live = false;
      channel.port1.close();
    };
  }
  const timer = setTimeout(fn, 0);
  return () => clearTimeout(timer);
}

const count = (records: object) => (Array.isArray(records) ? records.length : Object.keys(records).length);
const sameProgress = (a: BuildProgress, b: BuildProgress) =>
  a.done === b.done && a.total === b.total && a.floor === b.floor
  && a.currentFloorReady === b.currentFloorReady && a.allBuilt === b.allBuilt;

export class SceneBuilder {
  private o: Required<Omit<SceneBuilderOptions, 'getStartFloor' | 'onProgress' | 'onChange'>>
    & Pick<SceneBuilderOptions, 'getStartFloor' | 'onProgress' | 'onChange'>;
  private building = false;
  private disposed = false;
  private cancelNext: (() => void) | null = null;
  /** Floors checked and fully built since the layout last changed. */
  private doneFloors = new Set<number>();
  /** Floors whose rooms' materials are made. */
  private materialsDone = new Set<number>();
  /** How many of a floor's material steps are done (one or more per slice). */
  private materialStep = new Map<number, number>();
  /** What the done floors were checked against: rooms, objects, floors, selection, start floor. */
  private snapshot: unknown[] = [];
  private waiters: (() => void)[] = [];
  private _progress: BuildProgress = { done: 0, total: 0, floor: 0, currentFloorReady: true, allBuilt: true };
  /** The last room sync that built something: { rebuilt, ms } (dev hook for e2e/perf-smoke). */
  lastRoomSync: { rebuilt: number; ms: number } | null = null;
  /** The longest slice so far (ms; e2e/perf-smoke reports it). */
  longestSlice = 0;

  constructor(options: SceneBuilderOptions) {
    this.o = { budgetMs: BUILD_BUDGET_MS, nextTask, ...options };
  }

  get progress(): BuildProgress {
    return this._progress;
  }

  /** A build in slices is running. */
  get isBuilding(): boolean {
    return this.building;
  }

  /** Build the whole layout in slices (a layout just opened or loaded). */
  start(): void {
    if (this.disposed) return;
    this.building = true;
    this.doneFloors.clear();
    this.runSlice();
  }

  /**
   * The layout, the selection or the start floor changed. While building:
   * one slice now (the start floor comes first, so an edit there shows at
   * once), the rest continues. Otherwise: built at once, or in slices if the
   * change brings many new rooms / items.
   */
  request(): void {
    if (this.disposed) return;
    if (this.building) {
      this.runSlice();
      return;
    }
    if (isBigChange(this.countNew())) {
      this.start();
      return;
    }
    const layout = this.o.getLayout();
    const rooms = this.o.rooms.sync(layout, layout.selectedRoomId ?? null);
    const objects = this.o.objects.sync(layout);
    if (rooms.rebuilt) this.lastRoomSync = { rebuilt: rooms.rebuilt, ms: rooms.ms };
    this.o.floors.apply();
    if (rooms.rebuilt || objects.built) this.o.onChange?.();
    this.report(new Map(), layout);
  }

  /** Build everything that is left now, in one go (tests, or before leaving nothing to chance). */
  finish(): void {
    for (let i = 0; i < 3 && this.building && !this.disposed; i++) this.runSlice(UNLIMITED);
  }

  /** Resolves when everything is built (at once if it is). Never resolves after dispose(). */
  whenBuilt(): Promise<void> {
    if (!this.building) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Stop: no more slices (the scene is going away). */
  dispose(): void {
    this.disposed = true;
    this.building = false;
    this.cancelNext?.();
    this.cancelNext = null;
    this.waiters = [];
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private startFloor(layout: BuildLayout): number {
    return this.o.getStartFloor?.() ?? layout.currentFloor ?? 0;
  }

  /** Floors in build order, plus any floor only the rooms / items know (at the end). */
  private order(layout: BuildLayout, startFloor: number): number[] {
    const order = floorBuildOrder(layout.floors, startFloor) as number[];
    const known = new Set(order);
    for (const r of Object.values(layout.rooms)) if (!known.has(r.floor)) { known.add(r.floor); order.push(r.floor); }
    for (const o of Object.values(layout.objects)) {
      const f = o.floor ?? 0;
      if (!known.has(f)) { known.add(f); order.push(f); }
    }
    return order;
  }

  /** Rooms + items without a mesh yet. */
  private countNew(): number {
    const layout = this.o.getLayout();
    let n = 0;
    for (const r of Object.values(layout.rooms)) if (!this.o.rooms.meshes.has(r.id)) n++;
    for (const o of Object.values(layout.objects)) if (!this.o.objects.meshes.has(o.id)) n++;
    return n;
  }

  private runSlice(budget: BuildBudget = createBudget(this.o.budgetMs)): void {
    this.cancelNext?.();
    this.cancelNext = null;
    if (this.disposed) return;
    const t0 = performance.now();
    const layout = this.o.getLayout();
    const startFloor = this.startFloor(layout);
    const selected = layout.selectedRoomId ?? null;
    const snapshot = [layout.rooms, layout.objects, layout.floors, selected, startFloor];
    if (snapshot.some((v, i) => v !== this.snapshot[i])) {
      this.doneFloors.clear();
      this.snapshot = snapshot;
    }

    const order = this.order(layout, startFloor);
    const pending = new Map<number, number>();
    let changed = false;
    for (const floor of order) {
      if (this.doneFloors.has(floor)) {
        pending.set(floor, 0);
        continue;
      }
      // Its materials first, one per piece of work (painting textures is slow)
      if (!this.materialsDone.has(floor) && budget.hasTime()) {
        const steps = this.o.rooms.materialSteps(layout, [floor]);
        let next = this.materialStep.get(floor) ?? 0;
        while (next < steps.length && budget.take()) steps[next++]();
        this.materialStep.set(floor, next);
        if (next >= steps.length) this.materialsDone.add(floor);
      }
      const rooms = this.o.rooms.sync(layout, selected, { floors: [floor], budget });
      const objects = this.o.objects.sync(layout, { floors: [floor], budget });
      if (rooms.rebuilt) this.lastRoomSync = { rebuilt: rooms.rebuilt, ms: rooms.ms };
      if (rooms.rebuilt || objects.built) changed = true;
      const left = rooms.pending + objects.pending;
      pending.set(floor, left);
      if (left === 0 && rooms.complete && this.materialsDone.has(floor)) this.doneFloors.add(floor);
    }
    if (changed || this.doneFloors.size === order.length) {
      this.o.floors.apply();
      this.o.onChange?.();
    }
    const allDone = order.every((f) => this.doneFloors.has(f));
    this.longestSlice = Math.max(this.longestSlice, performance.now() - t0);
    this.report(pending, layout, order, startFloor, allDone);

    if (allDone) {
      this.building = false;
      for (const resolve of this.waiters.splice(0)) resolve();
    } else {
      this.cancelNext = this.o.nextTask(() => this.runSlice());
    }
  }

  private report(
    pending: Map<number, number>, layout: BuildLayout,
    order = this.order(layout, this.startFloor(layout)), startFloor = this.startFloor(layout), allDone = true,
  ): void {
    const total = count(layout.rooms) + count(layout.objects);
    const next = buildProgress({ total, pending, order, startFloor });
    // Built but not yet checked against an edit: not finished, though nothing is
    // missing (currentFloorReady only says that nothing on it is missing)
    if (!allDone) next.allBuilt = false;
    if (sameProgress(next, this._progress)) return;
    this._progress = next;
    this.o.onProgress?.(next);
  }
}
