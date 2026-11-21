// v0.18.8: the avatar never walks into furniture or gets stuck beside stairs, and stairs go flush to walls.
// Step 0 (reproduce first): the two cases Himan reported on the live site (v0.18.7), rebuilt as a test layout:
//   - stairs-gap.png: an L staircase (turns left, climbs north along the west wall, the landing in the north-west
//     corner, the second flight east along the north wall) standing 0.2 m off both walls;
//   - table-walk-in.png: Floor 1, a meeting room with windows, a long meeting table with 8 office chairs; the
//     avatar (third person) stood inside the table among the chairs.
// Parts (PART=studio | table | gap, default all):
//   studio  Studio: an L dragged into the corner / moved by the arrow keys ends flush with the walls (no gap)
//   table   viewer: keys (third + first person) from every side, a stretched + turned table, click-to-walk,
//           landing from flying, spawning on the table: the body never overlaps the table (the box you see)
//   gap     viewer: walking into the 0.2 m strips beside the L: never in a strip, never stuck; forced into a strip:
//           nudged out (U and the 1 s safety net)
//
// Run:  npm run dev   (in one terminal)
//       npm run e2e:stuck   (SHOTS=<dir>: screenshots there, else e2e/screens/)
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

// ── The layout ──
const H = 3.5; // storey height
const T = 0.15; // wall thickness
const floors = [{ id: 0, name: 'Ground Floor', height: H }, { id: 1, name: 'Floor 1', height: H }];
const room = (id, floor, type, name, x, z, width, depth, extra = {}) => ({
  id, type, name, floor, x, z, width, depth, wallHeight: 3.2, wallThickness: T, doors: [], windows: [], ...extra,
});
// the stair room (x −7..−1, z −3..3) on both floors, a hall / the meeting room east of it (x −1..11, z −4..4)
const stairRoom0 = room('stairs0', 0, 'OFFICE', 'Stairs', -4, 0, 6, 6, { doors: [{ wall: 'east', offset: 1.5, width: 1.0, height: 2.1 }] });
const stairRoom1 = room('stairs1', 1, 'OFFICE', 'Landing', -4, 0, 6, 6, { doors: [{ wall: 'east', offset: 1.5, width: 1.0, height: 2.1 }] });
const hall0 = room('hall0', 0, 'OFFICE', 'Hall', 5, 0, 12, 8, { doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }] });
const meeting1 = room('meet1', 1, 'MEETING', 'Meeting Room', 5, 0, 12, 8, {
  windows: [-4, 0, 4].map((offset) => ({ wall: 'north', offset, width: 2, height: 1.4, sill: 0.9 })),
});
// The L: its box 3.2 × 3.2, turned 180° (it climbs north); its outer sides 0.2 m off the west and north walls'
// inner faces (x −6.925, z −2.925): box x −6.725..−3.525, z −2.725..0.475
const GAP = Number(process.env.GAP ?? 0.2); // GAP=0.3: the strips that wide (step 0 tried 0.2, 0.3, 0.4)
const INNER = { x0: -7 + T / 2, x1: -1 - T / 2, z0: -3 + T / 2, z1: 3 - T / 2 };
const L = { id: 'stairL', assetType: 'STAIRCASE', floor: 0, x: INNER.x0 + GAP + 1.6, y: 0, z: INNER.z0 + GAP + 1.6, rotationX: 0, rotationY: Math.PI, rotationZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false, metadata: { stairShape: 'L-left' } };
const lBox = (s) => ({ x0: s.x - 1.6, x1: s.x + 1.6, z0: s.z - 1.6, z1: s.z + 1.6 }); // 180°: the same box
const item = (id, assetType, x, z, rotationY = 0, scaleX = 1, scaleZ = 1) => ({
  id, assetType, floor: 1, x, y: 0, z, rotationX: 0, rotationY, rotationZ: 0, scaleX, scaleY: 1, scaleZ, isLocked: false,
});
// Table A as in the screenshot: 3.2 × 1.4, three chairs on each long side (1 m apart), one at each end
const TA = { x: 2.5, z: 0 };
const chairs = [
  ...[-1, 0, 1].map((k, i) => item(`cn${i}`, 'CHAIR_OFFICE', TA.x + k, TA.z - 1.0, 0)),
  ...[-1, 0, 1].map((k, i) => item(`cs${i}`, 'CHAIR_OFFICE', TA.x + k, TA.z + 1.0, Math.PI)),
  item('cw', 'CHAIR_OFFICE', TA.x - 1.95, TA.z, Math.PI / 2),
  item('ce', 'CHAIR_OFFICE', TA.x + 1.95, TA.z, -Math.PI / 2),
];
const tableA = item('tableA', 'TABLE_MEETING', TA.x, TA.z);
// Table B: stretched (1.5 × along its length, 1.2 × its depth) and turned 90°: 4.8 m along Z, 1.68 m along X
const TB = { x: 8.5, z: 0 };
const tableB = item('tableB', 'TABLE_MEETING', TB.x, TB.z, Math.PI / 2, 1.5, 1.2);
// A trap in the ground-floor Hall: four desks (1.6 × 0.8) in a closed ring around (6, 0), a pocket 1.4 × 1.0 inside
// (the body fits, nobody can walk out): only "Get unstuck" (U, or the 1 s safety net) gets you out
const RING = { x: 6, z: 0 };
const ring = [
  ['deskN', RING.x, RING.z - 0.9, 0], ['deskS', RING.x, RING.z + 0.9, 0],
  ['deskW', RING.x - 1.1, RING.z, Math.PI / 2], ['deskE', RING.x + 1.1, RING.z, Math.PI / 2],
].map(([id, x, z, r]) => ({ ...item(id, 'DESK_STANDARD', x, z, r), floor: 0 }));
const layout = {
  layoutName: 'Stuck test', floors, anchorData: {},
  rooms: [stairRoom0, hall0, stairRoom1, meeting1],
  objects: [L, tableA, tableB, ...chairs, ...ring],
};

