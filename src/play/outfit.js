/**
 * play/outfit.js — PURE (v0.16.0): what a person wears in 3D, from what they chose in AHDUS's Wardrobe.
 * The same rules as the Wardrobe's own model (AHDUS-FRONTEND frontend/character/avatar/rocketbox-avatar.js), so a
 * character looks the same at their desk, walking through and in the Wardrobe. Tests: play/__tests__/outfit.test.js.
 *
 * Clothing (as AHDUS saves it, /api/character/selection):
 *   { schemaVersion: 1, pantsColor: 'black' | 'blue', upperBody: null | 'shirt' | 'tshirt', upperColor: '#rrggbb' | null }
 * upperBody null = Office formal (the suit). Only a file with the Rocketbox outfit parts (manifest `outfit:
 * 'rocketbox'`) changes: the older Mixamo characters and the imported ones wear their own outfit, untouched.
 *
 * Parts (meshes by name; Babylon's `Name_primitive0` = Name):
 * - Office formal: Outfit_formal + Skin_formal, or, for a character with its own suit (no Outfit_formal),
 *   Outfit_original + Skin_original. The suit keeps its colours.
 * - Shirt: Top_shirt + Skin_shirt + Trousers + Shoes. T-shirt: Top_tee + Skin_tee + Trousers + Shoes.
 * - Body and Hair always; every other outfit part hidden; a part we don't know is left as it is.
 * - Trousers: their own colour × TROUSER_TINTS[pantsColor]. A shirt / T-shirt: its own colour × upperColor (none:
 *   its own colour).
 */

/** Which parts each outfit shows (rocketbox-avatar.js OUTFIT_PARTS). */
export const OUTFIT_PARTS = Object.freeze({
  formal: Object.freeze(['Outfit_formal', 'Skin_formal']),
  ownFormal: Object.freeze(['Outfit_original', 'Skin_original']),
  shirt: Object.freeze(['Top_shirt', 'Skin_shirt', 'Trousers', 'Shoes']),
  tshirt: Object.freeze(['Top_tee', 'Skin_tee', 'Trousers', 'Shoes']),
});
/** The outfit parts: shown or hidden by the outfit. Anything else (Body, Hair, …) always shows. */
export const ALL_OUTFIT_PARTS = Object.freeze([...new Set(Object.values(OUTFIT_PARTS).flat())]);
/** Multiplied onto the trousers' light grey fabric (rocketbox-avatar.js TROUSER_TINTS: what the model shows). */
export const TROUSER_TINTS = Object.freeze({ black: '#3a3b40', blue: '#2c3e6b' });
/** What someone who never chose wears: Office formal. */
export const DEFAULT_CLOTHING = Object.freeze({ schemaVersion: 1, pantsColor: 'black', upperBody: null, upperColor: null });

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Clothing as the view takes it (only these four fields, checked), or null when nothing usable was given.
 * A wrong field falls back to the default (black trousers, Office formal, no colour).
 * @param {unknown} value
 * @returns {{ schemaVersion: 1, pantsColor: 'black' | 'blue', upperBody: 'shirt' | 'tshirt' | null, upperColor: string | null } | null}
 */
export function cleanClothing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pantsColor = value.pantsColor === 'blue' ? 'blue' : 'black';
  const upperBody = value.upperBody === 'shirt' || value.upperBody === 'tshirt' ? value.upperBody : null;
  const colour = typeof value.upperColor === 'string' ? value.upperColor.trim().toLowerCase() : '';
  const upperColor = upperBody && HEX.test(colour) ? colour : null;
  return { schemaVersion: 1, pantsColor, upperBody, upperColor };
}

/**
 * A mesh's part name: Babylon names a glTF mesh with several primitives `Name_primitive0`, `Name_primitive1`;
 * a name like `mesh_3` or `Top_shirt_2` is the parent's part (rocketbox-avatar.js `label`).
 * @param {string} name the mesh's name
 * @param {string | null} [parentName]
 */
export function partName(name, parentName = null) {
  const own = String(name ?? '').replace(/_primitive\d+$/, '');
  if (ALL_OUTFIT_PARTS.includes(own) || own === 'Body' || own === 'Hair') return own;
  if (parentName && (/^mesh_\d/.test(own) || /_\d+$/.test(own))) return partName(parentName);
  return own;
}

/**
 * What a character file shows and how its parts are tinted, for a person's clothing.
 * `parts` = the part names the file has. null = leave the file as it is (not a Rocketbox outfit file).
 * @param {string | undefined} outfit the manifest's `outfit` ('rocketbox')
 * @param {unknown} clothing the person's clothing (cleanClothing; none = DEFAULT_CLOTHING)
 * @param {Iterable<string>} parts
 * @returns {{ wear: 'formal' | 'ownFormal' | 'shirt' | 'tshirt', hidden: string[], tints: Record<string, string>, key: string } | null}
 */
export function outfitLook(outfit, clothing, parts) {
  if (outfit !== 'rocketbox') return null;
  const have = new Set(parts);
  const c = cleanClothing(clothing) ?? DEFAULT_CLOTHING;
  const suit = have.has('Outfit_formal') ? 'formal' : 'ownFormal';
  const has = (wear) => OUTFIT_PARTS[wear].every((p) => have.has(p));
  // a garment the file doesn't have = the suit (the Wardrobe refuses it; an old save may still ask for it)
  let wear = c.upperBody ?? suit;
  if (!has(wear)) wear = suit;
  if (!has(wear)) return null; // not an outfit file after all: show it as it is
  const shown = new Set(OUTFIT_PARTS[wear]);
  const hidden = ALL_OUTFIT_PARTS.filter((p) => have.has(p) && !shown.has(p));
  const tints = {};
  if (shown.has('Trousers')) tints.Trousers = TROUSER_TINTS[c.pantsColor];
  const top = wear === 'shirt' ? 'Top_shirt' : wear === 'tshirt' ? 'Top_tee' : null;
  if (top && c.upperColor) tints[top] = c.upperColor;
  const key = [wear, ...Object.entries(tints).map(([p, hex]) => `${p}=${hex}`)].join('|');
  return { wear, hidden, tints, key };
}

/** A colour #rrggbb as [r, g, b] in 0..1 (sRGB, as the Wardrobe's three.js Color reads it). */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
