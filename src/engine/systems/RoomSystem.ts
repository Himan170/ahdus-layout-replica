/**
 * RoomSystem.ts
 *
 * The room meshes of a whole layout, every floor at its own height. sync()
 * builds new rooms, rebuilds only the rooms whose build input changed
 * (roomGeometryKey: the room, the rooms touching it, stair holes, nesting),
 * removes deleted ones and outlines the selected room. Used by Workplace
 * Studio and LayoutEngine. Reads layout records with the store's (v1) field
 * names; shared walls and nested rooms: docs/ROOM_FORMAT.md.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

import {
  buildRoomMesh, disposeRoomMesh, setRoomSelected, roomGeometryKey, roomMaterialSteps,
} from '../../utils/roomBuilder';
import {
  elevationOf, floorBelow, stairOpening, roomRect, intersectRects, wallSpace,
} from '../../play/building';
import { roomContainedBy, WALL_THICKNESS } from '../../play/geometry';

/** A record keyed by id (the store) or a plain list. */
export type Records<T> = Record<string, T> | T[];

/** A room as the store keeps it (v1 field names). */
export interface V1Room {
  id: string;
  floor: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  wallHeight?: number;
  color?: string;
  [key: string]: any;
}

/** A placed item as the store keeps it (v1 field names). */
export interface V1Object {
  id: string;
  assetType: string;
  floor?: number;
  x: number;
  y?: number;
  z: number;
  [key: string]: any;
}

/** A floor as the store keeps it: its elevation is derived (play/building.js). */
export interface V1Floor {
  id: number;
  name: string;
  height?: number;
  [key: string]: any;
}

/** What the systems draw: the store's rooms, objects and floors (or the same shape). */
export interface LayoutRecords {
  rooms: Records<V1Room>;
  objects: Records<V1Object>;
  floors: Record<string | number, V1Floor>;
}

export interface RoomSystemOptions {
  /** Room parts cast and receive shadows from this generator. */
  shadowGenerator?: unknown;
}

/** A slice's time budget (play/buildSchedule.createBudget): take() before each build. */
export interface BuildBudget {
  take(): boolean;
  hasTime(): boolean;
  readonly unlimited: boolean;
}

export interface SyncOptions {
  /** Only build / rebuild rooms on these floors (deletions and outlines still apply everywhere). */
  floors?: number[];
  /** Stop building when it runs out; what is left is counted in `pending`. */
  budget?: BuildBudget;
}

const NEAR = 0.005;

/**
 * Stairwell openings for a room: stairs coming up from the floor below cut its
 * floor; stairs going up from its own floor cut its ceiling (and roof). World rects.
 */
export function stairHolesFor(room: V1Room, stairs: V1Object[], floors: LayoutRecords['floors']) {
  const rect = roomRect(room);
  const below = floorBelow(floors, room.floor);
  const holes = (floorId: number) => stairs
    .filter((s) => s.floor === floorId)
    .map((s) => stairOpening(s))
    .filter((o) => intersectRects(o, rect));
  return {
    floorHoles: below ? holes(below.id) : [],
    ceilingHoles: holes(room.floor),
  };
}

/** Floor / ceiling cutouts under rooms nested inside this one (to the outside of their walls). */
const nestedCutouts = (nestedRooms: V1Room[]) => nestedRooms.map((nested) => ({
  x0: nested.x - nested.width / 2 - WALL_THICKNESS / 2,
  x1: nested.x + nested.width / 2 + WALL_THICKNESS / 2,
  z0: nested.z - nested.depth / 2 - WALL_THICKNESS / 2,
  z1: nested.z + nested.depth / 2 + WALL_THICKNESS / 2,
}));

export class RoomSystem {
  /** roomId → the room's root node (its parts are children). */
  readonly meshes = new Map<string, TransformNode>();
  private scene: Scene;
  private shadowGenerator: unknown;

  constructor(scene: Scene, options: RoomSystemOptions = {}) {
    this.scene = scene;
    this.shadowGenerator = options.shadowGenerator ?? null;
  }

