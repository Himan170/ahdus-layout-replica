// Nested-room smoke test: rooms inside a room, save, reopen, and check that
// their footprints and the parent's floor cutouts are kept.
//   Ground floor: an office with a meeting room and a cabin inside it; the
//     cabin is moved by dragging its floor (Studio, 2D).
//   Floor 1: an office with a neighbour back to back (shared wall, a door
//     through it) and a meeting room inside it right next to that shared wall,
//     with its own door. Whichever room builds the shared wall (ids are UUIDs).
// Floor / ceiling pieces are merged into one mesh per room, so areas are
// measured from the mesh's triangles and holes with rays.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev                (in one terminal)
//                   npm run e2e:nested-rooms   (in another)
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
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
});
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

// Measuring helpers, in the page
await page.addInitScript(() => {
  const roomMeshes = (roomId, part) => (window.__ahdusScene?.meshes ?? []).filter((m) =>
    m.metadata?.roomId === roomId && m.metadata?.part === part && !m.isDisposed());
  window.__nested = {
    /** Area of a room's floor (its merged mesh: flat triangles). */
    floorArea(roomId) {
      let sum = 0;
      for (const mesh of roomMeshes(roomId, 'floor')) {
        const pos = mesh.getVerticesData('position');
        const idx = mesh.getIndices();
        for (let t = 0; t < idx.length; t += 3) {
          const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[i * 3], pos[i * 3 + 2]]);
          sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
        }
      }
      return sum;
    },
    /** Does a ray straight down at (x, z) hit this room's floor? */
    floorAt(roomId, x, z) {
      const sc = window.__ahdusScene;
      const ray = sc.activeCamera.getForwardRay();
      const V = sc.activeCamera.position.constructor;
      ray.origin = new V(x, 50, z); ray.direction = new V(0, -1, 0); ray.length = 100;
      return roomMeshes(roomId, 'floor').some((m) => ray.intersectsMesh(m).hit);
    },
    /** Shared wall meshes between two rooms (built by whichever id sorts first). */
    sharedWalls(a, b) {
      return (window.__ahdusScene?.meshes ?? []).filter((m) => m.name.startsWith('wall_') && m.metadata?.part === 'wall' &&
        ((m.metadata.roomId === a && m.metadata.sharedWith === b) || (m.metadata.roomId === b && m.metadata.sharedWith === a)));
    },
    /** Pick panes (one per doorway) of doors that belong to these rooms. */
    doorPanes(ids) {
      return (window.__ahdusScene?.meshes ?? []).filter((m) =>
        ids.includes(m.metadata?.roomId) && m.metadata?.part === 'door' && m.metadata.pickPane).length;
    },
  };
});

