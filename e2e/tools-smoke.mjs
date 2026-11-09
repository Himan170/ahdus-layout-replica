// Tools smoke test: Workplace Studio's Build panel and mouse tools (draw a
// room, drag a wall to resize it, doors, windows, walls, furniture on a table
// top, an upper floor, door sizes: Inspector + side handles), and Preview's Edit item
// tool (resize, turn, move, lock; a door's width and height).
// Results are checked in the store; screenshots go to e2e/screens/.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:tools      (in another)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
mkdirSync('e2e/screens', { recursive: true });
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
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
  t = setTimeout(done, 20000);
}), n);
const store = () => p.evaluate(() => {
  const s = window.__ahdusStore.getState();
  return { rooms: Object.values(s.rooms), objects: Object.values(s.objects), currentFloor: s.currentFloor };
});
const key = async (k) => { await p.keyboard.press(k); await frames(3); };
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

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
  // let the Inspector finish opening/closing (the canvas changes size) before aiming
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
const tile = async (label) => { await p.click(`[aria-label="${label}"]`); await frames(2); };
// The tool rail: a tile opens its library; a library tile arms the tool. Then the tile closes the
// library again (the tool stays armed), so the view is as wide as before.
// Rooms: "Draw your own size" draws an Office (the default room type).
const LIBRARY = { Rooms: 'rooms', Walls: 'walls', 'Doors & Windows': 'doors', Stairs: 'stairs', Furniture: 'furniture' };
const pick = async (tileLabel, option) => {
  const lib = `[data-library="${LIBRARY[tileLabel]}"]`;
  if (!(await p.locator(lib).isVisible().catch(() => false))) await tile(tileLabel);
  await p.click(tileLabel === 'Rooms' ? `${lib} button:has-text("Draw your own size")`
    : `${lib} .lib-tile:has(.lib-tile__name:text-is("${option}"))`);
  await frames(2);
  await tile(tileLabel);
  await p.waitForTimeout(250); await frames(2); // the canvas widens again
};
/** Drags a furniture tile (found by searching its name) onto a world point */
const dragTile = async (name, x, y, z) => {
  if (!(await p.locator('[data-library="furniture"]').isVisible().catch(() => false))) await tile('Furniture');
  await p.fill('[aria-label="Search furniture"]', name);
  const b = await p.locator(`.lib-tile[title^="${name}"]`).first().boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  const to = await toScreen(x, y, z);
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await frames(2);
  await p.mouse.up();
  await frames(3);
};
const floorMenu = async (item) => { await p.click('[aria-label="Floor switcher"]'); await frames(1); await p.click(item); await frames(3); };

await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Tools Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Tools'); await p.click('button:has-text("Create")');
await p.waitForSelector('canvas', { timeout: 90000 }); await wait(2500);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));

// ── Studio: the Build panel is on the left of the view ──
await p.waitForSelector('[aria-label="Rooms"]', { timeout: 30000 });
await frames(3);
const bar = await p.locator('aside[aria-label="Build"]').boundingBox();
const canvasBox = await p.locator('canvas').boundingBox();
log('the Build panel is a vertical card left of the view', bar.height > bar.width * 2 && canvasBox.x >= bar.x + bar.width,
  `panel ${Math.round(bar.width)}×${Math.round(bar.height)} at x=${bar.x}, canvas at x=${canvasBox.x}`);
const labels = ['Select', 'Rooms', 'Walls', 'Doors & Windows', 'Stairs', 'Furniture', 'Layers', 'Undo', 'Redo', 'Settings',
  '2D view', '3D view', 'Fit view', 'Floor switcher', 'Walk through'];
const missing = [];
for (const l of labels) if (await p.locator(`[aria-label="${l}"]`).count() === 0) missing.push(l);
log('Studio has the build tiles, view controls, undo, settings, floors and Preview', missing.length === 0, missing.join(', '));

await tile('2D view'); await frames(4);

// ── Draw a room by dragging corner to corner ──
await pick('Rooms', 'Office');
await dragWorld([-4, 0.02, -3], [2, 0.02, 1]);
let st = await store();
const room = st.rooms[0];
log('dragging corner to corner draws a 6 × 4 m room', st.rooms.length === 1 && near(room.width, 6) && near(room.depth, 4) && near(room.x, -1) && near(room.z, -1),
  room ? `${room.width} × ${room.depth} at (${room.x}, ${room.z})` : 'none');
