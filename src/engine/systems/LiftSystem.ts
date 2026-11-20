/**
 * LiftSystem.ts (v0.18.3): the lifts' cars and call buttons, and riding one.
 *
 * A lift is derived from the lift shaft rooms (PURE play/lifts.js: `liftsOf`, `liftParts`); nothing about it is saved
 * but the room type. Three unit boxes with thin instances (steel panels, metal rail / call button, the ceiling light),
 * so every lift of the building is at most three draw calls; not pickable, no collisions, no shadows. A lift's parts
 * on a floor show while that floor's shaft room is shown (FloorSystem, Layers). Its doors are DoorSystem's (style
 * 'lift': two steel panels sliding apart, opened by people walking up, like every door).
 *
 * Riding (viewer / embed walkthrough, and Take me there through NavigationSystem's `ride`): standing in a car, the
 * HUD's floor panel (LayoutViewer `[data-lift-panel]`) calls `ride(floor)`: the walker stands at the same spot of
 * the car on that floor. The car waits on every floor (decided overnight, v0.18.3): no travelling car to call.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { liftsOf, liftParts, liftAt } from '../../play/lifts';
import { getAssetMaterial, markShared } from '../../utils/materialLibrary';

type Part = 'steel' | 'metal' | 'light';
const PARTS: Part[] = ['steel', 'metal', 'light'];

export interface LiftSystemOptions {
  getLayout: () => { rooms: Record<string, unknown> | unknown[]; floors: Record<number, { id: number; name: string; height?: number }> };
  roomNode: (roomId: string) => TransformNode | null;
}

export interface LiftInfo {
  id: string;
  floors: { id: number; name: string }[];
  floor: number;
}

export class LiftSystem {
  private scene: Scene;
  private opts: LiftSystemOptions;
  private meshes = new Map<Part, Mesh>();
  private roomsRef: unknown = null;
  private floorsRef: unknown = null;
  private lifts: ReturnType<typeof liftsOf> = [];
  private parts: ReturnType<typeof liftParts> = [];
  private signature = '';

  constructor(scene: Scene, opts: LiftSystemOptions) {
    this.scene = scene;
    this.opts = opts;
  }

  private material(part: Part): Material {
    if (part === 'steel') return getAssetMaterial(this.scene, 'metal', '#9aa3a8') as Material;
    if (part === 'metal') return getAssetMaterial(this.scene, 'metal', '#c9ced2') as Material;
    const name = 'lift_light';
    let m = this.scene.getMaterialByName(name) as StandardMaterial | null;
    if (!m) {
      m = new StandardMaterial(name, this.scene);
      m.emissiveColor = new Color3(0.95, 0.95, 0.9);
      m.diffuseColor = new Color3(1, 1, 1);
      m.disableLighting = true;
      markShared(m);
    }
    return m;
  }

  private mesh(part: Part): Mesh {
    let m = this.meshes.get(part);
    if (!m) {
      m = MeshBuilder.CreateBox(`lift_${part}`, { size: 1 }, this.scene);
      m.material = this.material(part);
      m.isPickable = false;
      m.checkCollisions = false;
      m.receiveShadows = false;
      m.doNotSyncBoundingInfo = true;
      m.metadata = { part: 'lift', liftParts: part };
      this.meshes.set(part, m);
    }
    return m;
  }

  private refresh(): void {
    const { rooms, floors } = this.opts.getLayout();
    if (rooms === this.roomsRef && floors === this.floorsRef) return;
    this.roomsRef = rooms;
    this.floorsRef = floors;
    this.lifts = liftsOf(rooms, floors);
    this.parts = this.lifts.flatMap((l) => liftParts(l));
    this.signature = '';
  }

  /** The lifts of the layout (play/lifts.js liftsOf). */
  get list(): ReturnType<typeof liftsOf> {
    this.refresh();
    return this.lifts;
  }

  /** The lift whose car holds (x, z) on `floor`, with the floors it serves (the HUD's panel); null: none. */
  at(floor: number, x: number, z: number): LiftInfo | null {
    this.refresh();
    const lift = liftAt(this.lifts, floor, x, z);
    if (!lift) return null;
    const floors = this.opts.getLayout().floors;
    return { id: lift.id, floor, floors: lift.floors.map((f: number) => ({ id: f, name: floors[f]?.name ?? `Floor ${f}` })) };
  }

  /** The car's meshes (tests, perf counts). */
  get carMeshes(): Mesh[] {
    return [...this.meshes.values()];
  }

  /** Each frame: draw again only when the lifts or what is shown changed. */
  update(): void {
    this.refresh();
    const shown = this.parts.filter((p) => this.opts.roomNode(p.roomId)?.isEnabled());
    const sig = shown.map((p) => `${p.roomId}:${p.role}`).join('|') + '#' + this.parts.length;
    if (sig === this.signature) return;
    this.signature = sig;
    const buffers: Record<Part, number[]> = { steel: [], metal: [], light: [] };
    const m = new Matrix();
    for (const p of shown) {
      const node = this.opts.roomNode(p.roomId);
      const y0 = node ? node.getAbsolutePosition().y : 0;
      Matrix.ScalingToRef(p.w, p.h, p.d, m);
      m.setTranslationFromFloats(p.x, y0 + p.y, p.z);
      const out = buffers[p.part as Part];
      for (let i = 0; i < 16; i++) out.push(m.m[i]);
    }
    for (const part of PARTS) {
      const data = buffers[part];
      if (!data.length && !this.meshes.has(part)) continue;
      const mesh = this.mesh(part);
      const count = data.length / 16;
      mesh.thinInstanceSetBuffer('matrix', count ? new Float32Array(data) : null, 16, false);
      if (count) mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.setEnabled(count > 0);
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose(false, false);
    this.meshes.clear();
  }
}
