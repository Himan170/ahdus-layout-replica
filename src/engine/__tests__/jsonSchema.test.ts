import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { layoutJsonSchema } from '../model/jsonSchema';
import { loadLayout } from '../model/migrate';
import sampleFile from '../../../embed-sample.ahdus.json';

// The AHDUS backend validates with Python's jsonschema (draft-07, formats not checked by default);
// Ajv is the same check here. uuid is the one format the schema uses.
function validator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return ajv.compile(layoutJsonSchema());
}

/** embed-sample.ahdus.json as v2 JSON, the way Studio sends it to the AHDUS API. */
function sampleV2() {
  // A fresh copy each time (tests change it); `any`: the tests poke at fields freely
  return JSON.parse(JSON.stringify(loadLayout(structuredClone(sampleFile)))) as any;
}

describe('layoutJsonSchema (npm run schema:json)', () => {
  it('is a draft-07 JSON Schema of the v2 layout', () => {
    const schema = layoutJsonSchema();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties as object)).toEqual(expect.arrayContaining(
      ['schemaVersion', 'floors', 'rooms', 'openings', 'objects', 'anchors', 'routes', 'floorLinks']));
    expect(schema.required).toEqual(['schemaVersion']);
  });

  it('accepts the layout in embed-sample.ahdus.json', () => {
    const validate = validator();
    const layout = sampleV2();
    expect(layout.rooms.length).toBeGreaterThan(0);
    expect(layout.objects.length).toBeGreaterThan(0);
    const ok = validate(layout);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('accepts unknown fields, as Zod does (it drops them)', () => {
    const layout = sampleV2();
    layout.rooms[0].addedLater = true;
    expect(validator()(layout)).toBe(true);
  });

  it('refuses what LayoutSchema refuses', () => {
    const validate = validator();
    expect(validate({ ...sampleV2(), schemaVersion: 1 })).toBe(false);
    const thin = sampleV2();
    thin.rooms[0].wallThickness = 0.05;
    expect(validate(thin)).toBe(false);
    const badId = sampleV2(); // Python's jsonschema checks formats only with a FormatChecker
    badId.anchors = [{ id: 'not-a-uuid', kind: 'seat', floorId: 0, position: { x: 0, y: 0, z: 0 } }];
    expect(validate(badId)).toBe(false);
    expect(validate({ rooms: [] })).toBe(false);
  });
});

describe("a room's lock (v0.15.6)", () => {
  it('is an optional boolean `locked`: written only when true, so old files stay the same', () => {
    const schema = layoutJsonSchema() as any;
    const roomProps = schema.properties.rooms.items.properties;
    expect(roomProps.locked).toEqual({ type: 'boolean' });
    expect(schema.properties.rooms.items.required ?? []).not.toContain('locked');

    const plain = loadLayout(structuredClone(sampleFile));
    expect(plain.rooms.every((r: any) => !('locked' in r))).toBe(true);

    const save = structuredClone(sampleFile) as any;
    const rooms = save.layout?.rooms ?? save.rooms;
    rooms[0].isLocked = true;
    const v2 = JSON.parse(JSON.stringify(loadLayout(save)));
    expect(v2.rooms.find((r: any) => r.locked)).toBeDefined();
    expect(validator()(v2)).toBe(true);
    const bad = sampleV2();
    bad.rooms[0].locked = 'yes';
    expect(validator()(bad)).toBe(false);
  });
});

describe('doors, windows and glass (v0.18.1)', () => {
  it('only optional fields; the room type list stays the one older servers know', () => {
    const schema = layoutJsonSchema() as any;
    const room = schema.properties.rooms.items;
    const opening = schema.properties.openings.items;
    expect(room.properties.type.enum).not.toContain('CAFETERIA');
    expect(room.properties.subtype).toEqual({ type: 'string', maxLength: 40 });
    expect(room.properties.glassWalls.items.enum).toEqual(['north', 'south', 'east', 'west']);
    expect(room.properties.glassOnFirstDoor).toEqual({ type: 'boolean' });
    expect(opening.properties.style).toEqual({ type: 'string', maxLength: 40 });
    expect(opening.properties.swing.enum).toEqual(['in', 'out']);
    for (const f of ['subtype', 'glassWalls', 'glassOnFirstDoor']) expect(room.required ?? []).not.toContain(f);
    for (const f of ['style', 'swing']) expect(opening.required ?? []).not.toContain(f);

    const v2 = sampleV2();
    v2.rooms[0] = { ...v2.rooms[0], type: 'CUSTOM', subtype: 'CAFETERIA', glassWalls: ['south'], glassOnFirstDoor: true };
    expect(validator()(v2)).toBe(true);
    v2.rooms[0].glassWalls = ['up'];
    expect(validator()(v2)).toBe(false);
  });
});
