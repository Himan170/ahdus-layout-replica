import { Scene } from '@babylonjs/core/scene';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

export interface RoomData {
  id: string;
  name: string;
  floorId: string;
  vertices: Array<{ x: number; z: number }>;
  height: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

export class RoomSystem {
  private scene: Scene;
  private meshMap: Map<string, AbstractMesh> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Create room geometry from vertices and add to scene */
  addRoom(room: RoomData): void {
    // TODO: Extrude polygon from room.vertices, apply material/color, store in meshMap
  }

  /** Remove a room mesh from the scene by id */
  removeRoom(id: string): void {
    // TODO: Dispose mesh from meshMap, remove entry
  }

  /** Patch properties on an existing room */
  updateRoom(id: string, patch: Partial<RoomData>): void {
    // TODO: Look up mesh in meshMap, rebuild geometry or update material as needed
  }

  /** Return the mesh instance for a given room id */
  getRoomMesh(id: string): AbstractMesh | undefined {
    // TODO: Return mesh from meshMap
    return this.meshMap.get(id);
  }

  /** Toggle visual selection state on a room */
  setRoomSelected(id: string, selected: boolean): void {
    // TODO: Apply or remove selection highlight/outline on room mesh
  }

  /** Dispose all managed room meshes */
  disposeAll(): void {
    // TODO: Iterate meshMap, dispose each mesh, clear the map
  }
}
