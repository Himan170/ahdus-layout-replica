// Multi-storey smoke test: a 2-storey building with stairs, real floor heights.
//   - N asks "Copy rooms from below" / "Empty floor"; copying builds the same rooms on Floor 1
//   - rooms are drawn on the upper floor in Preview; one that overhangs gets a warning
//   - the upper floor gets an opening over the stairs; the character walks up and back down
//   - Page Up / Page Down move the character between floors; the HUD says "Floor 2 of 2"
//   - Stretch + / − raises the ground floor's walls; the floor above goes up with them (no gap),
//     and the stairs are rebuilt to climb the taller floor
//   - stairs with no room above: the roof is cut over them and the hint says so
//   - Studio: storeys show and hide, the outline of the floor below, wall and floor heights
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:building   (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
mkdirSync('e2e/screens', { recursive: true });

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
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
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const pose = async (a) => { await p.evaluate((x) => window.__ahdusPlay.setPose(x), a); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.__ahdusPlay.getPosition(); return { x: v.x, y: v.y, z: v.z }; });
const level = () => p.evaluate(() => window.__ahdusPlay.getLevel());
const flying = () => p.evaluate(() => window.__ahdusPlay.isFlying());
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return { rooms: Object.values(s.rooms), objects: Object.values(s.objects), floors: Object.values(s.floors), currentFloor: s.currentFloor };
});
/** World height of a floor: the floor heights below it added up (as building.elevationOf). */
const elevation = (floors, id) => floors.filter((f) => f.id < id).reduce((sum, f) => sum + (f.height ?? 3.5), 0);
const click = async () => { await p.mouse.down(); await p.mouse.up(); await frames(2); };
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const hudText = (sel) => p.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);
const ensureLocked = async () => {
  await frames(2);
  if (!(await p.evaluate(() => !!document.pointerLockElement))) {
    await p.click('button:has-text("Start preview")').catch(() => {}); await wait(400);
  }
};
const walkUntil = async (key, done, maxMs = 40000) => {
  const start = Date.now();
  await p.keyboard.down(key);
  while (Date.now() - start < maxMs && !done(await pos())) await wait(250);
  await p.keyboard.up(key);
  await frames(2);
};
/** Is a room part enabled? (part: 'roof' | 'ceiling' | 'floor' ...) */
const partShown = (roomId, part) => p.evaluate(({ roomId, part }) => {
  const meshes = window.__ahdusScene.meshes.filter((m) => m.metadata?.roomId === roomId && m.metadata?.part === part);
  return meshes.length > 0 && meshes.every((m) => m.isEnabled());
}, { roomId, part });
const roomShown = (roomId) => p.evaluate((roomId) => {
  const n = window.__ahdusScene.transformNodes.find((t) => t.name === `room_${roomId}`);
  return !!n && n.isEnabled();
}, roomId);
/** Lowest / highest world y of a room's parts of one kind. */
const yRange = (roomId, part) => p.evaluate(({ roomId, part }) => {
  let lo = Infinity, hi = -Infinity;
  for (const m of window.__ahdusScene.meshes) {
    if (m.metadata?.roomId !== roomId || m.metadata?.part !== part) continue;
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y);
  }
  return [lo, hi];
}, { roomId, part });
/** Does any (enabled or not) mesh of this room part cover the point (x, z) from above? */
const partCovers = (roomId, part, x, z) => p.evaluate(({ roomId, part, x, z }) => window.__ahdusScene.meshes.some((m) => {
  if (m.metadata?.roomId !== roomId || m.metadata?.part !== part) return false;
  m.computeWorldMatrix(true);
  const bb = m.getBoundingInfo().boundingBox;
  return bb.minimumWorld.x < x && bb.maximumWorld.x > x && bb.minimumWorld.z < z && bb.maximumWorld.z > z;
}), { roomId, part, x, z });
// Where the crosshair meets the plane y = planeY
const aimOnPlane = (planeY) => p.evaluate((planeY) => {
  const r = window.__ahdusScene.activeCamera.getForwardRay(1);
  const t = (planeY - r.origin.y) / r.direction.y;
  return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
}, planeY);
/** Fly at height y and move until the crosshair hits (tx, tz) on the plane planeY */
async function aimAt(tx, tz, planeY, y, pitch) {
  let x = tx, z = tz;
  for (let i = 0; i < 3; i++) {
    await pose({ x, z, yaw: 0, pitch, y, fly: true });
    const g = await aimOnPlane(planeY);
    x += tx - g.x; z += tz - g.z;
  }
  await pose({ x, z, yaw: 0, pitch, y, fly: true });
}

