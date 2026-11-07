// People at their desks, in the embed (dist-embed/ahdus-workplace.js on a plain page, no dev server):
// 21 people (20 seated, 1 standing at a desk with no chair) on two floors, their characters from a
// manifest (the self-made placeholder figures: public/assets/characters/, Mixamo and Unreal-style
// bone names) or none (the simple figure). Checks: who is drawn as a full character (nearest, ≤ 12,
// each file downloaded once), seated poses, not pickable, the hover card (name + department, text
// only, never the email), a click keeps the card, a tap on a phone shows it, "Choose your character" on the
// player's own card (setPlayer), per floor (setFloor), walking up to a desk, quality 'low' = no people.
// The view from above (the 3D Company page's "Upper view") shows the chosen floor without its roof: at the start,
// after setFloor and after walking (on the floor walked to). Walking as yourself (setPlayer + characters.walkClipUrl):
// your own character walks with our placeholder clip (Mixamo and Unreal-style rigs), stands when you stop, the camera
// at your eye height, V hides your body, your seated figure hides; no character = the simple figure.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run e2e:characters      (builds the embed; serves the files itself)
//                   SHOTS=private-docs/screenshots/v0.11 npm run e2e:characters   (also 1440×900 + 390×844 shots)
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

execSync('npx vite build --config vite.embed.config.js --logLevel error', { stdio: 'inherit' });

// ── The layout: an open office (16 desks with chairs + 1 without) and 4 desks upstairs ──
const objects = [];
const rows = [-4.5, -2, 0.5, 3];
const cols = [-7.5, -2.5, 2.5, 7.5];
let n = 0;
for (const z of rows) {
  for (const x of cols) {
    n++;
    objects.push({ id: `obj_desk_${n}`, assetType: 'DESK_STANDARD', floor: 0, roomId: 'room_open', x, y: 0, z, rotationY: 0 });
    objects.push({ id: `obj_chair_${n}`, assetType: 'CHAIR_OFFICE', floor: 0, roomId: 'room_open', x, y: 0, z: z + 0.7, rotationY: Math.PI });
  }
}
objects.push({ id: 'obj_desk_17', assetType: 'DESK_STANDARD', floor: 0, roomId: 'room_open', x: 0, y: 0, z: 5.2, rotationY: 0 });
for (const [i, [x, z]] of [[-3, -1.5], [3, -1.5], [-3, 1.5], [3, 1.5]].entries()) {
  objects.push({ id: `obj_desk_${18 + i}`, assetType: 'DESK_STANDARD', floor: 1, roomId: 'room_up', x, y: 0, z, rotationY: 0 });
  objects.push({ id: `obj_chair_${18 + i}`, assetType: 'CHAIR_OFFICE', floor: 1, roomId: 'room_up', x, y: 0, z: z + 0.7, rotationY: Math.PI });
}
const LAYOUT = {
  format: 'ahdus-layout', formatVersion: 1,
  layout: {
    layoutName: 'People test office', layoutVersion: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } },
    rooms: [
      { id: 'room_open', type: 'OFFICE', name: 'Open office', floor: 0, x: 0, z: 0, width: 20, depth: 13, wallHeight: 3.2,
        doors: [{ wall: 'south', offset: 0, width: 1.4, height: 2.1 }], windows: [{ wall: 'north', offset: -4, width: 2, height: 1.2, sill: 0.9 }] },
      { id: 'room_up', type: 'OFFICE', name: 'Upstairs office', floor: 1, x: 0, z: 0, width: 12, depth: 8, wallHeight: 3.2, doors: [], windows: [] },
    ],
    objects,
    anchorData: {},
  },
};
const REFS = ['placeholder:mixamo-v1', 'placeholder:ue-v1', 'placeholder:tall-v1', null, 'mixamo:not-in-the-manifest'];
const DEPTS = ['Engineering', 'HR', 'Finance', 'Design'];
const PEOPLE = Array.from({ length: 21 }, (_, i) => ({
  personId: `user_${i + 1}`, deskId: `obj_desk_${i + 1}`,
  name: i === 1 ? '<b>Asha</b> Rao' : `Person ${i + 1}`, department: DEPTS[i % DEPTS.length],
  email: `person${i + 1}@example.com`, // must never reach the view
  assetReference: REFS[i % REFS.length],
}));

