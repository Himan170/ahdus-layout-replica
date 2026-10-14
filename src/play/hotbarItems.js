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

/** Room-building items, one per room type */
export const ROOM_ITEMS = Object.entries(ROOM_TYPES).map(([roomType, def]) => ({
  kind: 'room',
  roomType,
  label: `${def.label} room`,
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
  room('OFFICE'),
  room('MEETING'),
  structure('stretch'),
  structure('door'),
  structure('window'),
  obj('DESK_STANDARD'),
  obj('CHAIR_OFFICE'),
  obj('STAIRCASE'),
  structure('edit'),
].map((item) => item ?? null);

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
