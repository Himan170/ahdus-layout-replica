// Copies the real assets the app uses from the downloaded packs into public/assets/,
// resized and re-compressed. Safe to run again (it overwrites what it made).
//
//   node scripts/prepare-assets.mjs [source folder]      (default D:\assets-raw, or $AHDUS_ASSETS_RAW)
//
// Source layout (docs/ASSET_LICENSES.md has the links and licences, all CC0):
//   kenney_furniture-kit/Models/GLTF format/<model>.glb       Kenney Furniture Kit
//   textures/<name>_1k.gltf/textures/<name>_{diff,nor_gl,rough|arm}_1k.jpg   Poly Haven
//   textures/<Name>_1K-JPG/<Name>_1K-JPG_{Color,NormalGL,Roughness}.jpg      ambientCG
//   textures/citrus_orchard_road_puresky_1k.hdr              Poly Haven (sky; scripts/make-env.mjs makes sky.env)
// Only the models in src/utils/modelRegistry.js and the texture sets below are copied.
import sharp from 'sharp';
import { copyFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usedModels, TEXTURE_SETS } from '../src/utils/modelRegistry.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? process.env.AHDUS_ASSETS_RAW ?? 'D:\\assets-raw';
const out = join(repo, 'public', 'assets');

const COLOR_PX = 1024;
const NORMAL_PX = 1024;
const ROUGH_PX = 512;
const QUALITY = 80;

const polyHaven = (name) => {
  const dir = join(src, 'textures', `${name}_1k.gltf`, 'textures');
  const rough = join(dir, `${name}_rough_1k.jpg`);
  return {
    color: join(dir, `${name}_diff_1k.jpg`),
    normal: join(dir, `${name}_nor_gl_1k.jpg`),
    // no roughness map: take it from the green channel of the packed AO/rough/metal map
    rough: existsSync(rough) ? rough : { file: join(dir, `${name}_arm_1k.jpg`), channel: 'green' },
  };
};
const ambientCg = (name) => {
  const dir = join(src, 'textures', `${name}_1K-JPG`);
  return {
    color: join(dir, `${name}_1K-JPG_Color.jpg`),
    normal: join(dir, `${name}_1K-JPG_NormalGL.jpg`),
    rough: join(dir, `${name}_1K-JPG_Roughness.jpg`),
  };
};

/** Our texture set name → its source files */
const TEXTURE_SOURCES = {
  carpet_office: ambientCg('Carpet012'),
  herringbone_parquet: polyHaven('herringbone_parquet'),
  laminate_floor: polyHaven('laminate_floor_02'),
  floor_tiles: polyHaven('floor_tiles_02'),
  concrete_floor: polyHaven('concrete_floor_02'),
  metal_plate: polyHaven('metal_plate'),
  beige_wall: polyHaven('beige_wall_001'),
  grey_plaster: polyHaven('grey_plaster'),
  office_ceiling: ambientCg('OfficeCeiling001'),
};

let total = 0;
const report = (file) => {
  const kb = statSync(file).size / 1024;
  total += kb;
  console.log(`${kb.toFixed(0).padStart(6)} KB  ${file.slice(repo.length + 1)}`);
};

// ── Models ──
const modelDir = join(src, 'kenney_furniture-kit', 'Models', 'GLTF format');
const modelOut = join(out, 'models', 'kenney');
mkdirSync(modelOut, { recursive: true });
for (const model of usedModels()) {
  const to = join(modelOut, `${model}.glb`);
  copyFileSync(join(modelDir, `${model}.glb`), to);
  report(to);
}
copyFileSync(join(src, 'kenney_furniture-kit', 'License.txt'), join(modelOut, 'License.txt'));
// Models no longer in the registry
for (const f of readdirSync(modelOut)) {
  if (f.endsWith('.glb') && !usedModels().includes(f.slice(0, -4))) console.warn(`not used any more: ${f} (delete it)`);
}

// ── Textures ──
for (const name of Object.keys(TEXTURE_SETS)) {
  const from = TEXTURE_SOURCES[name];
  if (!from) throw new Error(`No source files for texture set ${name}`);
  const dir = join(out, 'textures', name);
  mkdirSync(dir, { recursive: true });
  const jpg = async (input, size, file, grey = false) => {
    let img = sharp(typeof input === 'string' ? input : input.file);
    if (typeof input !== 'string') img = img.extractChannel(input.channel);
    else if (grey) img = img.greyscale();
    await img.resize(size, size, { fit: 'fill' }).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(join(dir, file));
    report(join(dir, file));
  };
  await jpg(from.color, COLOR_PX, 'color.jpg');
  await jpg(from.normal, NORMAL_PX, 'normal.jpg');
  await jpg(from.rough, ROUGH_PX, 'rough.jpg', true);
}

// ── Sky ──
const envDir = join(out, 'env');
mkdirSync(envDir, { recursive: true });
copyFileSync(join(src, 'textures', 'citrus_orchard_road_puresky_1k.hdr'), join(envDir, 'sky_1k.hdr'));
console.log('       (sky_1k.hdr is the source for scripts/make-env.mjs; it is not committed)');

console.log(`${(total / 1024).toFixed(2).padStart(6)} MB  models + textures`);
