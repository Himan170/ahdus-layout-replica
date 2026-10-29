// Performance smoke test: a big building must stay cheap to draw.
//   Probe building: 3 floors × 24 rooms (each with a door and a window) and
//   864 items (desks, chairs, plants), loaded through the store.
//   Checks mesh and draw-call counts (not fps: the test machine has no GPU),
//   that changing one room rebuilds only that room and the rooms touching it
//   (and how long that takes next to rebuilding two floors), and that single
//   items can still be selected, locked and removed.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev          (in one terminal)
//                   npm run e2e:perf     (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screens', { recursive: true });

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const MAX_DRAW_CALLS = 1500;
const MAX_MESHES = 2000;

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
// REALISTIC=off npm run e2e:perf: the same building with Settings → Realistic look off (to compare)
const realistic = process.env.REALISTIC !== 'off';
if (!realistic) await p.addInitScript(() => localStorage.setItem('ahdus.realisticLook', 'off'));
// Every main-thread task over 50 ms (opening the saved building measures them)
await p.addInitScript(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
});
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
});

const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 120000);
}), n);

// ── Open a new layout ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Perf Co'); await p.click('button:has-text("Create")'); await p.waitForTimeout(400);
await p.fill('input[placeholder="Layout name…"]', 'Big Building');
await p.press('input[placeholder="Layout name…"]', 'Enter');
await p.waitForSelector('canvas', { timeout: 90000 });
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await frames(2);

// Count real WebGL draw calls per frame (every pass: shadows, main, outlines)
await p.evaluate(() => {
  const gl = window.__ahdusScene.getEngine()._gl;
  window.__drawCalls = 0;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = gl[fn]?.bind(gl);
    if (orig) gl[fn] = (...a) => { window.__drawCalls++; return orig(...a); };
  }
});

// ── The probe building, loaded through the store in one go ──
const build = await p.evaluate(() => {
  const t0 = performance.now();
  const floors = {};
  const rooms = [];
  const objects = [];
  let n = 0;
  for (let f = 0; f < 3; f++) {
    floors[f] = { id: f, name: f === 0 ? 'Ground Floor' : `Floor ${f}`, height: 3.5 };
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const id = `room_${f}_${i}_${j}`;
        const x = (i - 2.5) * 6.15;
        const z = (j - 1.5) * 5.15;
        rooms.push({
          id, type: 'OFFICE', name: `Office ${f}-${i}-${j}`, floor: f, x, z, width: 6, depth: 5, wallHeight: 3.2,
          doors: [{ wall: 'south', offset: -1.5, width: 0.9, height: 2.1 }],
          windows: [{ wall: 'north', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }],
        });
        for (let k = 0; k < 4; k++) {
          const dx = x - 2.1 + k * 1.4;
          const dz = z - 0.8;
          objects.push({ id: `obj_${++n}`, assetType: 'DESK_STANDARD', floor: f, roomId: id, x: dx, y: 0, z: dz });
          objects.push({ id: `obj_${++n}`, assetType: 'CHAIR_OFFICE', floor: f, roomId: id, x: dx, y: 0, z: dz + 0.8 });
          objects.push({ id: `obj_${++n}`, assetType: 'PLANT_LARGE', floor: f, roomId: id, x: x - 2.6 + k * 1.7, y: 0, z: z + 2.1 });
        }
      }
    }
  }
  window.__ahdusStore.getState().loadWorkspace({ layoutName: 'Big Building', floors, rooms, objects });
  return { rooms: rooms.length, objects: objects.length, ms: Math.round(performance.now() - t0) };
});
await frames(3);
// The realistic look (on by default): measure with the real models and textures loaded
const real = await p.evaluate(async () => {
  await window.__ahdusBuild?.whenBuilt(); // progressive loading: big changes are built in slices
  await window.__ahdusAssets.whenLoaded();
  const items = window.__ahdusScene.meshes.filter((m) => m.metadata?.objectId && m.parent?.metadata?.objectId);
  return { items: items.length, models: items.filter((m) => m.metadata.model).length };
});
await p.click('[aria-label="Fit view"]'); await p.waitForTimeout(800); await frames(3);

