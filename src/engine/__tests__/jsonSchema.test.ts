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
