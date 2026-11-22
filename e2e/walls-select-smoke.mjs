// v0.18.9: furniture never inside walls, a clear selection, and the 2D drag of an unselected item.
// Step 0 (reproduce first): every check below FAILED before the fix (screenshots: SHOTS=<dir>).
// The layout is made up (a "Team office" with a "Board room" beside it, sharing a wall; a glass wall; a wall
// drawn with the Wall tool; an item already through a wall, as an old save can have).
// Parts (PART=drag | walls | select, default all):
//   drag    2D: press on an item that is not selected and drag it straight away: it ends under the mouse
//   walls   an item's footprint never overlaps a wall (room walls, Wall-tool walls, glass walls): the drag, the
//           arrow keys, typed X, R, a bigger Width, Duplicate, paste, a library drop; a wall item sits ON the wall;
//           an old item inside a wall is not moved on opening, Check says "Inside a wall" + Move out (one undo)
//   select  the selected item is outlined (3D, 2D) and stays so while dragged, a hover outline, the bar names it
//           ("Office chair"), a click on furniture inside a selected room selects the furniture, a second click on
//           the same spot selects the next thing under it; Plan view's hover
//
// Run:  npm run dev   (in one terminal)
//       npm run e2e:walls-select   (SHOTS=<dir>: screenshots there, else e2e/screens/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000/';
const PART = process.env.PART ?? 'all';
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
  console.log(`${results.filter((r) => r.ok).length} / ${results.length} passed`);
  if (results.some((r) => !r.ok) || errs.length) process.exitCode = 1;
});
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const TOL = 0.02; // an item may touch a wall, never be in it by more than this (m)

// ── The layout (made up) ──
const T = 0.15; // wall thickness
const room = (id, type, name, x, z, width, depth, extra = {}) => ({
  id, type, name, floor: 0, x, z, width, depth, wallHeight: 3, wallThickness: T, doors: [], windows: [], ...extra,
});
// Team office: x −5..5, z −4..4. Board room: x 5..11 (shares the wall at x = 5), its east wall glass.
const office = room('office', 'OFFICE', 'Team office', 0, 0, 10, 8, { doors: [{ wall: 'south', offset: -3, width: 1, height: 2.1 }] });
const board = room('board', 'MEETING', 'Board room', 8, 0, 6, 8, { glassWalls: ['east'], doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }] });
const item = (id, assetType, x, z, rotationY = 0, extra = {}) => ({
  id, assetType, floor: 0, x, y: 0, z, rotationX: 0, rotationY, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, ...extra,
});
// The walls as boxes (x0..x1, z0..z1), to measure overlaps against
const WALLS = [
  { name: 'office west', x0: -5 - T / 2, x1: -5 + T / 2, z0: -4 - T / 2, z1: 4 + T / 2 },
  { name: 'office south (z −4)', x0: -5 - T / 2, x1: 5 + T / 2, z0: -4 - T / 2, z1: -4 + T / 2 },
  { name: 'shared (office east / board west)', x0: 5 - T / 2, x1: 5 + T / 2, z0: -4 - T / 2, z1: 4 + T / 2 },
  { name: 'board glass east', x0: 11 - T / 2, x1: 11 + T / 2, z0: -4 - T / 2, z1: 4 + T / 2 },
  // the Wall-tool wall: along Z at x = 1, z 0..3 (3 m long, 0.2 m thick)
  { name: 'Wall-tool wall', x0: 0.9, x1: 1.1, z0: 0, z1: 3 },
];
const wseg = item('wseg', 'WALL_SEGMENT', 1, 1.5, Math.PI / 2);
const tv = item('tv', 'TV_DISPLAY', 0, -4 + T / 2 + 0.04 + 0.005, 0, { y: 1.4 - 0.95 / 2 }); // on the north wall, facing in
const old = item('old', 'BOOKSHELF', 5.05, -2, Math.PI / 2); // an old save: a bookshelf half through the shared wall
const layout = {
  layoutName: 'Walls test', floors: [{ id: 0, name: 'Ground Floor', height: 3.5 }], anchorData: {},
  rooms: [office, board],
  objects: [
    wseg, tv, old,
    item('cab', 'FILING_CABINET', -3, -1),
    item('desk', 'DESK_STANDARD', -2, 2.5),
    item('chair', 'CHAIR_OFFICE', -2, 3.2, Math.PI),
    item('table', 'TABLE_MEETING', -4.925 + 0.7 + 0.3, 0, Math.PI / 2), // its 3.2 m along Z, 0.3 m off the west wall
    item('sofa', 'SOFA_3SEAT', 8, 2.9, Math.PI), // its back 0.6 m off the board room's south wall... (z 4)
    item('lounge', 'LOUNGE_CHAIR', 9.8, -2.5, -Math.PI / 2), // near the glass wall
  ],
};