const measure = () => p.evaluate(() => new Promise((res) => {
  const sc = window.__ahdusScene;
  let first = true;
  const o = sc.onBeforeRenderObservable.add(() => { if (first) { window.__drawCalls = 0; first = false; } });
  sc.onAfterRenderObservable.addOnce(() => {
    sc.onBeforeRenderObservable.remove(o);
    res({
      // frames per second (no GPU here: only for comparing runs on the same machine)
      fps: Math.round(sc.getEngine().getFps() * 10) / 10,
      meshes: sc.meshes.length,
      enabled: sc.meshes.filter((m) => m.isEnabled()).length,
      materials: sc.materials.length,
      active: sc.getActiveMeshes().length,
      drawCalls: window.__drawCalls,
    });
  });
}));
await frames(2);

const ground = await measure();
log(`probe building loaded: ${build.rooms} rooms, ${build.objects} items`, build.rooms === 72 && build.objects === 864,
  `store load ${build.ms} ms`);
if (realistic) log('realistic look: all 864 items are drawn by real models', real.items === 864 && real.models === 864, JSON.stringify(real));
else log('realistic look off: all 864 items are the simple models', real.items === 864 && real.models === 0, JSON.stringify(real));
log(`Studio 3D, ground floor: ≤ ${MAX_DRAW_CALLS} draw calls and ≤ ${MAX_MESHES} meshes`,
  ground.drawCalls <= MAX_DRAW_CALLS && ground.meshes <= MAX_MESHES, JSON.stringify(ground));

await p.evaluate(() => window.__ahdusStore.getState().selectFloor(2)); await frames(3);
await p.click('[aria-label="Fit view"]'); await p.waitForTimeout(800); await frames(3);
const top = await measure();
await p.screenshot({ path: 'e2e/screens/perf-building.png', timeout: 120000 });
log(`Studio 3D, top floor (all 3 floors shown): ≤ ${MAX_DRAW_CALLS} draw calls`,
  top.drawCalls <= MAX_DRAW_CALLS && top.meshes <= MAX_MESHES, JSON.stringify(top));

// ── Changing one room rebuilds only that room and the rooms touching it ──
// The probe rooms are back to back (shared walls), so its 8 neighbours, not
// the other 15 rooms on its floor. The room sync reports its time and count
// (window.__ahdusRoomSync, dev only): compare with rebuilding two whole floors.
// what: { room, patch } (updateRoom) or { floor, height } (setFloorHeight)
const change = (what) => p.evaluate(async (what) => {
  const sc = window.__ahdusScene;
  const ids = () => new Map(sc.transformNodes.filter((t) => t.name.startsWith('room_room_')).map((t) => [t.name, t.uniqueId]));
  const before = ids();
  const store = window.__ahdusStore.getState();
  window.__ahdusRoomSync = null;
  if (what.room) store.updateRoom(what.room, what.patch);
  else store.setFloorHeight(what.floor, what.height);
  await new Promise((r) => setTimeout(r, 300));
  const after = ids();
  return {
    rebuilt: [...after].filter(([name, uid]) => before.get(name) !== uid).map(([name]) => name.slice('room_'.length)),
    sync: window.__ahdusRoomSync,
  };
}, what);
const one = await change({ room: 'room_1_2_1', patch: { width: 5.5 } });
await frames(2);
const neighbourhood = new Set([1, 2, 3].flatMap((i) => [0, 1, 2].map((j) => `room_1_${i}_${j}`)));
log('changing one room rebuilds only it and the rooms touching it',
  one.rebuilt.includes('room_1_2_1') && one.rebuilt.length <= 9 && one.rebuilt.every((id) => neighbourhood.has(id)),
  `${one.rebuilt.length} rebuilt: ${one.rebuilt.join(', ')}`);
// A floor height change rebuilds floor 1 (its wall space) and floor 2 (its elevation): 48 rooms
const all = await change({ floor: 1, height: 3.6 });
await frames(2);
await change({ floor: 1, height: 3.5 });
await frames(2);
log('rebuilding one room and its neighbours takes under half the time of 2 floors',
  !!one.sync && !!all.sync && all.rebuilt.length === 48 && one.sync.ms < all.sync.ms / 2,
  `one room: ${one.sync?.rebuilt} rebuilt in ${Math.round(one.sync?.ms)} ms; 2 floors: ${all.sync?.rebuilt} in ${Math.round(all.sync?.ms)} ms`);