await shot('t1-draw-room.png');
await key('Control+z');
const afterUndo = (await store()).rooms.length;
await key('Control+y');
log('Ctrl+Z / Ctrl+Y undo and redo the drawn room', afterUndo === 0 && (await store()).rooms.length === 1);

// ── Select the room, drag its east wall out 2 m ──
await tile('Select');
await clickAt(-1, 0.02, -1);
log('clicking the floor selects the room', (await p.evaluate(() => window.__ahdusStore.getState().selectedRoomId)) === room.id);
await dragWorld([2, 3, -1], [4, 0.02, -1]);
let r1 = (await store()).rooms[0];
log('dragging a wall resizes the room (east wall +2 m)', near(r1.width, 8) && near(r1.x - r1.width / 2, -4),
  `${room.width} → ${r1.width}, west edge ${r1.x - r1.width / 2}`);
await shot('t2-drag-wall.png');
await key('Control+z');
r1 = (await store()).rooms[0];
log('Ctrl+Z puts the wall back', near(r1.width, 6), `width ${r1.width}`);

// ── Door: click a wall to add, click it again to remove ──
await pick('Doors & Windows', 'Door');
await clickAt(-1, 3, -3);
st = await store();
const door = st.rooms[0].doors?.[0];
log('clicking a wall adds a door there', !!door && door.wall === 'south' && near(door.offset, 0, 0.3), JSON.stringify(door));
await clickAt(-1, 3, -3);
log('clicking the door again removes it', ((await store()).rooms[0].doors ?? []).length === 0);
await key('Control+z');
log('Ctrl+Z brings the door back', ((await store()).rooms[0].doors ?? []).length === 1);

// ── Window on the north wall ──
await pick('Doors & Windows', 'Window');
await clickAt(0.5, 3, 1);
const win = (await store()).rooms[0].windows?.[0];
log('clicking a wall adds a window', win?.wall === 'north', JSON.stringify(win));

// ── Door size in Studio: select the door, type a width, drag a side handle ──
await tile('Select');
const d0 = (await store()).rooms[0].doors[0];
const doorX = room.x + d0.offset;
await clickAt(doorX, 2.6, -3); // 2D view: the wall over the door
const selDoor = await p.evaluate(() => window.__ahdusStore.getState().selectedOpening);
const insp = 'aside[aria-label="Inspector"]';
log('clicking a door selects it; the Inspector shows Door with its size',
  selDoor?.kind === 'door' && await p.locator(`${insp} h2:has-text("Door")`).count() === 1, JSON.stringify(selDoor));
await p.fill(`${insp} input[aria-label="Width"]`, '1.4');
await frames(2);
let dS = (await store()).rooms[0].doors[0];
// (the centre is rounded to the cm: geometry.resizeOpening's round2)
log('typing a width in the Inspector resizes the door (its centre stays)', near(dS.width, 1.4, 0.001) && near(dS.offset, d0.offset, 0.0051),
  `width ${d0.width} → ${dS.width}, offset ${d0.offset} → ${dS.offset}`);
await p.fill(`${insp} input[aria-label="Height"]`, '3.4');   // new rooms have 3.2 m walls
await frames(2);
const refusal = await p.locator(`${insp} [role="alert"]`).textContent({ timeout: 3000 }).catch(() => '');
dS = (await store()).rooms[0].doors[0];
log('a door taller than the wall is refused, with the reason', near(dS.height, 2.1, 0.001) && /at most 3.1 m/.test(refusal),
  `height ${dS.height}, "${refusal}"`);
await p.evaluate(() => document.activeElement?.blur());
await frames(2);
const handleY = 1.05;
const doorEnd = doorX + dS.width / 2;
await shot('t3a-door-selected-studio.png');
await dragWorld([doorEnd, handleY, -3], [doorEnd + 0.3, handleY, -3]);
const dH = (await store()).rooms[0].doors[0];
log('dragging the door\'s side handle makes it 0.3 m wider (the other side stays)',
  near(dH.width, 1.7, 0.001) && near(dH.offset - dH.width / 2, dS.offset - dS.width / 2, 0.001), `width ${dS.width} → ${dH.width}`);
