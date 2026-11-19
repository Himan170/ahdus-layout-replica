// v0.18.2 "stability": Studio input shared by panels and the 3D canvas (private-docs/WORKPLACE_AUDIT.md, Phase 1).
// Each check passes when Studio behaves as it should; on v0.18.1 the failing ones are the reproduced defects.
//   1 a library drop released over a canvas control (Reset view) places nothing
//   2 Tab from a focused control (Settings) moves focus on and keeps Studio open; Tab on the canvas = Preview
//   3 a phone's More → Settings: Esc closes Settings only (one level)
//   4 a right / middle press neither places an armed item (stairs) nor changes the selection
//   5 the wheel over a panel scrolls it and leaves the placement ghost's height alone
//   6 a drag whose pointer is cancelled leaves the layout and undo alone, and the camera works again
//   7 the hidden selection bar's buttons are not in the Tab order
//   8 1024 × 768 with the library and the Inspector open: every canvas control is visible and clickable
// Needs `npm run dev`. SHOTS=<dir>: screenshots.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
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

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 30000);
}), n);
const middle = async (sel) => {
  const box = await page.locator(sel).first().boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
};
const count = () => page.evaluate(() => Object.keys(window.__ahdusStore.getState().objects).length);
const state = () => page.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return { objects: Object.keys(s.objects).length, selected: s.selectedObjectId, room: s.selectedRoomId,
    undo: !document.querySelector('[aria-label="Undo"]')?.disabled };
});
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const scene = window.__ahdusScene; const camera = scene.activeCamera; const engine = scene.getEngine();
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const V = camera.position.constructor; const M = scene.getTransformMatrix().constructor;
  const p = V.Project(new V(x, y, z), M.Identity(), scene.getTransformMatrix(), viewport);
  const c = engine.getRenderingCanvas().getBoundingClientRect(); const k = c.width / engine.getRenderWidth();
  return { x: c.left + p.x * k, y: c.top + p.y * k };
}, [x, y, z]);
// a tap on the stairs tile arms the placement (touch: pick, then tap the floor)
const armStairs = async () => {
  const t = page.locator('.library .lib-tile').filter({ hasText: 'up one floor' }).first();
  await t.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  await t.dispatchEvent('click');
  await page.waitForFunction(() => window.__ahdusStore.getState().placementMode === 'STAIRCASE', null, { timeout: 5000 });
};
const inPreview = () => page.evaluate(() => !!document.querySelector('[aria-label="Back to Studio"]'));

