/**
 * ui/tools.js
 *
 * The build tools, defined once and shown the same way in Workplace Studio
 * (Build panel tiles, options trays, footer hints) and in Preview (hotbar and
 * catalog icons). Icons are lucide-react components.
 */

import {
  MousePointer2, LayoutGrid, BrickWall, DoorOpen, AppWindow, Footprints, Armchair,
  ArrowUpDown, MoveHorizontal, Hand, Box,
  Table2, LampDesk, Sofa, Coffee, ConciergeBell, Presentation, BookOpen, Archive,
  Lock, Warehouse, Monitor, Server, Projector, Printer, Tv, Leaf, Sprout, CupSoda,
  Droplets, FireExtinguisher, Siren, Cross, MapPin, Square, Cog, Wrench, Columns3,
  RectangleHorizontal, Users, Laptop, Keyboard, Mouse, Library, Trash2, Refrigerator, Microwave,
  Circle, Rows3, LampFloor, Shirt, Toilet, Bath,
} from 'lucide-react';
import { ROOM_TYPES } from '../utils/roomStore';
import { OBJECT_ITEMS } from '../play/hotbarItems';

// ── Pictures for each kind of thing ──────────────────────────────────────

/** One icon per catalog asset (real thumbnails later). */
export const ASSET_ICONS = {
  GLASS_PARTITION: RectangleHorizontal,
  COLUMN: Columns3,
  STAIRCASE: Footprints,
  DESK_STANDARD: Table2,
  DESK_CORNER: LampDesk,
  CHAIR_OFFICE: Armchair,
  SOFA: Sofa,
  TABLE_MEETING: Users,
  TABLE_COFFEE: Coffee,
  RECEPTION_DESK: ConciergeBell,
  WHITEBOARD: Presentation,
  BOOKSHELF: BookOpen,
  FILING_CABINET: Archive,
  LOCKER_BANK: Lock,
  STORAGE_RACK: Warehouse,
  MONITOR_DUAL: Monitor,
  SERVER_RACK: Server,
  PROJECTOR_SCREEN: Projector,
  PRINTER: Printer,
  TV_DISPLAY: Tv,
  PLANT_LARGE: Leaf,
  PLANT_SMALL: Sprout,
  VENDING_MACHINE: CupSoda,
  COFFEE_MACHINE: Coffee,
  WATER_COOLER: Droplets,
  FIRE_EXTINGUISHER: FireExtinguisher,
  EMERGENCY_EXIT: Siren,
  FIRST_AID: Cross,
  SPAWN_POINT: MapPin,
  ZONE_MARKER: Square,
  CNC_MACHINE: Cog,
  LATHE: Wrench,
  LAPTOP: Laptop,
  KEYBOARD: Keyboard,
  COMPUTER_MOUSE: Mouse,
  BOOKCASE_CLOSED: Library,
  TRASH_CAN: Trash2,
  FRIDGE: Refrigerator,
  MICROWAVE: Microwave,
  LOUNGE_CHAIR: Armchair,
  TABLE_ROUND: Circle,
  SIDE_TABLE: Rows3,
  FLOOR_LAMP: LampFloor,
  COAT_RACK: Shirt,
  TOILET: Toilet,
  WASHBASIN: Bath,
  RUG: RectangleHorizontal,
};

export function assetIcon(assetType) {
  if (ASSET_ICONS[assetType]) return ASSET_ICONS[assetType];
  if (assetType?.startsWith('SOFA')) return Sofa;
  return Box;
}

/** Icon for anything you can hold in Preview (hotbarItems.js items). */
export function itemIcon(item) {
  if (!item) return null;
  switch (item.kind) {
    case 'room': return LayoutGrid;
    case 'wall': return BrickWall;
    case 'door': return DoorOpen;
    case 'window': return AppWindow;
    case 'stretch': return MoveHorizontal;
    case 'edit': return Hand;
    case 'object': return assetIcon(item.assetType);
    default: return Box;
  }
}

/** "6 × 5 m" (no trailing .0) */
export function sizeLabel(width, depth) {
  const n = (v) => String(Math.round(v * 10) / 10);
  return `${n(width)} × ${n(depth)} m`;
}

