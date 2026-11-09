// The catalog's room names (v0.15.1) and Preview's empty hand at the start.
import { describe, expect, it } from 'vitest';
import { ROOM_ITEMS, roomItemLabel, EMPTY_HAND, nextSlot, catalogSlot, DEFAULT_HOTBAR } from '../hotbarItems';

describe('roomItemLabel', () => {
  it('adds " room" to a plain name', () => {
    expect(roomItemLabel('Office')).toBe('Office room');
    expect(roomItemLabel('Reception')).toBe('Reception room');
  });

  it('keeps names that already end in Room or Area', () => {
    expect(roomItemLabel('Meeting Room')).toBe('Meeting Room');
    expect(roomItemLabel('Server Room')).toBe('Server Room');
    expect(roomItemLabel('Production Area')).toBe('Production Area');
    expect(roomItemLabel('Restroom')).toBe('Restroom');
  });

  it('no catalog room says "room room" or "Area room"', () => {
    for (const item of ROOM_ITEMS) {
      expect(item.label).not.toMatch(/room room$/i);
      expect(item.label).not.toMatch(/area room$/i);
    }
  });
});

describe('the empty hand', () => {
  it('the wheel from an empty hand goes to the first or the last slot', () => {
    expect(nextSlot(EMPTY_HAND, 1)).toBe(0);
    expect(nextSlot(EMPTY_HAND, -1)).toBe(8);
    expect(nextSlot(0, -1)).toBe(8);
    expect(nextSlot(8, 1)).toBe(0);
    expect(nextSlot(3, 1)).toBe(4);
  });

  it('a catalog pick with an empty hand goes into the first empty slot, else slot 1', () => {
    expect(catalogSlot(DEFAULT_HOTBAR, 4)).toBe(4);
    expect(catalogSlot(DEFAULT_HOTBAR, EMPTY_HAND)).toBe(0);
    const bar = [...DEFAULT_HOTBAR];
    bar[5] = null;
    expect(catalogSlot(bar, EMPTY_HAND)).toBe(5);
  });
});
