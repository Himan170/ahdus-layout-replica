// Stairs smoke test (v0.14.5): what you see is what you climb. In viewer.html, flights turned 0 / 90 / 180 / 270°,
// one with an old y, one with an old scale, one on Floor 1: W from the foot climbs each to the floor above, and on
// every frame the feet are on the tread that is DRAWN there (a ray against the real meshes) and the first-person
// camera is above it. From the side a flight stops you. Take me there climbs a turned flight. Studio: a staircase
// selected has no Height and no size, and the R key says why.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev           (in one terminal)
//                   npm run e2e:stairs    (in another)
// SHOTS=<dir>: 1440×900 screenshots of the turned stairs being climbed. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
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

const DEG = Math.PI / 180;
const flight = (id, x, z, angle, more = {}) => ({
  id, assetType: 'STAIRCASE', floor: 0, x, y: 0, z, rotationX: 0, rotationY: angle * DEG, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...more,
});
const hall = (floor) => ({
  id: `hall${floor}`, type: 'OFFICE', name: floor ? `Hall ${floor}` : 'Hall', floor, x: 0, z: 0, width: 36, depth: 36, wallHeight: 3.2, wallThickness: 0.15,
  doors: floor ? [] : [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [],
});
const FLIGHTS = [
  { name: 'turned 0°', s: flight('a', -12, -8, 0) },
  { name: 'turned 90°', s: flight('b', -5, -8, 90) },
  { name: 'turned 180°', s: flight('c', 3, -8, 180) },
  { name: 'turned 270°', s: flight('d', 11, -8, 270) },
  { name: 'turned 90° with an old y of 0.6 m', s: flight('e', -5, 0, 90, { y: 0.6 }) },
  { name: 'an old scale, 1.5 wide and long, turned 180°', s: flight('f', 6, 2, 180, { scaleX: 1.5, scaleZ: 1.5 }) },
  { name: 'on Floor 1, turned 270°', s: flight('g', -8, 8, 270, { floor: 1 }), floor: 1 },
];
const layout = {
  layoutName: 'Stairs test layout',
  rooms: [hall(0), hall(1), hall(2)],
  objects: FLIGHTS.map((f) => f.s),
  floors: [0, 1, 2].map((id) => ({ id, name: id ? `Floor ${id}` : 'Ground Floor', height: 3.5 })),
  anchorData: {},
};
/** World point at (across, along) in a flight's own coordinates. */
const at = (s, across, along) => ({
  x: s.x + across * Math.cos(s.rotationY) + along * Math.sin(s.rotationY),
  z: s.z - across * Math.sin(s.rotationY) + along * Math.cos(s.rotationY),
});
const halfLength = (s) => 2 * Math.abs(s.scaleZ);
const halfWidth = (s) => 0.6 * Math.abs(s.scaleX);

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1024, height: 640 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = (name) => p.screenshot({ path: join(shotDir, name), timeout: 120000 });
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusViewer.scene; let c = 0;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) { sc.onAfterRenderObservable.remove(o); res(); } });
  setTimeout(res, 20000);
}), n);
const pose = async (a) => { await p.evaluate((a) => window.__ahdusViewer.walkthrough.setPose(a), a); await frames(2); };
const pos = () => p.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { x: v.x, y: v.y, z: v.z, floor: w.getLevel() };
});
/** Hold a key until done(position), or the time is up. */
async function holdUntil(key, done, ms = 90000) {
  const start = Date.now();
  await p.keyboard.down(key);
  let q = await pos();
  while (Date.now() - start < ms && !done(q)) { await wait(200); q = await pos(); }
  await p.keyboard.up(key);
  await frames(2);
  return pos();
}

