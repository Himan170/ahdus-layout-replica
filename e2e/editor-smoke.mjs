// Workplace Studio smoke test: drives the real editor in Chromium and checks
// the Studio layout (1280×720 and 1920×1080; the AHDUS look in local mode), the empty state and
// first room, the library, placing / deleting / undo, the selection toolbar and Inspector, the
// floor switcher, Preview ↔ Studio, and a phone's hint (390 px). Screenshots go to e2e/screens/.
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

/** Studio layout rule: no page or tool rail scroll, canvas ≥ 75 % wide, the floor switcher + hint on the canvas */
const layoutCheck = () => page.evaluate(() => {
  const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  const doc = document.documentElement;
  const panel = document.querySelector('.build-panel');
  const canvas = r('.canvas-card');
  const footer = r('.canvas-footer');
  return {
    pageScrolls: doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1,
    panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
    canvasShare: canvas.width / innerWidth,
    overlapsFooter: !footer || footer.bottom > canvas.bottom + 0.5 || footer.left < canvas.left - 0.5,
  };
});
/** Drags a library tile (by its name) onto a world point, as a person would with the mouse */
const dragTile = async (name, x, y, z) => {
  const tile = page.locator(`.lib-tile[title^="${name}"]`).first();
  await tile.scrollIntoViewIfNeeded();
  const b = await tile.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const to = await toScreen(x, y, z);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await frames(2);
  await page.mouse.up();
  await frames(3);
};

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
log('1280×720 (AHDUS look in local mode): no page / rail scroll, canvas ≥ 75 % wide, floor switcher on the canvas',
  !L.pageScrolls && !L.panelScrolls && L.canvasShare >= 0.75 && !L.overlapsFooter, JSON.stringify(L));
const labels = ['Undo', 'Redo', 'Settings', 'Select', 'Rooms', 'Walls', 'Doors & Windows', 'Stairs', 'Furniture', 'Layers',
  'Floor switcher', 'Add floor', 'Walk through', 'All layouts', 'Versions', 'Shortcuts', 'Add your first room', '2D view',
  '3D view', 'Plan view', 'Fit view', 'Reset view', 'Top view'];
const missing = [];
for (const l of labels) if (await page.locator(`[aria-label="${l}"]`).count() === 0) missing.push(l);
const studioLook = await page.evaluate(() => ({
  page: getComputedStyle(document.body).backgroundColor,
  rail: !!document.querySelector('.build-panel.tool-rail'),
  brand: document.querySelector('.ahdus-header__brand-text')?.textContent,
  publish: !!document.querySelector('[data-publish]'),
}));
log('every Studio control is there with its label', missing.length === 0, missing.join(', '));
log('local mode has the AHDUS look: light page, tool rail, "All layouts" (no AHDUS brand text, no Publish)',
  studioLook.page === 'rgb(246, 247, 243)' && studioLook.rail && studioLook.brand === 'All layouts' && !studioLook.publish,
  JSON.stringify(studioLook));

// ── Empty state → Add your first room → Office → drag ──
log('a new layout shows the empty state', await visible('text=Build your workplace'));
await shot('studio-empty.png');
// Export floor plan (Anish, S2): nothing to export yet, so the button is disabled and opens no menu
const exportOffEmpty = await page.getAttribute('[aria-label="Export floor plan"]', 'aria-disabled');
await page.click('[aria-label="Export floor plan"]', { force: true }); // (Playwright won't click aria-disabled by itself)
await frames(2);
const exportMenuWhenEmpty = await visible('[role="menu"][aria-label="Export options"]');
await click('[aria-label="Add your first room"]');
log('"Add your first room" opens the Rooms library', await visible('[aria-label="Rooms library"]'));
await shot('studio-library-rooms.png');
await click('[aria-label="Rooms library"] button:has-text("Draw your own size")');
log('"Draw your own size" arms drawing a room; the library stays open',
  await visible('[aria-label="Rooms library"]') &&
  await page.getAttribute('[aria-label="Rooms library"] button:has-text("Draw your own size")', 'aria-pressed') === 'true' &&
  await page.getAttribute('[aria-label="Rooms"]', 'aria-pressed') === 'true');
await dragWorld([-4, 0.02, -3], [2, 0.02, 1]);
let c = await counts();
const firstRoom = await page.evaluate(() => Object.values(window.__ahdusStore.getState().rooms)[0]?.type);
log('dragging on the ground draws the first room (an Office)', c.rooms === 1 && firstRoom === 'OFFICE', JSON.stringify({ ...c, firstRoom }));
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

