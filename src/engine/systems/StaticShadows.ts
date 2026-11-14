/**
 * StaticShadows.ts — v0.17.0: the viewer's sun shadows are drawn ONCE and kept, not drawn again every frame.
 *
 * In the viewer nothing that casts a shadow moves: rooms and items change only when the layout changes, and people
 * and the walker cast none. So the shadow map is drawn again only when what casts shadows changes: a mesh added or
 * removed as a caster, a caster shown or hidden (another floor, the 2D / 3D view), the layout's records (an item
 * moved in edit mode), or the shadows switched back on. Meanwhile the sun's shadow box is kept as well
 * (`autoUpdateExtends` off: measuring every caster's box each frame cost ~2 % of a walk on a weak machine).
 *
 * Studio keeps live shadows (it drags items about).
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';

interface ShadowGeneratorLike {
  getShadowMap(): RenderTargetTexture | null;
  addShadowCaster(mesh: AbstractMesh, includeDescendants?: boolean): unknown;
  removeShadowCaster(mesh: AbstractMesh, includeDescendants?: boolean): unknown;
}

interface SunLike {
  autoUpdateExtends: boolean;
  shadowEnabled: boolean;
}

export interface StaticShadowsOptions {
  /** Things that change when the layout changes (the store's rooms, objects, floors records): compared one by one. */
  layoutKey?: () => readonly unknown[];
}

/** What the shadow map shows: the shown casters (how many + their ids). Cheap: a few hundred calls a frame. */
export function casterSignature(list: readonly AbstractMesh[] | null | undefined): string {
  if (!list) return '';
  let n = 0;
  let sum = 0;
  let mix = 0;
  for (const m of list) {
    if (!m.isEnabled() || !m.isVisible) continue;
    n++;
    sum += m.uniqueId;
    mix = (mix * 31 + m.uniqueId) % 1000000007;
  }
  return `${n}:${sum}:${mix}`;
}

/** After a refresh, how often to look whether every caster's shadow shader is ready (frames), and for how long. */
export const READY_CHECK_FRAMES = 10;
export const READY_GIVE_UP_FRAMES = 600;

export class StaticShadows {
  /** How many times the shadow map was drawn again (tests, the debug hook). */
  refreshes = 0;
  private scene: Scene;
  private generator: ShadowGeneratorLike;
  private sun: SunLike;
  private options: StaticShadowsOptions;
  private dirty = true;
  private signature = '';
  private layout: readonly unknown[] = [];
  private wasEnabled = false;
  /** Frames since a refresh whose map may miss casters whose shadow shaders were not compiled yet (-1: none). */
  private waitingReady = -1;
  private before: Observer<Scene> | null = null;
  private after: Observer<Scene> | null = null;
  private removed: Observer<AbstractMesh> | null = null;
  private restore: (() => void) | null = null;

  constructor(scene: Scene, generator: ShadowGeneratorLike, sun: SunLike, options: StaticShadowsOptions = {}) {
    this.scene = scene;
    this.generator = generator;
    this.sun = sun;
    this.options = options;
    const map = generator.getShadowMap();
    if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    // a caster added or removed: drawn again
    const add = generator.addShadowCaster.bind(generator);
    const remove = generator.removeShadowCaster.bind(generator);
    generator.addShadowCaster = (mesh, deep) => { this.dirty = true; return add(mesh, deep); };
    generator.removeShadowCaster = (mesh, deep) => { this.dirty = true; return remove(mesh, deep); };
    this.restore = () => {
      generator.addShadowCaster = add;
      generator.removeShadowCaster = remove;
    };
    this.removed = scene.onMeshRemovedObservable.add(() => { this.dirty = true; });
    this.before = scene.onBeforeRenderObservable.add(() => this.check());
    this.after = scene.onAfterRenderObservable.add(() => {
      // the box measured for this frame's map stays until the next one
      if (this.sun.autoUpdateExtends) this.sun.autoUpdateExtends = false;
    });
  }

  /** Draw the shadow map again on the next frame. */
  refresh(): void {
    this.dirty = true;
  }

  private check(): void {
    const enabled = this.sun.shadowEnabled;
    const turnedOn = enabled && !this.wasEnabled;
    this.wasEnabled = enabled;
    if (!enabled) return; // nothing drawn meanwhile: checked again when they are back on
    const map = this.generator.getShadowMap();
    if (!map) return;
    const layout = this.options.layoutKey?.() ?? [];
    const signature = casterSignature(map.renderList);
    if (!this.dirty && !turnedOn && signature === this.signature && sameKeys(layout, this.layout)) {
      this.whenReady(map);
      return;
    }
    this.dirty = false;
    this.signature = signature;
    this.layout = layout;
    this.draw(map);
    this.waitingReady = 0;
  }

  private draw(map: RenderTargetTexture): void {
    this.refreshes++;
    this.sun.autoUpdateExtends = true;
    map.resetRefreshCounter();
  }

  /**
   * A caster whose shadow shader is still compiling is left out of that draw: until every one is ready (checked
   * every READY_CHECK_FRAMES frames), the map is drawn once more when they are.
   */
  private whenReady(map: RenderTargetTexture): void {
    if (this.waitingReady < 0) return;
    this.waitingReady++;
    if (this.waitingReady % READY_CHECK_FRAMES) return;
    if (map.isReadyForRendering() || this.waitingReady >= READY_GIVE_UP_FRAMES) {
      this.waitingReady = -1;
      this.draw(map);
    }
  }

  dispose(): void {
    if (this.before) this.scene.onBeforeRenderObservable.remove(this.before);
    if (this.after) this.scene.onAfterRenderObservable.remove(this.after);
    if (this.removed) this.scene.onMeshRemovedObservable.remove(this.removed);
    this.before = this.after = this.removed = null;
    this.restore?.();
    this.restore = null;
  }
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