await key('Control+z');
log('Ctrl+Z undoes the handle drag in one step', near((await store()).rooms[0].doors[0].width, 1.4, 0.001));
await key('Escape');

// ── Free-standing wall ──
await pick('Walls', 'Wall');
await dragWorld([6, 0.02, -3], [6, 0.02, 1]);
const wall = (await store()).objects.find((o) => o.assetType === 'WALL_SEGMENT');
log('dragging draws a 4 m wall', !!wall && near(wall.scaleX * 3, 4) && near(wall.x, 6) && near(wall.z, -1), wall ? wall.label : 'none');
await key('Escape');
log('Esc goes back to Select', await p.locator('button[aria-label="Select"][aria-pressed="true"]').count() === 1);

// ── Furniture on a table top ──
await dragTile('Standard Desk', -2.5, 0.02, -1);
const desk = (await store()).objects.find((o) => o.assetType === 'DESK_STANDARD');
log('a desk is placed in the room', !!desk && desk.roomId === room.id, desk ? `(${desk.x}, ${desk.z})` : 'none');
await key('Escape'); // deselect the desk
await dragTile('Dual Monitor', desk.x, 0.8, desk.z);
const mon = (await store()).objects.find((o) => o.assetType === 'MONITOR_DUAL');
log('a monitor clicked onto the desk stands on its top', !!mon && mon.y > 0.5, mon ? `monitor y=${mon.y.toFixed(2)}` : 'none');
await key('Escape');
await shot('t3-planner-built.png');

// ── With the room selected: a click selects what is under the cursor, a drag of its floor moves it ──
await tile('Select');
const selectRoom = () => p.evaluate((id) => { const s = window.__ahdusStore.getState(); s.selectObject(null); s.selectRoom(id); }, room.id);
const sel = () => p.evaluate(() => { const s = window.__ahdusStore.getState(); return { room: s.selectedRoomId, object: s.selectedObjectId }; });
const roomNow = async () => (await store()).rooms.find((r) => r.id === room.id);
// 3D, low beside the desk: the floor between its legs
await tile('3D view'); await frames(3);
await p.evaluate(([x, z]) => {
  const cam = window.__ahdusScene.activeCamera; const V = cam.position.constructor;
  cam.lowerRadiusLimit = 1; cam.setTarget(new V(x, 0.3, z)); cam.alpha = 0; cam.beta = 1.45; cam.radius = 2.2;
}, [desk.x, desk.z]);
await frames(3);
await selectRoom(); await frames(2);
const r0 = await roomNow();
await clickAt(desk.x, 0.02, desk.z);
let s1 = await sel();
let r1b = await roomNow();
await shot('t3b-floor-under-desk.png');
log('room selected: clicking the floor between a desk\'s legs selects the desk (the room stays put)',
  s1.object === desk.id && r1b.x === r0.x && r1b.z === r0.z, JSON.stringify(s1));
await p.evaluate(() => { window.__ahdusScene.activeCamera.lowerRadiusLimit = 5; });
await key('Escape');
// 2D: an empty spot of its floor. A click keeps it where it is (and selected); a drag moves it.
await tile('2D view'); await frames(4);
await selectRoom(); await frames(2);
await clickAt(0.5, 0.02, -2);
s1 = await sel(); r1b = await roomNow();
log('room selected: a click on its floor (no drag) does not move it', s1.room === room.id && r1b.x === r0.x && r1b.z === r0.z,
  `(${r0.x}, ${r0.z}) → (${r1b.x}, ${r1b.z})`);
await dragWorld([0.5, 0.02, -2], [1.5, 0.02, -2]);
const r1m = await roomNow();
log('room selected: dragging its floor moves it (same size)', near(r1m.x, r0.x + 1) && r1m.z === r0.z && r1m.width === r0.width,
  `(${r0.x}, ${r0.z}) → (${r1m.x}, ${r1m.z})`);
