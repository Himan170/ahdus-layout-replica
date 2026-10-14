// Save smoke test: layouts are saved and open again.
//   - the name typed when creating a layout is kept, renaming updates the list
//   - building auto-saves (header: Saving… → Saved), also floors
//   - back to the list → reopen: the room is there (this used to show a blank page)
//   - closing the tab right after a change still saves it
//   - a save from an older version of the app opens
//   - the list shows last edit, rooms and floors; deleting asks first
//   - if the editor fails, a message with "Back to layouts" (never a blank page)
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev          (in one terminal)
//                   npm run e2e:save     (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
mkdirSync('e2e/screens', { recursive: true });

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
let expectErrors = false; // the deliberate crash below logs errors on purpose
p.on('pageerror', (e) => { if (!expectErrors) errs.push('pageerror: ' + e.message); });
p.on('console', (m) => { if (!expectErrors && m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
});

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  if (!sc) { res(); return; }
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const status = () => p.locator('.studio-header__status').textContent({ timeout: 5000 }).catch(() => '');
const waitStatus = async (text, ms = 30000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { if ((await status()).startsWith(text)) return true; await wait(250); }
  return false;
};
/** The saved copy of a layout, straight from localStorage. */
const saved = (layoutId) => p.evaluate((id) => {
  const key = Object.keys(localStorage).find((k) => k.endsWith('_' + id));
  return key ? JSON.parse(localStorage.getItem(key)) : null;
}, layoutId);
const layoutId = () => p.evaluate(() => window.__ahdusStore.getState().layoutId);
const openEditor = async () => { await p.waitForSelector('canvas', { timeout: 90000 }); await frames(3); };
const layoutRow = (name) => p.locator(`button[aria-label="Open ${name}"]`);

// World point → page pixel (through the active camera)
const toScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
const dragWorld = async (from, to) => {
  const a = await toScreen(...from);
  await p.mouse.move(a.x, a.y, { steps: 2 }); await frames(2);
  await p.mouse.down();
  const c = await toScreen(...to);
  await p.mouse.move(c.x, c.y, { steps: 10 }); await frames(2);
  await p.mouse.up(); await frames(3);
};

// ── Create a layout with a typed name ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Save Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Head Office');
await p.press('input[placeholder="Layout name…"]', 'Enter');
await openEditor();
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
const id = await layoutId();
log('the typed name is the layout name', (await p.locator('.studio-header__name').textContent()).includes('Head Office'));
log('a new layout says Saved', await waitStatus('Saved'), await status());

// ── Build a room with the Studio tool: auto-saved ──
await p.click('[aria-label="2D view"]'); await frames(4);
await p.click('[aria-label="Rooms"]'); await frames(2);
await p.click('[aria-label="Rooms options"] button:has-text("Office")'); await frames(2);
await dragWorld([-3, 0.02, -2], [3, 0.02, 2]);
// right after a change (before the 1 s debounce) the header says Saving…
const statusAfterChange = await p.evaluate(async () => {
  window.__ahdusStore.getState().renameFloor(0, 'Ground');
  await new Promise((r) => setTimeout(r, 50));
  return document.querySelector('.studio-header__status').textContent;
});
log('building shows Saving… then Saved', statusAfterChange === 'Saving…' && await waitStatus('Saved'), `${statusAfterChange} → ${await status()}`);
let data = await saved(id);
log('the room is in the saved layout', data?.rooms?.length === 1 && Math.abs(data.rooms[0].width - 6) < 0.01, `${data?.rooms?.length} rooms`);

// ── Adding a floor is saved too (it used to wait for the next room change) ──
await p.click('[aria-label="Floor switcher"]'); await frames(1);
await p.click('[aria-label="Add floor above"]'); await frames(1);
await p.click('[aria-label="Empty floor"]'); await frames(3);
await waitStatus('Saved');
data = await saved(id);
log('adding a floor is auto-saved', Object.keys(data?.floors ?? {}).length === 2, `${Object.keys(data?.floors ?? {}).length} floors saved`);
await p.evaluate(() => window.__ahdusStore.getState().selectFloor(0)); await frames(2);

// ── Rename in the header ──
await p.click('.studio-header__name');
await p.fill('[aria-label="Layout name"]', 'HQ North');
await p.press('[aria-label="Layout name"]', 'Enter'); await frames(2);
log('renaming saves the new name', (await saved(id))?.layoutName === 'HQ North');

// ── Preview and back: still saved ──
await p.click('[aria-label="Preview Workplace"]'); await wait(800);
await p.keyboard.press('Tab'); // back to Studio (clicks would go to the captured canvas)
await frames(3);
log('after Preview and back, the header says Saved', await waitStatus('Saved'), await status());

// ── Back to the list: the name, rooms, floors and last edit ──
await p.click('[aria-label="All layouts"]');
await p.waitForSelector('text=Workspace Layouts', { timeout: 30000 });
const meta = await p.locator(`[data-layout-id="${id}"] [data-layout-meta]`).textContent().catch(() => '');
log('back goes to this company\'s layout list, with the new name', await layoutRow('HQ North').count() === 1);
log('the list shows last edit, rooms and floors (not "v1")', /Edited .+ · 1 room · 2 floors/.test(meta) && !/v1/.test(meta), meta);

// ── Reopen: the room is there (this was the blank page) ──
await layoutRow('HQ North').click();
await openEditor();
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await frames(4);
const reopened = await p.evaluate(() => {
  const st = window.__ahdusStore.getState();
  return {
    rooms: Object.keys(st.rooms).length,
    floors: Object.keys(st.floors).length,
    meshes: window.__ahdusScene.transformNodes.filter((t) => t.name.startsWith('room_') && t.isEnabled()).length,
    blank: !document.querySelector('[aria-label="Build"]'),
  };
});
log('reopening the layout shows its room (no blank page)', reopened.rooms === 1 && reopened.meshes === 1 && !reopened.blank,
  JSON.stringify(reopened));
log('reopened: name and floors are kept', (await p.locator('.studio-header__name').textContent()).includes('HQ North') && reopened.floors === 2);
await p.click('[aria-label="Fit view"]'); await wait(600); await frames(3);
await shot('s1-reopened-layout.png');

// ── Closing the tab right after a change still saves it ──
await p.evaluate(() => window.__ahdusStore.getState().addRoom({ type: 'MEETING', x: 8, z: 0, width: 4, depth: 4, floor: 0 }));
await p.reload();
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
data = await saved(id);
log('a change just before closing the tab is saved', data?.rooms?.length === 2, `${data?.rooms?.length} rooms`);

// ── A save from an older version of the app (no floors, anchorData, door height) ──
await p.evaluate(() => {
  const company = JSON.parse(localStorage.getItem('dwtwin_companies')).find((c) => c.name === 'Save Co');
  localStorage.setItem(`dwtwin_${company.id}_layout_old_1`, JSON.stringify({
    layoutName: 'Old Layout', layoutVersion: 1,
    rooms: [{ id: 'room_1', type: 'OFFICE', name: 'Office 1', x: 0, z: 0, width: 6, depth: 4, isSelected: true,
      doors: [{ wall: 'south', offset: 0, width: 1.2 }] }],
    objects: [{ id: 'obj_1', assetType: 'DESK_STANDARD', x: 1, z: 0 }],
  }));
});
await p.click('button:has-text("Save Co")');
await p.waitForSelector('text=Workspace Layouts', { timeout: 30000 });
log('an old save is listed', await layoutRow('Old Layout').count() === 1);
await layoutRow('Old Layout').click();
await openEditor(); await frames(3);
const old = await p.evaluate(() => {
  const st = window.__ahdusStore.getState();
  return { rooms: Object.keys(st.rooms).length, door: Object.values(st.rooms)[0]?.doors?.[0], floors: Object.keys(st.floors).length };
});
log('an old save opens, with defaults filled in', old.rooms === 1 && old.door?.height === 2.1 && old.floors === 1, JSON.stringify(old));

// ── If the editor fails: a message and "Back to layouts", never a blank page ──
await p.click('[aria-label="All layouts"]');
await p.waitForSelector('text=Workspace Layouts', { timeout: 30000 });
expectErrors = true;
await p.evaluate(() => { window.__ahdusCrashOnOpen = true; });
await layoutRow('Old Layout').click();
const card = await p.waitForSelector('text=This layout could not be opened', { timeout: 30000 }).then(() => true).catch(() => false);
await shot('s2-could-not-open.png');
log('a failing editor shows "This layout could not be opened"', card);
await p.evaluate(() => { window.__ahdusCrashOnOpen = false; });
await p.click('button:has-text("Back to layouts")');
const backToList = await p.waitForSelector('text=Workspace Layouts', { timeout: 30000 }).then(() => true).catch(() => false);
expectErrors = false;
log('"Back to layouts" goes back to the list', backToList);

// ── Delete asks first ──
await p.click('button[aria-label="Delete Old Layout"]');
const asked = await p.locator('[role="alertdialog"]').count() === 1;
await p.click('[role="alertdialog"] button:has-text("Cancel")');
log('delete asks for confirmation; Cancel keeps it', asked && await layoutRow('Old Layout').count() === 1);
await p.click('button[aria-label="Delete Old Layout"]');
await p.click('[role="alertdialog"] button:has-text("Delete")');
await wait(300);
const gone = await p.evaluate(() => !Object.keys(localStorage).some((k) => k.endsWith('_layout_old_1')));
log('Delete removes it from the list and from storage', await layoutRow('Old Layout').count() === 0 && gone);
await shot('s3-layout-list.png');

// ── Backup: export a layout, delete it, import the file: the rooms are back ──
const roomsBefore = (await saved(id))?.rooms?.length;
const [download] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('button[aria-label="Export HQ North"]')]);
const file = await download.path();
log('Export downloads "HQ North.ahdus.json"', download.suggestedFilename() === 'HQ North.ahdus.json' && !!file, download.suggestedFilename());
await p.click('button[aria-label="Delete HQ North"]');
await p.click('[role="alertdialog"] button:has-text("Delete")');
await wait(300);
const deleted = await layoutRow('HQ North').count() === 0;
await p.setInputFiles('input[aria-label="Import layout file"]', file);
await p.waitForSelector('button[aria-label="Open HQ North"]', { timeout: 30000 }).catch(() => {});
const importedMeta = await p.locator('button[aria-label="Open HQ North"] [data-layout-meta]').textContent().catch(() => '');
await layoutRow('HQ North').click();
await openEditor();
const back = await p.evaluate(() => Object.keys(window.__ahdusStore.getState().rooms).length);
log('Delete, then Import the file: the layout and its rooms are back', deleted && back === roomsBefore && back === 2 &&
  /2 rooms · 2 floors/.test(importedMeta), `${back} of ${roomsBefore} rooms · "${importedMeta}"`);
