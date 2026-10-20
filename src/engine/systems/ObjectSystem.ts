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
import { createItemMesh, disposeItemMesh } from '../../utils/assetInstances';
import { applyLockVisual, removeLockVisual } from '../../utils/lockIndicator';
import { elevationOf, floorHeight } from '../../play/building';
import type { LayoutRecords } from './RoomSystem';

export interface ObjectSystemOptions {
  /** Bigger items cast soft shadows from this generator. */
  shadowGenerator?: unknown;
}

export class ObjectSystem {
  /** objectId → the item's root node (moved by gizmos; its child is the instance). */
  readonly meshes = new Map<string, TransformNode>();
  private scene: Scene;
  private shadowGenerator: any; // a ShadowGenerator (typed loosely: utils/ is plain JS)

  constructor(scene: Scene, options: ObjectSystemOptions = {}) {
    this.scene = scene;
    this.shadowGenerator = options.shadowGenerator ?? null;
  }

  /** Bring the item meshes up to date with the layout. */
  sync(layout: Pick<LayoutRecords, 'objects' | 'floors'>): void {
    const { floors } = layout;
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
      let mesh = this.meshes.get(obj.id) ?? null;
      if (mesh?.isDisposed()) mesh = null;
      // Stairs climb exactly their floor's height: a taller or lower floor rebuilds them
      const rise = obj.assetType === 'STAIRCASE' ? floorHeight(floors, obj.floor ?? 0) : undefined;
      if (mesh && (mesh.metadata?.rise !== rise || mesh.metadata?.floorId !== (obj.floor ?? 0))) {
        disposeItemMesh(mesh);
        this.meshes.delete(obj.id);
        mesh = null;
      }

      if (!mesh) {
        // An instance of its type's template, tagged for picking. Furniture
        // blocks the character in Preview; markers (spawn points) don't, and
        // stairs are walked ON (Preview computes the slope).
        mesh = createItemMesh(obj.assetType, this.scene, obj.id, {
          rise,
          floorId: obj.floor ?? 0,
          solid: (ASSET_TYPES as Record<string, { category?: string }>)[obj.assetType]?.category !== OBJECT_CATEGORIES.MARKER && obj.assetType !== 'STAIRCASE',
          shadowGenerator: this.shadowGenerator,
        }) as TransformNode;
        this.meshes.set(obj.id, mesh);
      }

      // Transform (the store's height is above the item's own floor)
      mesh.position.x = obj.x;
      mesh.position.y = elevationOf(floors, obj.floor ?? 0) + (obj.y ?? 0);
      mesh.position.z = obj.z;
      mesh.rotation.x = obj.rotationX;
      mesh.rotation.y = obj.rotationY;
      mesh.rotation.z = obj.rotationZ;
      mesh.scaling.x = obj.scaleX;
      mesh.scaling.y = obj.scaleY;
      mesh.scaling.z = obj.scaleZ;

      if (obj.isLocked) applyLockVisual(mesh);
      else removeLockVisual(mesh);
    }
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