await key('Control+z');
log('Ctrl+Z moves it back', near((await roomNow()).x, r0.x));
// v0.14.9: the room's Department (no departments given here: free text), saved as departmentRef, undoable
await selectRoom(); await frames(2);
const deptField = p.locator('aside[aria-label="Inspector"] [aria-label="Room department"]');
const deptKind = await deptField.getAttribute('data-room-department', { timeout: 10000 }).catch(() => null);
await deptField.fill('Customer  Success ').catch(() => {});
await frames(1);
const deptTyped = (await roomNow()).departmentRef;
await p.evaluate(() => document.activeElement?.blur());
await p.click('[aria-label="Undo"]'); await frames(1);
const deptUndone = (await roomNow()).departmentRef ?? null;
await p.click('[aria-label="Redo"]'); await frames(1);
const deptRedone = (await roomNow()).departmentRef;
const furnitureDept = await p.locator('aside[aria-label="Inspector"] [aria-label="Department"]').count();
log('v0.14.9 a room\'s Department (no list given: free text): typing saves departmentRef "Customer Success"; Undo, Redo; the furniture field is not there',
  deptKind === 'text' && deptTyped === 'Customer Success' && deptUndone === null && deptRedone === 'Customer Success' && furnitureDept === 0,
  JSON.stringify({ deptKind, deptTyped, deptUndone, deptRedone, furnitureDept }));
await key('Escape');

// ── v0.15.0 easy building (Select tool, 2D view) ──
const objNow = async (id) => (await store()).objects.find((o) => o.id === id);
/** World box of an item's meshes (its root node and what is under it). */
const itemBox = (id) => p.evaluate((id) => {
  const root = window.__ahdusScene.transformNodes.find((n) => n.metadata?.objectId === id && !n.parent?.metadata?.objectId);
  if (!root) return null;
  const { min, max } = root.getHierarchyBoundingVectors(true);
  return { minX: min.x, maxX: max.x, minY: min.y, maxY: max.y, minZ: min.z, maxZ: max.z };
}, id);
const undoTitle = () => p.locator('[aria-label="Undo"]').first().getAttribute('title');
// Dragging the desk (not selected): the monitor on it comes along, one undo step
const deskTop0 = (await itemBox(desk.id)).maxY;
{
  // The press selects the desk and the Inspector slides open: the view narrows under the mouse over a few
  // frames (the desk stays under the cursor). Aim at the target only once the canvas has its new size.
  await hover(desk.x + 0.6, deskTop0, desk.z + 0.25);
  await p.mouse.down();
  await p.mouse.move((await toScreen(desk.x + 0.6, deskTop0, desk.z + 0.25)).x + 8, (await toScreen(desk.x + 0.6, deskTop0, desk.z + 0.25)).y);
  for (let i = 0, last = -1; i < 40; i++) {
    await wait(100); await frames(1);
    const w = await p.evaluate(() => { const e = window.__ahdusScene.getEngine(); const c = e.getRenderingCanvas();
      return Math.abs(e.getRenderWidth() * e.getHardwareScalingLevel() - c.clientWidth * devicePixelRatio) <= 2 ? c.clientWidth : -1; });
    if (w > 0 && w === last) break;
    last = w;
  }
  const to = await toScreen(desk.x + 1.6, deskTop0, desk.z + 0.25);
  await p.mouse.move(to.x, to.y, { steps: 10 });
  await frames(2);
  await p.mouse.up(); await frames(3);
}
const deskMoved = await objNow(desk.id);
const monMoved = await objNow(mon.id);
const deskUndo = await undoTitle();
log('v0.15.0 dragging the desk moves it 1 m, and the monitor on it comes along (same height), one undo step "Move Standard Desk"',
  near(deskMoved.x, desk.x + 1) && near(deskMoved.z, desk.z) && near(monMoved.x, mon.x + 1) && near(monMoved.z, mon.z) &&
  near(monMoved.y, mon.y, 0.01) && /Move Standard Desk/.test(deskUndo ?? ''),
  `desk ${desk.x} → ${deskMoved.x}, monitor ${mon.x} → ${monMoved.x} (y ${mon.y.toFixed(2)} → ${monMoved.y.toFixed(2)}), "${deskUndo}"`);
await key('Control+z');
const deskBack = await objNow(desk.id);
const monBack = await objNow(mon.id);
log('v0.15.0 Ctrl+Z puts the desk and its monitor back together', near(deskBack.x, desk.x) && near(monBack.x, mon.x),
  `desk ${deskBack.x}, monitor ${monBack.x}`);
await key('Escape');

