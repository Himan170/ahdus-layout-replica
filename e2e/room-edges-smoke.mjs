// Room edge handles (v0.18.7, Astra audit 3c): a selected room shows a handle in the middle of each edge, in
// Studio's 2D view and in Plan view. A drag moves that wall only (the opposite one stays), its new length shows at
// the edge while dragging, one Ctrl+Z puts it back; a click on a handle lets you type the length; a length that
// would run into another room is refused with the reason. Results are checked in the store.
//
// Run:  npm run dev   (in one terminal)
//       npm run e2e:room-edges   (SHOTS=<dir>: screenshots there, else e2e/screens/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const SHOTS = process.env.SHOTS || 'e2e/screens';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;
const shot = (name) => p.screenshot({ path: `${SHOTS}/${name}`, timeout: 120000 });
const toScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
const roomOf = (id) => p.evaluate((id) => window.__ahdusStore.getState().rooms[id], id);
const rooms = () => p.evaluate(() => Object.values(window.__ahdusStore.getState().rooms));
const selectRoom = (id) => p.evaluate((id) => { const s = window.__ahdusStore.getState(); s.selectObject(null); s.selectRoom(id); }, id);
const tile = async (label) => { await p.click(`[aria-label="${label}"]`); await frames(2); };
const drawRoom = async (from, to) => {
  if (!(await p.locator('[data-library="rooms"]').isVisible().catch(() => false))) await tile('Rooms');
  await p.click('[data-library="rooms"] button:has-text("Draw your own size")');
  await frames(2);
  await tile('Rooms'); // the library closes again (the tool stays armed)
  await wait(300); await frames(2);
  const a = await toScreen(from[0], 0.02, from[1]);
  const c = await toScreen(to[0], 0.02, to[1]);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(c.x, c.y, { steps: 12 });
  await p.mouse.up();
  await frames(4);
};
const centre = async (sel) => { const bb = await p.locator(sel).first().boundingBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; };
const undoTitle = () => p.locator('[aria-label="Undo"]').first().getAttribute('title');

