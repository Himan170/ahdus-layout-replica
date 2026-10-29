/**
 * model/toV1.ts
 *
 * Converts a v2 Layout (LayoutSchema) back to the v1 shape that the Zustand
 * store (workspaceStore.loadWorkspace) and normaliseLayout expect.
 *
 * v2 → v1 field mapping (inverse of migrate.ts):
 *   room.floorId         → floor            object.floorId   → floor
 *   openings[]           → room.doors/windows  object.locked → isLocked
 *   object.scale {x,y,z} → scaleX, scaleY, scaleZ
 *   metadata.name        → name (else the label)
 *   metadata.rotationX/Z → rotationX, rotationZ
 *   metadata.category    → category (none: 'Furniture', the store's default)
 *
 * The store never stores elevation; it derives it from floor heights
 * (building.elevationOf), stacking floors in id order with the ground floor 0.
 * So v1 floors keep { id, name, height }; floors with string ids (v2 files
 * from elsewhere) are numbered 0, 1, 2 … from the lowest.
 *
 * anchorData is rebuilt from anchor.positionRef / anchor.label keyed by
 * anchor id, matching the shape apiService saves.
 */

import type { Layout, Floor, Room, Opening, LayoutObject, Anchor } from './schema';

// ── Types ──────────────────────────────────────────────────────────────

/** The shape workspaceStore.loadWorkspace() / normaliseLayout() expects. */
export interface V1Layout {
  layoutName: string;
  layoutVersion: number;
  floors: Record<number, V1Floor>;
  rooms: V1Room[];
  objects: V1Object[];
  anchorData: Record<string, { positionRef?: string; label?: string }>;
}

export interface V1Floor {
  id: number;
  name: string;
  height: number;
}

export interface V1Room {
  id: string;
  type: string;
  name: string;
  floor: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  wallHeight: number;
  wallThickness: number;
  color: string;
  floorFinish: string;
  departmentRef?: string;
  doors: V1Opening[];
  windows: V1Opening[];
}

export interface V1Opening {
  id?: string;
  wall: string;
  offset: number;
  width: number;
  height: number;
  sill?: number;       // windows only
}

export interface V1Object {
  id: string;
  assetType: string;
  name: string;
  category: string;
  floor: number;
  roomId: string | null;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  isLocked: boolean;
  label: string;
  department: string;
  metadata: Record<string, unknown>;
}

// ── Converter ──────────────────────────────────────────────────────────

/**
 * v2 floor id → the store's numeric id. Numeric ids are kept; if any id is
 * not a number, floors are numbered from the lowest (elevation) up.
 */
export function storeFloorIds(floors: Floor[]): (id: string | number) => number {
  const numeric = floors.every((f) => Number.isFinite(Number(f.id)));
  if (numeric) return (id) => Number(id);
  const order = [...floors].sort((a, b) => a.elevation - b.elevation);
  const map = new Map(order.map((f, i) => [String(f.id), i]));
  return (id) => map.get(String(id)) ?? 0;
}

/** migrate.ts gives doors and windows without an id this one: no need to keep it. */
const generatedOpeningId = (o: Opening, index: number) =>
  o.id === `${o.roomId}_${o.kind}_${o.wall}_${index}`;

/**
 * Convert a v2 Room + its openings to the v1 shape.
 * v2 stores openings in a flat array; v1 groups them as room.doors / room.windows.
 */
function convertRoom(r: Room, openings: Opening[], floorOf: (id: string | number) => number): V1Room {
  const doors: V1Opening[] = [];
  const windows: V1Opening[] = [];
  for (const o of openings) {
    if (o.roomId !== r.id) continue;
    const list = o.kind === 'window' ? windows : doors;
    const v1: V1Opening = {
      ...(generatedOpeningId(o, list.length) ? {} : { id: o.id }),
      wall: o.wall,
      offset: o.offset,
      width: o.width,
      height: o.height,
    };
    if (o.kind === 'window') v1.sill = o.sillHeight;
    list.push(v1);
  }

  return {
    id: r.id,
    type: r.type,
    name: r.name,
    floor: floorOf(r.floorId),
    x: r.x,
    z: r.z,
    width: r.width,
    depth: r.depth,
    wallHeight: r.wallHeight,
    wallThickness: r.wallThickness ?? 0.15,
    color: r.color,
    floorFinish: r.floorFinish,
    ...(r.departmentRef ? { departmentRef: r.departmentRef } : {}),
    doors,
    windows,
  };
}