// The Desk Plant: dropped on the floor, then dragged (still selected, as it is right after placing) onto the desk
await dragTile('Desk Plant', 0.5, 0.02, 0);
const plant = (await store()).objects.find((o) => o.assetType === 'PLANT_SMALL');
log('v0.15.0 a Desk Plant dropped on the floor stands on the floor', !!plant && plant.y < 0.05, plant ? `(${plant.x}, ${plant.y}, ${plant.z})` : 'none');
await tile('Furniture'); await wait(250); await frames(2); // close the library: the view as wide as before
const deskTop = (await itemBox(desk.id)).maxY;
await dragWorld([plant.x, 0.15, plant.z], [desk.x - 0.5, deskTop, desk.z + 0.2]);
const plantOn = await objNow(plant.id);
const deskBox = await itemBox(desk.id);
const plantUndo = await p.locator('[aria-label="Undo"]').first().getAttribute('title');
// (selected, its move arrows lie over it: the plant is nearer, so the drag is the Select tool's, not an arrow's)
log('v0.15.0 dragging the Desk Plant (selected) onto the desk: it stands on the desk top, one undo step "Move Desk Plant"',
  near(plantOn.y, deskTop, 0.04) && plantOn.x > deskBox.minX && plantOn.x < deskBox.maxX && plantOn.z > deskBox.minZ && plantOn.z < deskBox.maxZ &&
  /Move Desk Plant/.test(plantUndo ?? ''),
  `plant (${plantOn.x}, ${plantOn.y.toFixed(2)}, ${plantOn.z}), desk top ${deskTop.toFixed(2)}, "${plantUndo}"`);
await shot('t3c-plant-on-desk.png');
// Where the X arrow sticks out past the plant, the arrow still wins: it slides the plant along X only
const arrowAt = await p.evaluate(([x, y, z]) => {
  const sc = window.__ahdusScene; const eng = sc.getEngine(); const cam = sc.activeCamera;
  const V = cam.position.constructor; const M = sc.getTransformMatrix().constructor;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const gizmoScenes = [window.__ahdusGizmo.gizmoScene()].filter(Boolean); // the arrows' own scene
  const k = eng.getHardwareScalingLevel(); // scene.pick takes CSS pixels, Project gives render pixels
  let far = null;
  for (let d = 0.05; d < 3; d += 0.025) {
    const r = V.Project(new V(x + d, y, z), M.Identity(), sc.getTransformMatrix(), vp);
    const v = { x: r.x * k, y: r.y * k };
    const onGizmo = gizmoScenes.some((s) => s.pick(v.x, v.y)?.hit);
    const onItem = sc.pick(v.x, v.y, (m) => m.isPickable && m.isEnabled())?.pickedMesh;
    const isPlant = !!onItem && (onItem.metadata?.objectId ?? onItem.parent?.metadata?.objectId) === window.__ahdusStore.getState().selectedObjectId;
    if (onGizmo && !isPlant) far = d;
  }
  return far;
}, [plantOn.x, plantOn.y, plantOn.z]);
if (arrowAt) {
  const at = arrowAt * 0.75;
  await dragWorld([plantOn.x + at, plantOn.y, plantOn.z], [plantOn.x + at + 0.4, plantOn.y, plantOn.z + 0.3]);
}
const plantArrow = await objNow(plant.id);
const arrowUndo = await p.locator('[aria-label="Undo"]').first().getAttribute('title');
log('v0.15.0 the move arrow, where it sticks out past the plant, still slides it along X only (its height kept)',
  !!arrowAt && plantArrow.x > plantOn.x + 0.2 && near(plantArrow.z, plantOn.z, 0.001) && near(plantArrow.y, plantOn.y, 0.001) &&
  /Move \/ rotate \/ scale/.test(arrowUndo ?? ''),
  `arrow to ${arrowAt?.toFixed(2)} m, (${plantOn.x}, ${plantOn.z}) → (${plantArrow.x.toFixed(2)}, ${plantArrow.z}), "${arrowUndo}"`);
await key('Control+z');
await key('Escape');

