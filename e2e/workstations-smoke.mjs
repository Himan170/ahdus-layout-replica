// Workstations smoke test (v0.18.0): the library's prefabs (clusters, desk rows, manager, cabin) dropped
// in Workplace Studio, one undo step each; a click selects the cluster, its Inspector shows Seats 1…N
// (hovering a row tints that desk), Partition Glass keeps the ids, Ungroup, Alt+click = one desk, a
// pasted cluster is a new group (its seats empty); the drop hint and Check's 0.9 m aisle warning; a
// cluster in front of a door: Check's Fix it moves the whole cluster; an upper floor; an item type this
// version doesn't know = a plain box + one warning; people seated and typing at the workstations.
// v0.18.5: a cabin dragged / turned (R) moves its room with it; dropped against a wall its door turns
// into the room; Check's Fix it turns a cabin whose door faces a wall; a tile clicked in Plan view lands
// in the middle of the Plan.
// Results are checked in the store. Screenshots: e2e/screens/ (SHOTS=<dir>: also each prefab from above
// and at eye level, a 6-person cluster with people, the Seats list, the aisle warning).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev                  (in one terminal)
//                   npm run e2e:workstations     (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const shots = process.env.SHOTS ?? 'e2e/screens';
mkdirSync('e2e/screens', { recursive: true });
mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
const warnings = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
  if (results.some((r) => !r.ok) || errs.length) process.exitCode = 1;
});
const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return {
    rooms: Object.values(s.rooms), objects: Object.values(s.objects), currentFloor: s.currentFloor,
    selected: s.selectedObjectIds?.length ? s.selectedObjectIds : (s.selectedObjectId ? [s.selectedObjectId] : []),
    selectedOne: s.selectedObjectId,
  };
});
const shot = (name) => p.screenshot({ path: `${shots}/${name}`, timeout: 120000 });
const groupsOf = (objects) => {
  const m = new Map();
  for (const o of objects) {
    const g = o.metadata?.group;
    if (g) m.set(g.id, [...(m.get(g.id) ?? []), o]);
  }
  return m;
};
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
  await wait(250); await frames(1); // the Inspector opening / closing changes the canvas's size
  const s = await toScreen(x, y, z);
  await p.mouse.move(s.x - 3, s.y - 3);
  await p.mouse.move(s.x, s.y, { steps: 3 });
  await frames(2);
};
const clickAt = async (x, y, z, modifiers = []) => {
  await hover(x, y, z);
  for (const k of modifiers) await p.keyboard.down(k);
  await p.mouse.down(); await p.mouse.up();
  for (const k of modifiers) await p.keyboard.up(k);
  await frames(3);
};
const openFurniture = async () => {
  if (!(await p.locator('[data-library="furniture"]').isVisible().catch(() => false))) {
    await p.click('[aria-label="Furniture"]'); await frames(2);
  }
};
const closeFurniture = async () => {
  if (await p.locator('[data-library="furniture"]').isVisible().catch(() => false)) {
    await p.click('[aria-label="Furniture"]'); await wait(250); await frames(2);
  }
};
/** Drags a library tile onto a world point; `during` runs while the mouse is still down over the floor. */
const dragTile = async (name, x, z, during = null, y = 0.02) => {
  await openFurniture();
  await p.fill('[aria-label="Search furniture"]', name);
  await frames(1);
  const t = await p.locator(`.lib-tile[title^="${name}:"]`).first().boundingBox();
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await p.mouse.down();
  const to = await toScreen(x, y, z);
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await frames(2);
  await p.mouse.move(to.x + 1, to.y, { steps: 1 });
  await frames(2);
  const seen = during ? await during() : null;
  await p.mouse.up();
  await frames(3);
  await p.fill('[aria-label="Search furniture"]', '');
  await p.evaluate(() => document.activeElement?.blur()); // Studio's keys do nothing in a text field
  return seen;
};
const undo = async () => { await p.click('[aria-label="Undo"]'); await frames(3); };
const redo = async () => { await p.click('[aria-label="Redo"]'); await frames(3); };
const deselect = async () => { await p.evaluate(() => { const s = window.__ahdusStore.getState(); s.setObjectSelection?.([]); s.selectObject?.(null); s.selectRoom?.(null); }); await frames(2); };
const hint = () => p.locator('[data-studio="hint"]').innerText().catch(() => '');

