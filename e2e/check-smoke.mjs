import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screens', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) errors.push(name); };
try {
  await page.goto(process.argv[2] ?? 'http://localhost:3000/');
  await page.locator('input[placeholder="Company name…"]').fill('Check test');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('radio', { name: 'Small Office', exact: true }).click();
  await page.locator('input[placeholder="Layout name…"]').fill('Layout checks');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(() => !!window.__ahdusScene && Object.keys(window.__ahdusStore.getState().rooms).length === 7);
  await page.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
  await page.getByRole('button', { name: 'Check layout', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Check my layout', exact: true });
  await panel.waitFor();
  check('the template starts clean', await panel.getByText('No problems found', { exact: true }).count() === 1);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown')));
  const saved = await page.evaluate(() => {
    const s = window.__ahdusStore.getState();
    const room = Object.values(s.rooms).find((r) => r.name === 'Meeting Room');
    s.updateRoom(room.id, { doors: [] });
    return { id: room.id, doors: room.doors };
  });
  const problem = panel.getByRole('button', { name: 'Meeting Room has no door', exact: true });
  await page.waitForTimeout(2100);
  check('background checks wait while a pointer is held', await problem.count() === 0);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));
  await problem.waitFor({ timeout: 15000 });
  check('removing a door shows a delayed warning', await problem.count() === 1);
  await problem.click();
  check('a problem click selects its room and keeps the panel open', await page.evaluate((id) => window.__ahdusStore.getState().selectedRoomId === id, saved.id) && await panel.isVisible());
  await page.screenshot({ path: 'e2e/screens/check-layout.png' });
  await page.evaluate(({ id, doors }) => window.__ahdusStore.getState().updateRoom(id, { doors }), saved);
  await problem.waitFor({ state: 'detached', timeout: 15000 });
  check('putting the door back clears the warning', await panel.getByText('No problems found', { exact: true }).count() === 1);
  await page.evaluate(({ id }) => window.__ahdusStore.getState().updateRoom(id, { doors: [] }), saved);
  await problem.waitFor({ timeout: 15000 });
  await panel.locator('li').filter({ hasText: 'Meeting Room has no door' }).getByRole('button', { name: 'Ignore', exact: true }).click();
  check('Ignore removes the count and goes under Ignored', await panel.getByText('Ignored (1)', { exact: true }).count() === 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check('one Undo shows the problem again', await problem.isVisible());
  await panel.locator('li').filter({ hasText: 'Meeting Room has no door' }).getByRole('button', { name: 'Ignore', exact: true }).click();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.locator(".selector-row__main").filter({ hasText: "Check test" }).click();
  await page.getByRole("button", { name: "Open Layout checks", exact: true }).click();
  await page.getByRole('button', { name: 'Check layout', exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Check layout', exact: true }).click();
  check('Ignore survives a reload', await panel.getByText('Ignored (1)', { exact: true }).count() === 1);
  await panel.getByText('Ignored (1)', { exact: true }).click();
  await panel.getByRole('button', { name: 'Show again', exact: true }).click();
  check('Show again restores the problem', await problem.isVisible());
  const upper = await page.evaluate(() => {
    const s = window.__ahdusStore.getState();
    const floor = s.addFloor('Upstairs');
    const room = s.addRoom({ type: 'OFFICE', name: 'Upper Test', x: 0, z: 0, width: 5, depth: 5, floor, doors: [] });
    return { floor, id: room.id };
  });
  const upperProblem = panel.getByRole('button', { name: 'Upper Test has no door', exact: true });
  await upperProblem.waitFor({ timeout: 15000 });
  await upperProblem.click();
  check('a problem on another floor switches floor and selects the room', await page.evaluate(({floor, id}) => {
    const s = window.__ahdusStore.getState(); return s.currentFloor === floor && s.selectedRoomId === id;
  }, upper));

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Check layout', exact: true }).click();
  check('phone: Check opens a sheet that fits', await panel.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
  await page.screenshot({ path: 'e2e/screens/check-layout-phone.png' });
  check('no page errors', errors.length === 0);
} finally { await browser.close(); }
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
