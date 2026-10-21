// Nested-room smoke test: rooms inside a room, save, reopen, and check that
// their footprints and the parent's floor cutouts are kept.
//   Ground floor: an office with a meeting room and a cabin inside it; the
//     cabin is moved by dragging its floor (Studio, 2D).
//   Floor 1: an office with a neighbour back to back (shared wall, a door
//     through it) and a meeting room inside it right next to that shared wall,
//     with its own door. Whichever room builds the shared wall (ids are UUIDs).
//   Himan's case, on both floors (x ≈ 30): a 16 × 10 m office with two rooms
//     drawn inside it with the room tool, side by side (they snap back to back:
//     one wall) and one against the office's east wall (that wall is its wall:
//     one wall, built once), a door through each; picks select the room on
//     your side; saved and reopened. Screenshot: e2e/screens/nested-walls-after.png.
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
    /** Wall pieces an inner room builds where it stands on its outer room's wall. */
    sameSideWalls(innerId, outerId) {
      return (window.__ahdusScene?.meshes ?? []).filter((m) => m.name.startsWith('wall_') && m.metadata?.part === 'wall' &&
        m.metadata.sameSide && m.metadata.innerRoom === innerId && m.metadata.outerRoom === outerId);
    },
    /** Wall meshes a ray along +x from (x, y, z) passes through (pieces of one wall are merged: rays, not boxes). */
    wallsAlongX(x, y, z, length) {
      const sc = window.__ahdusScene;
      const ray = sc.activeCamera.getForwardRay();
      const V = sc.activeCamera.position.constructor;
      ray.origin = new V(x, y, z); ray.direction = new V(1, 0, 0); ray.length = length;
      return sc.meshes.filter((m) => m.name.startsWith('wall_') && m.metadata?.part === 'wall' && ray.intersectsMesh(m).hit)
        .map((m) => ({ roomId: m.metadata.roomId, sameSide: !!m.metadata.sameSide }));
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

  // ── Himan's case (ground floor here, Floor 1 below): drawn with the room tool ──
  const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
    const sc = window.__ahdusScene; let c = 0; let t = null;
    const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
    function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
    t = setTimeout(done, 60000);
  }), n);
  const hover = async (x, y, z) => { const p = await toScreen(x, y, z); await page.mouse.move(p.x, p.y, { steps: 3 }); await frames(2); };
  const clickAt = async (x, y, z) => { await hover(x, y, z); await page.mouse.down(); await page.mouse.up(); await frames(3); };
  const dragWorld = async (from, to) => {
    await hover(...from);
    await page.mouse.down();
    const p = await toScreen(...to);
    await page.mouse.move(p.x, p.y, { steps: 10 });
    await frames(2);
    await page.mouse.up();
    await frames(3);
  };
  const tile = async (label) => { await page.click(`[aria-label="${label}"]`); await frames(2); };
  const pick = async (tileLabel, option) => {
    await tile(tileLabel);
    await page.click(`[aria-label="${tileLabel} options"] button:has-text("${option}")`);
    await frames(2);
  };
  // 2D: look at (x, z), half a view height of `half` metres
  const look2D = async (x, z, half) => {
    await page.evaluate(([x, z, half]) => {
      const c = window.__ahdusScene.activeCamera;
      c.target.x = x; c.target.z = z;
      const a = window.__ahdusScene.getEngine().getAspectRatio(c);
      c.orthoTop = half; c.orthoBottom = -half; c.orthoLeft = -half * a; c.orthoRight = half * a;
    }, [x, z, half]);
    await frames(3);
  };
  const T = 0.15;
  async function buildCase(floor) {
    await page.evaluate((f) => window.__ahdusStore.getState().selectFloor(f), floor);
    await frames(3);
    const y = await page.evaluate((f) => {
      const floors = window.__ahdusStore.getState().floors;
      return Object.values(floors).filter((fl) => fl.id < f).reduce((sum, fl) => sum + (fl.height ?? 3.5), 0);
    }, floor);
    const big = await page.evaluate((f) => window.__ahdusStore.getState().addRoom({
      type: 'OFFICE', name: 'Office 1', x: 30, z: 0, width: 16, depth: 10, floor: f }).id, floor);   // x 22..38, z -5..5
    await look2D(30, 0, 9);
    await pick('Rooms', 'Office');
    await dragWorld([31.2, y, -2], [37.8, y, 3]);   // to the office's east wall (x 38)
    await dragWorld([26.1, y, -2], [30.9, y, 3]);   // ends near the first room's west wall: snaps back to back
    const ids = await page.evaluate(({ big, f }) => {
      const rooms = Object.values(window.__ahdusStore.getState().rooms).filter((r) => r.floor === f && r.id !== big && r.x > 22 && r.x < 38);
      const byX = rooms.sort((a, b) => b.x - a.x);
      return { big, o5: byX[0]?.id, o8: byX[1]?.id, count: rooms.length };
    }, { big, f: floor });
    const edges = await page.evaluate(({ o5, o8 }) => {
      const r = window.__ahdusStore.getState().rooms;
      const e = (x) => x && { west: x.x - x.width / 2, east: x.x + x.width / 2, south: x.z - x.depth / 2, north: x.z + x.depth / 2 };
      return { o5: e(r[o5]), o8: e(r[o8]) };
    }, ids);
    log(`Floor ${floor}: two rooms drawn inside the office: one stands on its east wall, the other snaps back to back with it`,
      ids.count === 2 && near(edges.o5?.east, 38, 0.01) && near(edges.o8?.east, edges.o5?.west - T, 0.01),
      JSON.stringify(edges));
    // Ctrl+Z / Ctrl+Y the second room
    await page.keyboard.press('Control+z'); await frames(3);
    const undone = await page.evaluate((id) => !window.__ahdusStore.getState().rooms[id], ids.o8);
    await page.keyboard.press('Control+y'); await frames(3);
    const redone = await page.evaluate((id) => !!window.__ahdusStore.getState().rooms[id], ids.o8);
    log(`Floor ${floor}: Ctrl+Z / Ctrl+Y undo and redo the snapped room`, undone && redone);
    // A door through each wall: between the two rooms, and through the office's east wall
    await pick('Doors & Windows', 'Door');
    await clickAt(edges.o5.west - T / 2 - 0.03, y + 3, 0.5);
    await clickAt(37.97, y + 3, 0.5);
    await tile('Select');
    // Picks: the shared outer wall from inside is the inner room, from outside the office
    await clickAt(37.98, y + 3, -1.2);
    const fromInside = await page.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
    await clickAt(38.05, y + 3, -1.2);
    const fromOutside = await page.evaluate(() => window.__ahdusStore.getState().selectedRoomId);
    log(`Floor ${floor}: clicking the wall the room stands on selects it from inside, the office from outside`,
      fromInside === ids.o5 && fromOutside === big, `${fromInside === ids.o5 ? 'inner' : fromInside} / ${fromOutside === big ? 'office' : fromOutside}`);
    return ids;
  }
  const caseGround = await buildCase(0);
  // The same view as Himan's screenshot (3D, from the south-west over the office), before = main
  await tile('3D view');
  await page.evaluate(() => {
    window.__ahdusStore.getState().selectRoom(null); // no Inspector: the same canvas size as the "before" shot
    const c = window.__ahdusScene.activeCamera;
    c.target.set(30, 0, 0); c.alpha = -2.1; c.beta = 0.9; c.radius = 24;
  });
  await frames(6);
  await page.screenshot({ path: 'e2e/screens/nested-walls-after.png', timeout: 120000 });
  await tile('2D view'); await frames(3);

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
  const caseUpper = await buildCase(1);
  const cases = [caseGround, caseUpper];

  const inspect = () => page.evaluate(({ ids, up, cases }) => {
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
      cases: cases.map((c) => {
        const o5 = rooms[c.o5];
        // across the office's east wall (x 38) where Office 5 stands, 1 m up
        const elev = Object.values(window.__ahdusStore.getState().floors).filter((f) => f.id < o5.floor)
          .reduce((sum, f) => sum + (f.height ?? 3.5), 0);
        const hits = n.wallsAlongX(37.5, elev + 1, -1.2, 1);
        return {
          between: n.sharedWalls(c.o5, c.o8).length,
          onOuter: n.sameSideWalls(c.o5, c.big).length,
          // the office's own east wall pieces leave out where Office 5 stands (z -2 .. 3)
          wallsThere: hits.length,
          officeWallThere: hits.filter((h) => h.roomId === c.big).length,
          doors: [rooms[c.big].doors.length, o5.doors.length, rooms[c.o8].doors.length],
          doorPanes: n.doorPanes([c.big, c.o5, c.o8]),
          contained: window.__ahdusStore.getState().rooms[c.o5].x + o5.width / 2,
        };
      }),
    };
  }, { ids, up, cases });

  const check = (state, when) => {
    const g = state.ground;
    const u = state.upper;
    // office 12 × 10 minus two 3.15 × 3.15 and one 2.15 × 2.15 cutouts, plus the rooms (3 × 3, 3 × 3, 2 × 2)
    state.cases.forEach((c, floor) => {
      log(`${when}: Floor ${floor}, one wall between the two rooms and one where a room stands on the office's wall`,
        c.between === 1 && c.onOuter >= 1 && c.wallsThere === 1 && c.officeWallThere === 0, JSON.stringify(c));
      log(`${when}: Floor ${floor}, a door through each wall, stored on both rooms, drawn once`,
        JSON.stringify(c.doors) === '[1,2,1]' && c.doorPanes === 2, JSON.stringify(c.doors));
    });
    log(`${when}: ground floor, the office floor is cut out under the rooms inside it`,
      state.rooms === 13 && near(g.area, 120 - 2 * 3.15 * 3.15 - 2.15 * 2.15 + 9 + 9 + 4) && g.holeUnderMeeting && g.officeFloorElsewhere,
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
  await page.waitForFunction(({ ids, up, cases }) => window.__ahdusScene && window.__ahdusStore &&
    window.__nested.floorArea(ids.office) > 0 && window.__nested.sharedWalls(up.office, up.neighbour).length > 0 &&
    window.__nested.sameSideWalls(cases[1].o5, cases[1].big).length > 0,
  { ids, up, cases }, { timeout: 60000 });
  check(await inspect(), 'after reopening');

  // ── Preview, next to the corner room where its walls meet the office's ──
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
