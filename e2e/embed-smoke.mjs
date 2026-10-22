// Embed smoke test: builds dist-embed/ahdus-workplace.js (npm run build:embed) and opens
// embed-test.html, a plain HTML page that loads only that file, from a plain static server
// (not Vite). Walks into the training room (enterRoom), presses E on the CNC machine (the
// page's registerAction runs), checks edits are refused, the handle's methods, that a layout
// that can't be loaded leaves the element empty (onError), a layout from another origin
// with the page's cookies, and that destroy() cleans up. docs/EMBED_GUIDE.md.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run e2e:embed      (no dev server needed: it serves the files itself)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
const exe = process.env.CHROME; // optional: path to a Chromium binary
mkdirSync('e2e/screens', { recursive: true });
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

// ── 0. Build the embed; no Studio code in it ──
execSync('npx vite build --config vite.embed.config.js --logLevel error', { stdio: 'inherit' });
const bundle = readFileSync('dist-embed/ahdus-workplace.js', 'utf8');
const STUDIO = /Preview Workplace|Floor switcher|All layouts|WorkplaceEditor|StudioPanel/;
const css = statSync('dist-embed/ahdus-workplace.css', { throwIfNoEntry: false });
log('build:embed makes one IIFE file (global AHDUSWorkplace) + its .css, with no Studio code and no process.env',
  bundle.includes('var AHDUSWorkplace=') && !STUDIO.test(bundle) && !/process\.env/.test(bundle) && !!css?.size,
  `${(bundle.length / 1e6).toFixed(2)} MB${STUDIO.test(bundle) ? ` | Studio: ${bundle.match(STUDIO)[0]}` : ''}`);

// ── A plain static server for the repo (the page), and an "API" on another origin ──
const root = resolve('.');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const site = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || /node_modules|[\\/]\.git/.test(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
const apiSeen = [];
let siteOrigin = '';
const api = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': siteOrigin, 'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  apiSeen.push({ cookie: req.headers.cookie ?? '', authorization: req.headers.authorization ?? '' });
  if (!/ahdus_session=ok/.test(req.headers.cookie ?? '')) { res.writeHead(401, cors); res.end('{"detail":"Not logged in"}'); return; }
  res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
  res.end(readFileSync('embed-sample.ahdus.json'));
});
const listen = (server) => new Promise((ok) => server.listen(0, 'localhost', () => ok(server.address().port)));
const sitePort = await listen(site);
const apiPort = await listen(api);
siteOrigin = `http://localhost:${sitePort}`;
const base = `${siteOrigin}/`;

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await b.newContext({ viewport: { width: 1280, height: 720 } });
await context.addCookies([{ name: 'ahdus_session', value: 'ok', domain: 'localhost', path: '/' }]);
const p = await context.newPage();
const EXPECTED_404 = /missing\.json|not-there/;
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() !== 'error' || m.text().includes('BJS')) return;
  if (/Failed to load resource/.test(m.text()) && EXPECTED_404.test(m.location().url ?? '')) return; // the failures this test asks for
  errs.push(m.text());
});
const requests = [];
p.on('request', (r) => requests.push(r.url()));

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.workplace._engine.scene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.workplace._engine.walkthrough.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.workplace._engine.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
const walkUntil = async (key, done, maxMs = 25000) => {
  const start = Date.now();
  await p.keyboard.down(key);
  while (Date.now() - start < maxMs && !done(await pos())) await wait(250);
  await p.keyboard.up(key);
  await frames(2);
};
const events = (name) => p.evaluate((n) => window.embedEvents.filter((e) => e.name === n).map((e) => e.data), name);
const promptText = () => p.locator('[data-hud="prompt"]').textContent({ timeout: 2000 }).catch(() => '');
const layoutJson = () => p.evaluate(() => JSON.stringify(window.workplace._engine.getLayout()));
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const ready = () => p.waitForFunction(() => window.embedEvents?.some((e) => e.name === 'ready') && window.workplace?._engine, null, { timeout: 90000 });

/** Stand so the crosshair (the camera is 0.85 m over the right shoulder) is on x = targetX facing -Z, then tilt until the prompt matches. */
async function lookAt(targetX, standZ, re) {
  for (const pitch of [-0.3, -0.2, -0.4, -0.15, -0.5, -0.1, -0.6]) {
    await pose(targetX + 0.85, standZ, Math.PI, pitch);
    for (let i = 0; i < 8; i++) {
      const t = await promptText();
      if (re.test(t)) return t;
      await wait(500);
    }
  }
  return promptText();
}

