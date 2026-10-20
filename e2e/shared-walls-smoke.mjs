// Shared-wall smoke test: two rooms back to back get ONE physical wall and one
// doorway through it, before and after saving and reopening the layout.
// The room whose id sorts first builds the shared wall, so every check runs
// twice, with the ids forced both ways round: picking must not depend on it.
//   Studio: clicking the shared wall from a side selects the room on that side,
//           its outline includes the wall, and dragging it resizes that room.
//   Preview: Stretch's − on the shared wall lowers the room on your side.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev                (in one terminal)
//                   npm run e2e:shared-walls   (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screens', { recursive: true });

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await browser.newPage({ viewport: { width: 1280, height: 760 } });
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
  t = setTimeout(done, 60000);
}), n);
const rooms = () => p.evaluate(() => window.__ahdusStore.getState().rooms);
const selected = () => p.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });

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
const hover = async (x, y, z) => {
  await wait(250); await frames(1);
  const s = await toScreen(x, y, z);
  await p.mouse.move(s.x - 3, s.y - 3);
  await p.mouse.move(s.x, s.y, { steps: 3 });
  await frames(2);
};
const clickAt = async (x, y, z) => { await hover(x, y, z); await p.mouse.down(); await p.mouse.up(); await frames(3); };
const dragWorld = async (from, to) => {
  await hover(...from);
  await p.mouse.down();
  const s = await toScreen(...to);
  await p.mouse.move(s.x, s.y, { steps: 10 });
  await frames(2);
  await p.mouse.up();
  await frames(3);
};
// Studio 3D camera: from inside a room, looking at its side of the shared wall
const lookFrom = (target, alpha) => p.evaluate(([t, alpha]) => {
  const cam = window.__ahdusScene.activeCamera;
  const V = cam.position.constructor;
  cam.setTarget(new V(t[0], t[1], t[2]));
  cam.alpha = alpha; cam.beta = 1.0; cam.radius = 5;
}, [target, alpha]);

// The shared wall of a pair: built by ONE of the two rooms, whichever that is
await p.addInitScript(() => {
  window.__sharedWalls = ({ westId, eastId }) => (window.__ahdusScene?.meshes ?? []).filter((mesh) =>
    mesh.name.startsWith('wall_') && mesh.metadata?.part === 'wall' && !!mesh.metadata.sharedWith &&
    ((mesh.metadata.roomId === westId && mesh.metadata.sharedWith === eastId) ||
     (mesh.metadata.roomId === eastId && mesh.metadata.sharedWith === westId)));
});

await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Shared Wall Test'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Shared Wall Layout');
await p.press('input[placeholder="Layout name…"]', 'Enter');
await p.waitForSelector('canvas', { timeout: 90000 });
await p.waitForFunction(() => window.__ahdusStore && window.__ahdusScene);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await frames(2);

// Two pairs, 8 × 6 m rooms back to back (wall faces at x 3.0 and 3.15), one door between them.
// Pair A: the west room's id sorts first, so it builds the wall; pair B: the east room's.
const WALL_X = 3.075;
const pairs = [
  { name: 'west builds it', westId: 'room_a_west', eastId: 'room_b_east', z0: 0, owner: 'west' },
  { name: 'east builds it', westId: 'room_z_west', eastId: 'room_b_east2', z0: 20, owner: 'east' },
];
await p.evaluate((pairs) => {
  const store = window.__ahdusStore.getState();
  for (const { westId, eastId, z0 } of pairs) {
    store.addRoom({ id: westId, type: 'OFFICE', name: `West ${z0}`, x: -1, z: z0, width: 8, depth: 6, floor: 0 });
    store.addRoom({ id: eastId, type: 'MEETING', name: `East ${z0}`, x: 7.15, z: z0, width: 8, depth: 6, floor: 0 });
    store.updateRoom(westId, { doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] });
    store.updateRoom(eastId, { doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] });
  }
  store.selectRoom(null);
}, pairs);

const wallState = (pair) => p.evaluate(({ westId, eastId }) => {
  const walls = window.__sharedWalls({ westId, eastId });
  const doorPanes = window.__ahdusScene.meshes.filter((mesh) =>
    [westId, eastId].includes(mesh.metadata?.roomId) && mesh.metadata?.part === 'door' && mesh.metadata.pickPane);
  const box = walls[0]?.getBoundingInfo().boundingBox;
  return {
    owner: !walls[0] ? null : walls[0].metadata.roomId === westId ? 'west' : 'east',
    wallCount: walls.length,
    x: box ? (box.minimumWorld.x + box.maximumWorld.x) / 2 : null,
    thickness: box ? box.maximumWorld.x - box.minimumWorld.x : null,
    doorPanes: doorPanes.length,
    roomDoors: [westId, eastId].map((id) => window.__ahdusStore.getState().rooms[id].doors.length),
  };
}, pair);
const looksRight = (pair, g) => g.owner === pair.owner && g.wallCount === 1 && Math.abs(g.x - WALL_X) < 0.005 &&
  Math.abs(g.thickness - 0.15) < 0.005 && g.doorPanes === 1 && g.roomDoors.every((count) => count === 1);
