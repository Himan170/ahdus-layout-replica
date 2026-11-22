// Stairs that always work (v0.17.4), in Workplace Studio inside AHDUS with the AHDUS API faked in the browser (as
// e2e:seats does), on a copy of a real layout: stairs whose bottom step is too close to a wall and in front of a door,
// so the stair room can't be reached (two of its problems ignored by the editor).
// Checks: the Check bar's "N ignored" + Show; Fix it on every stairs problem (one undo step), Check clean after it and
// the stairs still arriving in Staircase 2 on Floor 1; the Inspector's Fix it; the Publish dialog listing what stops
// people walking (ignored ones too) with Fix it and "Publish anyway"; placing stairs from the library: red preview +
// the missing floor shaded, snapped on drop, Alt = exactly there; dragging stairs: the same.
//
// The layout: RUSBORN=<exported .ahdus.json> (default private-docs/rusborn-2026-11-15.json, a copy is used and the
// file is never written); without it a stand-in of the same shape (generic names) is used.
// NO dev server needed: it starts its own Vite dev server in AHDUS mode (VITE_LAYOUT_BACKEND=ahdus) on port 3101.
// Run:              npm run e2e:stairs-fit
//                   SHOTS=private-docs/screenshots/v0.17.4 npm run e2e:stairs-fit   (screenshots there)
// Screenshots go to e2e/screens/ otherwise. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.VITE_LAYOUT_BACKEND = 'ahdus';
const { createServer } = await import('vite');

const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
const PORT = 3101;
const RUSBORN = process.env.RUSBORN ?? 'private-docs/rusborn-2026-11-15.json';
mkdirSync('e2e/screens', { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const errs = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
  if (results.some((r) => !r.ok) || errs.length) process.exitCode = 1;
});

// ── The layout ──
function standIn() {
  const d = (wall, offset, width = 1, height = 2.1) => ({ wall, offset, width, height });
  const r = (id, name, type, floor, x, z, width, depth, doors) => ({ id, name, type, floor, x, z, width, depth, wallHeight: 4.6, wallThickness: 0.15, doors, windows: [] });
  return {
    layoutName: 'Stairs HQ', layoutVersion: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 4.9 }, 1: { id: 1, name: 'Floor 1', height: 4.9 } },
    rooms: [
      r('room_office', 'Office', 'OFFICE', 0, 4.5, 3.25, 11, 7.5, [d('west', -1.693), d('east', -0.301), d('south', 0.34), d('south', -3.66)]),
      r('room_rest', 'Restroom 1', 'RESTROOM', 0, 0.75, -2.825, 3.5, 4.35, [d('north', 0.09)]),
      r('room_reception', 'Reception', 'MEETING', 0, -5.325, 2.5, 8.35, 14, [d('east', -0.943), d('south', -0.81, 2.1, 2.7)]),
      r('room_stairs3', 'Staircase 3', 'STAIRCASE', 0, 5.325, -3.825, 5.35, 6.35, []),
      r('room_office1', 'Upper Office', 'OFFICE', 1, 4.5, 3.25, 11, 7.5, [d('west', -1.693), d('south', 3.3), d('south', -3.422)]),
      r('room_rest1', 'Restroom 2', 'RESTROOM', 1, 0.75, -2.825, 3.5, 4.35, [d('north', 0.328)]),
      r('room_stairs2', 'Staircase 2', 'STAIRCASE', 1, 6.325, -3.575, 7.35, 5.85, [d('north', 1.48)]),
      r('room_meeting1', 'Meeting Room', 'MEETING', 1, -5.325, 4.75, 8.35, 9.5, [d('east', -3.193)]),
    ],
    objects: [{ id: 'obj_stairs', assetType: 'STAIRCASE', name: 'STAIRCASE 1', floor: 0, roomId: 'room_stairs3', x: 5, y: 0, z: -3,
      rotationX: 0, rotationY: Math.PI, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false }],
    anchorData: {},
    ignoredChecks: ['ROOM_UNREACHABLE:room_stairs3', 'STAIRS_NO_STEP_ON:obj_stairs'],
  };
}
const real = existsSync(RUSBORN);
const DRAFT = real ? JSON.parse(readFileSync(RUSBORN, 'utf8')).layout : standIn(); // a copy in memory: the file stays as it is
const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {}));
const STAIR = list(DRAFT.objects).find((o) => o.assetType === 'STAIRCASE');
const STAIR_ROOM = list(DRAFT.rooms).find((r) => r.id === STAIR.roomId);
const OFFICE = list(DRAFT.rooms).find((r) => r.floor === 0 && r.type === 'OFFICE' && r.width === 11); // the Director Room
console.error(`layout: ${real ? RUSBORN + ' (a copy)' : 'the stand-in (no ' + RUSBORN + ')'}`);