try {
  await page.goto(url);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.fill('input[placeholder="Company name…"]', 'Nested Room Test');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('input[placeholder="Layout name…"]', { timeout: 30000 });
  await page.fill('input[placeholder="Layout name…"]', 'Nested Room Layout');
  await page.press('input[placeholder="Layout name…"]', 'Enter');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusStore && window.__ahdusScene);
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));

  // ── Ground floor: two rooms inside an office ──
  const ids = await page.evaluate(() => {
    const store = window.__ahdusStore.getState();
    const office = store.addRoom({ type: 'OFFICE', name: 'Large Office', x: 0, z: 0, width: 12, depth: 10, floor: 0 }).id;
    const meeting = store.addRoom({ type: 'MEETING', name: 'Meeting Room', x: -3, z: 0, width: 3, depth: 3, floor: 0 }).id;
    const cabin = store.addRoom({ type: 'CUSTOM', name: 'Private Cabin', x: 3, z: 0, width: 3, depth: 3, floor: 0 }).id;
    return { office, meeting, cabin };
  });

  await page.click('[aria-label="2D view"]');
  await page.waitForTimeout(1500);
  await page.waitForFunction(({ cabin }) => window.__ahdusScene.meshes.some((mesh) =>
    mesh.name.startsWith(`floor_${cabin}_`)), ids, { timeout: 30000 });
  const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
    const scene = window.__ahdusScene;
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
  // The cabin is selected (added last): drag its floor 1 m east and 1 m north
  const start = await toScreen(3, 0.02, 0);
  const end = await toScreen(4, 0.02, 1);
  await page.mouse.move(start.x, start.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  const moved = await page.waitForFunction(({ cabin }) => {
    const room = window.__ahdusStore.getState().rooms[cabin];
    return Math.abs(room.x - 4) < 0.01 && Math.abs(room.z - 1) < 0.01 && room.width === 3 && room.depth === 3;
  }, ids, { timeout: 30000 }).then(() => true, () => false);
  log('dragging a selected nested room moves it without changing its size', moved);

  // A room in the office's north-west corner, as close to its walls as allowed (0.15 m): x -5.85..-3.85, z 2.85..4.85
  ids.corner = await page.evaluate(() => window.__ahdusStore.getState().addRoom({
    type: 'CUSTOM', name: 'Corner Room', x: -4.85, z: 3.85, width: 2, depth: 2, floor: 0 }).id);

  // ── Floor 1: nested room next to a shared wall, with doors ──
  const up = await page.evaluate(() => {
    const store = window.__ahdusStore.getState();
    store.addFloor('Floor 1');
    // office x -6..6; neighbour back to back east of it (x 6.15..10.15): shared wall at x 6.075
    const office = store.addRoom({ type: 'OFFICE', name: 'Upper Office', x: 0, z: 0, width: 12, depth: 10, floor: 1 }).id;
    const neighbour = store.addRoom({ type: 'OFFICE', name: 'Upper Neighbour', x: 8.15, z: 0, width: 4, depth: 10, floor: 1 }).id;
    // inside the office, as close to the shared wall as allowed (0.15 m): x 2.85..5.85
    const nested = store.addRoom({ type: 'MEETING', name: 'Upper Meeting', x: 4.35, z: 0, width: 3, depth: 3, floor: 1 }).id;
    store.updateRoom(office, { doors: [{ wall: 'east', offset: 3, width: 1, height: 2.1 }] });
    store.updateRoom(neighbour, { doors: [{ wall: 'west', offset: 3, width: 1, height: 2.1 }] });
    store.updateRoom(nested, { doors: [{ wall: 'west', offset: 0, width: 0.9, height: 2.1 }] });
    return { office, neighbour, nested };
  });

  const inspect = () => page.evaluate(({ ids, up }) => {
    const n = window.__nested;
    const rooms = window.__ahdusStore.getState().rooms;
    const box = n.sharedWalls(up.office, up.neighbour)[0]?.getBoundingInfo().boundingBox;
    const pick = (r) => ({ x: r.x, z: r.z, width: r.width, depth: r.depth, floor: r.floor, doors: r.doors.length });
    const wallBox = (roomId, wallName) => window.__ahdusScene.meshes.find((m) => m.name.startsWith('wall_') &&
      m.metadata?.roomId === roomId && m.metadata.wallName === wallName && m.metadata.part === 'wall')?.getBoundingInfo().boundingBox;
    const west = wallBox(ids.corner, 'west');
    const north = wallBox(ids.corner, 'north');
    return {
      rooms: Object.keys(rooms).length,
      corner: {
        // the office's inner wall faces are at x -5.925 and z 4.925
        westGap: west ? west.minimumWorld.x - -5.925 : null,
        northGap: north ? 4.925 - north.maximumWorld.z : null,
        cornerGap: north ? north.minimumWorld.x - -5.925 : null,
        ownRoof: window.__ahdusScene.meshes.some((m) => m.metadata?.roomId === ids.corner && m.metadata.part === 'roof'),
      },
      ground: {
        area: n.floorArea(ids.office) + n.floorArea(ids.meeting) + n.floorArea(ids.cabin) + n.floorArea(ids.corner),
        holeUnderMeeting: !n.floorAt(ids.office, -3, 0) && n.floorAt(ids.meeting, -3, 0),
        officeFloorElsewhere: n.floorAt(ids.office, 5, 4),
        meeting: pick(rooms[ids.meeting]), cabin: pick(rooms[ids.cabin]),
      },
      upper: {
        officeArea: n.floorArea(up.office),
        holeUnderNested: !n.floorAt(up.office, 4.35, 0) && n.floorAt(up.nested, 4.35, 0),
        sharedWalls: n.sharedWalls(up.office, up.neighbour).length,
        sharedAt: box ? (box.minimumWorld.x + box.maximumWorld.x) / 2 : null,
        nestedShares: n.sharedWalls(up.nested, up.office).length + n.sharedWalls(up.nested, up.neighbour).length,
        doorPanes: n.doorPanes([up.office, up.neighbour, up.nested]),
        nested: pick(rooms[up.nested]),
      },
    };
  }, { ids, up });

  const check = (state, when) => {
    const g = state.ground;
    const u = state.upper;
    // office 12 × 10 minus two 3.15 × 3.15 and one 2.15 × 2.15 cutouts, plus the rooms (3 × 3, 3 × 3, 2 × 2)
    log(`${when}: ground floor, the office floor is cut out under the rooms inside it`,
      state.rooms === 7 && near(g.area, 120 - 2 * 3.15 * 3.15 - 2.15 * 2.15 + 9 + 9 + 4) && g.holeUnderMeeting && g.officeFloorElsewhere,
      JSON.stringify(g));
    const c = state.corner;
    log(`${when}: a room 0.15 m from the office's walls: its wall faces stay 1 cm off the office's, no roof of its own`,
      near(c.westGap, 0.01, 0.002) && near(c.northGap, 0.01, 0.002) && near(c.cornerGap, 0.01, 0.002) && !c.ownRoof,
      JSON.stringify(c));
    log(`${when}: ground floor, the nested rooms keep their place and size`,
      g.meeting.x === -3 && g.meeting.z === 0 && g.cabin.x === 4 && g.cabin.z === 1 && g.cabin.width === 3);
    log(`${when}: Floor 1, a nested room next to a shared wall: one shared wall, not shared with the nested room`,
      u.sharedWalls === 1 && near(u.sharedAt, 6.075, 0.005) && u.nestedShares === 0, JSON.stringify(u));
    log(`${when}: Floor 1, the office floor is cut out under it, and the doors are there`,
      near(u.officeArea, 120 - 3.15 * 3.15) && u.holeUnderNested && u.doorPanes === 2 &&
      u.nested.floor === 1 && u.nested.x === 4.35 && u.nested.doors === 1);
  };

  await page.waitForFunction(({ up }) => document.querySelector('.studio-header__status')?.textContent === 'Saved' &&
    window.__nested.sharedWalls(up.office, up.neighbour).length > 0, { up }, { timeout: 60000 });
  check(await inspect(), 'before saving');

  await page.click('[aria-label="All layouts"]');
  await page.waitForSelector('button[aria-label="Open Nested Room Layout"]', { timeout: 30000 });
  await page.click('button[aria-label="Open Nested Room Layout"]');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(({ ids, up }) => window.__ahdusScene && window.__ahdusStore &&
    window.__nested.floorArea(ids.office) > 0 && window.__nested.sharedWalls(up.office, up.neighbour).length > 0,
  { ids, up }, { timeout: 60000 });
  check(await inspect(), 'after reopening');

  // ── Preview, next to the corner room where its walls meet the office's ──
  const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
    const sc = window.__ahdusScene; let c = 0; let t = null;
    const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
    function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
    t = setTimeout(done, 60000);
  }), n);
  await page.mouse.move(640, 380);
  await page.click('[aria-label="Preview Workplace"]'); await page.waitForTimeout(800);
  if (!(await page.evaluate(() => !!document.pointerLockElement))) {
    await page.click('button:has-text("Start preview")'); await page.waitForTimeout(400);
  }
  // first person, standing in the office south-east of the corner room, looking at where
  // its south-west corner meets the office's west wall (-5.9, 2.85)
  await page.keyboard.press('KeyV'); await frames(3);
  const [sx, sz] = [-1.2, 2.4]; // in the office, north of the meeting room, ~4.7 m from the spot
  await page.evaluate(([x, z]) => window.__ahdusPlay.setPose({ x, z, yaw: Math.atan2(-5.9 - x, 2.85 - z), pitch: -0.15, floor: 0 }), [sx, sz]);
  await frames(6);
  await page.screenshot({ path: 'e2e/screens/nested-wall-joint-preview.png', timeout: 120000 });
  // flying over Floor 1: the meeting room inside the upper office has no roof lying in the office's roof
  await page.evaluate(() => window.__ahdusPlay.setPose({ x: 4.35, z: -9, yaw: 0, pitch: -0.55, floor: 1, y: 7, fly: true }));
  await frames(6);
  await page.screenshot({ path: 'e2e/screens/nested-roof-preview.png', timeout: 120000 });
  await page.keyboard.press('KeyV');
  log('Preview screenshots taken next to the corner room (e2e/screens/nested-*-preview.png)', true);
} finally {
  log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
