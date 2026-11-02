/**
 * ui/library.js
 *
 * PURE: what the AHDUS look's library panel (ui/LibraryPanel.jsx) lists, and where a dragged
 * or clicked tile lands. Tested in ui/__tests__/library.test.js.
 *   - room tiles (search), furniture tiles (category chips, search, size, picture)
 *   - the templates ("5 rooms · 1 floor")
 *   - the footprint of a tile on the floor (snapped centre; Shift = square), and the room
 *     a dropped room tile becomes (geometry.planRoomAt: the same snapping and overlap rules
 *     as drawing a room)
 */

import { ROOM_TYPES } from '../utils/roomStore';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { thumbnailFor } from '../utils/modelRegistry';
import { planRoomAt } from '../play/geometry';
import { FURNITURE_ITEMS, sizeLabel } from './tools';

// ── Rooms ──────────────────────────────────────────────────────────────

/** Every room type as a tile: { roomType, label, width, depth, sizeText } */
export const ROOM_TILES = Object.entries(ROOM_TYPES).map(([roomType, def]) => ({
  kind: 'room',
  id: roomType,
  roomType,
  label: def.label,
  width: def.defaultW,
  depth: def.defaultD,
  sizeText: sizeLabel(def.defaultW, def.defaultD),
}));

const matches = (text, q) => text.toLowerCase().includes(q);

export function filterRooms(query, tiles = ROOM_TILES) {
  const q = query.trim().toLowerCase();
  return q ? tiles.filter((t) => matches(t.label, q)) : tiles;
}

// ── Furniture ──────────────────────────────────────────────────────────

/** The category chips, in order. "More" holds what fits none of the others. */
export const FURNITURE_CHIPS = ['Desks', 'Seating', 'Meeting', 'Kitchen', 'Storage', 'Plants', 'More'];

const CHIP_OF = {
  DESK_STANDARD: 'Desks', DESK_CORNER: 'Desks', RECEPTION_DESK: 'Desks', MONITOR_DUAL: 'Desks',
  LAPTOP: 'Desks', KEYBOARD: 'Desks', COMPUTER_MOUSE: 'Desks',
  CHAIR_OFFICE: 'Seating', LOUNGE_CHAIR: 'Seating',
  TABLE_MEETING: 'Meeting', TABLE_ROUND: 'Meeting', TABLE_COFFEE: 'Meeting', WHITEBOARD: 'Meeting',
  PROJECTOR_SCREEN: 'Meeting', TV_DISPLAY: 'Meeting',
  FRIDGE: 'Kitchen', MICROWAVE: 'Kitchen', COFFEE_MACHINE: 'Kitchen', VENDING_MACHINE: 'Kitchen', WATER_COOLER: 'Kitchen',
  BOOKSHELF: 'Storage', BOOKCASE_CLOSED: 'Storage', FILING_CABINET: 'Storage', LOCKER_BANK: 'Storage',
  STORAGE_RACK: 'Storage', SIDE_TABLE: 'Storage', COAT_RACK: 'Storage',
  PLANT_LARGE: 'Plants', PLANT_SMALL: 'Plants',
};

export function chipOf(assetType) {
  if (CHIP_OF[assetType]) return CHIP_OF[assetType];
  if (assetType?.startsWith('SOFA')) return 'Seating';
  return 'More';
}

/** Footprint of a catalogue item in metres (its primitive model's size). */
export function itemSize(assetType) {
  const def = ASSET_TYPES[assetType] ?? {};
  return { width: def.defaultWidth ?? 1, depth: def.defaultDepth ?? 1 };
}

/** Every furniture item as a tile: { assetType, label, chip, width, depth, sizeText, thumb } */
export const FURNITURE_TILES = FURNITURE_ITEMS.map((i) => {
  const { width, depth } = itemSize(i.assetType);
  return {
    kind: 'object',
    id: i.assetType,
    assetType: i.assetType,
    label: i.label,
    chip: chipOf(i.assetType),
    width,
    depth,
    sizeText: sizeLabel(width, depth),
    thumb: thumbnailFor(i.assetType), // under the assets folder, or null: the item's icon
  };
});

/** Items with a real model come first in each chip (they have pictures). */
export function filterFurniture(query, chip, tiles = FURNITURE_TILES) {
  const q = query.trim().toLowerCase();
  const shown = q ? tiles.filter((t) => matches(t.label, q) || matches(t.chip, q)) : tiles.filter((t) => t.chip === chip);
  return [...shown].sort((a, b) => Number(!a.thumb) - Number(!b.thumb));
}

/** How many items have a picture ("Search 28 models"; Reception Desk: of its primitive model). */
export const MODEL_COUNT = FURNITURE_TILES.filter((t) => t.thumb).length;

// ── Templates ──────────────────────────────────────────────────────────

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "5 rooms · 1 floor" */
export function templateDetail(layout) {
  const rooms = Array.isArray(layout?.rooms) ? layout.rooms.length : Object.keys(layout?.rooms ?? {}).length;
  const floors = Math.max(1, Object.keys(layout?.floors ?? {}).length);
  return `${plural(rooms, 'room')} · ${plural(floors, 'floor')}`;
}

// ── Where a tile lands ─────────────────────────────────────────────────

const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

/**
 * The rectangle a tile covers when its centre is at `point` (x, z on the floor).
 * @param {{ snapStep?: number, square?: boolean }} [opts]  square: Shift held (the longer side both ways)
 * @returns {{ x, z, width, depth }}
 */
export function footprintAt(point, width, depth, { snapStep = 0, square = false } = {}) {
  const side = Math.max(width, depth);
  const w = square ? side : width;
  const d = square ? side : depth;
  return { x: snap(point.x, snapStep), z: snap(point.z, snapStep), width: w, depth: d };
}

/**
 * A room tile dropped with its centre at `point`: the room it becomes, snapped like a drawn room.
 * @param {object[]} rooms  rooms on the floor being edited
 * @param {object[]|null} below  rooms on the floor below (null on the lowest floor)
 * @returns {{ rect: { x, z, width, depth }, blocker: object|null, overhang: boolean }}
 */
export function planRoomDrop(tile, point, rooms, below = null, opts = {}) {
  const r = footprintAt(point, tile.width, tile.depth, opts);
  return planRoomAt(r, r.width, r.depth, rooms, below);
}
