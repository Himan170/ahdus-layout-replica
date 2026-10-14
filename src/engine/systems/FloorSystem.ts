import { Scene } from '@babylonjs/core/scene';

export class FloorSystem {
  private scene: Scene;
  private currentFloorId: string | null = null;
  private floorVisibility: Map<string, boolean> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Set the active floor, hiding all others and showing this one */
  setFloor(floorId: string): void {
    // TODO: Hide meshes for all floors except floorId, update currentFloorId
  }

  /** Return the currently active floor id, or null */
  getCurrentFloor(): string | null {
    // TODO: Return currentFloorId
    return this.currentFloorId;
  }

  /** Show all meshes belonging to a specific floor */
  showFloor(id: string): void {
    // TODO: Find meshes tagged with floor id, set isVisible=true, update floorVisibility map
  }

  /** Hide all meshes belonging to a specific floor */
  hideFloor(id: string): void {
    // TODO: Find meshes tagged with floor id, set isVisible=false, update floorVisibility map
  }
}