await p.click('[aria-label="All layouts"]');
await p.waitForSelector('text=Workspace Layouts', { timeout: 30000 });

// ── Companies: rename, delete (asks first, and takes its layouts with it) ──
await p.click('button:has-text("All companies")');
await p.waitForSelector('text=New company', { timeout: 30000 });
await shot('s5-companies.png');
await p.click('button[aria-label="Rename company Save Co"]');
await p.fill('input[aria-label="Company name"]', 'Save Company');
await p.press('input[aria-label="Company name"]', 'Enter');
log('a company can be renamed', await p.locator('button:has-text("Save Company")').count() === 1 &&
  await p.locator('button:has-text("Save Co")').count() === 1);
await p.click('button[aria-label="Delete company Save Company"]');
const companyAsk = await p.locator('[role="alertdialog"]').textContent().catch(() => '');
await p.click('[role="alertdialog"] button:has-text("Cancel")');
const keptAfterCancel = await p.locator('button:has-text("Save Company")').count() === 1;
await p.click('button[aria-label="Delete company Save Company"]');
await p.click('[role="alertdialog"] button:has-text("Delete")');
await wait(300);
const companyGone = await p.evaluate((layoutId) => !Object.keys(localStorage).some((k) => k.endsWith('_' + layoutId)) &&
  !JSON.parse(localStorage.getItem('dwtwin_companies')).some((c) => c.name === 'Save Company'), id);