// A door in the free-standing wall (drawn with the Wall tool above: x = 6, z −3 to 1): the wall is cut around it
await pick('Doors & Windows', 'Door');
await clickAt(wall.x, 2.8, wall.z);
const afterCut = await store();
const pieces = afterCut.objects.filter((o) => o.assetType === 'WALL_SEGMENT' && o.floor === 0);
const wallDoor = afterCut.objects.find((o) => o.assetType === 'DOOR_SINGLE');
const cutUndo = await undoTitle();
log('v0.15.0 the Door tool on a wall drawn with the Wall tool: a door there, the wall cut into 3 pieces around it (one undo step "Add door")',
  !afterCut.objects.some((o) => o.id === wall.id) && pieces.length === 3 && !!wallDoor &&
  near(wallDoor.x, wall.x, 0.05) && near(wallDoor.z, wall.z, 0.3) && /Add door/.test(cutUndo ?? ''),
  `${pieces.length} pieces, door ${wallDoor ? `(${wallDoor.x}, ${wallDoor.z})` : 'none'}, "${cutUndo}"`);
await shot('t3d-door-in-wall.png');
await key('Control+z');
const uncut = (await store()).objects.filter((o) => o.assetType === 'WALL_SEGMENT' || o.assetType === 'DOOR_SINGLE');
log('v0.15.0 Ctrl+Z gives the whole wall back (same id), no door', uncut.length === 1 && uncut[0].id === wall.id && near(uncut[0].scaleX, wall.scaleX, 0.001),
  uncut.map((o) => o.assetType).join(', '));
await key('Control+y');
await key('Escape');

// Sliding the room's door along its wall: select it, drag it (not a blue handle), one undo step
await tile('Select');
const dSlide = (await store()).rooms[0].doors[0];
const slideX = room.x + dSlide.offset;
await clickAt(slideX, 2.6, -3); // 2D: the wall over the door selects it
const slideSel = await p.evaluate(() => window.__ahdusStore.getState().selectedOpening);
await dragWorld([slideX + 0.35, 1.0, -3], [slideX + 0.35 - 1.0, 1.0, -3]);
const slid = (await store()).rooms[0].doors[0];
const slideUndo = await undoTitle();
log('v0.15.0 a selected door dragged 1 m along its wall moves 1 m (same size), one undo step "Move door"',
  slideSel?.kind === 'door' && near(slid.offset, dSlide.offset - 1, 0.06) && near(slid.width, dSlide.width, 0.001) && slid.wall === dSlide.wall &&
  /Move door/.test(slideUndo ?? ''),
  `offset ${dSlide.offset} → ${slid.offset}, width ${dSlide.width} → ${slid.width}, "${slideUndo}"`);
await shot('t3e-door-slid.png');
await key('Control+z');
log('v0.15.0 Ctrl+Z slides the door back', near((await store()).rooms[0].doors[0].offset, dSlide.offset, 0.001),
  `offset ${(await store()).rooms[0].doors[0].offset}`);
await key('Escape');

// ── Upper floor: the tools draw on the floor being edited ──
await floorMenu('[aria-label="Add floor above"]');
await p.click('[aria-label="Empty floor"]'); await frames(3);
await floorMenu('[role="menuitemradio"]:has-text("Floor 1")');
await pick('Rooms', 'Office');
await dragWorld([-4, 3.52, -3], [0, 3.52, 1]);
const upper = (await store()).rooms.find((r) => r.floor === 1);
log('on Floor 1 the room is drawn on Floor 1', !!upper && near(upper.width, 4), upper ? `${upper.width} × ${upper.depth}` : 'none');
await key('Escape');
// a door upstairs, resized in the Inspector
await pick('Doors & Windows', 'Door');
await clickAt(upper.x, 3.5 + 1.5, upper.z - upper.depth / 2);
await tile('Select');
await clickAt(upper.x + (((await store()).rooms.find((r) => r.id === upper.id).doors?.[0]?.offset) ?? 0), 3.5 + 2.6, upper.z - upper.depth / 2);
await p.fill('aside[aria-label="Inspector"] input[aria-label="Width"]', '1.3').catch(() => {});
await frames(2);
const upDoor = (await store()).rooms.find((r) => r.id === upper.id).doors?.[0];
log('on Floor 1 a door is resized in the Inspector too', near(upDoor?.width ?? 0, 1.3, 0.001), JSON.stringify(upDoor));
await p.evaluate(() => document.activeElement?.blur());
await key('Escape');
await p.evaluate(() => window.__ahdusStore.getState().selectFloor(0)); await frames(3);

