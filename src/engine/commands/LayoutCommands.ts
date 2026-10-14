/**
 * commands/LayoutCommands.ts
 *
 * Concrete Command implementations for all undoable operations.
 * Each command captures the minimal state needed to do/undo.
 */

import type { Command } from './CommandHistory';
import type { LayoutObject, Room, Anchor, Opening } from '../model/schema';

// ── Generic store interface the commands operate on ──────────────────────
// This keeps commands decoupled from Zustand — any store that implements
// this interface works (useful for testing and the embeddable engine).
//
// CONTRACT: addObject/addRoom MUST reuse `id` when one is passed in.
// Redo and undo-of-delete rely on this so other modules' references
// (anchors, positionRef, Karthik's attachments) stay valid.
// (workspaceStore.addObject/addRoom honour opts.id — see src/store/editorHistory.js)

export interface LayoutStore {
  addObject(obj: Partial<LayoutObject> & { assetType: string }): string;
  updateObject(id: string, patch: Partial<LayoutObject>): void;
  removeObject(id: string): void;
  getObject(id: string): LayoutObject | undefined;

  addRoom(data: Partial<Room>): string;
  updateRoom(id: string, patch: Partial<Room>): void;
  removeRoom(id: string): void;
  getRoom(id: string): Room | undefined;

  addAnchor(anchor: Anchor): void;
  removeAnchor(id: string): void;
}

/** Options shared by patch-style commands. */
export interface PatchCommandOptions {
  /** Text for the undo tooltip. */
  label?: string;
  /**
   * Consecutive commands on the same entity with the same mergeKey become one
   * undo step (e.g. 'inspector' for slider drags, 'room-fields' for typing).
   * Leave undefined for discrete actions (gizmo drag end, lock, door toggle).
   */
  mergeKey?: string;
}

/** Combine two inverse patches, keeping the OLDEST value for each key. */
function mergeInverse<T>(older: Partial<T> | null, newer: Partial<T> | null): Partial<T> | null {
  if (!older) return newer;
  if (!newer) return older;
  return { ...newer, ...older };
}

// ── Add Object ───────────────────────────────────────────────────────────

export class AddObjectCommand implements Command {
  label: string;
  private store: LayoutStore;
  private data: Partial<LayoutObject> & { assetType: string };
  private createdId: string | null = null;

  constructor(store: LayoutStore, data: Partial<LayoutObject> & { assetType: string }) {
    this.store = store;
    this.data = { ...data };
    this.label = `Add ${data.assetType}`;
  }

  execute(): void {
    if (this.createdId) {
      // Re-do: add with the same ID so references stay valid
      this.store.addObject({ ...this.data, id: this.createdId });
    } else {
      this.createdId = this.store.addObject(this.data);
    }
  }

  undo(): void {
    if (this.createdId) {
      this.store.removeObject(this.createdId);
    }
  }
}

// ── Delete Object ────────────────────────────────────────────────────────

export class DeleteObjectCommand implements Command {
  label: string;
  private store: LayoutStore;
  private objectId: string;
  private snapshot: LayoutObject | null = null;

  constructor(store: LayoutStore, objectId: string) {
    this.store = store;
    this.objectId = objectId;
    this.label = `Delete object`;
  }

  execute(): void {
    // Snapshot the object before deleting so we can restore it
    this.snapshot = this.store.getObject(this.objectId) ?? null;
    this.store.removeObject(this.objectId);
  }

  undo(): void {
    if (this.snapshot) {
      this.store.addObject(this.snapshot);
    }
  }
}

// ── Transform Object (position, rotation, scale, label, etc.) ────────────

export class TransformCommand implements Command {
  label: string;
  private store: LayoutStore;
  private objectId: string;
  private patch: Partial<LayoutObject>;
  private inversePatch: Partial<LayoutObject> | null = null;
  private mergeKey?: string;

