// Workplace Studio smoke test: drives the real editor in Chromium and checks
// the Studio layout (1280×720 and 1920×1080), the empty state and first room,
// placing / deleting / undo, the selection toolbar and Inspector, the floor
// switcher, and Preview ↔ Studio. Saves the UI_SPEC screenshots to e2e/screens/.
//
// One-time setup:   npm install && npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:planner    (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screens', { recursive: true });

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary

const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS - ')) errors.push('console: ' + m.text()); });
// The realistic look's files (models, textures, sky): none may be missing
const assetProblems = [];
page.on('response', (r) => { if (r.url().includes('/assets/') && r.status() >= 400) assetProblems.push(`${r.status()} ${r.url()}`); });
page.on('console', (m) => { if (m.text().includes('[realistic look]')) assetProblems.push(m.text()); });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => { for (const e of errors.slice(0, 6)) console.log('ERR ' + e.slice(0, 300)); for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`); });

const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const key = async (k) => { await page.keyboard.press(k); await frames(3); };
const shot = (name) => page.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const state = () => page.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return {
    rooms: Object.values(s.rooms).filter((r) => r.floor === s.currentFloor).length,
    objects: Object.values(s.objects).filter((o) => o.floor === s.currentFloor).length,
    floors: Object.values(s.floors).map((f) => f.name),
    currentFloor: s.currentFloor,
    selectedObjectId: s.selectedObjectId,
  };
});
const counts = async () => { const s = await state(); return { rooms: s.rooms, objects: s.objects }; };
// The desk's look (its child mesh names the real model, if it is one) and the floor's material
const realLook = () => page.evaluate(async () => {
  await window.__ahdusAssets.whenLoaded();
  await new Promise((r) => setTimeout(r, 200));
  const sc = window.__ahdusScene;
  const desk = Object.values(window.__ahdusStore.getState().objects).find((o) => o.assetType === 'DESK_STANDARD');
  const mesh = sc.meshes.find((m) => m.parent?.metadata?.objectId === desk?.id && m.metadata?.objectId === desk?.id);
  const floor = sc.meshes.find((m) => m.metadata?.part === 'floor' && m.isEnabled());
  const mats = floor?.material?.subMaterials ?? [floor?.material];
  return { objectId: mesh?.metadata?.objectId ?? null, model: mesh?.metadata?.model ?? null, floor: mats.map((m) => m?.name).join(',') };
});
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const click = async (sel) => { await page.click(sel); await frames(2); };

// World point → page pixel (through the active camera)
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
const hover = async (x, y, z) => {
  // let the Inspector finish opening/closing (the canvas changes size) before aiming
  await page.waitForTimeout(250); await frames(1);
  const s = await toScreen(x, y, z);
  await page.mouse.move(s.x - 3, s.y - 3);
  await page.mouse.move(s.x, s.y, { steps: 3 });
  await frames(2);
};
const clickAt = async (x, y, z) => { await hover(x, y, z); await page.mouse.down(); await page.mouse.up(); await frames(3); };
const dragWorld = async (from, to) => {
  await hover(...from);
  await page.mouse.down();
  const s = await toScreen(...to);
  await page.mouse.move(s.x, s.y, { steps: 10 });
  await frames(2);
  await page.mouse.up();
  await frames(3);
};

/** UI_SPEC 8: no page or Build panel scroll, canvas ≥ 75 % wide, nothing overlaps the footer */
const layoutCheck = () => page.evaluate(() => {
  const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  const doc = document.documentElement;
  const panel = document.querySelector('.build-panel');
  const canvas = r('.canvas-card');
  const footer = r('.studio-footer');
  const build = r('.build-panel');
  return {
    pageScrolls: doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1,
    panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
    canvasShare: canvas.width / innerWidth,
    overlapsFooter: canvas.bottom > footer.top + 0.5 || build.bottom > footer.top + 0.5,
  };
});

// ── Open a new layout ──
await page.goto(url);
await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await page.fill('input[placeholder="Company name…"]', 'Test Co');
await page.click('button:has-text("Create")');
await page.waitForTimeout(400);
if (await page.locator('input[placeholder="Layout name…"]').count() === 0) {
  await page.click('button:has-text("Test Co")');
  await page.waitForTimeout(300);
}
await page.fill('input[placeholder="Layout name…"]', 'HQ Layout');
await page.click('button:has-text("Create")');
await page.waitForSelector('canvas', { timeout: 90000 });
await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await page.waitForSelector('[aria-label="Add your first room"]', { timeout: 30000 });
await frames(3);

// ── Layout at 1280×720 ──
let L = await layoutCheck();
log('1280×720: no page / Build panel scroll, canvas ≥ 75 % wide, footer clear',
  !L.pageScrolls && !L.panelScrolls && L.canvasShare >= 0.75 && !L.overlapsFooter, JSON.stringify(L));
const labels = ['Undo', 'Redo', 'Settings', 'Select', 'Rooms', 'Walls', 'Doors & Windows', 'Stairs', 'Furniture', 'Layers',
  'Floor switcher', 'Preview Workplace', 'Add your first room', '2D view', '3D view', 'Fit view'];
const missing = [];
for (const l of labels) if (await page.locator(`[aria-label="${l}"]`).count() === 0) missing.push(l);
log('every Studio control is there with its label', missing.length === 0, missing.join(', '));

// ── Empty state → Add your first room → Office → drag ──
log('a new layout shows the empty state', await visible('text=Build your workplace'));
await shot('studio-empty.png');
// Export floor plan (Anish, S2): nothing to export yet, so the button is disabled and opens no menu
const exportOffEmpty = await page.getAttribute('[aria-label="Export floor plan"]', 'aria-disabled');
await page.click('[aria-label="Export floor plan"]', { force: true }); // (Playwright won't click aria-disabled by itself)
await frames(2);
const exportMenuWhenEmpty = await visible('[role="menu"][aria-label="Export options"]');
await click('[aria-label="Add your first room"]');
log('"Add your first room" opens the Rooms tray', await visible('[role="dialog"][aria-label="Rooms options"]'));
await shot('studio-tray-rooms.png');
await click('[aria-label="Rooms options"] button:has-text("Office")');
log('picking Office closes the tray and arms Rooms · Office',
  !(await visible('[aria-label="Rooms options"]')) && /Office/.test(await page.locator('[aria-label="Rooms"]').textContent()));
await dragWorld([-4, 0.02, -3], [2, 0.02, 1]);
let c = await counts();
log('dragging on the ground draws the first room', c.rooms === 1, JSON.stringify(c));
log('the empty state is gone', !(await visible('text=Build your workplace')));
// …with a room: Export floor plan → PNG downloads a .png, → PDF downloads a .pdf
const exportAs = async (item) => {
  await click('[aria-label="Export floor plan"]');
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
    page.click(`[role="menu"][aria-label="Export options"] button:has-text("${item}")`),
  ]);
  return file?.suggestedFilename() ?? 'no download';
};
const planPng = await exportAs('Export PNG');
const planPdf = await exportAs('Export PDF');
log('Export floor plan: disabled with no rooms; with a room PNG downloads a .png and PDF a .pdf',
  exportOffEmpty === 'true' && !exportMenuWhenEmpty && /\.png$/.test(planPng) && /\.pdf$/.test(planPdf),
  JSON.stringify({ exportOffEmpty, exportMenuWhenEmpty, planPng, planPdf }));
await key('Control+z');
c = await counts();
log('Ctrl+Z removes the room', c.rooms === 0, JSON.stringify(c));
await key('Control+y');
c = await counts();
log('Ctrl+Y brings the room back', c.rooms === 1, JSON.stringify(c));
await key('Escape'); // back to Select
await key('Escape'); // deselect the room
// Top-down from here, so walls never hide what the test clicks
await click('[aria-label="2D view"]');
await click('[aria-label="Fit view"]');
await frames(6);

// ── Furniture: pick a card, click the floor ──
await click('[aria-label="Furniture"]');
await page.locator('[title^="Standard Desk"]').first().click();
await clickAt(-2.5, 0.02, -1);
c = await counts();
log('Furniture tray: pick a desk, click the floor: 1 item', c.objects === 1, JSON.stringify(c));
await key('Escape');
let look = await realLook();
log('Realistic look: the desk is the real model, the floor a photo texture',
  look.model === 'desk' && look.floor.startsWith('real_'), JSON.stringify(look));

// ── Drag a card onto the canvas, then click ──
await click('[aria-label="Furniture"]');
const before = (await counts()).objects;
const target = await toScreen(0.5, 0.02, -1);
await page.evaluate(({ x, y }) => {
  const card = document.querySelector('[title^="Office Chair"]');
  const canvas = document.querySelector('canvas');
  const dt = new DataTransfer();
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
}, target);
await frames(2);
await clickAt(0.5, 0.02, -1);
c = await counts();
log('drag a card onto the canvas + click places exactly 1 item', c.objects - before === 1, `added ${c.objects - before}`);
await key('Escape');

// ── Undo placement ──
const n = (await counts()).objects;
await key('Control+z');
c = await counts();
log('Ctrl+Z undoes the last placement', c.objects === n - 1, JSON.stringify(c));
await key('Control+y');
await key('Escape');

// ── Select the desk: floating toolbar + Inspector; Esc / X close both ──
await clickAt(-2.5, 0.4, -1);
let st = await state();
const deskSelected = !!st.selectedObjectId;
await frames(4);
log('selecting an item shows the floating toolbar and the Inspector', deskSelected &&
  await visible('[role="toolbar"][aria-label="Item actions"]') && await visible('aside[aria-label="Inspector"]'),
  `selected=${st.selectedObjectId}`);
await click('[aria-label="3D view"]');
await click('[aria-label="Fit view"]');
await frames(8);
await shot('studio-selected.png');
await click('[aria-label="2D view"]');
await frames(4);
await key('Escape');
log('Esc closes both', !(await visible('[aria-label="Item actions"]')) && !(await visible('aside[aria-label="Inspector"]')));
await clickAt(-2.5, 0.4, -1);
await click('[aria-label="Close inspector"]');
log('X closes both', !(await visible('[aria-label="Item actions"]')) && !(await visible('aside[aria-label="Inspector"]')));

// ── Delete + undo ──
await clickAt(-2.5, 0.4, -1);
const objsBefore = (await counts()).objects;
await key('Delete');
const afterDelete = (await counts()).objects;
log('Delete removes the selected item', afterDelete === objsBefore - 1, `${objsBefore} -> ${afterDelete}`);
await key('Control+z');
c = await counts();
log('Ctrl+Z restores it', c.objects === objsBefore, JSON.stringify(c));

// ── Inspector via Layers: change X, undo, then type a name: X must stay at the undone value ──
await click('[aria-label="Layers"]');
await click('.layers-list__item:has-text("Standard Desk")');
const xInput = page.locator('aside[aria-label="Inspector"] input[aria-label="X"]');
const x0 = await xInput.inputValue();
await xInput.fill('5');
await page.waitForTimeout(200);
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('Control+z');
await frames(3);
const xAfterUndo = await xInput.inputValue();
await page.locator('aside[aria-label="Inspector"] input[aria-label="Name"]').fill('Reception desk A');
await frames(2);
const xAfterLabel = await xInput.inputValue();
log('Layers selects the desk; Inspector shows the undone X', xAfterUndo === x0, `before=${x0} afterUndo=${xAfterUndo}`);
log('typing a name does not move the item back', xAfterLabel === x0, `afterLabel=${xAfterLabel}`);
await page.evaluate(() => document.activeElement.blur());
await click('[aria-label="Close inspector"]');

// ── Plan view: Enter selects a room, click selects the desk, drag moves it, Ctrl+Z puts it back ──
const was3D = await page.evaluate(() => window.__ahdusStore.getState().is3D);
await click('[aria-label="Plan view"]');
const planShown = await page.waitForSelector('.floor-plan-svg', { timeout: 10000 }).then(() => true).catch(() => false);
await page.focus('.floor-plan-room');
await page.keyboard.press('Enter');
const roomByKey = await page.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
const planDesk = await page.evaluate(() =>
  Object.values(window.__ahdusStore.getState().objects).find((o) => o.assetType === 'DESK_STANDARD'));
const deskShape = page.locator(`[data-object-id="${planDesk.id}"] .floor-plan-shape`);
await deskShape.click();
const deskPicked = await page.evaluate(() => window.__ahdusStore.getState().selectedObjectId);
const box = await deskShape.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const deskAt = () => page.evaluate((id) => { const o = window.__ahdusStore.getState().objects[id]; return { x: o.x, z: o.z }; }, planDesk.id);
const moved = await deskAt();
await shot('plan-view.png');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
const undone = await deskAt();
log('Plan view: Enter selects a room, click selects the desk, dragging moves it (snapped), Ctrl+Z puts it back',
  planShown && !!roomByKey && deskPicked === planDesk.id && moved.x > planDesk.x && moved.x % 0.5 === 0 &&
  undone.x === planDesk.x && undone.z === planDesk.z,
  `room=${!!roomByKey} x ${planDesk.x} → ${moved.x} → ${undone.x}`);
await click(was3D ? '[aria-label="3D view"]' : '[aria-label="2D view"]');
await page.keyboard.press('Escape'); await frames(2);

// ── Floor switcher: add, switch, rename, delete, undo ──
await click('[aria-label="Floor switcher"]');
await click('[aria-label="Add floor above"]');
await click('[aria-label="Empty floor"]');      // the other choice copies the rooms below
st = await state();
log('Add floor above adds a floor', st.floors.length === 2, JSON.stringify(st.floors));
await click('[aria-label="Floor switcher"]');
await shot('studio-floor-menu.png');
await click('[role="menuitemradio"]:has-text("Floor 1")');
st = await state();
log('the menu switches floors', st.currentFloor === 1 && /Floor 1/.test(await page.locator('[aria-label="Floor switcher"]').textContent()));
await click('[aria-label="Floor switcher"]');
await click('[role="menuitem"][aria-label="Rename"]');
await page.fill('input[aria-label="Floor name"]', 'Mezzanine');
await key('Enter');
st = await state();
log('Rename renames the floor', st.floors.includes('Mezzanine'), JSON.stringify(st.floors));
await click('[aria-label="Floor switcher"]');
await click('[role="menuitem"][aria-label="Delete floor"]');
await click('[role="alertdialog"] button:has-text("Delete floor")');
st = await state();
log('Delete floor (after confirming) removes it', st.floors.length === 1 && st.currentFloor === 0, JSON.stringify(st.floors));
await key('Control+z');
st = await state();
log('Ctrl+Z brings the floor back', st.floors.includes('Mezzanine'), JSON.stringify(st.floors));
await page.evaluate(() => window.__ahdusStore.getState().selectFloor(0));
await frames(2);
await click('[aria-label="Floor switcher"]');
const groundDelete = page.locator('[role="menuitem"][aria-label="Delete floor"]');
const groundDisabled = await groundDelete.getAttribute('aria-disabled');
const groundTip = await groundDelete.getAttribute('title');
await groundDelete.click({ force: true }); await frames(2); // Playwright won't click a disabled item by itself
st = await state();
log('the Delete button is disabled on the Ground Floor',
  groundDisabled === 'true' && /ground floor can't be deleted/.test(groundTip ?? '') &&
  !(await visible('[role="alertdialog"][aria-label="Delete floor"]')) && st.floors.length === 2,
  `aria-disabled=${groundDisabled} title=${groundTip}`);
await key('Escape');

// ── Settings: Export layout downloads a backup file ──
await click('[aria-label="Settings"]');
const [studioDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
  page.click('[aria-label="Export layout"]'),
]);
log('Settings → Export layout downloads "HQ Layout.ahdus.json"', studioDownload?.suggestedFilename() === 'HQ Layout.ahdus.json',
  studioDownload?.suggestedFilename() ?? 'no download');

// ── Settings: Realistic look off = the simple models and materials, on again = the real ones ──
await click('[aria-label="Settings"]');
await click('[aria-label="Realistic look"]');
const off = await realLook();
const offChecked = await page.getAttribute('[aria-label="Realistic look"]', 'aria-checked');
const stored = await page.evaluate(() => localStorage.getItem('ahdus.realisticLook'));
log('Realistic look off: the desk is the simple model again, the floor procedural (kept in this browser)',
  off.model === null && off.objectId && off.floor.startsWith('mat_') && offChecked === 'false' && stored === 'off',
  JSON.stringify({ ...off, offChecked, stored }));
await click('[aria-label="Realistic look"]');
look = await realLook();
log('Realistic look on again: the real model and textures are back', look.model === 'desk' && look.floor.startsWith('real_'),
  JSON.stringify(look));
await click('[aria-label="Settings"]');
log('no missing asset files (models, textures, sky)', assetProblems.length === 0, assetProblems.slice(0, 3).join(' | '));

// ── Preview ↔ Studio, with the buttons and with Tab ──
await page.mouse.move(640, 360);
await click('[aria-label="Preview Workplace"]');
await page.waitForTimeout(800);
log('Preview Workplace opens Preview', await visible('[aria-label="Back to Studio"]') && !(await visible('[aria-label="Floor switcher"]')));
await shot('preview-hud.png');
await page.evaluate(() => document.exitPointerLock()); // what Esc does: get the mouse back
await page.waitForTimeout(300);
await click('[aria-label="Back to Studio"]');
log('Back to Studio returns', await visible('[aria-label="Floor switcher"]'));
await page.keyboard.press('Tab'); await page.waitForTimeout(800); await frames(2);
const inPreview = await visible('[aria-label="Back to Studio"]');
await page.keyboard.press('Tab'); await page.waitForTimeout(800); await frames(2);
log('Tab goes to Preview and back', inPreview && await visible('[aria-label="Floor switcher"]'));

// ── Layout at 1920×1080 ──
await page.setViewportSize({ width: 1920, height: 1080 });
await frames(3);
L = await layoutCheck();
log('1920×1080: no page / Build panel scroll, canvas ≥ 75 % wide, footer clear',
  !L.pageScrolls && !L.panelScrolls && L.canvasShare >= 0.75 && !L.overlapsFooter, JSON.stringify(L));

log('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
