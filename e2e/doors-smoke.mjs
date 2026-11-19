// Doors, windows and glass (v0.18.1). Studio: the Doors & windows library (8 types), a glass door placed with the
// tool (half open: the swing shows), a shared door's type changed from one side = both records, an emergency exit
// out of the room it was placed from, one undo step; a new Meeting room's first door makes that wall glass (A2: undo
// / redo), the Inspector's glass walls + undo, still selectable; save + reopen; an upper floor. viewer.html: every
// door shut from above, walking up opens it, walking on closes it behind; Take me there through a double glass door;
// a live person walking opens one, one upstairs opens none here; never more than 4 at once (A5); through a glass
// wall: the person's card, a click on the floor behind walks round by the door, no door = "it has no door" (A4).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:doors      (in another)
// SHOTS=<dir>: screenshots (each door shut and open, the glass meeting room with people inside, the new room
// types, the library). Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
const shotDir = SHOTS || 'e2e/screens';
mkdirSync(shotDir, { recursive: true });
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
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: join(shotDir, name), timeout: 120000 });

// ════════════════════════════ Studio ════════════════════════════
const S = {};
const frames = (n = 3, hook = '__ahdusScene') => page.evaluate(([n, hook]) => new Promise((res) => {
  const sc = hook === '__ahdusScene' ? window.__ahdusScene : window.__ahdusViewer.scene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 60000);
}), [n, hook]);
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const scene = window.__ahdusScene ?? window.__ahdusViewer.scene;
  const camera = scene.activeCamera;
  const engine = scene.getEngine();
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const Vector = camera.position.constructor;
  const matrix = scene.getTransformMatrix().constructor;
  const point = Vector.Project(new Vector(x, y, z), matrix.Identity(), scene.getTransformMatrix(), viewport);
  const canvas = engine.getRenderingCanvas().getBoundingClientRect();
  const scale = canvas.width / engine.getRenderWidth();
  return { x: canvas.left + point.x * scale, y: canvas.top + point.y * scale };
}, [x, y, z]);
const hover = async (x, y, z) => { const p = await toScreen(x, y, z); await page.mouse.move(p.x, p.y, { steps: 3 }); await frames(2); };
const clickAt = async (x, y, z) => { await hover(x, y, z); await page.mouse.down(); await page.mouse.up(); await frames(3); };
const tile = async (label) => { await page.click(`[aria-label="${label}"]`); await frames(2); };
const LIBRARY = { Rooms: 'rooms', 'Doors & Windows': 'doors' };
const openLib = async (tileLabel) => {
  const lib = `[data-library="${LIBRARY[tileLabel]}"]`;
  if (!(await page.locator(lib).isVisible().catch(() => false))) await tile(tileLabel);
  return lib;
};
const pick = async (tileLabel, option) => {
  const lib = await openLib(tileLabel);
  await page.click(`${lib} .lib-tile:has(.lib-tile__name:text-is("${option}"))`);
  await frames(2);
  await tile(tileLabel);
  await wait(250); await frames(2);
};
const look2D = async (x, z, half) => {
  await page.evaluate(([x, z, half]) => {
    const c = window.__ahdusScene.activeCamera;
    c.target.x = x; c.target.z = z;
    const a = window.__ahdusScene.getEngine().getAspectRatio(c);
    c.orthoTop = half; c.orthoBottom = -half; c.orthoLeft = -half * a; c.orthoRight = half * a;
  }, [x, z, half]);
  await frames(3);
};
const room = (id) => page.evaluate((id) => window.__ahdusStore.getState().rooms[id], id);
const undo = async () => { await page.keyboard.press('Control+z'); await frames(3); };
const redo = async () => { await page.keyboard.press('Control+y'); await frames(3); };