// ── Room labels: only the name; hovering the room shows its details card; Settings → Room labels ──
const roomLabel = ((await page.locator('.room-label').first().textContent()) ?? '').trim();
log('the room label shows only the room name', /^Office \d+$/.test(roomLabel), roomLabel);
await hover(-1, 0.02, -1); // the room's floor (it spans -4…2 × -3…1)
await page.waitForSelector('.room-hover__card', { timeout: 15000 }).catch(() => {});
const hoverCard = (await page.locator('.room-hover__card').textContent().catch(() => '')) ?? '';
log('hovering a room shows its details card: name, type, size, area, wall height, doors / windows',
  /Office \d/.test(hoverCard) && hoverCard.includes('6 × 4 m') && hoverCard.includes('24.0 m²') &&
  /Walls \d+\.\d m high/.test(hoverCard) && hoverCard.includes('0 doors · 0 windows'), hoverCard);
await shot('studio-room-hover.png');
await page.mouse.down(); // a press (start of a drag) hides it
const cardWhilePressed = await page.locator('.room-hover__card').count();
await page.mouse.up();
await key('Escape'); // the click selected the room: deselect it
log('no hover card while the mouse button is down', cardWhilePressed === 0);
await page.mouse.move(2, 2); // off the canvas
await frames(2);
log('the card goes when the pointer leaves the canvas', await page.locator('.room-hover__card').count() === 0);
await click('[aria-label="Settings"]');
await click('[aria-label="Room labels"] button:has-text("Off")');
const labelsOff = await page.locator('.room-label').count();
const storedOff = await page.evaluate(() => localStorage.getItem('ahdus.roomLabels'));
await click('[aria-label="Room labels"] button:has-text("Names")');
const labelsOn = await page.locator('.room-label').count();
await key('Escape');
log('Settings → Room labels: Off hides the names, Names shows them (kept in this browser)',
  labelsOff === 0 && labelsOn === 1 && storedOff === 'off', JSON.stringify({ labelsOff, labelsOn, storedOff }));

// ── Furniture: drag a tile from the library onto the floor ──
await click('[aria-label="Furniture"]');
await page.fill('[aria-label="Search furniture"]', 'Standard Desk');
await dragTile('Standard Desk', -2.5, 0.02, -1);
c = await counts();
const deskAt0 = await page.evaluate(() => Object.values(window.__ahdusStore.getState().objects)[0]);
log('Furniture library: drag the desk onto the floor: 1 item where it was dropped',
  c.objects === 1 && Math.abs(deskAt0.x + 2.5) < 0.6 && Math.abs(deskAt0.z + 1) < 0.6,
  JSON.stringify({ ...c, x: deskAt0?.x, z: deskAt0?.z }));
let look = await realLook();
log('Realistic look: the desk is the real model, the floor a photo texture',
  look.model === 'desk' && look.floor.startsWith('real_'), JSON.stringify(look));

// ── Click a tile: it is placed in the middle of the view ──
const before = (await counts()).objects;
await page.fill('[aria-label="Search furniture"]', 'Office Chair');
await page.locator('.lib-tile[title^="Office Chair:"]').first().click();
await frames(3);
await key('Escape');
c = await counts();
log('clicking a tile places exactly 1 item (in the middle of the view)', c.objects - before === 1, `added ${c.objects - before}`);
await click('[aria-label="Select"]'); // closes the library

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
// Selecting opens the Inspector, which narrows the plan (150 ms): aim only once it has finished
const inspectorSettled = () => page.waitForFunction(() =>
  [...document.querySelectorAll('.studio-inspector-col')].every((c) => c.getAnimations().length === 0), null, { timeout: 30000 });