// ── A plain static server: the repo, plus this test's page ──
const root = resolve('.');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>People test</title><style>html,body{margin:0;height:100%;font:14px system-ui}#workplace{position:absolute;inset:0}</style></head>
<body><div id="workplace"></div><script src="/dist-embed/ahdus-workplace.js"></script></body></html>`;
const site = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (path === '/people-test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || /node_modules|[\\/]\.git/.test(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
const port = await new Promise((ok) => site.listen(0, 'localhost', () => ok(site.address().port)));
const base = `http://localhost:${port}/`;

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
// the one-time walking hint (v0.14.0, e2e:controls) has been seen: the HUD's own line shows at once
await p.addInitScript(() => { try { localStorage.setItem('ahdus.walkHintSeen', '1'); } catch { /* none */ } });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() !== 'error' || m.text().includes('BJS')) return;
  errs.push(m.text());
});
const requests = [];
p.on('request', (r) => requests.push(r.url()));
const warnings = [];
p.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });

const frames = (count = 3, pg = p) => pg.evaluate((count) => new Promise((res) => {
  const sc = window.workplace._engine.scene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= count) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 30000);
}), count);
const shot = async (name) => {
  await p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
};
/** Who is drawn now: simple figures (thin instances shown) and full characters. */
const drawnPeople = () => p.evaluate(() => {
  const e = window.workplace._engine;
  const sc = e.scene;
  const count = (name) => { const m = sc.getMeshByName(name); return m?.isEnabled() ? m.thinInstanceCount : 0; };
  return { seated: count('people_seated'), standing: count('people_standing'), full: e.characters.fullCount };
});
/** What the view from above shows: the floor view, roofs of each room drawn, rooms shown. */
const fromAbove = () => p.evaluate(() => {
  const e = window.workplace._engine;
  const roofs = {};
  for (const m of e.scene.meshes) {
    const md = m.metadata;
    if (md?.part === 'roof' && md.roomId) roofs[md.roomId] = (roofs[md.roomId] ?? false) || m.isEnabled();
  }
  const shown = (id) => !!e.rooms.getRoomMesh(id)?.isEnabled();
  return { view: e.floors.getView(), roofs, open: shown('room_open'), up: shown('room_up') };
});
/** Wait for the character files on another page (the phone's), then a few frames. */
const settleOn = async (pg) => {
  await pg.evaluate(() => window.workplace._engine.characters.whenSettled());
  await frames(3, pg);
  await pg.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  await frames(2, pg);
};
/** Wait for the character files, then for the choice to swap them in. */
const settle = async () => {
  await p.evaluate(() => window.workplace._engine.characters.whenSettled());
  await frames(3);
  await p.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  await frames(2);
};
/** Camera on the orbit: look at (x, z) from `radius` m. */
const look = (x, z, radius, beta = 1.05, alpha = -Math.PI / 2, pg = p) => pg.evaluate(({ x, z, radius, beta, alpha }) => {
  const cam = window.workplace._engine.scene.activeCamera;
  cam.target.set(x, 0.8, z);
  cam.radius = radius; cam.beta = beta; cam.alpha = alpha;
}, { x, z, radius, beta, alpha });
/** Where a point is on the screen (CSS px in the page). */
const onScreen = (x, y, z, pg = p) => pg.evaluate(({ x, y, z }) => {
  const sc = window.workplace._engine.scene;
  const cam = sc.activeCamera;
  const canvas = sc.getEngine().getRenderingCanvas();
  const V = cam.position.constructor;
  const M = sc.getTransformMatrix().constructor;
  const r = canvas.getBoundingClientRect();
  const s = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
  return { x: r.left + s.x, y: r.top + s.y };
}, { x, y, z });