const vite = await createServer({
  configFile: 'vite.config.js',
  cacheDir: 'node_modules/.vite-stairs-fit', // never disturbs a running `npm run dev`
  logLevel: 'error',
  server: { port: PORT, strictPort: true, open: false },
});
await vite.listen();

const api = { revision: 5, calls: [] };
async function fakeAhdus(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const path = url.pathname;
  api.calls.push({ method, path });
  const send = (status, data) => route.fulfill({ status, contentType: 'application/json', body: data === undefined ? '' : JSON.stringify(data) });
  if (path === '/frontend/workplace/characters.json') return send(200, {});
  if (path === '/api/workplace/me') return send(200, { canEdit: true, canAppoint: false });
  if (path === '/api/teams/departments') return send(200, []);
  if (path === '/api/workplace/sites') return send(200, [{ id: 1, name: DRAFT.layoutName, published: true, publishedRevision: 4, draftRevision: api.revision }]);
  if (path === '/api/workplace/sites/1/layout' && method === 'GET') return send(200, { layout: DRAFT, revision: api.revision, name: DRAFT.layoutName });
  if (path === '/api/workplace/sites/1/layout' && method === 'PUT') { api.revision += 1; return send(200, { revision: api.revision }); }
  if (path === '/api/workplace/sites/1/versions') return send(200, []);
  if (path === '/api/workplace/sites/1/seats') return send(200, []);
  if (path === '/api/workplace/people') return send(200, []);
  return send(404, { detail: `Not faked: ${method} ${path}` });
}

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { localStorage.setItem('authToken', 'test-token'); });
await ctx.route('**/api/workplace/**', fakeAhdus);
await ctx.route('**/api/teams/**', fakeAhdus);
await ctx.route('**/frontend/workplace/characters.json', fakeAhdus);
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() !== 'error' || m.text().includes('BJS')) return;
  if (/Failed to load resource.*404/.test(m.text())) return;
  errs.push(m.text());
});

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 2) => p.evaluate((n) => new Promise((res) => {
  let k = 0; const tick = () => (++k >= n ? res() : requestAnimationFrame(tick)); requestAnimationFrame(tick);
}), n);
const shot = (name) => p.screenshot({ path: SHOTS ? join(SHOTS, name) : `e2e/screens/stairs-fit-${name}`, timeout: 120000 });
const hint = () => p.locator('.studio-footer__hint').first().innerText().catch(() => '');
const stairs = () => p.evaluate(() => Object.values(window.__ahdusStore.getState().objects).filter((o) => o.assetType === 'STAIRCASE'));
const theStair = async () => (await stairs()).find((o) => o.id === STAIR.id);
// the real rules, run in the page on the store's layout (Vite serves the sources)
const fitOf = (id) => p.evaluate(async (id) => {
  const { stairFit } = await import('/src/play/stairFit.js');
  const { stairTop } = await import('/src/play/building.js');
  const { ASSET_TYPES } = await import('/src/utils/assetCatalog.js');
  const s = window.__ahdusStore.getState();
  const layout = { floors: s.floors, rooms: Object.values(s.rooms), objects: Object.values(s.objects) };
  const o = s.objects[id];
  const f = stairFit(o, layout, { catalog: ASSET_TYPES });
  const top = stairTop(o);
  const above = Object.values(s.rooms).filter((r) => r.floor === o.floor + 1
    && Math.abs(top.x - r.x) < r.width / 2 && Math.abs(top.z - r.z) < r.depth / 2).map((r) => r.name);
  return { ok: f.ok, codes: f.problems.map((x) => x.code), x: o.x, z: o.z, rotationY: o.rotationY, roomId: o.roomId, above };
}, id);
const toScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
const zonesOn = (prefix) => p.evaluate((prefix) => window.__ahdusScene.meshes
  .filter((m) => m.name.startsWith(`${prefix}_pv_zone_`) && m.isEnabled()).length, prefix);
