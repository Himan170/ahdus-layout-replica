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

  it('a catalog pick with an empty hand goes into the first empty slot, else slot 3', () => {
    expect(catalogSlot(DEFAULT_HOTBAR, 4)).toBe(4);
    expect(catalogSlot(DEFAULT_HOTBAR, EMPTY_HAND)).toBe(2);
    const bar = [...DEFAULT_HOTBAR];
    bar[5] = null;
    expect(catalogSlot(bar, EMPTY_HAND)).toBe(5);
  });
});

// v0.15.2: a short name under each hotbar icon, and every room type its own icon
describe('shortLabel (the name under a hotbar icon)', () => {
  it('the default hotbar fixes Edit and Stretch in slots 1 and 2', async () => {
    const { shortLabel } = await import('../hotbarItems');
    expect(DEFAULT_HOTBAR.map(shortLabel)).toEqual(
      ['Edit', 'Stretch', 'Office', 'Door', 'Window', 'Desk', 'Chair', 'Stairs', 'Meeting']);
  });

  it('every item of the catalog has a name of at most 10 characters; an empty slot has none', async () => {
    const { shortLabel, SHORT_NAME_MAX, catalogSections } = await import('../hotbarItems');
    for (const section of catalogSections()) {
      for (const item of section.items) {
        const name = shortLabel(item);
        expect(name.length, `${item.label} → ${name}`).toBeGreaterThan(0);
        expect(name.length, `${item.label} → ${name}`).toBeLessThanOrEqual(SHORT_NAME_MAX);
      }
    }
    expect(shortLabel(null)).toBe('');
  });

  it('rooms lose "Room" and "Area": Server, Production, Restroom', async () => {
    const { shortLabel } = await import('../hotbarItems');
    const name = (roomType) => shortLabel(ROOM_ITEMS.find((i) => i.roomType === roomType));
    expect([name('SERVER_ROOM'), name('PRODUCTION'), name('RESTROOM'), name('RECEPTION')])
      .toEqual(['Server', 'Production', 'Restroom', 'Reception']);
  });
});

describe('room icons', () => {
  it('every room type has its own icon in the hotbar and the catalog', async () => {
    const { itemIcon } = await import('../../ui/tools');
    const icons = ROOM_ITEMS.map((item) => itemIcon(item));
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(ROOM_ITEMS.length);
  });
});


describe('fixed utility slots', () => {
  it('catalog furniture cannot replace Edit or Stretch', () => {
    for (const selected of [0, 1]) expect(catalogSlot(DEFAULT_HOTBAR, selected, { kind: 'object' })).toBe(2);
    const bar = [...DEFAULT_HOTBAR]; bar[5] = null;
    expect(catalogSlot(bar, 0, { kind: 'room' })).toBe(5);
  });
  it('choosing Edit or Stretch in the catalog selects its fixed slot', () => {
    expect(catalogSlot(DEFAULT_HOTBAR, 7, { kind: 'edit' })).toBe(0);
    expect(catalogSlot(DEFAULT_HOTBAR, 7, { kind: 'stretch' })).toBe(1);
  });
});
