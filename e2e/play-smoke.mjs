// Preview smoke test: builds rooms, doors, windows and furniture with real
// clicks, walks through doors with real collisions, and checks the results.
// The character is positioned with the dev-only setPose hook so results don't
// depend on frame rate; results are checked in the store, not on-screen text.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:play       (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
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
// Wait for n rendered frames (with a timeout, so a paused render loop can't hang the test)
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return { rooms: Object.values(s.rooms), objects: Object.values(s.objects) };
});
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.__ahdusPlay.getPosition(); return { x: v.x, z: v.z }; });
const click = async (button = 'left') => { await p.mouse.down({ button }); await p.mouse.up({ button }); await frames(2); };
const slot = async (n) => { await p.keyboard.press(`Digit${n}`); await frames(3); };
const walk = async (key, ms) => { await p.keyboard.down(key); await wait(ms); await p.keyboard.up(key); await frames(2); };
// Walk until `done(position)` is true (or maxMs passes). Frame-rate independent:
// on a slow machine without a GPU a fixed 2.5 s walk may only cover 2 m.
const walkUntil = async (key, done, maxMs = 20000) => {
  const start = Date.now();
  await p.keyboard.down(key);
  while (Date.now() - start < maxMs && !done(await pos())) await wait(250);
  await p.keyboard.up(key);
  await frames(2);
};
// Where the crosshair hits the ground right now (same maths as the play controller)
const groundAim = () => p.evaluate(() => {
  const r = window.__ahdusScene.activeCamera.getForwardRay(1);
  const t = (0.02 - r.origin.y) / r.direction.y;
  return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
});
// Stand so that, looking down at PITCH, the crosshair lands on (tx, tz)
const aimAtGround = async (yaw, tx, tz, pitch) => {
  let x = tx, z = tz;
  for (let i = 0; i < 3; i++) {
    await pose(x, z, yaw, pitch);
    const g = await groundAim();
    x += tx - g.x; z += tz - g.z;
  }
  await pose(x, z, yaw, pitch);
};
const hudRoom = () => p.locator('[data-hud="room"] strong').first().textContent();
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });

await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Play Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Main'); await p.click('button:has-text("Create")');
await p.waitForSelector('canvas', { timeout: 90000 }); await wait(2500);
// Half resolution keeps it fast on machines without a GPU (CI)
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await p.mouse.move(640, 360);
// The editor opens in Workplace Studio; this test covers Preview
await p.click('[aria-label="Preview Workplace"]'); await wait(800);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")'); await wait(400);
}
log('Preview Workplace opens Preview with the mouse captured', await p.evaluate(() => !!document.pointerLockElement));

// ── 1. Room: two clicks. Same view angle → the aim point moves exactly with the player.
const PITCH = -0.45;
await slot(1);
await pose(0, -10, 0, PITCH); await click();          // corner A
await pose(6, -5, 0, PITCH); await frames(3);          // move 6 m right, 5 m forward
await shot('q1-room-preview.png');
await click();                                         // corner B
let st = await store();
const office = st.rooms[0];
log('two clicks build a 6 × 5 m room', st.rooms.length === 1 && Math.abs(office.width - 6) < 0.01 && Math.abs(office.depth - 5) < 0.01,
  office ? `${office.type} ${office.width} × ${office.depth} at (${office.x}, ${office.z})` : 'none');

// ── 2. Door in the south wall: stand in front, aim at it (camera is 0.85 m over the right shoulder)
const southZ = office.z - office.depth / 2;
await slot(4);
await pose(office.x - 0.85, southZ - 3, 0, 0);
await shot('q2-door-aim.png');
await click();
st = await store();
const door = st.rooms[0].doors?.[0];
log('door goes into the wall you aim at', !!door && door.wall === 'south' && Math.abs(door.offset) < 0.3, JSON.stringify(door));

