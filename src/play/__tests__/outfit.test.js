import { describe, expect, it } from 'vitest';
import {
  cleanClothing, outfitLook, partName, hexToRgb, TROUSER_TINTS, DEFAULT_CLOTHING, OUTFIT_PARTS, ALL_OUTFIT_PARTS,
} from '../outfit';

// A fitted-suit file (emma) and an own-suit file (aisha): the Rocketbox part names
const FITTED = ['Body', 'Hair', 'Outfit_formal', 'Skin_formal', 'Top_shirt', 'Skin_shirt', 'Top_tee', 'Skin_tee', 'Trousers', 'Shoes'];
const OWN = ['Body', 'Hair', 'Outfit_original', 'Skin_original', 'Top_shirt', 'Skin_shirt', 'Top_tee', 'Skin_tee', 'Trousers', 'Shoes'];

describe('cleanClothing', () => {
  it('keeps the four fields AHDUS saves, checked', () => {
    expect(cleanClothing({ schemaVersion: 1, pantsColor: 'blue', upperBody: 'shirt', upperColor: '#AA3300', email: 'x@y' }))
      .toEqual({ schemaVersion: 1, pantsColor: 'blue', upperBody: 'shirt', upperColor: '#aa3300' });
    expect(cleanClothing({ pantsColor: 'pink', upperBody: 'cape', upperColor: 'red' }))
      .toEqual(DEFAULT_CLOTHING);
    // a colour only goes with a shirt or T-shirt
    expect(cleanClothing({ upperBody: null, upperColor: '#ffffff' }).upperColor).toBeNull();
    expect(cleanClothing(null)).toBeNull();
    expect(cleanClothing('formal')).toBeNull();
    expect(cleanClothing([])).toBeNull();
  });
});

describe('partName', () => {
  it('Babylon primitives and numbered meshes are their part', () => {
    expect(partName('Trousers')).toBe('Trousers');
    expect(partName('Top_shirt_primitive1')).toBe('Top_shirt');
    expect(partName('mesh_3', 'Hair')).toBe('Hair');
    expect(partName('Body_2', 'Body')).toBe('Body');
    expect(partName('Glasses')).toBe('Glasses');
  });
});

describe('outfitLook: the Wardrobe\'s rules', () => {
  it('nobody chose: Office formal, the fitted suit, no tints', () => {
    const look = outfitLook('rocketbox', null, FITTED);
    expect(look.wear).toBe('formal');
    expect(look.hidden.sort()).toEqual(['Shoes', 'Skin_shirt', 'Skin_tee', 'Top_shirt', 'Top_tee', 'Trousers']);
    expect(look.tints).toEqual({});
  });

  it('an own suit when the file has no fitted one', () => {
    const look = outfitLook('rocketbox', DEFAULT_CLOTHING, OWN);
    expect(look.wear).toBe('ownFormal');
    expect(look.hidden).not.toContain('Outfit_original');
    expect(look.hidden).toContain('Top_tee');
  });

  it('a shirt: shirt, trousers and shoes, the trousers and the shirt tinted', () => {
    const look = outfitLook('rocketbox', { pantsColor: 'blue', upperBody: 'shirt', upperColor: '#336699' }, FITTED);
    expect(look.wear).toBe('shirt');
    expect(look.hidden.sort()).toEqual(['Outfit_formal', 'Skin_formal', 'Skin_tee', 'Top_tee']);
    expect(look.tints).toEqual({ Trousers: TROUSER_TINTS.blue, Top_shirt: '#336699' });
  });

  it('a T-shirt with no colour: only the trousers tinted (black by default)', () => {
    const look = outfitLook('rocketbox', { upperBody: 'tshirt' }, OWN);
    expect(look.wear).toBe('tshirt');
    expect(look.hidden.sort()).toEqual(['Outfit_original', 'Skin_original', 'Skin_shirt', 'Top_shirt']);
    expect(look.tints).toEqual({ Trousers: '#3a3b40' });
  });

  it('the same look = the same key (shared tinted materials)', () => {
    const a = outfitLook('rocketbox', { upperBody: 'shirt', upperColor: '#336699' }, FITTED);
    const b = outfitLook('rocketbox', { upperBody: 'shirt', upperColor: '#336699', pantsColor: 'black' }, OWN);
    const c = outfitLook('rocketbox', { upperBody: 'shirt', upperColor: '#336600' }, FITTED);
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  it('a garment the file lacks = its suit; a file with no outfit parts or not Rocketbox = as it is', () => {
    expect(outfitLook('rocketbox', { upperBody: 'tshirt' }, ['Body', 'Hair', 'Outfit_formal', 'Skin_formal']).wear).toBe('formal');
    expect(outfitLook('rocketbox', { upperBody: 'shirt' }, ['Body', 'outfit'])).toBeNull();
    // the older Mixamo characters and the imported ones: their own outfit, no trouser colours
    expect(outfitLook(undefined, { pantsColor: 'blue', upperBody: 'shirt' }, FITTED)).toBeNull();
  });

  it('the part lists match the Wardrobe (rocketbox-avatar.js OUTFIT_PARTS)', () => {
    expect(OUTFIT_PARTS.shirt).toEqual(['Top_shirt', 'Skin_shirt', 'Trousers', 'Shoes']);
    expect(OUTFIT_PARTS.formal).not.toContain('Shoes'); // the suits have their own shoes
    expect(ALL_OUTFIT_PARTS).toHaveLength(10);
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});