// ── An open office on the ground floor and Floor 1 ──
const OFFICE = { w: 24, d: 16 }; // the door in the middle of the south wall, at z = −8
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Workstations Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Open office'); await p.click('button:has-text("Create")');
await p.waitForSelector('canvas', { timeout: 90000 });
await p.waitForSelector('[data-splash]', { state: 'detached', timeout: 90000 }).catch(() => {});
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await p.evaluate(({ w, d }) => {
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 }, 1: { id: 1, name: 'Floor 1', height: 3.5 } };
  const room = (floor) => ({
    id: `open_${floor}`, type: 'OFFICE', name: 'Open Office', floor, x: 0, z: 0, width: w, depth: d, wallHeight: 3.2,
    doors: [{ wall: 'south', offset: 0, width: 1, height: 2.1 }], windows: [],
  });
  window.__ahdusStore.getState().loadWorkspace({ layoutName: 'Open office', floors, rooms: [room(0), room(1)], objects: [] });
}, OFFICE);
await p.evaluate(() => window.__ahdusBuild?.whenBuilt());
await p.click('[aria-label="2D view"]'); await frames(3);
await p.click('[aria-label="Fit view"]'); await wait(600); await frames(3);

// ── The library ──
await openFurniture();
await p.click('[data-library="furniture"] [aria-label="Categories"] button:has-text("Workstations")'); await frames(1);
const pictures = await p.locator('[data-library="furniture"] [data-prefab-picture]').count();
const chip = await p.locator('[data-library="furniture"] [aria-label="Categories"] button:has-text("Workstations")').count();
log('the Furniture library shows the 8 workstation prefabs with their plans, under a Workstations chip', pictures === 8 && chip === 1, `${pictures} pictures`);

// ── A 6-person cluster, dropped ──
await dragTile('6-person cluster', -6, 2);
let st = await store();
let groups = groupsOf(st.objects);
const [gid, members] = [...groups.entries()][0] ?? [null, []];
log('dropping a 6-person cluster adds 6 desks + 6 chairs as one group', groups.size === 1 && members.length === 12
  && members.filter((o) => o.metadata.group.role === 'desk').length === 6 && members.every((o) => o.roomId === 'open_0'), `${st.objects.length} items`);
log('the whole cluster is selected and the Inspector lists Seats 1–6', st.selected.length === 12
  && await p.locator('[data-cluster]').count() === 1 && await p.locator('[data-seats="6"] li[data-seat]').count() === 6);
await undo();
log('one Undo removes the whole cluster', (await store()).objects.length === 0);
await redo();
st = await store();
log('Redo puts it back with the same ids', st.objects.length === 12 && members.every((o) => st.objects.some((x) => x.id === o.id)));
const desks = members.filter((o) => o.metadata.group.role === 'desk').sort((a, c) => a.metadata.group.slot - c.metadata.group.slot);

// ── The Seats list ──
await deselect();
await clickAt(desks[0].x, 0.75, desks[0].z);
st = await store();
log('a click on one of its desks selects the whole cluster', st.selected.length === 12, `${st.selected.length} selected`);
const row = p.locator('[data-seats] li[data-seat="2"]');
await row.hover(); await frames(3);
const seatId = await row.getAttribute('data-desk-id');
const tinted = await p.evaluate((id) => window.__ahdusScene.meshes.some((m) => m.metadata?.objectId === id && m.metadata?.highlightTint === '#F59E0B'), seatId);
log('hovering Seat 2 tints that desk in 3D (amber)', tinted, seatId);
await shot('workstations-seats-list.png');
await p.mouse.move(700, 450); await frames(2);

