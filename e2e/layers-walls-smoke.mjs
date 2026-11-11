// Layers, wall items and snapping smoke test (v0.15.6).
// Part 1, Layers: the eye hides a room / an item in Studio's 3D view and Plan view only (Walk through and the
// saved layout keep everything), "N hidden · Show all", remembered per workplace after a reload; the lock on a
// room: Delete, R, typing its size and dragging its wall change nothing, L unlocks, one undo step each.
// Results are checked in the store and on the meshes. SHOTS=<dir>: the screenshots go there (else e2e/screens/lw-*.png).
//
// Run:   npm run dev                (in one terminal)
//        npm run e2e:layers         (in another)
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
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
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
  t = setTimeout(done, 3000);
}), n);
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return {
    objects: Object.values(s.objects), rooms: Object.values(s.rooms), currentFloor: s.currentFloor,
    selected: s.selectedObjectId, selectedRoom: s.selectedRoomId, undo: s.undoLabel ?? null,
  };
});
const shot = (name) => p.screenshot({ path: join(SHOTS, name), timeout: 120000 });
const blur = () => p.evaluate(() => document.activeElement?.blur?.());
const key = async (k) => { await blur(); await p.keyboard.press(k); await frames(2); await wait(150); };
const hint = () => p.locator('.studio-footer__hint').first().innerText().catch(() => '');
// is this room's / item's 3D node shown?
const enabled = (kind, id) => p.evaluate(([kind, id]) => {
  const sc = window.__ahdusScene;
  const node = sc.transformNodes.find((n) => (kind === 'room' ? n.metadata?.roomId === id && !n.parent?.metadata?.roomId : n.metadata?.objectId === id && !n.parent?.metadata?.objectId))
    ?? sc.meshes.find((m) => (kind === 'room' ? m.metadata?.roomId === id : m.metadata?.objectId === id));
  if (!node) return null;
  let n = node;
  while (n.parent && (kind === 'room' ? n.parent.metadata?.roomId === id : n.parent.metadata?.objectId === id)) n = n.parent;
  return n.isEnabled();
}, [kind, id]);
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
  await wait(300); await frames(1);
  const s = await toScreen(x, y, z);
  await p.mouse.move(s.x - 3, s.y - 3);
  await p.mouse.move(s.x, s.y, { steps: 3 });
  await frames(2);
};
const dragWorld = async (from, to) => {
  await hover(...from);
  await p.mouse.down();
  const s = await toScreen(...to);
  await p.mouse.move(s.x, s.y, { steps: 12 });
  await frames(2);
  await p.mouse.up();
  await frames(3);
};
const openStudio = async () => {
  await p.waitForFunction(() => window.__ahdusStore?.getState().layoutName === 'Layers', null, { timeout: 90000 });
  await p.waitForSelector('[data-splash]', { state: 'detached', timeout: 90000 }).catch(() => {});
  await p.evaluate(() => window.__ahdusBuild?.whenBuilt?.());
  await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
};

// ── A Small Office ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Layers Co'); await p.click('button:has-text("Create")');
await p.getByRole('radio', { name: 'Small Office', exact: true }).click();
await p.fill('input[placeholder="Layout name…"]', 'Layers');
await p.getByRole('button', { name: 'Create', exact: true }).click({ noWaitAfter: true });
await openStudio();
await p.click('[aria-label="2D view"]'); await frames(3); await wait(500);

let st = await store();
const meeting = st.rooms.find((r) => r.name === 'Meeting Room');
const pantry = st.rooms.find((r) => r.name === 'Pantry & Break Area');
const desk = st.objects.find((o) => o.assetType === 'DESK_STANDARD');
const deskName = 'Standard Desk';

// ── Part 1: the eye ──
await p.click('[aria-label="Layers"]'); await frames(2); await wait(300);
await p.locator(`[data-layer-room="${pantry.id}"] [data-layer-eye]`).click(); await frames(3);
await p.locator(`[data-layer-item="${desk.id}"] [data-layer-eye]`).click(); await frames(3);
log('the eye hides a room and an item in the 3D view', (await enabled('room', pantry.id)) === false && (await enabled('object', desk.id)) === false,
  `room ${await enabled('room', pantry.id)}, desk ${await enabled('object', desk.id)}`);
log('other rooms and items stay shown', (await enabled('room', meeting.id)) === true);
const note = await p.locator('[data-hidden-note]').getAttribute('data-hidden-note').catch(() => null);
const layersNote = await p.locator('[data-layers-hidden]').getAttribute('data-layers-hidden').catch(() => null);
log('"2 hidden · Show all" by the floor switcher and in Layers', note === '2 hidden' && layersNote === '2 hidden', `${note} / ${layersNote}`);
log('the hidden rows are marked in Layers',
  await p.locator(`[data-layer-room="${pantry.id}"].is-hidden`).count() === 1 && await p.locator(`[data-layer-item="${desk.id}"].is-hidden`).count() === 1);
