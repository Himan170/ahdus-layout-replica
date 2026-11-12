/**
 * ObjectSystem.ts
 *
 * The meshes of placed items (furniture, machines, stairs, markers) on every
 * floor. sync() creates new items (instances of one template per asset type,
 * utils/assetInstances.js), moves changed ones, rebuilds stairs when their
 * floor's height changes and removes deleted ones. Used by Workplace Studio
 * and LayoutEngine. Reads layout records with the store's (v1) field names.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

import { ASSET_TYPES, OBJECT_CATEGORIES } from '../../utils/assetCatalog';
import { createItemMesh, disposeItemMesh, setItemSolid } from '../../utils/assetInstances';
import { isWallItem, hangsOnWall } from '../../play/wallMount';
import { applyLockVisual, removeLockVisual } from '../../utils/lockIndicator';
import { elevationOf, floorHeight, stairDrawn } from '../../play/building';
import type { LayoutRecords, SyncOptions } from './RoomSystem';

export interface ObjectSystemOptions {
  /** Bigger items cast soft shadows from this generator. */
  shadowGenerator?: unknown;
}

export class ObjectSystem {
  /** objectId → the item's root node (moved by gizmos; its child is the instance). */
  readonly meshes = new Map<string, TransformNode>();
  private scene: Scene;
  private shadowGenerator: any; // a ShadowGenerator (typed loosely: utils/ is plain JS)
  /** Item types not shown (LayoutEngine outside edit mode: the spawn point). */
  private hiddenTypes = new Set<string>();

  constructor(scene: Scene, options: ObjectSystemOptions = {}) {
    this.scene = scene;
    this.shadowGenerator = options.shadowGenerator ?? null;
  }

  /**
   * Bring the item meshes up to date with the layout. With `floors` / `budget`
   * (progressive loading): only items on those floors, new ones until the
   * budget runs out (moving or locking a built item never waits).
   * @returns how many items were made, and how many on those floors still wait
   */
  sync(layout: Pick<LayoutRecords, 'objects' | 'floors'>, options: SyncOptions = {}): { built: number; pending: number } {
    const { floors } = layout;
    const onlyFloors = options.floors ? new Set(options.floors) : null;
    const budget = options.budget ?? null;
    let built = 0;
    let pending = 0;
    const allObjects = Object.values(layout.objects);
    const currentIds = new Set(allObjects.map((o) => o.id));

    // Remove meshes of deleted items (their template and materials are shared and stay)
    for (const [id, mesh] of this.meshes) {
      if (!currentIds.has(id)) {
        disposeItemMesh(mesh);
        this.meshes.delete(id);
      }
    }

    for (const obj of allObjects) {
      if (onlyFloors && !onlyFloors.has(obj.floor ?? 0)) continue;
      let mesh = this.meshes.get(obj.id) ?? null;
      if (mesh?.isDisposed()) mesh = null;
      // Stairs climb exactly their floor's height: a taller or lower floor rebuilds them
      const rise = obj.assetType === 'STAIRCASE' ? floorHeight(floors, obj.floor ?? 0) : undefined;
      const stale = !!mesh && (mesh.metadata?.rise !== rise || mesh.metadata?.floorId !== (obj.floor ?? 0));
      if ((!mesh || stale) && budget && !budget.take()) {
        pending++; // made in a later slice (a stale one keeps its old mesh until then)
        if (!mesh) continue;
      } else if (stale) {
        disposeItemMesh(mesh!);
        this.meshes.delete(obj.id);
        mesh = null;
      }

      if (!mesh) {
        built++;
        // An instance of its type's template, tagged for picking. Furniture
        // blocks the character in Preview; markers (spawn points) and rugs
        // don't, and stairs are walked ON (Preview computes the slope).
        const def = (ASSET_TYPES as Record<string, { category?: string; solid?: boolean }>)[obj.assetType];
        mesh = createItemMesh(obj.assetType, this.scene, obj.id, {
          rise,
          floorId: obj.floor ?? 0,
          solid: def?.category !== OBJECT_CATEGORIES.MARKER && def?.solid !== false && obj.assetType !== 'STAIRCASE',
          shadowGenerator: this.shadowGenerator,
        }) as TransformNode;
        this.meshes.set(obj.id, mesh);
      }

      // Transform (the store's height is above the item's own floor). Stairs are drawn exactly as
      // they are walked on (building.stairDrawn): on their floor, level, as high as the floor.
      const drawn = obj.assetType === 'STAIRCASE'
        ? stairDrawn(floors, obj)
        : {
          y: elevationOf(floors, obj.floor ?? 0) + (obj.y ?? 0), rotationX: obj.rotationX, rotationZ: obj.rotationZ,
          scaleX: obj.scaleX, scaleY: obj.scaleY, scaleZ: obj.scaleZ,
        };
      mesh.position.x = obj.x;
      mesh.position.y = drawn.y;
      mesh.position.z = obj.z;
      mesh.rotation.x = drawn.rotationX;
      mesh.rotation.y = obj.rotationY;
      mesh.rotation.z = drawn.rotationZ;
      mesh.scaling.x = drawn.scaleX;
      mesh.scaling.y = drawn.scaleY;
      mesh.scaling.z = drawn.scaleZ;

      // v0.15.6: a wall item hung on a wall is no obstacle (walking past a wall TV); on the floor it is
      if (isWallItem(obj.assetType)) setItemSolid(mesh, !hangsOnWall(obj));

      if (obj.isLocked) applyLockVisual(mesh);
      else removeLockVisual(mesh);
    }
    return { built, pending };
  }

  /**
   * Item types to keep hidden (built, but never enabled: FloorSystem.apply
   * reads isShown). Call FloorSystem.apply() after it. [] shows every type.
   */
  setHiddenTypes(types: string[]): void {
    this.hiddenTypes = new Set(types);
  }

  /** Is this item's type shown at all (FloorSystem still decides per floor)? */
  isShown(obj: { assetType: string }): boolean {
    return !this.hiddenTypes.has(obj.assetType);
  }

  getObjectMesh(objectId: string): TransformNode | null {
    return this.meshes.get(objectId) ?? null;
  }

  /** Dispose every item mesh (templates and materials are shared and stay). */
  disposeAll(): void {
    for (const mesh of this.meshes.values()) disposeItemMesh(mesh);
    this.meshes.clear();
  }
}