// ── Open the app ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Tower Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'HQ'); await p.click('button:has-text("Create")');
await p.waitForSelector('canvas', { timeout: 90000 }); await wait(2500);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await p.mouse.move(640, 360);
// The editor opens in Workplace Studio; this test covers Preview
await p.click('[aria-label="Preview Workplace"]'); await wait(800);
await ensureLocked();

// ── Ground floor: an office with a staircase inside (set up directly; building rooms is covered by play-smoke) ──
const ids = await p.evaluate(() => {
  const st = window.__ahdusStore.getState();
  const ground = st.addRoom({ type: 'OFFICE', name: 'Ground Office', x: 0, z: 0, width: 8, depth: 6, floor: 0 }).id;
  const stairs = st.addObject({ assetType: 'STAIRCASE', x: 2.5, z: 0, rotationY: 0, floor: 0, roomId: ground }).id;
  return { ground, stairs };
});
await pose({ x: -2, z: -1, yaw: 0, pitch: 0, floor: 0, fly: false });

// ── N asks first; "Copy rooms from below" builds the same rooms on Floor 1 and takes you there ──
await p.keyboard.press('KeyN'); await frames(2);
const asked = await p.isVisible('[role="dialog"][aria-label="New floor above"]');
await shot('b0-new-floor-question.png');
await p.click('[aria-label="Copy rooms from below"]'); await frames(3);
await ensureLocked();
let st = await store();
const copy = st.rooms.find((r) => r.floor === 1);
log('N asks first; "Copy rooms from below" adds Floor 1 with the same room (no furniture, no stairs)',
  asked && st.floors.length === 2 && !!copy && copy.x === 0 && copy.z === 0 && copy.width === 8 && copy.depth === 6 &&
  copy.type === 'OFFICE' && near(copy.wallHeight, 3.2) && !st.objects.some((o) => o.floor === 1),
  JSON.stringify(st.floors.map((f) => [f.name, f.height])) + (copy ? ` copy ${copy.width}×${copy.depth} at ${copy.x},${copy.z}` : ' no copy'));
let q = await pos();
log('N takes you up: standing in the copied room on Floor 1', (await level()) === 1 && near(q.y, 3.52) && !(await flying()),
  `level ${await level()} y=${q.y.toFixed(2)} flying=${await flying()}`);

// ── Build a room on Floor 1 in Preview, sticking out past the floor below: warned, but built ──
await p.keyboard.press('Digit1'); await frames(2);
const PITCH = -0.9;
await aimAt(4.5, -3, 3.52, 7.5, PITCH);
log('flying above Floor 1 keeps you on Floor 1', (await level()) === 1 && (await store()).currentFloor === 1, `level ${await level()}`);
await click();                                   // first corner
await aimAt(9, 3, 3.52, 7.5, PITCH);
const overhangHint = await hudText('[data-hud="hint"]');
await shot('b1-upper-room-preview.png');
await click();                                   // opposite corner
st = await store();
const extra = st.rooms.find((r) => r.floor === 1 && r.id !== copy.id);
log('a room on Floor 1 that sticks out past the floor below gets a warning, and is still built',
  /nothing under it/.test(overhangHint) && !!extra && near(extra.width, 4.5, 0.01) && near(extra.depth, 6, 0.01),
  `"${overhangHint.slice(0, 80)}" ${extra ? `${extra.width} × ${extra.depth}` : 'not built'}`);

// ── The copied room: 3.5 m up, on a slab, with an opening over the stairs ──
const upperInfo = await p.evaluate((id) => {
  const sc = window.__ahdusScene;
  const node = sc.transformNodes.find((t) => t.name === `room_${id}`);
  const floors = sc.meshes.filter((m) => m.metadata?.roomId === id && m.metadata?.part === 'floor');
  const slabs = sc.meshes.filter((m) => m.metadata?.roomId === id && m.metadata?.part === 'slab');
  return { y: node?.position.y, floorPieces: floors.length, slabPieces: slabs.length };
}, copy.id);
log('Floor 1 room sits 3.5 m up on a slab, with the floor cut open over the stairs',
  upperInfo.y === 3.5 && upperInfo.floorPieces >= 2 && upperInfo.slabPieces >= 2, JSON.stringify(upperInfo));