try {
  await page.goto(base);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.fill('input[placeholder="Company name…"]', 'Doors Test');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('input[placeholder="Layout name…"]', { timeout: 30000 });
  await page.fill('input[placeholder="Layout name…"]', 'Doors Layout');
  await page.press('input[placeholder="Layout name…"]', 'Enter');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusStore && window.__ahdusScene && window.__ahdusDoors);
  await page.waitForSelector('[data-splash]', { state: 'detached', timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  // two offices back to back: a (x −4 … 0) and b (x 0.15 … 4.15), z −3 … 3
  Object.assign(S, await page.evaluate(() => {
    const st = window.__ahdusStore.getState();
    const a = st.addRoom({ type: 'OFFICE', name: 'Office A', x: -2, z: 0, width: 4, depth: 6, floor: 0, wallHeight: 3 }).id;
    const b = st.addRoom({ type: 'OFFICE', name: 'Office B', x: 2.15, z: 0, width: 4, depth: 6, floor: 0, wallHeight: 3 }).id;
    st.selectRoom(null);
    return { a, b };
  }));
  await page.click('[aria-label="2D view"]');
  await wait(1500);
  await look2D(0, 0, 7);

  // ── The library: one tile per type ──
  const lib = await openLib('Doors & Windows');
  const names = await page.$$eval(`${lib} .lib-tile .lib-tile__name`, (els) => els.map((e) => e.textContent.trim()));
  const want = ['Door', 'Glass door', 'Double glass door', 'Sliding glass door', 'Emergency exit', 'Window', 'Tall window', 'Glass panel'];
  if (SHOTS) await shot('studio-doors-windows-library.png');
  log('Doors & windows library: a tile for each door and window type, with its picture',
    want.every((n) => names.includes(n)) && (await page.$$(`${lib} .lib-tile svg`)).length >= 8, JSON.stringify(names));
  await tile('Doors & Windows');

  // ── A glass door with the tool, on Office A's south wall: half open in Studio ──
  await pick('Doors & Windows', 'Glass door');
  await clickAt(-2, 0.5, -3);
  const a1 = await room(S.a);
  const studioOpen = await page.evaluate(() => {
    const d = window.__ahdusDoors; const g = d.list.find((x) => x.style === 'glass');
    return { open: g ? d.openOf(g.key) : null, n: d.list.length, glassLeaves: d.leafMeshes.find((m) => m.name === 'door_leaves_glass')?.thinInstanceCount ?? 0 };
  });
  log('the Glass door tool puts a glass door (1.0 m) in the wall; Studio shows it half open',
    a1.doors?.[0]?.style === 'glass' && a1.doors[0].width === 1 && studioOpen.open === 0.5 && studioOpen.glassLeaves >= 1,
    JSON.stringify({ door: a1.doors?.[0], studioOpen }));

  // ── A wooden door through the shared wall, then its type changed from Office B's side ──
  await pick('Doors & Windows', 'Door');
  await clickAt(0.075, 0.5, 1.5);
  const shared = await page.evaluate(({ a, b }) => {
    const r = window.__ahdusStore.getState().rooms;
    return { a: r[a].doors.length, b: r[b].doors.length, doors: window.__ahdusDoors.list.length };
  }, S);
  log('a door in the shared wall: a record in each room, ONE door drawn', shared.a === 2 && shared.b === 1 && shared.doors === 2, JSON.stringify(shared));
  await tile('Select');
  await page.evaluate(({ b }) => window.__ahdusStore.getState().selectOpening?.({ roomId: b, kind: 'door', index: 0 }), S);
  await frames(3);
  const hasSelect = await page.waitForSelector('[aria-label="Door type"]', { timeout: 15000 }).then(() => true, () => false);
  if (hasSelect) await page.selectOption('[aria-label="Door type"]', 'exit');
  await frames(4);
  const exit = await page.evaluate(({ a, b }) => {
    const r = window.__ahdusStore.getState().rooms;
    const d = window.__ahdusDoors.list.find((x) => x.style === 'exit');
    return { a: r[a].doors[1], b: r[b].doors[0], owner: d?.roomId, side: d?.side, signs: window.__ahdusScene.meshes.filter((m) => m.subMeshes?.some((s) => m.material?.subMaterials?.[s.materialIndex]?.name === 'mat_exitSign') || m.material?.name === 'mat_exitSign').length };
  }, S);
  log('Emergency exit chosen from Office B: both records change, it swings OUT of Office B (into A), its sign shows',
    exit.a?.style === 'exit' && exit.b?.style === 'exit' && exit.b?.swing === 'out' && exit.a?.swing === 'in' &&
    exit.owner === S.b && exit.side?.x === -1 && exit.signs >= 1, JSON.stringify(exit));
  await page.click('[aria-label="Undo"]');
  await frames(3);
  const undone = await page.evaluate(({ a, b }) => {
    const r = window.__ahdusStore.getState().rooms;
    return [r[a].doors[1].style ?? 'wood', r[b].doors[0].style ?? 'wood', r[b].doors[0].swing ?? null];
  }, S);
  log('one Undo: both back to a wooden door', undone.join() === 'wood,wood,', JSON.stringify(undone));

  // ── A2: a new Meeting room from the library: its first door makes that wall glass, in one undo step ──
  await page.evaluate(() => window.__ahdusStore.getState().selectRoom(null));
  await look2D(0, 10, 8);
  const roomsLib = await openLib('Rooms');
  await page.click(`${roomsLib} .lib-tile:has(.lib-tile__name:text-is("Meeting Room"))`);
  await frames(4);
  await tile('Rooms');
  S.m = await page.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
  const m0 = await room(S.m);
  log('a new Meeting room starts solid, waiting for its first door', m0?.type === 'MEETING' && !m0.glassWalls?.length && m0.glassOnFirstDoor === true,
    JSON.stringify({ type: m0?.type, glass: m0?.glassWalls, wait: m0?.glassOnFirstDoor }));
  await page.evaluate(() => window.__ahdusStore.getState().selectRoom(null));
  await look2D(m0.x, m0.z, 6);
  await pick('Doors & Windows', 'Door');
  await clickAt(m0.x, 0.5, m0.z - m0.depth / 2);
  const m1 = await room(S.m);
  await tile('Select');
  await undo();
  const m2 = await room(S.m);
  await redo();
  const m3 = await room(S.m);
  log('its first door turns that wall glass; one Ctrl+Z takes both away, Ctrl+Y brings both back',
    m1.doors.length === 1 && m1.glassWalls?.join() === 'south' && !m1.glassOnFirstDoor &&
    m2.doors.length === 0 && !m2.glassWalls?.length && m2.glassOnFirstDoor === true &&
    m3.doors.length === 1 && m3.glassWalls?.join() === 'south',
    JSON.stringify({ m1: [m1.doors.length, m1.glassWalls], m2: [m2.doors.length, m2.glassWalls, m2.glassOnFirstDoor], m3: [m3.doors.length, m3.glassWalls] }));

  // ── The Inspector's glass walls; a glass wall is still selectable ──
  await page.evaluate(({ a }) => window.__ahdusStore.getState().selectRoom(a), S);
  await frames(3);
  const glassBtn = await page.waitForSelector('[data-glass-wall="north"]', { timeout: 15000 }).then(() => true, () => false);
  if (glassBtn) await page.click('[data-glass-wall="north"]');
  await frames(4);
  const g1 = await room(S.a);
  const pressed = await page.getAttribute('[data-glass-wall="north"]', 'aria-pressed').catch(() => null);
  const glassMeshes = await page.evaluate(({ a }) => window.__ahdusScene.meshes.filter((m) => m.metadata?.roomId === a && m.metadata?.glass).length, S);
  await page.evaluate(() => window.__ahdusStore.getState().selectRoom(null));
  await frames(2);
  await look2D(-2, 0, 6);
  await clickAt(-2, 3, 3);
  const picked = await page.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
  log('Inspector: North wall → glass (pressed, a glass wall mesh); a click on it still selects the room',
    g1.glassWalls?.join() === 'north' && pressed === 'true' && glassMeshes >= 1 && picked === S.a,
    JSON.stringify({ glass: g1.glassWalls, pressed, glassMeshes, picked: picked === S.a }));
  await undo();
  const g2 = await room(S.a);
  log('Ctrl+Z: solid again', !g2.glassWalls?.length, JSON.stringify(g2.glassWalls ?? null));
  await redo();

  // ── Save + reopen: everything still there ──
  await page.keyboard.press('Control+s');
  await wait(1500);
  await page.reload();
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.click('text=Doors Test');
  await page.click('button[aria-label="Open Doors Layout"]', { timeout: 120000 });
  await page.waitForFunction(() => window.__ahdusStore && Object.keys(window.__ahdusStore.getState().rooms).length >= 3, null, { timeout: 120000 });
  await page.waitForSelector('[data-splash]', { state: 'detached', timeout: 120000 }).catch(() => {});
  const back = await page.evaluate(({ a, b, m }) => {
    const r = window.__ahdusStore.getState().rooms;
    return { a: r[a]?.doors?.map((d) => d.style ?? 'wood'), glass: r[a]?.glassWalls, b: r[b]?.doors?.length, m: r[m]?.glassWalls, doors: window.__ahdusDoors?.list.length };
  }, S);
  log('saved and opened again: door types, glass walls and the Meeting room glass are kept',
    back.a?.join() === 'glass,wood' && back.glass?.join() === 'north' && back.m?.join() === 'south' && back.doors === 3, JSON.stringify(back));

  // ── An upper floor: a glass door there ──
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  await page.click('[aria-label="Floor switcher"]'); await frames(1);
  await page.click('[aria-label="Add floor above"]'); await frames(1);
  await page.click('[aria-label="Empty floor"]');
  await frames(4);
  S.up = await page.evaluate(() => {
    const st = window.__ahdusStore.getState();
    return st.addRoom({ type: 'OFFICE', name: 'Upstairs', x: -2, z: 0, width: 4, depth: 6, floor: st.currentFloor, wallHeight: 3 }).id;
  });
  await page.evaluate(() => window.__ahdusStore.getState().selectRoom(null));
  await page.click('[aria-label="2D view"]').catch(() => {});
  await look2D(-2, 0, 6);
  await pick('Doors & Windows', 'Glass door');
  const y1 = 3.5; // the ground floor's height
  await clickAt(-2, y1 + 0.5, -3);
  const up = await page.evaluate(({ up }) => {
    const r = window.__ahdusStore.getState().rooms[up];
    const d = window.__ahdusDoors.list.find((x) => x.roomId === up);
    return { style: r.doors?.[0]?.style, floor: r.floor, door: !!d, open: d ? window.__ahdusDoors.openOf(d.key) : null };
  }, S);
  if (SHOTS) {
    await page.evaluate(() => {
      const st = window.__ahdusStore.getState();
      st.selectFloor(0);
      ['CAFETERIA', 'LOUNGE', 'CABIN', 'TRAINING', 'LOBBY'].forEach((type, i) => st.addRoom({ type, name: { TRAINING: 'Training Room' }[type] ?? type[0] + type.slice(1).toLowerCase(),
        floor: 0, x: -14 + i * 7, z: 14, width: 6.5, depth: 6, wallHeight: 3, doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] }));
      st.selectRoom(null);
    });
    await page.click('[aria-label="3D view"]'); await frames(3);
    await page.evaluate(() => { const c = window.__ahdusScene.activeCamera; c.target.set(0, 0, 13); c.alpha = -Math.PI / 2 - 0.25; c.beta = 0.85; c.radius = 30; });
    await wait(2500); await frames(4);
    await shot('studio-new-room-types.png');
  }
  log('Floor 1: a glass door there too, half open', up.style === 'glass' && up.floor === 1 && up.door && up.open === 0.5, JSON.stringify(up));
} catch (e) {
  log('Studio part ran to the end', false, String(e?.message ?? e).slice(0, 300));
}

