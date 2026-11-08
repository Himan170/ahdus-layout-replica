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
const STUDIO = /Add your first room|Floor switcher|All layouts|WorkplaceEditor|StudioPanel/;
const css = statSync('dist-embed/ahdus-workplace.css', { throwIfNoEntry: false });
log('build:embed makes one IIFE file (global AHDUSWorkplace) + its .css, with no Studio code and no process.env',
  bundle.includes('var AHDUSWorkplace=') && !STUDIO.test(bundle) && !/process\.env/.test(bundle) && !!css?.size,
  `${(bundle.length / 1e6).toFixed(2)} MB${STUDIO.test(bundle) ? ` | Studio: ${bundle.match(STUDIO)[0]}` : ''}`);
// The viewer never saves: no Supabase client, no sync queue (LayoutViewer reads saves through savedLayouts.js)
const SAVING = /GoTrueClient|RealtimeClient|supabase|dwtwin_sync_queue/i;
log('the embed has no saving code (no Supabase client, no sync queue)', !SAVING.test(bundle),
  SAVING.test(bundle) ? `found: ${bundle.match(SAVING)[0]}` : '');

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
const assetProblems = []; // a missing model / texture / sky file
p.on('response', (r) => { if (r.url().includes('/assets/') && r.status() >= 400) assetProblems.push(`${r.status()} ${r.url()}`); });
p.on('console', (m) => { if (m.text().includes('[realistic look]')) assetProblems.push(m.text()); });

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
// The realistic look: real models (and textures, sky) from the assets/ folder next to the script
const realModels = await p.waitForFunction(() => {
  const sc = window.workplace?._engine?.scene;
  const n = sc?.meshes.filter((m) => m.metadata?.objectId && m.metadata?.model).length ?? 0;
  return n > 0 ? n : false;
}, null, { timeout: 120000 }).then((h) => h.jsonValue()).catch(() => 0);
const loaded = [...new Set(requests.filter((u) => !u.startsWith('blob:')) // (images the sky decodes in memory)
  .map((u) => new URL(u)).map((u) => (u.origin === siteOrigin ? u.pathname : u.href)))]
  .filter((u) => u !== '/favicon.ico');
const assetFiles = loaded.filter((u) => u.startsWith('/dist-embed/assets/'));
const pageFiles = loaded.filter((u) => !assetFiles.includes(u));
log('the page loads only the embed\'s file, the layout it is given and the assets next to the script',
  pageFiles.sort().join() === ['/dist-embed/ahdus-workplace.js', '/embed-sample.ahdus.json', '/embed-test.html'].sort().join(),
  pageFiles.join(', '));
log('realistic look: items are real models, loaded from assets/ next to the script (models, textures, sky)',
  realModels > 0 && assetFiles.some((u) => u.startsWith('/dist-embed/assets/models/kenney/')) &&
  assetFiles.some((u) => u.startsWith('/dist-embed/assets/textures/')) && assetFiles.includes('/dist-embed/assets/env/sky.env') &&
  assetProblems.length === 0,
  `${realModels} items with a model; ${assetFiles.length} asset files${assetProblems.length ? ` | ${assetProblems[0]}` : ''}`);
await shot('embed-page.png');

// ── 1b. The keys are the page's until the view is engaged (clicked, or focused with Tab); Esc gives them back ──
// who has the keys: the view's description (for screen readers); the visible pill shows only in mouse look (v0.14.0)
const keysHint = () => p.locator('[data-hud="keys-state"]').textContent({ timeout: 5000 }).catch(() => '');
const focusName = () => p.evaluate(() => {
  const a = document.activeElement;
  return a?.closest('[data-layout-viewer]') ? 'viewer' : a?.id || a?.tagName || ''; // in the view: the box or its canvas
});
const scrollY = () => p.evaluate(() => Math.round(window.scrollY));
/** Space scrolls the page with an animation: at ~1 fps (no GPU) it can take seconds to start, so wait for it. */
const scrolledBySpace = () => p.waitForFunction(() => window.scrollY > 0, null, { timeout: 10000 }).catch(() => {});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Hold a key while frames are drawn (the walk reads held keys once a frame); how far the character moved. */
async function hold(key, n = 4) {
  const from = await pos();
  await p.keyboard.down(key); await frames(n); await p.keyboard.up(key); await frames(1);
  return distance(from, await pos());
}