// ── Outside: the whole building with a roof on top, no roof in between ──
await pose({ x: -9, z: -13, yaw: 0.55, pitch: -0.12, floor: 0, fly: false });
await frames(4);
log('from outside: Floor 1 has a roof; the covered ground-floor roof is hidden; no ceilings',
  (await partShown(copy.id, 'roof')) && !(await partShown(ids.ground, 'roof')) && !(await partShown(copy.id, 'ceiling')));
await shot('b2-outside-two-storeys.png');

// ── Walk up the stairs for real ──
await pose({ x: 2.5, z: -3.5 + 0.9, yaw: 0, pitch: -0.1, floor: 0, fly: false });   // inside, at the foot of the stairs
await frames(3);
log('inside the ground floor: its ceiling shows, and Floor 1 is there above it (seen through the stairwell)',
  (await partShown(ids.ground, 'ceiling')) && (await roomShown(copy.id)));
await shot('b3-foot-of-stairs.png');
await walkUntil('KeyW', (q) => q.y > 3.4 && q.z > 2.2);
q = await pos();
st = await store();
log('walking up the stairs takes you to Floor 1', q.y > 3.4 && (await level()) === 1 && st.currentFloor === 1,
  `y=${q.y.toFixed(2)} z=${q.z.toFixed(2)} level=${await level()}`);
log('upstairs: Floor 1 ceiling shows, and you stand on its floor', (await partShown(copy.id, 'ceiling')) && Math.abs(q.y - 3.52) < 0.05,
  `y=${q.y.toFixed(3)}`);
await shot('b4-top-of-stairs.png');

// ── And back down ──
await p.evaluate(() => window.__ahdusPlay.setPose({ ...(() => { const v = window.__ahdusPlay.getPosition(); return { x: v.x, z: v.z }; })(), yaw: Math.PI, pitch: -0.2 }));
await frames(3);
await walkUntil('KeyW', (q2) => q2.y < 0.2 && q2.z < -2.2);
q = await pos();
log('walking down the stairs takes you back to the ground floor', q.y < 0.2 && (await level()) === 0, `y=${q.y.toFixed(2)} level=${await level()}`);

// ── Page Up / Page Down: the floor above / below at the same spot ──
await pose({ x: -2, z: -1, yaw: 0, pitch: -0.1, floor: 0, fly: false });
await p.keyboard.press('PageUp'); await frames(3);
q = await pos();
const floorLabel = await hudText('[data-hud="floor"]');
log('Page Up: Floor 1 at the same spot, standing on its floor; the HUD says "Floor 2 of 2"',
  (await level()) === 1 && near(q.y, 3.52) && near(q.x, -2, 0.01) && near(q.z, -1, 0.01) && !(await flying()) && /Floor 2 of 2/.test(floorLabel),
  `level ${await level()} y=${q.y.toFixed(2)} "${floorLabel}"`);
await pose({ x: 20, z: 0, yaw: 0, pitch: -0.1, floor: 0, fly: false });
await p.keyboard.press('PageUp'); await frames(3);
q = await pos();
log('Page Up where nothing is built: flying at Floor 1 height', (await level()) === 1 && near(q.y, 3.52) && (await flying()),
  `y=${q.y.toFixed(2)} flying=${await flying()}`);
await p.keyboard.press('PageDown'); await frames(3);
q = await pos();
log('Page Down: back to the ground floor', (await level()) === 0 && q.y < 0.1, `level ${await level()} y=${q.y.toFixed(2)}`);
await p.keyboard.press('KeyF'); await frames(2);   // land

// ── Stretch tool: + / − raises the ground floor's walls; the floor above goes up with them ──
await p.keyboard.press('Digit3'); await frames(2);
await pose({ x: -1, z: -1.5, yaw: Math.PI / 2, pitch: 0.05, floor: 0, fly: false });   // looking at the east wall
await frames(3);
const aimHint = await hudText('[data-hud="hint"]');
for (let i = 0; i < 8; i++) await p.keyboard.press('Equal');     // 3.2 m → 4.0 m
await frames(3);
st = await store();
let ground = st.rooms.find((r) => r.id === ids.ground);
let copyY = await p.evaluate((id) => window.__ahdusScene.transformNodes.find((t) => t.name === `room_${id}`)?.position.y, copy.id);
log('Stretch + in Preview raises the walls 0.1 m a press; past the floor it raises the floor above (4.3 m)',
  /Ground Office/.test(aimHint) && near(ground.wallHeight, 4, 0.001) && near(st.floors.find((f) => f.id === 0).height, 4.3, 0.001) &&
  near(elevation(st.floors, 1), 4.3, 0.001) && near(copyY, 4.3, 0.001),
  `walls ${ground.wallHeight} floor ${st.floors.find((f) => f.id === 0).height} Floor 1 at ${copyY} · "${aimHint.slice(0, 60)}"`);
