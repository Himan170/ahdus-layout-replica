// Check my layout on open (v0.18.11): opening a big layout never freezes the page while the background Check runs.
// The building of e2e:perf (3 floors × 24 rooms, 864 items) is saved, then opened from the layout list (the real click
// path); the test waits until the background Check has filled in the Check button. A CPU profile tells which main-thread
// tasks (the Long Tasks API, > 50 ms) were mostly Check's code: none may be over CHECK_TASK_MS (200 ms). Before v0.18.11
// it was ONE task of about 1 s. Also: the button's count = checkLayout's, and nothing else waits on the Check.
// The page's main thread is slowed CPU_SLOWDOWN times (default 4, Chrome's CPU throttling: a slow laptop) from the
// click until the count shows, so the result doesn't depend on how fast this machine is today (unthrottled, the
// one-task Check of v0.18.10 measured 192 ms to 1,125 ms on the same laptop).
// Needs `npm run dev`. CHECK_TASK_MS=<ms> changes the limit, CPU_SLOWDOWN=1 turns the slowing off.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const CHECK_TASK_MS = Number(process.env.CHECK_TASK_MS ?? 200);
const CPU_SLOWDOWN = Math.max(1, Number(process.env.CPU_SLOWDOWN ?? 4));
/** Check's code: a task is Check's when at least half its samples are in these. */
const CHECK_FUNCTIONS = new Set(['checkLayout', 'checkLayoutSteps', 'addFixes', 'addCabinFixes']);

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
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
  if (results.some((r) => !r.ok)) process.exitCode = 1;
});
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 120000);
}), n);