  constructor(
    store: LayoutStore,
    objectId: string,
    patch: Partial<LayoutObject>,
    options: PatchCommandOptions = {},
  ) {
    this.store = store;
    this.objectId = objectId;
    this.patch = { ...patch };
    this.label = options.label ?? `Transform object`;
    this.mergeKey = options.mergeKey;
  }

  mergeWith(next: Command): boolean {
    if (
      !(next instanceof TransformCommand) ||
      !this.mergeKey ||
      next.mergeKey !== this.mergeKey ||
      next.objectId !== this.objectId
    ) {
      return false;
    }
    this.patch = { ...this.patch, ...next.patch };
    this.inversePatch = mergeInverse(this.inversePatch, next.inversePatch);
    return true;
  }

  execute(): void {
    // On first execute, capture current values for undo
    if (!this.inversePatch) {
      const obj = this.store.getObject(this.objectId);
      if (obj) {
        this.inversePatch = {};
        for (const key of Object.keys(this.patch) as (keyof LayoutObject)[]) {
          (this.inversePatch as any)[key] = obj[key];
        }
      }
    }
    this.store.updateObject(this.objectId, this.patch);
  }

  undo(): void {
    if (this.inversePatch) {
      this.store.updateObject(this.objectId, this.inversePatch);
    }
  }
}

// ── Add Room ─────────────────────────────────────────────────────────────

export class AddRoomCommand implements Command {
  label: string;
  private store: LayoutStore;
  private data: Partial<Room>;
  private createdId: string | null = null;

  constructor(store: LayoutStore, data: Partial<Room>) {
    this.store = store;
    this.data = { ...data };
    this.label = `Add ${data.type ?? 'room'}`;
  }

  execute(): void {
    if (this.createdId) {
      this.store.addRoom({ ...this.data, id: this.createdId });
    } else {
      this.createdId = this.store.addRoom(this.data);
    }
  }

  undo(): void {
    if (this.createdId) {
      this.store.removeRoom(this.createdId);
    }
  }
}

// ── Delete Room ──────────────────────────────────────────────────────────

export class DeleteRoomCommand implements Command {
  label: string;
  private store: LayoutStore;
  private roomId: string;
  private snapshot: Room | null = null;

  constructor(store: LayoutStore, roomId: string) {
    this.store = store;
    this.roomId = roomId;
    this.label = `Delete room`;
  }

  execute(): void {
    this.snapshot = this.store.getRoom(this.roomId) ?? null;
    this.store.removeRoom(this.roomId);
  }

  undo(): void {
    if (this.snapshot) {
      this.store.addRoom(this.snapshot);
    }
  }
}

// ── Update Room ──────────────────────────────────────────────────────────

export class UpdateRoomCommand implements Command {
  label: string;
  private store: LayoutStore;
  private roomId: string;
  private patch: Partial<Room>;
  private inversePatch: Partial<Room> | null = null;
  private mergeKey?: string;

  constructor(
    store: LayoutStore,
    roomId: string,
    patch: Partial<Room>,
    options: PatchCommandOptions = {},
  ) {
    this.store = store;
    this.roomId = roomId;
    this.patch = { ...patch };
    this.label = options.label ?? `Update room`;
    this.mergeKey = options.mergeKey;
  }

  mergeWith(next: Command): boolean {
    if (
      !(next instanceof UpdateRoomCommand) ||
      !this.mergeKey ||
      next.mergeKey !== this.mergeKey ||
      next.roomId !== this.roomId
    ) {
      return false;
    }
    this.patch = { ...this.patch, ...next.patch };
    this.inversePatch = mergeInverse(this.inversePatch, next.inversePatch);
    return true;
  }

  execute(): void {
    if (!this.inversePatch) {
      const room = this.store.getRoom(this.roomId);
      if (room) {
        this.inversePatch = {};
        for (const key of Object.keys(this.patch) as (keyof Room)[]) {
          (this.inversePatch as any)[key] = room[key];
        }
      }
    }
    this.store.updateRoom(this.roomId, this.patch);
  }

  undo(): void {
    if (this.inversePatch) {
      this.store.updateRoom(this.roomId, this.inversePatch);
    }
  }
}