// ── Browser ──
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 760 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = (name) => (SHOTS ? p.screenshot({ path: join(shotDir, name), timeout: 120000 }) : null);

const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const toScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const v = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), vp);
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const k = r.width / eng.getRenderWidth();
  return { x: r.left + v.x * k, y: r.top + v.y * k };
}, [x, y, z]);
// the floor point under a page point (as the app's own ground pick does)
const groundAt = (sx, sy) => p.evaluate(([sx, sy]) => {
  const sc = window.__ahdusScene; const cam = sc.activeCamera; const eng = sc.getEngine();
  const r = eng.getRenderingCanvas().getBoundingClientRect();
  const M = sc.getTransformMatrix().constructor;
  const ray = sc.createPickingRay(sx - r.left, sy - r.top, M.Identity(), cam); // CSS pixels, as scene.pointerX
  const t = (0 - ray.origin.y) / ray.direction.y;
  return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
}, [sx, sy]);
const st = (fn, arg) => p.evaluate(fn, arg);
const obj = (id) => st((id) => window.__ahdusStore.getState().objects[id] ?? null, id);
// the item as drawn: its meshes' world box (pick panes left out)
const boxOf = (id) => st((id) => {
  const sc = window.__ahdusScene;
  const root = sc.transformNodes.find((n) => n.metadata?.objectId === id && !n.parent?.metadata?.objectId);
  if (!root) return null;
  root.computeWorldMatrix(true);
  const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices?.() > 0 && m.isVisible !== false && !/pick/.test(m.name));
  if (!meshes.length) return null;
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    x0 = Math.min(x0, bb.minimumWorld.x); x1 = Math.max(x1, bb.maximumWorld.x);
    z0 = Math.min(z0, bb.minimumWorld.z); z1 = Math.max(z1, bb.maximumWorld.z);
  }
  return { x0, x1, z0, z1 };
}, id);
// how far (m) an item as drawn reaches into the walls: the worst wall
const inWall = async (id) => {
  const bx = await boxOf(id);
  if (!bx) return { depth: NaN, wall: 'no mesh' };
  let worst = { depth: 0, wall: null };
  for (const w of WALLS) {
    const ox = Math.min(bx.x1, w.x1) - Math.max(bx.x0, w.x0);
    const oz = Math.min(bx.z1, w.z1) - Math.max(bx.z0, w.z0);
    if (ox > 0 && oz > 0 && Math.min(ox, oz) > worst.depth) worst = { depth: Math.min(ox, oz), wall: w.name };
  }
  return { ...worst, box: bx };
};
const inWallText = (r) => `${f2(r.depth)} m into ${r.wall ?? 'no wall'}${r.out ? `, ${f2(r.out)} m out of its room` : ''} (box x ${f2(r.box?.x0)}..${f2(r.box?.x1)}, z ${f2(r.box?.z0)}..${f2(r.box?.z1)})`;
// in no wall AND still on its room's side (not dragged through the wall to the other side)
const clearIn = async (id, home) => {
  const r = await inWall(id);
  r.out = r.box ? outOfRoom(r.box, home) : NaN;
  r.ok = r.depth <= TOL && r.out <= TOL;
  return r;
};
const select = (id) => st((id) => { const s = window.__ahdusStore.getState(); s.selectRoom(null); s.selectObject(id); }, id);
const deselect = () => st(() => { const s = window.__ahdusStore.getState(); s.selectRoom(null); s.selectObject(null); });
// the 2D / 3D camera eases into place: wait until it stands still
const settle = async () => {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const now = await st(() => { const c = window.__ahdusScene.activeCamera; return [c.position.x, c.position.y, c.position.z, c.orthoTop ?? 0, c.orthoLeft ?? 0, c.radius ?? 0].map((v) => v.toFixed(3)).join(); });
    if (now === last) return;
    last = now;
    await wait(250);
  }
};
const load = (lay) => st((layout) => {
  const rec = (arr) => Object.fromEntries(arr.map((o) => [o.id, o]));
  const s = window.__ahdusStore.getState();
  s.replaceLayoutState({
    floors: rec(layout.floors), rooms: rec(layout.rooms),
    objects: rec(layout.objects.map((o) => ({ ...o, roomId: null }))), currentFloor: 0,
  });
  s.selectRoom(null); s.selectObject(null);
}, lay);
const reload = async () => { await load(layout); await st(() => window.__ahdusBuild?.whenBuilt?.()); await frames(4); };
const patch = (id, change) => st(([id, change]) => {
  const s = window.__ahdusStore.getState();
  s.replaceLayoutState({ floors: s.floors, rooms: s.rooms, objects: { ...s.objects, [id]: { ...s.objects[id], ...change } }, currentFloor: s.currentFloor });
}, [id, change]);
// how far an item as drawn sticks out of its room's inner faces (past a wall, through to the other side)
const outOfRoom = (bx, r) => Math.max(0, (r.x - r.width / 2 + T / 2) - bx.x0, bx.x1 - (r.x + r.width / 2 - T / 2),
  (r.z - r.depth / 2 + T / 2) - bx.z0, bx.z1 - (r.z + r.depth / 2 - T / 2));

