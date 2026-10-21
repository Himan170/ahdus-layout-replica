import { describe, it, expect } from 'vitest';
import { loadLayout } from '../model/migrate';
import { toV1 } from '../model/toV1';
import { anchorId } from '../model/anchors';
import { normaliseLayout } from '../../store/layoutData';

/** Same shape that workspaceStore.exportWorkspace() produces today. */
function v1Fixture() {
  return {
    layoutName: 'Sharma Precision Works',
    layoutVersion: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', elevation: 0 } },
    rooms: [
      { id: 'room_1', type: 'MEETING', name: 'Meeting Room 1', floor: 0, x: 0, z: 0,
        width: 5, depth: 4, wallHeight: 3, color: '#38b764', isSelected: false,
        doors: [{ wall: 'south', offset: 0.5 }] },
      { id: 'room_2', type: 'PRODUCTION', name: 'Shop Floor', floor: 0, x: 10, z: 0,
        width: 10, depth: 8, wallHeight: 4, color: '#e05252', doors: [],
        windows: [{ wall: 'east', offset: 1, width: 1.5, height: 1.2, sill: 1 }] },
    ],
    objects: [
      { id: 'obj_1', assetType: 'DESK_STANDARD', name: 'DESK_STANDARD 1', category: 'furniture',
        floor: 0, roomId: 'room_1', x: 1, y: 0, z: 1, rotationX: 0, rotationY: 0, rotationZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: true, isSelected: false, metadata: {} },
      { id: 'obj_2', assetType: 'RECEPTION_DESK', name: 'Front desk', floor: 0, roomId: null,
        x: 0, y: 0, z: -5, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false },
    ],
    anchorData: {
      [anchorId('obj_1', 'workstation')]: { positionRef: 'POSITION-42' },
    },
  };
}

describe('toV1 — v2 → v1 conversion', () => {
  it('converts rooms back with v1 field names (floor, not floorId)', () => {
    const v2 = loadLayout(v1Fixture());
    const v1 = toV1(v2);
    expect(v1.rooms[0]).toMatchObject({
      id: 'room_1',
      type: 'MEETING',
      name: 'Meeting Room 1',
      floor: 0,       // v1 uses "floor", not "floorId"
      width: 5,
      depth: 4,
      wallHeight: 3,
      color: '#38b764',
    });
  });

  it('groups openings back into room.doors and room.windows', () => {
    const v2 = loadLayout(v1Fixture());
    const v1 = toV1(v2);
    expect(v1.rooms[0].doors).toHaveLength(1);
    expect(v1.rooms[0].doors[0]).toMatchObject({ wall: 'south', offset: 0.5 });
    expect(v1.rooms[0].windows).toHaveLength(0);

    expect(v1.rooms[1].windows).toHaveLength(1);
    expect(v1.rooms[1].windows[0]).toMatchObject({ wall: 'east', offset: 1, width: 1.5, sill: 1 });
  });

  it('converts objects back with isLocked, scaleX/Y/Z and category', () => {
    const v2 = loadLayout(v1Fixture());
    const v1 = toV1(v2);
    const desk = v1.objects.find((o) => o.id === 'obj_1')!;
    expect(desk.isLocked).toBe(true);
    expect(desk.scaleX).toBe(1);
    expect(desk.category).toBe('furniture');
    expect(desk.name).toBe('DESK_STANDARD 1');
  });

  it('drops elevation and keeps floor height', () => {
    const v2 = loadLayout(v1Fixture());
    const v1 = toV1(v2);
    const floor = v1.floors[0];
    expect(floor).toMatchObject({ id: 0, name: 'Ground Floor' });
    expect(floor.height).toBeGreaterThan(0);
    expect(floor).not.toHaveProperty('elevation');
  });

  it('rebuilds anchorData from the v2 anchors array', () => {
    const v2 = loadLayout(v1Fixture());
    const v1 = toV1(v2);
    const wsId = anchorId('obj_1', 'workstation');
    expect(v1.anchorData[wsId]).toMatchObject({ positionRef: 'POSITION-42' });
  });
});