const blur = () => p.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await blur(); await p.keyboard.press(k); await frames(2); await wait(200); };
const panel = p.getByRole('dialog', { name: 'Check my layout', exact: true });
const checkStatus = () => panel.getByRole('status').innerText().catch(() => '');
// v0.18.9: the problems this test is about, not ignored (the layout file may also have furniture a little inside a
// wall: its own "… is inside a wall" warnings)
const openStairsRows = () => panel.locator('li[data-check-kind]').evaluateAll((els) =>
  els.filter((e) => e.dataset.checkKind !== 'ITEM_IN_WALL' && !e.closest('[data-check-ignored-list]')).length).catch(() => -1);
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(200); }
  return false;
};
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;

// ── 1. Studio opens the layout; Check knows the stairs are wrong ──
await p.goto(`http://localhost:${PORT}/?site=1`, { timeout: 120000 });
await p.waitForSelector('[data-splash]', { state: 'detached', timeout: 180000 });
await p.waitForFunction(() => window.__ahdusBuild?.whenBuilt, null, { timeout: 60000 });
await p.evaluate(() => window.__ahdusBuild.whenBuilt());
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
const checkBtn = p.locator('[aria-label="Check layout"]');
const titled = await until(async () => /2 ignored/.test((await checkBtn.getAttribute('title')) ?? ''), 30000);
log('the Check button counts what is ignored ("…, 2 ignored")', titled, await checkBtn.getAttribute('title'));
await checkBtn.click();
await panel.waitFor();
const status0 = await checkStatus();
log('the Check bar: "1 problem to look at · 2 ignored · Show" (the stairs)', await openStairsRows() === 1 && /2 ignored/.test(status0)
  && await panel.locator('[data-check-ignored="2"] [data-check-show-ignored]').count() === 1, status0.replace(/\s+/g, ' '));
const doorRow = panel.locator(`[data-check-key="STAIRS_BLOCKS_DOOR:${STAIR.id}"]`);
log('"The stairs block a door of …" has Fix it', await doorRow.locator('[data-check-fix]').count() === 1, await doorRow.innerText().catch(() => 'no row'));
await panel.locator('[data-check-show-ignored]').click();
await wait(300);
const ignoredRows = panel.locator('[data-check-ignored-list] li');
const ignoredTexts = await ignoredRows.allInnerTexts();
log('Show opens the 2 ignored problems, each with Fix it',
  await panel.locator('[data-check-ignored-list]').evaluate((e) => e.open) && ignoredTexts.length === 2
  && await panel.locator('[data-check-ignored-list] [data-check-fix]').count() === 2, ignoredTexts.map((t) => t.split('\n')[0]).join(' | '));
const allTexts = (await panel.locator('.check-message').allInnerTexts()).join(' | ');
log('plain words, no coordinates (no "x 5.0" or "-3.55")', !/-?\d+\.\d+/.test(allTexts) && /too close to the wall/.test(allTexts), allTexts);
await shot('check-fix-it.png');

// ── 2. Publish lists what stops people walking, ignored ones too, with Fix it and Publish anyway ──
await p.getByRole('button', { name: /^Publish changes/ }).first().click({ timeout: 30000 });
const dialog = p.locator('[data-publish-walking]');
await dialog.waitFor({ timeout: 15000 });
const walkingN = Number(await dialog.getAttribute('data-publish-walking'));
const dialogText = await dialog.innerText();
const ignoredN = (dialogText.match(/\(ignored\)/g) ?? []).length;
log('the Publish dialog lists the 3 walking problems (2 of them ignored), each with Fix it',
  walkingN === 3 && ignoredN === 2 && await p.locator('[data-publish-fix]').count() === 3, `${walkingN} listed, ${ignoredN} ignored`);
