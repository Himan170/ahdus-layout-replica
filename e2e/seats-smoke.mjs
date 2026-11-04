// "Who sits here" in Workplace Studio inside AHDUS (v0.11.2), with the AHDUS API faked in the browser
// (page.route: /api/workplace/me, sites, layout, seats, people; the character manifest).
// Checks: people drawn at their desks; the desk Inspector section (Admin / HR: Change, Remove, Assign someone with
// a debounced name search; appointed editors: names only); move / replace questions; saved at once, not in undo,
// no layout save; "People without a desk (N)" + Assign a desk; the Publish dialog's "N people lose their desk";
// phone width.
//
// NO dev server needed: it starts its own Vite dev server in AHDUS mode (VITE_LAYOUT_BACKEND=ahdus) on port 3100.
// One-time setup:   npx playwright install chromium
// Run:              npm run e2e:seats
//                   SHOTS=private-docs/screenshots/v0.11.2 npm run e2e:seats   (also 1440×900 + 390×844 shots)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

process.env.VITE_LAYOUT_BACKEND = 'ahdus';
const { createServer } = await import('vite');

const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
const PORT = 3100;
mkdirSync('e2e/screens', { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const errs = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
  if (results.some((r) => !r.ok) || errs.length) process.exitCode = 1;
});

const vite = await createServer({
  configFile: 'vite.config.js',
  cacheDir: 'node_modules/.vite-seats', // never disturbs a running `npm run dev`
  logLevel: 'error',
  server: { port: PORT, strictPort: true, open: false },
});
await vite.listen();

