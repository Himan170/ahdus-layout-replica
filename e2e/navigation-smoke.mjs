// Navigation smoke test (v0.13.4): "Show route" and "Take me there" in viewer.html.
// From the search box's card: Kavya Iyer at reception, a person on Floor 1 by the stairs (from the
// view from above: the walk starts at the entrance), the nearest washroom. Every frame the body is
// checked against the walls and solid furniture of its floor (never inside them); W pauses the walk,
// G continues, Esc and Stop end it; it arrives in about the route's time (game time: SwiftShader's
// slow frames are capped at 0.25 s each); the route line is at most 2 meshes (2 draw calls).
//
// The layout: the Meridian-shaped test layout of the unit tests (src/play/navigation/__tests__/meridianLike.js),
// or the real Meridian with MERIDIAN=<layout.json> MERIDIAN_PEOPLE=<people.json> (made by the seed script,
// not in git). SHOTS=<dir>: desktop 1440×900 + phone 390×844 screenshots and a short recording.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev                (in one terminal)
//                   npm run e2e:navigation     (in another, alone: it is heavy)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { meridianLike } from '../src/play/navigation/__tests__/meridianLike.js';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
const SHOTS = process.env.SHOTS ?? '';
const shotDir = SHOTS || 'e2e/screens';
mkdirSync(shotDir, { recursive: true });
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

// ── The layout and who sits where ──
let layout;
let people;
if (process.env.MERIDIAN) {
  layout = JSON.parse(readFileSync(process.env.MERIDIAN, 'utf8'));
  // only what setPeople takes: never an email
  people = JSON.parse(readFileSync(process.env.MERIDIAN_PEOPLE, 'utf8'))
    .map(({ personId, deskId, name, department }) => ({ personId, deskId, name, department }));
} else {
  layout = { layoutName: 'Meridian-shaped test layout', ...meridianLike() };
  const desks = layout.objects.filter((o) => o.assetType === 'DESK_STANDARD');
  people = [{ personId: 'kavya', deskId: 'obj_f0_reception', name: 'Kavya Iyer', department: 'HR' }];
  const names = ['Asha Patel', 'Ravi Kumar', 'Meera Nair', 'Arjun Rao', 'Leela Das', 'Kiran Shah'];
  desks.forEach((d, i) => people.push({ personId: `p${i}`, deskId: d.id, name: i < names.length ? names[i] : `Person ${i}`, department: 'Engineering' }));
}
const MERIDIAN = process.env.MERIDIAN ? 'Meridian' : 'the Meridian-shaped layout';

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args });
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  ...(SHOTS ? { recordVideo: { dir: join(shotDir, 'video'), size: { width: 1440, height: 900 } } } : {}),
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = (name) => p.screenshot({ path: join(shotDir, `navigation-${name}.png`) });

/** Open the viewer from above with this layout and these people; the walk maps built in idle time. */
async function open(page) {
  await page.goto(base + 'viewer.html?mode=view', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ahdusViewer && window.__ahdusSetPeople, null, { timeout: 120000 });
  await page.evaluate(async ({ layout, people }) => {
    const e = window.__ahdusViewer;
    await e.whenBuilt();
    e.loadLayout(layout);
    window.__ahdusSetPeople(people);
    await e.whenBuilt();
  }, { layout, people });
  await page.waitForFunction(() => window.__ahdusViewer.getStore().getState().layoutName !== undefined, null, { timeout: 60000 });
}

await open(p);
const ready = await p.evaluate(async () => {
  const e = window.__ahdusViewer;
  const t0 = performance.now();
  await e.whenNavigationReady();
  const waited = performance.now() - t0;
  // built already: asking for them now costs nothing
  const s = e.getStore().getState();
  const t1 = performance.now();
  for (const id of Object.keys(s.floors)) e.navigation.walkMaps.get(s, Number(id));
  return { waited, ask: performance.now() - t1, floors: Object.keys(s.floors).length, rooms: Object.keys(s.rooms).length };
});
log(`${MERIDIAN} loaded; its walk maps built in idle time after it (asking for them again: < 5 ms)`,
  ready.ask < 5 && ready.floors >= 2, `${ready.rooms} rooms, ${ready.floors} floors, ${ready.ask.toFixed(1)} ms`);

