/**
 * ShadowSwitch.ts — v0.17.1: the viewer's shadows switched off (or on again) WITHOUT a freeze.
 *
 * v0.17.0 turned shadows off with `sun.shadowEnabled = false`. That marks every material in the scene dirty at once,
 * and a weak processor spent ~1.5 s in that one frame (v0.17.0's walk measurement: the quality step "no shadows").
 * Measured in v0.17.1 (the Meridian-shaped layout, software WebGL): the flip of the light's flag is the cost, whatever
 * receives at that moment (with nothing receiving it still took one ~1.6 s frame).
 *
 * So the light's flag is never touched here. Shadows "off" = no mesh receives them: the receivers stop receiving a
 * batch per frame and are HELD off. A batch is counted in MATERIALS, not meshes: the meshes of one material share its
 * new shader, so a frame compiles about as many new shaders as its batch has materials (software WebGL: a few hundred
 * ms each; a graphics card: tens). "on" = the held ones receive again, a batch per frame. With nothing receiving there are no shadow lookups, and the viewer's shadow map is drawn
 * once anyway (StaticShadows), so the GPU saving is the same. Meshes built while shadows are off are caught by a
 * scan every SCAN_FRAMES frames and held too.
 *
 * Babylon makes the new shaders in the background: the frame a batch changes looks quick (its meshes just aren't
 * drawn yet) and the cost comes a frame or two later. So the next batch waits until the last one's meshes are ready
 * (at most WAIT_FRAMES frames), and the slowest frame meanwhile decides its size.
 *
 * The batch (materials per frame, FIRST_BATCH at first) grows while frames stay quick (at most FAST_MS longer than this device's usual frame) and halves after a
 * slow one (more than SLOW_MS longer). "Usual" is measured while no switch runs, so a device whose every frame is slow
 * (software WebGL: ~400 ms) still finishes in a few frames. A switch asked for during another one turns it round.
 *
 * Measured (Meridian-shaped layout, 319 people, walking; Intel UHD graphics, the CPU 4 × slower): turning shadows off
 * used to cost one 250–270 ms frame (+ one of ~160 ms), now at most ~95 ms over ~17 frames; on: 120 ms → ~70 ms.
 * Software WebGL (SwiftShader) can't get under ~1 s: compiling ONE material's new shader takes that long there.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

/** The first batch (materials: all the meshes of each), and its bounds. */
export const FIRST_BATCH = 1;
export const MAX_BATCH = 1024;
/** A frame at most this much longer than the usual one (ms): the next batch is twice as big; more than SLOW_MS: half. */
export const FAST_MS = 45;
export const SLOW_MS = 135;
/** The usual frame before any is measured (ms), and how fast the measured one follows (an average). */
export const USUAL_MS = 16;
const USUAL_RATE = 0.1;
/** The most frames a batch waits for its meshes to be ready (a shader that never compiles doesn't stop the switch). */
export const WAIT_FRAMES = 30;
/** Shadows off: how often (frames) new receivers (meshes built meanwhile) are looked for. */
export const SCAN_FRAMES = 30;

/** Meshes of one material next to each other (a batch takes whole materials). */
function byMaterial(list: AbstractMesh[]): AbstractMesh[] {
  return list.sort((a, b) => (a.material?.uniqueId ?? -1) - (b.material?.uniqueId ?? -1));
}

export class ShadowSwitch {
  private scene: Scene;
  /** Shadows wanted: on (true) or off. */
  private on = true;
  /** The meshes still to change in this switch, and those held off (they receive again when shadows come back). */
  private queue: AbstractMesh[] = [];
  private held = new Set<AbstractMesh>();
  private batch = FIRST_BATCH;
  private observer: Observer<Scene> | null = null;
  private lastFrame = -1;
  private usual = USUAL_MS;
  private sinceScan = 0;
  /** The last batch, until its meshes are ready; the slowest frame since it changed; frames waited. */
  private waiting: AbstractMesh[] = [];
  private worst = 0;
  private waited = 0;
  /** How many frames the last switch took (tests, the debug hook). */
  frames = 0;
  private now: () => number;
  private isReady: (m: AbstractMesh) => boolean;