// ── The fake AHDUS: one site, 4 desks (+ chairs), seats, people ──
const desks = [[-3, -1.5], [0, -1.5], [3, -1.5], [0, 2]];
const objects = [];
desks.forEach(([x, z], i) => {
  objects.push({ id: `obj_desk_${i + 1}`, assetType: 'DESK_STANDARD', floor: 0, roomId: 'room_open', x, y: 0, z, rotationY: 0 });
  objects.push({ id: `obj_chair_${i + 1}`, assetType: 'CHAIR_OFFICE', floor: 0, roomId: 'room_open', x, y: 0, z: z + 0.7, rotationY: Math.PI });
});
const DRAFT = {
  layoutName: 'Seats HQ', layoutVersion: 1,
  floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
  rooms: [{ id: 'room_open', type: 'OFFICE', name: 'Open office', floor: 0, x: 0, z: 0, width: 12, depth: 8, wallHeight: 3.2,
    doors: [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [] }],
  objects,
  anchorData: {},
};
const PUBLISHED_DESKS = new Set([...desks.keys()].map((i) => `obj_desk_${i + 1}`).concat('obj_desk_old'));
const USERS = [
  { id: 1, name: 'Asha Rao', email: 'asha@example.com', department: 'Design', assetReference: 'placeholder:mixamo-v1' },
  { id: 2, name: 'Ravi Kumar', email: 'ravi@example.com', department: 'Sales', assetReference: null },
  { id: 3, name: 'Meera Iyer', email: 'meera@example.com', department: 'HR', assetReference: null },
  { id: 4, name: 'Kiran <b>Das</b>', email: 'kiran@example.com', department: 'Finance', assetReference: null },
];
const api = {
  me: { canEdit: true, canAppoint: true },
  seats: [{ deskId: 'obj_desk_1', userId: 1 }, { deskId: 'obj_desk_2', userId: 2 }, { deskId: 'obj_desk_old', userId: 4 }],
  revision: 3,
  calls: [],
};
const seatOut = (s) => {
  const u = USERS.find((x) => x.id === s.userId);
  return { deskId: s.deskId, userId: u.id, name: u.name, department: u.department, assetReference: u.assetReference,
    clothing: null, hasDesk: PUBLISHED_DESKS.has(s.deskId), email: 'never-shown@example.com' };
};
const MANIFEST = {
  'placeholder:mixamo-v1': { url: `http://localhost:${PORT}/assets/characters/placeholder-mixamo.glb`, rig: 'mixamo', height: 1.75 },
};

async function fakeAhdus(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const path = url.pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : undefined;
  api.calls.push({ method, path: path + url.search, body });
  const send = (status, data) => route.fulfill({ status, contentType: 'application/json', body: data === undefined ? '' : JSON.stringify(data) });
  if (path === '/frontend/workplace/characters.json') return send(200, MANIFEST);
  if (path === '/api/workplace/me') return send(200, api.me);
  if (path === '/api/workplace/sites') return send(200, [{ id: 1, name: 'Seats HQ', published: true, publishedRevision: 3, draftRevision: api.revision }]);
  if (path === '/api/workplace/sites/1/layout' && method === 'GET') return send(200, { layout: DRAFT, revision: api.revision, name: 'Seats HQ' });
  if (path === '/api/workplace/sites/1/layout' && method === 'PUT') { api.revision += 1; return send(200, { revision: api.revision }); }
  if (path === '/api/workplace/sites/1/versions') return send(200, []);
  if (path === '/api/workplace/sites/1/seats' && method === 'GET') {
    const all = api.seats.map(seatOut);
    return send(200, api.me.canAppoint ? all : all.filter((s) => s.hasDesk));
  }
  const seat = path.match(/^\/api\/workplace\/sites\/1\/seats\/([^/]+)$/);
  if (seat && !api.me.canAppoint) return send(403, { detail: 'Only Admin and HR' });
  if (seat && method === 'PUT') {
    const deskId = decodeURIComponent(seat[1]);
    api.seats = api.seats.filter((s) => s.deskId !== deskId && s.userId !== body.userId).concat({ deskId, userId: body.userId });
    return send(200, seatOut({ deskId, userId: body.userId }));
  }
  if (seat && method === 'DELETE') {
    const deskId = decodeURIComponent(seat[1]);
    if (!api.seats.some((s) => s.deskId === deskId)) return send(404, { detail: 'Nobody sits at this desk' });
    api.seats = api.seats.filter((s) => s.deskId !== deskId);
    return send(204);
  }
  if (path === '/api/workplace/people') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return send(200, USERS.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q))
      .map(({ id, name, email, department }) => ({ id, name, email, department })));
  }
  return send(404, { detail: `Not faked: ${method} ${path}` });
}

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function openStudio({ width = 1280, height = 720 } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, ...(width < 600 ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addInitScript(() => { localStorage.setItem('authToken', 'test-token'); });
  await ctx.route('**/api/workplace/**', fakeAhdus);
  await ctx.route('**/frontend/workplace/characters.json', fakeAhdus);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error' || m.text().includes('BJS')) return;
    if (/Failed to load resource.*(403|404)/.test(m.text())) return; // the refused calls this test makes on purpose
    errs.push(m.text());
  });
  await p.goto(`http://localhost:${PORT}/?site=1`, { timeout: 120000 });
  await p.waitForSelector('[data-splash]', { state: 'detached', timeout: 180000 });
  await p.waitForFunction(() => window.__ahdusBuild?.whenBuilt, null, { timeout: 60000 });
  await p.evaluate(() => window.__ahdusBuild.whenBuilt());
  return p;
}
const select = (p, id) => p.evaluate((id) => window.__ahdusStore.getState().selectObject(id), id);
const section = (p) => p.locator('[aria-label="Who sits here"]').first();
const calls = (method, re) => api.calls.filter((c) => c.method === method && re.test(c.path));
const until = (fn, ms = 15000) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => (fn() ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 100));
  tick();
});
const shot = (p, name) => p.screenshot({ path: SHOTS ? `${SHOTS}/${name}` : `e2e/screens/seats-${name}`, timeout: 120000 });

// ── 1. Admin / HR opens Studio ──
const p = await openStudio(SHOTS ? { width: 1440, height: 900 } : {});
const back = await p.locator('[aria-label="Back to AHDUS"]').count();
await until(() => calls('GET', /\/seats$/).length > 0);
log('Studio opens in AHDUS mode and asks who may do what and who sits where (GET /me, GET …/seats)',
  back === 1 && calls('GET', /\/api\/workplace\/me$/).length >= 1 && calls('GET', /\/seats$/).length >= 1, // dev: StrictMode asks twice
  `Back to AHDUS ×${back}, /me ×${calls('GET', /\/api\/workplace\/me$/).length}`);