// ── Partition: Glass keeps every id ──
await p.locator('[data-prefab-partition] button', { hasText: 'Glass' }).click(); await frames(4);
st = await store();
const after = st.objects.filter((o) => o.metadata?.group?.id === gid);
log('Partition Glass rebuilds the cluster with the same ids (seats stay)', after.length === 12
  && members.every((o) => after.some((x) => x.id === o.id))
  && after.filter((o) => o.metadata.group.role === 'desk').every((o) => o.metadata.ws?.partition === 'glass')
  && st.selected.length === 12, after.filter((o) => o.metadata.group.role === 'desk').map((o) => o.metadata.ws?.partition).join(','));
await undo();
st = await store();
log('one Undo: fabric again', st.objects.filter((o) => o.metadata?.group?.role === 'desk').every((o) => o.metadata.ws?.partition !== 'glass'));

// ── Alt+click = one desk ──
await deselect();
await clickAt(desks[3].x, 0.75, desks[3].z, ['Alt']);
st = await store();
log('Alt+click selects just that desk', st.selectedOne === desks[3].id && st.selected.length === 1, `${st.selectedOne}`);
await p.click('[aria-label="Shortcuts"]'); await frames(1);
log('the Shortcuts help lists Alt+click', await p.getByText('One desk or chair of a cluster', { exact: true }).count() === 1);
await p.keyboard.press('Escape'); await frames(2);

// ── Ungroup ──
await deselect();
await clickAt(desks[0].x, 0.75, desks[0].z);
await p.click('[data-ungroup]'); await frames(3);
st = await store();
log('Ungroup: 12 separate items, nothing moved', st.objects.length === 12 && st.objects.every((o) => !o.metadata?.group)
  && members.every((o) => { const x = st.objects.find((y) => y.id === o.id); return Math.abs(x.x - o.x) < 1e-6 && Math.abs(x.z - o.z) < 1e-6; }));
await undo();
st = await store();
log('one Undo groups them again', groupsOf(st.objects).get(gid)?.length === 12);

// ── Copy / paste: a new group with new desks (nobody sits twice) ──
await deselect();
await clickAt(desks[0].x, 0.75, desks[0].z);
await p.keyboard.press('Control+c');
await hover(6, 0.02, 2);
await p.keyboard.press('Control+v'); await frames(4);
st = await store();
groups = groupsOf(st.objects);
const pasted = [...groups.entries()].find(([id]) => id !== gid)?.[1] ?? [];
log('Ctrl+V pastes the cluster as a new group with new ids', st.objects.length === 24 && groups.size === 2 && pasted.length === 12
  && pasted.every((o) => !members.some((m) => m.id === o.id)), `${groups.size} groups`);
await undo();
log('one Undo removes the pasted cluster', (await store()).objects.length === 12);

// ── The 0.9 m aisle: the drop hint, then Check ──
const right = await p.evaluate(async (gid) => {
  const { aisleGroups } = await import('/src/play/aisles.js');
  const { ASSET_TYPES } = await import('/src/utils/assetCatalog.js');
  const g = aisleGroups(Object.values(window.__ahdusStore.getState().objects), ASSET_TYPES).find((x) => x.groupId === gid);
  return { x: g.outline.x + g.outline.hw * 2 + 0.5, z: g.outline.z };
}, gid);
const dropHint = await dragTile('6-person cluster', right.x, right.z, hint);
log('dropping a cluster 0.5 m beside another: the hint says an aisle needs 0.9 m', /an aisle needs 0\.9 m/.test(dropHint), dropHint);
st = await store();
log('it is placed anyway (a warning, not a block)', groupsOf(st.objects).size === 2);
await p.click('[aria-label="Check layout"]');
const panel = p.getByRole('dialog', { name: 'Check my layout', exact: true });
await panel.waitFor();
const aisle = panel.getByRole('button', { name:/^Only 0\.\d m between the 6-person cluster and the 6-person cluster: an aisle needs 0\.9 m$/ });
await aisle.waitFor({ timeout: 20000 }).catch(() => {});
log('Check warns: "Only 0.x m between the 6-person cluster and the 6-person cluster"', await aisle.count() === 1);
await shot('workstations-aisle-warning.png');
await deselect();
await undo();
log('one Undo removes the second cluster', groupsOf((await store()).objects).size === 1);

