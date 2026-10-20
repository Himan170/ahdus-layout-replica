/**
 * FloorSystem.ts
 *
 * Which storeys, roofs, ceilings and wall bands show (multi-storey buildings):
 *   planner:  floors up to `level`; its roof is hidden so you see inside
 *   outside:  the whole building with roofs (Preview, not in a room)
 *   inside:   the whole building plus indoor ceilings (Preview, in a room).
 *             The camera stays under the ceiling indoors, so upper floors
 *             don't block the view; you see them through stairwells and windows.
 * Works on the meshes of a RoomSystem and an ObjectSystem.
 */

import { floorsByElevation, coveredFraction } from '../../play/building';
import type { RoomSystem, LayoutRecords, V1Room } from './RoomSystem';
import type { ObjectSystem } from './ObjectSystem';

export interface LevelView {
  mode: 'planner' | 'outside' | 'inside';
  /** The floor id being edited (planner); ignored outside / inside. */
  level: number;
}

const byId = <T extends { id: string }>(records: Record<string, T> | T[]): Record<string, T> =>
  (Array.isArray(records) ? Object.fromEntries(records.map((r) => [r.id, r])) : records);

export class FloorSystem {
  private rooms: RoomSystem;
  private objects: ObjectSystem;
  private getLayout: () => LayoutRecords;
  private view: LevelView = { mode: 'planner', level: 0 };

  constructor(rooms: RoomSystem, objects: ObjectSystem, getLayout: () => LayoutRecords) {
    this.rooms = rooms;
    this.objects = objects;
    this.getLayout = getLayout;
  }

  getView(): LevelView {
    return this.view;
  }

  /** Change what is shown and apply it. */
  setView(view: LevelView): void {
    this.view = view;
    this.apply();
  }

  /** Show the building up to this floor, as Workplace Studio does. */
  setFloor(floorId: number): void {
    this.setView({ mode: 'planner', level: floorId });
  }

  /** Apply the current view to the meshes (after the layout or its meshes changed). */
  apply(): void {
    const layout = this.getLayout();
    const rooms = byId(layout.rooms);
    const objects = byId(layout.objects);
    const sorted = floorsByElevation(layout.floors);
    const rank = new Map(sorted.map((f: { id: number }, i: number) => [f.id, i]));
    const view = this.view;
    const levelRank = view.mode === 'planner' ? (rank.get(view.level) ?? 0) : Infinity;
    const roomsByFloor = new Map<number, V1Room[]>();
    for (const r of Object.values(rooms)) {
      if (!roomsByFloor.has(r.floor)) roomsByFloor.set(r.floor, []);
      roomsByFloor.get(r.floor)!.push(r);
    }
    for (const [roomId, node] of this.rooms.meshes) {
      const room = rooms[roomId];
      if (!room) continue;
      const r = rank.get(room.floor) ?? 0;
      const visible = r <= levelRank;
      node.setEnabled(visible);
      if (!visible) continue;
      const above = sorted[r + 1];
      const covered = above ? coveredFraction(room, roomsByFloor.get(above.id) ?? []) >= 0.9 : false;
      const isCurrent = r === levelRank;
      const showRoof = !covered && !isCurrent;
      const showCeiling = view.mode === 'inside';
      // A room lower than its floor: the wall band closes the gap under the floor above
      const showBand = covered && !isCurrent;
      for (const child of node.getChildMeshes(false)) {
        const part = child.metadata?.part;
        if (part === 'roof') child.setEnabled(showRoof);
        else if (part === 'ceiling') child.setEnabled(showCeiling);
        else if (part === 'band') child.setEnabled(showBand);
      }
    }
    for (const [objId, mesh] of this.objects.meshes) {
      const o = objects[objId];
      if (o) mesh.setEnabled((rank.get(o.floor ?? 0) ?? 0) <= levelRank);
    }
  }
}