const placed = await p.waitForFunction(() => window.__ahdusCharacters?.getPlaced().length === 2, null, { timeout: 30000 })
  .then(() => p.evaluate(() => window.__ahdusCharacters.getPlaced().map((x) => ({ id: x.personId, desk: x.deskId, file: !!x.character, keys: Object.keys(x).join() }))))
  .catch(() => p.evaluate(() => window.__ahdusCharacters?.getPlaced() ?? null));
log('the 2 people whose desk is in the layout sit at it in Studio (Asha with her manifest character), no email',
  Array.isArray(placed) && placed.length === 2 && placed.find((x) => x.id === '1')?.file === true &&
  !JSON.stringify(placed).includes('example.com'), JSON.stringify(placed));

const banner = await p.locator('[data-seats-banner]').getAttribute('data-seats-banner').catch(() => null);
log('"People without a desk (1)": Kiran, whose desk is not in the layout', banner === '1');

// ── 2. A desk with someone ──
await select(p, 'obj_desk_1');
await section(p).waitFor({ timeout: 15000 });
const s1 = await section(p).textContent();
const buttons1 = await section(p).locator('button').allTextContents();
log('a desk: "Who sits here" shows Asha Rao, Design, with Change and Remove (no email)',
  /Asha Rao/.test(s1) && /Design/.test(s1) && !s1.includes('@') && buttons1.some((t) => /Change/.test(t)) && buttons1.some((t) => /Remove/.test(t)),
  `${s1} | ${buttons1.join(', ')}`);
if (SHOTS) await shot(p, 'desktop-desk-person.png');
await select(p, 'obj_chair_1');
await p.waitForTimeout(300);
log('a chair has no "Who sits here"', (await section(p).count()) === 0);

// ── 3. An empty desk: Assign someone, the debounced search ──
await select(p, 'obj_desk_3');
await section(p).waitFor({ timeout: 15000 });
const empty = await section(p).textContent();
const layoutPutsBefore = calls('PUT', /\/layout$/).length;
await section(p).getByRole('button', { name: /Assign someone/ }).click();
const searchBox = p.getByLabel('Search people');
const peopleBefore = calls('GET', /\/people/).length;
await searchBox.pressSequentially('meer', { delay: 40 });
await p.getByRole('button', { name: /Meera Iyer/ }).waitFor({ timeout: 15000 });
const searches = calls('GET', /\/people/).slice(peopleBefore).map((c) => c.path);
const result = await p.getByRole('button', { name: /Meera Iyer/ }).textContent();
log('an empty desk: "Nobody sits here yet" + Assign someone; typing searches once (debounced) and lists name, department, email',
  /Nobody sits here yet/.test(empty) && searches.length === 1 && searches[0].endsWith('q=meer') && /HR/.test(result) && /meera@example.com/.test(result),
  `${searches.join(', ')} | ${result}`);