// v0.14.0: walking starts with the keys (the view takes the focus, no click); the mouse is never captured by itself
const atLoad = {
  lock: await p.evaluate(() => !!document.pointerLockElement), hint: await keysHint(), focus: await focusName(),
  ring: await p.locator('[data-focus-ring]').count(), pill: await p.locator('[data-hud="keys"]').count(),
};
await pose(0, -9, 0, 0);                                                // outside, facing the reception door: room to walk
const loadWalk = await hold('KeyW');
log('walking starts with the keys: the view has the focus at once (no click, no focus ring), W walks; the mouse is not captured',
  !atLoad.lock && atLoad.hint === 'Esc to release' && atLoad.pill === 0 && atLoad.focus === 'viewer' && atLoad.ring === 0 && loadWalk > 0.1,
  JSON.stringify({ atLoad, loadWalk: +loadWalk.toFixed(2) }));
const start = await pos();
await p.click('#page-note');
await p.keyboard.type('Hello WASD');
await frames(2);
await p.keyboard.press('Tab');
const typed = { value: await p.inputValue('#page-note'), focus: await focusName(), hint: await keysHint() };
const onButton = await hold('KeyW');                                    // on the page's button, not a text field
await p.keyboard.press('Space');                                        // presses the button
const clicks = await p.textContent('#page-clicks');
await p.keyboard.press('Tab');
const afterTab = await focusName();
log('the page\'s own field and button: typing (W A S D too) and Tab work; W on the page\'s button doesn\'t walk; Space presses it',
  typed.value === 'Hello WASD' && typed.focus === 'page-button' && typed.hint === 'Click the view to walk' &&
  onButton < 0.01 && distance(start, await pos()) < 0.01 && clicks === 'clicked 1×' && afterTab !== 'page-button',
  JSON.stringify({ typed, onButton, clicks, afterTab }));
await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
await p.keyboard.press('Space'); await scrolledBySpace();
const pageScroll = await scrollY();
await p.evaluate(() => window.scrollTo(0, 0)); await wait(300);
log('not engaged: Space scrolls the page', pageScroll > 0, `scrollY ${pageScroll}`);

await pose(0, -9, 0, 0);                                                // outside, facing the reception door: room to walk
await p.focus('#remove');                                               // the last header button: the view is the next Tab stop
await p.keyboard.press('Tab'); await frames(2);
const tabbed = { focus: await focusName(), ring: await p.locator('[data-focus-ring]').count(), hint: await keysHint() };
await shot('embed-focus-ring.png');
const tabWalk = await hold('KeyW');
await p.keyboard.press('Escape'); await frames(2);
const tabReleased = { focus: await focusName(), ring: await p.locator('[data-focus-ring]').count(), hint: await keysHint() };
log('Tab to the view: a focus ring, and the keys are its own (W walks); Esc gives them back',
  tabbed.focus === 'viewer' && tabbed.ring === 1 && tabbed.hint === 'Esc to release' && tabWalk > 0.1 &&
  tabReleased.focus !== 'viewer' && tabReleased.ring === 0 && tabReleased.hint === 'Click the view to walk',
  JSON.stringify({ tabbed, tabWalk: +tabWalk.toFixed(2), tabReleased }));