// ── Single items still work: pick, lock tint, remove one ──
const items = await p.evaluate(async () => {
  const sc = window.__ahdusScene;
  const st = () => window.__ahdusStore.getState();
  st().selectFloor(0);
  await new Promise((r) => setTimeout(r, 300));
  const meshesOf = (id) => sc.meshes.filter((m) => (m.metadata?.objectId ?? m.parent?.metadata?.objectId) === id && m.isEnabled());
  const desk = 'obj_1';
  const deskMeshes = meshesOf(desk).length;
  // a ray straight down onto the desk top picks the desk
  const o = st().objects[desk];
  const { Ray } = { Ray: sc.activeCamera.getForwardRay().constructor };
  const V = sc.activeCamera.position.constructor;
  const hit = sc.pickWithRay(new Ray(new V(o.x, 5, o.z), new V(0, -1, 0), 10), (m) => m.isPickable && m.isEnabled());
  const picked = hit?.pickedMesh?.metadata?.objectId ?? hit?.pickedMesh?.parent?.metadata?.objectId ?? null;
  st().updateObject(desk, { isLocked: true });
  await new Promise((r) => setTimeout(r, 300));
  const locked = meshesOf(desk).filter((m) => m.renderOverlay).length;
  const otherTinted = meshesOf('obj_4').filter((m) => m.renderOverlay).length;
  const before = Object.keys(st().objects).length;
  st().removeObject('obj_2');
  await new Promise((r) => setTimeout(r, 300));
  return {
    deskMeshes, picked, locked, otherTinted,
    removed: meshesOf('obj_2').length, kept: before - 1 === Object.keys(st().objects).length,
    chairsLeft: sc.meshes.filter((m) => (m.parent?.metadata?.objectId ?? m.metadata?.objectId)?.startsWith('obj_') &&
      m.parent?.metadata?.assetType === 'CHAIR_OFFICE').length,
  };
});
log('an item is still picked by its objectId', items.picked === 'obj_1', JSON.stringify(items));
log('locking one item tints only that item', items.locked > 0 && items.otherTinted === 0);
log('removing one item removes only its meshes', items.removed === 0 && items.kept && items.chairsLeft > 0);