// ── A cluster in front of the door: Fix it moves all of it ──
await dragTile('4-person cluster', 0, -OFFICE.d / 2 + 1.5); // 0.1 m from the wall, across the door
st = await store();
const doorGroup = [...groupsOf(st.objects).values()].find((g) => g.length === 8) ?? [];
const blocked = panel.getByRole('button', { name: /^The 4-person cluster blocks the door of Open Office(: only 0\.\d m to the wall)?$/ });
await blocked.waitFor({ timeout: 20000 }).catch(() => {});
log('Check: ONE line "The 4-person cluster blocks the door of Open Office", no "Nobody can walk to" lines', doorGroup.length === 8 && await blocked.count() === 1 && await panel.getByText(/Nobody can walk to .*Desk/).count() === 0,
  (await panel.locator('li').allInnerTexts()).map((t) => t.split(/\n/)[0]).join(' | ').slice(0, 400));
await panel.locator('li').filter({ hasText: 'The 4-person cluster blocks the door of Open Office' }).locator('[data-check-fix]').click().catch(() => {});
await frames(4);
st = await store();
const moved = doorGroup.map((o) => { const x = st.objects.find((y) => y.id === o.id) ?? o; return { dx: x.x - o.x, dz: x.z - o.z }; });
const same = moved.every((m) => Math.abs(m.dx - moved[0].dx) < 1e-3 && Math.abs(m.dz - moved[0].dz) < 1e-3);
await blocked.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
log('Fix it moves the whole cluster by the same step, and the problem is gone', same && Math.hypot(moved[0].dx, moved[0].dz) > 0.1
  && await blocked.count() === 0, JSON.stringify(moved[0]));
await undo();
st = await store();
log('one Undo puts it back in front of the door', doorGroup.length === 8 && doorGroup.every((o) => { const x = st.objects.find((y) => y.id === o.id); return x && Math.abs(x.z - o.z) < 1e-6; }));
await undo(); // and remove it
await p.keyboard.press('Escape');

// ── Manager workstation and a private cabin ──
await dragTile('Manager workstation', 8, 4.5);
st = await store();
const visitors = st.objects.filter((o) => o.metadata?.visitor);
log('a manager workstation: its desk, its chair and 2 visitor chairs', visitors.length === 2
  && st.objects.some((o) => o.assetType === 'DESK_MANAGER'), `${visitors.length} visitor chairs`);
const roomsBefore = st.rooms.length;
// v0.18.9: the 2D view keeps its left edge when the Inspector opens (no jump under the mouse), so the spot is
// under the manager desk's Inspector: nothing selected, the Inspector closes and the whole floor shows again
await deselect(); await frames(4);
await dragTile('Private cabin', 7.5, -3.5);
st = await store();
const cabin = st.rooms.find((r) => r.id !== 'open_0' && r.id !== 'open_1');
log('a private cabin: a room with a door, its desk inside', st.rooms.length === roomsBefore + 1 && cabin?.doors?.length === 1
  && st.objects.some((o) => o.roomId === cabin?.id && o.assetType === 'DESK_MANAGER'), cabin ? `${cabin.width} × ${cabin.depth} m` : 'no room');
// Take me there to its desk: the route from the entrance ends inside the cabin, at the desk (the same findNearestRoute
// the viewer's routeTo uses, with the place's goals)
const cabinRoute = await p.evaluate(async (cabinId) => {
  const [{ findNearestRoute }, { buildPlaces }, { entranceSpawn }, { ASSET_TYPES }] = await Promise.all([
    import('/src/play/navigation/route.js'), import('/src/play/navigation/places.js'),
    import('/src/play/navigation/entrance.js'), import('/src/utils/assetCatalog.js'),
  ]);
  const s = window.__ahdusStore.getState();
  const layout = { rooms: Object.values(s.rooms), objects: Object.values(s.objects), floors: s.floors };
  const room = layout.rooms.find((r) => r.id === cabinId);
  const desk = layout.objects.find((o) => o.roomId === cabinId && o.assetType === 'DESK_MANAGER');
  const index = buildPlaces(layout, [{ personId: 'boss', deskId: desk.id, name: 'Boss', department: 'Sales' }]);
  const from = { ...entranceSpawn(layout, { catalog: ASSET_TYPES }), floor: 0 };
  const route = findNearestRoute(layout, from, index.byId.get('person:boss').goals, { catalog: ASSET_TYPES });
  if (route.problem) return { problem: route.message };
  const end = route.legs.at(-1).points.at(-1);
  return { inside: Math.abs(end.x - room.x) < room.width / 2 && Math.abs(end.z - room.z) < room.depth / 2,
    toDesk: Math.hypot(end.x - desk.x, end.z - desk.z), length: route.length };
}, cabin?.id);
log('Take me there reaches the cabin\'s desk: the route ends inside the cabin, at the desk', cabinRoute.inside && cabinRoute.toDesk < 1.8,
  JSON.stringify(cabinRoute));