// ── Preview: Edit item tool on what you look at ──
await tile('3D view'); await frames(3);
await p.keyboard.press('Tab'); await wait(800);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")'); await wait(400);
}
await p.keyboard.press('Digit9'); await frames(3);
const hintText = () => p.locator('[data-hud="hint"]').textContent({ timeout: 2000 }).catch(() => '');
// stand south of the desk looking at it (the camera is 0.85 m over the right shoulder)
let aimed = false;
for (const [dz, pitch] of [[-2.2, -0.35], [-1.8, -0.45], [-2.6, -0.3], [-1.5, -0.55], [-3, -0.25]]) {
  await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: desk.x - 0.85, z: desk.z + dz, yaw: 0, pitch, floor: 0 });
  await frames(3);
  if (/Standard Desk/.test(await hintText())) { aimed = true; break; }
}
log('Edit item: looking at the desk shows its size and keys', aimed && /Resize/.test(await hintText()), (await hintText()).slice(0, 90));
await shot('t4-edit-aim.png');

const deskNow = async () => (await store()).objects.find((o) => o.id === desk.id);
await key('Equal');
const bigger = await deskNow();
await key('Digit0');
const normal = await deskNow();
log('+ makes it bigger, 0 back to normal size', near(bigger.scaleX, 1.1, 0.01) && near(bigger.scaleY, 1.1, 0.01) && normal.scaleX === 1,
  `${bigger.scaleX} → ${normal.scaleX}`);
await key('KeyR');
const turned = await deskNow();
log('R turns it 45°', near(turned.rotationY - (desk.rotationY ?? 0), Math.PI / 4, 0.01), `rotationY ${turned.rotationY.toFixed(2)}`);
await key('Control+z');
log('Ctrl+Z undoes the turn', near((await deskNow()).rotationY, desk.rotationY ?? 0, 0.01));

// pick it up, look somewhere else, put it down
await p.mouse.down(); await p.mouse.up(); await frames(3);
log('left-click picks it up', /Moving/.test(await hintText()), (await hintText()).slice(0, 60));
const pose0 = await p.evaluate(() => { const v = window.__ahdusPlay.getPosition(); return { x: v.x, z: v.z }; });
await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: pose0.x + 1.5, z: pose0.z, floor: 0 });
await frames(4);
await shot('t5-edit-carry.png');
await p.mouse.down(); await p.mouse.up(); await frames(3);
const moved = await deskNow();
log('left-click puts it down somewhere else', Math.hypot(moved.x - desk.x, moved.z - desk.z) > 0.5 && moved.roomId === room.id,
  `(${desk.x}, ${desk.z}) → (${moved.x}, ${moved.z})`);
await key('Control+z');
const back = await deskNow();
log('Ctrl+Z moves it back', near(back.x, desk.x) && near(back.z, desk.z), `(${back.x}, ${back.z})`);

// lock: can't be removed
await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: desk.x - 0.85, z: desk.z - 2.2, yaw: 0, pitch: -0.35, floor: 0 });
for (const [dz, pitch] of [[-2.2, -0.35], [-1.8, -0.45], [-2.6, -0.3], [-1.5, -0.55], [-3, -0.25]]) {
  await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: desk.x - 0.85, z: desk.z + dz, yaw: 0, pitch, floor: 0 });
  await frames(3);
  if (/Standard Desk/.test(await hintText())) break;
}
await key('KeyL');
await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frames(3);
const locked = await deskNow();
log('L locks it, and a locked item is not removed', !!locked && locked.isLocked === true);
await key('KeyL');
log('L again unlocks it', (await deskNow()).isLocked === false);

// v0.15.0: G picks up what you look at, whatever is in your hand (here the Desk of slot 6); a click puts it down
await key('Digit6');
await key('KeyG');
const gHint = await hintText();
log('v0.15.0 G with the Desk in hand picks up the desk you look at', /Moving Standard Desk/.test(gHint), gHint.slice(0, 70));
const poseG = await p.evaluate(() => { const v = window.__ahdusPlay.getPosition(); return { x: v.x, z: v.z }; });
await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: poseG.x + 1.5, z: poseG.z, floor: 0 });
await frames(4);
await p.mouse.down(); await p.mouse.up(); await frames(3);
const gMoved = await deskNow();
const gCount = (await store()).objects.filter((o) => o.assetType === 'DESK_STANDARD').length;
log('v0.15.0 a click puts it down somewhere else (no new desk built)',
  Math.hypot(gMoved.x - desk.x, gMoved.z - desk.z) > 0.5 && gMoved.roomId === room.id && gCount === 1,
  `(${desk.x}, ${desk.z}) → (${gMoved.x}, ${gMoved.z}), ${gCount} desk(s)`);