// ── Opening the saved building from the layout list (the real click path) ──
// Times from the click: the floor you start on drawn (its rooms and items
// built, one frame rendered), and everything built. Main-thread long tasks
// (> 50 ms) in that time, and a CPU profile split by where the time went.
// No GPU here: every rendered frame is a long task too, so compare runs on
// the same machine only.
await p.click('[aria-label="All layouts"]');
await p.waitForSelector('text=Workspace Layouts', { timeout: 60000 });
await p.waitForTimeout(1500);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
await cdp.send('Profiler.start');
const timing = p.evaluate(() => new Promise((resolve) => {
  const t0 = performance.now();
  window.__openT0 = t0;
  const out = { current: null, all: null };
  const built = (sc, floorId) => {
    const st = window.__ahdusStore?.getState();
    if (!st || !sc || sc.isDisposed) return false;
    const rooms = Object.values(st.rooms).filter((r) => floorId === undefined || r.floor === floorId);
    const objects = Object.values(st.objects).filter((o) => floorId === undefined || (o.floor ?? 0) === floorId);
    if (!rooms.length && floorId !== undefined) return false;
    const roomIds = new Set(sc.transformNodes.filter((t) => t.metadata?.roomId && !t.isDisposed()).map((t) => t.metadata.roomId));
    const objIds = new Set(sc.transformNodes.filter((t) => t.metadata?.objectId && !t.isDisposed()).map((t) => t.metadata.objectId));
    return rooms.every((r) => roomIds.has(r.id)) && objects.every((o) => objIds.has(o.id));
  };
  const old = window.__ahdusScene;
  const tick = () => {
    const sc = window.__ahdusScene;
    if (sc && sc !== old && !sc.isDisposed) {
      const floor = window.__ahdusStore.getState().currentFloor;
      if (out.current === null && built(sc, floor)) {
        out.current = -1;
        sc.onAfterRenderObservable.addOnce(() => { out.current = performance.now() - t0; });
      }
      if (out.all === null && built(sc)) {
        out.all = -1;
        sc.onAfterRenderObservable.addOnce(() => { out.all = performance.now() - t0; });
      }
    }
    if (out.current > 0 && out.all > 0) resolve(out);
    else if (performance.now() - t0 > 600000) resolve(out);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.querySelector('button[aria-label="Open Big Building"]').click();
}));
const opened = await timing;
await frames(3);
const { profile } = await cdp.send('Profiler.stop');
const tasks = await p.evaluate(() => {
  const t0 = window.__openT0;
  const list = window.__longTasks.filter((t) => t.start >= t0 - 5);
  return {
    count: list.length,
    longest: Math.round(Math.max(0, ...list.map((t) => t.ms))),
    blocking: Math.round(list.reduce((s, t) => s + Math.max(0, t.ms - 50), 0)),
  };
});
// CPU time per group, from each sample's call stack (Vite bundles Babylon into
// chunk files in dev, so files alone don't say what Babylon was doing)
const groups = {};
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const stackNames = (id) => { const s = []; for (let n = id; n !== undefined; n = parent.get(n)) s.push(byId.get(n).callFrame.functionName); return s; };
const dt = profile.timeDeltas;
const inRooms = {}; // self time of functions called while building room meshes
const others = {}; // self time of the rest, by function@file
profile.samples.forEach((id, i) => {
  const self = byId.get(id).callFrame.functionName || '(anonymous)';
  if (stackNames(id).includes('buildRoomMesh')) inRooms[self] = (inRooms[self] ?? 0) + (dt[i] ?? 0) / 1000;
});
profile.samples.forEach((id, i) => {
  const f = byId.get(id).callFrame;
  if (f.functionName === '(idle)' || f.functionName === '(program)') return;
  const names = stackNames(id);
  const has = (...fn) => names.some((n) => fn.includes(n));
  const g = f.functionName === '(garbage collector)' ? 'garbage collector'
    : /src\/play\/(geometry|building)/.test(f.url) ? 'our maths (geometry, building)'
    : has('roomGeometryKey', 'roomBuildInput') ? 'our maths (geometry, building)'
    : has('buildRoomMesh') ? 'room meshes (roomBuilder + Babylon)'
    : has('createItemMesh', 'loadModelTemplate', 'refreshItems', 'buildModelParts') ? 'item meshes (assetInstances + Babylon)'
    : has('_renderLoop', '_renderFrame') ? 'rendering (incl. shader compile)'
    : /react-dom|scheduler/.test(f.url) ? 'React'
    : 'other';
  groups[g] = (groups[g] ?? 0) + (dt[i] ?? 0) / 1000;
  if (g === 'other') {
    const key = `${f.functionName || '(anonymous)'}@${(f.url.match(/[^/]+$/) ?? [''])[0].replace(/\?.*$/, '')}`;
    others[key] = (others[key] ?? 0) + (dt[i] ?? 0) / 1000;
  }
});
const cpuTop = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 9)
  .map(([g, ms]) => `${g} ${Math.round(ms)} ms`).join('; ');
log('opening the saved building: everything gets built', opened.current > 0 && opened.all > 0,
  `start floor drawn ${Math.round(opened.current)} ms, everything ${Math.round(opened.all)} ms after the click`);
log('opening: main-thread long tasks (reported)', true,
  `${tasks.count} long tasks, longest ${tasks.longest} ms, blocking ${tasks.blocking} ms`);
log('opening: CPU time by group (reported)', true, cpuTop);
log('opening: inside room building, by function (reported)', true, Object.entries(inRooms)
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, ms]) => `${f} ${Math.round(ms)} ms`).join('; '));
log('opening: the rest ("other"), by function (reported)', true, Object.entries(others)
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, ms]) => `${f} ${Math.round(ms)} ms`).join('; '));

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
