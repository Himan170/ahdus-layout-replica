// Writes the Layout v2 JSON Schema (from the Zod LayoutSchema, src/engine/model/jsonSchema.ts):
//
//   npm run schema:json                    → dist-ahdus/layout.schema.json
//   node scripts/schema-json.mjs <file>    → <file>
//
// The AHDUS backend checks every saved layout against it (Python's jsonschema).
// schema.ts is TypeScript: Vite loads it (no build of the app needed).
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'dist-ahdus/layout.schema.json');
const vite = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { layoutJsonSchema } = await vite.ssrLoadModule('/src/engine/model/jsonSchema.ts');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(layoutJsonSchema(), null, 2) + '\n');
  console.log(`Layout JSON Schema → ${out}`);
} finally {
  await vite.close();
}
