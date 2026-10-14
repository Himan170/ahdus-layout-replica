import { Scene } from '@babylonjs/core/scene';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

export interface ObjectData {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  assetUrl?: string;
  metadata?: Record<string, unknown>;
}

export class ObjectSystem {
  private scene: Scene;
  private meshMap: Map<string, AbstractMesh> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Load or create an object mesh and add it to the scene */
  addObject(obj: ObjectData): void {
    // TODO: Create or import mesh based on obj.assetUrl, apply transforms, store in meshMap
  }

  /** Remove an object mesh from the scene by id */
  removeObject(id: string): void {
    // TODO: Dispose mesh from meshMap, remove entry
  }

  /** Patch properties on an existing object */
  updateObject(id: string, patch: Partial<ObjectData>): void {
    // TODO: Look up mesh in meshMap, apply position/rotation/scale/metadata changes
  }

  /** Return the mesh instance for a given object id */
  getObjectMesh(id: string): AbstractMesh | undefined {
    // TODO: Return mesh from meshMap
    return this.meshMap.get(id);
  }

  /** Apply highlight effect to an object */
  highlightObject(id: string): void {
    // TODO: Add highlight layer or outline to the mesh
  }

  /** Remove highlight effect from an object */
  clearHighlight(id: string): void {
    // TODO: Remove highlight layer or outline from the mesh
  }

  /** Dispose all managed object meshes */
  disposeAll(): void {
    // TODO: Iterate meshMap, dispose each mesh, clear the map
  }
}
