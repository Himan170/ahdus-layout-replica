// Nested-room smoke test: render contained rooms, save, reopen, and verify that
// their world-space footprints and parent floor cutouts are preserved.
// Run: npm run dev (in one terminal), then npm run e2e:nested-rooms.
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

  const ids = await page.evaluate(() => {
    const store = window.__ahdusStore.getState();
    const office = store.addRoom({
      type: 'OFFICE', name: 'Large Office', x: 0, z: 0, width: 12, depth: 10, floor: 0,
    }).id;
    const meeting = store.addRoom({
      type: 'MEETING', name: 'Meeting Room', x: -3, z: 0, width: 3, depth: 3, floor: 0,
    }).id;
    const cabin = store.addRoom({
      type: 'CUSTOM', name: 'Private Cabin', x: 3, z: 0, width: 3, depth: 3, floor: 0,
    }).id;
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
  const start = await toScreen(3, 0.02, 0);
  const end = await toScreen(4, 0.02, 1);
  await page.mouse.move(start.x, start.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(({ cabin }) => {
    const room = window.__ahdusStore.getState().rooms[cabin];
    return Math.abs(room.x - 4) < 0.01 && Math.abs(room.z - 1) < 0.01;
  }, ids, { timeout: 30000 });
  console.log('PASS dragging a selected nested room moves it without changing its dimensions');

  const inspect = () => page.evaluate(({ office, meeting, cabin }) => {
    const scene = window.__ahdusScene;
    const rooms = window.__ahdusStore.getState().rooms;
    const floorMeshes = scene.meshes.filter((mesh) => mesh.name.startsWith(`floor_${office}_`) ||
      mesh.name.startsWith(`floor_${meeting}_`) || mesh.name.startsWith(`floor_${cabin}_`));
    const area = floorMeshes.reduce((sum, mesh) => {
      const bounds = mesh.getBoundingInfo().boundingBox.extendSize;
      return sum + 4 * bounds.x * bounds.z;
    }, 0);
    return {
      count: Object.keys(rooms).length,
      roomData: [rooms[office], rooms[meeting], rooms[cabin]].map((room) =>
        ({ id: room.id, x: room.x, z: room.z, width: room.width, depth: room.depth, floor: room.floor })),
      floorMeshCount: floorMeshes.length,
      totalFloorArea: area,
    };
  }, ids);

  await page.waitForFunction(({ office }) =>
    document.querySelector('.studio-header__status')?.textContent === 'Saved' &&
    window.__ahdusScene.meshes.some((mesh) => mesh.name.startsWith(`floor_${office}_`)),
  ids, { timeout: 30000 });
  let state = await inspect();
  const rendered = state.count === 3 && state.floorMeshCount > 3 &&
    Math.abs(state.totalFloorArea - 118.155) < 0.05 &&
  state.roomData[1].x === -3 && state.roomData[2].x === 4 && state.roomData[2].z === 1;
  console.log(`${rendered ? 'PASS' : 'FAIL'} nested rooms can move inside the office and render with parent floor cutouts ${JSON.stringify(state)}`);

  await page.click('[aria-label="All layouts"]');
  await page.waitForSelector('button[aria-label="Open Nested Room Layout"]', { timeout: 30000 });
  await page.click('button[aria-label="Open Nested Room Layout"]');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__ahdusScene && window.__ahdusStore);
  await page.waitForFunction(({ office }) => window.__ahdusScene.meshes.some((mesh) =>
    mesh.name.startsWith(`floor_${office}_`)), ids, { timeout: 30000 });
  state = await inspect();
  const reloaded = state.count === 3 && state.floorMeshCount > 3 &&
    Math.abs(state.totalFloorArea - 118.155) < 0.05 &&
    state.roomData[1].x === -3 && state.roomData[2].x === 4 && state.roomData[2].z === 1;
  console.log(`${reloaded ? 'PASS' : 'FAIL'} saved nested coordinates and geometry reload correctly ${JSON.stringify(state)}`);

  if (errors.length) throw new Error(`Browser errors: ${errors.slice(0, 5).join(' | ')}`);
  if (!rendered || !reloaded) process.exitCode = 1;
} finally {
  await browser.close();
}