log('…and its button is "Publish anyway"', /Publish anyway/.test(await p.locator('[data-publish-anyway]').innerText().catch(() => '')));
await shot('publish-dialog.png');
const putsBefore = api.calls.filter((c) => c.method === 'POST' && /publish/.test(c.path)).length;
await p.locator('[data-publish-fix]').first().click();
await until(async () => (await p.locator('[data-publish-walking]').count()) === 0);
const afterDialogFix = await fitOf(STAIR.id);
const publishText = await p.locator('[role="dialog"][aria-label="Publish workplace"]').locator('button').allInnerTexts();
log('Fix it in the dialog: the list is gone, the button is "Publish" again, nothing was published',
  (await p.locator('[data-publish-walking]').count()) === 0 && publishText.some((t) => /^\s*Publish\s*$/.test(t))
  && api.calls.filter((c) => c.method === 'POST' && /publish/.test(c.path)).length === putsBefore, publishText.join(', '));
log('…the stairs moved to a spot that works, in the same room, same turn',
  afterDialogFix.ok && afterDialogFix.roomId === STAIR.roomId && near(afterDialogFix.rotationY, STAIR.rotationY) && near(afterDialogFix.x, STAIR.x),
  `${afterDialogFix.x}, ${afterDialogFix.z}`);
await p.locator('[role="dialog"][aria-label="Publish workplace"]').getByRole('button', { name: 'Cancel', exact: true }).click();
await wait(300);

// ── 3. Fix it in Check: one undo step; Check clean; the stairs reach Staircase 2 ──
await key('Control+z');
let s = await theStair();
log('one Undo puts the stairs back where they were', near(s.x, STAIR.x) && near(s.z, STAIR.z), `${s.x}, ${s.z}`);
if (!(await panel.isVisible())) await checkBtn.click();
await until(async () => (await doorRow.count()) === 1);
await doorRow.locator('[data-check-fix]').click();
await until(async () => (await openStairsRows()) === 0 && !/ignored/.test(await checkStatus()));
const fixed = await fitOf(STAIR.id);
const status1 = await checkStatus();
log('Fix it in Check: no stairs problem left, nothing left ignored', (await openStairsRows()) === 0 && !/ignored/.test(status1), status1.replace(/\s+/g, ' '));
log('…the stairs moved a little (same room, same turn) and still arrive in Staircase 2 on Floor 1',
  fixed.ok && fixed.roomId === STAIR.roomId && near(fixed.rotationY, STAIR.rotationY) && Math.hypot(fixed.x - STAIR.x, fixed.z - STAIR.z) < 1.5
  && fixed.above.includes('Staircase 2'), `${fixed.x}, ${fixed.z} → ${fixed.above.join(', ')}`);
log('…and says so in plain words', /Moved the stairs/.test(await hint()), await hint());
await shot('check-fixed.png');
await key('Control+z');
s = await theStair();
log('one Undo after Fix it: back where they were', near(s.x, STAIR.x) && near(s.z, STAIR.z));
await key('Control+y');
s = await theStair();
log('Redo: fixed again', near(s.x, fixed.x) && near(s.z, fixed.z));
await key('Control+z');