try {
  // ── The building, saved in a new layout ──
  await p.goto(url);
  await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await p.fill('input[placeholder="Company name…"]', 'Check Co'); await p.click('button:has-text("Create")'); await p.waitForTimeout(400);
  await p.fill('input[placeholder="Layout name…"]', 'Big Building');
  await p.press('input[placeholder="Layout name…"]', 'Enter');
  await p.waitForSelector('canvas', { timeout: 90000 });
  await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  await frames(2);
  await p.evaluate(() => {
    const floors = {}; const rooms = []; const objects = []; let n = 0;
    for (let f = 0; f < 3; f++) {
      floors[f] = { id: f, name: f === 0 ? 'Ground Floor' : `Floor ${f}`, height: 3.5 };
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 4; j++) {
          const id = `room_${f}_${i}_${j}`;
          const x = (i - 2.5) * 6.15; const z = (j - 1.5) * 5.15;
          rooms.push({
            id, type: 'OFFICE', name: `Office ${f}-${i}-${j}`, floor: f, x, z, width: 6, depth: 5, wallHeight: 3.2,
            doors: [{ wall: 'south', offset: -1.5, width: 0.9, height: 2.1 }],
            windows: [{ wall: 'north', offset: 0.5, width: 1.4, height: 1.2, sill: 0.9 }],
          });
          for (let k = 0; k < 4; k++) {
            const dx = x - 2.1 + k * 1.4; const dz = z - 0.8;
            objects.push({ id: `obj_${++n}`, assetType: 'DESK_STANDARD', floor: f, roomId: id, x: dx, y: 0, z: dz });
            objects.push({ id: `obj_${++n}`, assetType: 'CHAIR_OFFICE', floor: f, roomId: id, x: dx, y: 0, z: dz + 0.8, rotationY: Math.PI });
            objects.push({ id: `obj_${++n}`, assetType: 'PLANT_LARGE', floor: f, roomId: id, x: x - 2.6 + k * 1.7, y: 0, z: z + 2.1 });
          }
        }
      }
    }
    window.__ahdusStore.getState().loadWorkspace({ layoutName: 'Big Building', floors, rooms, objects });
  });
  await p.evaluate(async () => { await window.__ahdusBuild?.whenBuilt(); await window.__ahdusAssets?.whenLoaded?.(); });
  // the edits e2e:perf makes (loading through the store is not an edit: these make the auto-save write the building)
  for (const what of [{ room: 'room_1_2_1', patch: { width: 5.5 } }, { floor: 1, height: 3.6 }, { floor: 1, height: 3.5 }]) {
    await p.evaluate(async (what) => {
      const store = window.__ahdusStore.getState();
      if (what.room) store.updateRoom(what.room, what.patch);
      else store.setFloorHeight(what.floor, what.height);
      await new Promise((r) => setTimeout(r, 300));
    }, what);
    await frames(2);
  }
  await p.waitForTimeout(4000); // auto-save (1 s after the last change)

  // ── Opening it from the list, with a CPU profile ──
  await p.click('[aria-label="All layouts"]');
  await p.waitForSelector('text=Workspace Layouts', { timeout: 60000 });
  await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await p.evaluate(() => {
    // a marker the CPU profile can find, to line its clock up with performance.now() (as e2e:perf)
    window.__profileMark = function __ahdusProfileMark() { const end = performance.now() + 12; let x = 0; while (performance.now() < end) x++; return x; };
    window.__profileMarkAt = performance.now();
    window.__profileMark();
    window.__openT0 = performance.now();
    document.querySelector('button[aria-label="Open Big Building"]').click();
  });
  // the background Check has finished when the button shows its count (the building has problems: every floor's
  // rooms are unreachable above the ground floor, there are no stairs)
  await p.waitForSelector('button[aria-label="Check layout"] .check-badge', { timeout: 300000 });
  const doneAt = await p.evaluate(() => performance.now() - window.__openT0);
  await p.waitForTimeout(300);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const { profile } = await cdp.send('Profiler.stop');
  const page = await p.evaluate(() => ({
    t0: window.__openT0,
    markAt: window.__profileMarkAt,
    tasks: window.__longTasks.filter((t) => t.start >= window.__openT0 - 5),
    rooms: Object.keys(window.__ahdusStore.getState().rooms).length,
    objects: Object.keys(window.__ahdusStore.getState().objects).length,
    badge: Number(document.querySelector('button[aria-label="Check layout"] .check-badge')?.textContent),
    slices: window.__ahdusCheck ?? null, // v0.18.11 dev hook (none before)
  }));
  log('the saved building opens from the list', page.rooms === 72 && page.objects === 864, `${page.rooms} rooms, ${page.objects} items`);

  // ── Which tasks were Check's (the profile's samples inside each, lined up by the marker) ──
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const inCheck = new Map(); // node id → is Check's code on its stack
  const isCheck = (id) => {
    if (!inCheck.has(id)) {
      let yes = false;
      for (let n = id; n !== undefined && !yes; n = parent.get(n)) yes = CHECK_FUNCTIONS.has(byId.get(n).callFrame.functionName);
      inCheck.set(id, yes);
    }
    return inCheck.get(id);
  };
  const dt = profile.timeDeltas;
  let t = profile.startTime;
  const times = profile.samples.map((_, i) => (t += dt[i] ?? 0) / 1000);
  const markIndex = profile.samples.findIndex((id) => {
    for (let n = id; n !== undefined; n = parent.get(n)) if (byId.get(n).callFrame.functionName === '__ahdusProfileMark') return true;
    return false;
  });
  log('the profile lines up with the page (its marker found)', markIndex >= 0);
  const offset = markIndex >= 0 ? times[markIndex] - page.markAt : 0; // profile ms − page ms
  let checkCpu = 0;
  let first = null;
  let last = null;
  profile.samples.forEach((id, i) => {
    const at = times[i] - offset;
    if (at < page.t0 || !isCheck(id)) return;
    checkCpu += (dt[i] ?? 0) / 1000;
    first ??= at;
    last = at;
  });
  const rows = page.tasks.map((task) => {
    const from = task.start + offset;
    const to = from + task.ms;
    let check = 0;
    let all = 0;
    profile.samples.forEach((id, i) => {
      if (times[i] < from || times[i] > to) return;
      const f = byId.get(id).callFrame.functionName;
      if (f === '(idle)') return;
      all += (dt[i] ?? 0) / 1000;
      if (isCheck(id)) check += (dt[i] ?? 0) / 1000;
    });
    return { at: Math.round(task.start - page.t0), ms: Math.round(task.ms), check: Math.round(check), mostlyCheck: all > 0 && check >= all / 2 };
  });
  const checkTasks = rows.filter((r) => r.mostlyCheck);
  const longest = checkTasks.reduce((a, r) => (!a || r.ms > a.ms ? r : a), null);
  const over = checkTasks.filter((r) => r.ms > CHECK_TASK_MS);
  log('the background Check ran after opening (its code in the profile)', checkCpu > 0,
    `Check's CPU ${Math.round(checkCpu)} ms, from +${Math.round((first ?? 0) - page.t0)} to +${Math.round((last ?? 0) - page.t0)} ms; the count shown at +${Math.round(doneAt)} ms`);
  log(`no task of the background Check over ${CHECK_TASK_MS} ms (main thread ${CPU_SLOWDOWN}× slower)`, checkCpu > 0 && over.length === 0,
    `longest ${longest ? `${longest.ms} ms at +${longest.at} ms (${longest.check} ms of it Check)` : 'none over 50 ms'}; ${checkTasks.length} Check tasks over 50 ms` +
    `${over.length ? `; over: ${over.map((r) => `${r.ms} ms at +${r.at}`).join(', ')}` : ''}` +
    `${page.slices ? `; slices ${page.slices.slices}, longest slice ${Math.round(page.slices.longest)} ms, restarts ${page.slices.restarts}` : ''}` +
    `${page.slices?.steps?.length ? `; longest steps: ${page.slices.steps.map((s) => `${s.step} ${s.ms}`).join(', ')}` : ''}`);

  // ── The count shown = checkLayout's (the same check as one whole call) ──
  const expected = await p.evaluate(async () => {
    const { checkLayout } = await import('/src/play/navigation/checkLayout.js');
    const { ASSET_TYPES } = await import('/src/utils/assetCatalog.js');
    const s = window.__ahdusStore.getState();
    const all = checkLayout({ rooms: s.rooms, objects: s.objects, floors: s.floors }, { catalog: ASSET_TYPES }).problems;
    return all.filter((q) => !(s.ignoredChecks ?? []).includes(q.key) && q.severity !== 'info').length;
  });
  log('the Check button counts what checkLayout finds', page.badge === expected, `shown ${page.badge}, checkLayout ${expected}`);
  log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  log('ran to the end', false, String(e?.message ?? e).slice(0, 300));
} finally {
  await b.close();
}