// walk in: Walk through, 2.5 m outside its door, a click on the floor just inside it walks in through the door
await deselect();
await p.click('[aria-label="Walk through"]'); await wait(800);
const door = await p.evaluate(async (cabinId) => {
  const { roomDoorFrames } = await import('/src/play/navigation/places.js');
  const room = window.__ahdusStore.getState().rooms[cabinId];
  const [f] = roomDoorFrames(room);
  const from = { x: f.x - f.inX * 2.5, z: f.z - f.inZ * 2.5 };
  window.__ahdusPlay.setPose({ ...from, yaw: Math.atan2(f.inX, f.inZ), pitch: -0.25, floor: 0 });
  return { ...f, from };
}, cabin?.id);
await frames(3); await wait(400); await frames(2);
// a click's walk ends within 1 m of the spot clicked: 2 m in, so it ends about 1 m inside the door
await clickAt(door.x + door.inX * 2.0, 0.02, door.z + door.inZ * 2.0);
const walkedIn = await p.evaluate(async (cabinId) => {
  const room = window.__ahdusStore.getState().rooms[cabinId];
  const sc = window.__ahdusScene;
  const t0 = performance.now();
  for (;;) {
    const v = window.__ahdusPlay.getPosition();
    if (Math.abs(v.x - room.x) < room.width / 2 - 0.2 && Math.abs(v.z - room.z) < room.depth / 2 - 0.2) return { x: v.x, z: v.z };
    if (performance.now() - t0 > 90000) return { x: v.x, z: v.z, timeout: true };
    await new Promise((res) => { const o = sc.onAfterRenderObservable.addOnce(() => res()); void o; });
  }
}, cabin?.id);
log('you can walk into the cabin: a click inside, seen through its door, walks in through it', !walkedIn.timeout, JSON.stringify(walkedIn));
await p.click('[aria-label="Back to Studio"]'); await wait(800);

// ── v0.18.5: a cabin moves and turns with its room; its door always leads in; Check's Fix it turns it ──
await p.click('[aria-label="2D view"]'); await frames(3); // from above: its desk, not its walls, under the mouse
await p.click('[aria-label="Fit view"]'); await wait(600); await frames(3);
st = await store();
const cab0 = st.rooms.find((r) => r.id === cabin?.id);
const cabItems = st.objects.filter((o) => o.roomId === cabin?.id);
const cabDesk = cabItems.find((o) => o.assetType === 'DESK_MANAGER');
await deselect();
await clickAt(cabDesk.x, 0.75, cabDesk.z); // selected first: the Inspector opening changes the view's size
await hover(cabDesk.x, 0.75, cabDesk.z);
await p.mouse.down();
const cabTo = await toScreen(cabDesk.x - 2, 0.75, cabDesk.z);
await p.mouse.move(cabTo.x, cabTo.y, { steps: 12 }); await frames(2);
await p.mouse.up(); await frames(4);
st = await store();
const cab1 = st.rooms.find((r) => r.id === cabin?.id);
const cabDx = cab1.x - cab0.x;
const itemDx = cabItems.map((o) => (st.objects.find((x) => x.id === o.id)?.x ?? NaN) - o.x);
log('v0.18.5: dragging the cabin (its desk) moves its room and its furniture together', Math.abs(cabDx + 2) < 0.4
  && itemDx.every((d) => Math.abs(d - cabDx) < 1e-3), `room ${cabDx.toFixed(2)} m, items ${itemDx.map((d) => d.toFixed(2)).join(',')}`);