/** Mount a second viewer on a new element (fixed size) with these options; resolves with what happened. */
const mountExtra = (options, { waitReady = true } = {}) => p.evaluate(async ({ options, waitReady }) => {
  const el = document.createElement('div');
  el.id = 'extra';
  el.style.cssText = 'position:fixed;right:0;bottom:0;width:320px;height:200px';
  document.body.append(el);
  const seen = [];
  let error = null;
  const handle = AHDUSWorkplace.mount(el, { ...options, onEvent: (n) => seen.push(n), onError: (e) => { error = e.message; } });
  window.extra = handle;
  if (waitReady) await handle.ready.catch(() => {});
  else await new Promise((r) => setTimeout(r, 300));
  return { error, seen, children: el.childElementCount, html: el.innerHTML.slice(0, 80) };
}, { options, waitReady });
const removeExtra = () => p.evaluate(() => { window.extra?.destroy(); document.getElementById('extra')?.remove(); window.extra = null; });

// ── 1. The page: only the embed's file, the sample office, walking through ──
await p.goto(new URL('embed-test.html', base).href);
await ready();
await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(2)); // fast without a GPU
await frames(3);
const drawn = await p.evaluate(() => {
  const e = window.workplace._engine;
  const r = window.embedEvents.find((x) => x.name === 'ready').data;
  return {
    rooms: e.rooms.meshes.size, items: e.objects.meshes.size, mode: window.workplace.mode,
    ready: `${r.name}: ${r.rooms.map((x) => x.name).join(', ')} | ${r.floors.map((f) => f.name).join(', ')}`,
    style: !!document.getElementById('ahdus-workplace-style'), stylesheets: document.styleSheets.length,
  };
});
log('embed-test.html draws the sample office (4 rooms, 14 items, 2 floors) walking through; "ready" names them',
  drawn.rooms === 4 && drawn.items === 14 && drawn.mode === 'walkthrough' &&
  drawn.ready === 'Sample office: Reception, Office 1, Training room, Office 2 | Ground Floor, Floor 1' && drawn.style,
  JSON.stringify(drawn));
const loaded = [...new Set(requests.map((u) => new URL(u)).map((u) => (u.origin === siteOrigin ? u.pathname : u.href)))].filter((u) => u !== '/favicon.ico');
log('the page loads only the embed\'s file (and the layout it is given)',
  loaded.sort().join() === ['/dist-embed/ahdus-workplace.js', '/embed-sample.ahdus.json', '/embed-test.html'].sort().join(),
  loaded.join(', '));
await shot('embed-page.png');

// ── 2. Walk into the training room: enterRoom ──
// (headless Chromium may grant the walkthrough's pointer lock at load; a click on a locked page misses)
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
await p.mouse.move(500, 360);
await p.click('#workplace canvas');
await wait(500);
log('clicking the view captures the mouse', await p.evaluate(() => document.pointerLockElement?.closest('#workplace') !== null && !!document.pointerLockElement));
await pose(12, -7, 0, 0); // outside, south of the training room's door (x = 12), facing it
await walkUntil('KeyW', ({ z }) => z > -2); // through the door (south wall at z = -3)
const at = await pos();
await frames(3);
const entered = await events('enterRoom');
log('walking in through the door sends onEvent("enterRoom") with the room; the HUD names it',
  at.z > -2 && entered.some((e) => e.roomId === 'room_training' && e.room?.name === 'Training room' && e.floorId === 0) &&
  (await p.locator('[data-hud="room"]').textContent()) === 'Training room',
  `z=${at.z.toFixed(2)} | ${entered.map((e) => e.room?.name).join(',')}`);
await shot('embed-walkthrough.png');

// ── 3. E on the CNC machine: the page's registerAction runs ──
const prompt = await lookAt(15.5, 1.2, /Watch CNC training video/);
log('looking at the CNC machine shows "E Watch CNC training video"', /^E Watch CNC training video: CNC Machine$/.test(prompt.trim()), prompt);
const cardsBefore = (await events('card')).length;
await p.keyboard.press('KeyE'); await frames(3);
const inter = (await events('interact')).at(-1);
const video = await p.evaluate(() => ({ shown: !document.getElementById('video').hidden, text: document.getElementById('video-text').textContent }));
log('E sends onEvent("interact") with the machine and runs the action (no default card)',
  inter?.objectId === 'obj_cnc' && inter?.anchorKind === 'machine' && inter?.room?.name === 'Training room' &&
  video.shown && /item obj_cnc/.test(video.text) && (await events('card')).length === cardsBefore,
  `${inter?.objectId} ${inter?.anchorKind} | ${video.text.slice(0, 60)}`);