  /**
   * Bring the meshes up to date with the layout and outline `selectedRoomId`.
   * With `floors` / `budget` (progressive loading, engine/systems/SceneBuilder):
   * only rooms on those floors are built, until the budget runs out.
   * @returns how many rooms were (re)built, how long it took (ms), how many
   *   rooms on those floors are not built yet, and whether every room on them
   *   was checked and is up to date (`complete`; a built room is not checked
   *   once the time is up)
   */
  sync(layout: LayoutRecords, selectedRoomId: string | null = null, options: SyncOptions = {}):
    { rebuilt: number; ms: number; pending: number; complete: boolean } {
    const start = performance.now();
    const { floors } = layout;
    const onlyFloors = options.floors ? new Set(options.floors) : null;
    const budget = options.budget ?? null;
    const allRooms = Object.values(layout.rooms);
    const stairs = Object.values(layout.objects).filter((o) => o.assetType === 'STAIRCASE');
    const roomsByFloor = new Map<number, V1Room[]>();
    for (const room of allRooms) {
      if (!roomsByFloor.has(room.floor)) roomsByFloor.set(room.floor, []);
      roomsByFloor.get(room.floor)!.push(room);
    }

    // Remove meshes of rooms that no longer exist
    const currentIds = new Set(allRooms.map((r) => r.id));
    for (const [id, node] of this.meshes) {
      if (!currentIds.has(id)) {
        if (!node.isDisposed()) disposeRoomMesh(node);
        this.meshes.delete(id);
      }
    }

    // Add or rebuild each room
    let rebuilt = 0;
    let pending = 0;
    let unchecked = 0;
    for (const room of allRooms) {
      if (onlyFloors && !onlyFloors.has(room.floor)) continue;
      const existing = this.meshes.get(room.id);
      // Out of time: count what is left (a built room is checked next time)
      if (budget && !budget.hasTime()) {
        if (!existing || existing.isDisposed()) pending++;
        else unchecked++;
        continue;
      }
      const sameFloorRooms = roomsByFloor.get(room.floor) ?? [room];
      const nestedRooms = sameFloorRooms.filter((other) =>
        other.id !== room.id && roomContainedBy(room, other));
      const containers = sameFloorRooms.filter((other) =>
        other.id !== room.id && roomContainedBy(other, room));
      const buildOptions = {
        elevation: elevationOf(floors, room.floor),
        hasSlab: floorBelow(floors, room.floor) !== null,
        storeyTop: wallSpace(floors, room.floor),
        rooms: sameFloorRooms,
        floorSurfaceHoles: nestedCutouts(nestedRooms),
        ceilingSurfaceHoles: nestedCutouts(nestedRooms.filter((nested) =>
          (nested.wallHeight ?? room.wallHeight ?? 3) >= (room.wallHeight ?? 3) - NEAR)),
        // inside another room: walls drawn 1 cm in, and no roof of its own under a room as tall
        nested: containers.length > 0,
        roofCovered: containers.some((outer) => (outer.wallHeight ?? 3) >= (room.wallHeight ?? 3) - NEAR),
        ...stairHolesFor(room, stairs, floors),
      };
      const key = roomGeometryKey(room, buildOptions);

      if (existing && !existing.isDisposed() && existing.metadata?._geometryKey === key) continue; // unchanged
      if (budget && !budget.take()) {
        // the old mesh (if any) stays until there is time to rebuild it
        if (existing && !existing.isDisposed()) unchecked++;
        else pending++;
        continue;
      }
      if (existing) {
        if (!existing.isDisposed()) disposeRoomMesh(existing);
        this.meshes.delete(room.id);
      }

      const node = buildRoomMesh(
        { ...room, isSelected: room.id === selectedRoomId },
        this.scene,
        { shadowGenerator: this.shadowGenerator, ...buildOptions },
      );
      node.metadata!._geometryKey = key;
      this.meshes.set(room.id, node);
      rebuilt++;
    }

    // Selection outline: the selected room's parts, and its walls shared with
    // (and so built by) a neighbour
    const selectedColor = allRooms.find((r) => r.id === selectedRoomId)?.color;
    for (const node of this.meshes.values()) {
      if (onlyFloors && !onlyFloors.has(node.metadata?.floorId)) continue;
      setRoomSelected(node, selectedRoomId ?? null, selectedColor);
    }
    return { rebuilt, ms: performance.now() - start, pending, complete: pending === 0 && unchecked === 0 };
  }

  /**
   * The materials the rooms on these floors use, as steps that each make one
   * (progressive loading: painting a texture is the slow part of the first room).
   */
  materialSteps(layout: LayoutRecords, floors?: number[]): (() => void)[] {
    const only = floors ? new Set(floors) : null;
    const rooms = Object.values(layout.rooms).filter((r) => !only || only.has(r.floor));
    return roomMaterialSteps(this.scene, rooms);
  }

  getRoomMesh(roomId: string): TransformNode | null {
    return this.meshes.get(roomId) ?? null;
  }

  /** Dispose every room mesh (materials are shared and stay). */
  disposeAll(): void {
    for (const node of this.meshes.values()) if (!node.isDisposed()) disposeRoomMesh(node);
    this.meshes.clear();
  }
}
