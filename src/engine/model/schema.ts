/**
 * model/schema.ts
 *
 * Zod schemas for the Layout v2 data format.
 * This is the single source of truth for layout data types.
 * Every system, command, and the store all reference these types.
 */

import { z } from 'zod';

// ── Primitives ───────────────────────────────────────────────────────────

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3Schema>;

export const ScaleSchema = z.object({
  x: z.number().min(0.01).default(1),
  y: z.number().min(0.01).default(1),
  z: z.number().min(0.01).default(1),
});
export type Scale = z.infer<typeof ScaleSchema>;

// ── Anchor ───────────────────────────────────────────────────────────────

export const AnchorKindSchema = z.enum([
  'seat',
  'workstation',
  'spawn',
  'machine',
  'info-point',
  'reception',
]);
export type AnchorKind = z.infer<typeof AnchorKindSchema>;

export const AnchorSchema = z.object({
  id: z.string().uuid(),
  kind: AnchorKindSchema,
  floorId: z.union([z.string(), z.number()]),
  roomId: z.string().nullable().optional(),
  position: Vec3Schema,
  rotationY: z.number().default(0),
  objectId: z.string().optional(),
  positionRef: z.string().optional(),   // org position ID (Yashashwi)
  label: z.string().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

// ── Building ─────────────────────────────────────────────────────────────

export const BuildingSchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  northAngle: z.number().default(0),    // degrees clockwise from +Z
});
export type Building = z.infer<typeof BuildingSchema>;

// ── Floor ────────────────────────────────────────────────────────────────

export const FloorSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().default('Ground Floor'),
  elevation: z.number().default(0),     // meters above datum
  height: z.number().default(3.5),      // floor-to-floor (the editor derives elevations from it)
  underlay: z.object({
    path: z.string(),
    scale: z.number().default(1),       // pixels-per-meter
    offsetX: z.number().default(0),
    offsetZ: z.number().default(0),
    opacity: z.number().min(0).max(1).default(0.5),
  }).optional(),
});
export type Floor = z.infer<typeof FloorSchema>;

// ── Room ─────────────────────────────────────────────────────────────────

// Must match the keys of ROOM_TYPES in src/utils/roomStore.js.
// If you add a room type there, add it here too (and vice versa),
// otherwise migrated layouts silently fall back to CUSTOM.
export const RoomTypeSchema = z.enum([
  'OFFICE', 'MEETING', 'RECEPTION', 'CORRIDOR', 'PRODUCTION',
  'STAIRCASE', 'SERVER_ROOM', 'RESTROOM', 'CUSTOM',
]);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const RoomSchema = z.object({
  id: z.string(),
  floorId: z.union([z.string(), z.number()]),
  name: z.string().default(''),
  type: RoomTypeSchema.default('CUSTOM'),
  x: z.number().default(0),
  z: z.number().default(0),
  width: z.number().min(0.5).default(4),
  depth: z.number().min(0.5).default(4),
  wallHeight: z.number().min(0.5).default(3),
  // metres; walls are centred on the room's edge. Files without it get 0.15 (all walls were 0.15 m before)
  wallThickness: z.number().min(0.1).max(0.6).default(0.15),
  color: z.string().default('#4a90d9'),
  floorFinish: z.string().default('default'),
  departmentRef: z.string().optional(),
});
export type Room = z.infer<typeof RoomSchema>;

// ── Opening (doors/windows on walls) ─────────────────────────────────────

export const OpeningKindSchema = z.enum(['door', 'window']);

export const OpeningSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  kind: OpeningKindSchema.default('door'),
  wall: z.enum(['north', 'south', 'east', 'west']),
  offset: z.number().default(0),        // distance from wall start
  width: z.number().default(1),
  height: z.number().default(2.1),
  sillHeight: z.number().default(0),    // 0 for door, ~0.9 for window
});
export type Opening = z.infer<typeof OpeningSchema>;

// ── Layout Object ────────────────────────────────────────────────────────

export const LayoutObjectSchema = z.object({
  id: z.string(),
  floorId: z.union([z.string(), z.number()]),
  roomId: z.string().nullable().optional(),
  assetType: z.string(),
  x: z.number().default(0),
  y: z.number().default(0),
  z: z.number().default(0),
  rotationY: z.number().default(0),
  scale: ScaleSchema.default({ x: 1, y: 1, z: 1 }),
  label: z.string().default(''),
  department: z.string().default(''),
  locked: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});
export type LayoutObject = z.infer<typeof LayoutObjectSchema>;

// ── Route (emergency/accessible paths) ───────────────────────────────────

export const RouteKindSchema = z.enum([
  'evacuation', 'accessible', 'custom',
]);

export const RouteSchema = z.object({
  id: z.string(),
  floorId: z.union([z.string(), z.number()]),
  kind: RouteKindSchema,
  label: z.string().default(''),
  waypoints: z.array(Vec3Schema),       // ordered list of waypoints
});
export type Route = z.infer<typeof RouteSchema>;

// ── Floor Link (stairs/elevators connecting floors) ──────────────────────

export const FloorLinkKindSchema = z.enum(['stairs', 'elevator']);

export const FloorLinkSchema = z.object({
  id: z.string(),
  kind: FloorLinkKindSchema,
  fromObjectId: z.string(),             // staircase object on lower floor
  toObjectId: z.string(),               // staircase object on upper floor
});
export type FloorLink = z.infer<typeof FloorLinkSchema>;

// ── Full Layout (v2) ─────────────────────────────────────────────────────

export const LayoutSchema = z.object({
  schemaVersion: z.literal(2),
  units: z.literal('meters').default('meters'),
  building: BuildingSchema.default({}),
  floors: z.array(FloorSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
  openings: z.array(OpeningSchema).default([]),
  objects: z.array(LayoutObjectSchema).default([]),
  anchors: z.array(AnchorSchema).default([]),
  routes: z.array(RouteSchema).default([]),
  floorLinks: z.array(FloorLinkSchema).default([]),
});
export type Layout = z.infer<typeof LayoutSchema>;

// ── Layout Version Envelope ──────────────────────────────────────────────

export const LayoutVersionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string(),
  version: z.number().int().min(1),
  name: z.string().default(''),
  snapshot: LayoutSchema,
  createdBy: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type LayoutVersion = z.infer<typeof LayoutVersionSchema>;