// ── 1. Mount, then setPeople ──
await p.goto(new URL('people-test.html', base).href);
await p.evaluate((layout) => {
  window.embedEvents = [];
  window.workplace = AHDUSWorkplace.mount(document.getElementById('workplace'), {
    layout, mode: 'view',
    characters: {
      manifestUrl: '/dist-embed/assets/characters/manifest.json', chooseUrl: '/choose-character.html',
      walkClipUrl: '/dist-embed/assets/characters/placeholder-walk.glb',
    },
    onEvent: (name, data) => window.embedEvents.push({ name, data }),
  });
}, LAYOUT);
await p.evaluate(() => window.workplace.ready);
await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(2)); // fast without a GPU
const given = await p.evaluate((people) => window.workplace.setPeople(people), PEOPLE);
await frames(3);
const placed = await p.evaluate(() => window.workplace._engine.characters.getPlaced().map((x) => ({
  id: x.personId, seated: x.seated, floor: x.floor, character: !!x.character, keys: Object.keys(x).join(),
})));
log('setPeople: 21 people at their desks (20 seated on their chair, 1 standing), on two floors',
  given === 21 && placed.length === 21 && placed.filter((x) => x.seated).length === 20 &&
  placed.filter((x) => x.floor === 1).length === 4,
  `given ${given}, placed ${placed.length}, seated ${placed.filter((x) => x.seated).length}`);
log('a person keeps only name, department and character: no email reaches the view',
  placed.every((x) => !x.keys.includes('email')) && !JSON.stringify(placed).includes('example.com'), placed[0]?.keys);
log('characters from the manifest; unknown or null asset references are simple figures',
  placed.filter((x) => x.character).length === 13, `${placed.filter((x) => x.character).length} with a character file`);

// The view from above starts on the ground floor: its roof off, the floor above hidden, so its desks and people show
const start = await fromAbove();
log('the view from above starts on the ground floor: no roof over its desks, the floor above hidden',
  start.view.mode === 'planner' && start.view.level === 0 && start.open && !start.up && start.roofs.room_open === false,
  JSON.stringify(start));

// Far away (the whole ground floor in view): everyone is a simple figure, two thin-instanced meshes
const far = await drawnPeople();
const farMeshes = await p.evaluate(() => window.workplace._engine.scene.meshes.filter((m) => m.name.startsWith('people_')).length);
log('from far away: the 17 people downstairs are simple figures (2 meshes with thin instances), no character file downloaded',
  far.seated === 16 && far.standing === 1 && far.full === 0 && farMeshes === 2 &&
  !requests.some((u) => u.endsWith('.glb') && u.includes('/characters/')), JSON.stringify(far));
await shot('characters-far.png');

// ── 2. Close up: the nearest become full characters (each file once) ──
// (the ground floor without its roof, as Studio shows it; the camera above the room, looking down at the desks)
await p.evaluate(() => window.workplace.setFloor(0));
await look(-2.5, -3.6, 6, 0.8, -Math.PI / 2 - 0.3);
await settle();
const near = await drawnPeople();
const glbs = requests.filter((u) => u.includes('/characters/') && u.endsWith('.glb')).map((u) => new URL(u).pathname);
log('close up: the nearest people are full characters (≤ 12), the rest stay simple figures',
  near.full >= 3 && near.full <= 12 && near.full + near.seated + near.standing === 17, JSON.stringify(near)); // ground floor only
log('each character file is downloaded once (Mixamo and Unreal-style rigs), from the manifest\'s urls',
  glbs.filter((u) => u.endsWith('placeholder-mixamo.glb')).length === 1 && glbs.filter((u) => u.endsWith('placeholder-ue.glb')).length === 1 &&
  requests.filter((u) => u.endsWith('/characters/manifest.json')).length === 1, glbs.join(', '));
const pose = await p.evaluate(() => {
  const sc = window.workplace._engine.scene;
  const out = {};
  for (const id of ['user_1', 'user_2']) {
    const root = sc.getTransformNodeByName(`person_${id}`);
    if (!root) continue;
    const bone = (re) => root.getDescendants(false).find((n) => re.test(n.name));
    const hips = bone(/^(mixamorig:)?Hips$|^pelvis$/);
    const thigh = bone(/LeftUpLeg$|^thigh_l$/);
    const knee = bone(/LeftLeg$|^calf_l$/);
    const d = knee.getAbsolutePosition().subtract(thigh.getAbsolutePosition()).normalize();
    out[id] = { hipsY: +hips.getAbsolutePosition().y.toFixed(2), thighZ: +d.z.toFixed(2) };
  }
  out.pickable = sc.meshes.filter((m) => m.metadata?.personId && m.isPickable).length;
  return out;
});
log('the full characters sit: hips on the seat, thighs forward (towards the desk, -Z), both rigs',
  pose.user_1?.hipsY > 0.5 && pose.user_1?.hipsY < 0.62 && pose.user_1?.thighZ < -0.9 &&
  pose.user_2?.hipsY > 0.45 && pose.user_2?.thighZ < -0.9, JSON.stringify(pose));