// ── Browser ──
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 760 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = (name) => (SHOTS ? p.screenshot({ path: join(shotDir, name), timeout: 120000 }) : null);

// ════════════════ Studio ════════════════
async function studio() {
  const sframes = (n = 3) => p.evaluate((n) => new Promise((res) => {
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
  const stairNow = () => p.evaluate(() => window.__ahdusStore.getState().objects.stairL);
  const gapsOf = (s) => { const bx = lBox(s); return { west: bx.x0 - INNER.x0, north: bx.z0 - INNER.z0 }; };
  // the stairs where they work, 1 m east and 1 m south of the corner spot
  const start = { ...L, x: L.x + 1, z: L.z + 1 };
  const load = (s) => p.evaluate(({ layout, s }) => {
    const rec = (arr) => Object.fromEntries(arr.map((o) => [o.id, o]));
    const st = window.__ahdusStore.getState();
    st.replaceLayoutState({
      floors: rec(layout.floors), rooms: rec(layout.rooms),
      objects: rec(layout.objects.map((o) => (o.id === s.id ? s : o)).map((o) => ({ ...o, roomId: null }))),
      currentFloor: 0,
    });
  }, { layout, s });

  await p.goto(base);
  await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await p.fill('input[placeholder="Company name…"]', 'Stuck Co'); await p.click('button:has-text("Create")'); await wait(400);
  await p.fill('input[placeholder="Layout name…"]', 'Stuck'); await p.click('button:has-text("Create")');
  await p.waitForSelector('canvas', { timeout: 90000 });
  await p.waitForFunction(() => !!window.__ahdusScene && !document.querySelector('[data-splash]'), null, { timeout: 90000 });
  await p.evaluate((s) => window.__ahdusScene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await load(start);
  await p.click('[aria-label="2D view"]'); await sframes(6);
  // the 2D camera eases into place: wait until it stands still before working out screen points
  const settle = async () => {
    let last = '';
    for (let i = 0; i < 40; i++) {
      const now = await p.evaluate(() => { const c = window.__ahdusScene.activeCamera; return [c.position.x, c.position.y, c.position.z, c.orthoTop ?? 0, c.radius ?? 0].map((v) => v.toFixed(3)).join(); });
      if (now === last) return;
      last = now;
      await wait(250);
    }
  };
  await settle();

  // 1. drag by the landing into the north-west corner: let go with the L 0.15 m short of both walls (as a person
  //    aiming at the corner does), well within 0.5 m
  {
    // selected first (the Inspector opens and the view narrows), as a person clicks it and then drags it
    await p.evaluate(() => window.__ahdusStore.getState().selectObject('stairL'));
    await sframes(4);
    await settle();
    const s = await stairNow();
    const grabW = { x: s.x - 1.0, z: s.z - 1.0 }; // on the landing (180°: local +1, +1 = world −1, −1)
    const aim = { x: INNER.x0 + 0.15 + 1.6, z: INNER.z0 + 0.15 + 1.6 };
    const a = await toScreen(grabW.x, 0.5, grabW.z);
    const c = await toScreen(aim.x - 1.0, 0.5, aim.z - 1.0);
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move((a.x + c.x) / 2, (a.y + c.y) / 2, { steps: 8 });
    await p.mouse.move(c.x, c.y, { steps: 12 });
    await sframes(3);
    const guides = await p.evaluate(() => window.__ahdusScene.getMeshByName('snap_guides')?.metadata?.guides ?? null);
    await shot('studio-L-drag-before-release.png');
    await p.mouse.up();
    await sframes(4); await wait(300);
    const s2 = await stairNow();
    const g = gapsOf(s2);
    log('Studio: an L dragged into the corner (let go 0.15 m short) ends flush with both walls',
      Math.abs(g.west) < 0.01 && Math.abs(g.north) < 0.01,
      `gap west ${f2(g.west)} m, north ${f2(g.north)} m (stairs at ${f2(s2.x)}, ${f2(s2.z)}); guides while dragging ${JSON.stringify(guides)}`);
    await shot('studio-L-after-drag.png');
  }

  // 2. the arrow keys: from 0.7 m off the west wall, one ArrowLeft (0.25 m, or the grid step)
  {
    await load({ ...L, x: L.x + 0.5 }); // west gap 0.7
    await sframes(4);
    await p.evaluate(() => { const st = window.__ahdusStore.getState(); st.selectRoom?.(null); st.selectObject('stairL'); });
    await sframes(2);
    await p.mouse.move(5, 300);
    await p.keyboard.press('ArrowLeft');
    await sframes(3); await wait(200);
    const s2 = await stairNow();
    const g = gapsOf(s2);
    log('Studio: the arrow keys bring an L within 0.5 m of a wall: it goes flush',
      Math.abs(g.west) < 0.01, `gap west ${f2(g.west)} m, north ${f2(g.north)} m after one ArrowLeft (stairs x ${f2(s2.x)})`);
    await shot('studio-L-after-arrow.png');
  }
}

// ════════════════ Viewer (walking) ════════════════
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusViewer.scene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 30000);
}), n);
const pose = async (a) => { await p.evaluate((a) => window.__ahdusViewer.walkthrough.setPose(a), a); await frames(3); };
const pos = () => p.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { x: v.x, y: v.y, z: v.z, floor: w.getLevel(), flying: w.isFlying() };
});
const hold = async (key, ms) => { await p.keyboard.down(key); await wait(ms); await p.keyboard.up(key); await frames(2); };
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z); // forward = (sin yaw, cos yaw)