log('deleting a company asks first (naming its layouts), then removes it and its layouts',
  /Save Company.+layout/.test(companyAsk) && keptAfterCancel && companyGone &&
  await p.locator('button:has-text("Save Company")').count() === 0, companyAsk);

// ── Two tabs on one layout (two pages in one browser context share localStorage) ──
const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
const tab = async () => {
  const t = await ctx.newPage();
  t.on('pageerror', (e) => errs.push('pageerror (tab): ' + e.message));
  t.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push('tab: ' + m.text()); });
  await t.goto(url);
  await t.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  return t;
};
const opened = async (t) => {
  await t.waitForSelector('canvas', { timeout: 90000 });
  await t.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
};
const until = async (fn, ms = 30000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await fn()) return true; await wait(250); }
  return false;
};
const shown = (t, label) => t.locator(`[aria-label="${label}"]`).isVisible().catch(() => false);
const roomNames = (t) => t.evaluate(() => Object.values(window.__ahdusStore.getState().rooms).map((r) => r.name).sort());
const addRoomIn = (t, name, x) => t.evaluate(([name, x]) =>
  window.__ahdusStore.getState().addRoom({ type: 'OFFICE', name, x, z: 0, width: 4, depth: 4, floor: 0 }), [name, x]);
const savedIn = (t, id) => t.evaluate((id) => {
  const key = Object.keys(localStorage).find((k) => k.endsWith('_' + id));
  return key ? JSON.parse(localStorage.getItem(key)) : null;
}, id);
const tabStatus = (t) => t.locator('.studio-header__status').textContent({ timeout: 5000 }).catch(() => '');

