// Faster building smoke test (v0.15.5): Plan view floors (the floor switcher in sight at 1366 × 768 and
// 1920 × 1080 with the Inspector open, Page Up / Down keeping the view, the floor below, stairs on both
// floors, All floors), multi-select (Shift+click, Shift+drag box, group drag / arrows / Delete in one
// undo step, locked items stay), copy and paste (a desk with its chair, Ctrl+Shift+V on the floor above,
// Ctrl+V at the mouse, one Ctrl+Z), the Layers search, and keys that do nothing while typing.
// Results are checked in the store. SHOTS=<dir>: the screenshots go there (else e2e/screens/fb-*.png).
//
// Run:   npm run dev                (in one terminal)
//        npm run e2e:faster         (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3000/';
const SHOTS = process.env.SHOTS ?? 'e2e/screens';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
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
const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 3000); // Plan view draws no 3D frames: don't wait long for them
}), n);
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return {
    objects: Object.values(s.objects), currentFloor: s.currentFloor,
    selected: s.selectedObjectId, group: s.selectedObjectIds,
  };
});
const shot = (name) => p.screenshot({ path: join(SHOTS, name), timeout: 120000 });
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
const hint = () => p.locator('.studio-footer__hint').first().innerText().catch(() => '');
const blur = () => p.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await blur(); await p.keyboard.press(k); await frames(2); await wait(150); };

const toScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
const hover = async (x, y, z) => {
  await wait(300); await frames(1); // the Inspector opening / closing changes the canvas size
  const s = await toScreen(x, y, z);
  await p.mouse.move(s.x - 3, s.y - 3);
  await p.mouse.move(s.x, s.y, { steps: 3 });
  await frames(2);
};
const clickAt = async (x, y, z, { shift = false } = {}) => {
  await hover(x, y, z);
  if (shift) await p.keyboard.down('Shift');
  await p.mouse.down(); await p.mouse.up();
  if (shift) await p.keyboard.up('Shift');
  await frames(3);
};
const dragWorld = async (from, to, { shift = false, during } = {}) => {
  await hover(...from);
  if (shift) await p.keyboard.down('Shift');
  await p.mouse.down();
  const s = await toScreen(...to);
  await p.mouse.move(s.x, s.y, { steps: 12 });
  await frames(2);
  if (during) await during();
  await p.mouse.up();
  if (shift) await p.keyboard.up('Shift');
  await frames(3);
};
const deskTop = (o) => [o.x, 0.76, o.z];

// ── A Small Office, a staircase, a copied floor above ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Faster Co'); await p.click('button:has-text("Create")');
await p.getByRole('radio', { name: 'Small Office', exact: true }).click();
await p.fill('input[placeholder="Layout name…"]', 'Faster');
await p.getByRole('button', { name: 'Create', exact: true }).click({ noWaitAfter: true });
await p.waitForFunction(() => window.__ahdusStore?.getState().layoutName === 'Faster', null, { timeout: 90000 });
await p.waitForSelector('[data-splash]', { state: 'detached', timeout: 90000 }).catch(() => {});
await p.evaluate(() => window.__ahdusBuild?.whenBuilt?.());
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await p.click('[aria-label="2D view"]'); await frames(3); await wait(500);

let st = await store();
const desks = st.objects.filter((o) => o.assetType === 'DESK_STANDARD' && o.x > -3 && o.x < 9 && o.z > -4 && o.z < 4);
log('the Small Office has 3 desks with chairs in its Open Workspace', desks.length === 3, `${desks.length} desks`);