// ════════════════════════════ The viewer ════════════════════════════
// The hall (x −16 … 16, z −10 … 10), its entrance: a double glass door in the south wall. Five small rooms along
// z −6 … −2, one per door type, each door in their south wall. A glass meeting room (x −11 … −5, z 2 … 7), its
// south wall glass, its door in the EAST wall (4 m along), a desk with Asha at it. Floor 1: a room right above.
const STYLES = [['wood', -11.5, 1], ['glass', -6, 1], ['double-glass', -0.5, 1.8], ['sliding-glass', 5, 1.8], ['exit', 10.5, 1]];
const little = ([style, x, w]) => ({
  id: `r_${style}`, type: 'OFFICE', name: `${style} room`, floor: 0, x, z: -4, width: 4, depth: 4, wallHeight: 3,
  doors: [{ wall: 'south', offset: 0, width: w, height: 2.1, ...(style === 'wood' ? {} : { style }), ...(style === 'exit' ? { swing: 'out' } : {}) }], windows: [],
});
const item = (id, assetType, x, z, rotationY = 0, floor = 0) => ({ id, assetType, floor, x, y: 0, z, rotationX: 0, rotationY, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false });
const meeting = (doors) => ({
  id: 'r_meet', type: 'MEETING', name: 'Glass Meeting', floor: 0, x: -8, z: 4.5, width: 6, depth: 5, wallHeight: 3,
  glassWalls: ['south'], doors, windows: [],
});
const MEET_DOOR = [{ wall: 'east', offset: 1.5, width: 1, height: 2.1 }];
const layout = (meetDoors = MEET_DOOR) => ({
  layoutName: 'Doors test',
  rooms: [
    { id: 'r_hall', type: 'CUSTOM', name: 'Hall', floor: 0, x: 0, z: 0, width: 32, depth: 20, wallHeight: 3,
      doors: [{ wall: 'south', offset: 0, width: 1.8, height: 2.1, style: 'double-glass' }], windows: [] },
    ...STYLES.map(little),
    meeting(meetDoors),
    { id: 'r_up', type: 'OFFICE', name: 'Upstairs', floor: 1, x: -0.5, z: -4, width: 6, depth: 6, wallHeight: 3,
      doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1, style: 'glass' }], windows: [] },
  ],
  objects: [item('desk_m', 'DESK_STANDARD', -8, 5.5, Math.PI), item('chair_m', 'CHAIR_OFFICE', -8, 6.3, Math.PI),
    item('desk_m2', 'DESK_STANDARD', -9.6, 3.6, Math.PI), item('chair_m2', 'CHAIR_OFFICE', -9.6, 4.4, Math.PI)],
  floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }, { id: 1, name: 'Floor 1', height: 3.5 }],
  anchorData: {},
});

