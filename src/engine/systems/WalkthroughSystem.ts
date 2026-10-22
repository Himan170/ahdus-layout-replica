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
  private scene: Scene;
  /** The view's box: focus in it gives the view the keys (the viewer passes its root; default the canvas). */
  private focusTarget: HTMLElement | null;
  private hadMouse = false;
  private savedTabIndex: number | null = null;

  /**
   * The view is "engaged" (the keys are its own, not the page's) while its
   * canvas has the mouse (pointer lock) or its box has focus.
   */
  isEngaged = (): boolean => {
    if (!this.canvas) return false; // no page (unit tests: a NullEngine has no canvas)
    return document.pointerLockElement === this.canvas || !!this.focusTarget?.contains(document.activeElement);
  };

  /**
   * A click on the view takes the keys (focus) and captures the mouse.
   * Preview's controller asks on mousedown, but Babylon prevents the default
   * of pointerdown, so the browser never sends mousedown (nor moves focus).
   */
  private onPointerDown = () => {
    if (!this.controller.isActive()) return;
    if (!this.focusTarget?.contains(document.activeElement)) this.focusTarget?.focus({ preventScroll: true });
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
  };

  /** Esc gives the keys back to the page: the mouse and the focus. */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.isEngaged()) return;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.release();
  };

  /** The mouse was released (Esc, or the browser): the keys go back to the page too. */
  private onPointerLockChange = () => {
    const hasMouse = document.pointerLockElement === this.canvas;
    if (this.hadMouse && !hasMouse) this.release();
    this.hadMouse = hasMouse;
  };

  /** Take focus out of the view, so the page has the keys again. */
  private release(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.focusTarget?.contains(focused)) focused.blur();
  }

  /**
   * @param getState  the layout to walk through (the store's v1 records)
   * @param getObjectMesh  an item's root node (ObjectSystem)
   * @param focusTarget  the view's box (focus in it engages the view); default the canvas
   */
  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    getState: () => WalkthroughState,
    getObjectMesh: (objectId: string) => TransformNode | null,
    callbacks: WalkthroughCallbacks = {},
    focusTarget: HTMLElement | null = null,
  ) {
    this.canvas = canvas;
    this.scene = scene;
    this.focusTarget = focusTarget ?? canvas;
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
      // The keys are the page's until the view is engaged (Preview's are always its own)
      isEngaged: this.isEngaged,
    });
  }

  /**
   * Take over the camera; the character starts at the spawn point. The keys
   * stay the page's until the user clicks the view or tabs to it.
   */
  activate(): void {
    this.controller.activate();
    if (!this.canvas) return; // no page
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.hadMouse = document.pointerLockElement === this.canvas;
    // One Tab stop, the view's box: Babylon puts the canvas first in the page's
    // Tab order (tabIndex 1, set again on every pointer move)
    const engine = this.scene.getEngine();
    if (this.focusTarget !== this.canvas && this.savedTabIndex === null) {
      this.savedTabIndex = engine.canvasTabIndex;
      engine.canvasTabIndex = -1;
      this.canvas.tabIndex = -1;
    }
  }

  /** Give the camera back (the orbit camera). */
  deactivate(): void {
    this.stopListening();
    this.controller.deactivate();
    if (this.canvas) this.release();
  }

  private stopListening(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.savedTabIndex !== null) {
      this.scene.getEngine().canvasTabIndex = this.savedTabIndex;
      this.canvas.tabIndex = this.savedTabIndex;
      this.savedTabIndex = null;
    }
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
    this.stopListening();
    this.controller.dispose();
  }
}