describe('round-trip: v1 → v2 → v1 → v2', () => {
  it('v1 → v2 → v1 preserves rooms, objects and openings', () => {
    const v2First = loadLayout(v1Fixture());
    const v1Back = toV1(v2First);

    // Rooms
    expect(v1Back.rooms).toHaveLength(2);
    expect(v1Back.rooms[0].id).toBe('room_1');
    expect(v1Back.rooms[1].id).toBe('room_2');

    // Objects
    expect(v1Back.objects).toHaveLength(2);
    expect(v1Back.objects[0].id).toBe('obj_1');

    // Openings round-trip
    expect(v1Back.rooms[0].doors).toHaveLength(1);
    expect(v1Back.rooms[1].windows).toHaveLength(1);
  });

  it('v1 → v2 → v1 → v2 produces the same v2 layout', () => {
    const v2First = loadLayout(v1Fixture());
    const v1Back = toV1(v2First);
    const v2Second = loadLayout(v1Back);

    // Compare rooms (order should match)
    expect(v2Second.rooms.map((r) => r.id)).toEqual(v2First.rooms.map((r) => r.id));
    expect(v2Second.rooms.map((r) => r.type)).toEqual(v2First.rooms.map((r) => r.type));

    // Compare objects
    expect(v2Second.objects.map((o) => o.id)).toEqual(v2First.objects.map((o) => o.id));
    expect(v2Second.objects.map((o) => o.locked)).toEqual(v2First.objects.map((o) => o.locked));

    // Compare openings
    expect(v2Second.openings.map((o) => o.roomId)).toEqual(v2First.openings.map((o) => o.roomId));

    // Schema version
    expect(v2Second.schemaVersion).toBe(2);
  });

  it('already-v2 data round-trips through toV1 and back unchanged', () => {
    const v2 = loadLayout(v1Fixture());
    const roundTripped = loadLayout(toV1(v2));
    const roundTrippedAgain = loadLayout(toV1(roundTripped));

    expect(roundTrippedAgain.rooms).toEqual(roundTripped.rooms);
    expect(roundTrippedAgain.objects).toEqual(roundTripped.objects);
    expect(roundTrippedAgain.openings).toEqual(roundTripped.openings);
  });
});

/** A save as the app writes it today (floor heights, full door and window sizes). */
function currentSave() {
  return {
    layoutName: 'Two storeys',
    layoutVersion: 1,
    floors: {
      0: { id: 0, name: 'Ground Floor', height: 3.5 },
      1: { id: 1, name: 'Floor 1', height: 4 },
    },
    rooms: [
      { id: 'room_a', type: 'OFFICE', name: 'Office 1', floor: 0, x: 0, z: 0, width: 6, depth: 4,
        wallHeight: 3.2, color: '#4a7dff', floorFinish: 'carpet', departmentRef: 'DEPT-7',
        doors: [{ wall: 'south', offset: 1, width: 0.9, height: 2.1 }, { id: 'door-main', wall: 'east', offset: 0.5, width: 1.2, height: 2.2 }],
        windows: [{ wall: 'north', offset: 2, width: 1.4, height: 1.2, sill: 0.9 }] },
      { id: 'room_b', type: 'MEETING', name: 'Meeting 1', floor: 1, x: 0, z: 0, width: 6, depth: 4,
        wallHeight: 3.7, color: '#38b764', floorFinish: 'default', doors: [], windows: [] },
    ],
    objects: [
      { id: 'obj_desk', assetType: 'DESK_STANDARD', name: 'DESK_STANDARD 1', category: 'Furniture', floor: 0,
        roomId: 'room_a', x: 1, y: 0, z: 1, rotationX: 0, rotationY: 1.57, rotationZ: 0,
        scaleX: 1.2, scaleY: 1, scaleZ: 0.8, isLocked: false, label: '', department: '', metadata: {} },
      { id: 'obj_printer', assetType: 'PRINTER', name: 'PRINTER 1', category: 'Technology', floor: 1,
        roomId: 'room_b', x: -1, y: 0.75, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0.1,
        scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: true, label: 'Main printer', department: 'Admin',
        metadata: { serial: 'P-1' } },
    ],
    anchorData: { [anchorId('obj_desk', 'workstation')]: { positionRef: 'POSITION-1', label: 'Lead desk' } },
  };
}