async function openViewer() {
  await p.goto(new URL('viewer.html?mode=view', base).href);
  await p.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
  await p.evaluate(async (layout) => {
    const e = window.__ahdusViewer;
    await e.whenBuilt();
    e.loadLayout(layout);
    await e.whenBuilt();
    await e.whenNavigationReady();
    e.setMode('walkthrough');
  }, layout);
  await p.evaluate((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await p.mouse.move(640, 120); // over the view: the keys are its own (no click: a click walks)
  await frames(4);
  // models load late: wait until the tables have their real meshes (or 20 s)
  await p.waitForFunction(() => {
    const o = window.__ahdusViewer.objects;
    return ['tableA', 'tableB'].every((id) => o.getObjectMesh(id)?.getChildMeshes?.().some((m) => m.metadata?.model));
  }, null, { timeout: 20000 }).catch(() => {});
  await frames(4);
  // The overlap monitor: every frame, how far the body (radius 0.32 m) reaches into each watched item's box as
  // drawn (the meshes' world box: the tables are turned in quarter turns), feet under its top
  await p.evaluate(() => {
    const e = window.__ahdusViewer;
    const R = 0.32;
    const m = (window.__overlap = { ids: [], worst: {}, at: {}, boxes: {}, frame: 0 });
    const boxOf = (id) => {
      const root = e.objects.getObjectMesh(id);
      if (!root) return null;
      const { min, max } = root.getHierarchyBoundingVectors(true, (c) => c.isEnabled() && c.isVisible && c.getTotalVertices?.() > 0);
      return { x0: min.x, x1: max.x, z0: min.z, z1: max.z, top: max.y };
    };
    window.__boxOf = boxOf;
    e.scene.onAfterRenderObservable.add(() => {
      if (!m.ids.length || !e.walkthrough.isActive()) return;
      if (m.frame++ % 30 === 0) for (const id of m.ids) m.boxes[id] = boxOf(id);
      const q = e.walkthrough.getPosition();
      for (const id of m.ids) {
        const bx = m.boxes[id];
        if (!bx || q.y > bx.top - 0.05) continue;
        const dx = Math.max(bx.x0 - q.x, 0, q.x - bx.x1);
        const dz = Math.max(bx.z0 - q.z, 0, q.z - bx.z1);
        const into = R - Math.hypot(dx, dz);
        if (into > (m.worst[id] ?? -Infinity)) { m.worst[id] = into; m.at[id] = { x: +q.x.toFixed(2), z: +q.z.toFixed(2), y: +q.y.toFixed(2) }; }
      }
    });
  });
}
const watch = (ids) => p.evaluate((ids) => Object.assign(window.__overlap, { ids, worst: {}, at: {}, boxes: {}, frame: 0 }), ids);
const overlap = () => p.evaluate(() => { const { worst, at } = window.__overlap; window.__overlap.ids = []; return { worst, at }; });
/** How far into the item the body reached (m, ≤ 0: never touched); 0.03 m allowed (the ellipsoid's curve, a frame). */
const ALLOWED = 0.03;

async function tablePart() {
  await openViewer();
  const boxes = await p.evaluate(() => ({ A: window.__boxOf('tableA'), B: window.__boxOf('tableB') }));
  log('the tables are drawn the size of their footprint (A 3.2 × 1.4, B 1.68 × 4.8 after its stretch and turn)',
    boxes.A && boxes.B && Math.abs((boxes.A.x1 - boxes.A.x0) - 3.2) < 0.15 && Math.abs((boxes.A.z1 - boxes.A.z0) - 1.4) < 0.15
      && Math.abs((boxes.B.x1 - boxes.B.x0) - 1.68) < 0.15 && Math.abs((boxes.B.z1 - boxes.B.z0) - 4.8) < 0.15,
    `A ${f2(boxes.A?.x1 - boxes.A?.x0)} × ${f2(boxes.A?.z1 - boxes.A?.z0)}, B ${f2(boxes.B?.x1 - boxes.B?.x0)} × ${f2(boxes.B?.z1 - boxes.B?.z0)}`);

  /** Walk at an item with W for `ms` from `from`, facing `to`; how far the body got into it. */
  const walkAt = async (name, id, from, to, { ms = 3000, view = 'third', shotName = null } = {}) => {
    await pose({ x: from.x, z: from.z, floor: 1, yaw: yawTo(from, to), pitch: -0.15, fly: false });
    await wait(300);
    await watch([id, ...chairs.map((c) => c.id)]);
    await p.keyboard.down('KeyW');
    let shotTaken = false;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await wait(250);
      if (shotName && !shotTaken) {
        const w = await p.evaluate((id) => window.__overlap.worst[id] ?? -1, id);
        if (w > ALLOWED) { await shot(shotName); shotTaken = true; }
      }
    }
    await p.keyboard.up('KeyW');
    await frames(3);
    const o = await overlap();
    const end = await pos();
    const into = o.worst[id] ?? -Infinity;
    const chairInto = Math.max(...chairs.map((c) => o.worst[c.id] ?? -Infinity));
    if (shotName && !shotTaken && into > ALLOWED) await shot(shotName);
    log(`${view} person, keys: ${name}: the body never overlaps the table`, into <= ALLOWED,
      `${into > -Infinity ? `${f2(into)} m into it at ${JSON.stringify(o.at[id])}` : 'never near it'}; end (${f2(end.x)}, ${f2(end.z)}) floor ${end.floor}; chairs: ${f2(chairInto)} m`);
    return into;
  };

  const A = boxes.A ?? { x0: 0.9, x1: 4.1, z0: -0.7, z1: 0.7 };
  const ctr = { x: TA.x, z: TA.z };
  const approaches = [
    ['A from the south, between two chairs', { x: TA.x - 0.5, z: 2.6 }, { x: TA.x - 0.5, z: 0 }],
    ['A from the south, at a chair', { x: TA.x, z: 2.6 }, ctr],
    ['A from the north, between two chairs', { x: TA.x + 0.5, z: -2.6 }, { x: TA.x + 0.5, z: 0 }],
    ['A from the west end (past its chair)', { x: A.x0 - 1.4, z: 0.55 }, { x: A.x1, z: 0.55 }],
    ['A from the east end, at its corner', { x: A.x1 + 1.4, z: -0.6 }, { x: A.x0, z: -0.6 }],
    ['A diagonally from the south-west', { x: A.x0 - 0.9, z: 2.0 }, ctr],
  ];
  for (const [name, from, to] of approaches) {
    await walkAt(name, 'tableA', from, to, { shotName: name.includes('west end') ? 'table-A-walk-in-third-person.png' : null });
  }
  // first person (V)
  await p.keyboard.press('KeyV'); await frames(2);
  for (const [name, from, to] of approaches.slice(0, 3)) await walkAt(name, 'tableA', from, to, { view: 'first' });
  await walkAt(approaches[3][0], 'tableA', approaches[3][1], approaches[3][2], { view: 'first', shotName: 'table-A-walk-in-first-person.png' });
  await p.keyboard.press('KeyV'); await frames(2);

  // the stretched, turned table
  const B = boxes.B ?? { x0: 7.66, x1: 9.34, z0: -2.4, z1: 2.4 };
  for (const [name, from, to] of [
    ['B (stretched, turned) from the west, near its end', { x: B.x0 - 1.4, z: B.z0 + 0.4 }, { x: B.x1, z: B.z0 + 0.4 }],
    ['B from the east', { x: 10.5, z: 0.5 }, { x: B.x0, z: 0.5 }],
    ['B from the north, along its length', { x: TB.x + 0.3, z: -3.5 }, { x: TB.x + 0.3, z: 3 }],
    ['B from the south', { x: TB.x - 0.5, z: 3.5 }, { x: TB.x - 0.5, z: -3 }],
  ]) await walkAt(name, 'tableB', from, to, { shotName: name.includes('north') ? 'table-B-walk-in.png' : null });

  // click-to-walk: to the middle of the table, and to its far side (round it)
  for (const [name, start, goal, id] of [
    ['to the middle of table A', { x: TA.x, z: 2.6 }, ctr, 'tableA'],
    ['to the far side of table A', { x: TA.x, z: 2.6 }, { x: TA.x, z: -2.2 }, 'tableA'],
    ['to the middle of table B', { x: 6.2, z: 0 }, { x: TB.x, z: TB.z }, 'tableB'],
  ]) {
    await pose({ ...start, floor: 1, yaw: yawTo(start, goal), pitch: -0.2, fly: false });
    await watch([id]);
    await p.evaluate(() => { window.__viewerNav = []; });
    const r = await p.evaluate(({ goal }) => {
      const res = window.__ahdusViewer.navigation.routeTo({ x: goal.x, z: goal.z, floor: 1, name: 'there' }, { walk: 'auto' });
      return res && typeof res === 'object' ? { ok: res.ok ?? null, problem: res.problem ?? res.message ?? null } : res;
    }, { goal });
    await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => ['arrived', 'failed', 'stopped'].includes(e.state)), null, { timeout: 90000, polling: 300 }).catch(() => {});
    await frames(3);
    const o = await overlap();
    const end = await pos();
    const into = o.worst[id] ?? -Infinity;
    log(`click-to-walk ${name}: the body never overlaps the table`, into <= ALLOWED,
      `${f2(into)} m into it; route ${JSON.stringify(r)}; end (${f2(end.x)}, ${f2(end.z)})`);
  }

  // landing after flying over the table (F, then F again over its middle)
  for (const [name, at, id] of [['A', ctr, 'tableA'], ['B', { x: TB.x, z: TB.z + 1 }, 'tableB']]) {
    await pose({ x: at.x, z: at.z, floor: 1, y: H + 2.2, fly: true, exact: true, yaw: 0, pitch: -0.4 });
    await frames(3);
    await watch([id]);
    const before = await pos();
    await p.keyboard.press('KeyF'); // stop flying: you land
    await wait(1500); await frames(3);
    const o = await overlap();
    const end = await pos();
    const into = o.worst[id] ?? -Infinity;
    log(`landing from flying over table ${name}: never inside it`, before.flying && !end.flying && into <= ALLOWED,
      `flying before ${before.flying}, after ${end.flying}; ${f2(into)} m into it; landed at (${f2(end.x)}, ${f2(end.z)}) y ${f2(end.y)}`);
  }

  // spawning on the table (setPose, not exact: the nearest spot where the body fits)
  for (const [name, at, id] of [['A', ctr, 'tableA'], ['A, at its edge between chairs', { x: TA.x - 0.5, z: 0.6 }, 'tableA'], ['B', { x: TB.x, z: TB.z - 1.5 }, 'tableB']]) {
    await watch([id]);
    await pose({ x: at.x, z: at.z, floor: 1, yaw: 0, pitch: -0.2, fly: false });
    await wait(800); await frames(3);
    const o = await overlap();
    const end = await pos();
    const into = o.worst[id] ?? -Infinity;
    log(`spawning on table ${name}: put beside it, never inside`, into <= ALLOWED, `${f2(into)} m into it; at (${f2(end.x)}, ${f2(end.z)})`);
  }

  // a seat at the table can still be reached by a click (route to a chair)
  {
    const seat = chairs.find((c) => c.id === 'cs1');
    await pose({ x: 6.0, z: 3.0, floor: 1, yaw: 0, pitch: -0.2, fly: false });
    await p.evaluate(() => { window.__viewerNav = []; });
    // the spot just behind the chair where a body fits (the chair 0.6 m deep, the body 0.32 m + clearance)
    await p.evaluate(({ seat }) => window.__ahdusViewer.navigation.routeTo({ x: seat.x, z: seat.z + 0.75, floor: 1, name: 'a seat' }, { walk: 'auto' }), { seat });
    await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => ['arrived', 'failed', 'stopped'].includes(e.state)), null, { timeout: 90000, polling: 300 }).catch(() => {});
    const state = await p.evaluate(() => (window.__viewerNav ?? []).find((e) => ['arrived', 'failed', 'stopped'].includes(e.state))?.state ?? 'none');
    const end = await pos();
    const off = Math.hypot(end.x - seat.x, end.z - (seat.z + 0.75));
    // a walk arrives within 1 m of its goal (follow.ARRIVE_WITHIN); the spot itself is free floor (no strip there)
    const free = await p.evaluate(({ x, z }) => window.__ahdusViewer.walkthrough.isFree(x, z, 1), { x: seat.x, z: seat.z + 0.75 });
    log('click-to-walk still reaches a seat at the table (just behind its chair: free floor, arrived within 1 m)',
      state === 'arrived' && off <= 1.05 && free,
      `${state}, end (${f2(end.x)}, ${f2(end.z)}), ${f2(off)} m from the spot, the spot free ${free}`);
  }

  // the screenshot as reported: third person, looking at the table from its near long side
  await pose({ x: TA.x - 0.6, z: 2.4, floor: 1, yaw: Math.PI, pitch: -0.2, fly: false });
  await wait(600); await frames(3);
  await shot('table-view.png');
}

