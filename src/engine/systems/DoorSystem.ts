/**
 * DoorSystem.ts (v0.18.1): the leaves of room doors, drawn apart from the rooms' merged meshes.
 *
 * Four unit boxes with thin instances (wood, steel, glass, metal), so every door of the building is at most four
 * draw calls. Not pickable, no collisions, no shadows: a doorway stays an opening for clicks, walking and the walk
 * map. Which doors exist, where their leaves are and when they open: PURE play/doorSwing.js.
 *   - `studio()` true (Studio's planner): every door half open, so editors see the swing.
 *   - else each frame: the doors near people who move open (at most MAX_ANIMATED_DOORS, the walker's first), on the
 *     floor shown only, and close behind them.
 * A door shows while the room that builds it (or its neighbour) is shown (FloorSystem, Layers).
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { layoutDoors, doorParts, createDoorAnimator, STUDIO_OPEN } from '../../play/doorSwing';
import { getAssetMaterial, getMaterials } from '../../utils/materialLibrary';

export interface DoorMover {
  id: string;
  x: number;
  z: number;
  floor: number;
  /** The walker on this page (free walking, Take me there, the tour): their doors come first. */
  local?: boolean;
  speed?: number;
}

export interface DoorSystemOptions {
  getLayout: () => { rooms: Record<string, unknown> | unknown[] };
  roomNode: (roomId: string) => TransformNode | null;
  /** People who walk (never the seated ones). */
  movers?: () => DoorMover[];
  /** The floor whose doors open (the walker's, the one shown from above); null = every floor. */
  shownFloor?: () => number | null;
  /** Studio's planner view: every door half open, nothing moves. */
  studio?: () => boolean;
}

type Part = 'wood' | 'steel' | 'glass' | 'metal';
const PARTS: Part[] = ['wood', 'steel', 'glass', 'metal'];

interface Door {
  key: string;
  roomId: string;
  otherRoomId: string | null;
  floor: number;
  style: string;
  centre: { x: number; z: number };
  [k: string]: unknown;
}

export class DoorSystem {
  private scene: Scene;
  private opts: DoorSystemOptions;
  private meshes = new Map<Part, Mesh>();
  private doors: Door[] = [];
  private roomsRef: unknown = null;
  private animator = createDoorAnimator();
  private opens = new Map<string, number>();
  private signature = '';

  constructor(scene: Scene, opts: DoorSystemOptions) {
    this.scene = scene;
    this.opts = opts;
  }

  private material(part: Part): Material {
    if (part === 'glass') return getMaterials(this.scene).glass() as Material;
    if (part === 'wood') return getAssetMaterial(this.scene, 'matte', '#9a6a44') as Material;
    if (part === 'steel') return getAssetMaterial(this.scene, 'gloss', '#6f7a75') as Material;
    return getAssetMaterial(this.scene, 'metal', '#b8bec4') as Material;
  }

  private mesh(part: Part): Mesh {
    let m = this.meshes.get(part);
    if (!m) {
      m = MeshBuilder.CreateBox(`door_leaves_${part}`, { size: 1 }, this.scene);
      m.material = this.material(part);
      m.isPickable = false;
      m.checkCollisions = false;
      m.receiveShadows = false;
      m.doNotSyncBoundingInfo = true;
      m.metadata = { part: 'door-leaf', doorLeaves: part };
      this.meshes.set(part, m);
    }
    return m;
  }

  /** Every doorway (one per shared door), as play/doorSwing gives them. */
  get list(): Door[] {
    this.refresh();
    return this.doors;
  }

  /** How open a door is now (0 shut … 1 open); Studio: STUDIO_OPEN. */
  openOf(key: string): number {
    if (this.opts.studio?.()) return STUDIO_OPEN;
    return this.opens.get(key) ?? 0;
  }

  /** Doors that are not shut now (opening, open or closing). */
  get animated(): number {
    return this.opts.studio?.() ? 0 : this.animator.animated;
  }

  /** The door leaves' meshes (tests, perf counts). */
  get leafMeshes(): Mesh[] {
    return [...this.meshes.values()];
  }

  private refresh(): void {
    const rooms = this.opts.getLayout().rooms;
    if (rooms === this.roomsRef) return;
    this.roomsRef = rooms;
    this.doors = layoutDoors(rooms) as Door[];
    this.signature = ''; // draw again
  }

  private shown(door: Door): boolean {
    const own = this.opts.roomNode(door.roomId);
    if (own?.isEnabled()) return true;
    const other = door.otherRoomId ? this.opts.roomNode(door.otherRoomId) : null;
    return !!other?.isEnabled();
  }

  private baseY(door: Door): number | null {
    const node = this.opts.roomNode(door.roomId) ?? (door.otherRoomId ? this.opts.roomNode(door.otherRoomId) : null);
    return node ? node.getAbsolutePosition().y : null;
  }

  /** Each frame (dt in seconds). */
  update(dt: number): void {
    this.refresh();
    const studio = !!this.opts.studio?.();
    if (studio) {
      this.animator.reset();
      this.opens.clear();
    } else {
      const floor = this.opts.shownFloor?.() ?? null;
      const doors = floor == null ? this.doors : this.doors.filter((d) => d.floor === floor);
      this.opens = this.animator.update(dt, doors, this.opts.movers?.() ?? []);
    }
    const visible = this.doors.filter((d) => this.shown(d));
    const sig = (studio ? 's' : 'w') + visible.map((d) => `${d.key}@${(studio ? STUDIO_OPEN : this.opens.get(d.key) ?? 0).toFixed(3)}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.draw(visible, studio);
  }

  private draw(visible: Door[], studio: boolean): void {
    const buffers: Record<Part, number[]> = { wood: [], steel: [], glass: [], metal: [] };
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const t = new Vector3();
    for (const door of visible) {
      const y0 = this.baseY(door);
      if (y0 == null) continue;
      const open = studio ? STUDIO_OPEN : this.opens.get(door.key) ?? 0;
      for (const p of doorParts(door, open) as { part: Part; x: number; y: number; z: number; w: number; h: number; d: number; rotY: number }[]) {
        s.set(p.w, p.h, p.d);
        t.set(p.x, y0 + p.y, p.z);
        Quaternion.RotationYawPitchRollToRef(p.rotY, 0, 0, q);
        Matrix.ComposeToRef(s, q, t, m);
        const out = buffers[p.part];
        for (let i = 0; i < 16; i++) out.push(m.m[i]);
      }
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
    this.animator.reset();
  }
}
