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

// ── Part 2: wall items ──
const LIB = '[data-library="furniture"]';
const dragTile = async (name, x, y, z) => {
  if (!(await p.locator(LIB).isVisible().catch(() => false))) { await p.click('[aria-label="Furniture"]'); await frames(2); }
  await p.fill('[aria-label="Search furniture"]', name);
  const box = await p.locator(`.lib-tile[title^="${name}"]`).first().boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  const to = await toScreen(x, y, z);
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await frames(2);
  const during = await hint();
  await p.mouse.up();
  await frames(3);
  return during;
};
const newest = async (type) => (await store()).objects.filter((o) => o.assetType === type).at(-1);
const facesSouth = (o) => Math.abs(Math.cos(o.rotationY) + 1) < 0.01; // its front (+Z) turned to −Z
const solidOf = (id) => p.evaluate((id) => {
  const m = window.__ahdusScene.meshes.find((x) => x.parent?.metadata?.objectId === id && !x.name.includes('pick'));
  return m ? m.checkCollisions : null;
}, id);
await p.keyboard.press('Escape'); await frames(2);
st = await store();
const room = st.rooms.find((r) => r.id === meeting.id); // 7 × 6 at (5, 8): its north wall's inside face at z 10.925
const northFace = room.z + room.depth / 2 - (room.wallThickness ?? 0.15) / 2;
const southFace = room.z - room.depth / 2 + (room.wallThickness ?? 0.15) / 2;

const tvHint = await dragTile('Large Display TV', room.x, 0, northFace - 0.6);
let tv = await newest('TV_DISPLAY');
log('a TV dropped near a wall hangs on it: back to the wall, facing the room, its middle at 1.4 m',
  tv && Math.abs(tv.z - (northFace - 0.04 - 0.005)) < 0.01 && facesSouth(tv) && Math.abs(tv.y + 0.95 / 2 - 1.4) < 0.01,
  tv ? `at ${tv.x}, ${tv.y}, ${tv.z}, turned ${tv.rotationY.toFixed(2)}` : 'none');
log('while dragging the hint says it hangs on the wall', /hangs on the wall/.test(tvHint), tvHint.replace(/\s+/g, ' ').slice(0, 80));
await dragTile('Wall Clock', room.x - 2.4, 0, northFace - 0.5);
const clock = await newest('WALL_CLOCK');
log('a wall clock hangs at 2.0 m on the same wall', clock && Math.abs(clock.y + 0.175 - 2) < 0.01 && clock.z > northFace - 0.04 && facesSouth(clock),
  clock ? `at ${clock.x}, ${clock.y}, ${clock.z}` : 'none');
log('a hung TV is no obstacle for walking', (await solidOf(tv.id)) === false);

// a picture of both on the wall, in 3D
await p.click('[aria-label="3D view"]'); await frames(3);
await p.evaluate(([x, y, z]) => {
  const cam = window.__ahdusScene.activeCamera;
  cam.target.set(x, y, z); cam.alpha = -Math.PI / 2; cam.beta = 1.25; cam.radius = 7;
}, [room.x - 1.2, 1.5, northFace]);
await frames(4); await wait(400);
await shot('lw-wall-tv-clock.png');

// drag it along its wall, then onto the opposite one (in 2D, from above)
await p.click('[aria-label="2D view"]'); await frames(3); await wait(400);
await dragWorld([tv.x, tv.y + 0.5, tv.z - 0.03], [tv.x + 1.5, tv.y + 0.5, tv.z - 0.03]);
let moved = await newest('TV_DISPLAY');
log('dragged along its wall: it slides, still on the wall', Math.abs(moved.x - (tv.x + 1.5)) < 0.3 && Math.abs(moved.z - tv.z) < 0.01 && facesSouth(moved),
  `${moved.x}, ${moved.z} (was ${tv.x}, ${tv.z})`);
await dragWorld([moved.x, moved.y + 0.5, moved.z - 0.03], [moved.x, moved.y + 0.5, southFace + 0.4]);
moved = await newest('TV_DISPLAY');
log('dragged across the room: onto the other wall, turned round', Math.abs(moved.z - (southFace + 0.045)) < 0.01 && Math.abs(Math.cos(moved.rotationY) - 1) < 0.01,
  `${moved.x}, ${moved.y}, ${moved.z}, turned ${moved.rotationY.toFixed(2)}`);
