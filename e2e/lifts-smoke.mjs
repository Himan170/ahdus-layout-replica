// Lifts and L-shaped stairs (v0.18.3). Studio: the Stairs library (Staircase, two L-shaped stairs, Lift), a Lift
// dropped = a lift shaft room with a door; its Inspector's Lift stops add / remove the shaft on another floor (one undo
// step); Check my layout says which floor no lift stops at; an L staircase placed from the library (its own shape
// drawn), its Inspector's Shape (one undo step), Plan view draws the L. viewer.html: the lift's floor panel inside
// the car (a click rides there), Find's lift, Take me there to a floor only the lift reaches (rides it), and a walk up
// an L staircase (on the drawn tread on every frame, then on the floor above).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:lifts      (in another)
// SHOTS=<dir>: screenshots. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
const VIEWER_ONLY = process.env.PART === 'viewer'; // PART=viewer: only the viewer.html part
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

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => SHOTS ? page.screenshot({ path: join(shotDir, name), timeout: 120000 }) : null;
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene ?? window.__ahdusViewer.scene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 60000);
}), n);
const store = (fn, arg) => page.evaluate(fn, arg);
const lifts = () => store(() => Object.values(window.__ahdusStore.getState().rooms).filter((r) => r.type === 'LIFT')
  .map((r) => ({ id: r.id, floor: r.floor, x: +r.x.toFixed(2), z: +r.z.toFixed(2), doors: (r.doors ?? []).length })));
const undo = async () => { await page.keyboard.press('Control+z'); await frames(3); };
const redo = async () => { await page.keyboard.press('Control+y'); await frames(3); };
const look2D = async (x, z, half) => {
  await page.evaluate(([x, z, half]) => {
    const c = window.__ahdusScene.activeCamera;
    c.target.x = x; c.target.z = z;
    const a = window.__ahdusScene.getEngine().getAspectRatio(c);
    c.orthoTop = half; c.orthoBottom = -half; c.orthoLeft = -half * a; c.orthoRight = half * a;
  }, [x, z, half]);
  await frames(3);
};