await shot('embed-action.png');
await p.click('#video-close');

// ── 4. Nothing can change the layout ──
await p.click('#workplace canvas'); await wait(500); // capture the mouse again
const before = await layoutJson();
await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frames(3); // "remove" what you look at
await p.keyboard.press('KeyN'); await frames(3);                                                // "add a floor"
const refused = await p.evaluate(() => {
  const w = window.workplace;
  const e = w._engine;
  const ws = w.anchors({ kind: 'workstation' })[0];
  return {
    setMode: w.setMode('edit'), mode: w.mode, engineMode: e.mode,
    addRoom: e.editor.addRoom({ type: 'OFFICE', x: 30, z: 0, width: 4, depth: 4 }),
    deleteObject: e.editor.deleteObject('obj_cnc'),
    undo: e.undo(),
    positionRef: AHDUSWorkplace.bridge.setPositionRef(ws.id, 'POS-1'),
  };
});
log('right-click and N change nothing; setMode("edit"), editor commands, undo and the bridge\'s writes are refused',
  (await layoutJson()) === before && refused.setMode === false && refused.mode === 'walkthrough' && refused.engineMode === 'walkthrough' &&
  refused.addRoom?.problem && refused.deleteObject?.problem && refused.undo === false && refused.positionRef === false,
  JSON.stringify(refused));