await shot('workstations-cabin-dragged.png');
await undo();
st = await store();
log('v0.18.5: one Undo puts the cabin room and its furniture back', Math.abs(st.rooms.find((r) => r.id === cabin?.id).x - cab0.x) < 1e-6
  && cabItems.every((o) => Math.abs(st.objects.find((x) => x.id === o.id).x - o.x) < 1e-6));

// dropped 0.4 m from the outer wall with its door that way, it turns its door into the room
const roomsNow = st.rooms.length;
await dragTile('Private cabin', -6, -OFFICE.d / 2 + 2.0);
st = await store();
const wallCab = st.rooms.find((r) => r.type === 'CABIN' && r.id !== cabin?.id);
log('v0.18.5: a cabin dropped with its back to the outer wall: its door opens into the room', st.rooms.length === roomsNow + 1
  && wallCab?.doors?.[0]?.wall && wallCab.doors[0].wall !== 'south', `door ${wallCab?.doors?.[0]?.wall}`);
const openCheck = async () => {
  const panel = p.getByRole('dialog', { name: 'Check my layout', exact: true });
  if (!(await panel.isVisible().catch(() => false))) await p.click('[aria-label="Check layout"]');
  await panel.waitFor();
  return panel;
};
const checkPanel = await openCheck();
const lostCab = checkPanel.locator('li').filter({ hasText: 'Nobody can walk to Cabin' });
await wait(1500); await frames(2);
log('v0.18.5: Check finds no "Nobody can walk to Cabin"', await lostCab.count() === 0);
// R twice on its group: its room turns with the furniture; the door then faces the wall
await deselect();
const wallDesk = st.objects.find((o) => o.roomId === wallCab?.id && o.assetType === 'DESK_MANAGER');
await clickAt(wallDesk.x, 0.75, wallDesk.z);
await p.keyboard.press('r'); await frames(3);
st = await store();
const turned = st.rooms.find((r) => r.id === wallCab?.id);
const inTurned = st.objects.filter((o) => o.metadata?.group?.id === wallDesk.metadata.group.id)
  .every((o) => Math.abs(o.x - turned.x) < turned.width / 2 && Math.abs(o.z - turned.z) < turned.depth / 2);
log('v0.18.5: R turns the cabin room with its furniture', Math.abs(turned.width - wallCab.depth) < 1e-6 && inTurned, `${turned.width} × ${turned.depth}, door ${turned.doors[0].wall}`);
await p.keyboard.press('r'); await frames(3);
st = await store();
const facing = st.rooms.find((r) => r.id === wallCab?.id);
await openCheck(); // the same panel, opened again if it was closed
await lostCab.first().waitFor({ timeout: 20000 }).catch(() => {});
const fixBtn = lostCab.locator('[data-check-fix]');
log('v0.18.5: turned with its door to the wall: "Nobody can walk to Cabin" with Fix it', facing.doors[0].wall === 'south'
  && await lostCab.count() === 1 && await fixBtn.count() === 1, `door ${facing.doors[0].wall}`);
await fixBtn.click().catch(() => {});
await frames(4);
await lostCab.first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
st = await store();
const fixedCab = st.rooms.find((r) => r.id === wallCab?.id);
log('v0.18.5: Fix it turns (or moves) the cabin: the problem is gone', await lostCab.count() === 0 && fixedCab.doors[0].wall !== 'south',
  `door ${fixedCab.doors[0].wall}, at ${fixedCab.x}, ${fixedCab.z}`);
await shot('workstations-cabin-fixed.png');
await undo();
st = await store();
log('v0.18.5: one Undo puts it back (door to the wall)', st.rooms.find((r) => r.id === wallCab?.id).doors[0].wall === 'south');
await undo(); await undo(); await undo(); // R, R, the drop
st = await store();
log('the turns and the dropped cabin undone', st.rooms.length === roomsNow);
await p.keyboard.press('Escape'); await deselect();

await undo();
st = await store();
log('one Undo removes the cabin and what is in it', st.rooms.length === roomsBefore && !st.objects.some((o) => o.roomId === cabin?.id));