await key('Control+z');
log('Ctrl+Z puts it back in one step', Math.abs((await newest('TV_DISPLAY')).z - (northFace - 0.045)) < 0.01);

// guide lines while dragging (Part 3) are checked further down; here: an old layout's TV on the floor
const oldId = await p.evaluate(([x, z]) => {
  const s = window.__ahdusStore.getState();
  // as an old save has it (no editor step: nothing moves it by itself)
  return s.addObject({ assetType: 'TV_DISPLAY', x, y: 0, z, rotationY: 0, floor: 0, roomId: null });
}, [room.x + 1.5, room.z]);
await frames(3); await wait(2200); // Check runs 1.5 s after a change
st = await store();
const old = st.objects.find((o) => o.assetType === 'TV_DISPLAY' && o.y === 0);
log('an old layout\'s TV on the floor stays where it is', !!old && old.x === room.x + 1.5 && old.z === room.z && !!oldId);
log('…and stays an obstacle', (await solidOf(old.id)) === true);
await p.getByRole('button', { name: 'Check layout', exact: true }).click(); await frames(2); await wait(300);
const warning = p.locator(`[data-check-kind="WALL_ITEM_OFF_WALL"] .check-message`);
const warnText = await warning.first().innerText().catch(() => '');
log('Check my layout warns: it is not on a wall', await warning.count() === 1 && /Large Display TV is not on a wall/.test(warnText), warnText);
await shot('lw-check-warning.png');
await warning.first().click(); await frames(3); await wait(400);
log('a click on the warning selects it, and its Inspector offers Mount on wall',
  (await store()).selected === old.id && await p.locator('[data-wall-mount="off"] button:has-text("Mount on wall")').count() === 1);
await p.click('[aria-label="Close layout check"]').catch(() => {}); await frames(2);
await shot('lw-mount-on-wall.png');
await p.locator('[data-wall-mount="off"] button:has-text("Mount on wall")').click(); await frames(3); await wait(300);
const mounted = (await store()).objects.find((o) => o.id === old.id);
log('Mount on wall hangs it on the nearest wall', mounted.y > 0.5 && await p.locator('[data-wall-mount]').count() === 0 && (await solidOf(old.id)) === false,
  `${mounted.x}, ${mounted.y}, ${mounted.z}, turned ${mounted.rotationY.toFixed(2)}; ${await hint()}`);
await key('Control+z');
log('Ctrl+Z puts it back on the floor', (await store()).objects.find((o) => o.id === old.id).y === 0);
await key('Control+y');

// Walk through: walking past the wall TV (the TV is no obstacle; the wall still is)
await p.click('[aria-label="Walk through"]'); await frames(4); await wait(600);
const hungTv = await newest('TV_DISPLAY');
// in front of it, 0.38 m from the wall: a body (0.32 m) there would touch a solid TV (it sticks out 0.085 m)
const front = Math.cos(hungTv.rotationY);
const laneZ = hungTv.z + front * 0.34;
await p.evaluate(([x, z]) => window.__ahdusPlay.setPose({ x, z, yaw: Math.PI / 2, pitch: -0.05, floor: 0 }), [hungTv.x - 2.2, laneZ]);
await frames(3); await wait(400);
await blur();
await p.keyboard.down('w'); await wait(700); await shot('lw-walk-past-tv.png'); await wait(900); await p.keyboard.up('w'); await frames(3);
const pose = await p.evaluate(() => { const v = window.__ahdusPlay.getPosition?.(); return v ? { x: v.x, z: v.z } : null; });
log('Walk through: you walk past the TV along the wall', !!pose && pose.x > hungTv.x - 0.3 && Math.abs(pose.z - laneZ) < 0.1,
  pose ? `at ${pose.x.toFixed(2)}, ${pose.z.toFixed(2)} (TV at ${hungTv.x}, ${hungTv.z})` : 'no position');
await p.click('[aria-label="Back to Studio"]'); await frames(4); await wait(500);

