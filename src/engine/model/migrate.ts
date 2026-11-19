/**
 * model/migrate.ts
 *
 * Converts a v1 layout (the shape produced by workspaceStore.exportWorkspace())
 * to v2 (LayoutSchema), and validates everything that comes in.
 *
 * v1 field names that differ from v2:
 *   room.floor        → floorId          object.floor     → floorId
 *   room.doors[]      → openings[]       object.isLocked  → locked
 *   room.isLocked     → locked (v0.15.6; only when true)
 *   object.name       → label (if no label)
 *   object.scaleX/Y/Z → scale {x,y,z}
 *   object.rotationX/Z, category → kept in metadata (v2 has no field for them;
 *                       no category means 'Furniture')
 *   object.name (if not the label) → metadata.name
 * model/toV1.ts converts back.
 */

import { v4 as uuid } from 'uuid';
import {
  LayoutSchema,
  ROOM_TYPE_LIST,
  type Layout,
  type Floor,
  type Room,
  type RoomType,
  type LayoutObject,
  type Opening,
  type Anchor,
} from './schema';
import { syncAnchors } from './anchors';
import { fileRoomType, cleanGlassWalls } from './roomTypes';

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
  anchors?: Layout['anchors'];
  routes?: Layout['routes'];
  floorLinks?: Layout['floorLinks'];
  /** Data other modules wrote onto anchors: { [anchorId]: { positionRef?, label? } } */
  anchorData?: Record<string, { positionRef?: string; label?: string }>;
  /** Check my layout: the keys of the problems marked "Ignore" */
  ignoredChecks?: string[];
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

const VALID_ROOM_TYPES = new Set<string>(ROOM_TYPE_LIST);

function mapRoomType(v1Type?: string): RoomType {
  if (!v1Type) return 'CUSTOM';
  const upper = v1Type.toUpperCase();
  return VALID_ROOM_TYPES.has(upper) ? (upper as RoomType) : 'CUSTOM';
}

/** v0.18.1: a room's type as a v2 file says it (newer types: the nearest older type + subtype; roomTypes.ts). */
function roomTypeFields(v1Type?: string, v1Subtype?: unknown): { type: RoomType; subtype?: string } {
  const { type, subtype } = fileRoomType(v1Type ?? '');
  if (subtype) return { type: mapRoomType(type), subtype };
  // a v1 file written with { type: fallback, subtype } (an exported Studio file) keeps its subtype
  const kept = fileRoomType(v1Subtype).subtype;
  return { type: mapRoomType(v1Type), ...(kept ? { subtype: kept } : {}) };
}

