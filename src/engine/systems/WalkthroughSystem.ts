/**
 * WalkthroughSystem.ts
 *
 * Walking through a layout (LayoutEngine's walkthrough mode): Preview's
 * character, camera and controls (play/playController.js: W A S D, mouse,
 * Space, F, V, Page Up / Down, E) with nothing in hand and nothing that edits
 * (`readOnly`: right-click removes nothing, N adds no floor). Every edit the
 * controller could still ask for is refused here too.
 *
 * Tells its owner when the character walks into or out of a room, presses E
 * on something, or moves to another floor.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { createPlayController } from '../../play/playController';
import type { LayoutRecords, V1Room } from './RoomSystem';

/** What E was pressed on: an item, or a door / window of a room (playController's target). */
export interface WalkthroughTarget {
  objectId?: string;
  roomId?: string;
  part?: string;
  point: { x: number; y: number; z: number };
  distance: number;
}

export interface WalkthroughCallbacks {
  /** The character walked from one room to another (null: outside). */
  onRoomChange?: (from: V1Room | null, to: V1Room | null) => void;
  onInteract?: (target: WalkthroughTarget) => void;
  /** The floor the character is on changed. */
  onLevelChange?: (floorId: number) => void;
  /** Inside a room (ceilings show) or outside (roofs show), and on which floor. */
  onViewChange?: (view: { inside: boolean; level: number }) => void;
  /** What Preview's HUD would show (aim, hint, floor). */
  onHud?: (info: unknown) => void;
  /** What E would do on a target, for the prompt; null: no prompt label. */
  describeInteraction?: (target: WalkthroughTarget) => { label: string; name: string; handled: boolean } | null;
}

/** The answer to any edit asked for while walking through. */
export const WALKTHROUGH_READ_ONLY = 'Walking through: the layout can\'t be changed here';

/** Every action refuses (the controller never edits the store itself). */
const refuseAll = new Proxy({}, {
  get: () => () => ({ problem: WALKTHROUGH_READ_ONLY }),
});

type PlayController = ReturnType<typeof createPlayController>;
/** playController.js is plain JS: TypeScript would read its option defaults (() => {}) as their types. */
const createController = createPlayController as unknown as (scene: Scene, canvas: HTMLCanvasElement, options: Record<string, unknown>) => PlayController;

export interface WalkthroughState extends LayoutRecords {
  currentFloor: number;
}

export class WalkthroughSystem {
  private controller: PlayController;
  private canvas: HTMLCanvasElement;

  /**
   * A click on the view captures the mouse. Preview's controller asks on
   * mousedown, but Babylon prevents the default of pointerdown, so the browser
   * never sends mousedown (Studio captures it from its "Preview Workplace" button).
   */
  private onPointerDown = () => {
    if (this.controller.isActive() && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
  };

  /**
   * @param getState  the layout to walk through (the store's v1 records)
   * @param getObjectMesh  an item's root node (ObjectSystem)
   */
  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    getState: () => WalkthroughState,
    getObjectMesh: (objectId: string) => TransformNode | null,
    callbacks: WalkthroughCallbacks = {},
  ) {
    this.canvas = canvas;
    this.controller = createController(scene, canvas, {
      getState: () => {
        const s = getState();
        return {
          rooms: Object.values(s.rooms),
          objects: Object.values(s.objects),
          currentFloor: s.currentFloor,
          floors: s.floors,
        };
      },
      actions: refuseAll,
      getObjectMesh,
      readOnly: true,
      onHud: callbacks.onHud,
      onInteract: callbacks.onInteract,
      onRoomChange: callbacks.onRoomChange,
      onLevelChange: callbacks.onLevelChange,
      onViewChange: callbacks.onViewChange,
      describeInteraction: callbacks.describeInteraction,
    });
  }

  /** Take over the camera and the keys; the character starts at the spawn point. */
  activate(): void {
    this.controller.activate();
    this.canvas?.addEventListener('pointerdown', this.onPointerDown);
  }

  /** Give the camera back (the orbit camera). */
  deactivate(): void {
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
    this.controller.deactivate();
  }

  isActive(): boolean {
    return this.controller.isActive();
  }

  /** Back to the spawn point (a spawn marker, else outside the first room) on the current floor. */
  respawn(): void {
    this.controller.respawn();
  }

  /** Put the character at an exact spot and view angle (tests, "go to" features). */
  setPose(pose: { x: number; z: number; yaw?: number; pitch?: number; floor?: number; y?: number; fly?: boolean }): void {
    this.controller.setPose(pose);
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  /** Which way the character faces (radians, 0 = +Z / north). */
  getYaw(): number {
    return this.controller.getYaw();
  }

  /** The room the character is in, or null. */
  getRoomId(): string | null {
    return this.controller.getRoomId();
  }

  /** The floor the character is on. */
  getLevel(): number {
    return this.controller.getLevel();
  }

  /** The floor above (+1) or below (−1), at the same spot: Page Up / Page Down. */
  stepFloor(dir: 1 | -1): void {
    this.controller.stepFloor(dir);
  }

  dispose(): void {
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
    this.controller.dispose();
  }
}
