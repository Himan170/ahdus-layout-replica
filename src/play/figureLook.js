/**
 * play/figureLook.js — PURE (v0.17.2): the colours of a person's SIMPLE figure (the one drawn when the
 * full-character limit is reached, or before their file has loaded), so a full office doesn't look like grey
 * dummies: the top in their outfit's main colour, the trousers in theirs, the head a neutral mannequin grey.
 * Tests: play/__tests__/figureLook.test.js. Used by engine/systems/CharacterSystem.ts (thin-instance colours).
 *
 * In this order:
 *  1. The Wardrobe's clothing (play/outfit.js cleanClothing): a shirt / T-shirt in its colour (a shirt with no
 *     colour: white), trousers black / blue (outfit.TROUSER_TINTS); Office formal = a suit (top and trousers alike).
 *  2. The character file's own colours, when the manifest gives them (`colors: { top, bottom }`, '#rrggbb').
 *  3. A Rocketbox outfit file with no clothing = Office formal: a suit.
 *  4. Else a calm office colour picked by the person's id (FNV-1a, never the name: the same on every device).
 */
import { cleanClothing, hexToRgb, TROUSER_TINTS } from './outfit.js';

/** Suits (Office formal): charcoal, navy, mid grey, brown grey. */
export const SUITS = Object.freeze(['#3f4552', '#2f3d5c', '#666d78', '#5a5047']);
/** Tops when nothing is known: soft blue, teal, burgundy, mustard, sage, off-white, lavender, terracotta. */
export const TOPS = Object.freeze(['#6f8fb8', '#4f8f86', '#8a4b57', '#c49a46', '#8fa883', '#e4e7ec', '#8c7fb0', '#c27a62']);
/** Trousers when nothing is known: charcoal, navy, khaki, grey. */
export const TROUSERS = Object.freeze(['#3a3b40', '#2c3e6b', '#857a60', '#5c616b']);
/** A shirt with no colour chosen. */
export const WHITE_SHIRT = '#eef0f3';

const HEX = /^#[0-9a-f]{6}$/;

/** FNV-1a of a string (as characterManifest's idHash). */
function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const pick = (list, h) => list[h % list.length];
const hex = (v) => (typeof v === 'string' && HEX.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);

/**
 * @param {{ personId: string, clothing?: unknown, character?: { outfit?: string, colors?: { top?: string, bottom?: string } } | null }} person
 * @returns {{ top: string, bottom: string, from: 'clothing' | 'file' | 'suit' | 'id' }}
 */
export function figureColors(person) {
  const h = hash(person?.personId);
  const clothing = cleanClothing(person?.clothing);
  const suit = () => { const c = pick(SUITS, h); return { top: c, bottom: c }; };
  if (clothing) {
    if (!clothing.upperBody) return { ...suit(), from: 'clothing' };
    const top = clothing.upperColor ?? (clothing.upperBody === 'shirt' ? WHITE_SHIRT : pick(TOPS, h));
    return { top, bottom: TROUSER_TINTS[clothing.pantsColor], from: 'clothing' };
  }
  const own = person?.character?.colors;
  const ownTop = hex(own?.top);
  if (ownTop) return { top: ownTop, bottom: hex(own?.bottom) ?? ownTop, from: 'file' };
  if (person?.character?.outfit === 'rocketbox') return { ...suit(), from: 'suit' };
  return { top: pick(TOPS, h), bottom: pick(TROUSERS, h >>> 8), from: 'id' };
}

/** '#rrggbb' → [r, g, b, 1] for a thin-instance colour buffer. */
export function rgba(colour) {
  return [...hexToRgb(colour), 1];
}

/** A manifest's `colors` as kept ({ top, bottom } of '#rrggbb'), or null. */
export function cleanColors(value) {
  if (!value || typeof value !== 'object') return null;
  const top = hex(value.top);
  if (!top) return null;
  const bottom = hex(value.bottom);
  return bottom ? { top, bottom } : { top };
}