await key('Control+z');
const gBack = await deskNow();
log('v0.15.0 Ctrl+Z moves it back', near(gBack.x, desk.x) && near(gBack.z, desk.z), `(${gBack.x}, ${gBack.z})`);
await key('Digit9');

// ── Edit item on a door: + / − width, Shift + / − height, 0 standard size ──
const doorNow = async () => (await store()).rooms.find((r) => r.id === room.id).doors[0];
const dP = await doorNow();
const dX = room.x + dP.offset;
let aimedDoor = false;
for (const [dz, pitch] of [[-2.5, -0.17], [-2, -0.2], [-3, -0.14], [-1.6, -0.24], [-3.5, -0.12]]) {
  await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x: dX - 0.85, z: -3 + dz, yaw: 0, pitch, floor: 0 });
  await frames(3);
  if (/Door \d/.test(await hintText())) { aimedDoor = true; break; }
}
log('Edit item: looking at a door shows its size ("Door 1.4 × 2.1 m")', aimedDoor && /Door 1\.4 × 2\.1 m/.test(await hintText()),
  (await hintText()).slice(0, 80));
await key('Equal');
const wider = await doorNow();
log('+ makes the door 0.1 m wider, and the hint follows', near(wider.width, 1.5, 0.001) && /Door 1\.5 × 2\.1 m/.test(await hintText()),
  `width ${dP.width} → ${wider.width}`);
await key('Shift+Equal');
const taller = await doorNow();
log('Shift + makes it 0.1 m taller', near(taller.height, 2.2, 0.001) && near(taller.width, 1.5, 0.001), `height ${taller.height}`);
await key('Minus');
log('− makes it 0.1 m narrower', near((await doorNow()).width, 1.4, 0.001));
// a quick burst is one undo step
for (let i = 0; i < 3; i++) await p.keyboard.press('Equal');
await frames(2);
const burst = await doorNow();
await key('Control+z');
log('a burst of + presses is one undo step', near(burst.width, 1.7, 0.001) && near((await doorNow()).width, 1.4, 0.001),
  `${burst.width} → ${(await doorNow()).width}`);
// taller than the wall allows: refused, with the reason in the hint
for (let i = 0; i < 11; i++) await p.keyboard.press('Shift+Equal');   // 2.1 → 3.1 m; the 11th is refused
await frames(1);
const tallest = await doorNow();
const why = await hintText();
log('the door stops at 3.1 m (wall − 0.1 m) and the hint says why', near(tallest.height, 3.1, 0.001) && /at most 3\.1 m/.test(why),
  `height ${tallest.height}, hint "${why.slice(0, 80)}"`);
for (let i = 0; i < 4; i++) await p.keyboard.press('Shift+Minus');
for (let i = 0; i < 6; i++) await p.keyboard.press('Equal');
await frames(3);
const resized = await doorNow();
const meshW = await p.evaluate((roomId) => {
  const m = window.__ahdusScene.meshes.find((x) => x.metadata?.roomId === roomId && x.name.endsWith('_pick') && x.metadata.openingKind === 'door');
  const bb = m?.getBoundingInfo().boundingBox;
  return bb ? bb.maximumWorld.x - bb.minimumWorld.x : null;
}, room.id);
log('the wall is rebuilt around the new size', near(resized.width, 2.0, 0.001) && near(meshW ?? 0, 2.0, 0.01), `door ${resized.width} × ${resized.height}, opening ${meshW?.toFixed(2)} m`);
await shot('t6-door-resized-preview.png');
// Presses less than 2 s apart are one undo step (a burst); make 0 a step of its own
await p.waitForTimeout(2100);
await key('Digit0');
const standard = await doorNow();
log('0 gives the door its standard size (1.0 × 2.1 m)', near(standard.width, 1.0, 0.001) && near(standard.height, 2.1, 0.001),
  `${standard.width} × ${standard.height}`);
await key('Control+z');
const undone = await doorNow();
log('Ctrl+Z after 0 brings the resized door back', near(undone.width, 2.0, 0.001) && near(undone.height, 2.7, 0.001),
  `${undone.width} × ${undone.height}`);

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