await shot('lw-layers-hidden.png');

const saved = await p.evaluate(() => JSON.stringify(window.__ahdusStore.getState().exportWorkspace()));
log('hidden is not in the saved layout', !/hidden/i.test(saved) && saved.includes(pantry.id));

await p.click('[aria-label="Plan view"]'); await frames(2); await wait(600);
log('Plan view leaves them out', await p.locator(`[data-room-id="${pantry.id}"]`).count() === 0 && await p.locator(`[data-object-id="${desk.id}"]`).count() === 0
  && await p.locator(`[data-room-id="${meeting.id}"]`).count() === 1);
await p.click('[aria-label="2D view"]'); await frames(3); await wait(300);

await p.click('[aria-label="Walk through"]'); await frames(4); await wait(600);
log('Walk through shows everything', (await enabled('room', pantry.id)) === true && (await enabled('object', desk.id)) === true);
await p.click('[aria-label="Back to Studio"]'); await frames(4); await wait(600);
log('back in Studio they are hidden again', (await enabled('room', pantry.id)) === false && (await enabled('object', desk.id)) === false);

await p.reload();
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
if (!(await p.locator('button[aria-label="Open Layers"]').isVisible().catch(() => false))) {
  await p.getByText('Layers Co', { exact: true }).first().click();
}
await p.locator('button[aria-label="Open Layers"]').click({ timeout: 90000, noWaitAfter: true });
await openStudio();
await frames(3); await wait(500);
log('remembered in this browser after a reload', (await enabled('room', pantry.id)) === false
  && await p.locator('[data-hidden-note]').getAttribute('data-hidden-note').catch(() => null) === '2 hidden');
await p.locator('.canvas-footer__show-all').click(); await frames(3);
log('Show all shows them again', (await enabled('room', pantry.id)) === true && (await enabled('object', desk.id)) === true
  && await p.locator('[data-hidden-note]').count() === 0);

// ── Part 1: a locked room ──
await p.click('[aria-label="2D view"]').catch(() => {}); await frames(3);
if (!(await p.locator('[aria-label="Inspector"][data-mode="layers"]').count())) { await p.click('[aria-label="Layers"]'); await frames(2); }
await p.locator(`[data-layer-room="${meeting.id}"] [data-layer-lock]`).click(); await frames(2);
st = await store();
const locked = st.rooms.find((r) => r.id === meeting.id);
log('the lock in Layers locks the room', locked.isLocked === true);
await p.locator(`[data-layer-item="${st.objects.find((o) => o.assetType === 'TABLE_MEETING').id}"] [data-layer-lock]`).click(); await frames(2);
await shot('lw-layers-locked.png');
await p.locator(`[data-layer-room="${meeting.id}"] .layers-list__item`).click(); await frames(3); await wait(300);
log('its Inspector says Locked, its size and place are greyed', await p.locator('[data-room-locked]').count() === 1
  && await p.locator('input[aria-label="Width"]').isDisabled() && await p.locator('input[aria-label="Room X"]').isDisabled());
await key('Delete');
st = await store();
log('Delete keeps a locked room', !!st.rooms.find((r) => r.id === meeting.id), await hint());
await key('r');
st = await store();
const after = st.rooms.find((r) => r.id === meeting.id);
log('R does not turn it', after.width === locked.width && after.depth === locked.depth, await hint());
// drag its east wall outwards: nothing changes
await dragWorld([meeting.x + meeting.width / 2, 1.5, meeting.z], [meeting.x + meeting.width / 2 + 2, 0, meeting.z]);
st = await store();
const dragged = st.rooms.find((r) => r.id === meeting.id);
log('dragging its wall or floor changes nothing', dragged.width === locked.width && dragged.x === locked.x && dragged.z === locked.z,
  `${dragged.width} × ${dragged.depth} at ${dragged.x}, ${dragged.z}; selected ${st.selectedRoom === meeting.id ? 'it' : st.selectedRoom ?? st.selected}`);
if ((await store()).selectedRoom !== meeting.id) {
  await p.locator('[aria-label="Layers"]').click(); await frames(2);
  await p.locator(`[data-layer-room="${meeting.id}"] .layers-list__item`).click(); await frames(3); await wait(300);
}
await key('l');
st = await store();
log('L unlocks it', !st.rooms.find((r) => r.id === meeting.id).isLocked, await hint());
await key('Control+z');
log('Ctrl+Z locks it again (one step)', (await store()).rooms.find((r) => r.id === meeting.id).isLocked === true);
await key('Control+y');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} checks passed`);
await b.close();
process.exit(failed.length ? 1 : 0);
