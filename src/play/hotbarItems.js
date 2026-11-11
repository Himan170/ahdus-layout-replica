/**
 * play/hotbarItems.js
 *
 * Everything you can hold in Play mode, and the default hotbar.
 */

import { ROOM_TYPES } from '../utils/roomStore';
import { ASSET_TYPES } from '../utils/assetCatalog';

const ROOM_ICONS = {
  OFFICE: '🏢', MEETING: '👥', RECEPTION: '🛎️', CORRIDOR: '🚶',
  PRODUCTION: '🏭', STAIRCASE: '🪜', SERVER_ROOM: '🖧', RESTROOM: '🚻',
};

/**
 * A room type's name in the catalog: "Office room", but "Meeting Room",
 * "Restroom" and "Production Area" as they are (no "Meeting Room room").
 */
export function roomItemLabel(label) {
  const name = String(label ?? '').trim();
  return /(room|area)$/i.test(name) ? name : `${name} room`;
}

/** Room-building items, one per room type */
export const ROOM_ITEMS = Object.entries(ROOM_TYPES).map(([roomType, def]) => ({
  kind: 'room',
  roomType,
  label: roomItemLabel(def.label),
  icon: ROOM_ICONS[roomType] ?? '⬜',
  color: def.color,
}));

export const STRUCTURE_ITEMS = [
  { kind: 'edit', label: 'Edit item', icon: '✋' },
  { kind: 'stretch', label: 'Stretch room', icon: '↔️' },
  { kind: 'wall', label: 'Wall', icon: '🧱' },
  { kind: 'door', label: 'Door', icon: '🚪' },
  { kind: 'window', label: 'Window', icon: '🪟' },
];

// These assets are replaced by the real building tools above
const HIDDEN_ASSETS = new Set(['WALL_SEGMENT', 'DOOR_SINGLE', 'WINDOW_FRAME']);

// Several catalog assets share an emoji; give each hotbar item its own.
// (Later: render small pictures of the real 3D models instead of emoji.)
const ICON_OVERRIDES = {
  DESK_CORNER: '📐',
  TABLE_MEETING: '🤝',
  TABLE_COFFEE: '🫖',
  RECEPTION_DESK: '💁',
  SERVER_RACK: '🔌',
  GLASS_PARTITION: '🔲',
  BOOKCASE_CLOSED: '🚪',
  SIDE_TABLE: '🪵',
  LOUNGE_CHAIR: '💺',
  WASHBASIN: '🧼',
};

export const OBJECT_ITEMS = Object.entries(ASSET_TYPES)
  .filter(([key]) => !HIDDEN_ASSETS.has(key))
  .map(([assetType, def]) => ({
    kind: 'object',
    assetType,
    label: def.label,
    icon: ICON_OVERRIDES[assetType] ?? def.icon ?? '📦',
    category: def.category,
  }));

const room = (t) => ROOM_ITEMS.find((i) => i.roomType === t);
const obj = (t) => OBJECT_ITEMS.find((i) => i.assetType === t);
const structure = (k) => STRUCTURE_ITEMS.find((i) => i.kind === k);

export const DEFAULT_HOTBAR = [
  structure('edit'),
  structure('stretch'),
  room('OFFICE'),
  structure('door'),
  structure('window'),
  obj('DESK_STANDARD'),
  obj('CHAIR_OFFICE'),
  obj('STAIRCASE'),
  room('MEETING'),
].map((item) => item ?? null);

