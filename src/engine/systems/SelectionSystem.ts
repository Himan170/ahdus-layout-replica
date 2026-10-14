import { Scene } from '@babylonjs/core/scene';

export type EntityType = 'object' | 'room' | 'floor';
export type GizmoMode = 'position' | 'rotation' | 'scale' | 'none';

export interface SelectionState {
  entityId: string;
  entityType: EntityType;
}

export class SelectionSystem {
  private scene: Scene;
  private currentSelection: SelectionState | null = null;
  private currentGizmoMode: GizmoMode = 'none';

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Select an entity by id and type, attaching the active gizmo */
  select(entityId: string, entityType: EntityType): void {
    // TODO: Store selection, find mesh via ObjectSystem/RoomSystem, attach gizmo
  }

  /** Clear the current selection and detach gizmos */
  deselect(): void {
    // TODO: Remove gizmo from current mesh, clear currentSelection
  }

  /** Return the current selection state, or null if nothing selected */
  getSelection(): SelectionState | null {
    // TODO: Return currentSelection
    return this.currentSelection;
  }

  /** Switch gizmo mode (position, rotation, scale, or none) */
  setGizmoMode(mode: GizmoMode): void {
    // TODO: Dispose current gizmo, create new one for mode, attach to selected mesh
  }

  /** Dispose gizmo manager and clean up event listeners */
  dispose(): void {
    // TODO: Dispose gizmo manager, remove pointer observers
  }
}