  constructor(scene: Scene, { now = () => performance.now(), isReady = (m: AbstractMesh) => m.isReady(true) }: {
    now?: () => number; isReady?: (m: AbstractMesh) => boolean;
  } = {}) {
    this.scene = scene;
    this.now = now;
    this.isReady = isReady;
    this.observer = scene.onBeforeRenderObservable.add(() => this.step());
  }

  /** Shadows wanted on (true) or off: reached over the next frames. */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.frames = 0;
    this.batch = FIRST_BATCH;
    this.waiting = [];
    if (on) {
      // the held ones receive again (those still waiting to go off just stay as they are)
      this.queue = byMaterial([...this.held].filter((m) => !m.isDisposed()));
      this.held.clear();
    } else {
      // turned round while going on: those not given back yet are still off: they stay held
      for (const m of this.queue) if (!m.isDisposed()) this.held.add(m);
      this.queue = this.receivers();
    }
  }

  /** Shadows wanted: on (true) or off (the quality step, Low graphics). */
  get shadowsOn(): boolean {
    return this.on;
  }

  /** A switch is under way (the quality monitor doesn't measure meanwhile: its frames say nothing). */
  get busy(): boolean {
    return this.queue.length > 0 || this.waiting.length > 0;
  }

  /** This device's usual frame (ms): what a switch's frames are compared with. */
  get usualFrame(): number {
    return this.usual;
  }

  /** How many meshes are held off now. */
  get heldCount(): number {
    return this.held.size;
  }

  /** The meshes receiving shadows now, meshes of one material together (their shaders are checked once). */
  private receivers(): AbstractMesh[] {
    return byMaterial(this.scene.meshes.filter((m) => m.receiveShadows && !m.isDisposed()));
  }

  private step(): void {
    const t = this.now();
    const ms = this.lastFrame < 0 ? -1 : t - this.lastFrame;
    this.lastFrame = t;
    if (!this.queue.length && !this.waiting.length) {
      // the usual frame, measured while nothing switches (a page hidden for a while: not a frame)
      if (ms > 0 && ms < 2000) this.usual += (ms - this.usual) * USUAL_RATE;
      // shadows off: meshes built meanwhile come receiving: hold them too
      if (!this.on && ++this.sinceScan >= SCAN_FRAMES) {
        this.sinceScan = 0;
        const more = this.receivers();
        if (more.length) {
          this.queue = more;
          this.frames = 0;
          this.batch = FIRST_BATCH;
        }
      }
      return;
    }
    this.frames++;
    if (ms > 0) this.worst = Math.max(this.worst, ms);
    if (this.waiting.length) {
      // the last batch's new shaders: wait until its meshes are ready, then size the next one by the slowest frame
      const ready = this.waiting.every((m) => m.isDisposed() || this.isReady(m));
      if (!ready && ++this.waited < WAIT_FRAMES) return;
      const extra = this.worst - this.usual;
      if (extra <= FAST_MS) this.batch = Math.min(MAX_BATCH, this.batch * 2);
      else if (extra > SLOW_MS) this.batch = Math.max(1, Math.floor(this.batch / 2));
      this.waiting = [];
    }
    if (!this.queue.length) {
      this.sinceScan = 0;
      return;
    }
    // the meshes of the next `batch` materials (the queue is sorted by material)
    let n = 0;
    let materials = 0;
    let last: number | null = null;
    for (; n < this.queue.length; n++) {
      const id = this.queue[n].material?.uniqueId ?? -1;
      if (id !== last) {
        if (materials === this.batch) break;
        materials++;
        last = id;
      }
    }
    const take = this.queue.splice(0, n);
    for (const m of take) {
      if (m.isDisposed()) continue;
      m.receiveShadows = this.on;
      if (!this.on) this.held.add(m);
    }
    this.waiting = take;
    this.worst = 0;
    this.waited = 0;
  }

  dispose(): void {
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.observer = null;
    this.queue = [];
    this.waiting = [];
    this.held.clear();
  }
}
