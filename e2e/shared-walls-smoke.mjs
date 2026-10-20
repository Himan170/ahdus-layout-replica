// Shared-wall browser smoke test: derive one physical shared wall and paired
// door from live room data, save the layout, reload it, and verify the meshes.
// Run: npm run dev (in one terminal), then npm run e2e:shared-walls.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('BJS')) errors.push(message.text());
});

// The shared wall is built by ONE of the two rooms (the one whose id sorts
// first; ids are random UUIDs), as one mesh: its pieces are merged.
await page.addInitScript(() => {
  window.__sharedWalls = ({ westId, eastId }) => (window.__ahdusScene?.meshes ?? []).filter((mesh) =>
    mesh.name.startsWith('wall_') && mesh.metadata?.part === 'wall' &&
    ((mesh.metadata.roomId === westId && mesh.metadata.wallName === 'east') ||
     (mesh.metadata.roomId === eastId && mesh.metadata.wallName === 'west')));
});

try {
  await page.goto(url);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.fill('input[placeholder="Company name…"]', 'Shared Wall Test');
  await page.click('button:has-text("Create")');
  await page.waitForSelector('input[placeholder="Layout name…"]', { timeout: 30000 });
  await page.fill('input[placeholder="Layout name…"]', 'Shared Wall Layout');
  await page.press('input[placeholder="Layout name…"]', 'Enter');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusStore && window.__ahdusScene);
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));

  const createFixture = () => page.evaluate(() => {
    const store = window.__ahdusStore.getState();
    const westId = store.addRoom({
      type: 'OFFICE', name: 'West Room', x: 0, z: 0, width: 6, depth: 4, floor: 0,
    }).id;
    const eastId = store.addRoom({
      type: 'MEETING', name: 'East Room', x: 5.15, z: 0, width: 4, depth: 4, floor: 0,
    }).id;
    store.updateRoom(westId, { doors: [{ wall: 'east', offset: 0.25, width: 1, height: 2.1 }] });
    store.updateRoom(eastId, { doors: [{ wall: 'west', offset: 0.25, width: 1, height: 2.1 }] });
    return { westId, eastId };
  });
  const ids = await createFixture();

  const wallState = () => page.evaluate(({ westId, eastId }) => {
    const walls = window.__sharedWalls({ westId, eastId });
    const doorPanes = window.__ahdusScene.meshes.filter((mesh) =>
      [westId, eastId].includes(mesh.metadata?.roomId) && mesh.metadata?.part === 'door' && mesh.metadata.pickPane);
    const box = walls[0]?.getBoundingInfo().boundingBox;
    return {
      rooms: Object.keys(window.__ahdusStore.getState().rooms).length,
      owner: !walls[0] ? null : walls[0].metadata.roomId === westId ? 'west' : 'east',
      wallCount: walls.length,
      x: box ? (box.minimumWorld.x + box.maximumWorld.x) / 2 : null,
      thickness: box ? box.maximumWorld.x - box.minimumWorld.x : null,
      doorPanes: doorPanes.length,
      roomDoors: [westId, eastId].map((id) => window.__ahdusStore.getState().rooms[id].doors.length),
    };
  }, ids);
  const looksRight = (g) => g.wallCount === 1 && Math.abs(g.x - 3.075) < 0.005 &&
    Math.abs(g.thickness - 0.15) < 0.005 && g.doorPanes === 1 && g.roomDoors.every((count) => count === 1);

  await page.waitForFunction((ids) => document.querySelector('.studio-header__status')?.textContent === 'Saved' &&
    window.__sharedWalls(ids).length > 0, ids, { timeout: 30000 });
  let geometry = await wallState();
  const rendered = looksRight(geometry);
  console.log(`${rendered ? 'PASS' : 'FAIL'} shared wall rendered once with a single paired doorway ${JSON.stringify(geometry)}`);

  await page.click('[aria-label="All layouts"]');
  await page.waitForSelector('button[aria-label="Open Shared Wall Layout"]', { timeout: 30000 });
  await page.click('button[aria-label="Open Shared Wall Layout"]');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusScene && window.__ahdusStore);
  await page.waitForFunction((ids) => window.__sharedWalls(ids).length > 0, ids, { timeout: 30000 });
  geometry = await wallState();
  const reloaded = looksRight(geometry);
  console.log(`${reloaded ? 'PASS' : 'FAIL'} save and reload preserve derived wall and opening geometry ${JSON.stringify(geometry)}`);

  if (errors.length) throw new Error(`Browser errors: ${errors.slice(0, 5).join(' | ')}`);
  if (!rendered || !reloaded) process.exitCode = 1;
} finally {
  await browser.close();
}
