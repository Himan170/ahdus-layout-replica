/**
 * model/jsonSchema.ts
 *
 * The Layout v2 format (LayoutSchema) as a JSON Schema (draft-07), for servers that
 * don't run our code: the AHDUS backend checks every saved layout against it with
 * Python's jsonschema. `npm run schema:json` writes it (scripts/schema-json.mjs);
 * `npm run build:ahdus` puts it in dist-ahdus/layout.schema.json.
 *
 * Generated, never written by hand: change schema.ts, not the JSON.
 * Not part of the app or the embed (nothing there imports this file).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { LayoutSchema } from './schema';

export function layoutJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(LayoutSchema, {
    target: 'jsonSchema7',
    // The format isn't recursive: every part written out in full is easier to read
    $refStrategy: 'none',
    // Zod drops unknown keys and accepts the layout, so the JSON Schema accepts them too
    // (a newer file with an extra field still saves on an older server)
    removeAdditionalStrategy: 'strict',
  }) as Record<string, unknown>;
  return {
    $schema: schema.$schema,
    title: 'AHDUS Workplace layout (v2)',
    $comment: 'Generated from src/engine/model/schema.ts (ahdus-layout-replica) by npm run schema:json. Do not edit.',
    ...schema,
  };
}