// Click and drag at the desk's centre, as a person would: its hook-point badge sits there
await inspectorSettled();
let box = await deskShape.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
const deskPicked = await page.evaluate(() => window.__ahdusStore.getState().selectedObjectId);
await inspectorSettled();
box = await deskShape.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
// (up and to the right: straight to the right its chair stands, and since v0.15.2 a desk can't be put on a chair)
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 70, { steps: 8 });
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
// v0.15.2 (found on a real layout): a desk dragged in Plan view onto the spot where its OWN chair stood
// landed on that chair (Height 1.10 m). The chair moves with it, so it is no surface for it
{
  const chairId = await page.evaluate((d) => {
    const st = window.__ahdusStore.getState();
    // its chair: 0.7 m in front of its work side (+Z), facing it
    return st.addObject({ assetType: 'CHAIR_OFFICE', x: d.x, y: d.y ?? 0.02, z: d.z + 0.7, rotationY: Math.PI, floor: d.floor ?? 0, roomId: d.roomId ?? null }).id;
  }, planDesk);
  await page.waitForTimeout(300);
  await inspectorSettled();
  const chairShape = page.locator(`[data-object-id="${chairId}"] .floor-plan-shape`);
  const from = await deskShape.boundingBox();
  const onto = await chairShape.boundingBox();
  // drag the desk (grabbed off its centre, clear of the chair) north by the distance to its chair
  const dy = (onto.y + onto.height / 2) - (from.y + from.height / 2);
  const gx = from.x + from.width * 0.2;
  const gy = from.y + from.height * 0.75;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx, gy + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(([d, c]) => {
    const o = window.__ahdusStore.getState().objects;
    return { desk: { x: o[d].x, y: o[d].y, z: o[d].z }, chair: { x: o[c].x, y: o[c].y, z: o[c].z } };
  }, [planDesk.id, chairId]);
  const movedZ = after.desk.z - planDesk.z;
  log('v0.15.2 Plan view: a desk dragged onto the old spot of its own chair stays on the floor, and the chair goes along',
    Math.abs(movedZ) > 0.4 && Math.abs(after.desk.y - (planDesk.y ?? 0.02)) < 0.01 &&
    Math.abs((after.chair.z - after.desk.z) - 0.7) < 0.01 && Math.abs(after.chair.x - after.desk.x) < 0.01,
    `desk z ${planDesk.z} → ${after.desk.z}, height ${after.desk.y}; chair z ${after.chair.z}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await page.evaluate((id) => window.__ahdusStore.getState().removeObject?.(id) ?? window.__ahdusStore.getState().deleteObject?.(id), chairId);
  await page.waitForTimeout(200);
}
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
await click('[aria-label="Walk through"]');
await page.waitForTimeout(800);
log('Walk through opens Preview', await visible('[aria-label="Back to Studio"]') && !(await visible('[aria-label="Floor switcher"]')));
await shot('preview-hud.png');
await page.evaluate(() => document.exitPointerLock()); // what Esc does: get the mouse back
await page.waitForTimeout(300);
await click('[aria-label="Back to Studio"]');
log('Back to Studio returns', await visible('[aria-label="Floor switcher"]'));
await page.keyboard.press('Tab'); await page.waitForTimeout(800); await frames(2);
const inPreview = await visible('[aria-label="Back to Studio"]');
await page.keyboard.press('Tab'); await page.waitForTimeout(800); await frames(2);
log('Tab goes to Preview and back', inPreview && await visible('[aria-label="Floor switcher"]'));

// ── H (v0.16.0): Studio's editor = Reset view; Walk through = wave (Studio walks as the simple figure: nothing) ──
const camNow = () => page.evaluate(() => {
  const c = window.__ahdusScene.activeCamera;
  return { a: +c.alpha.toFixed(3), b: +c.beta.toFixed(3), r: +c.radius.toFixed(2) };
});
await key('h'); await page.waitForTimeout(900); await frames(3);
const home = await camNow();
await page.evaluate(() => { const c = window.__ahdusScene.activeCamera; c.alpha += 1.1; c.radius *= 1.6; });
await frames(2);
const turned = await camNow();
await page.mouse.move(640, 360);
await key('h'); await page.waitForTimeout(900); await frames(3);
const afterH = await camNow();
const near = (p, q) => Math.abs(p.a - q.a) < 0.05 && Math.abs(p.r - q.r) < 0.5;
await click('[aria-label="Walk through"]');
await page.waitForTimeout(800);
await key('h'); await page.waitForTimeout(300);
const hintAfter = await page.locator('.preview-hud, [data-hud]').allTextContents().catch(() => []);
const stillWalking = await visible('[aria-label="Back to Studio"]');
await page.evaluate(() => document.exitPointerLock());
await page.waitForTimeout(300);
await click('[aria-label="Back to Studio"]');
log('H: Studio\'s editor resets the view; in Walk through (the simple figure) it does nothing',
  !near(turned, home) && near(afterH, home) && stillWalking && !hintAfter.join(' ').includes('wave'),
  JSON.stringify({ home, turned, afterH, stillWalking }));

// ── Layout at 1920×1080 ──
await page.setViewportSize({ width: 1920, height: 1080 });
await frames(3);
L = await layoutCheck();
log('1920×1080: no page / rail scroll, canvas ≥ 75 % wide, floor switcher on the canvas',
  !L.pageScrolls && !L.panelScrolls && L.canvasShare >= 0.75 && !L.overlapsFooter, JSON.stringify(L));

// ── A phone (390 px): the "Drag to turn…" hint hides under a bottom sheet and after the first touch ──
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400); await frames(3);
const hintText = () => page.evaluate(() => document.querySelector('[data-studio="hint"]')?.textContent ?? null);
const phoneHint = await hintText();
await shot('studio-phone.png');
await click('[aria-label="Rooms"]');
const hintUnderSheet = await hintText();
await click('[aria-label="Close the library"]');
const hintSheetClosed = await hintText();
const cv = await page.locator('canvas').boundingBox();
await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height * 0.75); // the first touch on the view
await frames(3);
await key('Escape'); // whatever it selected: deselect (the Inspector sheet goes)
const hintAfterTouch = await hintText();
const offScreen = await page.evaluate(() => [...document.querySelectorAll('button, [role="status"]')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length);
log('phone: "Drag to turn…" shows, hides under the library sheet, comes back, hides for good after a touch',
  /^Drag to turn/.test(phoneHint ?? '') && hintUnderSheet === '' && /^Drag to turn/.test(hintSheetClosed ?? '') &&
  hintAfterTouch === '' && offScreen === 0,
  JSON.stringify({ phoneHint, hintUnderSheet, hintSheetClosed, hintAfterTouch, offScreen }));

log('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