log('people are not pickable (a click goes to the desk)', pose.pickable === 0);
await shot('characters-desk.png');

// ── 3. Hovering a desk with a person: a small card, text only ──
const deskTop = await onScreen(-2.5, 0.77, -4.5); // desk 2, in the middle of the view
await p.mouse.move(deskTop.x, deskTop.y);
const direct = await p.evaluate(({ x, y }) => {
  const r = window.workplace._engine.scene.getEngine().getRenderingCanvas().getBoundingClientRect();
  return window.workplace._engine.pickPerson(x - r.left, y - r.top)?.personId ?? null;
}, deskTop);
const card = await p.waitForSelector('[data-person-card]', { timeout: 30000 }).then(async (el) => ({
  id: await el.getAttribute('data-person-card'), text: await el.textContent(), html: await el.innerHTML(),
})).catch(() => null);
log('hovering a desk shows the person\'s card: name and department, as text (no HTML, no email)',
  card?.id === 'user_2' && card.text.includes('<b>Asha</b> Rao') && card.text.includes('HR') &&
  card.html.includes('&lt;b&gt;') && !card.text.includes('@'), `${JSON.stringify(card)} (pickPerson at ${Math.round(deskTop.x)},${Math.round(deskTop.y)}: ${direct})`);
await shot('characters-hover.png');
await p.mouse.move(5, 5);
await p.waitForSelector('[data-person-card]', { state: 'detached', timeout: 10000 }).catch(() => {});
const deskEmpty = await onScreen(-2.5, 0.77, -2); // desk 6, behind it: the card follows
await p.mouse.move(deskEmpty.x, deskEmpty.y);
const card2 = await p.waitForFunction(() => document.querySelector('[data-person-card]')?.getAttribute('data-person-card'), null, { timeout: 30000 })
  .then((h) => h.jsonValue()).catch(() => null);
log('the card follows the pointer to another desk', card2 === 'user_6', String(card2));
await p.mouse.move(5, 5);