// A click on the view (on the sky: a click on the floor would walk there) takes the keys, without capturing the mouse
await pose(0, -9, 0, 0.5);                                              // looking up
const skyBox = await p.locator('#workplace canvas').boundingBox();       // right of the toolbar (Find, keys, ?)
await p.click('#workplace canvas', { position: { x: skyBox.width * 0.65, y: skyBox.height * 0.18 } }); await wait(500);
const clicked = { lock: await p.evaluate(() => !!document.pointerLockElement), focus: await focusName(), hint: await keysHint(),
  route: await p.evaluate(() => window.workplace._engine.navigation.walking) };
await pose(0, -9, 0, 0);
const clickWalk = await hold('KeyW');
await p.keyboard.press('Space'); await frames(3);                       // jumps; the page stays put
await p.keyboard.press('ArrowDown'); await frames(2);                   // walks back; the page stays put
const engagedScroll = await scrollY();
await p.keyboard.press('Escape'); await frames(2);
const escaped = { lock: await p.evaluate(() => !!document.pointerLockElement), focus: await focusName(), walk: await hold('KeyW') };
await p.keyboard.press('Space'); await scrolledBySpace();               // the mouse is still over the view: Esc said "the page's"
const releasedScroll = await scrollY();
await p.evaluate(() => window.scrollTo(0, 0)); await wait(300);
log('click the view: the keys (mouse not captured), W walks, Space and the arrows don\'t scroll; after Esc, Space scrolls the page again',
  !clicked.lock && clicked.focus === 'viewer' && clicked.hint === 'Esc to release' && clicked.route === null && clickWalk > 0.1 &&
  engagedScroll === 0 && !escaped.lock && escaped.focus !== 'viewer' && escaped.walk < 0.01 && releasedScroll > 0,
  JSON.stringify({ clicked, clickWalk: +clickWalk.toFixed(2), engagedScroll, escaped, releasedScroll }));
await shot('embed-keys.png');

// The mouse over the view: the keys are its own (no click); away from it they are the page's again
await p.mouse.move(5, 5); await p.mouse.move(500, 360); await frames(2);
const hoverWalk = await hold('KeyW');
await p.mouse.move(5, 5); await frames(2);
const awayWalk = await hold('KeyW');
log('the mouse over the view gives it the keys (W walks, no click); away from it, W doesn\'t walk',
  hoverWalk > 0.1 && awayWalk < 0.01, JSON.stringify({ hoverWalk: +hoverWalk.toFixed(2), awayWalk: +awayWalk.toFixed(2) }));

// ── 2. Walk into the training room: enterRoom ──
await p.mouse.move(500, 360); // over the view: its keys
await frames(2);
log('walking: the view never captures the mouse by itself', await p.evaluate(() => !document.pointerLockElement));
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
await p.mouse.move(500, 360); await wait(500); // over the view: the keys are its own
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

// ── 5b. Search: workplace.find() and the search box (v0.13.3) ──
await p.evaluate(() => window.workplace.setPeople([
  { personId: 'p_asha', deskId: 'obj_desk_1', name: 'Asha Patel', department: 'Engineering', email: 'asha@example.com', assetReference: null },
]));
const found = await p.evaluate(() => {
  const w = window.workplace;
  return { asha: w.find('asha'), offices: w.find('office').map((r) => `${r.kind}:${r.name}`), reception: w.find('reception').map((r) => `${r.group}:${r.name}`), none: w.find('zzzz') };
});
log('workplace.find(): people (name and department only), rooms, facilities',
  found.asha.length === 1 && found.asha[0].name === 'Asha Patel' && found.asha[0].deskId === 'obj_desk_1' && found.asha[0].floorName === 'Ground Floor' &&
  !('email' in found.asha[0]) && found.offices.join() === 'room:Office 1,room:Office 2' && found.reception.includes('facilities:Reception') &&
  found.none.length === 0, JSON.stringify(found));