// ════════════════════════════ Studio ════════════════════════════
if (!VIEWER_ONLY) try {
  await page.goto(base);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.fill('input[placeholder="Company name…"]', 'Lifts Test');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('input[placeholder="Layout name…"]', { timeout: 30000 });
  await page.fill('input[placeholder="Layout name…"]', 'Lifts Layout');
  await page.press('input[placeholder="Layout name…"]', 'Enter');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusStore && window.__ahdusScene);
  await page.waitForSelector('[data-splash]', { state: 'detached', timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  // a hall on the ground floor and on Floor 1 (a building of two floors)
  await store(() => {
    const st = window.__ahdusStore.getState();
    st.addRoom({ type: 'OFFICE', name: 'Hall', x: 0, z: 0, width: 16, depth: 10, floor: 0, wallHeight: 3.2, doors: [{ wall: 'south', offset: -5, width: 1.2, height: 2.1 }] });
    st.addFloor('Floor 1');
    window.__ahdusStore.getState().addRoom({ type: 'OFFICE', name: 'Upstairs', x: 0, z: 0, width: 16, depth: 10, floor: 1, wallHeight: 3.2 });
    window.__ahdusStore.getState().selectFloor(0);
    window.__ahdusStore.getState().selectRoom(null);
  });
  await page.click('[aria-label="2D view"]');
  await wait(1500);
  await look2D(0, 0, 9);

  // ── The Stairs library ──
  await page.click('[aria-label="Stairs"]');
  await frames(2);
  const lib = '[data-library="stairs"]';
  const names = await page.$$eval(`${lib} .lib-tile .lib-tile__name`, (els) => els.map((e) => e.textContent.trim()));
  const want = ['Staircase', 'L-shaped stairs, turns right', 'L-shaped stairs, turns left', 'Lift'];
  log('Stairs library: Staircase, two L-shaped stairs and the Lift (no "Coming soon")',
    want.every((n) => names.includes(n)) && !(await page.locator(`${lib} [title="Coming soon"]`).count()), names.join(' · '));
  await shot('studio-stairs-library.png');

  // ── A lift: a lift shaft room with a door, its stops in the Inspector ──
  await page.click(`${lib} .lib-tile:has(.lib-tile__name:text-is("Lift"))`);
  await frames(3);
  let L = await lifts();
  const selected = await store(() => window.__ahdusStore.getState().selectedRoomId);
  log('a click on Lift builds a lift shaft (2.2 × 2.2 m, a door) and selects it',
    L.length === 1 && L[0].doors === 1 && selected === L[0].id, JSON.stringify(L));
  await page.waitForSelector('[data-lift-stops]', { timeout: 20000 });
  const stops0 = await page.getAttribute('[data-lift-stops]', 'data-lift-stops');
  log('the Inspector shows Lift stops: only the ground floor so far', stops0 === '0', `stops "${stops0}"`);
  await page.click('[data-lift-stop="1"]');
  await frames(3);
  L = await lifts();
  const same = L.length === 2 && L[0].x === L[1].x && L[0].z === L[1].z && new Set(L.map((l) => l.floor)).size === 2;
  log('Lift stops → Floor 1: a shaft in the same place on Floor 1 (with its door)',
    same && L.every((l) => l.doors === 1) && (await page.getAttribute('[data-lift-stops]', 'data-lift-stops')) === '0 1', JSON.stringify(L));
  await shot('studio-lift-stops.png');
  await undo();
  const afterUndo = (await lifts()).length;
  await redo();
  log('one undo step: Ctrl+Z takes the stop away, Ctrl+Y puts it back', afterUndo === 1 && (await lifts()).length === 2, `${afterUndo} → ${(await lifts()).length}`);

  // ── Check my layout: a floor no lift stops at ──
  await store(() => {
    window.__ahdusStore.getState().addFloor('Floor 2');
    window.__ahdusStore.getState().addRoom({ type: 'OFFICE', name: 'Top', x: 0, z: 0, width: 16, depth: 10, floor: 2, wallHeight: 3.2 });
    window.__ahdusStore.getState().selectFloor(0);
  });
  await frames(3);
  await page.click('[aria-label="Check layout"]');
  await page.waitForSelector('[aria-label="Check my layout"]', { timeout: 30000 });
  await page.waitForFunction(() => /No lift stops at Floor 2/.test(document.querySelector('[aria-label="Check my layout"]')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
  const checkText = await page.textContent('[aria-label="Check my layout"]');
  log('Check my layout: "No lift stops at Floor 2"', /No lift stops at Floor 2/.test(checkText), checkText.replace(/\s+/g, ' ').slice(0, 160));
  await shot('studio-check-lift.png');
  await page.keyboard.press('Escape');
  await frames(2);

  // ── An L staircase from the library ──
  await store(() => window.__ahdusStore.getState().selectRoom(null));
  if (!(await page.locator(lib).isVisible().catch(() => false))) await page.click('[aria-label="Stairs"]');
  await page.click(`${lib} .lib-tile:has(.lib-tile__name:text-is("L-shaped stairs, turns right"))`);
  await frames(4);
  // (placed in the middle of the view, where the lift is: moved aside, clear of it)
  await store(() => {
    const st = window.__ahdusStore.getState();
    const s = Object.values(st.objects).find((o) => o.assetType === 'STAIRCASE');
    if (s) st.updateObject(s.id, { x: -4, z: 0 });
  });
  await frames(3);
  const stairs = () => store(() => Object.values(window.__ahdusStore.getState().objects).filter((o) => o.assetType === 'STAIRCASE')
    .map((o) => ({ id: o.id, shape: o.metadata?.stairShape ?? 'straight', variant: window.__ahdusScene.getTransformNodeByName?.('item_' + o.id)?.metadata?.variant ?? null })));
  let S = await stairs();
  log('a click on "L-shaped stairs, turns right" places a staircase with that shape', S.length === 1 && S[0].shape === 'L-right', JSON.stringify(S));
  const meshShape = async (id) => page.evaluate((id) => {
    const root = window.__ahdusScene.transformNodes.find((n) => n.metadata?.objectId === id && n.metadata?.assetType === 'STAIRCASE');
    return root?.metadata?.variant ?? 'straight';
  }, id);
  await frames(3);
  log('  drawn as an L (its own template: "L-right@3.5")', (await meshShape(S[0].id)) === 'L-right@3.5', await meshShape(S[0].id));
  await shot('studio-l-stairs.png');
  // its Inspector: Shape
  await store((id) => { const st = window.__ahdusStore.getState(); st.selectRoom(null); st.selectObject(id); }, S[0].id);
  await page.waitForSelector('[data-stairs-shape]', { timeout: 20000 });
  log('the staircase Inspector has Shape: L right chosen', (await page.getAttribute('[data-stairs-shape]', 'data-stairs-shape')) === 'L-right');
  await page.click('[data-stairs-shape-option="L-left"]');
  await frames(4);
  S = await stairs();
  const left = S[0].shape === 'L-left' && (await meshShape(S[0].id)) === 'L-left@3.5';
  await page.click('[data-stairs-shape-option="straight"]');
  await frames(4);
  S = await stairs();
  const straight = S[0].shape === 'straight' && (await meshShape(S[0].id)) === 'straight';
  await page.evaluate(() => window.__ahdusStudioEditor?.endBurst?.());
  await undo();
  S = await stairs();
  log('Shape → L left, → Straight: drawn so; Ctrl+Z back', left && straight && S[0].shape !== 'straight', `left ${left}, straight ${straight}, after undo ${S[0].shape}`);

  // ── Plan view draws the L ──
  await store((id) => {
    const st = window.__ahdusStore.getState();
    const o = st.objects[id];
    if ((o.metadata?.stairShape ?? 'straight') === 'straight') st.updateObject(id, { metadata: { stairShape: 'L-right' } });
  }, S[0].id);
  await page.click('[aria-label="Plan view"]');
  await page.waitForSelector('[data-plan-stairs-shape]', { timeout: 30000 });
  log('Plan view draws the L staircase (its two flights and the landing)', (await page.locator('[data-plan-stairs-shape] rect').count()) === 3);
  await shot('studio-plan-l-stairs.png');
  await page.click('[aria-label="3D view"]');
  await frames(3);
} catch (e) {
  log('Studio part ran to the end', false, String(e?.message ?? e).slice(0, 300));
}

// ════════════════════════════ viewer.html ════════════════════════════
const floorsOf = (n) => Array.from({ length: n }, (_, id) => ({ id, name: id ? `Floor ${id}` : 'Ground Floor', height: 3.5 }));
const hall = (floor) => ({
  id: `hall${floor}`, type: 'OFFICE', name: floor ? `Hall ${floor}` : 'Hall', floor, x: 0, z: 0, width: 24, depth: 16, wallHeight: 3.2, wallThickness: 0.15,
  doors: floor ? [] : [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [],
});
const shaft = (floor) => ({
  id: `lift${floor}`, type: 'LIFT', name: 'Lift', floor, x: 8, z: 4, width: 2.2, depth: 2.2, wallHeight: 3.2, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [],
});
const lStair = { id: 'ls1', assetType: 'STAIRCASE', floor: 0, x: -6, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, metadata: { stairShape: 'L-right' } };
const liftLayout = {
  layoutName: 'Lifts test', floors: floorsOf(3), anchorData: {},
  rooms: [hall(0), hall(1), hall(2), shaft(0), shaft(1), shaft(2)], objects: [lStair],
};
const stairsLayout = { layoutName: 'L stairs test', floors: floorsOf(2), anchorData: {}, rooms: [hall(0), hall(1)], objects: [lStair] };

const pos = () => page.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2), floor: w.getLevel() };
});
const open = (layout) => page.evaluate(async (layout) => {
  const e = window.__ahdusViewer;
  await e.whenBuilt();
  e.loadLayout(layout);
  await e.whenBuilt();
  await e.whenNavigationReady();
  e.setMode('walkthrough');
}, layout);
/** Take me there (walk 'auto') and wait for the walk to end: { state, floor, message }. */
const takeMeThere = (target, ms = 300000) => page.evaluate(([target, ms]) => new Promise((res) => {
  const e = window.__ahdusViewer;
  const t = setTimeout(() => res({ state: 'timeout' }), ms);
  const off = e.on('navigation', (ev) => {
    if (['arrived', 'failed', 'stopped'].includes(ev.state)) { clearTimeout(t); off?.(); res({ state: ev.state, message: ev.message ?? null }); }
  });
  const r = e.navigation.routeTo(target, { walk: 'auto' });
  if (r?.problem) { clearTimeout(t); res({ state: 'problem', message: r.message }); }
}), [target, ms]);