// ── 3b. A click keeps the card; "Choose your character" on your own card ──
const cardNow = () => p.evaluate(() => {
  const el = document.querySelector('[data-person-card]');
  const a = el?.querySelector('a[data-choose-character]');
  return el ? { id: el.getAttribute('data-person-card'), pinned: el.hasAttribute('data-pinned'), link: a ? a.getAttribute('href') : null } : null;
});
await p.mouse.click(deskTop.x, deskTop.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
await p.mouse.move(5, 5);
await p.waitForTimeout(400);
const kept = await cardNow();
log('a click on a desk keeps its card open after the pointer moves away (no link: not the player)',
  kept?.id === 'user_2' && kept.pinned && kept.link === null, JSON.stringify(kept));
await p.mouse.click(5, 5);
await p.waitForSelector('[data-person-card]', { state: 'detached', timeout: 10000 }).catch(() => {});
log('a click elsewhere hides it', (await cardNow()) === null);
await p.evaluate(() => window.workplace.setPlayer({ personId: 'user_2' }));
await p.mouse.click(deskTop.x, deskTop.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
const chose = await cardNow();
await p.mouse.click(5, 5);
await look(-2.5, 1.2, 6, 0.8, -Math.PI / 2 - 0.3); // desk 14: user_14 never chose (assetReference null)
await frames(3);
await p.evaluate(() => window.workplace.setPlayer({ personId: 'user_14' }));
const desk14 = await onScreen(-2.5, 0.77, 3);
await p.mouse.click(desk14.x, desk14.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
const mine = await cardNow();
log('"Choose your character" only on your own card (the player), and only if they never chose one; it links to chooseUrl',
  chose?.id === 'user_2' && chose.link === null && mine?.id === 'user_14' && mine.link?.endsWith('/choose-character.html'),
  `${JSON.stringify(chose)} | ${JSON.stringify(mine)}`);
await p.mouse.click(5, 5);
await p.evaluate(() => window.workplace.setPlayer(null));
await p.mouse.click(desk14.x, desk14.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
const nobodyMe = await cardNow();
log('setPlayer(null): no link', nobodyMe?.id === 'user_14' && nobodyMe.link === null, JSON.stringify(nobodyMe));
await p.mouse.click(5, 5);
await look(-2.5, -3.6, 6, 0.8, -Math.PI / 2 - 0.3);
await frames(2);

// ── 4. Per floor: setFloor(0) hides the people upstairs; setFloor(1) shows both floors ──
await frames(3);
const ground = await drawnPeople();
await p.evaluate(() => window.workplace.setFloor(1));
await frames(3);
const both = await drawnPeople();
log('setFloor(0): only the 17 people on the ground floor; setFloor(1): all 21',
  ground.full + ground.seated + ground.standing === 17 && both.full + both.seated + both.standing === 21,
  `${JSON.stringify(ground)} | ${JSON.stringify(both)}`);
await p.evaluate(() => window.workplace.setFloor(0));
await frames(2);

// ── 5. Walking up to a desk: the card shows ──
await p.evaluate(() => window.workplace.setMode('walkthrough'));
await frames(2);
await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: -2.5 + 1.3, z: -1.3, yaw: -Math.PI / 2, pitch: -0.2 }));
const walkCard = await p.waitForFunction(() => document.querySelector('[data-person-card]')?.textContent, null, { timeout: 30000 })
  .then((h) => h.jsonValue()).catch(() => null);
log('walking up to a desk shows who sits there', /Person 6/.test(walkCard ?? '') && /HR/.test(walkCard ?? ''), String(walkCard));
await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: 0, z: -7.5, yaw: 0, pitch: 0 })); // outside
const gone = await p.waitForSelector('[data-person-card]', { state: 'detached', timeout: 15000 }).then(() => true).catch(() => false);
log('walking away hides it', gone);
// Walk up to Floor 1 (as Page Up), then back to the view from above: that floor, its roof off, everyone shows
await p.evaluate(() => { window.embedEvents.length = 0; return window.workplace.setFloor(1); });
await frames(2);
await p.evaluate(() => window.workplace.setMode('view'));
await frames(3);
const back = await fromAbove();
const backPeople = await drawnPeople();
const floorEvents = await p.evaluate(() => window.embedEvents.filter((e) => e.name === 'floorChange').map((e) => e.data.floorId));
log('back from walking on Floor 1: the view from above shows Floor 1 without its roof, its people, and floorChange said so',
  back.view.mode === 'planner' && back.view.level === 1 && back.up && back.roofs.room_up === false &&
  backPeople.full + backPeople.seated + backPeople.standing === 21 && floorEvents.map(String).includes('1'),
  `${JSON.stringify(back)} | ${JSON.stringify(backPeople)} | floorChange ${JSON.stringify(floorEvents)}`);
await p.evaluate(() => window.workplace.setFloor(0));
const again = await fromAbove();
log('choosing the ground floor again: its roof stays off, the floor above is hidden',
  again.view.level === 0 && !again.up && again.roofs.room_open === false, JSON.stringify(again));
await frames(2);

// ── 5b. Walking as yourself ──
/** The character walking now: kind ('full' = your own), file, walking, eye height, shown. */
const walker = () => p.evaluate(() => {
  const w = window.workplace._engine.walkthrough;
  const c = w.getCharacter();
  const foot = c?.root.getDescendants(false).find((n) => /LeftFoot$|foot_l$/.test(n.name));
  const hips = c?.root.getDescendants(false).find((n) => /Hips$|pelvis$/.test(n.name));
  return {
    kind: c?.kind ?? 'simple', name: c?.root.name, walking: !!c?.walking, walkSpeed: c?.walkSpeed ?? null, speed: c?.speed ?? null,
    ratio: c?.walkGroup?.speedRatio ?? null, eye: w.getEyeHeight(), shown: !!c?.root.isEnabled(),
    stride: foot && hips ? +(foot.getAbsolutePosition().z - hips.getAbsolutePosition().z).toFixed(3) : null,
  };
});
const walkAs = async (assetReference, personId = 'user_1') => {
  await p.evaluate(({ assetReference, personId }) => window.workplace.setPlayer({ personId, assetReference }), { assetReference, personId });
  await p.evaluate(() => window.workplace._engine.whenPlayerReady());
  await frames(2);
};
await p.evaluate(() => window.workplace.setFloor(0));
const before = await drawnPeople();
await p.evaluate(() => window.workplace.setMode('walkthrough'));
await frames(2);
// Last time you walked you were flying on Floor 1 (no room there); the ground floor has been chosen since
const resumed = await p.evaluate(() => {
  const e = window.workplace._engine;
  return {
    level: e.walkthrough.getLevel(), flying: e.walkthrough.isFlying(), floor: e.getStore().getState().currentFloor,
    hint: document.querySelector('[data-hud="hint"]')?.textContent ?? null,
  };
});
log('walking again after choosing the ground floor: you start on it, standing (not flying on Floor 1), the usual hint',
  resumed.level === 0 && !resumed.flying && resumed.floor === 0 && /^W A S D walk/.test(resumed.hint ?? ''), JSON.stringify(resumed));