// drag the Stairs library's tile onto the floor (as a person does)
await p.click('[aria-label="Stairs"]'); await frames(1); await wait(300);
const stairTile = await p.locator('[data-library="stairs"] .lib-tile').first().boundingBox();
await p.mouse.move(stairTile.x + stairTile.width / 2, stairTile.y + stairTile.height / 2);
await p.mouse.down();
const stairTo = await toScreen(7.5, 0, 0);
await p.mouse.move(stairTo.x, stairTo.y, { steps: 12 }); await frames(2);
await p.mouse.up(); await frames(3);
if (await p.locator('[data-library="stairs"]').isVisible().catch(() => false)) await p.click('[aria-label="Stairs"]');
await wait(300);
await key('Escape');
st = await store();
const stairs = st.objects.find((o) => o.assetType === 'STAIRCASE');
log('a staircase placed in the Open Workspace', !!stairs, stairs ? `at ${stairs.x.toFixed(1)}, ${stairs.z.toFixed(1)}` : 'none');

await p.click('[aria-label="Floor switcher"]'); await frames(1);
await p.click('[aria-label="Add floor above"]'); await frames(1);
await p.click('[aria-label="Copy rooms from below"]'); await frames(3);
log('Floor 1 added with the rooms of the ground floor', (await store()).currentFloor === 1);

// ── Page Up / Page Down (3D / 2D view) ──
await key('PageDown');
log('Page Down: the ground floor', (await store()).currentFloor === 0, await hint());
await key('PageDown');
log('Page Down on the ground floor: stays, says so', (await store()).currentFloor === 0 && /ground floor/i.test(await hint()), await hint());

// ── Typing is safe: keys in the Layers search do nothing to the layout ──
await p.click('[aria-label="Layers"]'); await frames(1);
await p.fill('[aria-label="Search layers"]', 'desk');
const found = await p.locator('[data-layers-found]').innerText().catch(() => '');
const listed = await p.locator('ul[aria-label="Furniture and equipment items"] li').count();
log('Layers search: "desk" lists the floor\'s desks only', /found/.test(found) && listed >= 3 && listed < st.objects.filter((o) => o.floor === 0).length,
  `${found}, ${listed} items listed`);
const before = (await store()).objects.length;
await p.focus('[aria-label="Search layers"]');
for (const k of ['PageUp', 'Control+c', 'Control+v', 'Delete', 'Control+Shift+v']) await p.keyboard.press(k);
await frames(2);
st = await store();
log('Page Up, Ctrl+C / V and Delete in the search box change nothing', st.objects.length === before && st.currentFloor === 0,
  `${st.objects.length} items, floor ${st.currentFloor}`);
await p.fill('[aria-label="Search layers"]', '');
await p.click('[aria-label="Layers"]'); await frames(1); await wait(300);

// ── Multi-select: Shift+click adds and removes ──
const [dA, dB, dC] = desks;
await clickAt(...deskTop(dA));
await clickAt(...deskTop(dB), { shift: true });
st = await store();
log('Shift+click adds a desk: 2 items selected', st.group.length === 2 && st.group.includes(dA.id) && st.group.includes(dB.id),
  `${st.group.length} in the group`);
const count = await p.locator('[data-group-count]').innerText().catch(() => '');
log('the Inspector says "2 items selected" with the group actions', /2 items selected/.test(count) &&
  (await p.locator('[data-group-actions] button').count()) >= 4, count);
await clickAt(...deskTop(dB), { shift: true });
st = await store();
log('Shift+click again takes it out', st.group.length === 0 && st.selected === dA.id);
await key('Escape');
st = await store();
log('Esc clears the selection', st.group.length === 0 && !st.selected);

// ── Lock one desk, then a Shift+drag box over the Open Workspace ──
await clickAt(...deskTop(dA));
await key('l');
log('desk A locked', (await store()).objects.find((o) => o.id === dA.id).isLocked === true);
await key('Escape');
let boxSeen = false;
await dragWorld([-2.6, 0, -3.7], [6.6, 0, 3.7], {
  shift: true,
  during: async () => {
    boxSeen = await p.locator('[data-select-box]').isVisible().catch(() => false);
    await shot('v0.15.5-box-selection-drag.png');
  },
});
st = await store();
const boxIds = st.group;
log('Shift+drag draws a box and selects the 5+ items in it (desks, chairs)', boxSeen && boxIds.length >= 5 && desks.every((d) => boxIds.includes(d.id)),
  `${boxIds.length} selected`);
