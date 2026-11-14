// npm run build:ahdus → dist-ahdus/, the files AHDUS-FRONTEND serves
// (private-docs/WORKPLACE_INTEGRATION_PLAN.md 3; its scripts/update-workplace copies them):
//
//   dist-ahdus/workplace-studio/    Workplace Studio, VITE_LAYOUT_BACKEND=ahdus, base /workplace-studio/ (+ splash.css,
//                                   the loading screen's styles for the 3D Company page, v0.17.2)
//                                   (vite.ahdus.config.js); its prefetch.json (v0.17.2) = the files Studio needs to
//                                   start, which the 3D Company page prefetches for editors (scripts/studio-prefetch.mjs)
//   dist-ahdus/3d-environment/      the embed for employees, exactly as npm run build:embed makes it
//                                   (ahdus-workplace.js, .css, assets/)
//   dist-ahdus/layout.schema.json   the layout's JSON Schema (npm run schema:json): the server checks saves with it
//   dist-ahdus/VERSION              version=<package.json version>, commit=<git commit>, built=<date>
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { studioPrefetch } from './studio-prefetch.mjs';

const OUT = 'dist-ahdus';
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

rmSync(OUT, { recursive: true, force: true });

// Workplace Studio in AHDUS mode. These win over any .env: the Supabase prototype stays off,
// and its URL / key (and the dev proxy's target) never end up in files AHDUS commits and serves.
run('npx vite build --config vite.ahdus.config.js', {
  VITE_LAYOUT_BACKEND: 'ahdus',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  VITE_AI_RECONSTRUCTION_URL: '',
  VITE_AHDUS_API: '',
});

// What the 3D Company page prefetches for editors, so "Edit in Studio" opens fast (v0.17.2)
const STUDIO_DIR = `${OUT}/workplace-studio`;
const viteManifest = JSON.parse(readFileSync(`${STUDIO_DIR}/.vite/manifest.json`, 'utf8'));
const { version: studioVersion } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(`${STUDIO_DIR}/prefetch.json`, `${JSON.stringify(studioPrefetch(viteManifest, studioVersion), null, 2)}\n`);
rmSync(`${STUDIO_DIR}/.vite`, { recursive: true, force: true });
// The loading screen's styles, so the 3D Company page draws "Creating your workplace…" exactly as Studio does
cpSync('src/ui/splash.css', `${STUDIO_DIR}/splash.css`);

// The embed: build:embed itself, then a copy of its output
run('npm run build:embed');
cpSync('dist-embed', `${OUT}/3d-environment`, { recursive: true });

run(`node scripts/schema-json.mjs ${OUT}/layout.schema.json`);

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) commit += '-dirty';
} catch { /* not a git checkout */ }
writeFileSync(`${OUT}/VERSION`, `version=${version}\ncommit=${commit}\nbuilt=${new Date().toISOString().slice(0, 10)}\n`);
console.log(`\n${OUT}/ ready: ahdus-layout-replica ${version} (${commit})`);
