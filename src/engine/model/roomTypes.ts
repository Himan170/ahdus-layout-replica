/**
 * model/roomTypes.ts (v0.18.1)
 *
 * Room types added after v0.18.0 never reach a saved or exported file under their own name: older builds check a
 * v2 room's `type` against a fixed list (schema.ts RoomTypeSchema) and refuse the WHOLE layout when it is not on it.
 * So the file says the nearest older type in `type` and the real one in `subtype`; a build that knows `subtype` reads
 * it, an older one draws the older type (its floor, its label) and drops `subtype`.
 *
 * The store (v1 names, CLAUDE.md rule 2) keeps the real type in `type` ('CAFETERIA'). Only files are mapped: the v2
 * layout (migrate.ts / toV1.ts) and the exported Studio file (apiService.exportLayout, layoutData.normaliseRoom).
 */

/** v0.18.1's room types → what a v0.18.0 (or older) build shows instead. */
export const ROOM_TYPE_FALLBACK: Readonly<Record<string, string>> = Object.freeze({
  CAFETERIA: 'CUSTOM',
  LOUNGE: 'CUSTOM',
  CABIN: 'OFFICE',
  TRAINING: 'MEETING',
  LOBBY: 'RECEPTION',
});

/** A store room type as written in a file: { type, subtype? }. */
export function fileRoomType(type: unknown): { type: string; subtype?: string } {
  const t = typeof type === 'string' ? type.toUpperCase() : '';
  const fallback = ROOM_TYPE_FALLBACK[t];
  return fallback ? { type: fallback, subtype: t } : { type: t };
}

/** A file's { type, subtype } as the store's type: a subtype this build knows wins, else the type. */
export function storeRoomType(type: unknown, subtype: unknown): string | undefined {
  const sub = typeof subtype === 'string' ? subtype.toUpperCase() : '';
  if (ROOM_TYPE_FALLBACK[sub]) return sub;
  return typeof type === 'string' ? type : undefined;
}

/** The walls of a room, the names glass walls use. */
export const WALL_NAMES = ['north', 'south', 'east', 'west'] as const;

/** A room's `glassWalls` cleaned: known wall names, each once, in WALL_NAMES order; [] when none. */
export function cleanGlassWalls(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return WALL_NAMES.filter((w) => list.includes(w));
}