// ── The per-frame check: never inside a wall or solid furniture; the game time of the walk ──
await p.evaluate(async () => {
  const wm = await import('/src/play/navigation/walkMap.js');
  const e = window.__ahdusViewer;
  const mon = (window.__navMon = { min: Infinity, at: null, frames: 0, elapsed: 0, on: false, positions: [] });
  e.scene.onAfterRenderObservable.add(() => {
    const w = e.walkthrough;
    const nav = e.navigation.walking;
    if (nav) mon.elapsed = nav.elapsed;
    if (!mon.on || !w?.isActive()) return;
    const pos = w.getPosition();
    const floor = w.getLevel();
    const map = e.navigation.walkMaps.get(e.getStore().getState(), floor);
    let d = Infinity;
    let kind = '';
    for (const o of map.obstacles) {
      if (Math.abs(o.x - pos.x) > o.hw + o.hd + 1 || Math.abs(o.z - pos.z) > o.hw + o.hd + 1) continue;
      const dd = wm.distanceToRect(o, pos.x, pos.z);
      if (dd < d) { d = dd; kind = o.kind; }
    }
    mon.frames += 1;
    mon.positions.push({ x: pos.x, z: pos.z, floor });
    if (d < mon.min) { mon.min = d; mon.at = { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), floor, kind }; }
  });
});
const watch = (on) => p.evaluate((on) => {
  const m = window.__navMon;
  if (on) Object.assign(m, { min: Infinity, at: null, frames: 0, elapsed: 0, positions: [] });
  m.on = on;
}, on);
const mon = () => p.evaluate(() => { const { positions, ...m } = window.__navMon; return { ...m, last: positions[positions.length - 1] }; });
const BODY = 0.32;
const INSIDE = BODY - 0.03; // Babylon's collisions stop the ellipsoid a hair short of exact

// where the walker stands when a route starts (read later, it has already walked on)
await p.evaluate(() => {
  const e = window.__ahdusViewer;
  e.on('navigation', (ev) => {
    if (ev.state !== 'started') return;
    const v = e.walkthrough.getPosition();
    window.__navStartedAt = { x: v.x, z: v.z, floor: e.walkthrough.getLevel(), mode: e.mode };
  });
});
const startedPos = () => p.evaluate(() => window.__navStartedAt);
const navEvents = () => p.evaluate(() => (window.__viewerNav ?? []).map((e) => ({ ...e })));
const lastNav = async () => (await navEvents()).at(-1) ?? null;
const clearNav = () => p.evaluate(() => { window.__viewerNav = []; });
/** The first event (since clearNav) in one of these states (later ones can come before the next poll). */
async function waitNav(states, ms = 400000) {
  const want = [].concat(states);
  await p.waitForFunction((want) => (window.__viewerNav ?? []).some((e) => want.includes(e.state)), want, { timeout: ms, polling: 500 });
  return (await navEvents()).find((e) => want.includes(e.state));
}

/** Search box → a result → its card. */
async function find(page, query, placeId) {
  if (!(await page.$('[data-place-search]'))) await page.click('[data-place-search-button]');
  await page.fill('[data-place-search] input[role="combobox"]', query);
  const option = placeId ? `[data-place="${placeId}"]` : '[role="option"]';
  await page.waitForSelector(option, { timeout: 20000 });
  await page.click(option);
  await page.waitForSelector('[data-place-shown]', { timeout: 20000 });
}

const place = (id) => p.evaluate((id) => {
  const s = window.__ahdusViewer.getStore().getState();
  const o = s.objects[id];
  return o ? { x: o.x, z: o.z, floor: o.floor } : null;
}, id);

