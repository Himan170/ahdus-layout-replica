// Makes public/assets/env/sky.env from the HDRI sky: a prefiltered cube map
// (reflections + soft light at every roughness) that loads much faster than
// the .hdr (no filtering in the browser at start-up).
//
//   node scripts/prepare-assets.mjs     (copies sky_1k.hdr into public/assets/env/)
//   npm run dev                         (in another terminal)
//   node scripts/make-env.mjs [size=256] [image/webp|image/png]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const size = process.argv[2] ?? '256';
const type = process.argv[3] ?? 'image/webp';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('pageerror: ' + e.message));
await p.goto(`http://localhost:3000/scripts/make-env.html?size=${size}&type=${encodeURIComponent(type)}`);
await p.waitForFunction(() => window.__env, null, { timeout: 300000 });
const env = await p.evaluate(() => window.__env);
await b.close();
if (!env.ok) {
  console.error('Could not make sky.env: ' + env.error);
  process.exit(1);
}
const buf = Buffer.from(env.base64, 'base64');
writeFileSync('public/assets/env/sky.env', buf);
console.log(`public/assets/env/sky.env  ${(buf.length / 1024).toFixed(0)} KB (${size} px, ${type})`);
