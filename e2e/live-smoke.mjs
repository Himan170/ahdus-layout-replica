// Live presence (v0.16.1), in the embed (dist-embed/ahdus-workplace.js on a plain page, no dev server, no AHDUS):
// FAKE live people driven by this page (workplace.live.add / update / remove), as the 3D Company page's WebSocket
// will. Checks: a live person's seated figure leaves their desk and they are drawn where they walk (~250 ms behind,
// gliding, never ahead of their samples), a jump over 5 m snaps, someone looking from above stands beside their desk,
// someone on another floor isn't drawn, name tags (name only, over the head, gone when they leave), near ones are
// full characters from their FULL file playing Walk / Wave, removed / silent 10 s = back at their desk, the nearest
// 30 drawn, per floor, clear(); your own pose events (≤ 5 a second, only when moving, a keepalive, your wave);
// the full-character cap measured from the frame rate (SwiftShader = a weak device: 12); a phone.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run e2e:live            (builds the embed; serves the files itself)
//                   SHOTS=private-docs/screenshots/v0.16.1 npm run e2e:live   (also 1440×900 + 390×844 shots)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
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

if (!process.env.NO_BUILD) execSync('npx vite build --config vite.embed.config.js --logLevel error', { stdio: 'inherit' });

// ── The layout: an open office, 16 desks with chairs, and 4 desks upstairs ──
const objects = [];
let n = 0;
for (const z of [-4.5, -2, 0.5, 3]) {
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    n++;
    objects.push({ id: `obj_desk_${n}`, assetType: 'DESK_STANDARD', floor: 0, roomId: 'room_open', x, y: 0, z, rotationY: 0 });
    objects.push({ id: `obj_chair_${n}`, assetType: 'CHAIR_OFFICE', floor: 0, roomId: 'room_open', x, y: 0, z: z + 0.7, rotationY: Math.PI });
  }
}
for (const [i, [x, z]] of [[-3, -1.5], [3, -1.5], [-3, 1.5], [3, 1.5]].entries()) {
  objects.push({ id: `obj_desk_${17 + i}`, assetType: 'DESK_STANDARD', floor: 1, roomId: 'room_up', x, y: 0, z, rotationY: 0 });
  objects.push({ id: `obj_chair_${17 + i}`, assetType: 'CHAIR_OFFICE', floor: 1, roomId: 'room_up', x, y: 0, z: z + 0.7, rotationY: Math.PI });
}
const LAYOUT = {
  format: 'ahdus-layout', formatVersion: 1,
  layout: {
    layoutName: 'Live test office', layoutVersion: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } },
    rooms: [
      { id: 'room_open', type: 'OFFICE', name: 'Open office', floor: 0, x: 0, z: 0, width: 20, depth: 13, wallHeight: 3.2,
        doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }], windows: [] },
      { id: 'room_up', type: 'OFFICE', name: 'Upstairs office', floor: 1, x: 0, z: 0, width: 12, depth: 8, wallHeight: 3.2, doors: [], windows: [] },
    ],
    objects,
    anchorData: {},
  },
};
const PEOPLE = Array.from({ length: 20 }, (_, i) => ({
  personId: `user_${i + 1}`, deskId: `obj_desk_${i + 1}`, name: `Person ${i + 1}`, department: 'Sales',
  email: `person${i + 1}@example.com`, // must never reach the view
  assetReference: null,
}));
PEOPLE[1].name = 'Asha Patel';
PEOPLE[2].name = 'Ravi Kumar';
const MANIFEST = {
  version: 2,
  clips: { office: { url: 'placeholder-clips.glb' } },
  neutral: ['placeholder:suit-v1'],
  characters: {
    'placeholder:suit-v1': { url: 'placeholder-suit.glb', seated: 'placeholder-suit-seated.glb', rig: 'mixamo', height: 1.74,
      gender: 'female', outfit: 'rocketbox', clips: 'office' },
  },
};

