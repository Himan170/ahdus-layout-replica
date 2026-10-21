// Viewer smoke test: the blank page viewer.html mounts <LayoutViewer mode="walkthrough" />
// with no Workplace Studio code, draws a layout, walks into rooms (enterRoom), presses E
// (interact + a teammate's "Press E" action through layoutBridge), refuses every edit,
// changes floor, switches to view mode, and opens a layout saved in the browser.
// The production bundle of viewer.html is checked for Studio code too (vite build).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:viewer     (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:3000/';
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

// ── 0. The production bundle of viewer.html has no Studio code ──
// (Studio's UI texts are only in its own chunk; the viewer loads its chunk and the shared engine)
execSync('npx vite build --logLevel error', { stdio: 'inherit' });
const viewerHtml = readFileSync('dist/viewer.html', 'utf8');
const chunks = [...viewerHtml.matchAll(/assets\/[^"]+\.(?:js|css)/g)].map((m) => m[0]);
const STUDIO = /Preview Workplace|Floor switcher|All layouts/;
const withStudio = chunks.filter((c) => STUDIO.test(readFileSync(`dist/${c}`, 'utf8')));
const appHasStudio = [...readFileSync('dist/index.html', 'utf8').matchAll(/assets\/[^"]+\.js/g)]
  .some((m) => STUDIO.test(readFileSync(`dist/${m[0]}`, 'utf8')));
log('viewer.html\'s bundle has no Studio code (and no stylesheet)', appHasStudio && withStudio.length === 0 && !chunks.some((c) => c.endsWith('.css')),
  `${chunks.join(', ')}${withStudio.length ? ` | Studio in: ${withStudio}` : ''}`);

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const requests = [];
p.on('request', (r) => requests.push(new URL(r.url()).pathname));

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.__ahdusViewer.walkthrough.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
const walkUntil = async (key, done, maxMs = 25000) => {
  const start = Date.now();
  await p.keyboard.down(key);
  while (Date.now() - start < maxMs && !done(await pos())) await wait(250);
  await p.keyboard.up(key);
  await frames(2);
};
const events = (name) => p.evaluate((n) => (window.__viewerEvents ?? []).filter((e) => e.event === n).map((e) => e.payload), name);
const cardText = () => p.evaluate(() => { const c = (window.__ahdusCards ?? []).at(-1); return c ? `${c.title} ${c.text}` : ''; });
const promptText = () => p.locator('[data-hud="prompt"]').textContent({ timeout: 2000 }).catch(() => '');
const layoutJson = () => p.evaluate(() => JSON.stringify(window.__ahdusViewer.getLayout()));
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const ready = (rooms) => p.waitForFunction((n) => window.__ahdusViewer?.rooms.meshes.size === n, rooms, { timeout: 90000 });

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

// ── 1. The page: the sample company, walking through, with the teammates' demo modules ──
await p.goto(new URL('viewer.html?demoModules=1', base).href);
await ready(3);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2)); // fast without a GPU
await frames(3);
const drawn = await p.evaluate(() => ({
  rooms: window.__ahdusViewer.rooms.meshes.size, items: window.__ahdusViewer.objects.meshes.size, mode: window.__ahdusViewer.mode,
}));
log('viewer.html draws the layout (3 rooms on 2 floors, 6 items) in walkthrough mode',
  drawn.rooms === 3 && drawn.items === 6 && drawn.mode === 'walkthrough', JSON.stringify(drawn));
const studioFiles = requests.filter((u) => /\/src\/(components|ui|planner)\//.test(u) || /WorkplaceEditor|StudioPanel/.test(u));
log('no Studio code is loaded (dev server)', studioFiles.length === 0 && requests.some((u) => u.includes('LayoutViewer')),
  studioFiles.slice(0, 3).join(', ') || `${requests.filter((u) => u.startsWith('/src/')).length} source files`);
const bridge = await p.evaluate(() => ({
  rooms: window.ahdus.getRooms().map((r) => r.name).sort(),
  machine: window.ahdus.getAnchors({ kind: 'machine' })[0]?.objectId,
  scene: window.ahdus.getScene() === window.__ahdusViewer.scene,
}));
log('layoutBridge reads the viewer\'s layout (rooms, anchors, scene)',
  bridge.rooms.join() === 'Engineering,Meeting room,Reception' && bridge.machine === 'obj_cnc' && bridge.scene, JSON.stringify(bridge));

// ── 2. Walk in through the door: enterRoom ──
await p.mouse.move(500, 360);
await p.click('canvas');
await wait(500);
log('clicking the view captures the mouse', await p.evaluate(() => !!document.pointerLockElement));
await pose(0, -7, 0, 0); // outside, south of the Reception door, facing it
await walkUntil('KeyW', ({ z }) => z > -2.5); // through the door (south wall at z = -3); the reception desk stops you at about -1.75
const at = await pos();
await frames(3);
const entered = await events('enterRoom');
log('walking in through the door sends enterRoom (with the room) and the HUD names it',
  at.z > -2.5 && entered.some((e) => e.roomId === 'room_reception' && e.room?.name === 'Reception') &&
  (await p.locator('[data-hud="room"]').textContent()) === 'Reception',
  `z=${at.z.toFixed(2)} | ${entered.map((e) => e.room?.name).join(',')}`);
await shot('viewer-walkthrough.png');

// ── 3. E on the CNC machine: interact, and Karthik's demo action runs in the viewer ──
await pose(12, 1.5, Math.PI, 0); // inside Engineering
const prompt = await lookAt(13, 1.2, /Watch CNC Machine video/);
log('looking at the CNC machine shows "E Watch CNC Machine video"', /Watch CNC Machine video/.test(prompt), prompt);
await p.keyboard.press('KeyE'); await frames(3);
const inter = (await events('interact')).at(-1);
const card = await cardText();
log('E sends interact with the machine\'s ids and runs the module\'s action',
  inter?.objectId === 'obj_cnc' && inter?.anchorKind === 'machine' && inter?.room?.name === 'Engineering' && /operation video/.test(card),
  `${inter?.objectId} ${inter?.anchorKind} | ${card.slice(0, 50)}`);
await shot('viewer-interact.png');

// ── 4. Nothing can change the layout ──
const before = await layoutJson();
await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frames(3); // "remove" what you look at
await p.keyboard.press('KeyN'); await frames(3);                                                // "add a floor"
const refused = await p.evaluate(() => {
  const v = window.__ahdusViewer;
  const ws = window.ahdus.getAnchors({ kind: 'workstation' })[0];
  return {
    addRoom: v.editor.addRoom({ type: 'OFFICE', x: 30, z: 0, width: 4, depth: 4 }),
    deleteObject: v.editor.deleteObject('obj_cnc'),
    undo: v.undo(),
    positionRef: window.ahdus.setPositionRef(ws.id, 'POS-1'),
  };
});
log('right-click and N change nothing; editor commands, undo and the bridge\'s writes are refused',
  (await layoutJson()) === before && refused.addRoom?.problem && refused.deleteObject?.problem && refused.undo === false && refused.positionRef === false,
  JSON.stringify(refused));

// ── 5. Page Up: the floor above ──
await p.keyboard.press('PageUp'); await frames(4);
const level = await p.evaluate(() => window.__ahdusViewer.walkthrough.getLevel());
log('Page Up takes you to Floor 1', level === 1, `level ${level} | ${await p.locator('[data-hud="floor"]').textContent().catch(() => '')}`);

// ── 6. View mode: orbit camera, still read-only ──
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
await p.click('button:has-text("View")'); await frames(4);
const view = await p.evaluate(() => ({
  mode: window.__ahdusViewer.mode,
  walking: window.__ahdusViewer.walkthrough.isActive(),
  camera: window.__ahdusScene.activeCamera?.name,
  refused: !!window.__ahdusViewer.editor.addRoom({ type: 'OFFICE', x: 30, z: 0, width: 4, depth: 4 })?.problem,
}));
log('"View" switches to the orbit camera; edits are still refused',
  view.mode === 'view' && !view.walking && view.camera === 'mainCamera' && view.refused, JSON.stringify(view));
await shot('viewer-view.png');

// ── 7. A layout saved in this browser (companyId + layoutId) ──
await p.evaluate(() => {
  const save = {
    companyId: 'co_viewer', layoutId: 'lay_viewer', layoutName: 'Saved one', layoutVersion: 1, revision: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
    rooms: [{ id: 'room_saved', type: 'OFFICE', name: 'Saved office', floor: 0, x: 0, z: 0, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [] }],
    objects: [], anchorData: {},
  };
  localStorage.setItem('dwtwin_co_viewer_lay_viewer', JSON.stringify(save));
});
await p.goto(new URL('viewer.html?companyId=co_viewer&layoutId=lay_viewer&mode=view', base).href);
await ready(1);
const saved = await p.evaluate(() => ({ rooms: window.ahdus.getRooms().map((r) => r.name), mode: window.__ahdusViewer.mode }));
log('?companyId=…&layoutId=… opens a layout saved in this browser', saved.rooms.join() === 'Saved office' && saved.mode === 'view', JSON.stringify(saved));
await p.evaluate(() => localStorage.removeItem('dwtwin_co_viewer_lay_viewer'));

await p.goto(new URL('viewer.html?companyId=co_viewer&layoutId=nope', base).href);
const alert = await p.locator('[role="alert"]').textContent({ timeout: 90000 }).catch(() => '');
log('a layout that doesn\'t exist says so', /no longer exists/.test(alert), alert);

log('no page errors', errs.length === 0, errs[0] ?? '');
await b.close();