// ── v0.18.5: a tile clicked while the Plan is shown lands in the middle of the Plan ──
await p.evaluate(() => { const c = window.__ahdusScene.activeCamera; c.target.x = 9; c.target.z = 6; });
await frames(2);
await p.click('[aria-label="Plan view"]'); await wait(500);
const planCentre = await p.evaluate(() => {
  const [x, y, w, h] = document.querySelector('svg.floor-plan-svg').getAttribute('viewBox').split(/\s+/).map(Number);
  return { x: x + w / 2, z: -(y + h / 2) };
});
const beforePlan = (await store()).objects.map((o) => o.id);
await openFurniture();
await p.fill('[aria-label="Search furniture"]', 'Standard Desk');
await p.locator('.lib-tile[title^="Standard Desk:"]').first().click();
await wait(400);
await p.fill('[aria-label="Search furniture"]', '');
st = await store();
const placedDesk = st.objects.find((o) => !beforePlan.includes(o.id));
log('v0.18.5: Plan view: a clicked tile lands in the middle of the Plan, not of the hidden 3D view', !!placedDesk
  && Math.hypot(placedDesk.x - planCentre.x, placedDesk.z - planCentre.z) < 0.6 && Math.hypot(placedDesk.x - 9, placedDesk.z - 6) > 3,
  placedDesk ? `desk ${placedDesk.x.toFixed(2)}, ${placedDesk.z.toFixed(2)}; Plan middle ${planCentre.x.toFixed(2)}, ${planCentre.z.toFixed(2)}` : 'nothing placed');
await shot('workstations-plan-click-place.png');
await undo();
await p.click('[aria-label="2D view"]'); await frames(3);
await p.click('[aria-label="Fit view"]'); await wait(600); await frames(3);

// ── An upper floor ──
await deselect();
await p.keyboard.press('PageUp'); await frames(4);
await dragTile('2-person cluster', 0, 0, null, 3.52);
st = await store();
const upper = st.objects.filter((o) => o.floor === 1);
log('on Floor 1: a 2-person cluster lands on Floor 1, in its office', st.currentFloor === 1 && upper.length === 4
  && upper.every((o) => o.roomId === 'open_1' && o.metadata?.group), `${upper.length} items`);
await p.keyboard.press('PageDown'); await frames(3);
await closeFurniture();

// ── Studio's hint wraps (v0.18.0: the stairs warning was cut off) ──
const wraps = await p.locator('[data-studio="hint"]').evaluate((e) => getComputedStyle(e).whiteSpace);
log('the hint along the bottom wraps instead of being cut off', wraps === 'normal', wraps);

// ── The gallery: every prefab, people seated and typing, and a type this version doesn't know ──
await p.evaluate(async () => {
  const [{ prefabPlacement }, { PREFABS }, { ASSET_TYPES }] = await Promise.all([
    import('/src/play/prefabDrop.js'), import('/src/catalog/manifest.js'), import('/src/utils/assetCatalog.js'),
  ]);
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
  const hall = { id: 'hall', type: 'OFFICE', name: 'Open Office', floor: 0, x: 0, z: 0, width: 40, depth: 24, wallHeight: 3.2,
    doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [] };
  const rooms = [hall];
  const objects = [];
  let n = 0;
  window.__gallery = {};
  PREFABS.forEach((prefab, i) => {
    const at = { x: -13.5 + (i % 4) * 9, z: i < 4 ? 5 : -5, rotationY: 0, floor: 0 };
    const { room, objects: items } = prefabPlacement(prefab, {}, ASSET_TYPES, at, rooms,
      { groupId: `grp_${prefab.id}`, newId: () => `g_${++n}`, roomId: `room_${prefab.id}` });
    if (room) rooms.push(room);
    objects.push(...items.map((o) => ({ ...o, roomId: room ? room.id : o.roomId })));
    window.__gallery[prefab.id] = at;
  });
  // made by a newer version: a plain box, one warning for both
  for (const x of [17, 18.5]) objects.push({ id: `future_${x}`, assetType: 'WS_HOT_DESK_POD', floor: 0, roomId: 'hall', x, y: 0, z: -10, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 });
  window.__ahdusStore.getState().loadWorkspace({ layoutName: 'Gallery', floors, rooms, objects });
  await window.__ahdusBuild?.whenBuilt();
  await window.__ahdusAssets.whenLoaded();
  const deskIds = objects.filter((o) => o.metadata?.group?.role === 'desk').map((o) => o.id);
  window.__ahdusCharacters.setPeople(deskIds.map((id, i) => ({ personId: `p${i}`, deskId: id, name: `Person ${i}`, department: 'Sales' })));
  await window.__ahdusCharacters.whenSettled();
});
const people = await p.evaluate(async () => {
  const { workClip } = await import('/src/play/people.js');
  const objects = Object.values(window.__ahdusStore.getState().objects);
  const placed = window.__ahdusCharacters.getPlaced();
  return { placed: placed.length, seated: placed.filter((x) => x.seated).length, typing: placed.filter((x) => workClip(x, objects) === 'Type').length };
});
const seats = 1 + 2 + 4 + 6 + 8 + 4 + 1 + 1;
log(`people at every seat (${seats}) sit at their desks and type at the built-in screens`, people.placed === seats && people.seated === seats
  && people.typing === seats, JSON.stringify(people));
