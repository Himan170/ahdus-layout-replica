// The AHDUS look's library panel (ui/library.js, pure): tiles, chips, search, where a tile lands.
import { describe, it, expect } from 'vitest';
import {
  ROOM_TILES, filterRooms, FURNITURE_CHIPS, FURNITURE_TILES, filterFurniture, chipOf, MODEL_COUNT,
  templateDetail, footprintAt, planRoomDrop,
} from '../library';
import { LAYOUT_TEMPLATES } from '../../templates';

const room = (id, x, z, width, depth, extra = {}) => ({ id, name: id, type: 'OFFICE', floor: 0, x, z, width, depth, ...extra });

describe('room tiles', () => {
  it('one per room type, with its default size', () => {
    const office = ROOM_TILES.find((t) => t.roomType === 'OFFICE');
    expect(office).toMatchObject({ label: 'Office', width: 6, depth: 5, sizeText: '6 × 5 m' });
  });

  it('search by name, any case', () => {
    expect(filterRooms('meet').map((t) => t.roomType)).toEqual(['MEETING']);
    expect(filterRooms('  ')).toHaveLength(ROOM_TILES.length);
    expect(filterRooms('zzz')).toEqual([]);
  });
});

describe('furniture tiles', () => {
  it('every item is in exactly one chip, and every chip has items', () => {
    for (const t of FURNITURE_TILES) expect(FURNITURE_CHIPS).toContain(t.chip);
    for (const c of FURNITURE_CHIPS) expect(FURNITURE_TILES.some((t) => t.chip === c), c).toBe(true);
  });

  it('a chip lists its items, real models first', () => {
    const desks = filterFurniture('', 'Desks');
    expect(desks.map((t) => t.assetType)).toContain('DESK_STANDARD');
    expect(desks.every((t) => t.chip === 'Desks')).toBe(true);
    const firstWithout = desks.findIndex((t) => !t.thumb);
    if (firstWithout >= 0) expect(desks.slice(firstWithout).every((t) => !t.thumb)).toBe(true);
  });

  it('search looks in every chip', () => {
    const found = filterFurniture('fridge', 'Desks');
    expect(found.map((t) => t.assetType)).toEqual(['FRIDGE']);
    expect(filterFurniture('kitchen', 'Plants').every((t) => t.chip === 'Kitchen')).toBe(true);
  });

  it('size and picture of the desk', () => {
    const desk = FURNITURE_TILES.find((t) => t.assetType === 'DESK_STANDARD');
    expect(desk).toMatchObject({ width: 1.6, depth: 0.8, sizeText: '1.6 × 0.8 m', thumb: 'thumbs/desk.webp' });
    expect(FURNITURE_TILES.find((t) => t.assetType === 'CNC_MACHINE')?.thumb ?? null).toBeNull();
    expect(MODEL_COUNT).toBe(28); // the tiles with a picture (Reception Desk: of its primitive model)
  });

  it('sofas sit in Seating, unknown types in More', () => {
    expect(chipOf('SOFA_3')).toBe('Seating');
    expect(chipOf('CNC_MACHINE')).toBe('More');
  });
});

describe('templates', () => {
  it('"N rooms · N floors" from the layout', () => {
    expect(templateDetail({ rooms: [{}, {}], floors: { 0: {} } })).toBe('2 rooms · 1 floor');
    expect(templateDetail({ rooms: {}, floors: {} })).toBe('0 rooms · 1 floor');
    for (const t of LAYOUT_TEMPLATES) expect(templateDetail(t.layout)).toMatch(/^\d+ rooms? · \d+ floors?$/);
  });
});

describe('where a tile lands', () => {
  it('centred on the point, the centre on the grid step', () => {
    expect(footprintAt({ x: 1.26, z: -0.74 }, 1.6, 0.8, { snapStep: 0.5 })).toEqual({ x: 1.5, z: -0.5, width: 1.6, depth: 0.8 });
    expect(footprintAt({ x: 1.26, z: 2 }, 1.6, 0.8)).toEqual({ x: 1.26, z: 2, width: 1.6, depth: 0.8 });
  });

  it('Shift keeps it square (the longer side)', () => {
    expect(footprintAt({ x: 0, z: 0 }, 6, 5, { square: true })).toMatchObject({ width: 6, depth: 6 });
  });

  it('a room tile on an empty floor is a room of its default size there', () => {
    const office = ROOM_TILES.find((t) => t.roomType === 'OFFICE');
    const plan = planRoomDrop(office, { x: 10, z: 10 }, []);
    expect(plan.blocker).toBeNull();
    expect(plan.rect).toEqual({ x: 10, z: 10, width: 6, depth: 5 });
  });

  it('dropped onto another room it is blocked; near one it snaps back to back', () => {
    const office = ROOM_TILES.find((t) => t.roomType === 'OFFICE');
    const there = room('A', 0, 0, 6, 5);
    expect(planRoomDrop(office, { x: 3, z: 0 }, [there]).blocker?.id).toBe('A');
    // its west edge 0.2 m from A's east edge: snaps back to back (one wall thickness, 0.15 m, apart)
    const plan = planRoomDrop(office, { x: 6.2, z: 0 }, [there]);
    expect(plan.blocker).toBeNull();
    expect(plan.rect.x - plan.rect.width / 2).toBeCloseTo(3.15, 5);
  });
});
