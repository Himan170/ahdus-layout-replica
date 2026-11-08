/**
 * WalkthroughSystem.ts
 *
 * Walking through a layout (LayoutEngine's walkthrough mode): Preview's
 * character, camera and controls (play/playController.js: W A S D, mouse,
 * Space, F, V, Page Up / Down, E) with nothing in hand and nothing that edits
 * (`readOnly`: right-click removes nothing, N adds no floor). Every edit the
 * controller could still ask for is refused here too.
 *
 * Easy controls (v0.14.0, private-docs/EXPERIENCE_PLAN.md 3.2): the view takes
 * the keys when walking starts and again after a click on its own buttons;
 * they also work while the mouse is over it (never while typing in a text
 * field). Drag to look, the cursor stays; a plain click is onPointClick.
 * A double-click or L captures the mouse (mouse-look mode); the first Esc
 * releases it, the next one gives the keys back to the page.
 *
 * Tells its owner when the character walks into or out of a room, presses E
 * on something, or moves to another floor.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { createPlayController } from '../../play/playController';
import type { LayoutRecords, V1Room } from './RoomSystem';
import type { PlayCharacter } from './PlayerCharacter';
import type { Pilot } from './NavigationSystem';

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
  /** A plain click on the view (not a drag): what is under it (LayoutEngine decides: a person, E, or walk there). */
  onPointClick?: (click: WalkthroughClick) => void;
  /** A double-click on the view: the mouse is being captured (mouse-look mode). */
  onDoubleClick?: () => void;
}

/** A plain click on the walking view (playController.clickTarget). */
export interface WalkthroughClick {
  /** Where it was clicked, in CSS px from the canvas's top left (mouse-look mode: the crosshair). */
  screen: { x: number; y: number };
  /** The point hit, or null (the sky). */
  point: { x: number; y: number; z: number } | null;
  /** An item, door or window within reach (what E would use there), or null. */
  target: WalkthroughTarget | null;
  /** Where to walk: the spot on a floor, else a little in front of what was hit; null: nothing there. */
  walkTo: { x: number; z: number; floor: number } | null;
  kind: string | null;
}

/** A text field (typing there never walks; the view never takes the focus from it). */
export function isTextField(el: Element | null | undefined): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
}

/** Esc this soon (ms) after the browser released the mouse is that release, not "give the keys back". */
const ESC_AFTER_UNLOCK_MS = 400;
/** After a click on one of the view's own buttons: the view takes the keys back this soon (ms). */
const REFOCUS_MS = 30;
/** On the view's box while the view focuses it itself (its focus listeners can tell that from Tab: no ring). */
export const AUTO_FOCUS_ATTR = 'data-auto-focus';

/** Where walking starts (play/navigation/entrance.js entranceSpawn). */
export interface SpawnSpot {
  x: number;
  z: number;
  yaw: number;
  floor: number;
  source: 'spawnPoint' | 'entrance' | 'buildingSide' | 'origin';
  /** A wall or furniture was on the spot: this is the nearest free one. */
  moved: boolean;
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
  /** The mouse is over the view (v0.14.0: then the keys are its own too). */
  private hovered = false;
  /** Esc gave the keys back while the mouse was over the view: hovering doesn't take them again until it leaves. */
  private hoverReleased = false;
  /** When the browser last released the mouse (performance.now()). */
  private unlockedAt = -Infinity;
  private refocusTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The view is "engaged" (the keys are its own, not the page's) while its
   * canvas has the mouse (pointer lock), its box has focus, or the mouse is
   * over it (v0.14.0). Walking starts with the focus in the view.
   */
  isEngaged = (): boolean => {
    if (!this.canvas) return false; // no page (unit tests: a NullEngine has no canvas)
    return document.pointerLockElement === this.canvas || !!this.focusTarget?.contains(document.activeElement)
      || (this.hovered && !this.hoverReleased);
  };

  /**
   * A press on the view takes the keys (focus). It never captures the mouse
   * (v0.14.0: drag to look; a double-click or L does). Babylon prevents the
   * default of pointerdown, so the browser itself moves no focus.
   */
  private onPointerDown = () => {
    if (!this.controller.isActive()) return;
    this.hoverReleased = false;
    if (!this.focusTarget?.contains(document.activeElement)) this.takeFocus();
  };

  private onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.hovered = true;
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.hovered = false;
    this.hoverReleased = false;
  };