// ── Options shown in each tile's tray ────────────────────────────────────

export const ROOM_OPTIONS = Object.entries(ROOM_TYPES).map(([roomType, def]) => ({
  id: roomType,
  label: def.label,
  color: def.color,
  detail: sizeLabel(def.defaultW, def.defaultD),
  tool: { kind: 'room', roomType },
}));

/** Furniture tray: every catalog item except building parts (they have their own tiles). */
export const FURNITURE_ITEMS = OBJECT_ITEMS.filter((i) => i.assetType !== 'STAIRCASE');

// ── The tiles ────────────────────────────────────────────────────────────
// id, label, icon, shortcut, hint (footer text), options (tray), and how a
// pick is applied: `tool` = planner tool (plannerTools.js), `place` = start
// placing a catalog asset (placementManager.js).

export const STUDIO_TOOLS = [
  {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    shortcut: '1',
    hint: 'Click something to select it. Drag a wall of a selected room to resize it.',
  },
  {
    id: 'rooms',
    label: 'Rooms',
    icon: LayoutGrid,
    shortcut: '2',
    hint: 'Drag on the ground to draw a room',
    options: ROOM_OPTIONS,
  },
  {
    id: 'walls',
    label: 'Walls',
    icon: BrickWall,
    shortcut: '3',
    hint: 'Drag from where the wall starts to where it ends',
    options: [
      { id: 'wall', label: 'Wall', icon: BrickWall, detail: 'Free-standing, 3 m high', tool: { kind: 'wall' } },
    ],
  },
  {
    id: 'doors',
    label: 'Doors & Windows',
    icon: DoorOpen,
    shortcut: '4',
    hint: 'Click a wall to add a door',
    options: [
      { id: 'door', label: 'Door', icon: DoorOpen, detail: 'Click a wall to add or remove', tool: { kind: 'door' }, hint: 'Click a wall to add a door' },
      { id: 'window', label: 'Window', icon: AppWindow, detail: 'Click a wall to add or remove', tool: { kind: 'window' }, hint: 'Click a wall to add a window' },
    ],
  },
  {
    id: 'stairs',
    label: 'Stairs',
    icon: Footprints,
    shortcut: '5',
    hint: 'Click the floor to place the staircase. R turns it.',
    options: [
      { id: 'staircase', label: 'Straight staircase', icon: Footprints, detail: '1.2 × 4 m, up one floor', place: 'STAIRCASE' },
      { id: 'lift', label: 'Lift', icon: ArrowUpDown, detail: 'Coming soon', disabled: true },
    ],
  },
  {
    id: 'furniture',
    label: 'Furniture',
    icon: Armchair,
    shortcut: '6',
    hint: 'Click the floor or a table top to place it. R turns it, the wheel changes its height.',
    // options: the furniture tray lists FURNITURE_ITEMS with search and categories
  },
];

export const toolById = (id) => STUDIO_TOOLS.find((t) => t.id === id);

/**
 * Which tile is active, and the choice shown under its label, for the current
 * planner tool and placement.
 * @returns {{ id: string, choice: string | null, option: string | null }}
 */
export function activeTile(plannerTool, placementAsset, assetLabel) {
  if (placementAsset === 'STAIRCASE') return { id: 'stairs', choice: 'Staircase', option: 'staircase' };
  if (placementAsset) return { id: 'furniture', choice: assetLabel ?? null, option: placementAsset };
  switch (plannerTool?.kind) {
    case 'room': return { id: 'rooms', choice: ROOM_TYPES[plannerTool.roomType]?.label ?? null, option: plannerTool.roomType };
    case 'wall': return { id: 'walls', choice: 'Wall', option: 'wall' };
    case 'door': return { id: 'doors', choice: 'Door', option: 'door' };
    case 'window': return { id: 'doors', choice: 'Window', option: 'window' };
    default: return { id: 'select', choice: null, option: null };
  }
}

/** The footer hint for what is active right now. */
export function toolHint(plannerTool, placementAsset) {
  const { id } = activeTile(plannerTool, placementAsset);
  if (plannerTool?.kind === 'window' && !placementAsset) return 'Click a wall to add a window';
  return toolById(id)?.hint ?? '';
}