// ── Part 3: snapping while dragging, with guide lines; Alt = none ──
await p.click('[aria-label="2D view"]'); await frames(3); await wait(400);
st = await store();
const d0 = st.objects.find((o) => o.id === desk.id);
const westFace = room.x - room.width / 2 + (room.wallThickness ?? 0.15) / 2;
const box0 = await p.evaluate(async (o) => {
  const { itemBox } = await import('/src/play/dragSnap.js');
  const { ASSET_TYPES } = await import('/src/utils/assetCatalog.js');
  return itemBox(o, ASSET_TYPES);
}, d0);
const hw = (box0.x1 - box0.x0) / 2;
const guidesNow = () => p.evaluate(() => window.__ahdusScene.getMeshByName('snap_guides')?.metadata?.guides ?? []);
// select it first: the Inspector opening narrows the view (a drag of an unselected item moves under the mouse)
await hover(d0.x, 0, d0.z); await p.mouse.down(); await p.mouse.up(); await frames(3); await wait(500);
// 8 cm from the meeting room's west wall, level with the middle of its table
await hover(d0.x, 0, d0.z);
await p.mouse.down();
let to = await toScreen(westFace + hw + 0.08, 0, room.z + 0.06);
await p.mouse.move(to.x, to.y, { steps: 14 });
await frames(3); await wait(200);
const guides = await guidesNow();
const dragHint = await hint();
log('dragging: guide lines show what it lines up with (the wall, the table\'s middle)',
  guides.some((g) => g.kind === 'wall') && guides.some((g) => g.kind === 'centre' || g.kind === 'edge'), JSON.stringify(guides.map((g) => g.kind)));
log('…and the hint says so, with Alt for no snapping', /Against the wall/.test(dragHint) && /Alt/.test(dragHint), dragHint.replace(/\s+/g, ' ').slice(0, 90));
await shot('lw-guides.png');
await p.mouse.up(); await frames(3);
let d1 = (await store()).objects.find((o) => o.id === desk.id);
log('let go: its side is on the wall face', Math.abs(d1.x - hw - westFace) < 0.005, `x ${d1.x} (face ${westFace}, half width ${hw.toFixed(3)})`);
log('no guide lines after the drag', (await guidesNow()).length === 0);

// Alt held: no snapping at all
await hover(d1.x, 0, d1.z);
await p.mouse.down();
to = await toScreen(d1.x + 0.77, 0, d1.z - 0.43);
await p.mouse.move(to.x - 6, to.y - 6, { steps: 6 });
await p.keyboard.down('Alt');
await p.mouse.move(to.x, to.y, { steps: 4 });
await frames(3); await wait(200);
const altGuides = await guidesNow();
const altHint = await hint();
await p.mouse.up(); await frames(3);
await p.keyboard.up('Alt');
const d2 = (await store()).objects.find((o) => o.id === desk.id);
const offGrid = (v) => Math.abs(v / 0.5 - Math.round(v / 0.5)) > 0.02;
log('Alt held: no guide lines, no grid', altGuides.length === 0 && /No snapping/.test(altHint) && (offGrid(d2.x) || offGrid(d2.z)),
  `${d2.x}, ${d2.z}; ${altHint.replace(/\s+/g, ' ').slice(0, 60)}`);
await key('Control+z');

// Plan view: the same lines while dragging
await p.click('[aria-label="Plan view"]'); await frames(2); await wait(700);
const roomBox = await p.locator(`[data-room-id="${meeting.id}"]`).first().boundingBox();
const planAt = (x, z) => ({
  x: roomBox.x + ((x - (room.x - room.width / 2)) / room.width) * roomBox.width,
  y: roomBox.y + (((room.z + room.depth / 2) - z) / room.depth) * roomBox.height, // north up
});
const deskBox = await p.locator(`[data-object-id="${desk.id}"]`).boundingBox();
await p.mouse.move(deskBox.x + deskBox.width / 2, deskBox.y + deskBox.height / 2);
await p.mouse.down();
const target = planAt(westFace + hw + 0.06, room.z - 0.05);
await p.mouse.move(target.x, target.y, { steps: 12 });
await wait(300);
const planGuides = await p.locator('[data-plan-guide]').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-guide')));
log('Plan view: guide lines while dragging', planGuides.includes('wall'), JSON.stringify(planGuides));
await shot('lw-guides-plan.png');
await p.mouse.up(); await wait(400);
const d3 = (await store()).objects.find((o) => o.id === desk.id);
log('Plan view: let go against the wall, no lines left', Math.abs(d3.x - hw - westFace) < 0.005 && await p.locator('[data-plan-guide]').count() === 0, `x ${d3.x}`);
await p.click('[aria-label="2D view"]'); await frames(3);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} checks passed`);
await b.close();
process.exit(failed.length ? 1 : 0);