// The short name under a hotbar icon (v0.15.2): one or two short words that fit a slot.
const SHORT_NAMES = {
  DESK_STANDARD: 'Desk', DESK_CORNER: 'L-desk', CHAIR_OFFICE: 'Chair', SOFA_3SEAT: 'Sofa',
  TABLE_MEETING: 'Table', TABLE_COFFEE: 'Coffee tbl', TABLE_ROUND: 'Round tbl', RECEPTION_DESK: 'Reception',
  MONITOR_DUAL: 'Monitor', PROJECTOR_SCREEN: 'Screen', TV_DISPLAY: 'TV', PRINTER: 'Printer',
  PLANT_LARGE: 'Plant', PLANT_SMALL: 'Desk plant', STAIRCASE: 'Stairs', COLUMN: 'Column',
  LOCKER_BANK: 'Lockers', FILING_CABINET: 'Cabinet', STORAGE_RACK: 'Rack', SERVER_RACK: 'Server',
  GLASS_PARTITION: 'Glass wall', VENDING_MACHINE: 'Vending', COFFEE_MACHINE: 'Coffee', WATER_COOLER: 'Water',
  FIRE_EXTINGUISHER: 'Fire ext.', EMERGENCY_EXIT: 'Exit sign', FIRST_AID: 'First aid', COMPUTER_MOUSE: 'Mouse',
  SPAWN_POINT: 'Start', ZONE_MARKER: 'Zone', CNC_MACHINE: 'CNC', LOUNGE_CHAIR: 'Armchair',
};
const STRUCTURE_SHORT = { edit: 'Edit', stretch: 'Stretch', wall: 'Wall', door: 'Door', window: 'Window' };
/** At most this many characters under a slot (longer names are cut with …). */
export const SHORT_NAME_MAX = 10;

/**
 * The short name under a hotbar icon: "Office", "Meeting", "Stretch", "Door", "Desk", "Chair".
 * A room: its type without "Room" / "Area"; an item: its short name, else its own name when it
 * is short enough, else the last word of it. Never longer than SHORT_NAME_MAX.
 */
export function shortLabel(item) {
  if (!item) return '';
  let name;
  if (item.kind === 'room') {
    const full = String(ROOM_TYPES[item.roomType]?.label ?? item.label ?? 'Room').trim();
    name = full.replace(/\s+(room|area)$/i, '') || full;
  } else if (item.kind === 'object') {
    const full = String(item.label ?? '').trim();
    name = SHORT_NAMES[item.assetType] ?? (full.length <= SHORT_NAME_MAX ? full : full.split(/\s+/).pop());
  } else {
    name = STRUCTURE_SHORT[item.kind] ?? String(item.label ?? '');
  }
  name = name || 'Item';
  return name.length > SHORT_NAME_MAX ? `${name.slice(0, SHORT_NAME_MAX - 1)}…` : name;
}

/** No slot chosen: Preview starts with an empty hand (walking first, building is a choice). */
export const EMPTY_HAND = -1;

/** The slot after a wheel step (+1 / -1) from `current` (EMPTY_HAND: the first or the last slot). */
export function nextSlot(current, step, size = 9) {
  if (!(current >= 0 && current < size)) return step > 0 ? 0 : size - 1;
  return (current + step + size) % size;
}

/** Edit/Stretch always use 1/2. Other catalog picks use the chosen mutable slot, a free slot, or slot 3. */
export function catalogSlot(hotbar, selected, item = null) {
  if (item?.kind === 'edit') return 0;
  if (item?.kind === 'stretch') return 1;
  if (selected >= 2 && selected < hotbar.length) return selected;
  const free = hotbar.findIndex((entry, i) => i >= 2 && !entry);
  return free >= 0 ? free : 2;
}

/** Catalog sections shown when you press B */
export function catalogSections() {
  const byCategory = new Map();
  for (const item of OBJECT_ITEMS) {
    const key = item.category ?? 'Other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(item);
  }
  return [
    { title: 'Rooms', items: ROOM_ITEMS },
    { title: 'Build tools', items: STRUCTURE_ITEMS },
    ...[...byCategory].map(([title, items]) => ({ title, items })),
  ];
}

export const itemKey = (item) =>
  !item ? 'empty' : item.kind === 'room' ? `room:${item.roomType}` : item.kind === 'object' ? `obj:${item.assetType}` : item.kind;