// ── 3. Walls block you, the door lets you in
await pose(office.x + 2, southZ - 2, 0, 0);            // in front of solid wall
await walkUntil('KeyW', (q) => q.z > southZ, 8000);    // keep pushing into the wall
let pz = (await pos()).z;
log('a solid wall stops you', pz < southZ, `stopped at z=${pz.toFixed(2)} (wall at ${southZ})`);
await pose(office.x + door.offset, southZ - 2, 0, 0); // in front of the door
await walkUntil('KeyW', (q) => q.z > southZ + 0.8);
pz = (await pos()).z;
await frames(3);
log('you can walk in through the door', pz > southZ + 0.3 && /Office/.test(await hudRoom()), `z=${pz.toFixed(2)}, HUD: ${await hudRoom()}`);

// ── 4. Window on the east wall from inside
await slot(5);
await pose(office.x, office.z, Math.PI / 2, 0.05);     // face east
await click();
st = await store();
log('window goes into the east wall', st.rooms[0].windows?.[0]?.wall === 'east', JSON.stringify(st.rooms[0].windows));

// ── 5. Desk: place, remove with right-click, undo
await slot(6);
await pose(office.x - 1, office.z - 1, 0, -0.75);
await click();
st = await store();
const desk = st.objects.find((o) => o.assetType === 'DESK_STANDARD');
log('left-click places a desk on the floor, inside the room', !!desk && desk.roomId === office.id, desk ? `at (${desk.x}, ${desk.z}) y=${desk.y}` : 'none');
await shot('q3-desk.png');
await click('right');
st = await store();
log('right-click removes it', !st.objects.some((o) => o.assetType === 'DESK_STANDARD'));
await p.keyboard.press('Control+z'); await frames(3);
st = await store();
log('Ctrl+Z brings it back', st.objects.some((o) => o.assetType === 'DESK_STANDARD'));

// Monitor on top of the desk (stacking on surfaces)
await p.keyboard.press('KeyB'); await wait(300);
await p.locator('button:has-text("Dual Monitor")').click(); await wait(500);
log('picking from the catalog goes straight back to playing', await p.evaluate(() => !!document.pointerLockElement));
const d2 = (await store()).objects.find((o) => o.assetType === 'DESK_STANDARD');
// Is the crosshair on the desk's top surface right now?
const onDeskTop = (id) => p.evaluate((id) => {
  const sc = window.__ahdusScene;
  const hit = sc.pickWithRay(sc.activeCamera.getForwardRay(20),
    (m) => m.isPickable && m.isEnabled() && m.metadata?.objectId === id);
  return !!hit?.hit && hit.getNormal(true).y > 0.7;
}, id);
// Indoors the camera stays under the ceiling, so search for a stance where the
// crosshair lands on the desk top (stand 0.85 m left: the camera is over the right shoulder)
for (const [dz, pitch] of [[-2.2, -0.42], [-1.8, -0.5], [-1.5, -0.6], [-2.6, -0.35], [-1.2, -0.7], [-1.0, -0.85]]) {
  await pose(d2.x - 0.85, d2.z + dz, 0, pitch);
  if (await onDeskTop(d2.id)) break;
}
await click();
const mon = (await store()).objects.find((o) => o.assetType === 'MONITOR_DUAL');
log('aiming at the desk top stacks the monitor on it', !!mon && mon.y > 0.5, mon ? `monitor y=${mon.y.toFixed(2)}` : 'none');

// ── 6. Second room built against the first: snaps back-to-back, and one door cuts both walls
await slot(2);
const eastX = office.x + office.width / 2;
// (the camera is 0.85 m over the right shoulder, so the aim point is 0.85 m to the player's right)
await pose(eastX + 0.1 - 0.85, -10, 0, PITCH);        // corner A just past the shared wall line
await click();
await pose(eastX + 4.1 - 0.85, -6, 0, PITCH);
await click();
st = await store();
const meeting = st.rooms.find((r) => r.type === 'MEETING');
const gap = meeting ? (meeting.x - meeting.width / 2) - eastX : NaN;
log('a room drawn against another snaps back-to-back', !!meeting && Math.abs(gap - 0.15) < 0.01, `gap=${gap.toFixed(3)} m`);

