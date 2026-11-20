// v0.18.1: the new room types, door / window styles and glass walls are new OPTIONAL fields only. What this build
// writes (the v2 layout: AHDUS saves, getLayout; the exported Studio file) must still load in v0.18.0 / v0.17.3, which
// check v2 against the frozen schema below, and must come back unchanged in this build.
import { describe, it, expect } from 'vitest';
import { loadLayout } from '../model/migrate';
import { toV1 } from '../model/toV1';
import { LayoutSchema as OldLayoutSchema } from './fixtures/schema-v0.18.0';
import { ROOM_TYPE_FALLBACK, fileRoomType, storeRoomType } from '../model/roomTypes';
import { normaliseLayout, fileLayout } from '../../store/layoutData';

const NEW_TYPES = ['CAFETERIA', 'LOUNGE', 'CABIN', 'TRAINING', 'LOBBY'];

/** A store-shaped layout (v1) with all of v0.18.1's new settings. */
function newLayout() {
  const rooms = NEW_TYPES.map((type, i) => ({
    id: `room_${type.toLowerCase()}`, type, name: `${type} 1`, floor: 0, x: i * 10, z: 0, width: 8, depth: 6,
    wallHeight: 3.2, wallThickness: 0.15, color: '#888', floorFinish: 'default',
    doors: [{ wall: 'south', offset: 0, width: 1.0, height: 2.1 }],
    windows: [],
  }));
  rooms.push({
    id: 'room_meet', type: 'MEETING', name: 'Glass meeting', floor: 0, x: 0, z: 20, width: 6, depth: 5,
    wallHeight: 3.2, wallThickness: 0.15, color: '#38b764', floorFinish: 'default',
    glassWalls: ['south', 'east'], glassOnFirstDoor: true,
    doors: [
      { wall: 'south', offset: -1.5, width: 1.0, height: 2.1, style: 'glass' },
      { wall: 'north', offset: 0, width: 1.8, height: 2.1, style: 'double-glass' },
      { wall: 'east', offset: 0, width: 1.8, height: 2.1, style: 'sliding-glass' },
      { wall: 'west', offset: 0, width: 1.0, height: 2.1, style: 'exit', swing: 'out' },
    ],
    windows: [
      { wall: 'south', offset: 1.5, width: 1.0, height: 2.2, sill: 0.3, style: 'tall' },
      { wall: 'north', offset: 2, width: 1.2, height: 3.1, sill: 0, style: 'panel' },
    ],
  } as any);
  return { layoutName: 'v0.18.1 sample', floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }], rooms, objects: [] };
}

describe('the v0.18.1 format in older builds (v0.18.0 / v0.17.3 schema)', () => {
  it('a v2 layout with every new setting passes the old schema, with the promised fallback types', () => {
    const v2 = JSON.parse(JSON.stringify(loadLayout(newLayout())));
    const old = OldLayoutSchema.parse(v2); // throws if an older embed would refuse it
    const byId = Object.fromEntries(old.rooms.map((r) => [r.id, r]));
    expect(byId.room_cafeteria.type).toBe('CUSTOM');
    expect(byId.room_lounge.type).toBe('CUSTOM');
    expect(byId.room_cabin.type).toBe('OFFICE');
    expect(byId.room_training.type).toBe('MEETING');
    expect(byId.room_lobby.type).toBe('RECEPTION');
    // sizes kept; the new fields dropped (the old build doesn't know them)
    const meet = old.openings.filter((o) => o.roomId === 'room_meet');
    expect(meet.map((o) => [o.kind, o.width, o.height, o.sillHeight])).toEqual([
      ['window', 1.0, 2.2, 0.3], ['window', 1.2, 3.1, 0], ['door', 1.0, 2.1, 0], ['door', 1.8, 2.1, 0],
      ['door', 1.8, 2.1, 0], ['door', 1.0, 2.1, 0],
    ]);
    expect((meet[0] as any).style).toBeUndefined();
    expect((byId.room_meet as any).glassWalls).toBeUndefined();
  });

  it('the exported Studio file names only types the old builds know', () => {
    const file = fileLayout(newLayout());
    for (const r of file.rooms as any[]) expect(['MEETING', 'CUSTOM', 'OFFICE', 'RECEPTION']).toContain(r.type);
    expect((file.rooms as any[]).find((r) => r.id === 'room_lobby')).toMatchObject({ type: 'RECEPTION', subtype: 'LOBBY' });
  });
});