await walkAs('placeholder:mixamo-v1');
// in the aisle between the desks, looking along it
await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: 0, z: -5.6, yaw: 0, pitch: -0.15 }));
await frames(3);
const standing = await walker();
const without = await drawnPeople();
const myFigure = await p.evaluate(() => !!window.workplace._engine.scene.getNodeByName('person_user_1')?.isEnabled());
log('walkthrough: you are your own character (Mixamo rig), standing, the camera at your eye height (1.75 m → 1.62 m)',
  standing.kind === 'full' && standing.name === 'player_character' && standing.shown && !standing.walking &&
  standing.walkSpeed > 1 && Math.abs(standing.eye - 1.62) < 0.01, JSON.stringify(standing));
// from above: the 17 people of the ground floor; walking: every floor (21) but you
log('your seated figure at your desk is hidden while you walk', before.full + before.seated + before.standing === 17 &&
  without.full + without.seated + without.standing === 20 && !myFigure,
  `${JSON.stringify(before)} → ${JSON.stringify(without)}, your figure shown: ${myFigure}`);
const walkFiles = requests.filter((u) => u.endsWith('/placeholder-walk.glb')).length;
const mixamoFiles = requests.filter((u) => u.endsWith('/placeholder-mixamo.glb')).length;
log('the walk clip is downloaded once; your character file is the one already loaded for the people',
  walkFiles === 1 && mixamoFiles === 1, `walk.glb ×${walkFiles}, placeholder-mixamo.glb ×${mixamoFiles}`);
// Hold W: the walk clip plays, as fast as you move; let go: the standing pose
await p.focus('#workplace [tabindex="0"]');
await p.keyboard.down('KeyW');
const strides = [];
let moving = null;
for (let i = 0; i < 4; i++) {
  await frames(1);
  moving = await walker();
  strides.push(moving.stride);
}
if (SHOTS) {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(1 / window.devicePixelRatio));
    await p.evaluate(() => window.workplace._engine.babylonEngine.resize());
    await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: 0, z: -5.6, yaw: 0, pitch: -0.15 }));
    await p.evaluate(() => window.workplace._engine.scene.whenReadyAsync()); // every material compiled at this size
    await frames(2);
    await p.screenshot({ path: `${SHOTS}/${tag}-walking.png`, timeout: 180000 });
  }
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(2));
  await p.evaluate(() => window.workplace._engine.babylonEngine.resize());
}
await p.keyboard.up('KeyW');
await frames(3);
const stopped = await walker();
log('holding W: your character walks (the clip plays as fast as you move, the legs swing); let go: it stands',
  moving.walking && moving.speed > 1 && moving.speed < 4.3 &&
  Math.abs(moving.ratio - Math.min(6, Math.max(0.25, moving.speed / moving.walkSpeed))) < 0.01 &&
  new Set(strides.map((s) => Math.sign(Math.round(s * 20)))).size >= 2 &&
  !stopped.walking && stopped.kind === 'full', `${JSON.stringify(moving)} strides ${JSON.stringify(strides)} | stopped ${JSON.stringify(stopped)}`);
