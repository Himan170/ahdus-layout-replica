// Before / after screenshots of the same layout (real assets: GLB furniture,
// PBR textures, HDRI sky): Workplace Studio 3D and Preview, inside an office.
//
// Run:   npm run dev                                (in one terminal)
//        node e2e/real-assets-shots.mjs before      (or: after; in another)
// Writes e2e/screens/real-assets-<tag>-studio.png and real-assets-<tag>-preview.png.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screens', { recursive: true });

const tag = process.argv[2] ?? 'after';
const url = process.argv[3] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 60000);
}), n);
// Real assets load after the scene is drawn (dev hook; absent before them)
const assetsLoaded = () => p.evaluate(() => window.__ahdusAssets?.whenLoaded?.() ?? null);
const shot = (name) => p.screenshot({ path: `e2e/screens/real-assets-${tag}-${name}.png`, timeout: 120000 });

await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Shots Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Showcase');
await p.press('input[placeholder="Layout name…"]', 'Enter');
await p.waitForSelector('canvas', { timeout: 90000 });
await frames(2);

// The same layout every time: one room of each kind, furnished with catalogue items
await p.evaluate(() => {
  const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
  const room = (id, type, name, x, z, width, depth, extra = {}) => ({
    id, type, name, floor: 0, x, z, width, depth, wallHeight: 3.2, doors: [], windows: [], ...extra,
  });
  const rooms = [
    room('room_office', 'OFFICE', 'Office', -4, 0, 7, 6, {
      doors: [{ wall: 'east', offset: 1.5, width: 0.9, height: 2.1 }],
      windows: [{ wall: 'north', offset: 0, width: 2.4, height: 1.4, sill: 0.9 }, { wall: 'west', offset: 0, width: 1.6, height: 1.4, sill: 0.9 }],
    }),
    room('room_meeting', 'MEETING', 'Meeting Room', 4, 0, 6, 6, {
      doors: [{ wall: 'west', offset: 1.5, width: 0.9, height: 2.1 }],
      windows: [{ wall: 'north', offset: 0, width: 2.4, height: 1.4, sill: 0.9 }],
    }),
    room('room_reception', 'RECEPTION', 'Reception', -4, -7, 7, 5, {
      doors: [{ wall: 'south', offset: 0, width: 1.6, height: 2.1 }],
    }),
    room('room_restroom', 'RESTROOM', 'Restroom', 3, -6.5, 4, 4),
    room('room_server', 'SERVER_ROOM', 'Server Room', 7.5, -6.5, 3, 4),
    room('room_corridor', 'CORRIDOR', 'Corridor', 0, -3.25, 15, 1.8),
    room('room_shop', 'PRODUCTION', 'Workshop', 0, 9, 15, 6.5, {
      doors: [{ wall: 'south', offset: 0, width: 1.6, height: 2.4 }],
    }),
  ];
  let n = 0;
  const objects = [];
  const add = (assetType, x, z, rotationY = 0, y = 0) => objects.push({
    id: `obj_${++n}`, assetType, floor: 0, x, y, z, rotationX: 0, rotationY, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
  });
  // Office: two desks with screens and chairs, a bookshelf, plants
  for (const dx of [-5.5, -2.5]) {
    add('DESK_STANDARD', dx, 1.5);
    add('MONITOR_DUAL', dx, 1.75, 0, 0.77);
    add('PLANT_SMALL', dx + 0.65, 1.4, 0, 0.77);
    add('CHAIR_OFFICE', dx, 0.8, Math.PI);
  }
  add('BOOKSHELF', -7.2, -1.5, Math.PI / 2);
  add('PLANT_LARGE', -0.9, 2.5);
  add('DESK_CORNER', -5.8, -1.6, Math.PI);
  // Meeting room: table, chairs, TV, coffee corner
  add('TABLE_MEETING', 4, 0.2);
  for (const dx of [-1, 0, 1]) { add('CHAIR_OFFICE', 4 + dx, 1.2, Math.PI); add('CHAIR_OFFICE', 4 + dx, -0.8); }
  add('TV_DISPLAY', 4, 2.9, 0, 1.0);
  add('TABLE_COFFEE', 6.2, -2.2);
  add('COFFEE_MACHINE', 6.2, -2.2, 0, 0.44);
  // Reception: sofa, coffee table, plants
  add('SOFA_3SEAT', -4, -8.8);
  add('TABLE_COFFEE', -4, -7.6);
  add('PLANT_LARGE', -6.8, -8.8);
  add('RECEPTION_DESK', -4, -5.6, Math.PI);
  // Workshop
  add('CNC_MACHINE', -3, 9.5);
  add('LATHE', 3, 9.5);
  window.__ahdusStore.getState().loadWorkspace({ layoutName: 'Showcase', floors, rooms, objects });
});
await frames(3);
await assetsLoaded();
await p.click('[aria-label="Fit view"]'); await wait(1200); await frames(4);
await assetsLoaded(); await frames(3);
await shot('studio');

// Preview: stand in the office doorway, looking at the desks
await p.click('[aria-label="Preview Workplace"]'); await wait(1000);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")').catch(() => {}); await wait(400);
}
await p.evaluate(() => window.__ahdusPlay.setPose({ x: -1.4, z: -1.8, yaw: -0.75, pitch: -0.12 }));
await frames(6);
await shot('preview');
// Outside, looking at the building and the sky
await p.evaluate(() => window.__ahdusPlay.setPose({ x: 9, z: -18, yaw: -0.45, pitch: 0.05 }));
await frames(6);
await shot('outside');
console.log(`Saved e2e/screens/real-assets-${tag}-studio.png, -preview.png and -outside.png`);
for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
await b.close();