describe('the v0.18.1 format in this build', () => {
  it('v1 → v2 → v1 keeps every new setting', () => {
    const v1 = toV1(loadLayout(newLayout()));
    const byId = Object.fromEntries(v1.rooms.map((r) => [r.id, r]));
    for (const t of NEW_TYPES) expect(byId[`room_${t.toLowerCase()}`].type).toBe(t);
    expect(byId.room_meet).toMatchObject({ glassWalls: ['south', 'east'], glassOnFirstDoor: true });
    expect(byId.room_meet.doors.map((d) => [d.style, d.swing])).toEqual([
      ['glass', undefined], ['double-glass', undefined], ['sliding-glass', undefined], ['exit', 'out'],
    ]);
    expect(byId.room_meet.windows.map((w) => w.style)).toEqual(['tall', 'panel']);
  });

  it('a v2 room typed CAFETERIA (a teammate\'s file) loads as a Cafeteria, written in the file form', () => {
    const v2 = JSON.parse(JSON.stringify(loadLayout(newLayout())));
    const room = v2.rooms.find((r: any) => r.id === 'room_cafeteria');
    room.type = 'CAFETERIA';
    delete room.subtype;
    const again = loadLayout(v2);
    expect(again.rooms.find((r) => r.id === 'room_cafeteria')).toMatchObject({ type: 'CUSTOM', subtype: 'CAFETERIA' });
    expect(toV1(again).rooms.find((r) => r.id === 'room_cafeteria')!.type).toBe('CAFETERIA');
  });

  it('a type no build knows yet reads as Custom, never an error', () => {
    const v2 = JSON.parse(JSON.stringify(loadLayout(newLayout())));
    v2.rooms[0].type = 'ROOFTOP_GARDEN';
    v2.openings[0].style = 'revolving';
    const again = loadLayout(v2);
    expect(again.rooms[0].type).toBe('CUSTOM');
    expect(again.openings[0].style).toBe('revolving'); // kept; drawn as the default door
  });

  it('the exported file and a local save read back with the real types and settings', () => {
    const back = normaliseLayout(JSON.parse(JSON.stringify(fileLayout(newLayout()))));
    const byId = Object.fromEntries(back.rooms.map((r: any) => [r.id, r]));
    for (const t of NEW_TYPES) expect(byId[`room_${t.toLowerCase()}`].type).toBe(t);
    expect(byId.room_lobby.subtype).toBeUndefined();
    expect(byId.room_meet.glassWalls).toEqual(['south', 'east']);
    expect(byId.room_meet.doors[3]).toMatchObject({ style: 'exit', swing: 'out' });
    const local = normaliseLayout(newLayout());
    expect(local.rooms.find((r: any) => r.id === 'room_cabin').type).toBe('CABIN');
  });

  it('layouts from v0.18.0 (no new fields) come back unchanged', () => {
    const plain = { layoutName: 'old', floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }], objects: [], rooms: [{
      id: 'r1', type: 'MEETING', name: 'Meeting Room 1', floor: 0, x: 0, z: 0, width: 5, depth: 4, wallHeight: 3.2,
      wallThickness: 0.15, color: '#38b764', floorFinish: 'default',
      doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [{ wall: 'north', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }],
    }] };
    const v2 = loadLayout(plain);
    expect(v2.rooms[0]).not.toHaveProperty('subtype');
    expect(v2.rooms[0]).not.toHaveProperty('glassWalls');
    expect(v2.openings.every((o) => !('style' in o) && !('swing' in o))).toBe(true);
    expect(toV1(v2).rooms[0]).toEqual(toV1(loadLayout(toV1(v2) as any)).rooms[0]);
    expect(normaliseLayout(plain).rooms[0]).not.toHaveProperty('glassWalls');
  });

  it('the type table', () => {
    expect(Object.keys(ROOM_TYPE_FALLBACK)).toEqual([...NEW_TYPES, 'LIFT']); // v0.18.3: the lift shaft
    expect(fileRoomType('OFFICE')).toEqual({ type: 'OFFICE' });
    expect(storeRoomType('CUSTOM', 'LOUNGE')).toBe('LOUNGE');
    expect(storeRoomType('CUSTOM', 'SPACESHIP')).toBe('CUSTOM');
  });
});