if (SHOTS) {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(1 / window.devicePixelRatio));
    await p.evaluate(() => window.workplace._engine.babylonEngine.resize());
    await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: 0, z: -3.2, yaw: Math.PI * 0.85, pitch: -0.1 }));
    await p.evaluate(() => window.workplace._engine.scene.whenReadyAsync());
    await frames(3);
    await p.screenshot({ path: `${SHOTS}/${tag}-standing.png`, timeout: 180000 });
  }
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(2));
  await p.evaluate(() => window.workplace._engine.babylonEngine.resize());
}
// V: first person hides your own body; V again shows it
await p.focus('#workplace [tabindex="0"]');
await p.keyboard.press('KeyV');
await frames(2);
const first = await walker();
await p.keyboard.press('KeyV');
await frames(2);
const third = await walker();
log('V (first person) hides your own body; V again shows it', !first.shown && third.shown, `${first.shown} → ${third.shown}`);
// An Unreal-style skeleton walks with the same clip (bone table + rest-pose correction); a taller person sees from higher
await walkAs('placeholder:ue-v1', 'user_2');
await p.evaluate(() => window.workplace._engine.walkthrough.setPose({ x: 0, z: -5.6, yaw: 0, pitch: -0.15 }));
await p.keyboard.down('KeyW');
await frames(2);
const ue = await walker();
await p.keyboard.up('KeyW');
await frames(2);
await walkAs('placeholder:tall-v1', 'user_3');
const tall = await walker();
log('an Unreal-style rig walks with the same clip (1.68 m: eye 1.55 m); a 1.88 m person: eye 1.74 m',
  ue.kind === 'full' && ue.walking && Math.abs(ue.eye - 1.555) < 0.01 && Math.abs(tall.eye - 1.741) < 0.01,
  `${JSON.stringify(ue)} | tall eye ${tall.eye}`);
// Never chose a character (or an unknown one): the simple figure, at the usual eye height
await walkAs(null, 'user_4');
const simple = await walker();
await walkAs('mixamo:not-in-the-manifest', 'user_5');
const unknown = await walker();
log('no character, or one not in the manifest: the simple figure walks (eye 1.62 m)',
  simple.kind === 'simple' && simple.name === 'playerCharacter' && unknown.kind === 'simple' && Math.abs(simple.eye - 1.62) < 0.01,
  `${JSON.stringify(simple)} | ${JSON.stringify(unknown)}`);
await p.evaluate(() => window.workplace.setMode('view'));
await frames(2);
const allBack = await drawnPeople();
log('back in the view from above: everyone at their desk again', allBack.full + allBack.seated + allBack.standing === 17, JSON.stringify(allBack));
await p.evaluate(() => window.workplace.setPlayer(null));

// ── 6. setPeople([]) = nobody; quality 'low' = no people at all ──
await p.evaluate(() => window.workplace.setPeople([]));
await frames(3);
const nobody = await drawnPeople();
const leftover = await p.evaluate(() => window.workplace._engine.scene.meshes.filter((m) => m.metadata?.personId).length);
log('setPeople([]) removes everyone', nobody.seated + nobody.standing + nobody.full === 0 && leftover === 0, JSON.stringify(nobody));
const low = await p.evaluate(async ({ layout, people }) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:0;bottom:0;width:320px;height:200px';
  document.body.append(el);
  const h = AHDUSWorkplace.mount(el, {
    layout, mode: 'view', quality: 'low', player: { personId: 'user_1', assetReference: 'placeholder:mixamo-v1' },
    characters: { manifestUrl: '/dist-embed/assets/characters/manifest.json', walkClipUrl: '/dist-embed/assets/characters/placeholder-walk.glb' },
  });
  await h.ready;
  await h.setPeople(people);
  await new Promise((r) => setTimeout(r, 1500));
  h.setMode('walkthrough');
  await h._engine.whenPlayerReady();
  const sc = h._engine.scene;
  const out = { characters: h._engine.characters, people: sc.meshes.filter((m) => m.name.startsWith('people_') || m.metadata?.personId).length };
  const walker = h._engine.walkthrough.getCharacter()?.kind ?? 'simple';
  h.destroy();
  el.remove();
  return { characters: out.characters === null, people: out.people, walker };
}, { layout: LAYOUT, people: PEOPLE });
log('quality \'low\': no people at all, and you walk as the simple figure',
  low.characters && low.people === 0 && low.walker === 'simple', JSON.stringify(low));