try {
  await p.goto(url);
  await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await p.fill('input[placeholder="Company name…"]', 'Edges Co'); await p.click('button:has-text("Create")'); await wait(400);
  await p.fill('input[placeholder="Layout name…"]', 'Edges'); await p.click('button:has-text("Create")');
  await p.waitForSelector('canvas', { timeout: 90000 });
  await p.waitForFunction(() => !!window.__ahdusScene && !document.querySelector('[data-splash]'), null, { timeout: 90000 });
  await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  await tile('2D view'); await frames(4);

  // A 6 × 4 m room, and a neighbour 2 m east of it
  await drawRoom([-3, -2], [3, 2]);
  await drawRoom([5, -2], [8, 2]);
  const all = await rooms();
  const A = all.find((r) => near(r.x, 0) && near(r.width, 6));
  const B = all.find((r) => r !== A);
  log('two rooms drawn: 6 × 4 m and its neighbour 2 m east', !!A && !!B && near(A.depth, 4), all.map((r) => `${r.width}×${r.depth}@${r.x}`).join(', '));
  await tile('Select');
  await selectRoom(A.id); await wait(300); await frames(3);

  // ── 2D: the handles ──
  const handles2d = await p.locator('[data-room-handles] [data-room-handle]').count();
  log('2D: the selected room has four edge handles', handles2d === 4, `${handles2d}`);
  await shot('room-edges-2d-handles.png');

  // Drag the east handle 1 m out: the west wall stays, the length shows while dragging
  await p.waitForFunction(() => !/Built /.test(document.querySelector('[data-studio="hint"]')?.textContent ?? ''), null, { timeout: 10000 })
    .catch(() => {}); // "Built Office room …" shows for 3.5 s and comes before the hover hint
  let s = await toScreen(3, 0.05, 0);
  await p.mouse.move(s.x - 4, s.y); await p.mouse.move(s.x, s.y, { steps: 3 }); await frames(2);
  const hint = await p.locator('[data-studio="hint"]').textContent().catch(() => '');
  log('2D: hovering a handle says the opposite wall stays', /the west wall stays/.test(hint ?? ''), hint);
  await p.mouse.down();
  let e = await toScreen(4, 0.05, 0);
  await p.mouse.move(e.x, e.y, { steps: 10 }); await frames(3);
  const label2d = await p.locator('[data-room-edge-label]').textContent().catch(() => null);
  await shot('room-edges-2d-drag.png');
  await p.mouse.up(); await frames(3);
  let a = await roomOf(A.id);
  log('2D: while dragging, the new length shows at the edge', /7\.00 m/.test(label2d ?? ''), label2d);
  log('2D: dragging the east handle 1 m makes it 7 m wide; the west wall stays at x = -3',
    near(a.width, 7) && near(a.x - a.width / 2, -3), `${a.width} × ${a.depth} at x=${a.x}`);
  const t1 = await undoTitle();
  await p.keyboard.press('Control+z'); await frames(3);
  a = await roomOf(A.id);
  log('2D: one Ctrl+Z puts it back to 6 m', near(a.width, 6) && near(a.x, 0), `${a.width} at x=${a.x}, "${t1}"`);

  // Click the north handle: type 6.4 + Enter → 6.4 m deep, the south wall stays at z = -2
  await selectRoom(A.id); await wait(250); await frames(2);
  s = await toScreen(0, 0.05, 2);
  await p.mouse.move(s.x, s.y - 4); await p.mouse.move(s.x, s.y, { steps: 3 }); await frames(2);
  await p.mouse.down(); await p.mouse.up(); await frames(3);
  const box2d = p.locator('[data-room-edge-input]');
  const typing2d = await box2d.count();
  log('2D: a click on a handle opens the length box', typing2d === 1, `${typing2d}`);
  if (typing2d) {
    await box2d.fill('6.4'); await box2d.press('Enter'); await frames(3);
    a = await roomOf(A.id);
    log('2D: typing 6.4 + Enter makes it 6.4 m deep; the south wall stays at z = -2',
      a.depth === 6.4 && near(a.z - a.depth / 2, -2), `${a.depth} at z=${a.z}`);
    await p.keyboard.press('Control+z'); await frames(3);
  }

  // Drag the east handle into the neighbour: refused, with the reason
  await selectRoom(A.id); await wait(250); await frames(2);
  s = await toScreen(3, 0.05, 0);
  await p.mouse.move(s.x - 4, s.y); await p.mouse.move(s.x, s.y, { steps: 3 }); await frames(2);
  await p.mouse.down();
  e = await toScreen(6.5, 0.05, 0);
  await p.mouse.move(e.x, e.y, { steps: 10 }); await frames(3);
  const bad2d = await p.locator('[data-room-edge-label]').getAttribute('data-room-edge-label').catch(() => null);
  const badText2d = await p.locator('[data-room-edge-label]').textContent().catch(() => null);
  await p.mouse.up(); await frames(3);
  a = await roomOf(A.id);
  log('2D: dragging into the neighbour is refused and says why (the room stays 6 m)',
    bad2d === 'bad' && near(a.width, 6) && /overlap|room/i.test(badText2d ?? ''), `${bad2d}: ${badText2d}; ${a.width}`);

  // ── Plan view ──
  await tile('Plan view'); await wait(400);
  await selectRoom(A.id); await wait(400);
  const handlesPlan = await p.locator('[data-plan-room-handle]').count();
  log('Plan: the selected room has four edge handles', handlesPlan === 4, `${handlesPlan}`);
  const planHint = await p.locator('[data-studio="hint"]').textContent().catch(() => '');
  log('Plan: the hint says the opposite wall stays', /opposite wall stays/.test(planHint ?? ''), planHint);
  await shot('room-edges-plan-handles.png');
  const n = await centre('[data-plan-room-handle="north"]');
  const so = await centre('[data-plan-room-handle="south"]');
  const ppm = Math.abs(so.y - n.y) / 4; // px per metre
  // Drag north 1 m up (north is up in the plan)
  await p.mouse.move(n.x, n.y); await p.mouse.down();
  await p.mouse.move(n.x, n.y - ppm, { steps: 10 }); await wait(200);
  const labelPlan = await p.locator('[data-plan-edge-label]').textContent().catch(() => null);
  await shot('room-edges-plan-drag.png');
  await p.mouse.up(); await wait(300);
  a = await roomOf(A.id);
  log('Plan: while dragging, the new length shows at the edge', /5\.00 m/.test(labelPlan ?? ''), labelPlan);
  log('Plan: dragging the north handle 1 m makes it 5 m deep; the south wall stays at z = -2',
    near(a.depth, 5) && near(a.z - a.depth / 2, -2), `${a.depth} at z=${a.z}`);
  log('Plan: the room stays selected after the drag', await p.evaluate(() => window.__ahdusStore.getState().selectedRoomId) === A.id);
  await p.keyboard.press('Control+z'); await wait(300);
  a = await roomOf(A.id);
  log('Plan: one Ctrl+Z puts it back to 4 m', near(a.depth, 4) && near(a.z, 0), `${a.depth} at z=${a.z}`);

  // Click the west handle, type 6.65: exactly 6.65 m (to the mm), the east wall stays at x = 3
  await selectRoom(A.id); await wait(300);
  const w = await centre('[data-plan-room-handle="west"]');
  await p.mouse.click(w.x, w.y); await wait(300);
  const boxPlan = p.locator('[data-plan-edge-input]');
  const typingPlan = await boxPlan.count();
  log('Plan: a click on a handle opens the length box', typingPlan === 1, `${typingPlan}`);
  if (typingPlan) {
    await boxPlan.fill('6.65'); await boxPlan.press('Enter'); await wait(300);
    a = await roomOf(A.id);
    log('Plan: typing 6.65 makes it exactly 6.65 m wide; the east wall stays at x = 3',
      a.width === 6.65 && near(a.x + a.width / 2, 3, 0.001), `${a.width} at x=${a.x}`);
    await p.keyboard.press('Control+z'); await wait(300);
  }

  // Type a length that runs into the neighbour: refused with the reason, the box stays
  await selectRoom(A.id); await wait(300);
  const east = await centre('[data-plan-room-handle="east"]');
  await p.mouse.click(east.x, east.y); await wait(300);
  if (await boxPlan.count()) {
    await boxPlan.fill('9'); await boxPlan.press('Enter'); await wait(300);
    const problem = await p.locator('[data-plan-edge-problem]').textContent().catch(() => null);
    a = await roomOf(A.id);
    log('Plan: typing a length into the neighbour is refused and says why', !!problem && near(a.width, 6), `${problem}; ${a.width}`);
    await shot('room-edges-plan-refused.png');
    await boxPlan.press('Escape'); await wait(200);
    log('Plan: Esc closes the length box', await boxPlan.count() === 0);
  } else log('Plan: typing a length into the neighbour is refused and says why', false, 'no box');

  // A locked room has no handles
  await p.evaluate((id) => window.__ahdusStore.getState().selectRoom(id), A.id);
  await p.keyboard.press('l'); await wait(300);
  const lockedHandles = await p.locator('[data-plan-room-handle]').count();
  log('Plan: a locked room shows no handles', lockedHandles === 0 && (await roomOf(A.id)).isLocked, `${lockedHandles}`);
} catch (err) {
  log('the script ran to the end', false, String(err?.stack ?? err).slice(0, 400));
}

for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length + (errs.length ? 1 : 0);
console.log(`${results.length - results.filter((r) => !r.ok).length} of ${results.length} checks passed${errs.length ? `, ${errs.length} page errors` : ''}`);
await b.close();
process.exit(failed ? 1 : 0);
