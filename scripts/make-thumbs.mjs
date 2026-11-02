// Draws the library pictures (public/assets/thumbs/<name>.webp) with the app's own
// drawing: a headless Chromium opens the dev server and renders each item the way
// Studio does (scripts/thumbs-scene.js: its real model with "Realistic look", else its
// primitive model), seen from the front right. Each picture is cropped to the item,
// so small items (a mouse) fill their tile too. The list: modelRegistry.thumbnailList()
// (every type with a real model + PRIMITIVE_THUMBS).
//
//   npm run dev                          (in another terminal: the page needs it)
//   node scripts/make-thumbs.mjs [url]   (default http://localhost:3000/; CHROME = a Chromium binary)
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thumbnailList, THUMB_DIR } from '../src/utils/modelRegistry.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'public', 'assets', THUMB_DIR);
const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const PX = 160; // the longer side (a library tile shows it at most 56 px high, sharp on 2x screens)

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// A blank page on the dev server's address (not the app): the server only serves the modules
const blank = new URL('/__thumbs', url).href;
await page.route(blank, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>' }));
await page.goto(blank);

let total = 0;
for (const { assetType, name } of thumbnailList()) {
  const { png, model } = await page.evaluate(async (type) => {
    const { renderThumb } = await import('/scripts/thumbs-scene.js');
    return renderThumb(type);
  }, assetType);
  const to = join(out, `${name}.webp`);
  await sharp(Buffer.from(png.split(',')[1], 'base64'))
    .trim({ threshold: 1 })
    .resize(PX, PX, { fit: 'inside' })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(to);
  const kb = statSync(to).size / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(6)} KB  ${name}.webp  ${assetType}${model ? '' : ' (primitive model)'}`);
}
console.log(`${total.toFixed(1).padStart(6)} KB  ${thumbnailList().length} library pictures`);
await browser.close();
if (errors.length) { console.error(`page errors:\n${errors.join('\n')}`); process.exit(1); }