log('no warnings about the manifest', !warnings.some((w) => /character manifest/.test(w)), warnings.filter((w) => /manifest/.test(w)).join(' | '));

// ── 6b. A phone (390 × 844, touch): a tap on a desk shows the card, a tap elsewhere hides it ──
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const t = await ctx.newPage();
  t.on('pageerror', (e) => errs.push('pageerror (phone): ' + e.message));
  await t.goto(new URL('people-test.html', base).href);
  await t.evaluate(async ({ layout, people }) => {
    window.workplace = AHDUSWorkplace.mount(document.getElementById('workplace'), {
      layout, mode: 'view', player: { personId: 'user_14' },
      characters: { manifestUrl: '/dist-embed/assets/characters/manifest.json', chooseUrl: '/choose-character.html' },
    });
    await window.workplace.ready;
    await window.workplace.setPeople(people);
  }, { layout: LAYOUT, people: PEOPLE });
  await t.evaluate(() => window.workplace.setFloor(0));
  await look(-2.5, 1.2, 7, 0.8, -Math.PI / 2 - 0.3, t);
  await frames(3, t);
  const at = await onScreen(-2.5, 0.77, 3, t);
  await t.touchscreen.tap(at.x, at.y);
  const tapped = await t.waitForSelector('[data-person-card]', { timeout: 30000 }).then(async (el) => ({
    id: await el.getAttribute('data-person-card'), text: await el.textContent(),
    link: await el.$eval('a[data-choose-character]', (a) => a.getAttribute('href')).catch(() => null),
    right: await el.evaluate((n) => n.getBoundingClientRect().right),
  })).catch(() => null);
  log('phone: a tap on a desk shows who sits there (inside the screen), with "Choose your character" on your own card',
    tapped?.id === 'user_14' && /Person 14/.test(tapped.text) && tapped.link?.endsWith('/choose-character.html') && tapped.right <= 390,
    JSON.stringify(tapped));
  if (SHOTS) {
    await t.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(1 / window.devicePixelRatio));
    await settleOn(t);
    await t.screenshot({ path: `${SHOTS}/phone-tap-card.png`, timeout: 180000 });
  }
  await t.touchscreen.tap(6, 400); // (the search button is at the top left)
  const hidden = await t.waitForSelector('[data-person-card]', { state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
  log('phone: a tap elsewhere hides it', hidden);
  await t.evaluate(() => window.workplace.destroy());
  await ctx.close();
}

// ── 7. Screenshots (SHOTS=dir): desk with a seated figure, the hover card, a busy office ──
if (SHOTS) {
  await p.evaluate((people) => window.workplace.setPeople(people), PEOPLE);
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => window.workplace._engine.babylonEngine.setHardwareScalingLevel(1 / window.devicePixelRatio));
    await p.evaluate(() => window.workplace._engine.babylonEngine.resize());
    const phone = w < 600;
    await p.evaluate(() => window.workplace.setFloor(0));
    // above the room (no roof on the floor shown), in front of the second row, looking at the people over their desks
    await look(-2.5, -1.3, phone ? 5.6 : 5.2, 0.85, -Math.PI / 2 - 0.45);
    await settle();
    await p.screenshot({ path: `${SHOTS}/${tag}-desk-seated.png`, timeout: 180000 });
    const top = await onScreen(-2.5, 0.77, -2); // desk 6
    await p.mouse.move(top.x, top.y);
    await p.waitForSelector('[data-person-card]', { timeout: 30000 }).catch(() => {});
    await frames(2);
    await p.screenshot({ path: `${SHOTS}/${tag}-hover-card.png`, timeout: 180000 });
    await p.mouse.move(2, 2);
    await look(0, -0.5, phone ? 19 : 14, 0.8, -Math.PI / 2 - 0.35);
    await settle();
    await p.screenshot({ path: `${SHOTS}/${tag}-busy-office.png`, timeout: 180000 });
    // The view from above as the 3D Company page opens it (Fit view, ground floor, no roof over the people)
    await p.evaluate(() => window.workplace._engine.fitView({ animate: false }));
    await settle();
    await p.screenshot({ path: `${SHOTS}/${tag}-view-from-above.png`, timeout: 180000 });
  }
  log(`screenshots in ${SHOTS}`, true);
}

await p.evaluate(() => window.workplace.destroy());
log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
site.close();