const V = (fn, arg) => page.evaluate(fn, arg);
const vframes = (n = 3) => frames(n, 'viewer');
const pos = () => V(() => { const w = window.__ahdusViewer.walkthrough; const v = w.getPosition(); return { x: v.x, z: v.z, floor: w.getLevel() }; });
const openOf = (style) => V((style) => { const d = window.__ahdusViewer.doors; const x = d.list.find((k) => k.roomId === `r_${style}`); return x ? d.openOf(x.key) : -1; }, style);
const allShut = () => V(async () => { const d = window.__ahdusViewer.doors; const t = performance.now(); while (d.animated && performance.now() - t < 60000) await new Promise((r) => setTimeout(r, 250)); return d.animated; });
async function holdUntil(key, done, ms = 90000) {
  const start = Date.now();
  await page.keyboard.down(key);
  let q = await pos();
  while (Date.now() - start < ms && !(await done(q))) { await wait(150); q = await pos(); }
  await page.keyboard.up(key);
  await vframes(2);
  return q;
}
const pose = async (a) => { await V((a) => window.__ahdusViewer.walkthrough.setPose(a), a); await vframes(3); };

try {
  await page.goto(new URL('viewer.html?mode=view', base).href);
  await page.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
  await V(async (layout) => {
    const e = window.__ahdusViewer;
    await e.whenBuilt();
    e.loadLayout(layout);
    await e.whenBuilt();
    await e.whenNavigationReady();
    e.setPeople([{ personId: 'p_asha', deskId: 'desk_m', name: 'Asha Patel', department: 'Sales', character: null },
      { personId: 'p_dev', deskId: 'desk_m2', name: 'Dev Rao', department: 'Sales', character: null }]);
  }, layout());
  await V((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await vframes(4);
  const above = await V(() => {
    const d = window.__ahdusViewer.doors;
    return { n: d.list.length, animated: d.animated, meshes: d.leafMeshes.length, pickable: d.leafMeshes.some((m) => m.isPickable),
      collide: d.leafMeshes.some((m) => m.checkCollisions) };
  });
  log('viewer from above: 8 doors (one per doorway), all shut, ≤ 4 meshes, not pickable, no collisions',
    above.n === 8 && above.animated === 0 && above.meshes <= 4 && !above.pickable && !above.collide, JSON.stringify(above));

  // ── Walking up to each door opens it; walking on, it closes behind ──
  await V(() => window.__ahdusViewer.setMode('walkthrough'));
  await page.mouse.move(640, 120);
  await vframes(3);
  for (const [style, x] of STYLES) {
    await pose({ x, z: -9.2, yaw: 0, pitch: -0.05, floor: 0 });
    await wait(400); await vframes(3);
    const shut = await openOf(style);
    if (SHOTS) await shot(`door-${style}-shut.png`);
    const near = await holdUntil('KeyW', async () => (await openOf(style)) >= 1, 60000);
    const opened = await openOf(style);
    if (SHOTS) await shot(`door-${style}-open.png`);
    let closed = -1;
    if (style === 'wood' || style === 'sliding-glass') {
      await holdUntil('KeyW', async (q) => q.z > -3.2, 60000); // inside the room, 2 m past the door
      const t = Date.now();
      while (Date.now() - t < 60000 && (await openOf(style)) > 0) await wait(300);
      closed = await openOf(style);
    }
    log(`${style}: shut until you come, open as you reach it${closed >= 0 ? ', shut again behind you' : ''}`,
      shut === 0 && opened === 1 && (closed === -1 || closed === 0), JSON.stringify({ shut, opened, closed, at: near }));
  }

  // ── Take me there through the double glass door ──
  await pose({ x: -0.5, z: -9.5, yaw: 0, pitch: -0.05, floor: 0 });
  await wait(1200);
  const went = await V(async () => {
    const e = window.__ahdusViewer;
    const d = e.doors.list.find((k) => k.style === 'double-glass' && k.roomId === 'r_double-glass');
    let max = 0;
    const o = e.scene.onAfterRenderObservable.add(() => { max = Math.max(max, e.doors.openOf(d.key)); });
    const states = [];
    const off = e.on('navigation', (ev) => states.push(ev.state));
    const r = e.navigation.routeTo({ roomId: 'r_double-glass' }, { walk: 'auto' });
    const t0 = performance.now();
    while (performance.now() - t0 < 120000 && !states.includes('arrived') && !states.includes('failed')) await new Promise((res) => setTimeout(res, 200));
    e.scene.onAfterRenderObservable.remove(o); off();
    return { problem: r?.problem ?? null, states: [...new Set(states)], max };
  });
  log('Take me there into the double-glass room: the door opens on the way, arrived', !went.problem && went.states.includes('arrived') && went.max >= 0.9, JSON.stringify(went));

  // ── Live people: walking opens a door; on Floor 1 opens nothing down here; never more than 4 ──
  await V(() => window.__ahdusViewer.setMode('view'));
  await vframes(3);
  const shutBefore = await allShut();
  const live = await V(async () => {
    const e = window.__ahdusViewer;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const glass = e.doors.list.find((k) => k.style === 'glass' && k.floor === 0);
    const upDoor = e.doors.list.find((k) => k.floor === 1);
    e.live.add({ personId: 'l_walk', name: 'Ravi', floor: 0, x: glass.centre.x, z: glass.centre.z - 4, yaw: 0, state: 'walk' });
    e.live.add({ personId: 'l_up', name: 'Mira', floor: 1, x: upDoor.centre.x, z: upDoor.centre.z - 4, yaw: 0, state: 'walk' });
    let maxGlass = 0; let maxUp = 0; let downUnder = 0;
    const under = e.doors.list.find((k) => k.style === 'double-glass' && k.floor === 0 && k.roomId === 'r_double-glass');
    for (let i = 0; i <= 40; i++) {
      e.live.update('l_walk', { floor: 0, x: glass.centre.x, z: glass.centre.z - 4 + i * 0.15, yaw: 0, state: 'walk' });
      e.live.update('l_up', { floor: 1, x: upDoor.centre.x, z: upDoor.centre.z - 4 + i * 0.15, yaw: 0, state: 'walk' });
      await sleep(250);
      maxGlass = Math.max(maxGlass, e.doors.openOf(glass.key));
      maxUp = Math.max(maxUp, e.doors.openOf(upDoor.key));
      downUnder = Math.max(downUnder, e.doors.openOf(under.key));
    }
    e.live.clear();
    return { maxGlass, maxUp, downUnder };
  });
  log('a live person walking opens the glass door; one walking upstairs opens nothing down here (nor upstairs, not shown)',
    shutBefore === 0 && live.maxGlass >= 0.9 && live.maxUp === 0 && live.downUnder === 0, JSON.stringify({ shutBefore, ...live }));
  const cap = await V(async () => {
    const e = window.__ahdusViewer;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const doors = e.doors.list.filter((k) => k.floor === 0);
    doors.forEach((d, i) => e.live.add({ personId: `c${i}`, name: `P${i}`, floor: 0, x: d.centre.x, z: d.centre.z - 3, yaw: 0, state: 'walk' }));
    let most = 0;
    for (let t = 0; t <= 30; t++) {
      doors.forEach((d, i) => e.live.update(`c${i}`, { floor: 0, x: d.centre.x + (t % 2 ? 0.4 : -0.4), z: d.centre.z - 1.2, yaw: 0, state: 'walk' }));
      await sleep(250);
      most = Math.max(most, e.doors.animated);
    }
    const end = e.doors.animated;
    e.live.clear();
    return { doors: doors.length, most, end };
  });
  log('7 live people walking at 7 doors: never more than 4 doors move at once', cap.most <= 4 && cap.most >= 3, JSON.stringify(cap));

  // ── Through glass (A4) ──
  await V(() => window.__ahdusViewer.setMode('walkthrough'));
  await page.mouse.move(640, 120);
  await pose({ x: -8, z: -0.5, yaw: 0, pitch: -0.12, floor: 0 });
  await wait(1500); await vframes(4);
  if (SHOTS) {
    await V(() => window.__ahdusViewer.navigation.clear?.());
    await page.keyboard.press('KeyV'); await wait(600); await vframes(4); // first person: your own figure out of the way
    await shot('glass-meeting-room-people-inside.png');
    await page.keyboard.press('KeyV'); await wait(600); await vframes(3);
  }
  const through = await V(async () => {
    const e = window.__ahdusViewer;
    const placed = e.characters?.getPlaced().find((p) => p.personId === 'p_asha');
    return { placed: !!placed };
  });
  const asha = await V(() => {
    const p = window.__ahdusViewer.characters?.getPlaced().find((q) => q.personId === 'p_asha');
    return p ? { x: p.x, z: p.z, y: p.y } : null;
  });
  let hoverId = null; let clicked = null;
  if (asha?.x != null) {
    const s = await toScreen(asha.x, 1.05, asha.z);
    hoverId = await V(([x, y]) => { const r = window.__ahdusViewer.scene.getEngine().getRenderingCanvas().getBoundingClientRect(); return window.__ahdusViewer.characters.pickPerson(x - r.left, y - r.top)?.personId ?? null; }, [s.x, s.y]);
    await V(() => { window.__clicks = []; window.__ahdusViewer.on('walkClick', (ev) => window.__clicks.push(ev)); });
    await page.mouse.click(s.x, s.y);
    await wait(800);
    clicked = await V(() => window.__clicks.at(-1) ?? null);
  }
  log('through the glass wall: Asha is picked (hover) and a click on her opens her card',
    through.placed && hoverId === 'p_asha' && clicked?.action === 'person', JSON.stringify({ through, asha, hoverId, clicked: clicked?.action }));

  // a click on the floor behind the glass: the walk goes round by the door in the east wall
  await pose({ x: -8, z: -0.5, yaw: 0, pitch: -0.12, floor: 0 });
  await wait(800);
  await V(() => {
    const e = window.__ahdusViewer; window.__trail = [];
    window.__trailObs = e.scene.onAfterRenderObservable.add(() => { const p = e.walkthrough.getPosition(); window.__trail.push({ x: p.x, z: p.z }); });
    window.__nav = []; e.on('navigation', (ev) => window.__nav.push(ev.state + (ev.message ? ': ' + ev.message : '')));
  });
  const floorBehind = await toScreen(-9.5, 0.02, 3.2);
  await page.mouse.click(floorBehind.x, floorBehind.y);
  await wait(500);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const st = await V(() => window.__nav);
    if (st.some((x) => /^(arrived|failed|stopped)/.test(x))) break;
    await wait(500);
  }
  const walk = await V(() => {
    const e = window.__ahdusViewer; e.scene.onAfterRenderObservable.remove(window.__trailObs);
    const t = window.__trail;
    let crossGlass = 0; let viaDoor = false;
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1]; const b = t[i];
      if ((a.z < 2) !== (b.z < 2) && Math.min(a.x, b.x) > -10.9 && Math.max(a.x, b.x) < -5.1) crossGlass++;
      if ((a.x > -5) !== (b.x > -5) && b.z > 5 && b.z < 7.5) viaDoor = true;
    }
    const end = t.at(-1);
    return { states: [...new Set(window.__nav)], crossGlass, viaDoor, end, samples: t.length, clicks: window.__clicks?.at(-1)?.action };
  });
  log('a click on the floor behind the glass walks there round by the door, never through the glass',
    walk.states.some((x) => x.startsWith('arrived')) && walk.crossGlass === 0 && walk.viaDoor && walk.end.x < -5.2 && walk.end.z > 2.2,
    JSON.stringify(walk));

  // no door: "it has no door"
  await V(async (layout) => {
    const e = window.__ahdusViewer;
    e.setMode('view');
    e.loadLayout(layout);
    await e.whenBuilt();
    await e.whenNavigationReady();
    e.setMode('walkthrough');
  }, layout([]));
  await page.mouse.move(640, 120);
  await pose({ x: -8, z: -0.5, yaw: 0, pitch: -0.12, floor: 0 });
  await wait(1500);
  await V(() => { window.__clicks = []; window.__ahdusViewer.on('walkClick', (ev) => window.__clicks.push(ev)); });
  const fb = await toScreen(-9.5, 0.02, 3.2);
  await page.mouse.click(fb.x, fb.y);
  await wait(1000);
  const noDoor = await V(() => { const c = window.__clicks.at(-1); return c ? { action: c.action, problem: c.problem, message: c.message } : null; });
  log('the same room with no door: the click says why ("… it has no door")',
    !!noDoor && /no door/i.test(noDoor.message ?? '') , JSON.stringify(noDoor));

} catch (e) {
  log('viewer part ran to the end', false, String(e?.message ?? e).slice(0, 300));
}
log('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