const unknown = await p.evaluate(() => window.__ahdusScene.meshes.filter((m) => String(m.metadata?.objectId ?? '').startsWith('future_') && m.sourceMesh?.metadata?.template === 'WS_HOT_DESK_POD' && m.getBoundingInfo().boundingBox.extendSizeWorld.x > 0.6 && m.getBoundingInfo().boundingBox.minimumWorld.y > -0.05).length); // desk-sized, on the floor
const unknownWarnings = warnings.filter((w) => w.includes('Unknown item type "WS_HOT_DESK_POD"')).length;
log('a type this version doesn\'t know: a plain box for each, one warning, no error', unknown >= 2 && unknownWarnings === 1, `${unknown} boxes, ${unknownWarnings} warnings`);

// screenshots: each prefab from above and at eye level, the 6-person cluster with its people
await p.click('[aria-label="3D view"]'); await frames(3);
await deselect();
const gallery = await p.evaluate(() => window.__gallery);
const look = async (at, { alpha, beta, radius, y = 0.6 }) => {
  await p.evaluate(({ at, alpha, beta, radius, y }) => {
    const cam = window.__ahdusScene.activeCamera;
    const V = cam.position.constructor;
    cam.setTarget(new V(at.x, y, at.z));
    cam.alpha = alpha; cam.beta = beta; cam.radius = radius;
  }, { at, alpha, beta, radius, y });
  await frames(4);
};
if (process.env.SHOTS) {
  for (const [id, at] of Object.entries(gallery)) {
    const big = id === 'WS_CABIN' || id === 'WS_CLUSTER_8' ? 1.3 : 1;
    if (id === 'WS_CABIN') {
      // the cabin from above, a little from its door's side: the whole room and its doorway in the picture
      const view = await p.evaluate(async () => {
        const { roomDoorFrames } = await import('/src/play/navigation/places.js');
        const room = window.__ahdusStore.getState().rooms.room_WS_CABIN;
        const [f] = roomDoorFrames(room);
        return { at: { x: room.x, z: room.z }, alpha: Math.atan2(-f.inZ, -f.inX), radius: Math.max(room.width, room.depth) * 3 };
      });
      await look(view.at, { alpha: view.alpha, beta: 0.38, radius: view.radius, y: 0 });
    } else await look(at, { alpha: -Math.PI / 2, beta: 0.05, radius: 9 * big });
    await shot(`prefab-${id}-above.png`);
    await look(at, { alpha: -Math.PI / 2 - 0.5, beta: 1.32, radius: 6 * big, y: 1.1 });
    await shot(`prefab-${id}-eye.png`);
  }
}
await look(gallery.WS_CLUSTER_6, { alpha: -Math.PI / 2 - 0.35, beta: 1.2, radius: 5.5, y: 0.9 });
await shot('workstations-cluster6-people.png');

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
