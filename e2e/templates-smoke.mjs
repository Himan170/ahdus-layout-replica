import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
};
const editorState = () => page.evaluate(() => {
  const state = window.__ahdusStore.getState();
  return {
    name: state.layoutName,
    rooms: Object.values(state.rooms),
    objects: Object.values(state.objects),
  };
});
const createFrom = async (name, templateName) => {
  await page.getByRole('radio', { name: templateName, exact: true }).click();
  await page.locator('input[placeholder="Layout name…"]').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click({ noWaitAfter: true });
  await page.waitForFunction((layoutName) =>
    window.__ahdusStore?.getState().layoutName === layoutName, name, { timeout: 30000 });
  await page.waitForSelector('.room-label', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  return editorState();
};
const returnToLayouts = async () => {
  await page.getByRole('button', { name: 'All layouts' }).click();
  await page.getByRole('button', { name: /Open / }).first().waitFor({ timeout: 30000 });
};

try {
  await page.goto(url);
  await page.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await page.locator('input[placeholder="Company name…"]').fill('Template test');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('[role="radiogroup"][aria-label="Layout template"]');
  check('picker shows blank and all three templates',
    await page.getByRole('radio').count() === 4);
  await page.setViewportSize({ width: 1440, height: 900 });
  check('template cards fit a desktop viewport',
    await page.locator('.selector-card').evaluate((element) =>
      element.getBoundingClientRect().right <= window.innerWidth &&
      element.scrollWidth <= element.clientWidth + 1));
  await page.setViewportSize({ width: 390, height: 844 });
  check('template cards fit a phone-sized viewport',
    await page.locator('.selector-card').evaluate((element) =>
      element.getBoundingClientRect().right <= window.innerWidth &&
      element.scrollWidth <= element.clientWidth + 1));

  const blank = await createFrom('Blank', 'Start from Blank Layout');
  check('blank layout still creates an empty workspace', blank.rooms.length === 0 && blank.objects.length === 0);
  await returnToLayouts();

  const office = await createFrom('Office one', 'Small Office');
  check('Small Office opens with rooms and workstations',
    office.rooms.length === 7 && office.objects.some((object) => object.assetType === 'DESK_STANDARD'));
  const officeIds = office.rooms.map((room) => room.id);
  await returnToLayouts();

  const officeAgain = await createFrom('Office two', 'Small Office');
  check('reusing a template generates independent room IDs',
    officeAgain.rooms.length === 7 && officeAgain.rooms.every((room) => !officeIds.includes(room.id)));
  await returnToLayouts();

  const factory = await createFrom('Factory', 'Factory Floor');
  check('Factory Floor opens with production, machinery and storage',
    factory.rooms.some((room) => room.name === 'Main Production Floor') &&
    factory.objects.some((object) => object.assetType === 'CNC_MACHINE') &&
    factory.rooms.some((room) => room.name === 'Raw Materials Storage'));
  await returnToLayouts();

  const clinic = await createFrom('Clinic', 'Clinic');
  check('Clinic opens with consultation and restroom rooms',
    clinic.rooms.some((room) => room.name === 'Consultation Room 1') &&
    clinic.rooms.some((room) => room.type === 'RESTROOM'));
  check('no uncaught browser errors', failures.length === 0, failures.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

process.exitCode = failures.length ? 1 : 0;