await p.keyboard.press('Control+z'); await frames(3);
st = await store();
const undone = near(st.floors.find((f) => f.id === 0).height, 3.5, 0.001) && near(st.rooms.find((r) => r.id === ids.ground).wallHeight, 3.2, 0.001);
await p.keyboard.press('Control+y'); await frames(3);
st = await store();
log('Ctrl+Z undoes the whole burst of + in one step (Ctrl+Y redoes it)',
  undone && near(st.floors.find((f) => f.id === 0).height, 4.3, 0.001));

const gap = { walls: await yRange(ids.ground, 'wall'), slab: await yRange(copy.id, 'slab') };
log('no gap: the ground-floor walls (4 m) end exactly where the slab of Floor 1 starts',
  near(gap.walls[1], 4.0, 0.01) && near(gap.slab[0], gap.walls[1], 0.01),
  `walls top ${gap.walls[1].toFixed(3)} · slab bottom ${gap.slab[0].toFixed(3)}`);
await p.keyboard.press('Digit1'); await frames(2);   // an empty-ish hand for the pictures
await pose({ x: -9, z: -13, yaw: 0.55, pitch: -0.05, floor: 0, fly: false });
await frames(4);
await shot('b6-outside-no-gap.png');

// ── The stairs follow the taller floor: they climb 4.3 m now ──
const rise = await p.evaluate((id) => window.__ahdusScene.transformNodes.find((t) => t.name === `arch_stair_${id}`)?.metadata?.rise, ids.stairs);
await pose({ x: 2.5, z: -2.6, yaw: 0, pitch: -0.1, floor: 0, fly: false });
await walkUntil('KeyW', (q2) => q2.y > 4.2 && q2.z > 2.2);
q = await pos();
log('stairs from the 4.3 m floor reach the floor above', near(rise, 4.3, 0.001) && near(q.y, 4.32) && (await level()) === 1,
  `stairs rise ${rise} · y=${q.y.toFixed(2)} level=${await level()}`);

// ── Stairs on the top floor: the roof is cut over them, and the hint says a room is needed above ──
await p.keyboard.press('Digit8'); await frames(2);
await aimAt(-2, 0, 4.32, 4.32, -0.75);
const stairHint = await hudText('[data-hud="hint"]');
await click();
st = await store();
const topStairs = st.objects.find((o) => o.assetType === 'STAIRCASE' && o.floor === 1);
log('placing stairs with no room above: the hint says "Build a room above to use these stairs"',
  /Build a room above to use these stairs/.test(stairHint) && !!topStairs, `"${stairHint.slice(0, 70)}"`);
await frames(3);
const roofOver = topStairs ? await partCovers(copy.id, 'roof', topStairs.x, topStairs.z) : true;
const ceilingOver = topStairs ? await partCovers(copy.id, 'ceiling', topStairs.x, topStairs.z) : true;
log('the roof and ceiling above those stairs are cut open (no solid grey surface over the stairwell)', !roofOver && !ceilingOver,
  topStairs ? `stairs at ${topStairs.x},${topStairs.z}` : 'no stairs');
await p.keyboard.press('Digit1'); await frames(2);
await p.keyboard.press('KeyV'); await frames(1);                 // first person, looking up the stairwell
await pose({ x: topStairs?.x ?? -2, z: (topStairs?.z ?? 0) - 1, yaw: 0, pitch: 1.2, floor: 1, fly: false });
await frames(4);
await shot('b7-stairwell-looking-up.png');
await p.keyboard.press('KeyV'); await frames(1);

// ── Workplace Studio: see one storey at a time ──
await p.keyboard.press('Tab'); await wait(1500);
await p.evaluate(() => window.__ahdusStore.getState().selectFloor(0)); await frames(3);
log('Studio on the ground floor: Floor 1 is hidden so you can see inside', !(await roomShown(copy.id)) && (await roomShown(ids.ground)));
await p.evaluate(() => window.__ahdusStore.getState().selectFloor(1)); await frames(3);
log('Studio on Floor 1: both storeys shown, Floor 1 without its roof',
  (await roomShown(copy.id)) && (await roomShown(ids.ground)) && !(await partShown(copy.id, 'roof')));