await shot('v0.15.5-box-selection.png');

// ── Arrows move the group; the locked desk stays and the message says so; one Ctrl+Z ──
const pos = (id, s = st) => { const o = s.objects.find((x) => x.id === id); return [o.x, o.z]; };
const chairOf = (d) => st.objects.find((o) => o.assetType === 'CHAIR_OFFICE' && near(o.x, d.x, 0.2) && near(o.z, d.z - 0.8, 0.2));
const chairB = chairOf(dB);
await key('ArrowRight');
const msg = await hint();
let st2 = await store();
const movedB = pos(dB.id, st2)[0] - dB.x;
log('Arrow right moves the group; the locked desk stays: "1 locked item was not moved"',
  movedB > 0.05 && near(pos(dA.id, st2)[0], dA.x, 0.001) && /1 locked item was not moved/.test(msg), `B +${movedB.toFixed(2)} m · "${msg}"`);
await key('Control+z');
st2 = await store();
log('one Ctrl+Z puts the group back', near(pos(dB.id, st2)[0], dB.x, 0.001) && near(pos(dC.id, st2)[0], dC.x, 0.001));

// ── Drag one desk of the group: all of them (and the chairs) move, one undo step ──
await dragWorld(deskTop(dB), [dB.x + 2, 0.76, dB.z]);
st2 = await store();
const dx = pos(dB.id, st2)[0] - dB.x;
log('dragging a desk of the group moves every unlocked item by as much, with the chairs',
  dx > 1 && near(pos(dC.id, st2)[0] - dC.x, dx, 0.01) && (!chairB || near(pos(chairB.id, st2)[0] - chairB.x, dx, 0.01)) &&
  near(pos(dA.id, st2)[0], dA.x, 0.001), `+${dx.toFixed(2)} m`);
await key('Control+z');
st2 = await store();
log('one Ctrl+Z puts the dragged group back', near(pos(dB.id, st2)[0], dB.x, 0.001) && near(pos(dC.id, st2)[0], dC.x, 0.001));

// ── Delete: the unlocked ones go, the locked one stays; one Ctrl+Z ──
const n0 = st2.objects.length;
await p.evaluate((ids) => window.__ahdusStore.getState().setObjectSelection(ids), boxIds); await frames(1);
await key('Delete');
st2 = await store();
const delMsg = await hint();
log('Delete removes the unlocked items; the locked desk stays selected',
  st2.objects.length === n0 - (boxIds.length - 1) && st2.objects.some((o) => o.id === dA.id) && st2.selected === dA.id &&
  /1 locked item was not deleted/.test(delMsg), `${n0} → ${st2.objects.length} · "${delMsg}"`);
await key('Control+z');
log('one Ctrl+Z brings them all back', (await store()).objects.length === n0);
await key('l'); // unlock desk A again (it is the selection)
await key('Escape');

// ── Copy a desk (with its chair), paste on the floor above at the same place ──
await clickAt(...deskTop(dB));
await key('Control+c');
log('Ctrl+C copies the desk with its chair', /Copied .*1 item with it/.test(await hint()), await hint());
await key('PageUp');
await key('Control+Shift+v');
st2 = await store();
const pasted = st2.objects.filter((o) => o.floor === 1 && (o.assetType === 'DESK_STANDARD' || o.assetType === 'CHAIR_OFFICE'));
const pDesk = pasted.find((o) => o.assetType === 'DESK_STANDARD');
log('Ctrl+Shift+V on Floor 1 pastes the desk and its chair at the same x / z, with new ids',
  st2.currentFloor === 1 && pasted.length === 2 && pDesk && near(pDesk.x, dB.x, 0.001) && near(pDesk.z, dB.z, 0.001) && pDesk.id !== dB.id &&
  /Pasted 2 items on Floor 1/.test(await hint()), `${pasted.length} pasted · "${await hint()}"`);