if (SHOTS) await shot(p, 'desktop-search.png');
await p.getByRole('button', { name: /Meera Iyer/ }).click();
await until(() => calls('PUT', /\/seats\/obj_desk_3$/).length === 1);
await p.waitForFunction(() => /Meera Iyer/.test(document.querySelector('[aria-label="Who sits here"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const toast1 = await p.locator('[data-toast]').textContent().catch(() => '');
log('choosing Meera (no desk yet) seats her at once: PUT …/seats/obj_desk_3 { userId: 3 }, a toast, no question',
  calls('PUT', /\/seats\/obj_desk_3$/)[0]?.body?.userId === 3 && /Meera Iyer now sits at Standard Desk 3/.test(toast1) &&
  (await p.locator('.ui-dialog').count()) === 0, toast1);
await p.waitForTimeout(1500); // longer than the 1 s auto-save
log('seats are not in the layout: no layout save (PUT …/layout) after seating someone', calls('PUT', /\/layout$/).length === layoutPutsBefore);
await p.keyboard.press('Control+z');
await p.waitForTimeout(500);
log('and not in undo: Ctrl+Z leaves Meera at her desk', api.seats.some((s) => s.deskId === 'obj_desk_3' && s.userId === 3));

// ── 4. Moving and replacing ask first ──
await select(p, 'obj_desk_3');
await section(p).getByRole('button', { name: /Change/ }).click();
await p.getByLabel('Search people').pressSequentially('asha', { delay: 30 });
await p.getByRole('button', { name: /Asha Rao/ }).click();
const ask = await p.locator('[data-seat-question]').textContent({ timeout: 15000 }).catch(() => '');
log('Asha (at desk 1) onto Meera\'s desk asks: "Asha Rao already sits at Standard Desk 1. Move them here? This replaces Meera Iyer."',
  ask === 'Asha Rao already sits at Standard Desk 1. Move them here? This replaces Meera Iyer.', ask);
const putsBefore = calls('PUT', /\/seats\//).length;
await p.locator('.ui-dialog').getByRole('button', { name: 'Cancel' }).click();
await p.waitForTimeout(300);
log('Cancel changes nothing', calls('PUT', /\/seats\//).length === putsBefore && api.seats.find((s) => s.deskId === 'obj_desk_3')?.userId === 3);
await section(p).getByRole('button', { name: /Change/ }).click();
await p.getByLabel('Search people').pressSequentially('asha', { delay: 30 });
await p.getByRole('button', { name: /Asha Rao/ }).click();
await p.locator('.ui-dialog').getByRole('button', { name: 'Move here' }).click();
await until(() => api.seats.find((s) => s.deskId === 'obj_desk_3')?.userId === 1);
await p.waitForFunction(() => /Asha Rao/.test(document.querySelector('[aria-label="Who sits here"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
log('Move here: Asha sits at desk 3, desk 1 is free, Meera has no seat', api.seats.find((s) => s.deskId === 'obj_desk_3')?.userId === 1 &&
  !api.seats.some((s) => s.deskId === 'obj_desk_1') && !api.seats.some((s) => s.userId === 3), JSON.stringify(api.seats));

await select(p, 'obj_desk_2');
await section(p).waitFor();
await section(p).getByRole('button', { name: /Change/ }).click();
await p.getByLabel('Search people').pressSequentially('meera', { delay: 30 });
await p.getByRole('button', { name: /Meera Iyer/ }).click();
const ask2 = await p.locator('[data-seat-question]').textContent({ timeout: 15000 }).catch(() => '');
const title2 = await p.locator('.ui-dialog__title').textContent().catch(() => '');
log('a taken desk asks "Replace Ravi Kumar?" — "This replaces Ravi Kumar."', ask2 === 'This replaces Ravi Kumar.' && title2 === 'Replace Ravi Kumar?', `${title2} | ${ask2}`);
await p.locator('.ui-dialog').getByRole('button', { name: 'Replace' }).click();
await until(() => api.seats.find((s) => s.deskId === 'obj_desk_2')?.userId === 3);
log('Replace: Meera sits at desk 2, Ravi has no seat', api.seats.find((s) => s.deskId === 'obj_desk_2')?.userId === 3 && !api.seats.some((s) => s.userId === 2));

// ── 5. Remove ──
await p.waitForFunction(() => /Meera Iyer/.test(document.querySelector('[aria-label="Who sits here"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
await section(p).getByRole('button', { name: /Remove/ }).click();
await until(() => calls('DELETE', /\/seats\/obj_desk_2$/).length === 1);
await p.waitForFunction(() => /Nobody sits here yet/.test(document.querySelector('[aria-label="Who sits here"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
log('Remove: DELETE …/seats/obj_desk_2, the desk shows "Nobody sits here yet."',
  !api.seats.some((s) => s.deskId === 'obj_desk_2') && /Nobody sits here yet/.test(await section(p).textContent()));

// ── 6. People without a desk: Assign a desk ──
await p.evaluate(() => window.__ahdusStore.getState().selectObject(null));
await p.locator('[data-seats-banner] .seats-banner__toggle').click();
const row = p.locator('[data-seat-without-desk="4"]');
const rowText = await row.textContent();
log('the list: Kiran <b>Das</b> as text (no HTML), with Assign a desk and Remove',
  rowText.includes('Kiran <b>Das</b>') && (await row.locator('b').count()) === 0, rowText);
if (SHOTS) await shot(p, 'desktop-people-without-desk.png');
await row.getByRole('button', { name: 'Assign a desk' }).click();
const hint = await p.getByText(/Click the desk where Kiran/).textContent({ timeout: 10000 }).catch(() => '');
await select(p, 'obj_desk_1');
await until(() => api.seats.find((s) => s.deskId === 'obj_desk_1')?.userId === 4);
await p.waitForSelector('[data-seats-banner]', { state: 'detached', timeout: 15000 }).catch(() => {});
log('Assign a desk: the hint says to click a desk; the desk clicked is Kiran\'s; the list is gone',
  /Click the desk where Kiran <b>Das<\/b> sits · Esc cancels/.test(hint) && api.seats.find((s) => s.deskId === 'obj_desk_1')?.userId === 4 &&
  (await p.locator('[data-seats-banner]').count()) === 0, hint);

// ── 7. Publishing a draft without a desk someone sits at ──
await select(p, 'obj_desk_3'); // Asha's
await section(p).waitFor();
await p.locator('.inspector__footer').getByRole('button', { name: /^Delete$/ }).click();
await p.waitForSelector('[data-seats-banner="1"]', { timeout: 15000 }).catch(() => {});
log('deleting Asha\'s desk lists her under "People without a desk (1)" at once (her seat stays on the server)',
  (await p.locator('[data-seats-banner="1"]').count()) === 1 && api.seats.some((s) => s.userId === 1));
await p.getByRole('button', { name: /^Publish changes/ }).first().click({ timeout: 30000 });
const warn = await p.locator('[data-seat-warning]').textContent({ timeout: 15000 }).catch(() => '');
log('the Publish dialog says "1 person loses their desk: Asha Rao."', /1 person loses their desk: Asha Rao\./.test(warn), warn);
if (SHOTS) await shot(p, 'desktop-publish-warning.png');
await p.locator('.ui-dialog').getByRole('button', { name: 'Cancel' }).click();
await p.keyboard.press('Control+z');
await p.waitForSelector('[data-seats-banner]', { state: 'detached', timeout: 15000 }).catch(() => {});
log('Ctrl+Z brings the desk back, and Asha with it (no list)', (await p.locator('[data-seats-banner]').count()) === 0);
await p.context().close();

// ── 8. An appointed editor: names only ──
api.me = { canEdit: true, canAppoint: false };
const e = await openStudio();
await until(() => calls('GET', /\/seats$/).length >= 2);
await select(e, 'obj_desk_1');
await section(e).waitFor({ timeout: 15000 });
const ro = await section(e).textContent();
log('an appointed editor sees who sits at a desk (Kiran), with no buttons and no "People without a desk"',
  /Kiran/.test(ro) && (await section(e).locator('button').count()) === 0 && (await e.locator('[data-seats-banner]').count()) === 0, ro);
await select(e, 'obj_desk_2');
await e.waitForTimeout(300);
log('…and "Nobody sits here yet." on an empty desk, with no Assign someone', /Nobody sits here yet/.test(await section(e).textContent()) &&
  (await section(e).locator('button').count()) === 0);
await e.context().close();

// ── 9. A phone (390 × 844): the Inspector sheet with the person ──
api.me = { canEdit: true, canAppoint: true };
const ph = await openStudio({ width: 390, height: 844 });
await select(ph, 'obj_desk_1');
await section(ph).waitFor({ timeout: 15000 });
await ph.waitForTimeout(500);
const fits = await ph.evaluate(() => {
  const s = document.querySelector('[aria-label="Who sits here"]').getBoundingClientRect();
  return { page: document.documentElement.scrollWidth, right: s.right, w: window.innerWidth };
});
log('on a phone the desk sheet shows "Who sits here", nothing off-screen', fits.page <= fits.w && fits.right <= fits.w + 0.5, JSON.stringify(fits));
if (SHOTS) await shot(ph, 'phone-desk-person.png');
await ph.context().close();

log('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
await vite.close();