const tA = await tab();
await tA.fill('input[placeholder="Company name…"]', 'Tabs Co'); await tA.click('button:has-text("Create")'); await tA.waitForTimeout(400);
await tA.fill('input[placeholder="Layout name…"]', 'Shared');
await tA.press('input[placeholder="Layout name…"]', 'Enter');
await opened(tA);
const sharedId = await tA.evaluate(() => window.__ahdusStore.getState().layoutId);
const tB = await tab();
await tB.click('button:has-text("Tabs Co")');
await tB.locator('button[aria-label="Open Shared"]').click();
await opened(tB);
log('two tabs: opening a layout that is open in another tab says "Also open in another tab"',
  await until(() => shown(tB, 'Also open in another tab')) && await until(() => shown(tA, 'Also open in another tab')));

await addRoomIn(tA, 'Room A', 0);
await until(async () => (await savedIn(tA, sharedId))?.rooms?.length === 1);
log('two tabs: when tab A saves, tab B says "changed in another tab" at once',
  await until(() => shown(tB, 'Changed in another tab'), 10000));
await tB.screenshot({ path: 'e2e/screens/s4-changed-in-another-tab.png', timeout: 120000 });

await addRoomIn(tB, 'Room B', 8);
await tB.waitForTimeout(2500); // longer than the auto-save delay
let shared = await savedIn(tB, sharedId);
log('two tabs: tab B\'s save does not wipe tab A\'s room', shared?.rooms?.map((r) => r.name).join() === 'Room A' &&
  (await tabStatus(tB)).startsWith('Not saved'), `${shared?.rooms?.map((r) => r.name)} / ${await tabStatus(tB)}`);

await tB.click('[aria-label="Save mine as a copy"]');
const copyId = await tB.evaluate(() => window.__ahdusStore.getState().layoutId);
const copy = await savedIn(tB, copyId);
shared = await savedIn(tB, sharedId);
log('two tabs: Save mine as a copy keeps both versions', copyId !== sharedId && copy?.layoutName === 'Shared (copy)' &&
  copy.rooms.map((r) => r.name).join() === 'Room B' && shared.rooms.map((r) => r.name).join() === 'Room A' &&
  !(await shown(tB, 'Changed in another tab')) && await until(async () => (await tabStatus(tB)).startsWith('Saved')),
  `${copy?.layoutName}: ${copy?.rooms?.map((r) => r.name)}`);
log('two tabs: on different layouts the "also open" note goes away',
  await until(async () => !(await shown(tA, 'Also open in another tab')) && !(await shown(tB, 'Also open in another tab'))));

// Tab B opens the shared layout again; tab A saves; tab B reloads theirs
await tB.click('[aria-label="All layouts"]');
await tB.waitForSelector('text=Workspace Layouts', { timeout: 30000 });
await tB.locator('button[aria-label="Open Shared"]').click();
await opened(tB);
await addRoomIn(tA, 'Room A2', 8);
await until(() => shown(tB, 'Changed in another tab'), 15000);
await tB.click('[aria-label="Reload"]');
log('two tabs: Reload loads the other tab\'s version',
  await until(async () => (await roomNames(tB)).join() === 'Room A,Room A2') && !(await shown(tB, 'Changed in another tab')),
  (await roomNames(tB)).join());
await ctx.close();

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