async function openStudio() {
  await p.goto(base);
  await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await p.fill('input[placeholder="Company name…"]', 'Walls Co'); await p.click('button:has-text("Create")'); await wait(400);
  await p.fill('input[placeholder="Layout name…"]', 'Walls'); await p.click('button:has-text("Create")');
  await p.waitForSelector('canvas', { timeout: 90000 });
  await p.waitForFunction(() => !!window.__ahdusScene && !document.querySelector('[data-splash]'), null, { timeout: 90000 });
  await p.evaluate((s) => window.__ahdusScene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await reload();
}
const view = async (label) => { await p.click(`[aria-label="${label}"]`); await frames(6); await settle(); };
// press on a world point, move to another in steps, release
const dragWorld = async (from, to, { steps = 16, before = null } = {}) => {
  const a = await toScreen(from.x, from.y ?? 0.4, from.z);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  // the aim is worked out AFTER the press (the press may open the Inspector and narrow the view)
  await p.mouse.move(a.x + 6, a.y + 2, { steps: 3 });
  await frames(3);
  const c = await toScreen(to.x, to.y ?? 0.4, to.z);
  await p.mouse.move(c.x, c.y, { steps });
  await frames(3);
  if (before) await before();
  await p.mouse.up();
  await frames(4); await wait(250);
  return c;
};

// ════════════════ drag: 2D, an item not selected yet ════════════════
async function partDrag() {
  await reload();
  await view('2D view');
  await deselect(); await frames(4); await settle();
  const c0 = await obj('cab');
  // press on it and drag 3 m east right away (the press selects it, the Inspector opens, the view narrows)
  const a = await toScreen(c0.x, 0.5, c0.z);
  const aimWorld = { x: c0.x + 3, z: c0.z };
  const aim = await toScreen(aimWorld.x, 0.5, aimWorld.z); // where the item would be under the mouse before the press
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(aim.x, aim.y, { steps: 20 });
  await frames(4);
  // the floor under the mouse NOW (after the view narrowed): the item should be there (as grabbed: at its middle)
  const under = await groundAt(aim.x, aim.y);
  const live = await st(() => {
    const sc = window.__ahdusScene;
    const root = sc.transformNodes.find((n) => n.metadata?.objectId === 'cab' && !n.parent?.metadata?.objectId);
    return root ? { x: root.position.x, z: root.position.z } : null;
  });
  await shot('drag-unselected-2d-while-dragging.png');
  await p.mouse.up();
  await frames(4); await wait(300);
  const c1 = await obj('cab');
  // where the person aimed: the floor point that was under the mouse's end point BEFORE the press (the room as they saw it)
  const off = Math.hypot(c1.x - aimWorld.x, c1.z - aimWorld.z);
  log('drag: 2D, pressing on an item that is not selected and dragging at once: it lands where the mouse was aimed (3 m east)',
    off < 0.3, `ends at ${f2(c1.x)}, ${f2(c1.z)}, aimed at ${f2(aimWorld.x)}, ${f2(aimWorld.z)} (${f2(off)} m off); the floor under the mouse after the press ${f2(under.x)}, ${f2(under.z)}; while dragging at ${f2(live?.x)}, ${f2(live?.z)}`);
  const shift = Math.hypot(under.x - aimWorld.x, under.z - aimWorld.z);
  log('drag: …and the 2D view does not shift under the mouse when the Inspector opens', shift < 0.3, `the floor under the same mouse point moved ${f2(shift)} m`);
  // 3D: the same press + small move: the item may not jump on the first moves (the view narrows under it)
  await reload();
  await view('3D view');
  await deselect(); await frames(4); await settle();
  const d0 = await obj('desk');
  const pd = await toScreen(d0.x, 0.6, d0.z);
  await p.mouse.move(pd.x, pd.y);
  await p.mouse.down();
  await p.keyboard.down('Alt'); // no snapping: what moves is the drag itself
  await p.mouse.move(pd.x + 8, pd.y, { steps: 4 });
  await frames(4);
  await p.mouse.move(pd.x + 12, pd.y, { steps: 2 });
  await frames(3);
  const live3 = await st(() => {
    const root = window.__ahdusScene.transformNodes.find((n) => n.metadata?.objectId === 'desk' && !n.parent?.metadata?.objectId);
    return root ? { x: root.position.x, z: root.position.z } : null;
  });
  await p.keyboard.up('Alt');
  await p.keyboard.press('Escape');
  await p.mouse.up();
  await frames(3);
  const jump = live3 ? Math.hypot(live3.x - d0.x, live3.z - d0.z) : NaN;
  log('drag: 3D, an item not selected yet, pressed and moved 12 px: no jump (it follows the mouse, < 1 m)', jump < 1, `moved ${f2(jump)} m`);
}

// ════════════════ walls ════════════════
async function partWalls() {
  await reload();
  await view('2D view');

  // 1. drag a filing cabinet into the west wall (let go with its middle in the wall: x −4.95)
  {
    await select('cab'); await frames(4); await settle();
    const c = await obj('cab');
    await dragWorld({ x: c.x, z: c.z }, { x: -4.95, z: c.z }, {
      before: async () => { if (SHOTS) await shot('walls-drag-into-wall-before-release.png'); },
    });
    const r = await clearIn('cab', office);
    log('walls: a cabinet dragged into the west wall stops flush with it (not in it, not through it)', r.ok, inWallText(r));
    const c2 = await obj('cab');
    log('walls: …and flush: its back touches the wall\'s inner face (x −4.925)', Math.abs(r.box.x0 - (-5 + T / 2)) < 0.03, `x ${f2(c2.x)}, box x0 ${f2(r.box.x0)}`);
  }

  // 2. the arrow keys: the cabinet 0.3 m off the west wall, ArrowLeft × 6 (0.25 m or the grid step each)
  {
    await patch('cab', { x: -5 + T / 2 + 0.23 + 0.3, z: -1 });
    await select('cab'); await frames(4);
    await p.mouse.move(5, 300);
    for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowLeft');
    await frames(4); await wait(200);
    const r = await clearIn('cab', office);
    log('walls: the arrow keys never push a cabinet into the wall', r.ok, inWallText(r));
  }

  // 3. typed X: −5.0 (its middle in the wall)
  {
    await patch('cab', { x: -3, z: -1 });
    await select('cab'); await frames(4);
    const x = p.locator('.inspector [aria-label="X"], [aria-label="X"]').first();
    await x.fill('-5.0'); await x.press('Enter');
    await frames(4); await wait(200);
    const r = await clearIn('cab', office);
    log('walls: typing X = −5.0 (in the wall) leaves it against the wall, not in it', r.ok, inWallText(r));
  }

  // 4. R: the meeting table along the west wall (0.3 m off), a quarter turn
  {
    await select('table'); await frames(4);
    await p.mouse.move(5, 300);
    await p.keyboard.press('r');
    await frames(4); await wait(200);
    const r = await clearIn('table', office);
    log('walls: R turns a long table beside a wall without putting it into the wall', r.ok, inWallText(r));
    await shot('walls-after-R.png');
  }

  // 5. a bigger Width: the sofa (2.2 m) against the board room's... a cabinet flush with the west wall, Depth doubled
  {
    await patch('cab', { x: -5 + T / 2 + 0.31 + 0.001, z: -1, rotationY: 0 });
    await select('cab'); await frames(4);
    const depth = p.locator('[aria-label="Depth"]').first();
    await depth.fill('1.6'); await depth.press('Enter');
    await frames(4); await wait(200);
    const r = await clearIn('cab', office);
    log('walls: a bigger Depth (0.62 → 1.6 m) next to a wall keeps it out of the wall', r.ok, inWallText(r));
  }

  // 6. Duplicate (Ctrl+D: 1 m aside) of a cabinet 0.5 m from the shared wall: the copy would be in it
  {
    await reload();
    await patch('cab', { x: 5 - T / 2 - 0.23 - 0.5, z: -1, rotationY: 0 });
    await select('cab'); await frames(4);
    await p.mouse.move(5, 300);
    await p.keyboard.press('Control+d');
    await frames(4); await wait(300);
    const copy = await st(() => Object.values(window.__ahdusStore.getState().objects).find((o) => o.assetType === 'FILING_CABINET' && o.id !== 'cab')?.id ?? null);
    const r = copy ? await clearIn(copy, office) : { ok: false };
    log('walls: Duplicate next to a wall: the copy is not in the wall', !!copy && r.ok, copy ? inWallText(r) : 'no copy made');
  }

  // 7. paste (Ctrl+V with the mouse off the view: 0.5 m aside) of a cabinet 0.3 m from the shared wall
  {
    await reload();
    await patch('cab', { x: 5 - T / 2 - 0.23 - 0.3, z: -1, rotationY: 0 });
    await select('cab'); await frames(4);
    await p.mouse.move(5, 300);
    await p.keyboard.press('Control+c');
    await p.keyboard.press('Control+v');
    await frames(4); await wait(300);
    const copy = await st(() => Object.values(window.__ahdusStore.getState().objects).find((o) => o.assetType === 'FILING_CABINET' && o.id !== 'cab')?.id ?? null);
    const r = copy ? await clearIn(copy, office) : { ok: false };
    log('walls: paste beside a wall (0.5 m aside): the pasted item is not in the wall', !!copy && r.ok, copy ? inWallText(r) : 'nothing pasted');
  }

  // 7b. paste with the mouse over the view: at the mouse (v0.18.9: it went 0.5 m aside when the selection bar or the hover
  // card floating over the view came under the mouse; here the bar is), and over the shared wall: beside it, near the mouse
  {
    await reload();
    await select('cab'); await frames(4);
    await p.mouse.move(5, 300);
    await p.keyboard.press('Control+c');
    const at = await toScreen(-2, 0, 2);
    await p.mouse.move(at.x - 40, at.y - 30, { steps: 4 });
    await p.mouse.move(at.x, at.y, { steps: 6 });
    await frames(4); await wait(250); // the hover card shows by now
    const aim = await groundAt(at.x, at.y);
    await p.keyboard.press('Control+v');
    await frames(4); await wait(300);
    const copies = () => st(() => Object.values(window.__ahdusStore.getState().objects).filter((o) => o.assetType === 'FILING_CABINET' && o.id !== 'cab').map((o) => ({ id: o.id, x: o.x, z: o.z })));
    const [c1] = await copies();
    const off = c1 && aim ? Math.hypot(c1.x - aim.x, c1.z - aim.z) : NaN;
    log('walls: Ctrl+V with the mouse over the floor pastes AT the mouse (not 0.5 m aside)', off < 0.05, c1 ? `${f2(off)} m from the mouse (pasted ${f2(c1.x)}, ${f2(c1.z)}; mouse ${f2(aim?.x)}, ${f2(aim?.z)})` : 'nothing pasted');
    if (SHOTS) await shot('walls-paste-at-mouse.png');
    const w = await toScreen(5, 0, 1);
    await p.mouse.move(w.x, w.y, { steps: 8 });
    await frames(4); await wait(250);
    const aimW = await groundAt(w.x, w.y);
    await p.keyboard.press('Control+v');
    await frames(4); await wait(300);
    const c2 = (await copies()).find((o) => o.id !== c1?.id);
    const r = c2 ? await inWall(c2.id) : { depth: NaN };
    const offW = c2 && aimW ? Math.hypot(c2.x - aimW.x, c2.z - aimW.z) : NaN;
    log('walls: Ctrl+V with the mouse over a wall: beside the wall, next to the mouse (≤ 0.35 m)', !!c2 && r.depth <= TOL && offW <= 0.35,
      c2 ? `${inWallText(r)}; ${f2(offW)} m from the mouse (mouse ${f2(aimW?.x)}, ${f2(aimW?.z)})` : 'nothing pasted');
  }

  // 8. a library drop on the wall drawn with the Wall tool
  {
    await reload();
    await deselect();
    await p.click('[aria-label="Furniture"]');
    await p.fill('[aria-label="Search furniture"]', 'Filing Cabinet');
    await wait(300);
    const tile = p.locator('.lib-tile[title^="Filing Cabinet"]').first();
    const tb = await tile.boundingBox();
    const before = await st(() => Object.keys(window.__ahdusStore.getState().objects));
    const w = await toScreen(1.05, 0.2, 1.5);
    await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await p.mouse.down();
    await p.mouse.move(w.x, w.y, { steps: 16 });
    await frames(2);
    await p.mouse.up();
    await frames(4); await wait(400);
    const id = await st((before) => Object.keys(window.__ahdusStore.getState().objects).find((k) => !before.includes(k)) ?? null, before);
    const r = id ? await inWall(id) : { depth: NaN };
    log('walls: a cabinet dropped from the library onto a Wall-tool wall ends beside it, not in it', !!id && r.depth <= TOL, id ? inWallText(r) : 'nothing placed');
    await p.click('[aria-label="Furniture"]').catch(() => {}); // close the library
    await wait(300);
  }

  // 9. a glass wall: the armchair dragged east through the board room's glass wall
  {
    await reload();
    await select('lounge'); await frames(4); await settle();
    const c = await obj('lounge');
    await dragWorld({ x: c.x, z: c.z }, { x: 11.0, z: c.z }); // its middle in the glass wall
    const r = await clearIn('lounge', board);
    log('walls: an armchair dragged into a glass wall stops against it', r.ok, inWallText(r));
  }

  // 10. a wall item: the TV on the north wall, pushed by the arrow keys towards it: it stays ON its face
  {
    await reload();
    await select('tv'); await frames(4);
    await p.mouse.move(5, 300);
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowUp');
    await frames(4); await wait(200);
    const t = await obj('tv');
    const r = await clearIn('tv', office);
    log('walls: a TV on a wall, ArrowUp × 3 (into the wall): it stays on its face, not in it', r.ok && Math.abs(t.rotationY) < 0.01, `${inWallText(r)}; rotationY ${f2(t.rotationY)}`);
  }

  // 11. old saves: the bookshelf through the shared wall stays where it is; Check lists it
  {
    await reload();
    await frames(4);
    const o = await obj('old');
    log('walls: opening a layout moves nothing by itself (the bookshelf through the wall stays at x 5.05)', Math.abs(o.x - 5.05) < 1e-6, `x ${f2(o.x)}`);
    await p.click('[aria-label="Check layout"]').catch(() => {});
    await p.waitForSelector('.layout-check', { timeout: 8000 }).catch(() => {});
    await wait(2500);
    const text = (await p.locator('.layout-check').first().textContent().catch(() => '')) ?? '';
    log('walls: Check my layout says "Inside a wall" for the bookshelf, with Move out', /Inside a wall/i.test(text) && /Move out/.test(text), text.slice(0, 200));
    log('walls: …and nothing about the TV, which hangs right', !/Large Display TV.{0,40}wall/i.test(text), '');
    await shot('walls-check-inside-a-wall.png');
    await p.click('[aria-label="Close layout check"]').catch(() => {});
  }

  // the look of it: an item through a wall in 3D (the reported case, made up)
  if (SHOTS) {
    await reload();
    await view('3D view');
    await st(() => { const c = window.__ahdusScene.activeCamera; if (c.alpha !== undefined) { c.alpha = -Math.PI / 2.6; c.beta = 0.9; c.radius = 18; c.target.set(5, 0, -1); } });
    await frames(6); await wait(300);
    await shot('item-in-wall-3d.png');
  }
}

// ════════════════ select ════════════════
async function partSelect() {
  await reload();
  await view('3D view');
  await st(() => { const c = window.__ahdusScene.activeCamera; if (c.alpha !== undefined) { c.alpha = -Math.PI / 2; c.beta = 0.75; c.radius = 16; c.target.set(-1, 0, 1); } });
  await frames(6); await settle();
  // is an item outlined / tinted now (any of its meshes), and in which colour
  const lookOf = (id) => st((id) => {
    const sc = window.__ahdusScene;
    const root = sc.transformNodes.find((n) => n.metadata?.objectId === id && !n.parent?.metadata?.objectId);
    if (!root) return null;
    const ms = root.getChildMeshes(false).filter((m) => m.getTotalVertices?.() > 0);
    const lit = ms.find((m) => m.renderOutline || m.renderOverlay);
    return { outline: !!lit, color: lit ? (lit.renderOutline ? lit.outlineColor : lit.overlayColor)?.toHexString?.() : null, look: root.metadata?.look ?? null };
  }, id);
  const barName = () => p.locator('.selection-toolbar').first().textContent().catch(() => '');
  const selected = () => st(() => { const s = window.__ahdusStore.getState(); return { obj: s.selectedObjectId, room: s.selectedRoomId }; });

  // 1. click the office chair: it is selected, outlined, and the bar says what it is
  const ch = await obj('chair');
  const at = await toScreen(ch.x, 0.55, ch.z);
  await deselect(); await frames(3);
  await p.mouse.move(at.x, at.y); await frames(4);
  const hover = await lookOf('chair');
  log('select: hovering a chair (nothing selected) outlines it lightly', !!hover?.outline, JSON.stringify(hover));
  await shot('select-hover-chair.png');
  await p.mouse.click(at.x, at.y);
  await frames(4); await wait(300);
  const s1 = await selected();
  const look1 = await lookOf('chair');
  const name1 = (await barName()) ?? '';
  log('select: a click on the chair selects the chair', s1.obj === 'chair', JSON.stringify(s1));
  log('select: the selected chair has a clear outline in 3D', !!look1?.outline, JSON.stringify(look1));
  log('select: the action bar starts with what is selected: "Office chair"', /^\s*Office chair/i.test(name1), JSON.stringify(name1.slice(0, 60)));
  await shot('select-chair-3d.png');

  // 2. the room selected first, then a click on the chair inside it: the chair
  await st(() => { const s = window.__ahdusStore.getState(); s.selectObject(null); s.selectRoom('office'); });
  await frames(4);
  const nameRoom = (await barName()) ?? '';
  log('select: a selected room\'s bar says "Team office" and its type', /Team office/.test(nameRoom) && /Office/i.test(nameRoom.replace('Team office', '')), JSON.stringify(nameRoom.slice(0, 60)));
  await shot('select-room-3d.png');
  // the Inspector opened since `at` was measured (the view is narrower): where the chair is now
  const at2 = await toScreen(ch.x, 0.55, ch.z);
  await p.mouse.click(at2.x, at2.y);
  await frames(4); await wait(300);
  const s2 = await selected();
  log('select: with the room selected, a click on furniture in it selects the furniture', s2.obj === 'chair', JSON.stringify(s2));

  // 3. a second click on the same spot: the next thing under it (the room)
  await wait(600); // not a double-click
  await p.mouse.click(at2.x, at2.y);
  await frames(4); await wait(300);
  const s3 = await selected();
  log('select: a second click on the same spot selects the next thing under it (the room)', s3.obj === null && s3.room === 'office', JSON.stringify(s3));

  // 4. while the chair is dragged, it stays highlighted
  await select('chair'); await frames(4);
  const a = await toScreen(ch.x, 0.55, ch.z);
  const c = await toScreen(ch.x + 1, 0.55, ch.z - 0.5);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(c.x, c.y, { steps: 12 });
  await frames(3);
  const dragging = await lookOf('chair');
  await shot('select-while-dragging.png');
  await p.keyboard.press('Escape');
  await p.mouse.up();
  await frames(3);
  log('select: the item being moved stays highlighted', !!dragging?.outline, JSON.stringify(dragging));

  // 5. 2D: the selected chair is outlined there too
  await view('2D view');
  await select('chair'); await frames(4);
  const look2d = await lookOf('chair');
  log('select: 2D view: the selected chair is outlined', !!look2d?.outline, JSON.stringify(look2d));
  await shot('select-chair-2d.png');

  // 6. Plan view: hovering an item marks it before the click
  await view('Plan view');
  await deselect();
  await wait(400);
  const planItem = p.locator('[data-plan-item="desk"], [data-object-id="desk"]').first();
  const pb = await planItem.boundingBox().catch(() => null);
  if (pb) await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await wait(300);
  const hovered = await p.locator('[data-plan-hover]').count();
  log('select: Plan view: hovering an item marks it ([data-plan-hover])', hovered > 0, pb ? `${hovered} marked` : 'the desk was not found in the plan');
  await shot('select-plan-hover.png');
  await view('3D view');
}

try {
  await openStudio();
  if (PART === 'all' || PART === 'drag') await partDrag();
  if (PART === 'all' || PART === 'walls') await partWalls();
  if (PART === 'all' || PART === 'select') await partSelect();
} catch (e) {
  log('the test ran to the end', false, e.message);
}
await b.close();