describe('lifts (v0.18.3) in older builds', () => {
  const liftLayout = () => ({
    layoutName: 'lifts', floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }, { id: 1, name: 'Floor 1', height: 3.5 }],
    rooms: [0, 1].map((floor) => ({
      id: `room_lift_${floor}`, type: 'LIFT', name: 'Lift shaft', floor, x: 4, z: 2, width: 2.2, depth: 2.2,
      wallHeight: 3.2, wallThickness: 0.15, color: '#7d8a93', floorFinish: 'default',
      doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [],
    })),
    objects: [],
  });

  it('a lift shaft is written as a Custom room + subtype LIFT, which the v0.18.0 schema accepts', () => {
    const v2 = JSON.parse(JSON.stringify(loadLayout(liftLayout())));
    const old = OldLayoutSchema.parse(v2);
    for (const r of old.rooms) expect(r.type).toBe('CUSTOM');
    expect(v2.rooms.map((r: any) => r.subtype)).toEqual(['LIFT', 'LIFT']);
    expect(fileLayout(liftLayout()).rooms.map((r: any) => [r.type, r.subtype])).toEqual([['CUSTOM', 'LIFT'], ['CUSTOM', 'LIFT']]);
  });

  it('comes back as a lift shaft in this build', () => {
    const v1 = toV1(loadLayout(liftLayout()));
    expect(v1.rooms.map((r) => r.type)).toEqual(['LIFT', 'LIFT']);
    expect(normaliseLayout(fileLayout(liftLayout())).rooms.map((r: any) => r.type)).toEqual(['LIFT', 'LIFT']);
  });
});

describe('L-shaped stairs (v0.18.3) in older builds', () => {
  const layout = () => ({
    layoutName: 'L stairs', floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }, { id: 1, name: 'Floor 1', height: 3.5 }],
    rooms: [], objects: [{
      id: 'obj_l', assetType: 'STAIRCASE', category: 'Architecture', floor: 0, x: 2, y: 0, z: 3, rotationX: 0, rotationY: 0, rotationZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1, metadata: { stairShape: 'L-left' },
    }],
  });

  it('is an ordinary STAIRCASE item (its shape in metadata), which the v0.18.0 schema accepts', () => {
    const v2 = JSON.parse(JSON.stringify(loadLayout(layout())));
    const old = OldLayoutSchema.parse(v2);
    const item = (old as any).objects.find((o: any) => o.id === 'obj_l');
    expect(item.assetType ?? item.type).toBe('STAIRCASE');
  });

  it('keeps its shape through v2, the exported file and back', () => {
    const v1 = toV1(loadLayout(layout()));
    expect(v1.objects.find((o) => o.id === 'obj_l')!.metadata).toMatchObject({ stairShape: 'L-left' });
    const again = normaliseLayout(fileLayout(layout()));
    expect((again.objects as any[]).find((o) => o.id === 'obj_l').metadata).toMatchObject({ stairShape: 'L-left' });
  });
});