await p.click('[aria-label="3D view"]'); await frames(4); await wait(800);
await shot('v0.15.5-paste-on-floor-1.png');
await p.click('[aria-label="2D view"]'); await frames(3); await wait(500);
await key('Control+z');
log('one Ctrl+Z removes everything pasted', (await store()).objects.filter((o) => o.floor === 1).length === 0);

// Ctrl+V at the mouse
await hover(2, 3.5, 2); // Floor 1's floor is 3.5 m up
await p.keyboard.press('Control+v'); await frames(3);
st2 = await store();
const atMouse = st2.objects.filter((o) => o.floor === 1);
const mDesk = atMouse.find((o) => o.assetType === 'DESK_STANDARD');
log('Ctrl+V pastes at the mouse: the copied desk there, its chair behind it',
  atMouse.length === 2 && !!mDesk && near(mDesk.x, 2, 0.3) && near(mDesk.z, 2, 0.3),
  mDesk ? `desk at ${mDesk.x.toFixed(2)}, ${mDesk.z.toFixed(2)}` : 'no desk');
await key('Control+z');

// ── Plan view: the floor switcher in sight, Inspector open, at 1366 × 768 and 1920 × 1080 ──
await key('PageDown'); // the ground floor, with its furniture
await p.click('[aria-label="Plan view"]'); await wait(800);
const switcherFree = () => p.evaluate(() => {
  const ok = (label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.bottom <= window.innerHeight && !!hit && (el === hit || el.contains(hit));
  };
  return ok('Floor switcher') && ok('Add floor');
});
await p.locator('[data-object-id]').first().click(); await wait(500);
const inspOpen = await p.locator('aside[aria-label="Inspector"]').isVisible();
log('Plan view, 1366 × 768, Inspector open: the floor switcher and Add floor are clickable', inspOpen && await switcherFree());
await shot('v0.15.5-plan-floor-switcher-1366x768.png');
await p.setViewportSize({ width: 1920, height: 1080 }); await wait(800);
log('Plan view, 1920 × 1080, Inspector open: the floor switcher and Add floor are clickable', await switcherFree());
await shot('v0.15.5-plan-floor-switcher-1920x1080.png');
await p.setViewportSize({ width: 1366, height: 768 }); await wait(800);
await key('Escape');

// ── Page Up / Down in Plan keep the view; the floor below; stairs on both floors ──
const viewBox = () => p.locator('svg[viewBox]').first().getAttribute('viewBox');
const vb0 = await viewBox();
await key('PageUp');
log('Page Up in Plan: Floor 1, the view stays where it was', (await store()).currentFloor === 1 && (await viewBox()) === vb0, vb0);
log('Floor 1 shows the floor below (faint outline) and the stairs coming up ("down")',
  (await p.locator('[data-plan-below]').count()) === 1 && (await p.locator('[data-plan-stairs="down"]').count()) === 1);
await shot('v0.15.5-plan-floor-below.png');
await p.click('[aria-label="Floor below"]'); await wait(300);
const hidden = (await p.locator('[data-plan-below]').count()) === 0;
const saved = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('ahdus.planView') ?? '{}')));
log('the Floor below button hides it, remembered for this workplace', hidden && /"below":false/.test(saved), saved.slice(0, 120));
await p.click('[aria-label="Floor below"]'); await wait(300);
await key('PageDown');
log('Page Down in Plan: the ground floor, stairs going "up"', (await store()).currentFloor === 0 && (await p.locator('[data-plan-stairs="up"]').count()) === 1);

// ── All floors: every floor's plan, labelled; a click opens it ──
await p.click('[aria-label="All floors"]'); await wait(500);
const tiles = await p.locator('[data-floor-tile]').count();
const names = await p.locator('[data-floor-tile]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
log('All floors shows each floor, labelled', tiles === 2 && /Ground Floor/.test(names[0]) && /Floor 1/.test(names[1]), names.join(' | '));
await shot('v0.15.5-plan-all-floors.png');
await p.locator('[data-floor-tile="1"]').click(); await wait(500);
log('a click on Floor 1 opens its plan', (await store()).currentFloor === 1 && (await p.locator('[data-floor-tile]').count()) === 0);

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