try {
  await page.goto(base);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.fill('input[placeholder="Company name…"]', 'Stability');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('input[placeholder="Layout name…"]', { timeout: 30000 });
  await page.fill('input[placeholder="Layout name…"]', 'Input checks');
  await page.press('input[placeholder="Layout name…"]', 'Enter');
  await page.waitForFunction(() => window.__ahdusStore && window.__ahdusScene, null, { timeout: 120000 });
  await page.waitForSelector('[data-splash]', { state: 'detached', timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  // one office and a desk in it, selected later
  const ids = await page.evaluate(() => {
    const st = window.__ahdusStore.getState();
    const room = st.addRoom({ type: 'OFFICE', name: 'Office', x: 0, z: 0, width: 10, depth: 8, floor: 0, wallHeight: 3 }).id;
    st.selectRoom(null);
    return { room };
  });
  await wait(1500); await frames(3);

  // ── 1. A library drop released over Reset view ──
  await page.click('[aria-label="Furniture"]');
  await page.fill('[aria-label="Search furniture"]', 'Standard Desk');
  await wait(300);
  const tile = '.lib-tile[title^="Standard Desk"]';
  const from = await middle(tile);
  const reset = await middle('[aria-label="Reset view"]');
  let before = await count();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(reset.x, reset.y, { steps: 16 });
  await page.waitForSelector('body.is-dragging-tile', { timeout: 5000 }).catch(() => {});
  await page.mouse.up();
  await wait(400); await frames(2);
  const afterReset = await count();
  log('a library desk released over Reset view places nothing', afterReset === before, `${before} → ${afterReset} items`);
  // and a drop on the floor still places exactly one
  const floorPt = await toScreen(1, 0, 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(floorPt.x, floorPt.y, { steps: 16 });
  await page.mouse.up();
  await wait(500); await frames(2);
  const afterFloor = await count();
  log('…a drop on the floor still places exactly one desk', afterFloor === afterReset + 1, `${afterReset} → ${afterFloor}`);
  await page.click('[aria-label="Furniture"]'); // close the library
  await wait(300);

  // ── 4. Right / middle presses: no edit, no selection change ──
  const desk = await page.evaluate(() => Object.keys(window.__ahdusStore.getState().objects)[0]);
  await page.evaluate((id) => window.__ahdusStore.getState().selectObject(id), desk);
  await wait(300); await frames(2);
  const open = await toScreen(-3.5, 0, -2.5);
  for (const button of ['right', 'middle']) {
    await page.mouse.click(open.x, open.y, { button });
    await wait(200); await frames(2);
  }
  const sel = await state();
  log('a right or middle click on the floor keeps the selected desk selected', sel.selected === desk, JSON.stringify(sel));
  // stairs armed (Stairs → Straight staircase): a right / middle click places nothing
  await page.click('[aria-label="Stairs"]');
  await armStairs();
  await page.click('[aria-label="Stairs"]'); // close the library, the stairs stay armed
  await wait(300);
  before = await count();
  const spot = await toScreen(-2.5, 0, 1);
  await page.mouse.move(spot.x, spot.y, { steps: 4 }); await frames(2);
  for (const button of ['right', 'middle']) {
    await page.mouse.click(spot.x, spot.y, { button });
    await wait(200); await frames(2);
  }
  const armed = await page.evaluate(() => window.__ahdusStore.getState().placementMode);
  log('stairs armed: a right or middle click places nothing', (await count()) === before, `${before} → ${await count()} items, armed ${armed}`);

  // ── 5. The wheel over a panel while the stairs are armed ──
  if (!armed) {
    await page.click('[aria-label="Stairs"]');
    await armStairs();
    await page.click('[aria-label="Stairs"]');
    await wait(300);
  }
  await page.mouse.move(spot.x, spot.y, { steps: 3 }); await frames(2);
  const ghostY = () => page.evaluate(() => {
    const sc = window.__ahdusScene;
    const g = [...sc.transformNodes, ...sc.meshes].find((m) => !m.parent && /ghost_preview/.test(m.name) && m.isEnabled());
    return g ? +g.position.y.toFixed(3) : null;
  });
  const y0 = await ghostY();
  const rail = await middle('[aria-label="Layers"]');
  await page.mouse.move(rail.x, rail.y);
  const wheelOk = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Layers"]');
    const ev = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return !ev.defaultPrevented;
  });
  await page.mouse.move(spot.x, spot.y, { steps: 3 }); await frames(2);
  const y1 = await ghostY();
  log('stairs armed: the wheel over a panel scrolls the panel (not taken) and leaves the ghost\'s height alone',
    wheelOk && y0 !== null && y0 === y1, `panel wheel ${wheelOk ? 'free' : 'taken'}, ghost y ${y0} → ${y1}`);
  // …and the wheel over the 3D view raises the ghost by 0.1 m and does NOT zoom the camera as well
  const radius = () => page.evaluate(() => +window.__ahdusScene.activeCamera.radius.toFixed(3));
  const r0 = await radius();
  await page.mouse.wheel(0, -120);
  await wait(300); await frames(2);
  const y2 = await ghostY(); const r1 = await radius();
  log('stairs armed: the wheel over the 3D view lifts the ghost 0.1 m and leaves the camera alone',
    y1 !== null && Math.abs(y2 - y1 - 0.1) < 0.01 && r0 === r1, `ghost y ${y1} → ${y2}, camera radius ${r0} → ${r1}`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await wait(300);

  // ── 6. A drag whose pointer is cancelled ──
  await page.evaluate(() => { window.__ahdusStore.getState().selectObject(null); window.__ahdusStore.getState().selectRoom(null); });
  await page.click('[aria-label="Select"]').catch(() => {});
  await wait(300);
  const before6 = await page.evaluate((id) => { const o = window.__ahdusStore.getState().objects[id]; return { x: o.x, z: o.z }; }, desk);
  const undoBefore = await page.evaluate(() => !document.querySelector('[aria-label="Undo"]')?.disabled
    ? document.querySelector('[aria-label="Undo"]').title : null);
  const dp = await page.evaluate((id) => { const o = window.__ahdusStore.getState().objects[id]; return [o.x, 0.4, o.z]; }, desk);
  const at = await toScreen(...dp);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 10, { steps: 6 });
  await page.mouse.move(at.x + 80, at.y + 20, { steps: 6 });
  await frames(2);
  await page.evaluate(() => {
    const c = window.__ahdusScene.getEngine().getRenderingCanvas();
    c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, pointerType: 'mouse' }));
    c.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true, pointerType: 'mouse' }));
  });
  await page.mouse.move(at.x + 140, at.y + 30, { steps: 4 });
  await page.mouse.up(); // a later release (another pointer's, a stale one) must not finish it
  await wait(300); await frames(2);
  const after6 = await page.evaluate((id) => { const o = window.__ahdusStore.getState().objects[id]; return { x: o.x, z: o.z }; }, desk);
  const undoAfter = await page.evaluate(() => !document.querySelector('[aria-label="Undo"]')?.disabled
    ? document.querySelector('[aria-label="Undo"]').title : null);
  const camOk = await page.evaluate(() => !!window.__ahdusScene.activeCamera.inputs.attachedToElement);
  log('a drag whose pointer is cancelled moves nothing, adds no undo step, and the camera works again',
    after6.x === before6.x && after6.z === before6.z && undoAfter === undoBefore && camOk,
    `desk ${JSON.stringify(before6)} → ${JSON.stringify(after6)}, undo "${undoBefore}" → "${undoAfter}", camera ${camOk ? 'attached' : 'detached'}`);

  // ── 7. The hidden selection bar: no buttons in the Tab order (the selected desk off screen) ──
  await page.evaluate((id) => window.__ahdusStore.getState().selectObject(id), desk);
  await wait(400); await frames(3);
  await page.evaluate(() => {
    const cam = window.__ahdusScene.activeCamera;
    window.__stabCam = { a: cam.alpha, b: cam.beta, r: cam.radius, t: cam.target.clone() };
    cam.target.x += 400; cam.target.z += 400;
  });
  await frames(4);
  const hiddenFocus = await page.evaluate(() => {
    const bar = document.querySelector('.selection-toolbar');
    if (!bar) return { bar: false };
    const hidden = bar.dataset.hidden === 'true';
    const buttons = [...bar.querySelectorAll('button')];
    let focused = 0;
    for (const btn of buttons) { btn.focus(); if (document.activeElement === btn) focused++; }
    document.activeElement?.blur?.();
    return { bar: true, hidden, buttons: buttons.length, focused, inert: bar.inert ?? null };
  });
  log('the hidden selection bar\'s buttons can\'t take the focus', hiddenFocus.bar && hiddenFocus.hidden && hiddenFocus.focused === 0,
    JSON.stringify(hiddenFocus));
  await page.evaluate(() => {
    const cam = window.__ahdusScene.activeCamera; const k = window.__stabCam;
    cam.setTarget(k.t); cam.alpha = k.a; cam.beta = k.b; cam.radius = k.r;
    window.__ahdusStore.getState().selectObject(null);
  });
  await frames(3);

  // ── 2. Tab from Settings ──
  await page.click('[aria-label="Settings"]');
  await wait(300);
  await page.keyboard.press('Tab');
  await wait(400);
  const prev2 = await inPreview();
  const focusInSettings = await page.evaluate(() => !!document.activeElement?.closest('.settings-pop'));
  log('Tab from the Settings button moves the focus into Settings and keeps Studio open', !prev2 && focusInSettings,
    `preview ${prev2}, focus ${focusInSettings ? 'in Settings' : 'elsewhere'}`);
  if (prev2) { await page.click('[aria-label="Back to Studio"]'); await wait(1500); }
  await page.keyboard.press('Escape');
  await wait(300);
  // Tab with the canvas focused still goes to Preview (the mode shortcut)
  const cv = await page.locator('.canvas-card canvas').first().boundingBox();
  await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.9);
  await wait(300);
  await page.keyboard.press('Tab');
  await wait(1500);
  const prevCanvas = await inPreview();
  log('…Tab on the canvas still goes to Preview', prevCanvas, `preview ${prevCanvas}`);
  if (prevCanvas) { await page.keyboard.press('Tab'); await wait(1500); }

  // ── 8. 1024 × 768 with the library and the Inspector open ──
  await page.setViewportSize({ width: 1024, height: 768 });
  await wait(800);
  await page.evaluate((id) => window.__ahdusStore.getState().selectRoom(id), ids.room);
  await page.click('[aria-label="Furniture"]');
  await wait(800); await frames(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1024-panels-open.png` });
  const covered = await page.evaluate(() => {
    const card = document.querySelector('.canvas-card').getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll('.canvas-card button, .canvas-card [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[data-hidden="true"]')) continue;
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const inside = x >= card.left && x <= card.right && y >= card.top && y <= card.bottom && x >= 0 && x <= innerWidth;
      if (!inside || !hit || !(el === hit || el.contains(hit))) {
        out.push(`${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 20)}: ${!inside ? 'outside' : 'under ' + (hit?.getAttribute('aria-label') ?? hit?.className ?? '?')}`);
      }
    }
    return { out, card: Math.round(card.width) };
  });
  log('1024 × 768, library + Inspector open: every canvas control visible and clickable', covered.out.length === 0,
    `canvas ${covered.card} px wide; ${covered.out.join(' | ') || 'all clear'}`);
  await page.click('[aria-label="Furniture"]');
  await page.evaluate(() => window.__ahdusStore.getState().selectRoom(null));

  // ── 3. Phone: More → Settings, Esc ──
  await page.setViewportSize({ width: 390, height: 490 });
  await wait(1000);
  await page.click('header [aria-label="More"]');
  await wait(300);
  await page.locator('[role="menu"][aria-label="More actions"] >> text=Settings').first().click();
  await wait(400);
  await page.keyboard.press('Escape');
  await wait(400);
  const more = await page.locator('[role="menu"][aria-label="More actions"]').isVisible().catch(() => false);
  const settings = await page.locator('.settings-pop').isVisible().catch(() => false);
  log('phone: Esc in More → Settings closes Settings and keeps More open', more && !settings, `More ${more}, Settings ${settings}`);
} catch (e) {
  errs.push('script: ' + (e.stack ?? e.message));
} finally {
  await b.close();
}