await p.click('#workplace button[aria-label="Find a person, room or place"]');
await p.keyboard.type('asha');
await p.keyboard.press('Enter');
await frames(6);
const boxShown = await p.evaluate(() => ({
  shown: document.querySelector('#workplace [data-place-shown]')?.innerText.replace(/\n/g, ' | '), lit: window.workplace._engine.highlights.ids(),
  email: /asha@example\.com/.test(document.getElementById('workplace').innerHTML),
}));
log('the search box: "asha" + Enter shows Asha Patel, her desk outlined; no email in the page',
  /^Asha Patel \| Engineering · Ground Floor, Office 1 \| Show route \| Take me there$/.test(boxShown.shown ?? '') && boxShown.lit[0] === 'obj_desk_1' && !boxShown.email,
  JSON.stringify(boxShown));
// The browse menu (v0.14.2): setDepartments' descriptions under the departments that exist here
const described = await p.evaluate(() => window.workplace.setDepartments([
  { name: 'Engineering', description: 'Builds the product', head: 'not copied' }, { name: 'Nowhere', description: 'not here' },
]));
await p.click('#workplace button[aria-label="Find a person, room or place"]');
await wait(300);
const menu = await p.evaluate(() => ({
  departments: [...document.querySelectorAll('#workplace [data-browse-open^="department:"]')].map((o) => o.innerText.replace(/\n/g, ' | ')),
  quick: [...document.querySelectorAll('#workplace [data-quick]')].map((q) => q.textContent),
}));
await p.keyboard.press('Escape');
log('setDepartments(): the Find menu shows the description under Engineering (from the seats); none for a department not here',
  described === 2 && menu.departments.length === 1 && /^Engineering \| Ground Floor · 1 person \| Builds the product/.test(menu.departments[0]) &&
  menu.quick.length > 0, JSON.stringify({ described, ...menu }));
// A phone: the view is full width, so is the search box (12 px from each side), nothing off-screen
await p.setViewportSize({ width: 390, height: 844 });
await wait(500);
await p.locator('#workplace').scrollIntoViewIfNeeded();
await p.click('#workplace button[aria-label="Find a person, room or place"]');
await p.keyboard.type('o');
await wait(300);
const phone = await p.evaluate(() => {
  const view = document.getElementById('workplace').getBoundingClientRect();
  const panel = document.querySelector('#workplace [data-place-search]').getBoundingClientRect();
  return { view: Math.round(view.width), panel: Math.round(panel.width), left: Math.round(panel.left - view.left), right: Math.round(panel.right), scroll: document.documentElement.scrollWidth };
});
log('on a 390 px phone the search box is full width (the view less 12 px each side), nothing off-screen',
  phone.view === 390 && phone.panel === 366 && phone.left === 12 && phone.right <= 378 && phone.scroll <= 390, JSON.stringify(phone));
await shot('embed-search-phone.png');
await p.keyboard.press('Escape');
await p.setViewportSize({ width: 1280, height: 720 });
await p.evaluate(() => window.workplace.highlight([]));

// ── 5c. Show route from the page: workplace.goTo / stopRoute, the 'navigation' event (v0.13.4) ──
const going = await p.evaluate(async () => {
  const w = window.workplace;
  const before = window.embedEvents.length;
  const answer = w.goTo('Asha Patel', { walk: 'guide' });
  await new Promise((r) => setTimeout(r, 1500));
  const strip = document.querySelector('#workplace [data-nav-going]')?.textContent ?? '';
  const modeWhile = w.mode;
  const stopped = w.stopRoute();
  const events = window.embedEvents.slice(before).filter((x) => x.name === 'navigation').map((x) => x.data.state);
  const nobody = w.goTo('zzzz');
  w.setMode('view');
  return { place: answer?.place?.name, walk: answer?.walk, length: Math.round(answer?.length ?? 0), modeWhile, strip, stopped, events, nobody: nobody?.problem };
});
log('workplace.goTo(name, { walk: "guide" }) from above starts walking with the route; stopRoute ends it',
  going.place === 'Asha Patel' && going.walk === 'guide' && going.length > 0 && /^Going to Asha Patel/.test(going.strip) && going.modeWhile === 'walkthrough' &&
  going.stopped === true && going.events[0] === 'started' && going.events.at(-1) === 'stopped' && going.events.slice(1, -1).every((s) => s === 'progress') && going.nobody === 'NOT_FOUND', JSON.stringify(going));