// ── 1. Kavya Iyer at reception: Show route from above ──
await clearNav();
await find(p, 'Kavya', 'person:' + people.find((x) => x.name === 'Kavya Iyer').personId);
const buttons = await p.$$eval('[data-place-shown] [data-route]', (els) => els.map((e) => e.textContent.trim()));
log('the result card has "Show route" and "Take me there"', buttons.join('|') === 'Show route|Take me there', buttons.join(' | '));
if (SHOTS) await shot('card-desktop');
await p.click('[data-route="guide"]');
const guide = await waitNav(['started', 'failed'], 120000);
const startedAt = { ...(await startedPos()), viewer: await p.evaluate(() => document.querySelector('[data-layout-viewer]')?.dataset.layoutViewer) };
const spawn = await p.evaluate(async () => {
  const { entranceSpawn } = await import('/src/play/navigation/entrance.js');
  const e = window.__ahdusViewer;
  return entranceSpawn(e.getStore().getState(), { maps: e.navigation.walkMaps });
});
log('from above, Show route starts walking at the entrance', guide?.state === 'started' && startedAt.mode === 'walkthrough'
  && startedAt.viewer === 'walkthrough' && Math.hypot(startedAt.x - spawn.x, startedAt.z - spawn.z) < 1.5,
  `${guide?.state}, ${startedAt.mode}, ${Math.hypot(startedAt.x - spawn.x, startedAt.z - spawn.z).toFixed(2)} m from the spawn`);
await wait(1500);
const strip = await p.textContent('[data-nav-going]').catch(() => '');
log('the strip: "Going to Kavya Iyer · N m" and Stop', /^Going to Kavya Iyer · \d+ m/.test(strip ?? '') && !!(await p.$('[data-nav-stop]')), strip);
const line = await p.evaluate(() => {
  const sc = window.__ahdusScene;
  const meshes = sc.meshes.filter((m) => m.metadata?.routeLine && m.isEnabled() && m.isVisible);
  return {
    meshes: meshes.length,
    instances: meshes.map((m) => `${m.name}:${m.thinInstanceCount}`),
    drawn: meshes.filter((m) => sc.getActiveMeshes().data.includes(m)).length,
  };
});
log('the route line: chevrons + markers, at most 2 meshes (2 draw calls)', line.meshes >= 1 && line.meshes <= 2
  && line.instances.some((s) => s.startsWith('route_chevrons') && +s.split(':')[1] > 3), line.instances.join(', '));
if (SHOTS) await shot('show-route-desktop');

// Off the route by more than 3 m: a new route
await clearNav();
await p.evaluate((s) => window.__ahdusViewer.walkthrough.setPose({ x: s.x + 6, z: s.z + 1, yaw: 0, pitch: -0.1 }), spawn);
await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => e.rerouted), null, { timeout: 60000, polling: 500 }).catch(() => {});
const re = (await navEvents()).find((e) => e.rerouted);
log('more than 3 m off the line: it re-routes from where you are', !!re, re ? `${re.state}, ${Math.round(re.remaining)} m left` : 'no new route');

// G: walk me there (from Show route), then the arrival
await clearNav();
await p.click('[data-nav-continue]');
await watch(true);
const kavyaArrived = await waitNav(['arrived', 'failed', 'stopped']);
await watch(false);
const m1 = await mon();
// in front of the counter (its visitor side: the desk's local +Z, the receptionist works at −Z), facing her
const kavya = people.find((x) => x.name === 'Kavya Iyer');
const facing = await p.evaluate(({ deskId, personId }) => {
  const e = window.__ahdusViewer;
  const w = e.walkthrough;
  const v = w.getPosition();
  const d = e.getStore().getState().objects[deskId];
  const her = e.characters?.getPlaced().find((q) => q.personId === personId);
  const r = d.rotationY ?? 0;
  const lx = (v.x - d.x) * Math.cos(r) - (v.z - d.z) * Math.sin(r); // the walker in the desk's own frame
  const lz = (v.x - d.x) * Math.sin(r) + (v.z - d.z) * Math.cos(r);
  const want = Math.atan2(her.x - v.x, her.z - v.z);
  const diff = Math.abs(Math.atan2(Math.sin(want - w.getYaw()), Math.cos(want - w.getYaw())));
  return { lx, lz, diff, toHer: Math.hypot(her.x - v.x, her.z - v.z), herLz: (her.x - d.x) * Math.sin(r) + (her.z - d.z) * Math.cos(r) };
}, { deskId: kavya.deskId, personId: String(kavya.personId) });
log('Take me there: ends in front of the reception counter, facing Kavya Iyer behind it',
  kavyaArrived?.state === 'arrived' && facing.herLz < 0 && facing.lz > 0.425 && facing.lz < 2.5 && Math.abs(facing.lx) < 1.25 && facing.diff < 0.6,
  `${kavyaArrived?.state}${kavyaArrived?.message ? ` (${kavyaArrived.message})` : ''}, ${facing.lz.toFixed(2)} m in front of the counter's centre `
  + `(she sits ${(-facing.herLz).toFixed(2)} m behind it), ${facing.toHer.toFixed(2)} m from her, ${(facing.diff * 57.3).toFixed(0)}° off`);