// ── 4. The Inspector's Fix it on the selected stairs ──
await p.evaluate((id) => { const st = window.__ahdusStore.getState(); st.selectRoom(null); st.selectObject(id); }, STAIR.id);
const inspFix = p.locator('[data-stairs-problems] [data-stairs-fix]');
await inspFix.waitFor({ timeout: 15000 }).catch(() => {});
log('the selected stairs: the Inspector lists their problems with Fix it', await inspFix.count() === 1,
  (await p.locator('[data-stairs-problems]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140));
await inspFix.click();
await wait(300);
const viaInspector = await fitOf(STAIR.id);
log('…a click moves them where they work', viaInspector.ok && near(viaInspector.z, fixed.z) && await p.locator('[data-stairs-fix]').count() === 0,
  `${viaInspector.x}, ${viaInspector.z}`);
await p.evaluate(() => window.__ahdusStore.getState().selectObject(null));
await p.keyboard.press('Escape'); // closes Check
await wait(300);

// ── 5. Placing stairs from the library: red + shaded where it is missing; dropped = snapped; Alt = exactly there ──
await p.click('[aria-label="2D view"]');
await wait(800);
await p.click('[aria-label="Fit view"]').catch(() => {});
await wait(1200); await frames(3);
const SPOT = { x: OFFICE.x + 4, z: OFFICE.z + 1.25 }; // the Director Room's north wall: no room to step off at the top
const dragTile = async ({ alt = false, shotName = null } = {}) => {
  if (!(await p.locator('[data-library="stairs"]').isVisible().catch(() => false))) { await p.click('[aria-label="Stairs"]'); await wait(300); }
  const box = await p.locator('[data-library="stairs"] .lib-tile[title^="Staircase"]').first().boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  const to = await toScreen(SPOT.x, 0, SPOT.z);
  await p.mouse.move(to.x, to.y, { steps: 14 });
  await frames(3); await wait(300);
  const during = { hint: await hint(), zones: await zonesOn('placing'), bad: await p.locator('[data-drop-footprint].is-bad').count() };
  if (shotName) await shot(shotName);
  if (alt) { await p.keyboard.down('Alt'); await p.mouse.move(to.x + 1, to.y, { steps: 2 }); await frames(2); }
  await p.mouse.up();
  if (alt) await p.keyboard.up('Alt');
  await frames(3); await wait(400);
  return during;
};
const before = new Set((await stairs()).map((o) => o.id));
const newStair = async () => (await stairs()).find((o) => !before.has(o.id));
const during = await dragTile({ shotName: 'red-preview.png' });
log('dragging stairs to a spot with no room at the top: red, the missing floor shaded, the hint says why + Alt',
  during.bad === 1 && during.zones >= 1 && /step off|stick out/.test(during.hint) && /Alt/.test(during.hint),
  `zones ${during.zones}, ${during.hint.replace(/\s+/g, ' ').slice(0, 120)}`);
let placed = await newStair();
let placedFit = placed && await fitOf(placed.id);
log('dropped: they snap to the nearest spot that works (same room, same turn)',
  !!placedFit?.ok && placed.roomId === OFFICE.id && near(placed.rotationY ?? 0, 0) && Math.hypot(placed.x - SPOT.x, placed.z - SPOT.z) < 1.5
  && /Moved the stairs a little/.test(await hint()), placed ? `${placed.x}, ${placed.z}; ${await hint()}` : 'none placed');
await key('Control+z');
log('one Undo removes them', !(await newStair()));
await dragTile({ alt: true });
placed = await newStair();
placedFit = placed && await fitOf(placed.id);
log('Alt held on the drop: they stay exactly where dropped (and say why it is a problem)',
  !!placed && !placedFit.ok && placedFit.codes.includes('NO_LANDING') && /step off|stick out/.test(await hint()),
  placed ? `${placed.x}, ${placed.z}: ${placedFit.codes.join(', ')}` : 'none placed');
await key('Control+z');
await p.keyboard.press('Escape');
await wait(300);

// ── 6. Dragging placed stairs: the same red preview; let go = snapped ──
const at = await theStair(); // fixed (step 4)
const hover = async (x, z) => { const q = await toScreen(x, 0.3, z); await p.mouse.move(q.x - 3, q.y - 3); await p.mouse.move(q.x, q.y, { steps: 3 }); await frames(2); };
await hover(at.x, at.z); await p.mouse.down(); await p.mouse.up(); await frames(3); await wait(600); // select it (the Inspector opens)
await hover(at.x, at.z);
await p.mouse.down();
const back = await toScreen(STAIR.x, 0.3, STAIR.z + 0.1); // back towards the wall in front of the bottom step
await p.mouse.move(back.x, back.y, { steps: 14 });
await frames(3); await wait(300);
const dragHint = await hint();
const dragZones = await zonesOn('planner');
await shot('drag-red.png');
log('dragging the stairs back to the wall: the missing floor shaded, the hint says so + Alt', dragZones >= 2 && /Alt/.test(dragHint),
  `zones ${dragZones}, ${dragHint.replace(/\s+/g, ' ').slice(0, 120)}`);
await p.mouse.up(); await frames(3); await wait(400);
const dropped = await fitOf(STAIR.id);
log('let go: they move to a spot that works, and the shading is gone', dropped.ok && dropped.roomId === STAIR.roomId && (await zonesOn('planner')) === 0
  && /moved a little/.test(await hint()), `${dropped.x}, ${dropped.z}; ${await hint()}`);
await key('Control+z');

log('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
await vite.close();