  /**
   * Esc: first it releases the mouse (mouse-look mode), then it gives the keys
   * back to the page. A route stopped by Esc, or a box of ours that closed,
   * has taken it (defaultPrevented) and nothing more happens.
   */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !this.isEngaged()) return;
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
      return;
    }
    if (performance.now() - this.unlockedAt < ESC_AFTER_UNLOCK_MS) return; // this Esc released the mouse
    this.release();
  };

  /** The mouse was released (Esc, L, or the browser): back to drag to look; the keys stay the view's. */
  private onPointerLockChange = () => {
    const hasMouse = document.pointerLockElement === this.canvas;
    if (this.hadMouse && !hasMouse) this.unlockedAt = performance.now();
    this.hadMouse = hasMouse;
  };

  /**
   * A click on one of the view's own buttons (Back to entrance, Find, a card's
   * Close, a result): the keys come back to the view, unless the click put the
   * focus in a text field (the search box). Keyboard presses (detail 0) keep
   * the focus where it is, so Tab still goes on from that button.
   */
  private onBoxClick = (e: MouseEvent) => {
    if (!this.controller.isActive() || e.detail === 0) return;
    const el = e.target as Element | null;
    if (!el?.closest?.('button, a[href], [role="option"], [role="button"]') || isTextField(el)) return;
    clearTimeout(this.refocusTimer);
    this.refocusTimer = setTimeout(() => {
      if (!this.controller.isActive() || isTextField(document.activeElement)) return;
      const focused = document.activeElement;
      // the click moved the focus out of the view (a link to another page, the page's own code): leave it there
      if (focused && focused !== document.body && !this.focusTarget?.contains(focused)) return;
      this.takeFocus();
    }, REFOCUS_MS);
  };

  /** Take focus out of the view, so the page has the keys again. */
  private release(): void {
    if (this.hovered) this.hoverReleased = true;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.focusTarget?.contains(focused)) focused.blur();
  }

  /** The view takes the keys (focus, without scrolling the page or a focus ring). */
  private takeFocus(): void {
    const box = this.focusTarget;
    if (!box) return;
    // from above the view's box is no Tab stop (walking makes it one); a div needs one to take focus
    if (box !== this.canvas && box.tabIndex < 0) box.tabIndex = 0;
    // focus given by the view itself, not by Tab: no focus ring (a page's first focus() counts as :focus-visible)
    box.setAttribute(AUTO_FOCUS_ATTR, '');
    try {
      box.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    } finally {
      box.removeAttribute(AUTO_FOCUS_ATTR);
    }
  }

  /**
   * @param getState  the layout to walk through (the store's v1 records)
   * @param getObjectMesh  an item's root node (ObjectSystem)
   * @param focusTarget  the view's box (focus in it engages the view); default the canvas
   * @param walkMaps  the walk maps to share (NavigationSystem.walkMaps); default the controller's own
   */
  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    getState: () => WalkthroughState,
    getObjectMesh: (objectId: string) => TransformNode | null,
    callbacks: WalkthroughCallbacks = {},
    focusTarget: HTMLElement | null = null,
    walkMaps: unknown = null,
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
      // Drag to look, the cursor always visible; a click = onPointClick (Preview keeps pointer lock)
      look: 'drag',
      onPointClick: callbacks.onPointClick,
      onDoubleClick: callbacks.onDoubleClick,
      // Every walk starts at the entrance (the ground floor), wherever you were looking from above
      respawnOnActivate: true,
      // one cache of walk maps for the search, the routes and walking
      walkMaps,
    });
  }

  /**
   * Take over the camera; the character starts at the entrance (play/navigation/entrance.js:
   * the ground floor's spawn point, else 3 m outside the main entrance, facing it). The view
   * takes the keys at once (v0.14.0), unless the page's own text field has the focus.
   */
  activate(): void {
    this.controller.activate();
    if (!this.canvas) return; // no page
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.focusTarget?.addEventListener('pointerenter', this.onPointerEnter);
    this.focusTarget?.addEventListener('pointerleave', this.onPointerLeave);
    this.focusTarget?.addEventListener('click', this.onBoxClick);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.hadMouse = document.pointerLockElement === this.canvas;
    this.hovered = !!this.focusTarget?.matches?.(':hover');
    this.hoverReleased = false;
    // One Tab stop, the view's box: Babylon puts the canvas first in the page's
    // Tab order (tabIndex 1, set again on every pointer move)
    const engine = this.scene.getEngine();
    if (this.focusTarget !== this.canvas && this.savedTabIndex === null) {
      this.savedTabIndex = engine.canvasTabIndex;
      engine.canvasTabIndex = -1;
      this.canvas.tabIndex = -1;
    }
    if (!isTextField(document.activeElement)) this.takeFocus();
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
    this.focusTarget?.removeEventListener('pointerenter', this.onPointerEnter);
    this.focusTarget?.removeEventListener('pointerleave', this.onPointerLeave);
    this.focusTarget?.removeEventListener('click', this.onBoxClick);
    clearTimeout(this.refocusTimer);
    this.hovered = false;
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

  /**
   * Back to where walking starts: on the ground floor, its spawn point (or the nearest free spot
   * to it), else 3 m outside the main entrance facing it, else outside the building's −Z side.
   */
  respawn(): SpawnSpot {
    return this.controller.respawn();
  }

  /** Home / "Back to entrance": respawn and say so in the HUD (only while walking). */
  backToEntrance(): void {
    this.controller.backToEntrance();
  }

  /** Where walking would start now (nothing moves). */
  spawnPoint(): SpawnSpot {
    return this.controller.spawnPoint();
  }

  /** Does the walking body fit at (x, z) on a floor (default: the one you are on)? Clear of walls and solid items. */
  isFree(x: number, z: number, floorId?: number): boolean {
    return this.controller.isFree(x, z, floorId);
  }

  /**
   * Put the character at an exact spot and view angle (tests, "go to" features). A spot in a
   * wall or a solid item becomes the nearest one where the body fits. `exact: true` is for tests only
   * (it can put the body inside a wall); features must never pass it.
   */
  setPose(pose: { x: number; z: number; yaw?: number; pitch?: number; floor?: number; y?: number; fly?: boolean; exact?: boolean }): void {
    this.controller.setPose(pose);
  }

  /**
   * Follow a route (NavigationSystem, "Show route" / "Take me there"): asked every frame where to go;
   * null = free walking, exactly as before.
   */
  setAutopilot(pilot: Pilot | null): void {
    this.controller.setAutopilot(pilot);
  }

  /** The company tour's keys (v0.14.4: P, Esc): handler(code) sees each key first; true = taken. null = none. */
  /** The company tour's stop view: the camera eases higher and further back (instant: at once). */
  setStopView(on: boolean, instant = false): void {
    this.controller.setStopView?.(on, { instant });
  }

  setKeyHandler(handler: ((code: string) => boolean) | null): void {
    this.controller.setKeyHandler(handler);
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  /**
   * Walk as this character (systems/PlayerCharacter: your own), the camera at
   * its eye height; null = Preview's built-in figure. The one before is disposed.
   */
  setCharacter(character: PlayCharacter | null): void {
    this.controller.setCharacter(character, { eyeHeight: character?.eyeHeight });
  }

  /** The character walking now: a PlayCharacter, or the built-in figure (kind undefined). */
  getCharacter(): (Partial<PlayCharacter> & { root: TransformNode }) | null {
    return this.controller.getCharacter?.() ?? null;
  }

  /** The camera's height above the feet (m). */
  getEyeHeight(): number {
    return this.controller.getEyeHeight?.() ?? 1.62;
  }

  /** Which way the character faces (radians, 0 = +Z / north). */
  getYaw(): number {
    return this.controller.getYaw();
  }

  /** How far the view looks up or down (radians, negative = down). */
  getPitch(): number {
    return this.controller.getPitch?.() ?? 0;
  }

  /** The room the character is in, or null. */
  getRoomId(): string | null {
    return this.controller.getRoomId();
  }

  /** The floor the character is on. */
  getLevel(): number {
    return this.controller.getLevel();
  }

  /** Flying (F, or arrived on a floor with no room there)? */
  isFlying(): boolean {
    return this.controller.isFlying();
  }

  /** The floor above (+1) or below (−1), at the same spot: Page Up / Page Down. */
  stepFloor(dir: 1 | -1): void {
    this.controller.stepFloor(dir);
  }

  /** What a click at (x, y) on the view (CSS px from the canvas's top left) would be on (tests). */
  clickTarget(x: number, y: number): WalkthroughClick {
    return this.controller.clickTarget(x, y) as WalkthroughClick;
  }

  /** A short message in the HUD. */
  say(text: string, ms = 3000): void {
    this.controller.say(text, ms);
  }

  /** Mouse-look mode (the double-click or L): capture the mouse; Esc releases it. Resolves false if the browser refused. */
  lockMouse(): Promise<boolean> {
    return this.controller.lockMouse();
  }

  releaseMouse(): void {
    this.controller.releaseMouse();
  }

  /** The mouse is captured (mouse-look mode). */
  isMouseLocked(): boolean {
    return this.controller.isLocked();
  }

  /**
   * The touch joystick (v0.14.1, the viewer's TouchControls): x = right, y = forward, each −1…1, the
   * length how fast (1 = walking speed); 0, 0 = let go. Moves like the keys (a route pauses).
   */
  setStick(x: number, y: number): void {
    this.controller.setStick(x, y);
  }

  /** Where the joystick is now ({ x, y }; tests). */
  getStick(): { x: number; y: number } {
    return this.controller.getStick();
  }

  /** The HUD's walking line in touch words (joystick, drag, tap), or in keys and mouse words. */
  setTouch(on: boolean): void {
    this.controller.setTouch(on);
  }

  dispose(): void {
    this.stopListening();
    this.controller.dispose();
  }
}