// ── Open the layout, walking ──
await p.goto(new URL('viewer.html?mode=view', base).href);
await p.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
await p.evaluate(async (layout) => {
  const e = window.__ahdusViewer;
  await e.whenBuilt();
  e.loadLayout(layout);
  await e.whenBuilt();
  await e.whenNavigationReady();
  e.setMode('walkthrough');
}, layout);
await p.evaluate((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
await p.mouse.move(500, 120); // over the view: the keys are its own (no click: a click walks)
await frames(3);

// The monitor: on every frame of a climb, the drawn tread under the feet and the camera's height over it
await p.evaluate(() => {
  const e = window.__ahdusViewer;
  const m = (window.__stairMon = { id: null, frames: 0, worst: 0, at: null, onFlight: 0, lowCamera: Infinity });
  e.scene.onAfterRenderObservable.add(() => {
    if (!m.id || !e.walkthrough.isActive()) return;
    const root = e.objects.getObjectMesh(m.id);
    const meshes = root.getChildMeshes().filter((c) => !c.name.includes('rail'));
    const pos = e.walkthrough.getPosition();
    const V = pos.constructor;
    const Ray = e.scene.activeCamera.getForwardRay().constructor;
    const hit = e.scene.pickWithRay(new Ray(new V(pos.x, pos.y + 1.5, pos.z), new V(0, -1, 0), 8), (c) => meshes.includes(c));
    m.frames += 1;
    if (!hit?.hit) return;
    const gap = pos.y - hit.pickedPoint.y;
    m.onFlight += 1;
    if (Math.abs(gap) > Math.abs(m.worst)) { m.worst = gap; m.at = { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) }; }
    const cam = e.scene.activeCamera.globalPosition.y - hit.pickedPoint.y;
    if (cam < m.lowCamera) m.lowCamera = cam;
  });
});
const watch = (id) => p.evaluate((id) => Object.assign(window.__stairMon, { id, frames: 0, worst: 0, at: null, onFlight: 0, lowCamera: Infinity }), id);
const monitor = () => p.evaluate(() => { const { id, ...m } = window.__stairMon; window.__stairMon.id = null; return m; });

// ── W climbs each flight, up its drawn line, to the floor above ──
const STEP = 0.2 + 0.03; // a step's height: the feet are on the tread drawn, within a step (the climb is on a slope)
for (const { name, s, floor = 0 } of FLIGHTS) {
  const L = halfLength(s);
  const foot = at(s, 0, -L - 1.2);
  const top = 3.5 * (floor + 1) + 0.02;
  await pose({ ...foot, yaw: s.rotationY, pitch: -0.15, floor, fly: false });
  await watch(s.id);
  const q = await holdUntil('KeyW', (r) => r.y > top - 0.03 && Math.hypot(r.x - at(s, 0, L + 0.6).x, r.z - at(s, 0, L + 0.6).z) < 0.8);
  const m = await monitor();
  const drawn = await p.evaluate((id) => {
    const n = window.__ahdusViewer.objects.getObjectMesh(id);
    return { y: n.position.y, rotationX: n.rotation.x, rotationZ: n.rotation.z, scaleY: n.scaling.y };
  }, s.id);
  const standsOnFloor = Math.abs(drawn.y - 3.5 * floor) < 0.001 && drawn.rotationX === 0 && drawn.rotationZ === 0 && drawn.scaleY === 1;
  log(`W climbs the flight ${name}: on the tread drawn all the way, then on the floor above`,
    q.floor === floor + 1 && Math.abs(q.y - top) < 0.05 && m.onFlight >= 3 && Math.abs(m.worst) <= STEP && standsOnFloor,
    `floor ${q.floor} y ${q.y.toFixed(2)}; ${m.onFlight}/${m.frames} frames on it, worst ${m.worst.toFixed(2)} m ${JSON.stringify(m.at)}; drawn y ${drawn.y}`);
  // and back down, facing the other way
  await pose({ ...at(s, 0, L + 1), yaw: s.rotationY + Math.PI, pitch: -0.2, floor: floor + 1, fly: false });
  await watch(s.id);
  const d = await holdUntil('KeyW', (r) => r.y < 3.5 * floor + 0.1 && Math.hypot(r.x - foot.x, r.z - foot.z) < 1.2);
  const md = await monitor();
  log(`  and back down it (${name})`, d.floor === floor && d.y < 3.5 * floor + 0.1 && Math.abs(md.worst) <= STEP,
    `floor ${d.floor} y ${d.y.toFixed(2)}, worst ${md.worst.toFixed(2)} m`);
}

// ── First person: the steps never pass through the camera ──
const turned = FLIGHTS[1].s; // turned 90°
await pose({ ...at(turned, 0, -3.2), yaw: turned.rotationY, pitch: -0.15, floor: 0, fly: false });
await p.keyboard.press('KeyV'); await frames(3);
await watch(turned.id);
if (SHOTS) {
  await p.keyboard.down('KeyW');
  await p.waitForFunction(() => window.__ahdusViewer.walkthrough.getPosition().y > 1.2, null, { timeout: 60000 });
  await p.keyboard.up('KeyW');
  await shot('stairs-first-person-turned-90.png');
}
const fp = await holdUntil('KeyW', (r) => r.y > 3.47 && r.x > turned.x + 2.2);
const mfp = await monitor();
log('first person up the 90° flight: the camera stays well above the steps, on every frame',
  fp.floor === 1 && mfp.onFlight >= 3 && mfp.lowCamera > 1.2,
  `floor ${fp.floor}; lowest camera ${mfp.lowCamera.toFixed(2)} m above the tread, ${mfp.onFlight} frames`);
await p.keyboard.press('KeyV'); await frames(3);

// Third person, for the picture: half way up each turn
if (SHOTS) {
  for (const { name, s } of FLIGHTS.slice(0, 4)) {
    await pose({ ...at(s, 0, -3.2), yaw: s.rotationY, pitch: -0.2, floor: 0, fly: false });
    await p.keyboard.down('KeyW');
    await p.waitForFunction(() => window.__ahdusViewer.walkthrough.getPosition().y > 1.6, null, { timeout: 60000 });
    await p.keyboard.up('KeyW');
    await frames(2);
    await shot(`stairs-third-person-${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
  }
}

// ── From the side, a flight stops you (the block is solid); you don't end up inside it ──
for (const { name, s } of FLIGHTS.slice(0, 4)) {
  const side = at(s, 2.2, 1); // 1 m up the flight, 2.2 m beside it
  await pose({ ...side, yaw: s.rotationY - Math.PI / 2, pitch: -0.1, floor: 0, fly: false });
  const q = await holdUntil('KeyW', () => false, 2500);
  const across = (q.x - s.x) * Math.cos(s.rotationY) - (q.z - s.z) * Math.sin(s.rotationY);
  log(`from the side the flight ${name} stops you`, Math.abs(q.y - 0.02) < 0.05 && Math.abs(across) >= halfWidth(s) + 0.27,
    `${across.toFixed(2)} m from its middle line, y ${q.y.toFixed(2)}`);
}

// ── Take me there: up a turned flight, by its bottom step, to a spot on Floor 1 ──
await p.evaluate(() => { window.__viewerNav = []; });
await pose({ x: -14, z: -14, yaw: 0, pitch: -0.1, floor: 0, fly: false });
await watch(turned.id);
const goal = at(turned, 0, 4);
const answer = await p.evaluate((g) => {
  const r = window.__ahdusViewer.navigation.routeTo({ x: g.x, z: g.z, floor: 1, name: 'the far side' }, { walk: 'auto' });
  return { problem: r?.problem ?? null, message: r?.message ?? null, floors: r?.floors ?? null, length: r?.length ?? null, seconds: r?.seconds ?? null };
}, goal);
log('Take me there plans a walk by the stairs; its time is its length at the walking speed (2.2 m/s)',
  !answer.problem && Math.abs(answer.seconds - answer.length / 2.2) < 0.01,
  JSON.stringify(answer));
await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => ['arrived', 'failed'].includes(e.state)), null, { timeout: 300000, polling: 500 }).catch(() => {});
const ended = await p.evaluate(() => (window.__viewerNav ?? []).find((e) => ['arrived', 'failed'].includes(e.state))?.state ?? 'none');
const there = await pos();
const mt = await monitor();
log('Take me there climbs a flight (it arrives upstairs, on the treads drawn, at any turn the route takes)',
  ended === 'arrived' && there.floor === 1 && Math.abs(there.y - 3.52) < 0.05 && Math.abs(mt.worst) <= STEP,
  `${ended}, floor ${there.floor}, y ${there.y.toFixed(2)}, worst ${mt.worst.toFixed(2)} m`);

// ── v0.17.3: a click on a flight walks up (or down) it, to the landing at its other end ──
/** A spot on the view where a click is on that staircase (clickTarget says so), as page coordinates; null: none. */
const stairsPixel = (id) => p.evaluate((id) => {
  const w = window.__ahdusViewer.walkthrough;
  const cv = w.canvas; const W = cv.clientWidth; const H = cv.clientHeight; const r = cv.getBoundingClientRect();
  for (let fy = 0.95; fy > 0.25; fy -= 0.02) {
    for (let fx = 0.15; fx < 0.85; fx += 0.01) {
      const t = w.clickTarget(W * fx, H * fy);
      if (t.stairs?.objectId === id) return { x: r.left + W * fx, y: r.top + H * fy, direction: t.stairs.direction };
    }
  }
  return null;
}, id);
/** The 'walkClick' events and the end of the click's walk (arrived / failed / stopped). */
await p.evaluate(() => {
  window.__walkClicks = [];
  window.__ahdusViewer.on('walkClick', (d) => window.__walkClicks.push({ action: d.action, stairs: d.stairs ?? null, message: d.message ?? null }));
});
async function clickWalk(click) {
  await p.evaluate(() => { window.__viewerNav = []; window.__walkClicks = []; });
  await click();
  await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => ['arrived', 'failed', 'stopped'].includes(e.state)), null, { timeout: 300000, polling: 500 }).catch(() => {});
  return p.evaluate(() => ({
    ended: (window.__viewerNav ?? []).find((e) => ['arrived', 'failed', 'stopped'].includes(e.state))?.state ?? 'none',
    clicks: window.__walkClicks,
  }));
}
/** Inside the flight's own outline (then the walk ended on its steps, not on a landing). */
const onFlight = (s, q) => {
  const lx = (q.x - s.x) * Math.cos(s.rotationY) - (q.z - s.z) * Math.sin(s.rotationY);
  const lz = (q.x - s.x) * Math.sin(s.rotationY) + (q.z - s.z) * Math.cos(s.rotationY);
  return Math.abs(lx) < halfWidth(s) && Math.abs(lz) < halfLength(s);
};
const flat = (s, q, f) => q.floor === f && Math.abs(q.y - (3.5 * f + 0.02)) < 0.05 && !onFlight(s, q);

// up: a click on the steps from 3 m in front of the bottom step
await pose({ ...at(turned, 0, -5), yaw: turned.rotationY, pitch: -0.3, floor: 0, fly: false });
const upAt = await stairsPixel(turned.id);
const up = upAt ? await clickWalk(() => p.mouse.click(upAt.x, upAt.y)) : { ended: 'no stairs on the view', clicks: [] };
const upEnd = await pos();
log('a click on a flight (mouse) walks UP it and ends on the landing of Floor 1, not on the steps',
  up.ended === 'arrived' && up.clicks[0]?.stairs?.direction === 'up' && flat(turned, upEnd, 1),
  `${up.ended}, ${JSON.stringify(up.clicks[0] ?? null)}, floor ${upEnd.floor} y ${upEnd.y.toFixed(2)} (${upEnd.x.toFixed(2)}, ${upEnd.z.toFixed(2)})`);
// down: from the landing upstairs, a click on the same flight (seen through its opening)
await pose({ ...at(turned, 0, 3.4), yaw: turned.rotationY + Math.PI, pitch: -0.55, floor: 1, fly: false });
const downAt = await stairsPixel(turned.id);
const down = downAt ? await clickWalk(() => p.mouse.click(downAt.x, downAt.y)) : { ended: 'no stairs on the view', clicks: [] };
const downEnd = await pos();
log('a click on the flight from Floor 1 walks DOWN it to the ground floor, in front of its bottom step',
  down.ended === 'arrived' && down.clicks[0]?.stairs?.direction === 'down' && flat(turned, downEnd, 0),
  `${down.ended}, ${JSON.stringify(down.clicks[0] ?? null)}, floor ${downEnd.floor} y ${downEnd.y.toFixed(2)}`);
// mouse look (L): the crosshair on the steps, a click anywhere
// the crosshair is over the right shoulder (0.85 m aside), so stand aside too until it is on the steps
let aimed = false;
for (const across of [-0.85, 0.85, 0]) {
  for (const pitch of [-0.2, -0.3, -0.4, -0.5]) {
    await pose({ ...at(turned, across, -4.5), yaw: turned.rotationY, pitch, floor: 0, fly: false });
    await wait(400); // the shoulder camera settles
    aimed = await p.evaluate((id) => {
      const w = window.__ahdusViewer.walkthrough;
      return w.clickTarget(w.canvas.clientWidth / 2, w.canvas.clientHeight / 2).stairs?.objectId === id;
    }, turned.id);
    if (aimed) break;
  }
  if (aimed) break;
}
await p.mouse.move(500, 120);
await p.keyboard.press('KeyL');
await p.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 10000 }).catch(() => {});
const locked = await p.evaluate(() => !!document.pointerLockElement);
const lookUp = aimed && locked ? await clickWalk(() => p.mouse.click(500, 120)) : { ended: `aimed ${aimed}, locked ${locked}`, clicks: [] };
const lookEnd = await pos();
log('mouse look (L): a click with the crosshair on the steps walks up them too',
  lookUp.ended === 'arrived' && lookUp.clicks[0]?.stairs?.direction === 'up' && flat(turned, lookEnd, 1),
  `${lookUp.ended}, floor ${lookEnd.floor} y ${lookEnd.y.toFixed(2)}`);
await p.keyboard.press('Escape'); await wait(500);

// A layout shaped like the one this was found in (v0.17.2, Render): a staircase room with no door of its
// own, reached through the office's door in their shared wall, the bottom step 0.3 m from that wall (Check
// warns "no room in front of the bottom step"). W climbed it, a click walked to the door and stopped.
const tight = flight('t', 5, -3, 180);
const office = (floor, doors) => ({
  id: `office${floor}`, type: 'OFFICE', name: floor ? 'Office 1' : 'Office', floor, x: 4.5, z: 3.25, width: 11, depth: 7.5,
  wallHeight: 3.2, wallThickness: 0.15, doors, windows: [],
});
const stairRoom = (floor, z, depth, doors) => ({
  id: `stairroom${floor}`, type: 'STAIRCASE', name: floor ? 'Stairs 1' : 'Stairs', floor, x: 5.325, z, width: 5.35, depth,
  wallHeight: 3.2, wallThickness: 0.15, doors, windows: [],
});
await p.evaluate(async (layout) => {
  const e = window.__ahdusViewer;
  e.loadLayout(layout);
  await e.whenBuilt();
  await e.whenNavigationReady();
  e.setMode('walkthrough');
}, {
  layoutName: 'Tight stairs',
  rooms: [
    office(0, [{ wall: 'north', offset: 0, width: 1.2, height: 2.1 }, { wall: 'south', offset: 0.34, width: 1, height: 2.1 }]),
    stairRoom(0, -3.825, 6.35, []),
    office(1, [{ wall: 'south', offset: 2.5, width: 1, height: 2.1 }]),
    stairRoom(1, -3.575, 5.85, [{ wall: 'north', offset: 1.675, width: 1, height: 2.1 }]),
  ],
  objects: [tight],
  floors: [0, 1].map((id) => ({ id, name: id ? 'Floor 1' : 'Ground Floor', height: 3.5 })),
  anchorData: {},
});
await p.mouse.move(500, 120);
await pose({ x: 4.84, z: 2, yaw: Math.PI, pitch: -0.25, floor: 0, fly: false });
await wait(400);
const tightAt = await stairsPixel('t');
const tightUp = tightAt ? await clickWalk(() => p.mouse.click(tightAt.x, tightAt.y)) : { ended: 'no stairs on the view', clicks: [] };
const tightEnd = await pos();
log('stairs right behind a door (bottom step 0.3 m from the wall): a click on them through the door climbs to Floor 1',
  tightUp.ended === 'arrived' && tightUp.clicks[0]?.stairs?.direction === 'up' && flat(tight, tightEnd, 1),
  `${tightUp.ended}, ${JSON.stringify(tightUp.clicks[0] ?? null)}, floor ${tightEnd.floor} y ${tightEnd.y.toFixed(2)} (${tightEnd.x.toFixed(2)}, ${tightEnd.z.toFixed(2)})`);
if (SHOTS) await shot('stairs-click-tight-arrived.png');

// ── Studio: a staircase keeps its size ──
const st = await ctx.newPage();
st.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
st.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
await p.close();
await st.goto(base);
await st.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await st.fill('input[placeholder="Company name…"]', 'Stairs Co'); await st.click('button:has-text("Create")'); await st.waitForTimeout(400);
await st.fill('input[placeholder="Layout name…"]', 'Main'); await st.click('button:has-text("Create")');
await st.waitForSelector('canvas', { timeout: 90000 });
await st.waitForSelector('[data-splash]', { state: 'detached', timeout: 90000 }).catch(() => {});
const stairsId = await st.evaluate(() => {
  const s = window.__ahdusStore.getState();
  s.addObject({ assetType: 'STAIRCASE', x: 2, y: 0, z: 0, floor: 0, rotationY: Math.PI / 2 });
  const o = Object.values(window.__ahdusStore.getState().objects).find((x) => x.assetType === 'STAIRCASE');
  window.__ahdusStore.getState().selectObject(o.id);
  return o.id;
});
await st.waitForSelector('[data-stairs-size]', { timeout: 30000 }).catch(() => {});
const inspector = await st.evaluate(() => ({
  note: document.querySelector('[data-stairs-size]')?.textContent ?? '',
  fields: [...document.querySelectorAll('.inspector label, .insp-field label, [class*="insp"] label')].map((l) => l.textContent.trim()),
}));
log('Studio, stairs selected: no Height and no size fields, and it says why',
  /keep their size/.test(inspector.note) && !inspector.fields.some((f) => /^(Height|Width|Depth|Scale)/i.test(f)),
  JSON.stringify(inspector));
// v0.14.6: one floor, so these stairs lead nowhere: the Inspector says so
const problems = await st.evaluate(() => document.querySelector('[data-stairs-problems]')?.textContent ?? '');
log('Studio, stairs on the only floor: "These stairs lead nowhere" in the Inspector', /These stairs lead nowhere/.test(problems), problems);
const before = await st.evaluate((id) => window.__ahdusStore.getState().objects[id], stairsId);
await st.locator('canvas').first().hover();
await st.keyboard.press('s'); // v0.15.1: S = resize (R turns 90°)
await st.waitForTimeout(600);
const afterR = await st.evaluate((id) => window.__ahdusStore.getState().objects[id], stairsId);
const page = await st.evaluate(() => document.body.innerText);
log('the S key (Resize) on stairs says why instead of offering it',
  /keep their size/.test(page) && afterR.scaleX === before.scaleX && afterR.scaleZ === before.scaleZ, '');
if (SHOTS) {
  // the move gizmo: no up arrow (v0.15.1: no rotation rings any more; R turns 90°)
  await st.waitForTimeout(1500);
  await st.keyboard.press('w'); await st.waitForTimeout(1500);
  await st.screenshot({ path: join(shotDir, 'stairs-studio-move.png'), timeout: 120000 });
}

await b.close();
