/**
 * model/migrate.ts
 *
 * Converts a v1 layout (the shape produced by workspaceStore.exportWorkspace())
 * to v2 (LayoutSchema), and validates everything that comes in.
 *
 * v1 field names that differ from v2:
 *   room.floor        → floorId          object.floor     → floorId
 *   room.doors[]      → openings[]       object.isLocked  → locked
 *   object.name       → label (if no label)
 *   object.scaleX/Y/Z → scale {x,y,z}
 *   object.rotationX/Z, category → kept in metadata (v2 has no field for them)
 */

import { v4 as uuid } from 'uuid';
import {
  LayoutSchema,
  RoomTypeSchema,
  type Layout,
  type Floor,
  type Room,
  type RoomType,
  type LayoutObject,
  type Opening,
} from './schema';
import { syncAnchors } from './anchors';

/** Shape of the v1 state blob saved by the current apiService */
interface V1State {
  layoutName?: string;
  companyId?: string;
  layoutId?: string;
  // height = floor-to-floor (current saves); elevation = what saves from before floor heights kept
  floors?: Record<string | number, { id: number | string; name: string; height?: number; elevation?: number }>;
  // exportWorkspace() saves arrays; the live store uses id-keyed records. Accept both.
  rooms?: Record<string, any> | any[];
  objects?: Record<string, any> | any[];
  /** Data other modules wrote onto anchors: { [anchorId]: { positionRef?, label? } } */
  anchorData?: Record<string, { positionRef?: string; label?: string }>;
  [key: string]: unknown;
}

/**
 * Detect the schema version of a raw JSON blob.
 * v2 payloads have `schemaVersion: 2`. Everything else is v1.
 */
export function detectVersion(data: unknown): 1 | 2 {
  if (
    typeof data === 'object' &&
    data !== null &&
    'schemaVersion' in data &&
    (data as any).schemaVersion === 2
  ) {
    return 2;
  }
  return 1;
}

const VALID_ROOM_TYPES = new Set<string>(RoomTypeSchema.options);

function mapRoomType(v1Type?: string): RoomType {
  if (!v1Type) return 'CUSTOM';
  const upper = v1Type.toUpperCase();
  return VALID_ROOM_TYPES.has(upper) ? (upper as RoomType) : 'CUSTOM';
}

/**
 * Migrate a v1 state blob to v2 Layout format.
 * Fields v2 has no slot for are preserved in LayoutObject.metadata.
 */
export function migrateV1toV2(v1: V1State): Layout {
  // ── Floors ──
  // The editor keeps a floor-to-floor `height` per floor and derives elevations
  // (stacked in id order); saves from before that kept an `elevation` instead.
  let base = 0;
  const floors: Floor[] = Object.values(v1.floors ?? {})
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((f) => {
      const height = typeof f.height === 'number' ? f.height : 3.5;
      const elevation = typeof f.height === 'number' ? base : f.elevation ?? 0;
      base = elevation + height;
      return { id: f.id, name: f.name ?? 'Floor', elevation: Math.round(elevation * 100) / 100, height };
    });
  if (floors.length === 0) {
    floors.push({ id: 0, name: 'Ground Floor', elevation: 0, height: 3.5 });
  }

  // ── Rooms + doors ──
  const rooms: Room[] = [];
  const openings: Opening[] = [];

  for (const r of Object.values(v1.rooms ?? {})) {
    const room: Room = {
      id: String(r.id ?? uuid()),
      floorId: r.floor ?? r.floorId ?? 0,
      name: r.name ?? '',
      type: mapRoomType(r.type),
      x: r.x ?? 0,
      z: r.z ?? 0,
      width: r.width ?? 4,
      depth: r.depth ?? 4,
      wallHeight: r.wallHeight ?? 3,
      color: r.color ?? '#4a90d9',
      floorFinish: 'default',
    };
    rooms.push(room);

    if (Array.isArray(r.windows)) {
      r.windows.forEach((w: any, i: number) => {
        openings.push({
          id: String(w.id ?? `${room.id}_window_${w.wall ?? 'north'}_${i}`),
          roomId: room.id,
          kind: 'window',
          wall: w.wall ?? 'north',
          offset: w.offset ?? 0,
          width: w.width ?? 1.4,
          height: w.height ?? 1.2,
          sillHeight: w.sill ?? 0.9,
        });
      });
    }

    if (Array.isArray(r.doors)) {
      r.doors.forEach((door: any, i: number) => {
        openings.push({
          // Deterministic so reloading the same v1 data gives the same IDs
          id: String(door.id ?? `${room.id}_door_${door.wall ?? 'north'}_${i}`),
          roomId: room.id,
          kind: 'door',
          wall: door.wall ?? 'north',
          offset: door.offset ?? 0,
          width: door.width ?? 1,
          height: door.height ?? 2.1,
          sillHeight: 0,
        });
      });
    }
  }

  // ── Objects ──
  const objects: LayoutObject[] = Object.values(v1.objects ?? {}).map((o) => {
    const extra: Record<string, unknown> = { ...(o.metadata ?? {}) };
    if (o.rotationX) extra.rotationX = o.rotationX;
    if (o.rotationZ) extra.rotationZ = o.rotationZ;
    if (o.category) extra.category = o.category;

    return {
      id: String(o.id ?? uuid()),
      floorId: o.floor ?? o.floorId ?? 0,
      roomId: o.roomId ?? null,
      assetType: o.assetType ?? 'DESK_STANDARD',
      x: o.x ?? 0,
      y: o.y ?? 0,
      z: o.z ?? 0,
      rotationY: o.rotationY ?? 0,
      scale: {
        x: o.scaleX ?? o.scale?.x ?? 1,
        y: o.scaleY ?? o.scale?.y ?? 1,
        z: o.scaleZ ?? o.scale?.z ?? 1,
      },
      label: o.label || o.name || '',
      department: o.department ?? '',
      locked: o.isLocked ?? o.locked ?? false,
      metadata: Object.keys(extra).length ? extra : undefined,
    };
  });

  const layout: Layout = {
    schemaVersion: 2,
    units: 'meters',
    building: { name: v1.layoutName ?? '', address: '', northAngle: 0 },
    floors,
    rooms,
    openings,
    objects,
    anchors: [],
    routes: [],
    floorLinks: [],
  };
  // Generate anchors, then apply what other modules saved on them (positionRef, label)
  const saved = v1.anchorData ?? {};
  layout.anchors = syncAnchors(layout).map((a) => {
    const d = saved[a.id];
    if (!d) return a;
    return {
      ...a,
      ...(d.positionRef ? { positionRef: d.positionRef } : {}),
      ...(d.label ? { label: d.label } : {}),
    };
  });
  return layout;
}

/**
 * Load layout from any version, always returning a VALIDATED v2 layout.
 * Throws a ZodError with a readable path (e.g. "objects.3.x: Expected number")
 * if the data is corrupt, instead of letting bad data reach the renderer.
 */
export function loadLayout(data: unknown): Layout {
  const v2 = detectVersion(data) === 2 ? data : migrateV1toV2(data as V1State);
  const layout = LayoutSchema.parse(v2);
  // Re-sync so anchors always match object positions, even if the saved
  // file was edited by hand or saved by an older build.
  layout.anchors = syncAnchors(layout);
  return layout;
}