/** v0.18.1: a door's / window's style and swing, only when set (missing = the default). */
function openingExtras(o: any): { style?: string; swing?: 'in' | 'out' } {
  return {
    ...(typeof o?.style === 'string' && o.style && o.style.length <= 40 ? { style: o.style } : {}),
    ...(o?.swing === 'in' || o?.swing === 'out' ? { swing: o.swing } : {}),
  };
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
      ...roomTypeFields(r.type, r.subtype),
      x: r.x ?? 0,
      z: r.z ?? 0,
      width: r.width ?? 4,
      depth: r.depth ?? 4,
      wallHeight: r.wallHeight ?? 3,
      wallThickness: typeof r.wallThickness === 'number' && r.wallThickness >= 0.1 && r.wallThickness <= 0.6
        ? r.wallThickness : 0.15,
      color: r.color ?? '#4a90d9',
      floorFinish: typeof r.floorFinish === 'string' ? r.floorFinish : 'default',
      ...(typeof r.departmentRef === 'string' ? { departmentRef: r.departmentRef } : {}),
      ...((r.isLocked ?? r.locked) ? { locked: true } : {}),
      ...(cleanGlassWalls(r.glassWalls).length ? { glassWalls: cleanGlassWalls(r.glassWalls) as Room['glassWalls'] } : {}),
      ...(r.glassOnFirstDoor === true ? { glassOnFirstDoor: true } : {}),
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
          ...openingExtras(w),
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
          ...openingExtras(door),
        });
      });
    }
  }

  // ── Objects ──
  const objects: LayoutObject[] = Object.values(v1.objects ?? {}).map((o) => {
    const extra: Record<string, unknown> = { ...(o.metadata ?? {}) };
    if (o.rotationX) extra.rotationX = o.rotationX;
    if (o.rotationZ) extra.rotationZ = o.rotationZ;
    // 'Furniture' is the store's default: no category in v2 means it (toV1)
    if (o.category && o.category !== 'Furniture') extra.category = o.category;
    // The store's auto name ("DESK_STANDARD 1"): kept when it isn't the label,
    // so toV1 gives it back and an empty label stays empty
    if (typeof o.name === 'string' && o.name && o.name !== o.label) extra.name = o.name;

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
    routes: (v1.routes ?? []) as Layout['routes'],
    floorLinks: (v1.floorLinks ?? []) as Layout['floorLinks'],
    ...(Array.isArray(v1.ignoredChecks) && v1.ignoredChecks.length
      ? { ignoredChecks: v1.ignoredChecks.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 300).slice(0, 500) }
      : {}),
  };
  // Regenerate object anchors at current positions while retaining extension
  // fields and manual anchors from saves that already used the v2 anchor shape.
  const saved = v1.anchorData ?? {};
  const priorAnchorValue = v1.anchors ?? [];
  const priorAnchors = Array.isArray(priorAnchorValue) ? priorAnchorValue : [];
  const priorById = new Map(
    priorAnchors
      .filter((anchor): anchor is Anchor => !!anchor && typeof anchor === 'object')
      .map((anchor) => [anchor.id, anchor]),
  );
  const generated = syncAnchors(layout).map((a) => {
    const previous = priorById.get(a.id);
    const d = saved[a.id];
    if (!d) return { ...previous, ...a };
    return {
      ...previous,
      ...a,
      ...(d.positionRef ? { positionRef: d.positionRef } : {}),
      ...(d.label ? { label: d.label } : {}),
    };
  });
  const generatedIds = new Set(generated.map((a) => a.id));
  layout.anchors = [
    ...generated,
    ...priorAnchors.filter((anchor) =>
      !anchor || typeof anchor !== 'object' || (!anchor.objectId && !generatedIds.has(anchor.id))),
  ];
  if (!Array.isArray(priorAnchorValue)) layout.anchors = priorAnchorValue as Layout['anchors'];
  return layout;
}

/**
 * v0.18.1: a v2 layout whose rooms name a newer type in `type` (a teammate's file: { type: 'CAFETERIA' }) gets
 * the file form (type: the nearest older type, subtype: 'CAFETERIA'), as this build writes it.
 */
function withFileRoomTypes(data: unknown): unknown {
  const rooms = (data as any)?.rooms;
  if (!Array.isArray(rooms) || !rooms.some((r) => fileRoomType(r?.type).subtype)) return data;
  return {
    ...(data as object),
    rooms: rooms.map((r) => {
      const { type, subtype } = fileRoomType(r?.type);
      return subtype && !r.subtype ? { ...r, type, subtype } : r;
    }),
  };
}

/** An exported layout file (services/apiService.exportLayout): the layout is inside. */
export const LAYOUT_FILE_FORMAT = 'ahdus-layout';

/**
 * Load layout from any version, always returning a VALIDATED v2 layout.
 * Takes a save (v1), an exported layout file ({ format: 'ahdus-layout', layout })
 * or v2 JSON. Throws a ZodError with a readable path (e.g. "objects.3.x:
 * Expected number") if the data is corrupt, instead of letting bad data reach
 * the renderer.
 */
export function loadLayout(data: unknown): Layout {
  if (data && typeof data === 'object' && (data as any).format === LAYOUT_FILE_FORMAT) {
    data = (data as any).layout;
  }
  const v2 = detectVersion(data) === 2 ? withFileRoomTypes(data) : migrateV1toV2(data as V1State);
  const layout = LayoutSchema.parse(v2);
  // Re-sync so anchors always match object positions, even if the saved
  // file was edited by hand or saved by an older build.
  layout.anchors = syncAnchors(layout);
  return layout;
}
