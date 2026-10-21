import { describe, it, expect } from 'vitest';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { loadLayout, migrateV1toV2 } from '../model/migrate';
import { syncAnchors, anchorId } from '../model/anchors';

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
        width: 10, depth: 8, wallHeight: 4, color: '#e05252', doors: [] },
      { id: 'room_3', type: 'CORRIDOR', name: 'Corridor', floor: 0, x: 0, z: 6,
        width: 10, depth: 2, wallHeight: 3, color: '#8899aa', doors: [] },
    ],
    objects: [
      { id: 'obj_1', assetType: 'DESK_STANDARD', name: 'DESK_STANDARD 1', category: 'furniture',
        floor: 0, roomId: 'room_1', x: 1, y: 0, z: 1, rotationX: 0, rotationY: 0, rotationZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: true, isSelected: false, metadata: {} },
      { id: 'obj_2', assetType: 'RECEPTION_DESK', name: 'Front desk', floor: 0, roomId: null,
        x: 0, y: 0, z: -5, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false },
      { id: 'obj_3', assetType: 'SERVER_RACK', name: 'Rack A', floor: 0, roomId: 'room_2',
        x: 10, y: 0, z: 0, rotationY: Math.PI / 2, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false },
      { id: 'obj_4', assetType: 'CHAIR_OFFICE', name: 'Chair', floor: 0, roomId: 'room_1',
        x: 1, y: 0, z: 0.4, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false },
    ],
  };
}

