/**
 * utils/modelRegistry.js
 *
 * Which real model (a Kenney Furniture Kit GLB, CC0) draws which catalogue
 * item when "Realistic look" is on, and which photo textures (Poly Haven /
 * ambientCG, CC0) the rooms use. Pure data, no Babylon: scripts/prepare-assets.mjs
 * reads it to know which files to copy into public/assets/.
 *
 * A model is fitted into the box of the item's primitive model (its bounding
 * box), so sizes, footprints, stacking and picking stay as they were
 * (play/modelFit.js). Items not listed here keep their primitive model.
 *
 * Entry: { parts: [{ model, turn?, region?, fit? }] }
 *   model   file name in public/assets/models/kenney/ (without .glb)
 *   turn    quarter turns about Y before fitting (Kenney models face +Z, like the catalogue)
 *   region  the part of the item's box this model fills, as fractions per axis,
 *           e.g. { x: [0, 0.48] } = the left 48 % (default: the whole box)
 *   fit     'stretch' (default: fill the box) or 'contain' (keep the model's
 *           proportions, as big as fits, standing on the bottom, centred)
 */

export const MODEL_DIR = 'models/kenney/';
export const TEXTURE_DIR = 'textures/';
export const ENV_FILE = 'env/sky.env';
/** Library tile pictures, drawn by the app itself (scripts/make-thumbs.mjs): thumbs/<model>.webp. */
export const THUMB_DIR = 'thumbs/';

const one = (model, opts = {}) => ({ parts: [{ model, ...opts }] });

export const MODEL_REGISTRY = {
  // existing catalogue items
  DESK_STANDARD: one('desk'),
  DESK_CORNER: one('deskCorner'),
  CHAIR_OFFICE: one('chairDesk'),
  SOFA_3SEAT: one('loungeSofa'),
  TABLE_MEETING: one('table'),
  TABLE_COFFEE: one('tableCoffee'),
  BOOKSHELF: one('bookcaseOpen'),
  MONITOR_DUAL: {
    parts: [
      { model: 'computerScreen', region: { x: [0, 0.49] }, fit: 'contain' },
      { model: 'computerScreen', region: { x: [0.51, 1] }, fit: 'contain' },
    ],
  },
  TV_DISPLAY: one('televisionModern'),
  PLANT_LARGE: one('pottedPlant'),
  PLANT_SMALL: one('plantSmall1'),
  COFFEE_MACHINE: one('kitchenCoffeeMachine', { fit: 'contain' }),
  // items added with the real models (they have simple primitive models too)
  LAPTOP: one('laptop'),
  KEYBOARD: one('computerKeyboard'),
  COMPUTER_MOUSE: one('computerMouse'),
  BOOKCASE_CLOSED: one('bookcaseClosedDoors'),
  TRASH_CAN: one('trashcan'),
  FRIDGE: one('kitchenFridge'),
  MICROWAVE: one('kitchenMicrowave'),
  LOUNGE_CHAIR: one('loungeChair'),
  TABLE_ROUND: one('tableRound'),
  SIDE_TABLE: one('sideTableDrawers'),
  FLOOR_LAMP: one('lampSquareFloor'),
  COAT_RACK: one('coatRackStanding'),
  TOILET: one('toilet'),
  WASHBASIN: one('bathroomSink'),
  RUG: one('rugRectangle'),
};

/** The model parts of an asset type, or null (it keeps its primitive model). */
export function modelPartsFor(assetType) {
  return MODEL_REGISTRY[assetType]?.parts ?? null;
}

/** Types with no real model that still get a library picture (of their primitive model): type → file name. */
export const PRIMITIVE_THUMBS = {
  RECEPTION_DESK: 'receptionDesk',
};

/** The file name of an asset type's library picture (its first model's name), or null. */
function thumbName(assetType) {
  return MODEL_REGISTRY[assetType]?.parts[0]?.model ?? PRIMITIVE_THUMBS[assetType] ?? null;
}

/** The library picture of an asset type ('thumbs/<name>.webp', under the assets folder), or null. */
export function thumbnailFor(assetType) {
  const name = thumbName(assetType);
  return name ? `${THUMB_DIR}${name}.webp` : null;
}

/** Every library picture: [{ assetType, name }], one per file (scripts/make-thumbs.mjs draws them). */
export function thumbnailList() {
  const seen = new Set();
  return [...Object.keys(MODEL_REGISTRY), ...Object.keys(PRIMITIVE_THUMBS)]
    .map((assetType) => ({ assetType, name: thumbName(assetType) }))
    .filter(({ name }) => !seen.has(name) && seen.add(name));
}

/** Every model file used (each is loaded once per scene). */
export function usedModels() {
  return [...new Set(Object.values(MODEL_REGISTRY).flatMap((e) => e.parts.map((p) => p.model)))].sort();
}

// ── Room textures ────────────────────────────────────────────────────────
// Each set is public/assets/textures/<name>/{color,normal,rough}.jpg.
// `tile`: metres covered by one repeat of the texture.

export const TEXTURE_SETS = {
  carpet_office: { tile: 2, roughness: 1 },
  herringbone_parquet: { tile: 2, roughness: 1 },
  laminate_floor: { tile: 2, roughness: 1 },
  floor_tiles: { tile: 1.2, roughness: 1 },
  concrete_floor: { tile: 3, roughness: 1 },
  metal_plate: { tile: 1.2, roughness: 1, metallic: 0.6 },
  beige_wall: { tile: 2, roughness: 1 },
  grey_plaster: { tile: 2, roughness: 1 },
  office_ceiling: { tile: 1.2, roughness: 1 },
};

/**
 * Which texture set each procedural room material becomes (materialLibrary's
 * keys; FLOOR_BY_ROOM_TYPE says which room type has which floor).
 */
export const REALISTIC_SURFACES = {
  'floor:wood': 'carpet_office',         // OFFICE
  'floor:carpet': 'herringbone_parquet', // MEETING
  'floor:tile': 'floor_tiles',           // RECEPTION
  'floor:corridor': 'laminate_floor',    // CORRIDOR
  'floor:smallTile': 'floor_tiles',      // RESTROOM
  'floor:concrete': 'concrete_floor',    // PRODUCTION, STAIRCASE
  'floor:raised': 'metal_plate',         // SERVER_ROOM
  plaster: 'beige_wall',                 // walls
  structure: 'grey_plaster',             // slab, roof, parapet, wall band
  ceiling: 'office_ceiling',
};