await frames(3);

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
const withSearch = await p.evaluate(() => document.querySelectorAll('#extra [aria-label="Find a person, room or place"]').length);
log('layout: v2 JSON (getLayout()) shows the same office', !fromV2.error && fromV2.seen.includes('ready') && v2Rooms === 4, JSON.stringify({ ...fromV2, v2Rooms }));
await removeExtra();
const requestsBeforeLow = requests.length;
const low = await mountExtra({ layout: v2, mode: 'view', quality: 'low', navigation: { search: false } });
await p.waitForTimeout(3000);
const searchButtons = await p.evaluate(() => ({
  extra: document.querySelectorAll('#extra [aria-label="Find a person, room or place"]').length,
  find: window.extra?.find('office').length,
}));
log('option navigation: { search: false } hides the search box (find() still works)',
  searchButtons.extra === 0 && withSearch === 1 && searchButtons.find === 2, JSON.stringify({ ...searchButtons, withSearch }));
const lowLook = await p.evaluate(() => {
  const sc = window.extra?._engine?.scene;
  return {
    items: sc?.meshes.filter((m) => m.metadata?.objectId && m.parent?.metadata?.objectId).length ?? 0,
    models: sc?.meshes.filter((m) => m.metadata?.objectId && m.metadata?.model).length ?? -1,
    sky: !!sc?.environmentTexture,
  };
});
const lowFiles = requests.slice(requestsBeforeLow).filter((u) => u.includes('/assets/'));
log('quality: \'low\' shows the simple models and materials and downloads no asset files',
  !low.error && lowLook.items > 0 && lowLook.models === 0 && !lowLook.sky && lowFiles.length === 0,
  JSON.stringify({ ...lowLook, files: lowFiles.length }));
await removeExtra();
// startMode (v0.14.6): the viewer decides the start; onEvent('mode') and handle.mode follow it
const startWalk = await mountExtra({ layout: v2, startMode: 'walkthrough', weakDevice: false });
await p.waitForSelector('#extra [data-welcome]', { timeout: 60000 }).catch(() => {});
const walkStart = await p.evaluate(() => ({
  mode: window.extra?.mode, card: !!document.querySelector('#extra [data-welcome]'),
  button: document.querySelector('#extra [data-mode-button]')?.dataset.modeButton,
}));
log('option startMode "walkthrough": walking, the welcome card, the Overview button; onEvent("mode"), handle.mode',
  !startWalk.error && startWalk.seen.includes('mode') && walkStart.mode === 'walkthrough' && walkStart.card && walkStart.button === 'overview',
  JSON.stringify({ ...walkStart, seen: startWalk.seen }));
await removeExtra();
await p.evaluate(() => { try { localStorage.removeItem('ahdus.viewMode'); } catch { /* blocked */ } });
const startWeak = await mountExtra({ layout: v2, startMode: 'walkthrough', quality: 'low' });
const weakStart = await p.evaluate(() => ({
  mode: window.extra?.mode, card: !!document.querySelector('#extra [data-welcome]'),
  button: document.querySelector('#extra [data-mode-button]')?.dataset.modeButton,
}));
log('startMode with quality "low" (a weak device): from above, no card, a Walk button',
  !startWeak.error && weakStart.mode === 'view' && !weakStart.card && weakStart.button === 'walk', JSON.stringify(weakStart));
await removeExtra();
const startEdit = await mountExtra({ layout: v2, startMode: 'edit' });
log('startMode "edit" is refused: onError, the element is empty', /edit/i.test(startEdit.error ?? '') && startEdit.children === 0,
  JSON.stringify(startEdit));
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