log('…never inside a wall or furniture (every frame)', m1.frames > 3 && m1.min > INSIDE, `${m1.frames} frames, closest ${m1.min.toFixed(3)} m (${JSON.stringify(m1.at)})`);
await wait(1500);
const card = await p.evaluate(() => ({
  strip: document.querySelector('[data-nav-strip]')?.dataset.navStrip,
  text: document.querySelector('[data-nav-strip]')?.textContent ?? '',
  person: document.querySelector('[data-person-card]')?.textContent ?? '',
}));
log('…and shows their card ("You have arrived" + the person card)', card.strip === 'arrived' && /You have arrived/.test(card.text)
  && /Kavya Iyer/.test(card.person), `${card.text} | ${card.person}`);
if (SHOTS) await shot('arrived-desktop');

// ── 2. From above, a person on Floor 1 by the stairs: Take me there starts at the entrance ──
const upstairs = await p.evaluate((people) => {
  const s = window.__ahdusViewer.getStore().getState();
  const objs = Object.values(s.objects);
  const stairs = objs.filter((o) => o.assetType === 'STAIRCASE' && o.floor === 0);
  let best = null;
  for (const person of people) {
    const d = s.objects[person.deskId];
    if (!d || d.floor !== 1) continue;
    const dist = Math.min(...stairs.map((st) => Math.hypot(st.x - d.x, st.z - d.z)));
    if (!best || dist < best.dist) best = { ...person, dist };
  }
  return best;
}, people);
await p.click('[aria-label="Close"]').catch(() => {});
await p.evaluate(() => window.__ahdusViewer.setMode('view'));
await p.waitForSelector('[data-layout-viewer="view"]', { timeout: 30000 });
await clearNav();
await find(p, upstairs.name, `person:${upstairs.personId}`);
await p.click('[data-route="auto"]');
const auto = await waitNav(['started', 'failed'], 120000);
const at2 = await startedPos();
log(`from above, Take me there to ${upstairs.name} (Floor 1, by the stairs) starts at the entrance`,
  auto?.state === 'started' && auto.walk === 'auto' && Math.hypot(at2.x - spawn.x, at2.z - spawn.z) < 1.5,
  `${auto?.state} ${auto?.message ?? ''}, ${Math.round(auto?.length ?? 0)} m, about ${Math.round(auto?.seconds ?? 0)} s`);
await watch(true);
// W pauses it…
await p.waitForFunction(() => (window.__ahdusViewer.navigation.walking?.elapsed ?? 0) > 2, null, { timeout: 200000, polling: 500 });
await p.keyboard.down('KeyW');
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.paused, null, { timeout: 60000, polling: 200 }).catch(() => {});
await p.keyboard.up('KeyW');
await wait(1500);
const paused = await p.evaluate(() => ({
  paused: window.__ahdusViewer.navigation.walking?.paused,
  strip: document.querySelector('[data-nav-strip]')?.textContent ?? '',
  at: (() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; })(),
}));
await wait(4000);
const stillAt = await p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
log('W pauses it ("Press G to continue"; it stays where it is)', paused.paused === true && /Press G to continue/.test(paused.strip)
  && Math.hypot(stillAt.x - paused.at.x, stillAt.z - paused.at.z) < 0.05,
  `${paused.strip} | moved ${Math.hypot(stillAt.x - paused.at.x, stillAt.z - paused.at.z).toFixed(2)} m while paused`);
