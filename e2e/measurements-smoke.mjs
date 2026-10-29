import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
};
const frames = (count = 3) => page.evaluate((n) => new Promise((resolve) => {
  const scene = window.__ahdusScene;
  let rendered = 0;
  const observer = scene.onAfterRenderObservable.add(() => {
    if (++rendered >= n) {
      scene.onAfterRenderObservable.remove(observer);
      resolve();
    }
  });
  setTimeout(() => {
    scene.onAfterRenderObservable.remove(observer);
    resolve();
  }, 10000);
}), count);
const worldToScreen = (x, y, z) => page.evaluate(([wx, wy, wz]) => {
  const scene = window.__ahdusScene;
  const engine = scene.getEngine();
  const camera = scene.activeCamera;
  const Vector = camera.position.constructor;
  const Matrix = scene.getTransformMatrix().constructor;
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const projected = Vector.Project(new Vector(wx, wy, wz), Matrix.Identity(), scene.getTransformMatrix(), viewport);
  const rect = engine.getRenderingCanvas().getBoundingClientRect();
  const scale = rect.width / engine.getRenderWidth();
  return { x: rect.left + projected.x * scale, y: rect.top + projected.y * scale };
}, [x, y, z]);
const clickWorld = async (x, z) => {
  await page.waitForTimeout(300);
  await frames(2);
  const point = await worldToScreen(x, 0.02, z);
  await page.mouse.click(point.x, point.y);
  await frames(3);
  return page.evaluate(() => {
    const scene = window.__ahdusScene;
    const Matrix = scene.getTransformMatrix().constructor;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
    const t = -ray.origin.y / ray.direction.y;
    return { x: ray.origin.x + t * ray.direction.x, z: ray.origin.z + t * ray.direction.z };
  });
};

// The measure tools sit in the panel of the "Measurements" button (top right of the canvas)
const measurePanel = () => page.locator('[aria-label="Measurement tools"]');
const openMeasure = async () => {
  if (await measurePanel().count() === 0) await page.locator('button[aria-label="Measurements"]').click();
  await measurePanel().waitFor();
};
const measureActive = () => page.locator('button[aria-label="Measurements"]').getAttribute('data-active');