async function gapPart() {
  await openViewer();
  const inStrip = (q) => q.floor === 0 && q.y < 0.15 && (
    (q.x < INNER.x0 + GAP && q.z > INNER.z0 && q.z < L.z + 1.6) // west strip, beside the first flight + landing
    || (q.z < INNER.z0 + GAP && q.x > INNER.x0 && q.x < L.x + 1.6)); // north strip, behind the landing + second flight
  /** Hold each of W, S, A, D for 1.2 s: stuck = none of them moves the body 0.1 m. */
  const stuckTest = async () => {
    const moves = {};
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
      const a = await pos();
      await hold(k, 1200);
      const c = await pos();
      moves[k.slice(3)] = +Math.hypot(c.x - a.x, c.z - a.z).toFixed(2);
      if (moves[k.slice(3)] >= 0.1) break;
    }
    return { stuck: Object.values(moves).every((d) => d < 0.1), moves };
  };
  /** Walk from `from` (floor 0) facing `yaw` with W for `ms`; were we ever in a strip; stuck at the end? */
  const tryGap = async (name, from, yaw, { ms = 3500, fy = 0, after = null, shotName = null } = {}) => {
    await pose({ x: from.x, z: from.z, floor: fy, yaw, pitch: -0.3, fly: false });
    await wait(300);
    await p.keyboard.down('KeyW');
    let entered = null;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await wait(150);
      const q = await pos();
      if (!entered && inStrip(q)) entered = q;
    }
    await p.keyboard.up('KeyW');
    if (after) await after();
    await frames(2);
    const end = await pos();
    if (shotName) await shot(shotName);
    const s = await stuckTest();
    log(`keys: ${name}: never in a ${GAP} m strip, never stuck`, !entered && !s.stuck,
      `${entered ? `in the strip at (${f2(entered.x)}, ${f2(entered.z)})` : 'not in a strip'}; end (${f2(end.x)}, ${f2(end.z)}) y ${f2(end.y)} floor ${end.floor}; ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
  };
  const N = Math.PI; // facing north (−Z)
  const W = -Math.PI / 2; // facing west (−X)
  // along the west wall, northwards into the strip beside the first flight
  await tryGap('north along the west wall, into the strip beside the first flight', { x: INNER.x0 + 0.34, z: 2.4 }, N, { shotName: 'gap-west-wall-walk.png' });
  // up the first flight on its wall side, on to the landing, then into the corner
  await tryGap('up the first flight on its wall side, into the corner', { x: L.x - 1.45, z: 1.8 }, N, {
    ms: 5000, after: async () => {
      const q = await pos(); // on the landing: turn west (exact: where you stand) and walk into the corner
      await pose({ x: q.x, z: q.z, y: q.y, floor: q.floor, yaw: -Math.PI / 2, pitch: -0.3, fly: false, exact: true });
      await hold('KeyW', 1500); await hold('KeyD', 1500);
    },
  });
  // west along the north wall at floor level, from the room's east side towards the corner (under the second flight)
  await tryGap('west along the north wall towards the corner', { x: INNER.x1 - 0.4, z: INNER.z0 + 0.34 }, W, { ms: 4000, shotName: 'gap-north-wall-walk.png' });
  // stepping off the first flight's side towards the west wall halfway up
  await tryGap('off the first flight sideways towards the west wall', { x: L.x - 1.0, z: L.z + 0.4 }, W, { ms: 2500, after: async () => { await hold('KeyW', 1500); } });
  // up the first flight, then off the landing northwards towards the north wall and east behind the second flight
  await tryGap('up the first flight, off the landing to the north wall and east behind the second flight', { x: L.x - 1.0, z: 1.8 }, N, {
    ms: 5000, after: async () => {
      const q = await pos();
      await pose({ x: q.x, z: q.z, y: q.y, floor: q.floor, yaw: N, pitch: -0.3, fly: false, exact: true });
      await hold('KeyW', 1500);
      const r = await pos();
      await pose({ x: r.x, z: r.z, y: r.y, floor: r.floor, yaw: Math.PI / 2, pitch: -0.3, fly: false, exact: true });
      await hold('KeyW', 2000);
    },
  });
  // down from Floor 1: the second flight down, keeping to its wall side
  await tryGap('down the second flight on its wall side', { x: L.x + 2.4, z: INNER.z0 + 0.36 }, W, { ms: 6000, fy: 1 });
  // click-to-walk into the strip
  {
    await pose({ x: -3, z: 2.2, floor: 0, yaw: N, pitch: -0.3, fly: false });
    await p.evaluate(() => { window.__viewerNav = []; });
    const r = await p.evaluate(({ x, z }) => {
      const res = window.__ahdusViewer.navigation.routeTo({ x, z, floor: 0, name: 'the strip' }, { walk: 'auto' });
      return res && typeof res === 'object' ? { ok: res.ok ?? null, problem: res.problem ?? res.message ?? null } : res;
    }, { x: INNER.x0 + GAP / 2, z: -1.0 });
    await p.waitForFunction(() => (window.__viewerNav ?? []).some((e) => ['arrived', 'failed', 'stopped'].includes(e.state)), null, { timeout: 60000, polling: 300 }).catch(() => {});
    await frames(3);
    const end = await pos();
    const s = await stuckTest();
    log(`click-to-walk into the ${GAP} m strip: refused or stops outside it, never stuck`, !inStrip(end) && !s.stuck,
      `route ${JSON.stringify(r)}; end (${f2(end.x)}, ${f2(end.z)}) y ${f2(end.y)}; ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
  }
  const inStairRoom = (c) => c.floor === 0 && c.x > INNER.x0 && c.x < INNER.x1 && c.z > INNER.z0 && c.z < INNER.z1;
  // forced into the strip (put there exactly, as a landing or an old save can): holding a direction gets you out
  // (the push out of the strip, or the 1 s safety net), into the stair room, and you can walk on
  {
    await pose({ x: INNER.x0 + GAP / 2, z: -0.6, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await shot('gap-forced-in.png');
    const a = await pos();
    await hold('KeyD', 2200);
    const c = await pos();
    const s = await stuckTest();
    log('forced into the strip, holding a direction for 2 s: out of the strip, in the stair room, can walk on',
      !inStrip(c) && inStairRoom(c) && !s.stuck,
      `from (${f2(a.x)}, ${f2(a.z)}) to (${f2(c.x)}, ${f2(c.z)}) floor ${c.floor}; ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
  }
  // forced into the strip: U (Get unstuck), straight away
  {
    await pose({ x: INNER.x0 + GAP / 2, z: -0.6, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await p.keyboard.press('KeyU');
    await wait(400); await frames(3);
    const c = await pos();
    const free = await p.evaluate(({ x, z }) => window.__ahdusViewer.walkthrough.isFree(x, z, 0), c);
    log('forced into the strip, U (Get unstuck): to free floor in the same room, same floor',
      !inStrip(c) && free && inStairRoom(c), `at (${f2(c.x)}, ${f2(c.z)}) floor ${c.floor}, free ${free}`);
  }
  // under the stairs: put on the floor under the second flight's high end (headroom < the avatar), as Himan found
  // himself after walking off the flight: pushed out to the open side (never into the wall), never blocked both ways
  const under = { x: L.x + 1.0, z: L.z - 1.0 }; // under the second flight (180°: it runs east along the north wall)
  {
    await pose({ x: under.x, z: under.z, y: 0, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await frames(6);
    const c = await pos();
    const s = await stuckTest();
    const e = await pos();
    log('under the stairs (put there, facing the wall): out to the open side, in the stair room, can walk on',
      inStairRoom(e) && !inStrip(e) && !s.stuck && c.y < 0.3,
      `put at (${f2(under.x)}, ${f2(under.z)}); after a frame (${f2(c.x)}, ${f2(c.z)}) y ${f2(c.y)}; end (${f2(e.x)}, ${f2(e.z)}) floor ${e.floor}; ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
    await shot('under-stairs.png');
  }
  {
    await pose({ x: under.x, z: under.z, y: 0, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await p.keyboard.press('KeyU');
    await wait(400); await frames(3);
    const c = await pos();
    const free = await p.evaluate(({ x, z }) => window.__ahdusViewer.walkthrough.isFree(x, z, 0), c);
    log('under the stairs, U (Get unstuck): to free floor in the same room, same floor',
      free && inStairRoom(c) && c.y < 0.3, `at (${f2(c.x)}, ${f2(c.z)}) y ${f2(c.y)} floor ${c.floor}, free ${free}`);
  }
  // walking off the second flight sideways (south) halfway up: you come down on the floor beside it, not under it
  {
    await pose({ x: L.x + 2.4, z: INNER.z0 + GAP + 0.6, floor: 1, yaw: W, pitch: -0.3, fly: false });
    await hold('KeyW', 900); // from Floor 1 down the second flight, about halfway (2.2 m/s)
    const q = await pos();
    await pose({ x: q.x, z: q.z, y: q.y, floor: q.floor, yaw: 0, pitch: -0.3, fly: false, exact: true }); // face south
    await hold('KeyW', 1500);
    await frames(4);
    const c = await pos();
    const s = await stuckTest();
    const e = await pos();
    const underIt = c.y < 0.3 && c.x > L.x - 0.4 && c.x < L.x + 1.6 && c.z > L.z - 1.6 && c.z < L.z - 0.4;
    log('off the second flight sideways: down on the floor beside it (not under it), can walk on',
      !underIt && !s.stuck, `from (${f2(q.x)}, ${f2(q.z)}) y ${f2(q.y)}; down at (${f2(c.x)}, ${f2(c.z)}) y ${f2(c.y)}; end (${f2(e.x)}, ${f2(e.z)}); ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
  }
  // the desk ring in the Hall: inside it, holding W into a desk: the 1 s safety net moves you out to the Hall's floor
  const inRing = (c) => c.x > RING.x - 0.7 && c.x < RING.x + 0.7 && c.z > RING.z - 0.5 && c.z < RING.z + 0.5;
  const inHall = (c) => c.floor === 0 && c.x > -1 && c.x < 11 && c.z > -4 && c.z < 4;
  {
    await pose({ x: RING.x, z: RING.z, y: 0, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await shot('desk-ring-trapped.png');
    await hold('KeyW', 2600);
    const c = await pos();
    const msg = await p.evaluate(() => document.body.innerText.match(/You were stuck[^\n]*/)?.[0] ?? null);
    const s = await stuckTest();
    log('closed in by four desks, holding W for 2.5 s: the safety net moves you out, to the Hall, same floor',
      !inRing(c) && inHall(c) && !s.stuck,
      `at (${f2(c.x)}, ${f2(c.z)}) floor ${c.floor}; message ${JSON.stringify(msg)}; ${s.stuck ? 'STUCK' : 'can move'} ${JSON.stringify(s.moves)}`);
  }
  {
    await pose({ x: RING.x, z: RING.z, y: 0, floor: 0, yaw: N, pitch: -0.3, fly: false, exact: true });
    await p.keyboard.press('KeyU');
    await wait(400); await frames(3);
    const c = await pos();
    const free = await p.evaluate(({ x, z }) => window.__ahdusViewer.walkthrough.isFree(x, z, 0), c);
    log('closed in by four desks, U (Get unstuck): out of the ring to free floor in the Hall',
      !inRing(c) && inHall(c) && free, `at (${f2(c.x)}, ${f2(c.z)}) floor ${c.floor}, free ${free}`);
  }
  // U on open floor: nothing moves ("You are not stuck here")
  {
    await pose({ x: 3, z: 2.5, floor: 0, yaw: N, pitch: -0.3, fly: false });
    const a = await pos();
    await p.keyboard.press('KeyU');
    await wait(300); await frames(2);
    const c = await pos();
    log('U on open floor: stays put', Math.hypot(c.x - a.x, c.z - a.z) < 0.05, `moved ${f2(Math.hypot(c.x - a.x, c.z - a.z))} m`);
  }
  // the screenshot as reported: from above, the stair room
  await p.evaluate(() => window.__ahdusViewer.setMode('planner'));
  await frames(4);
  await p.evaluate(({ x, z }) => {
    const cam = window.__ahdusViewer.scene.activeCamera;
    if (cam.setTarget) cam.setTarget(new cam.target.constructor(x, 0, z));
    if ('beta' in cam) { cam.alpha = -Math.PI / 2; cam.beta = 0.05; cam.radius = 12; }
  }, { x: -4, z: 0 });
  await frames(6); await wait(500);
  await shot('stairs-gap-from-above.png');
}

try {
  if (PART === 'all' || PART === 'studio') await studio();
  if (PART === 'all' || PART === 'table') await tablePart();
  if (PART === 'all' || PART === 'gap') await gapPart();
} catch (e) {
  errs.push('script: ' + (e?.stack ?? e));
} finally {
  await b.close();
}
