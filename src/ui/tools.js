/**
 * ui/tools.js
 *
 * The build tools, defined once and shown the same way in Workplace Studio
 * (tool rail tiles, their libraries, hints) and in Preview (hotbar and
 * catalog icons). Icons are lucide-react components.
 */

import {
  MousePointer2, LayoutGrid, BrickWall, DoorOpen, AppWindow, Footprints, Armchair,
  ArrowUpDown, MoveHorizontal, Hand, Box, Briefcase, Route, Factory,
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

/** A room type's icon in Walk through's hotbar and catalog (v0.15.2): every type its own. */
export const ROOM_ICONS = {
  OFFICE: Briefcase,
  MEETING: Users,
  RECEPTION: ConciergeBell,
  CORRIDOR: Route,
  PRODUCTION: Factory,
  STAIRCASE: ArrowUpDown,
  SERVER_ROOM: Server,
  RESTROOM: Toilet,
};

/** Icon for anything you can hold in Preview (hotbarItems.js items). */
export function itemIcon(item) {
  if (!item) return null;
  switch (item.kind) {
    case 'room': return ROOM_ICONS[item.roomType] ?? LayoutGrid; // v0.15.2: each room type its own
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

// ── Options shown in each tile's library ─────────────────────────────────

export const ROOM_OPTIONS = Object.entries(ROOM_TYPES).map(([roomType, def]) => ({
  id: roomType,
  label: def.label,
  color: def.color,
  detail: sizeLabel(def.defaultW, def.defaultD),
  tool: { kind: 'room', roomType },
}));

/** The Furniture library: every catalog item except building parts (they have their own tiles). */
export const FURNITURE_ITEMS = OBJECT_ITEMS.filter((i) => i.assetType !== 'STAIRCASE');

// ── The tiles ────────────────────────────────────────────────────────────
// id, label, icon, shortcut, hint (canvas hint), options (library), and how a
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
    railLabel: 'Doors & windows', // the AHDUS look's tool rail
    phoneLabel: 'Doors',
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
    hint: 'Click the floor to place the staircase. R turns it 90°.',
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
    hint: 'Click the floor or a table top to place it. R turns it 90° (Shift+R: 15°), the wheel changes its height.',
    // options: the Furniture library lists FURNITURE_ITEMS with search and categories
  },
];

/**
 * Every keyboard shortcut of Workplace Studio, for the Shortcuts list (AHDUS look's tool rail).
 * The keys themselves are handled in hooks/useStudioKeyboard.js.
 */
/** The AHDUS look's camera keys (ui/CameraControls.jsx, useStudioKeyboard). */
export const CAMERA_KEYS = {
  top: '7', front: '8', side: '9', reset: 'H', fit: 'F', zoomIn: '+', zoomOut: '−', orbit: 'O', pan: 'P',
};

export const SHORTCUT_GROUPS = [
  {
    title: 'Tools',
    keys: toolKeys(),
  },
  {
    title: 'Selected item',
    keys: [
      [['Drag'], 'Move it (a desk takes its chair)'], [['W'], 'Show the move arrows'],
      [['R'], 'Turn 90°'], [['Shift', 'R'], 'Turn 15°'], [['S'], 'Resize handles'],
      [['F'], 'Focus on it'], [['Double-click'], 'Focus on it'], [['L'], 'Lock or unlock'],
      [['Ctrl', 'D'], 'Duplicate'], [['Delete'], 'Delete'],
    ],
  },
  {
    title: 'Several items',
    keys: [
      [['Shift', 'Click'], 'Add or remove an item'], [['Shift', 'Drag'], 'Select the items in a box'],
      [['Drag'], 'Move them all'], [['Arrows'], 'Move them'], [['R'], 'Turn them 90° (Shift+R: 15°)'],
      [['L'], 'Lock or unlock them'], [['Delete'], 'Delete them (locked ones stay)'],
    ],
  },
  {
    title: 'Copy and paste',
    keys: [
      [['Ctrl', 'C'], 'Copy (a desk with its chair)'], [['Ctrl', 'V'], 'Paste at the mouse'],
      [['Ctrl', 'Shift', 'V'], 'Paste at the same place'],
    ],
  },
  {
    title: 'General',
    keys: [
      [['Ctrl', 'Z'], 'Undo'], [['Ctrl', 'Y'], 'Redo'], [['Ctrl', 'S'], 'Save now'], [['Esc'], 'Cancel, then deselect'],
      [['Page Up'], 'Floor above'], [['Page Down'], 'Floor below'],
      [['Tab'], 'Walk through'], [['R'], 'Turn what you are placing 90° (Shift+R: 15°)'],
    ],
  },
  {
    title: 'Camera',
    keys: [
      [[CAMERA_KEYS.top], 'Top view'], [[CAMERA_KEYS.front], 'Front view'], [[CAMERA_KEYS.side], 'Side view'],
      [[CAMERA_KEYS.reset], 'Reset view'], [[CAMERA_KEYS.fit], 'Fit building (with a selection: focus on it)'],
      [[CAMERA_KEYS.zoomIn], 'Zoom in'], [[CAMERA_KEYS.zoomOut], 'Zoom out'],
      [[CAMERA_KEYS.orbit], 'Orbit: drag turns the view'], [[CAMERA_KEYS.pan], 'Pan: drag slides the view'],
    ],
  },
];

function toolKeys() {
  return STUDIO_TOOLS.map((t) => [[t.shortcut], t.railLabel ?? t.label]);
}

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
  if (plannerTool?.kind === 'room' && plannerTool.stamp && !placementAsset) return 'Tap the floor where the room goes';
  return toolById(id)?.hint ?? '';
}

/** A phone with nothing going on: how to move the view with fingers. */
export const PHONE_HINT = 'Drag to turn · pinch to zoom · tap a room to select it';

/**
 * The phone's idle hint, or '' (no hint): hidden while a bottom sheet (the library, the
 * Inspector) covers the bottom of the view, and for good once the canvas has been touched.
 */
/** Plan view's hint (v0.15.5: was a bar at the bottom of the plan, over the floor switcher). */
export const PLAN_HINT = 'Click to select · drag to move · scroll to zoom · Page Up / Down: floors';

export function phoneIdleHint({ sheetOpen = false, touched = false } = {}) {
  return sheetOpen || touched ? '' : PHONE_HINT;
}