await slot(4);
// inside the office facing the shared wall, aiming 1.5 m north of centre (away from the window);
// facing east, the shoulder camera's "right" is -Z, so stand 0.85 m further north
await pose(eastX - 3, office.z + 1.5 + 0.85, Math.PI / 2, 0);
await shot('q-shared-door-aim.png');
await click();
st = await store();
const o1 = st.rooms.find((r) => r.id === office.id);
const m1 = st.rooms.find((r) => r.type === 'MEETING');
log('one click puts a door through both walls', o1.doors.some((d) => d.wall === 'east') && m1.doors.some((d) => d.wall === 'west'),
  `office: ${JSON.stringify(o1.doors.map((d) => d.wall))}, meeting: ${JSON.stringify(m1.doors.map((d) => d.wall))}`);
const shared = o1.doors.find((d) => d.wall === 'east');
await pose(eastX - 2, office.z + shared.offset, Math.PI / 2, 0);   // line up with the doorway
await walkUntil('KeyW', (q) => q.x > eastX + 1);
await frames(3);
log('walk from one room into the next', /Meeting/.test(await hudRoom()), await hudRoom());

// ── 6b. Stretch: grab the office's north wall and push it out 2 m
await slot(3);
const before = (await store()).rooms.find((r) => r.id === office.id);
const northZ = before.z + before.depth / 2;
await pose(before.x - 0.85 - 1, before.z, 0, 0);        // inside, facing the north wall
await click();                                           // grab it
await aimAtGround(0, before.x, northZ + 2, PITCH);       // look at the ground 2 m past the wall
await shot('q-stretch-preview.png');
await click();                                           // drop it
let grown = (await store()).rooms.find((r) => r.id === office.id);
log('Stretch: grab a wall and push it out 2 m', Math.abs(grown.depth - (before.depth + 2)) < 0.01 &&
  Math.abs((grown.z - grown.depth / 2) - (before.z - before.depth / 2)) < 0.01,
  `${before.width} × ${before.depth} → ${grown.width} × ${grown.depth}`);
await p.keyboard.press('Control+z'); await frames(3);
const undone = (await store()).rooms.find((r) => r.id === office.id);
await p.keyboard.press('Control+y'); await frames(3);
const redone = (await store()).rooms.find((r) => r.id === office.id);
log('Ctrl+Z / Ctrl+Y undo and redo the stretch', undone.depth === before.depth && redone.depth === grown.depth,
  `undo → ${undone.depth}, redo → ${redone.depth}`);

// Pushing the office's east wall into the meeting room is refused
const r0 = (await store()).rooms.find((r) => r.id === office.id);
await pose(r0.x, r0.z + 0.85 - 1, Math.PI / 2, 0);    // inside, facing the shared east wall
await click();                                           // grab
await aimAtGround(Math.PI / 2, eastX + 2, r0.z, PITCH);
await shot('q-stretch-blocked.png');
await click();                                           // try to drop: should do nothing
await click('right');                                    // cancel
const r1 = (await store()).rooms.find((r) => r.id === office.id);
log('Stretch refuses to overlap the next room', r1.width === r0.width && r1.x === r0.x, `width ${r0.width} → ${r1.width}`);

// ── 7. Outside view of what we built
await pose(office.x - 6, office.z - 14, 0.35, -0.2);
await frames(4);
await shot('q4-outside.png');
await pose(office.x + 1.5, office.z - 1.8, -0.3, -0.25);
await frames(4);
await shot('q5-inside.png');

// ── 8. Tab: Workplace Studio shows the same layout
await p.keyboard.press('Tab'); await wait(1200);
st = await store();
const floorText = await p.locator('[aria-label="Floor switcher"]').textContent().catch(() => '');
log('Tab opens Workplace Studio with what was built', st.rooms.length === 2 && st.objects.length === 2 && /2 rooms/.test(floorText),
  `${st.rooms.length} rooms, ${st.objects.length} items; footer: ${floorText}`);
await shot('q6-planner.png');

log('no page errors', errs.length === 0);
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