try {
  await page.goto(url);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.locator('input[placeholder="Company name…"]').fill('Measurement test');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('input[placeholder="Layout name…"]').fill('Measurements');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => !!window.__ahdusScene, null, { timeout: 90000 });
  await page.getByRole('button', { name: '2D view' }).click();
  await page.getByRole('button', { name: 'Rooms' }).click();
  await page.locator('[aria-label="Rooms options"] button:has-text("Office")').click();
  const from = await worldToScreen(-3, 0.02, -2);
  const to = await worldToScreen(3, 0.02, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await frames(5);

  const room = await page.evaluate(() => Object.values(window.__ahdusStore.getState().rooms)[0]);
  check('created a 6 m × 4 m room', room?.width === 6 && room?.depth === 4);
  await frames(3);
  check('wall lengths and room areas are off when a layout opens',
    await page.locator('.measurement-label--wall').count() === 0 && await page.locator('.room-label__area').count() === 0 &&
    await measureActive() === 'false');
  check('the old measurement bar is gone (one Measurements button)',
    await page.locator('.measurement-controls').count() === 0 && await measurePanel().count() === 0);
  await openMeasure();
  await page.getByRole('button', { name: 'Show Room Areas' }).click();
  await page.getByRole('button', { name: 'Show Wall Lengths' }).click();
  check('the Measurements button shows as active while a measurement is on', await measureActive() === 'true');
  await frames(3);
  await page.screenshot({ path: 'e2e/screens/measure-panel.png' });
  await page.keyboard.press('Escape');
  check('Esc closes the measurement panel', await measurePanel().count() === 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.room-label__area')].some((label) => label.textContent === '24.00 m²'));
  check('room area label shows 24.00 m²', await page.locator('.room-label__area').filter({ hasText: '24.00 m²' }).count() === 1);

  const wallLabelCount = await page.locator('.measurement-label--wall').count();
  check('wall-length labels are shown', wallLabelCount >= 4, `found ${wallLabelCount}`);
  const wallLabels = await page.locator('.measurement-label--wall').allTextContents();
  check('room boundary labels match 6 m and 4 m geometry',
    wallLabels.filter((text) => text === '6.00 m').length === 2 &&
    wallLabels.filter((text) => text === '4.00 m').length === 2,
    wallLabels.join(', '));

  await page.evaluate((roomId) => window.__ahdusStore.getState().selectRoom(roomId), room.id);
  await page.getByLabel('Width').fill('7');
  await page.getByLabel('Width').press('Tab');
  await page.waitForFunction(() => [...document.querySelectorAll('.room-label__area')].some((label) => label.textContent === '28.00 m²'));
  check('resizing a room updates its area label immediately',
    await page.locator('.room-label__area').filter({ hasText: '28.00 m²' }).count() === 1);

  await openMeasure();
  await page.getByRole('button', { name: 'Show Wall Lengths' }).click();
  await frames(2);
  check('wall-length labels toggle independently', await page.locator('.measurement-label--wall').count() === 0 &&
    await page.locator('.room-label__area').filter({ hasText: '28.00 m²' }).count() === 1);

  await page.getByRole('button', { name: 'Measure Distance' }).click();
  check('Measure Distance closes the panel and shows the hint',
    await measurePanel().count() === 0 && await page.getByRole('button', { name: 'Exit Measurement Mode' }).count() === 1);
  check('measurement mode uses the 2D view', await page.getByRole('button', { name: '2D view' }).getAttribute('aria-pressed') === 'true');
  const horizontalStart = await clickWorld(0, 0);
  check('first point prompts for the second point', await page.getByText('Choose the second point').count() === 1);
  const horizontalEnd = await clickWorld(3, 0);
  check('3 m horizontal measurement displays 3.00 m',
    (await page.locator('.measurement-label--distance').allTextContents()).some((text) => text.includes('3.00 m')),
    `${JSON.stringify(horizontalStart)} → ${JSON.stringify(horizontalEnd)}`);

  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -300);
  await page.mouse.move(700, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(740, 420, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1200);
  await frames(4);
  const diagonalStart = await clickWorld(-2.5, -1.5);
  const diagonalEnd = await clickWorld(1.5, 1.5);
  check('4 m × 3 m diagonal remains accurate after zoom and pan',
    (await page.locator('.measurement-label--distance').allTextContents()).some((text) => text.includes('5.00 m')),
    `${JSON.stringify(diagonalStart)} → ${JSON.stringify(diagonalEnd)}`);

  await openMeasure();
  await page.getByRole('button', { name: 'Show Room Areas' }).click();
  await frames(2);
  check('room area toggle does not exit distance mode',
    await page.getByRole('button', { name: 'Measure Distance' }).getAttribute('aria-pressed') === 'true');
  check('room area toggle hides only room-area labels',
    await page.locator('.room-label__area').count() === 0 &&
    (await page.locator('.measurement-label--distance').count()) >= 2,
    `areas=${await page.locator('.room-label__area').count()}, distances=${await page.locator('.measurement-label--distance').count()}`);
  await clickWorld(1, 1);
  check('a click on the canvas closes the panel', await measurePanel().count() === 0);
  await page.keyboard.press('Escape');
  await openMeasure();
  check('Escape cancels an unfinished measurement and exits the tool',
    await page.getByRole('button', { name: 'Measure Distance' }).getAttribute('aria-pressed') === 'false' &&
    await page.locator('.measurement-label--pending').count() === 0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Floor switcher' }).click();
  await page.getByRole('menuitem', { name: 'Add floor above' }).click();
  await page.getByRole('button', { name: 'Empty floor' }).click();
  await frames(3);
  check('measurements are hidden on a different floor',
    await page.evaluate(() => window.__ahdusStore.getState().currentFloor) === 1 &&
    await page.locator('.measurement-label--distance').count() === 0);
  await page.getByRole('button', { name: 'Floor switcher' }).click();
  await page.getByRole('menuitemradio', { name: /Ground Floor/ }).click();
  await frames(3);
  check('measurements return on their original floor',
    await page.locator('.measurement-label--distance').count() === 2);

  await openMeasure();
  await page.getByRole('button', { name: 'Clear Measurements' }).click();
  await frames(2);
  check('Clear Measurements removes annotations without deleting the room',
    await page.locator('.measurement-label--distance').count() === 0 &&
    await page.evaluate(() => Object.keys(window.__ahdusStore.getState().rooms).length) === 1);
  check('no uncaught browser errors', failures.length === 0, failures.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

process.exitCode = failures.length ? 1 : 0;