/**
 * Convert a v2 LayoutObject to the v1 shape the store uses.
 * Fields migrate.ts puts in `metadata` (name, category, rotationX, rotationZ)
 * are lifted back to top-level v1 fields. The rest of metadata stays.
 */
function convertObject(o: LayoutObject, floorOf: (id: string | number) => number): V1Object {
  const { name, category, rotationX, rotationZ, ...meta } = o.metadata ?? {};

  return {
    id: o.id,
    assetType: o.assetType,
    name: typeof name === 'string' ? name : o.label,
    category: typeof category === 'string' ? category : 'Furniture',
    floor: floorOf(o.floorId),
    roomId: o.roomId ?? null,
    x: o.x,
    y: o.y,
    z: o.z,
    rotationX: typeof rotationX === 'number' ? rotationX : 0,
    rotationY: o.rotationY,
    rotationZ: typeof rotationZ === 'number' ? rotationZ : 0,
    scaleX: o.scale.x,
    scaleY: o.scale.y,
    scaleZ: o.scale.z,
    isLocked: o.locked,
    // a name kept apart means the label was set on its own (or empty)
    label: typeof name === 'string' && o.label === name ? '' : o.label,
    department: o.department,
    metadata: meta,
  };
}

/**
 * Rebuild anchorData from the v2 anchors array. Only anchors with
 * positionRef or label produce an entry (the rest is derived at load time).
 */
function buildAnchorData(anchors: Anchor[]): V1Layout['anchorData'] {
  const data: V1Layout['anchorData'] = {};
  for (const a of anchors) {
    const entry: { positionRef?: string; label?: string } = {};
    if (a.positionRef) entry.positionRef = a.positionRef;
    if (a.label) entry.label = a.label;
    if (Object.keys(entry).length) data[a.id] = entry;
  }
  return data;
}

/**
 * Convert a v2 Layout to the v1 shape the store expects.
 *
 * This is the inverse of migrateV1toV2 (model/migrate.ts): v1 → v2 → v1 gives
 * back everything the store keeps. What only v2 has (building address and
 * north angle, routes, floor links, floor underlays, anchors not on an object)
 * has no place in the store; LayoutEngine.getLayout() adds it back.
 */
export function toV1(layout: Layout): V1Layout {
  const floorOf = storeFloorIds(layout.floors);
  const floors: Record<number, V1Floor> = {};
  for (const f of layout.floors) {
    const id = floorOf(f.id);
    floors[id] = { id, name: f.name, height: f.height };
  }

  return {
    layoutName: layout.building.name,
    layoutVersion: 1,
    floors,
    rooms: layout.rooms.map((r) => convertRoom(r, layout.openings, floorOf)),
    objects: layout.objects.map((o) => convertObject(o, floorOf)),
    anchorData: buildAnchorData(layout.anchors),
  };
}

/**
 * The store's layout (exported and migrated back to v2) plus what only v2
 * has, from the layout as it was loaded: the building's address and north
 * angle, routes, floor links, floor underlays and anchors that aren't on an
 * object. So v2 in → edit → v2 out keeps them.
 */
export function mergeV2Extras(current: Layout, loaded: Layout): Layout {
  const floorOf = storeFloorIds(loaded.floors);
  const underlays = new Map(loaded.floors.filter((f) => f.underlay).map((f) => [floorOf(f.id), f.underlay]));
  return {
    ...current,
    building: { ...loaded.building, name: current.building.name },
    floors: current.floors.map((f) => (underlays.has(Number(f.id)) ? { ...f, underlay: underlays.get(Number(f.id)) } : f)),
    anchors: [
      ...loaded.anchors.filter((a) => !a.objectId).map((a) => ({ ...a, floorId: floorOf(a.floorId) })),
      ...current.anchors,
    ],
    routes: loaded.routes.map((r) => ({ ...r, floorId: floorOf(r.floorId) })),
    floorLinks: loaded.floorLinks,
  };
}