describe('v1 → v2 migration', () => {
  it('keeps the real room types instead of turning them into CUSTOM', () => {
    const layout = loadLayout(v1Fixture());
    expect(layout.rooms.map((r) => r.type)).toEqual(['MEETING', 'PRODUCTION', 'CORRIDOR']);
  });

  it('keeps the lock flag (v1 calls it isLocked)', () => {
    const layout = loadLayout(v1Fixture());
    expect(layout.objects.find((o) => o.id === 'obj_1')!.locked).toBe(true);
  });

  it('uses the object name as label and keeps extra v1 fields in metadata', () => {
    const layout = loadLayout(v1Fixture());
    const desk = layout.objects.find((o) => o.id === 'obj_1')!;
    expect(desk.label).toBe('DESK_STANDARD 1');
    // name too: it isn't the label (that was empty), so toV1 can give both back
    expect(desk.metadata).toEqual({ category: 'furniture', name: 'DESK_STANDARD 1' });
  });

  it('reads an exported layout file (the layout is inside it)', () => {
    const file = { format: 'ahdus-layout', formatVersion: 1, layout: v1Fixture() };
    expect(loadLayout(file).rooms.map((r) => r.id)).toEqual(loadLayout(v1Fixture()).rooms.map((r) => r.id));
  });

  it('converts doors to openings with stable IDs', () => {
    const a = loadLayout(v1Fixture()).openings;
    const b = loadLayout(v1Fixture()).openings;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ roomId: 'room_1', wall: 'south', offset: 0.5 });
    expect(a[0].id).toBe(b[0].id);
  });

  it('converts windows to openings with their sill height', () => {
    const f = v1Fixture();
    (f.rooms[1] as any).windows = [{ wall: 'east', offset: 1, width: 1.5, height: 1.2, sill: 1 }];
    const w = loadLayout(f).openings.find((o) => o.kind === 'window')!;
    expect(w).toMatchObject({ roomId: 'room_2', wall: 'east', offset: 1, width: 1.5, sillHeight: 1 });
  });

  it('accepts the live store shape (id-keyed records) as well as arrays', () => {
    const f = v1Fixture();
    const asRecords = {
      ...f,
      rooms: Object.fromEntries(f.rooms.map((r) => [r.id, r])),
      objects: Object.fromEntries(f.objects.map((o) => [o.id, o])),
    };
    expect(loadLayout(asRecords)).toEqual(loadLayout(f));
  });

  it('a migrated layout loads again unchanged (v2 round-trip)', () => {
    const once = loadLayout(v1Fixture());
    const twice = loadLayout(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('preserves room finishes and unrelated anchors, routes, and floor links', () => {
    const f: any = v1Fixture();
    f.rooms[0].floorFinish = 'carpet';
    f.rooms[0].departmentRef = 'engineering';
    f.anchors = [{
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'info-point',
      floorId: 0,
      roomId: 'room_1',
      position: { x: 1, y: 0, z: 2 },
      rotationY: 0,
      label: 'Safety board',
    }];
    f.routes = [{
      id: 'route-1', floorId: 0, kind: 'accessible', label: 'Main route',
      waypoints: [{ x: 0, y: 0, z: 0 }],
    }];
    f.floorLinks = [{ id: 'link-1', kind: 'stairs', fromObjectId: 'obj_1', toObjectId: 'obj_2' }];
    f.anchorData = { [anchorId('obj_1', 'workstation')]: { positionRef: 'POSITION-42' } };

    const loaded = loadLayout(f);
    expect(loaded.rooms[0]).toMatchObject({ floorFinish: 'carpet', departmentRef: 'engineering' });
    expect(loaded.anchors).toContainEqual(expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111', label: 'Safety board',
    }));
    expect(loaded.anchors.find((a) => a.objectId === 'obj_1')?.positionRef).toBe('POSITION-42');
    expect(loaded.routes).toEqual(f.routes);
    expect(loaded.floorLinks).toEqual(f.floorLinks);
    expect(loadLayout(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
  });

  it('rejects corrupt v2 data with a readable error instead of rendering it', () => {
    const bad = JSON.parse(JSON.stringify(loadLayout(v1Fixture())));
    bad.objects[0].x = 'oops';
    expect(() => loadLayout(bad)).toThrow(/objects.*x/s);
  });

  it('rejects malformed legacy room geometry and routes through the v2 schema', () => {
    const badRoom = v1Fixture();
    (badRoom.rooms[0] as any).width = 'wide';
    expect(() => loadLayout(badRoom)).toThrow(/rooms.*width/s);

    const badRoute = { ...v1Fixture(), routes: [{ id: 'route-bad' }] };
    expect(() => loadLayout(badRoute)).toThrow(/routes/);
  });
});

describe('anchors', () => {
  it('anchor IDs are the same every time the layout is loaded', () => {
    const a = loadLayout(v1Fixture()).anchors.map((x) => x.id).sort();
    const b = loadLayout(v1Fixture()).anchors.map((x) => x.id).sort();
    expect(a).toEqual(b);
    expect(a).toContain(anchorId('obj_1', 'workstation'));
  });

  it('reception desk gets a reception anchor only (not a workstation)', () => {
    const anchors = loadLayout(v1Fixture()).anchors.filter((a) => a.objectId === 'obj_2');
    expect(anchors.map((a) => a.kind)).toEqual(['reception']);
  });

  it('creates the expected kinds for desk, chair and machine', () => {
    const kinds = Object.fromEntries(
      ['obj_1', 'obj_3', 'obj_4'].map((id) => [
        id,
        loadLayout(v1Fixture()).anchors.filter((a) => a.objectId === id).map((a) => a.kind),
      ]),
    );
    expect(kinds).toEqual({ obj_1: ['workstation'], obj_3: ['machine'], obj_4: ['seat'] });
  });

  it('"in front of the machine" rotates with the machine, matching Babylon', () => {
    const layout = loadLayout(v1Fixture());
    const rack = layout.objects.find((o) => o.id === 'obj_3')!;
    const anchor = layout.anchors.find((a) => a.objectId === 'obj_3')!;

    const expected = Vector3.TransformCoordinates(
      new Vector3(0, 0, 0.8),
      Matrix.RotationY(rack.rotationY).multiply(Matrix.Translation(rack.x, rack.y, rack.z)),
    );
    expect(anchor.position.x).toBeCloseTo(expected.x, 6);
    expect(anchor.position.z).toBeCloseTo(expected.z, 6);
  });

  it('anchors follow their object and keep data teammates wrote on them', () => {
    const layout = loadLayout(v1Fixture());
    const ws = layout.anchors.find((a) => a.kind === 'workstation')!;
    ws.positionRef = 'position-engineering-head';      // Yashashwi's module
    ws.label = 'Engineering Head desk';

    const desk = layout.objects.find((o) => o.id === 'obj_1')!;
    desk.x = 7;
    desk.roomId = 'room_2';
    layout.anchors = syncAnchors(layout);

    const moved = layout.anchors.find((a) => a.id === ws.id)!;
    expect(moved.position.x).toBe(7);
    expect(moved.roomId).toBe('room_2');
    expect(moved.positionRef).toBe('position-engineering-head');
    expect(moved.label).toBe('Engineering Head desk');
  });

  it('deleting an object removes its anchors but keeps manual ones', () => {
    const layout = loadLayout(v1Fixture());
    layout.anchors.push({
      id: '11111111-1111-4111-8111-111111111111', kind: 'info-point', floorId: 0,
      roomId: null, position: { x: 0, y: 0, z: 0 }, rotationY: 0,
    });
    layout.objects = layout.objects.filter((o) => o.id !== 'obj_3');
    layout.anchors = syncAnchors(layout);

    expect(layout.anchors.some((a) => a.objectId === 'obj_3')).toBe(false);
    expect(layout.anchors.some((a) => a.kind === 'info-point')).toBe(true);
  });

  it('migrateV1toV2 output already validates against the schema', () => {
    expect(() => loadLayout(migrateV1toV2(v1Fixture()))).not.toThrow();
  });
});