const editMount = await mountExtra({ layoutUrl: 'embed-sample.ahdus.json', mode: 'edit' });
log('mount() with mode "edit" calls onError and leaves the element empty',
  /Editing isn't available here/.test(editMount.error ?? '') && editMount.children === 0 && editMount.seen.length === 0, JSON.stringify(editMount));
await removeExtra();

// ── 5. The handle: setFloor, anchors, view mode, highlight, focusOn ──
const floorUp = await p.evaluate(() => window.workplace.setFloor(1));
await frames(4);
const level = await p.evaluate(() => window.workplace._engine.walkthrough.getLevel());
const floorEvents = await events('floorChange');
const left = (await events('exitRoom')).at(-1);
log('setFloor(1) while walking takes you to Floor 1 (onEvent "floorChange", and "exitRoom" for the training room)',
  floorUp === true && level === 1 && floorEvents.at(-1)?.floorId === 1 && floorEvents.at(-1)?.name === 'Floor 1' &&
  left?.roomId === 'room_training' && left?.toRoomId === null,
  `level ${level} | ${JSON.stringify(floorEvents.at(-1))} | exit ${left?.room?.name}`);
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
await p.click('#show-machine'); await frames(6);
const viewMode = await p.evaluate(() => {
  const w = window.workplace;
  return {
    mode: w.mode, engineMode: w._engine.mode, camera: w._engine.scene.activeCamera?.name,
    machines: w.anchors({ kind: 'machine' }).map((a) => a.objectId),
    upstairs: [...new Set(w.anchors({ floorId: 1 }).map((a) => a.objectId))].sort(),
    highlighted: w._engine.highlights.ids(),
    exits: window.embedEvents.filter((e) => e.name === 'exitRoom').length,
    focusUnknown: w.focusOn('nope'),
    floorView: w.setFloor(0),
  };
});
log('"Show the CNC machine": setMode("view"), anchors({ kind }), highlight and focusOn work; anchors({ floorId: 1 })',
  viewMode.mode === 'view' && viewMode.engineMode === 'view' && viewMode.camera === 'mainCamera' &&
  viewMode.machines.join() === 'obj_cnc' && viewMode.upstairs.join() === 'obj_chair_3,obj_desk_3' &&
  viewMode.highlighted.join() === 'obj_cnc' && viewMode.focusUnknown === false && viewMode.floorView === true,
  JSON.stringify(viewMode));
await frames(4);
await shot('embed-view.png');

// ── 6. A layout that can't be loaded: onError, the element left empty ──
const missing = await mountExtra({ layoutUrl: 'missing.json', mode: 'view' });
log('a layoutUrl that answers 404: onError "HTTP 404", the element is empty',
  /\(HTTP 404\)/.test(missing.error ?? '') && missing.children === 0, JSON.stringify(missing));
await removeExtra();
const notLayout = await mountExtra({ layoutUrl: 'package.json', mode: 'view' });
log('JSON that is not a layout: onError, the element is empty', /not an AHDUS layout/.test(notLayout.error ?? '') && notLayout.children === 0, JSON.stringify(notLayout));
await removeExtra();
const noLayout = await mountExtra({ mode: 'view' });
log('no layout at all: onError', /No layout given/.test(noLayout.error ?? '') && noLayout.children === 0, JSON.stringify(noLayout));
await removeExtra();

// ── 7. destroy() cleans up ──
const shared = await p.evaluate(() => {
  const w = window.workplace;
  const e = w._engine;
  window.destroyed = { w, e };
  const cnc = AHDUSWorkplace.bridge._describeTarget({ objectId: 'obj_cnc' }, { store: e.getStore() });
  window.cncTarget = cnc;
  return { action: AHDUSWorkplace.bridge._interactionFor(cnc)?.label ?? null, rooms: AHDUSWorkplace.bridge.getRooms().length };
});
await p.click('#remove'); await wait(500);
const after = await p.evaluate(() => {
  const { w, e } = window.destroyed;
  return {
    children: document.getElementById('workplace').childElementCount,
    canvases: document.querySelectorAll('canvas').length,
    style: !!document.getElementById('ahdus-workplace-style'),
    sceneDisposed: e.scene.isDisposed,
    bridgeContext: AHDUSWorkplace.bridge._activeContext() === null,
    bridgeRooms: AHDUSWorkplace.bridge.getRooms().length,
    action: AHDUSWorkplace.bridge._interactionFor(window.cncTarget)?.label ?? null,
    calls: [w.setMode('view'), w.setFloor(0), w.focusOn('obj_cnc'), w.highlight(['obj_cnc']), w.anchors().length, w._engine],
  };
});
await p.keyboard.press('KeyW'); await p.keyboard.press('KeyE'); await wait(300); // the walkthrough's keys are gone too
log('destroy(): the element is empty, the engine disposed, no canvas, no styles, the bridge and the action are gone',
  shared.action === 'Watch CNC training video' && shared.rooms === 4 &&
  after.children === 0 && after.canvases === 0 && !after.style && after.sceneDisposed && after.bridgeContext &&
  after.bridgeRooms === 0 && after.action === null && JSON.stringify(after.calls) === '[false,false,false,false,0,null]',
  JSON.stringify({ before: shared, after }));

// ── 8. Other ways to give the layout (one viewer at a time: SwiftShader is slow) ──
const v2 = JSON.parse(before);
const fromV2 = await mountExtra({ layout: v2, mode: 'view' });
const v2Rooms = await p.evaluate(() => window.extra?._engine?.rooms.meshes.size ?? 0);
log('layout: v2 JSON (getLayout()) shows the same office', !fromV2.error && fromV2.seen.includes('ready') && v2Rooms === 4, JSON.stringify({ ...fromV2, v2Rooms }));
await removeExtra();
const fromApi = await mountExtra({ layoutUrl: `http://localhost:${apiPort}/api/v1/workplace/layouts/current`, headers: { Authorization: 'Bearer test-token' }, mode: 'view' });
log('layoutUrl on another origin is fetched with the page\'s cookies (credentials: "include") and the headers given',
  !fromApi.error && fromApi.seen.includes('ready') && apiSeen.some((s) => /ahdus_session=ok/.test(s.cookie) && s.authorization === 'Bearer test-token'),
  JSON.stringify({ error: fromApi.error, seen: fromApi.seen, api: apiSeen }));
await removeExtra();
await context.clearCookies();
const loggedOut = await mountExtra({ layoutUrl: `http://localhost:${apiPort}/api/v1/workplace/layouts/not-there`, mode: 'view' });
log('…and without the login cookie the API answers 401: onError, element empty', /\(HTTP 401\)/.test(loggedOut.error ?? '') && loggedOut.children === 0, JSON.stringify(loggedOut));
await removeExtra();

// ── 9. The page's own fallback when loading fails ──
await p.goto(new URL('embed-test.html?layoutUrl=missing.json', base).href);
const fallback = await p.locator('.fallback').textContent({ timeout: 30000 }).catch(() => '');
const onlyFallback = await p.evaluate(() => [...document.getElementById('workplace').children].map((c) => c.className).join());
log('embed-test.html?layoutUrl=missing.json shows the page\'s own fallback in the empty element',
  /could not be loaded/.test(fallback) && /HTTP 404/.test(fallback) && onlyFallback === 'fallback', `${fallback} | ${onlyFallback}`);
await shot('embed-fallback.png');

log('no page errors', errs.length === 0, errs[0] ?? '');
await b.close();
site.close();
api.close();