if (SHOTS) await shot('paused-desktop');
// …and G continues
await p.keyboard.press('KeyG');
await wait(4000);
const after = await p.evaluate(() => {
  const v = window.__ahdusViewer.walkthrough.getPosition();
  return { x: v.x, z: v.z, paused: window.__ahdusViewer.navigation.walking?.paused };
});
log('G continues', after.paused === false && Math.hypot(after.x - stillAt.x, after.z - stillAt.z) > 0.5,
  `moved ${Math.hypot(after.x - stillAt.x, after.z - stillAt.z).toFixed(2)} m`);
if (SHOTS) await shot('walking-desktop');
const upArrived = await waitNav(['arrived', 'failed', 'stopped']);
await watch(false);
const m2 = await mon();
const floorNow = await p.evaluate(() => window.__ahdusViewer.walkthrough.getLevel());
// the walk's own time (paused time doesn't count): about the route's time
log(`arrives on Floor 1 in about the route's time (≤ ${Math.round(auto.seconds * 1.6 + 3)} s)`, upArrived?.state === 'arrived' && floorNow === 1
  && m2.elapsed <= auto.seconds * 1.6 + 3, `${upArrived?.state}${upArrived?.message ? ` (${upArrived.message})` : ''}, Floor ${floorNow}, ${m2.elapsed.toFixed(1)} s for ${Math.round(auto.length)} m (route: ${Math.round(auto.seconds)} s)`);
log('…climbing the stairs, never inside a wall or furniture (every frame)', m2.frames > 3 && m2.min > INSIDE,
  `${m2.frames} frames, closest ${m2.min.toFixed(3)} m (${JSON.stringify(m2.at)})`);

// ── 3. The nearest washroom (walking: from where you are) ──
await p.click('[aria-label="Close"]').catch(() => {});
await clearNav();
if (!(await p.$('[data-place-search]'))) await p.click('[data-place-search-button]');
await p.fill('[data-place-search] input[role="combobox"]', ''); // the browse menu shows while the box is empty
// walking, the chip is the nearest washroom and the walk there (v0.14.2): "Nearest washroom · 8 m"
const washChip = await p.textContent('[data-quick="Washroom"]', { timeout: 20000 });
await p.click('[data-quick="Washroom"]');
await p.waitForSelector('[data-place-shown]', { timeout: 20000 });
const nearestCard = await p.textContent('[data-place-shown]');
await p.click('[data-route="auto"]');
await watch(true);
const wc = await waitNav(['arrived', 'failed', 'stopped']);
await watch(false);
const m3 = await mon();
const inWashroom = await p.evaluate(async () => {
  const e = window.__ahdusViewer;
  const v = e.walkthrough.getPosition();
  const f = e.walkthrough.getLevel();
  const room = Object.values(e.getStore().getState().rooms).find((r) => r.floor === f
    && Math.abs(v.x - r.x) <= r.width / 2 && Math.abs(v.z - r.z) <= r.depth / 2 && r.type !== 'CORRIDOR');
  return room ? `${room.name} (${room.type})` : 'none';
});
log('the nearest washroom: Take me there walks into a restroom', /^Nearest washroom · \d+ m$/.test(washChip) && /Nearest washroom/.test(nearestCard) && wc?.state === 'arrived'
  && /RESTROOM/.test(inWashroom) && m3.min > INSIDE, `${wc?.state}, in ${inWashroom}, closest ${m3.min.toFixed(3)} m`);