// ── Studio on Floor 1: the outline of the floor below shows while building ──
await p.click('[aria-label="Rooms"]'); await frames(1);
await p.click('[aria-label="Rooms options"] button:has-text("Office")'); await frames(3);
const outline = await p.evaluate(() => !!window.__ahdusScene.getMeshByName('floorBelowOutline')?.isEnabled());
await shot('b5-planner-floor1-outline.png');
await p.keyboard.press('Escape'); await frames(2);
log('Studio, Rooms tool on Floor 1: the outline of the ground floor is drawn on it', outline);

// ── Studio: Inspector wall height past the floor raises it; the floor menu sets floor heights ──
await p.evaluate((id) => { const s = window.__ahdusStore.getState(); s.selectFloor(0); s.selectRoom(id); }, ids.ground);
await frames(3);
await p.fill('aside[aria-label="Inspector"] input[aria-label="Wall height"]', '4.5'); await frames(3);
await p.evaluate(() => document.activeElement?.blur());
st = await store();
log('Inspector: 4.5 m walls raise the ground floor to 4.8 m and Floor 1 with it',
  near(st.floors.find((f) => f.id === 0).height, 4.8, 0.001) && near(elevation(st.floors, 1), 4.8, 0.001),
  JSON.stringify(st.floors.map((f) => f.height)));
await p.keyboard.press('Control+z'); await frames(3);
await p.keyboard.press('Escape'); await frames(1);
await p.click('[aria-label="Floor switcher"]'); await frames(1);
const shownHeight = await p.inputValue('input[aria-label="Floor height"]');
await p.fill('input[aria-label="Floor height"]', '5'); await p.press('input[aria-label="Floor height"]', 'Enter'); await frames(3);
st = await store();
ground = st.rooms.find((r) => r.id === ids.ground);
log('floor menu: "Floor height 4.3 m"; 5 m moves Floor 1 up and the walls that filled the floor follow',
  shownHeight === '4.3' && near(elevation(st.floors, 1), 5, 0.001) && near(ground.wallHeight, 4.7, 0.001),
  `showed ${shownHeight} · Floor 1 at ${elevation(st.floors, 1)} · walls ${ground.wallHeight}`);
await p.keyboard.press('Escape'); await frames(1);

// ── Studio: Add floor above → Copy rooms from below ──
await p.click('[aria-label="Floor switcher"]'); await frames(1);
await p.click('[aria-label="Add floor above"]'); await frames(1);
await p.click('[aria-label="Copy rooms from below"]'); await frames(3);
st = await store();
const fp = (r) => [r.x, r.z, r.width, r.depth].join(',');
const f1 = st.rooms.filter((r) => r.floor === 1).map(fp).sort();
const f2 = st.rooms.filter((r) => r.floor === 2).map(fp).sort();
log('Studio "Copy rooms from below": Floor 2 has the same footprints as Floor 1, and Studio shows it',
  f2.length === 2 && JSON.stringify(f1) === JSON.stringify(f2) && st.currentFloor === 2, `${f2.length} rooms on Floor 2`);
await shot('b8-studio-copied-floor.png');

// ── Studio: an empty floor on top shows the outline of the rooms below while drawing ──
await p.click('[aria-label="Floor switcher"]'); await frames(1);
await p.click('[aria-label="Add floor above"]'); await frames(1);
await p.click('[aria-label="Empty floor"]'); await frames(3);
await p.click('[aria-label="Rooms"]'); await frames(1);
await p.click('[aria-label="Rooms options"] button:has-text("Office")'); await frames(3);
st = await store();
const emptyOutline = await p.evaluate(() => !!window.__ahdusScene.getMeshByName('floorBelowOutline')?.isEnabled());
log('"Empty floor" adds Floor 3 with no rooms; the Rooms tool shows the outline of Floor 2 on it',
  st.currentFloor === 3 && !st.rooms.some((r) => r.floor === 3) && emptyOutline);
await shot('b9-outline-on-empty-floor.png');
await p.keyboard.press('Escape'); await frames(1);

log('no page errors', errs.length === 0);
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
