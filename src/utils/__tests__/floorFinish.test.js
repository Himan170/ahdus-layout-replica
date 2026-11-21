// v0.18.6 (Astra audit 5a + 10): a chosen Wood floor is wood and a chosen Carpet floor carpet; a room that never
// chose a floor keeps the look it had (an Office's carpet photo, a Meeting room's parquet, a Cabin's walnut).
import { describe, it, expect } from 'vitest';
import { floorKindOf, floorChoiceOf, floorSwatch, FLOOR_FINISHES } from '../materialLibrary';
import { REALISTIC_SURFACES } from '../modelRegistry';

const photo = (room) => REALISTIC_SURFACES[`floor:${floorKindOf(room)}`];

describe('floor finishes', () => {
  it('Wood is the parquet photo and Carpet the carpet photo, in any room', () => {
    for (const type of ['OFFICE', 'MEETING', 'CABIN', 'RECEPTION']) {
      expect(photo({ type, floorFinish: 'wood' })).toBe('herringbone_parquet');
      expect(photo({ type, floorFinish: 'carpet' })).toBe('carpet_office');
      expect(photo({ type, floorFinish: 'tile' })).toBe('floor_tiles');
      expect(photo({ type, floorFinish: 'concrete' })).toBe('concrete_floor');
    }
  });
  it("a room's own floor (no choice, or 'default') looks as before", () => {
    expect(photo({ type: 'OFFICE' })).toBe('carpet_office');
    expect(photo({ type: 'OFFICE', floorFinish: 'default' })).toBe('carpet_office');
    expect(photo({ type: 'MEETING' })).toBe('herringbone_parquet');
    expect(floorKindOf({ type: 'CABIN' })).toBe('cabin');
    expect(floorKindOf({ type: 'OFFICE' })).toBe('wood'); // the old key: the same material as before
  });
  it("the Inspector's choice: one of the four, else Room default", () => {
    expect(floorChoiceOf({ type: 'CABIN' })).toBe('default');
    expect(floorChoiceOf({ type: 'CABIN', floorFinish: 'default' })).toBe('default');
    for (const f of FLOOR_FINISHES) expect(floorChoiceOf({ type: 'OFFICE', floorFinish: f })).toBe(f);
  });
  it('a swatch is the photo the floor is drawn with, and its tint', () => {
    expect(floorSwatch('woodFinish')).toMatchObject({ name: 'Wood', texture: 'textures/herringbone_parquet/color.jpg', tint: null });
    expect(floorSwatch('carpetFinish')).toMatchObject({ name: 'Carpet', texture: 'textures/carpet_office/color.jpg' });
    expect(floorSwatch('cabin')).toMatchObject({ name: 'Walnut', texture: 'textures/herringbone_parquet/color.jpg', tint: '#8a5638' });
  });
});