// ── A plain static server: the repo, plus this test's page ──
const root = resolve('.');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live test</title><style>html,body{margin:0;height:100%;font:14px system-ui}#workplace{position:absolute;inset:0}</style></head>
<body><div id="workplace"></div><script src="/dist-embed/ahdus-workplace.js"></script></body></html>`;
const site = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (path === '/live-test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  const file = normalize(join(root, path.replace(/-seated\.glb$/, '.glb')));
  if (!file.startsWith(root) || /node_modules|[\\/]\.git/.test(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
const port = await new Promise((ok) => site.listen(0, 'localhost', () => ok(site.address().port)));
const base = `http://localhost:${port}/`;
const dir = new URL('dist-embed/assets/characters/', base).href;

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** A page with the workplace mounted, the people seated. */
async function open(viewport = { width: 1280, height: 720 }, { player = 'user_1' } = {}) {
  const pg = await b.newPage({ viewport });
  await pg.addInitScript(() => { try { localStorage.setItem('ahdus.walkHintSeen', '1'); } catch { /* none */ } });
  pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
  pg.asked = [];
  pg.on('request', (r) => pg.asked.push(r.url()));
  await pg.goto(new URL('live-test.html', base).href);
  await pg.evaluate(async ({ layout, manifest, dir, people, player }) => {
    window.embedEvents = [];
    window.workplace = AHDUSWorkplace.mount(document.getElementById('workplace'), {
      layout, mode: 'view', player: { personId: player, assetReference: null },
      characters: { manifest, manifestUrl: dir + 'manifest.json' },
      onEvent: (name, data) => window.embedEvents.push({ name, data, t: performance.now() }),
    });
    await window.workplace.ready;
    window.workplace._engine.babylonEngine.setHardwareScalingLevel(2); // fast without a GPU
    await window.workplace.setPeople(people);
  }, { layout: LAYOUT, manifest: MANIFEST, dir, people: PEOPLE, player });
  return pg;
}
const frames = (pg, count = 3) => pg.evaluate((count) => new Promise((res) => {
  const sc = window.workplace._engine.scene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= count) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 30000);
}), count);
const wait = (pg, ms) => pg.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms);
const look = (pg, x, z, radius, beta = 0.9, alpha = -Math.PI / 2) => pg.evaluate(({ x, z, radius, beta, alpha }) => {
  const cam = window.workplace._engine.scene.activeCamera;
  cam.target.set(x, 0.8, z);
  cam.radius = radius; cam.beta = beta; cam.alpha = alpha;
}, { x, z, radius, beta, alpha });
const live = (pg) => pg.evaluate(() => window.workplace.live.list());
const liveOf = async (pg, id) => (await live(pg)).find((p) => p.personId === id);
const seatedShown = (pg) => pg.evaluate(() => {
  const cs = window.workplace._engine.characters;
  return cs.getPlaced().filter((p) => cs.isShown(p)).map((p) => p.personId);
});
const shot = async (pg, name) => {
  await pg.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}`, timeout: 120000 });
};
/** Start a fake walker in the page: samples every 200 ms along +x at `speed` m/s (window.__walkers[id]). */
const startWalker = (pg, id, { x, z, floor = 0, speed = 2 }) => pg.evaluate(({ id, x, z, floor, speed }) => {
  window.__walkers ??= {};
  window.__drawn ??= {};
  const t0 = performance.now();
  const sent = [];
  window.__walkers[id] = { sent, timer: setInterval(() => {
    const t = performance.now();
    const at = { floor, x: x + ((t - t0) / 1000) * speed, z, yaw: Math.PI / 2, state: 'walk' };
    sent.push({ t, x: at.x });
    window.workplace.live.update(id, at);
  }, 200) };
  // what is drawn each frame
  const e = window.workplace._engine;
  const drawn = window.__drawn[id] = [];
  e.scene.onAfterRenderObservable.add(() => {
    const p = e.live.list().find((q) => q.personId === id);
    if (p?.at) drawn.push({ t: performance.now(), x: p.at.x });
  });
}, { id, x, z, floor, speed });
const stopWalker = (pg, id) => pg.evaluate((id) => clearInterval(window.__walkers[id].timer), id);

// ── 1. Live people leave their desks ──
const p = await open();
await look(p, -2.5, -1, 9);
await frames(p, 3);
const before = await seatedShown(p);
await p.evaluate(() => {
  const l = window.workplace.live;
  l.add({ personId: 'user_2', floor: 0, x: -6, z: -3.2, yaw: Math.PI / 2, state: 'idle' }); // walking (no name given: setPeople's)
  l.add({ personId: 'user_3', state: 'overview', floor: 0 }); // on the page, looking from above
  l.add({ personId: 'user_4', floor: 1, state: 'walk' }); // walking upstairs: no position here
  l.add({ personId: 'user_1', floor: 0, x: 0, z: 0, state: 'idle' }); // yourself (the player): never drawn
  // Ravi's page sends a keepalive every 3 s (looking from above) until section 5
  window.__keepRavi = setInterval(() => l.update('user_3', { state: 'overview', floor: 0 }), 3000);
});
await frames(p, 4);
const after = await seatedShown(p);
log('live people leave their desks: their seated figures are hidden, everyone else stays seated (you too)',
  before.length === 16 && after.length === 13 && after.includes('user_1') && !after.includes('user_2') && !after.includes('user_3') && !after.includes('user_4'),
  `before ${before.length}, after ${after.length}`);
const u2 = await liveOf(p, 'user_2');
const u3 = await liveOf(p, 'user_3');
const u4 = await liveOf(p, 'user_4');
const me = await liveOf(p, 'user_1');
log('who they are comes from setPeople (name only: no email); the walker is drawn where they are',
  u2?.name === 'Asha Patel' && !!u2.drawn && Math.abs(u2.at.x + 6) < 0.05 && !JSON.stringify(await live(p)).includes('example.com'),
  JSON.stringify(u2));
log('looking from above: they stand up beside their desk (behind their chair)',
  u3?.atDesk && !!u3.drawn && Math.abs(u3.at.x - 2.5) < 0.05 && Math.abs(u3.at.z - (-4.5 + 0.7 + 0.55)) < 0.05, JSON.stringify(u3?.at));
log('walking on another floor (no position here): not drawn; yourself: never drawn', !u4?.drawn && !me?.drawn,
  `${u4?.drawn} ${me?.drawn}`);

// ── 2. Gliding, 250 ms behind, never ahead; a jump snaps ──
await startWalker(p, 'user_2', { x: -6, z: -3.2 });
await wait(p, 4000);
const path = await p.evaluate(() => ({ drawn: window.__drawn.user_2, sent: window.__walkers.user_2.sent }));
const late = path.drawn.filter((d) => d.t > path.sent[2]?.t);
const ahead = late.filter((d) => d.x > Math.max(...path.sent.filter((s) => s.t <= d.t).map((s) => s.x)) + 0.02);
let back = 0;
for (let i = 1; i < late.length; i++) if (late[i].x < late[i - 1].x - 0.01) back++;
const lags = late.map((d) => {
  const newest = path.sent.filter((s) => s.t <= d.t).at(-1);
  return newest ? (newest.x - d.x) / 2 : 0; // seconds behind at 2 m/s
});
const meanLag = lags.reduce((a, c) => a + c, 0) / Math.max(1, lags.length);
log('walking: drawn behind the samples, gliding forward (never ahead of them, never back)',
  late.length >= 3 && ahead.length === 0 && back === 0 && meanLag > 0.1 && meanLag < 0.9,
  `${late.length} frames, lag ≈ ${meanLag.toFixed(2)} s, ${ahead.length} ahead, ${back} back`);
await stopWalker(p, 'user_2');
await p.evaluate(() => {
  window.__drawn.user_2.length = 0;
  window.workplace.live.update('user_2', { floor: 0, x: -6, z: 4.5, yaw: 0, state: 'idle' }); // Back to entrance: ~9 m
});
await wait(p, 1500);
const jump = await p.evaluate(() => window.__drawn.user_2.map((d) => d.x));
const lastSent = path.sent.at(-1).x;
log('a jump over 5 m snaps: no frame drawn on the way there (never through the walls)',
  jump.length >= 2 && jump.every((x) => Math.abs(x + 6) < 0.05 || x > lastSent - 1.2) && Math.abs(jump.at(-1) + 6) < 0.05,
  jump.map((x) => x.toFixed(1)).join(' '));

// ── 3. Name tags ──
await p.evaluate(() => window.workplace.live.update('user_2', { floor: 0, x: -3, z: -1, yaw: 0, state: 'idle' }));
await look(p, -0.3, -2, 10); // Asha and Ravi (standing at his desk) both in view
await wait(p, 600);
await frames(p, 3);
const tags = await p.evaluate(() => [...document.querySelectorAll('[data-live-tag]')]
  .filter((t) => t.style.display !== 'none').map((t) => {
    const r = t.getBoundingClientRect();
    return { id: t.getAttribute('data-live-tag'), text: t.textContent, x: r.left + r.width / 2, bottom: r.bottom };
  }));
const head = await p.evaluate(() => {
  const sc = window.workplace._engine.scene;
  const cam = sc.activeCamera;
  const canvas = sc.getEngine().getRenderingCanvas();
  const V = cam.position.constructor;
  const M = sc.getTransformMatrix().constructor;
  const s = V.Project(new V(-3, 1.74, -1), M.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
  return { x: s.x, y: s.y };
});
const t2 = tags.find((t) => t.id === 'user_2');
log('name tags: one per live person drawn, the name only, over their head',
  t2?.text === 'Asha Patel' && tags.some((t) => t.text === 'Ravi Kumar') && !tags.some((t) => /@|user_1/.test(t.text + t.id)) &&
  Math.abs(t2.x - head.x) < 20 && t2.bottom < head.y && t2.bottom > head.y - 60,
  `${JSON.stringify(tags)} head ${JSON.stringify(head)} ravi ${JSON.stringify(await liveOf(p, 'user_3'))}`);
log('the tag layer takes no clicks and is hidden from screen readers', await p.evaluate(() => {
  const l = document.querySelector('[data-live-tags]');
  return getComputedStyle(l).pointerEvents === 'none' && l.getAttribute('aria-hidden') === 'true';
}));

// ── 4. Near: full characters from their FULL file, walking, waving ──
await look(p, -3, -1, 4, 1.1);
const fullBy = async (id) => {
  for (let i = 0; i < 60; i++) {
    await p.evaluate(() => window.workplace._engine.characters.whenSettled());
    await frames(p, 2);
    if ((await liveOf(p, id))?.drawn === 'full') return true;
    await wait(p, 300);
  }
  return false;
};
const full = await fullBy('user_2');
const fullFile = p.asked.filter((u) => u.endsWith('/placeholder-suit.glb')).length;
log('near: a live person is a full character, from their FULL file (not the seated copy)', full && fullFile === 1,
  `full ${full}, placeholder-suit.glb asked ${fullFile}×`);
await startWalker(p, 'user_2', { x: -3, z: -1, speed: 1.5 });
await wait(p, 1500);
await frames(p, 2);
const gaitWalking = await p.evaluate(() => window.workplace._engine.live.entries.get('user_2')?.walker?.gait ?? null);
await stopWalker(p, 'user_2');
await p.evaluate(() => {
  const x = window.__walkers.user_2.sent.at(-1).x;
  window.workplace.live.update('user_2', { floor: 0, x, z: -1, yaw: Math.PI, state: 'wave' });
});
await wait(p, 700);
await frames(p, 2);
const gaitWave = await p.evaluate(() => window.workplace._engine.live.entries.get('user_2')?.walker?.gait ?? null);
log('their clips follow what their browser says: Walk while walking, Wave when they wave (H)',
  gaitWalking === 'Walk' && gaitWave === 'Wave', `${gaitWalking} → ${gaitWave}`);
await shot(p, 'live-near.png');

// ── 5. Leaving: removed, or silent for 10 s ──
await p.evaluate(() => window.workplace.live.remove('user_2'));
await frames(p, 3);
const back2 = await seatedShown(p);
log('removed (they closed the page): back at their desk, the tag gone',
  back2.includes('user_2') && !(await p.evaluate(() => !!document.querySelector('[data-live-tag="user_2"]'))));
// Ravi's page stops sending (closed without a goodbye): 10 s later he sits back down
await p.evaluate(() => clearInterval(window.__keepRavi));
await wait(p, 6000);
const stillThere = !!(await liveOf(p, 'user_3'));
await wait(p, 5500);
await frames(p, 2);
const silent = await seatedShown(p);
log('silent for 10 s: back at their desk by themselves (not before)', stillThere && silent.includes('user_3') && !(await liveOf(p, 'user_3')),
  `live: ${(await live(p)).map((x) => x.personId).join(', ')}`);
// heard again (the connection came back): live again, up from his desk
const heard = await p.evaluate(() => window.workplace.live.update('user_3', { floor: 0, state: 'overview' }));
await frames(p, 3);
const again = await liveOf(p, 'user_3');
log('heard again after the silence (an update): live again, his desk empty',
  heard && again?.atDesk && !(await seatedShown(p)).includes('user_3'), JSON.stringify(again));
await p.evaluate(() => window.workplace.live.remove('user_3'));

// ── 6. The nearest 30; another floor; clear() ──
await p.evaluate(() => {
  for (let i = 0; i < 40; i++) {
    window.workplace.live.add({ personId: `visitor_${i}`, name: `Visitor ${i}`, floor: 0, x: -9 + (i % 10) * 2, z: -5 + Math.floor(i / 10) * 3, state: 'idle' });
  }
  window.workplace.live.add({ personId: 'upstairs', name: 'Up Stairs', floor: 1, x: 0, z: 0, state: 'idle' });
});
await look(p, 0, 0, 22, 0.6);
await wait(p, 500);
await frames(p, 3);
const many = await live(p);
const drawnNow = many.filter((x) => x.drawn).map((x) => x.personId);
log('41 live people: the nearest 30 on the floor shown are drawn (not the one upstairs)',
  drawnNow.length === 30 && !drawnNow.includes('upstairs'), `${drawnNow.length} drawn`);
await shot(p, 'live-many.png');
await p.evaluate(() => window.workplace.setFloor(1));
await wait(p, 500);
await frames(p, 3);
log('per floor: Floor 1 shown = the one up there drawn', (await liveOf(p, 'upstairs'))?.drawn != null);
await p.evaluate(() => { window.workplace.setFloor(0); window.workplace.live.clear(); });
const floor0At = await p.evaluate(() => performance.now());
await frames(p, 3);
log('clear() (the connection dropped): everyone back at their desk, no tags', (await seatedShown(p)).length === 16
  && (await live(p)).length === 0 && (await p.evaluate(() => document.querySelectorAll('[data-live-tag]').length)) === 0);

// ── 7. Your own pose: ≤ 5 a second, only when moving; a keepalive; your wave ──
const poses = () => p.evaluate(() => window.embedEvents.filter((e) => e.name === 'pose').map((e) => ({ ...e.data, t: e.t })));
await wait(p, 4600);
const overview = (await poses()).filter((x) => x.state === 'overview' && x.t > floor0At);
log('from above: { state: "overview", floor } and a keepalive every 4 s', overview.length >= 2 && overview.every((x) => x.floor === 0 && x.x === undefined),
  `${overview.length} overview poses`);
await p.evaluate(() => window.workplace.setMode('walkthrough'));
await p.evaluate(() => window.workplace._engine.whenPlayerReady());
await wait(p, 800);
const t0 = await p.evaluate(() => performance.now());
await p.keyboard.down('KeyW');
await wait(p, 2500);
await p.keyboard.up('KeyW');
const t1 = await p.evaluate(() => performance.now());
await wait(p, 3000);
const all = (await poses()).filter((x) => x.t > t0);
const moving = all.filter((x) => x.t <= t1 + 300);
const gaps = moving.slice(1).map((x, i) => x.t - moving[i].t);
const standing = all.filter((x) => x.t > t1 + 1200);
log('walking: your pose at most 5 a second (x, y, z, yaw, floor, "walk"), small enough to send',
  moving.length >= 2 && moving.length <= 15 && gaps.every((g) => g >= 190) && moving.some((x) => x.state === 'walk')
  && moving.every((x) => typeof x.x === 'number' && JSON.stringify(x).length < 160), `${moving.length} poses, min gap ${Math.min(...gaps).toFixed(0)} ms`);
log('standing still: nothing more (only a keepalive after 4 s); the last pose is "idle" where you stopped',
  standing.length <= 1 && all.at(-1)?.state === 'idle', `${standing.length} while standing, last ${all.at(-1)?.state}`);
await p.keyboard.press('KeyH');
await wait(p, 1200);
const waved = (await poses()).some((x) => x.state === 'wave');
log('your wave (H) is sent ("wave"), so the others see it', waved);

// ── 8. The cap: measured from the frame rate; SwiftShader = a weak device ──
const cap = await p.evaluate(() => {
  const e = window.workplace._engine;
  return { cap: e.fullCap.cap, weak: e.weakDevice, windows: e.fullCap.history.length, fps: e.fullCap.history.map((h) => h.fps) };
});
log('full-character cap: measured from frames (windows of frame times), 12 on this weak device (software WebGL)',
  cap.cap === 12 && cap.weak && cap.windows >= 1, JSON.stringify(cap));
await shot(p, 'live-walking.png');

// ── 9. A phone: tags and people ──
{
  const ph = await open({ width: 390, height: 844 });
  await ph.evaluate(() => {
    window.workplace.live.add({ personId: 'user_2', floor: 0, x: -3, z: -2.8, yaw: 0, state: 'idle' });
    window.workplace.live.add({ personId: 'user_3', floor: 0, x: -1.5, z: -2.6, yaw: -0.6, state: 'idle' });
  });
  await look(ph, -2.25, -2.7, 5, 0.6); // the camera inside the room (further back = behind the south wall)
  await wait(ph, 600);
  await frames(ph, 4);
  const phone = await ph.evaluate(() => [...document.querySelectorAll('[data-live-tag]')].filter((t) => t.style.display !== 'none').map((t) => {
    const r = t.getBoundingClientRect();
    return { text: t.textContent, inside: r.left >= 0 && r.right <= 390 };
  }));
  log('a phone: the name tags show, inside the view', phone.length === 2 && phone.every((t) => t.inside), JSON.stringify(phone));
  await shot(ph, 'live-phone.png');
  await ph.close();
}

log('no errors on the page', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
site.close();