describe('v1 → v2 → v1 gives back what the store keeps', () => {
  it('a current save comes back the same (after normaliseLayout, as the store loads it)', () => {
    const save = currentSave();
    const back = normaliseLayout(toV1(loadLayout(save)));
    const expected = normaliseLayout(save);
    expect(back.floors).toEqual(expected.floors);
    expect(back.rooms).toEqual(expected.rooms);
    expect(back.objects).toEqual(expected.objects);
    expect(back.anchorData).toEqual(expected.anchorData);
    expect(back.layoutName).toBe('Two storeys');
  });

  it('an empty label stays empty, and the name comes back (layoutBridge shows the label, else the asset name)', () => {
    const v1 = toV1(loadLayout(currentSave()));
    expect(v1.objects[0]).toMatchObject({ name: 'DESK_STANDARD 1', label: '' });
    expect(v1.objects[1]).toMatchObject({ name: 'PRINTER 1', label: 'Main printer' });
  });

  it('door ids made up by the migration are not written into the store', () => {
    const [room] = toV1(loadLayout(currentSave())).rooms;
    expect(room.doors[0]).not.toHaveProperty('id');
    expect(room.doors[1].id).toBe('door-main');
    expect(room.windows[0]).not.toHaveProperty('id');
  });
});

describe('v2 files from elsewhere', () => {
  it('floors with names for ids get the store\'s numbers, lowest first (the ground floor is 0)', () => {
    const v2 = loadLayout({
      schemaVersion: 2,
      floors: [
        { id: 'first', name: 'First', elevation: 3.5, height: 3.5 },
        { id: 'ground', name: 'Ground', elevation: 0, height: 3.5 },
      ],
      rooms: [{ id: 'r1', floorId: 'first', x: 0, z: 0, width: 4, depth: 4 }],
      objects: [{ id: 'o1', floorId: 'ground', assetType: 'DESK_STANDARD' }],
    });
    const v1 = toV1(v2);
    expect(v1.floors[0].name).toBe('Ground');
    expect(v1.floors[1].name).toBe('First');
    expect(v1.rooms[0].floor).toBe(1);
    expect(v1.objects[0].floor).toBe(0);
  });

  it('a v2 object without metadata comes back without it', () => {
    const v2 = loadLayout({
      schemaVersion: 2,
      floors: [{ id: 0, name: 'Ground Floor', elevation: 0, height: 3.5 }],
      objects: [{ id: 'o1', floorId: 0, roomId: null, assetType: 'DESK_STANDARD', label: 'Front desk' }],
    });
    expect(loadLayout(toV1(v2)).objects).toEqual(v2.objects);
  });
});

describe('multi-floor round-trip', () => {
  it('preserves floors, their heights and rooms on upper floors', () => {
    const input = {
      ...v1Fixture(),
      floors: {
        0: { id: 0, name: 'Ground Floor', height: 3.5 },
        1: { id: 1, name: 'First Floor', height: 4.0 },
      },
      rooms: [
        ...v1Fixture().rooms,
        { id: 'room_3', type: 'OFFICE', name: 'Office 1', floor: 1, x: 0, z: 0,
          width: 4, depth: 4, wallHeight: 3.2, color: '#4a90d9', doors: [] },
      ],
    };

    const v2 = loadLayout(input);
    const v1 = toV1(v2);

    expect(Object.keys(v1.floors)).toHaveLength(2);
    expect(v1.floors[0].height).toBe(3.5);
    expect(v1.floors[1].height).toBe(4.0);
    expect(v1.rooms.find((r) => r.id === 'room_3')?.floor).toBe(1);

    // Full round-trip
    const v2Again = loadLayout(v1);
    expect(v2Again.floors).toHaveLength(2);
    expect(v2Again.rooms.find((r) => r.id === 'room_3')?.floorId).toBe(1);
  });
});