const sharedWallOutlined = (pair) => p.evaluate((pair) => window.__sharedWalls(pair).every((m) => m.renderOutline), pair);

await p.waitForFunction((pairs) => document.querySelector('.studio-header__status')?.textContent === 'Saved' &&
  pairs.every((pair) => window.__sharedWalls(pair).length > 0), pairs, { timeout: 60000 });
for (const pair of pairs) {
  const g = await wallState(pair);
  log(`${pair.name}: the shared wall is built once, with one doorway`, looksRight(pair, g), JSON.stringify(g));
}

// ── Studio (3D): click the shared wall from each side ──
await p.click('[aria-label="3D view"]'); await frames(3);
await p.click('[aria-label="Select"]'); await frames(2);
for (const pair of pairs) {
  const z = pair.z0 - 1.5; // beside the door
  const sides = [
    { side: 'west', id: pair.westId, face: [3.0, 1.5, z], target: [2.5, 1.0, z], alpha: Math.PI, inside: [2.0, 0.02, z] },
    { side: 'east', id: pair.eastId, face: [3.15, 1.5, z], target: [3.65, 1.0, z], alpha: 0, inside: [4.15, 0.02, z] },
  ];
  await p.evaluate(() => window.__ahdusStore.getState().selectRoom(null)); await frames(2);
  for (const s of sides) {
    await lookFrom(s.target, s.alpha); await frames(3);
    await clickAt(...s.face);
    const sel = await selected();
    const lit = await sharedWallOutlined(pair);
    log(`${pair.name}: Studio, clicking it from the ${s.side} selects the ${s.side} room, outline includes the wall`,
      sel === s.id && lit, `selected ${sel}, outlined ${lit}`);
  }
  await shot(`sw-studio-${pair.owner}-owner.png`);

  // Drag it from the side of the room that does NOT build it: that room gets narrower
  const s = sides.find((x) => x.side !== pair.owner);
  const other = sides.find((x) => x.side === pair.owner);
  await lookFrom(s.target, s.alpha); await frames(3);
  await clickAt(...s.face);                              // select the room on that side
  const before = await rooms();
  await dragWorld(s.face, s.inside);                     // pull the wall 1 m into it
  const after = await rooms();
  const narrower = after[s.id].width < before[s.id].width - 0.5;
  const untouched = after[other.id].width === before[other.id].width && after[other.id].x === before[other.id].x;
  log(`${pair.name}: Studio, dragging it from the ${s.side} resizes the ${s.side} room only`, narrower && untouched,
    `${s.side} ${before[s.id].width} → ${after[s.id].width}, ${other.side} ${before[other.id].width} → ${after[other.id].width}`);
  await p.keyboard.press('Control+z'); await frames(3);
}

// ── Save, reopen: the same geometry is derived again ──
await p.waitForFunction(() => document.querySelector('.studio-header__status')?.textContent === 'Saved', null, { timeout: 60000 });
await p.click('[aria-label="All layouts"]');
await p.waitForSelector('button[aria-label="Open Shared Wall Layout"]', { timeout: 30000 });
await p.click('button[aria-label="Open Shared Wall Layout"]');
await p.waitForSelector('canvas', { timeout: 90000 });
await p.waitForFunction((pairs) => window.__ahdusScene && window.__ahdusStore &&
  pairs.every((pair) => window.__sharedWalls(pair).length > 0), pairs, { timeout: 60000 });
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
for (const pair of pairs) {
  const g = await wallState(pair);
  log(`${pair.name}: after reopening, still one shared wall and one doorway`, looksRight(pair, g), JSON.stringify(g));
}

// ── Preview: Stretch's − on the shared wall lowers the room on your side ──
await p.mouse.move(640, 380);
await p.click('[aria-label="Preview Workplace"]'); await wait(800);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")'); await wait(400);
}
await p.keyboard.press('Digit3'); await frames(3);       // Stretch
for (const pair of pairs) {
  const z = pair.z0 - 1.5;
  // the camera sits 0.85 m over the right shoulder: facing east that is −Z, facing west +Z
  const sides = [
    { side: 'west', id: pair.westId, other: pair.eastId, pose: { x: 3.0 - 3, z: z + 0.85, yaw: Math.PI / 2, pitch: 0 } },
    { side: 'east', id: pair.eastId, other: pair.westId, pose: { x: 3.15 + 3, z: z - 0.85, yaw: -Math.PI / 2, pitch: 0 } },
  ];
  for (const s of sides) {
    await p.evaluate((a) => window.__ahdusPlay.setPose({ ...a, floor: 0 }), s.pose); await frames(3);
    const before = await rooms();
    await p.keyboard.press('Minus'); await frames(3);
    const after = await rooms();
    const lowered = after[s.id].wallHeight < before[s.id].wallHeight - 0.05;
    const untouched = after[s.other].wallHeight === before[s.other].wallHeight;
    log(`${pair.name}: Preview, Stretch − on it from the ${s.side} lowers the ${s.side} room only`, lowered && untouched,
      `${s.side} ${before[s.id].wallHeight} → ${after[s.id].wallHeight}, other ${before[s.other].wallHeight} → ${after[s.other].wallHeight}`);
    await p.keyboard.press('Control+z'); await frames(3);
  }
}
await shot('sw-preview.png');

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