// ── 4. Esc ends it; Stop ends it; free walking stays as it was ──
await p.click('[aria-label="Close"]').catch(() => {});
await clearNav();
const esc = await p.evaluate(() => window.__ahdusViewer.navigation.routeTo('room:' + Object.values(window.__ahdusViewer.getStore().getState().rooms).find((r) => r.type === 'RECEPTION').id, { walk: 'auto' }));
await p.evaluate(() => document.querySelector('[data-layout-viewer]').focus());
await wait(2000);
await p.keyboard.press('Escape');
await wait(1500);
const afterEsc = await p.evaluate(() => ({
  walking: window.__ahdusViewer.navigation.walking,
  strip: !!document.querySelector('[data-nav-strip]'),
  line: window.__ahdusScene.meshes.filter((m) => m.metadata?.routeLine && m.isEnabled() && m.thinInstanceCount > 0).length,
}));
log('Esc ends Take me there (no strip, no line)', !esc.problem && afterEsc.walking === null && !afterEsc.strip && afterEsc.line === 0
  && (await lastNav())?.state === 'stopped', JSON.stringify(afterEsc));

await clearNav();
// a room far from here (the washroom check left us next to one: a route there arrives at once)
const far = await p.evaluate(() => {
  const e = window.__ahdusViewer;
  const v = e.walkthrough.getPosition();
  const rooms = Object.values(e.getStore().getState().rooms).filter((r) => r.floor === 0);
  rooms.sort((a, b) => Math.hypot(b.x - v.x, b.z - v.z) - Math.hypot(a.x - v.x, a.z - v.z));
  return e.navigation.routeTo('room:' + rooms[0].id, { walk: 'guide' });
});
await p.waitForSelector('[data-nav-stop]', { timeout: 30000 }).catch(() => {});
await p.click('[data-nav-stop]', { timeout: 5000 }).catch(() => {});
await wait(1000);
log('Stop ends Show route', !far.problem && (await lastNav())?.state === 'stopped' && !(await p.$('[data-nav-strip]')), far.problem ? far.message : far.place?.name);

await clearNav();
// (no click on the view: v0.14.0 a click on the floor walks there; the keys need none)
await p.evaluate(() => document.querySelector('[data-layout-viewer]').focus());
const before = await p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
await p.keyboard.down('KeyW');
await wait(3000);
await p.keyboard.up('KeyW');
const moved = await p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
log('free walking without a route: W walks, no navigation events', Math.hypot(moved.x - before.x, moved.z - before.z) > 0.3
  && (await navEvents()).length === 0, `moved ${Math.hypot(moved.x - before.x, moved.z - before.z).toFixed(2)} m`);
await p.keyboard.press('Escape');

// ── 5. A phone (390 × 844): the card's buttons and the strip fit ──
const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const ph = await phoneCtx.newPage();
ph.on('pageerror', (e) => errs.push('phone pageerror: ' + e.message));
await open(ph);
await find(ph, 'Kavya', 'person:' + people.find((x) => x.name === 'Kavya Iyer').personId);
const fitsCard = await ph.evaluate(() => [...document.querySelectorAll('[data-place-shown], [data-place-shown] button')]
  .every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }));
if (SHOTS) await ph.screenshot({ path: join(shotDir, 'navigation-card-phone.png') });
await ph.click('[data-route="auto"]');
await ph.waitForSelector('[data-nav-strip]', { timeout: 120000 });
await ph.waitForTimeout(3000);
const fitsStrip = await ph.evaluate(() => [...document.querySelectorAll('[data-nav-strip], [data-nav-strip] button')]
  .every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; })
  && document.documentElement.scrollWidth <= innerWidth);
if (SHOTS) await ph.screenshot({ path: join(shotDir, 'navigation-walking-phone.png') });
await ph.waitForFunction(() => document.querySelector('[data-nav-strip]')?.dataset.navStrip === 'arrived', null, { timeout: 300000, polling: 1000 }).catch(() => {});
if (SHOTS) { await ph.waitForTimeout(1500); await ph.screenshot({ path: join(shotDir, 'navigation-arrived-phone.png') }); }
log('a phone: the card\'s buttons and the strip fit at 390 px', fitsCard && fitsStrip, `card ${fitsCard}, strip ${fitsStrip}`);
await phoneCtx.close();

await ctx.close();
if (SHOTS) {
  // the recording: one .webm per page; name the desktop one
  const dir = join(shotDir, 'video');
  const [first] = readdirSync(dir).filter((f) => f.endsWith('.webm'));
  if (first) renameSync(join(dir, first), join(shotDir, 'navigation-take-me-there-desktop.webm'));
}
await b.close();