try {
  await page.goto(new URL('viewer.html?mode=view&weak=0', base).href);
  await page.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
  await open(liftLayout);
  await page.evaluate((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await page.mouse.move(640, 120);
  await frames(3);

  const list = await page.evaluate(() => window.__ahdusViewer.lifts.list.map((l) => ({ id: l.id, floors: l.floors })));
  log('viewer: one lift, serving the three floors (from three shafts in one place)', list.length === 1 && list[0].floors.join() === '0,1,2', JSON.stringify(list));
  const found = await page.evaluate(() => window.__ahdusViewer.navigation.find('lift').map((p) => p.name));
  log('Find "lift" finds it', found.some((n) => /lift/i.test(n)), found.join(' · '));

  // inside the car: the floor panel
  await page.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: 8, z: 4.2, yaw: Math.PI, pitch: -0.1, floor: 0, fly: false }));
  await frames(4);
  await page.waitForSelector('[data-lift-panel]', { timeout: 30000 });
  const buttons = await page.$$eval('[data-lift-floor]', (els) => els.map((e) => `${e.textContent.trim()}${e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
  log('in the lift car: "Lift" and a button per floor, this one pressed', buttons.length === 3 && buttons[0] === 'Ground Floor*', buttons.join(' · '));
  await shot('viewer-lift-panel.png');
  const events = await page.evaluate(() => { window.__liftEvents = []; window.__ahdusViewer.on('lift', (e) => window.__liftEvents.push(e)); return true; });
  await page.click('[data-lift-floor="2"]');
  await frames(4);
  const up = await pos();
  const ev = await page.evaluate(() => window.__liftEvents);
  log('a click on Floor 2 rides there: same spot in the car, on Floor 2 (a "lift" event)',
    events && up.floor === 2 && Math.abs(up.y - 7) < 0.2 && Math.hypot(up.x - 8, up.z - 4.2) < 0.3 && ev.length === 1 && ev[0].to === 2, `${JSON.stringify(up)} ${JSON.stringify(ev)}`);
  await shot('viewer-lift-floor-2.png');

  // Take me there to Floor 2 (only the lift goes there) from the entrance
  await page.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: 0, z: -6, yaw: 0, pitch: -0.1, floor: 0, fly: false }));
  await frames(3);
  const route = await page.evaluate(() => {
    const r = window.__ahdusViewer.navigation.show({ x: -8, z: 5, floor: 2, name: 'Far corner' });
    return r?.route ?? r;
  });
  log('the route to Floor 2 goes by the lift ("by the lift")', route?.by === 'lift', JSON.stringify(route));
  const t0 = Date.now();
  const went = await takeMeThere({ x: -8, z: 5, floor: 2, name: 'Far corner' });
  const there = await pos();
  log('Take me there rides the lift and arrives on Floor 2', went.state === 'arrived' && there.floor === 2 && Math.hypot(there.x + 8, there.z - 5) < 1.5,
    `${went.state} ${went.message ?? ''} at ${JSON.stringify(there)} in ${Math.round((Date.now() - t0) / 1000)} s`);

  // ── An L staircase: walk up it with Take me there (no lift in this layout) ──
  await open(stairsLayout);
  await frames(3);
  const variant = await page.evaluate(() => window.__ahdusViewer.objects.getObjectMesh('ls1')?.metadata?.variant ?? null);
  log('viewer: the L staircase is drawn as an L', variant === 'L-right@3.5', String(variant));
  await page.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: -5.4, z: -4, yaw: 0, pitch: -0.15, floor: 0, fly: false }));
  await frames(3);
  // the monitor: on every frame on the flight, the drawn tread under the feet
  await page.evaluate(() => {
    const e = window.__ahdusViewer;
    const m = (window.__stairMon = { frames: 0, worst: 0, at: null, landing: 0 });
    const root = e.objects.getObjectMesh('ls1');
    e.scene.onAfterRenderObservable.add(() => {
      if (!e.walkthrough.isActive()) return;
      const meshes = root.getChildMeshes().filter((c) => !c.name.includes('rail'));
      const p = e.walkthrough.getPosition();
      const V = p.constructor;
      const Ray = e.scene.activeCamera.getForwardRay().constructor;
      const hit = e.scene.pickWithRay(new Ray(new V(p.x, p.y + 1.5, p.z), new V(0, -1, 0), 8), (c) => meshes.includes(c));
      if (!hit?.hit) return;
      m.frames += 1;
      const gap = p.y - hit.pickedPoint.y;
      if (Math.abs(p.y - 1.75) < 0.3) m.landing += 1;
      if (Math.abs(gap) > Math.abs(m.worst)) { m.worst = gap; m.at = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }; }
    });
  });
  const climbed = await takeMeThere({ x: 4, z: 4, floor: 1, name: 'Upstairs' });
  const top = await pos();
  const mon = await page.evaluate(() => window.__stairMon);
  log('Take me there climbs the L staircase: on the drawn tread on every frame, across the landing, then Floor 1',
    climbed.state === 'arrived' && top.floor === 1 && mon.frames >= 3 && Math.abs(mon.worst) <= 0.23 && mon.landing >= 1,
    `${climbed.state} ${climbed.message ?? ''}; floor ${top.floor}; ${mon.frames} frames on it, worst ${mon.worst.toFixed(2)} m ${JSON.stringify(mon.at)}, ${mon.landing} near the landing`);
  await page.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: -3.6, z: -4.5, yaw: -0.6, pitch: -0.2, floor: 0, fly: false }));
  await frames(3);
  await shot('viewer-l-stairs.png');
} catch (e) {
  log('viewer part ran to the end', false, String(e?.message ?? e).slice(0, 300));
}

await b.close();
