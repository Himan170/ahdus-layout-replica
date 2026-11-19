// v0.18.1: Cafeteria, Lounge, Cabin, Training Room, Lobby: every type everywhere (a fallback for older builds, a
// floor, an icon, a picture), and in Find, the browse menu, departments, the tour and the main entrance.
import { describe, it, expect } from 'vitest';
import { ROOM_TYPES } from '../../../utils/roomStore';
import { ROOM_TYPE_LIST } from '../../../engine/model/schema';
import { ROOM_TYPE_FALLBACK } from '../../../engine/model/roomTypes';
import { FLOOR_BY_ROOM_TYPE, FLOOR_TINTS, TILE_SIZE, floorKindOf } from '../../../utils/materialLibrary';
import { REALISTIC_SURFACES } from '../../../utils/modelRegistry';
import { ROOM_ICONS } from '../../../ui/tools';
import { ROOM_ITEMS } from '../../../play/hotbarItems';
import { buildPlaces, searchPlaces, roomDepartments, ROOM_TYPE_LABEL } from '../places';
import { browsePlaces, KIND_LABELS } from '../browse';
import { planTour } from '../tour';
import { mainEntrance } from '../entrance';
import { ASSET_TYPES } from '../../../utils/assetCatalog';

const NEW = ['CAFETERIA', 'LOUNGE', 'CABIN', 'TRAINING', 'LOBBY'];

/** Ground floor: a Lobby (the way in, from the south), a Cafeteria behind it, a Cabin and a Lounge east of it. */
function office() {
  const room = (id, type, name, x, z, w, d, doors) => ({
    id, type, name, floor: 0, x, z, width: w, depth: d, wallHeight: 3.2, wallThickness: 0.15, color: '#999',
    doors, windows: [],
  });
  return {
    layoutName: 'New types',
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
    rooms: [
      room('r_lobby', 'LOBBY', 'Main Lobby', 0, 0, 8, 6, [
        { wall: 'south', offset: 0, width: 1.4, height: 2.1 }, { wall: 'north', offset: 0, width: 1.2, height: 2.1 },
        { wall: 'east', offset: 0, width: 1.0, height: 2.1 },
      ]),
      room('r_cafe', 'CAFETERIA', 'Cafeteria', 0, 7, 8, 8, [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }]),
      room('r_cabin', 'CABIN', 'Cabin 1', 7, 0, 6, 6, [{ wall: 'west', offset: 0, width: 1.0, height: 2.1 }]),
      room('r_lounge', 'LOUNGE', 'Lounge', 7, 7, 6, 8, []),
    ],
    objects: [
      { id: 'd1', assetType: 'DESK_STANDARD', floor: 0, roomId: 'r_cabin', x: 8, z: 1, y: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationZ: 0 },
      { id: 'd2', assetType: 'DESK_STANDARD', floor: 0, roomId: 'r_cafe', x: 2, z: 9, y: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationZ: 0 },
    ],
  };
}
const PEOPLE = [
  { personId: 'p1', deskId: 'd1', name: 'Asha Patel', department: 'Finance' },
  { personId: 'p2', deskId: 'd2', name: 'Ravi Kumar', department: 'Kitchen staff' },
];

describe('every room type is complete (v0.18.1)', () => {
  it('each newer type has a fallback older builds know, and each older-build type is in the frozen list', () => {
    for (const type of Object.keys(ROOM_TYPES)) {
      const known = ROOM_TYPE_LIST.includes(type);
      expect(known || ROOM_TYPE_LIST.includes(ROOM_TYPE_FALLBACK[type]), `${type} would make older builds refuse the layout`).toBe(true);
    }
    expect(Object.keys(ROOM_TYPE_FALLBACK).every((t) => ROOM_TYPES[t])).toBe(true);
  });

  it('a label, an icon, a catalog item, Find label and its own floor (painted + photo)', () => {
    for (const type of NEW) {
      expect(ROOM_TYPES[type].label).toBeTruthy();
      expect(ROOM_ICONS[type], type).toBeTruthy();
      expect(ROOM_ITEMS.find((i) => i.roomType === type)?.icon).not.toBe('⬜');
      expect(ROOM_TYPE_LABEL[type]).toBe(ROOM_TYPES[type].label);
      expect(KIND_LABELS[type]).toBeTruthy();
      const kind = floorKindOf({ type });
      expect(FLOOR_BY_ROOM_TYPE[type]).toBe(kind);
      expect(FLOOR_TINTS[kind]).toBeTruthy();
      expect(TILE_SIZE[kind]).toBeGreaterThan(0);
      expect(REALISTIC_SURFACES[`floor:${kind}`]).toBeTruthy();
    }
    // five colours of their own
    expect(new Set(NEW.map((t) => FLOOR_TINTS[floorKindOf({ type: t })].tint)).size).toBe(5);
    expect(floorKindOf({ type: 'LOUNGE', floorFinish: 'concrete' })).toBe('concrete'); // a finish still wins
  });
});

describe('the newer types in Find, departments, the tour and the entrance', () => {
  it('Find: a cafeteria by "canteen", the nearest one while walking, the kinds menu', () => {
    const index = buildPlaces(office(), PEOPLE);
    const r = searchPlaces(index, 'canteen');
    expect(r.groups.facilities.map((p) => p.name)).toContain('Cafeteria');
    const walking = searchPlaces(index, 'cafeteria', { from: { x: 0, z: -6, floor: 0 } });
    expect(walking.groups.facilities[0].name).toMatch(/Nearest cafeteria|Cafeteria/);
    const menu = browsePlaces(index);
    expect(menu.chips.map((c) => c.label)).toContain('Cafeteria');
    expect(menu.kinds.map((k) => k.name)).toEqual(expect.arrayContaining(['Cafeterias', 'Lounges', 'Cabins', 'Lobby']));
  });

  it("departments: a cabin takes its person's, a cafeteria never one from its seats", () => {
    const deps = roomDepartments(office(), PEOPLE);
    expect(deps.get('r_cabin')).toBe('Finance');
    expect(deps.has('r_cafe')).toBe(false);
  });

  it("the main entrance is the Lobby's door; the tour's reception stop is the Lobby and it stops at the cafeteria", () => {
    const layout = office();
    expect(mainEntrance(layout, 0)?.room.id).toBe('r_lobby');
    const tour = planTour(layout, PEOPLE, [], { catalog: ASSET_TYPES });
    expect(tour.stops.find((s) => s.kind === 'reception')).toMatchObject({ name: 'Main Lobby' });
    expect(tour.stops.find((s) => s.kind === 'facility' && s.facility === 'CAFETERIA')).toMatchObject({ roomId: 'r_cafe' });
  });
});
