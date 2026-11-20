// "Avoid stairs (use lifts)" (v0.18.4), viewer.html: More's switch (remembered after a reload), Find's "Stairs only"
// note, Take me there to a floor no lift goes to = "No lift goes to Floor 1: this route needs the stairs" with "Use the
// stairs this time" (that walk by the stairs, never a silent fallback), a floor the lift goes to = by the lift, the
// card's own switch, the tour planned again without what no lift reaches, a one-floor layout = no switch.
// Studio's Check (a floor with no lift stop + Fix it) is in e2e:lifts, the embed's option in e2e:embed.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev                 (in one terminal)
//                   npm run e2e:avoid-stairs    (in another)
// SHOTS=<dir>: screenshots. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const SHOTS = process.env.SHOTS ?? '';
const shotDir = SHOTS || 'e2e/screens';
mkdirSync(shotDir, { recursive: true });
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

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const shot = (name) => SHOTS ? page.screenshot({ path: join(shotDir, name), timeout: 120000 }) : null;
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusViewer.scene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 60000);
}), n);

// Three floors: a hall each; stairs from the ground floor to Floor 1 only; a lift at the ground floor and Floor 2 (not Floor 1)
const floorsOf = (n) => Array.from({ length: n }, (_, id) => ({ id, name: id ? `Floor ${id}` : 'Ground Floor', height: 3.5 }));
const hall = (floor) => ({
  id: `hall${floor}`, type: 'OFFICE', name: floor ? `Hall ${floor}` : 'Hall', floor, x: 0, z: 0, width: 24, depth: 16, wallHeight: 3.2, wallThickness: 0.15,
  doors: floor ? [] : [{ wall: 'south', offset: 0, width: 1.2, height: 2.1 }], windows: [],
  ...(floor ? { departmentRef: floor === 1 ? 'Sales' : 'Design' } : {}), // the tour stops at departments
});
const shaft = (floor) => ({
  id: `lift${floor}`, type: 'LIFT', name: 'Lift', floor, x: 8, z: 4, width: 2.2, depth: 2.2, wallHeight: 3.2, wallThickness: 0.15,
  doors: [{ wall: 'south', offset: 0, width: 1.1, height: 2.1 }], windows: [],
});
const stair = { id: 's1', assetType: 'STAIRCASE', floor: 0, x: -6, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false };
const layout = {
  layoutName: 'Avoid stairs test', floors: floorsOf(3), anchorData: {},
  rooms: [hall(0), hall(1), hall(2), shaft(0), shaft(2)], objects: [stair],
};
const oneFloor = { layoutName: 'One floor', floors: floorsOf(1), anchorData: {}, rooms: [hall(0)], objects: [] };

const open = (l) => page.evaluate(async (l) => {
  const e = window.__ahdusViewer;
  await e.whenBuilt();
  e.loadLayout(l);
  await e.whenBuilt();
  await e.whenNavigationReady();
}, l);
const SEARCH = '[aria-label="Find a person, room or place"]';
const find = async (text) => {
  if (!(await page.locator('[data-place-search] input').isVisible().catch(() => false))) await page.click(`button${SEARCH}`);
  await page.fill('[data-place-search] input', text);
  await page.waitForSelector('[data-place-search] [role="option"][data-place]', { timeout: 30000 });
};
const more = async () => { await page.click('[data-viewer-more]'); await page.waitForSelector('[data-more-menu]', { timeout: 10000 }); };
const closeMore = async () => { if (await page.locator('[data-more-menu]').count()) await page.keyboard.press('Escape'); };
const stored = () => page.evaluate(() => localStorage.getItem('ahdus.avoidStairs'));
const going = () => page.waitForFunction(() => document.querySelector('[data-nav-strip]')?.getAttribute('data-nav-strip'), null, { timeout: 60000 })
  .then((h) => h.jsonValue()).catch(() => null);

try {
  await page.goto(new URL('viewer.html?mode=view&weak=0', base).href);
  await page.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('ahdus.avoidStairs'));
  await open(layout);
  await page.evaluate((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await frames(3);

  // ── 1. More's switch, remembered ──
  await more();
  const item = await page.evaluate(() => {
    const el = document.querySelector('[data-more-item="avoid-stairs"]');
    return el && { state: el.getAttribute('data-avoid-stairs'), role: el.getAttribute('role'), checked: el.getAttribute('aria-checked'), text: el.innerText.replace(/\s+/g, ' ') };
  });
  log('More: "Avoid stairs (use lifts)" (a menuitemcheckbox), off at first', item?.state === 'off' && item.role === 'menuitemcheckbox' && item.checked === 'false'
    && /Avoid stairs \(use lifts\)/.test(item.text), JSON.stringify(item));
  await shot('more-avoid-stairs-off.png');
  await page.click('[data-more-item="avoid-stairs"]');
  await frames(2);
  const on = await page.evaluate(() => ({ attr: document.querySelector('[data-more-item="avoid-stairs"]')?.getAttribute('data-avoid-stairs'),
    engine: window.__ahdusViewer.navigation.avoidStairs }));
  log('  a click turns it on (the engine too), kept in this browser', on.attr === 'on' && on.engine === true && (await stored()) === '1', JSON.stringify(on));
  await shot('more-avoid-stairs-on.png');
  await closeMore();
  await page.reload();
  await page.waitForFunction(() => window.__ahdusViewer, null, { timeout: 120000 });
  await open(layout);
  await page.evaluate((s) => window.__ahdusViewer.scene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2);
  await frames(3);
  await more();
  const kept = await page.evaluate(() => ({ attr: document.querySelector('[data-more-item="avoid-stairs"]')?.getAttribute('data-avoid-stairs'),
    engine: window.__ahdusViewer.navigation.avoidStairs }));
  log('  after a reload it is still on', kept.attr === 'on' && kept.engine === true, JSON.stringify(kept));
  await closeMore();

  // ── 2. Find: "Stairs only" on Hall 1 (no lift goes to Floor 1), not on Hall 2 ──
  await find('Hall');
  const notes = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-place-search] [role="option"][data-place]')]
    .map((o) => [o.getAttribute('data-place'), !!o.querySelector('[data-stairs-only]')])));
  log('Find: "Stairs only" on Hall 1 (no lift stops there), none on Hall 2 or the Hall', notes['room:hall1'] === true && notes['room:hall2'] === false && notes['room:hall0'] === false,
    JSON.stringify(notes));
  await shot('find-stairs-only.png');

  // ── 3. Take me there to Hall 1: said plainly, with "Use the stairs this time" ──
  await page.click('[data-place-search] [data-place="room:hall1"]');
  await page.waitForSelector('[data-place-shown]', { timeout: 30000 });
  const card = await page.evaluate(() => {
    const sw = document.querySelector('[data-place-shown] [data-avoid-stairs]');
    return { switch: sw?.getAttribute('data-avoid-stairs'), role: sw?.getAttribute('role'), text: sw?.textContent };
  });
  log('the card: its own "Avoid stairs (use lifts)" switch, on', card.switch === 'on' && card.role === 'switch' && /Avoid stairs \(use lifts\)/.test(card.text ?? ''), JSON.stringify(card));
  await shot('card-avoid-stairs.png');
  await page.click('[data-place-shown] [data-route="auto"]');
  const failed = await page.waitForFunction(() => {
    const s = document.querySelector('[data-nav-strip="failed"]');
    return s && { problem: s.querySelector('[data-nav-problem]')?.textContent, button: s.querySelector('[data-use-stairs]')?.textContent };
  }, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  const stillThere = await page.evaluate(() => ({ walking: !!window.__ahdusViewer.navigation.walking, mode: window.__ahdusViewer.mode }));
  log('Take me there: "No lift goes to Floor 1: this route needs the stairs" + "Use the stairs this time"; no walk started',
    failed?.problem === 'No lift goes to Floor 1: this route needs the stairs' && failed.button === 'Use the stairs this time' && !stillThere.walking,
    JSON.stringify({ failed, stillThere }));
  await shot('needs-stairs.png');
  await page.click('[data-nav-strip="failed"] [data-use-stairs]');
  const started = await going();
  const walk = await page.evaluate(() => {
    const w = window.__ahdusViewer.navigation.walking;
    return w && { place: w.place?.name, stairs: !!w.stairs, avoid: window.__ahdusViewer.navigation.avoidStairs };
  });
  log('  "Use the stairs this time": the walk starts (by the stairs), the option stays on', ['started', 'progress'].includes(started) && walk?.place === 'Hall 1'
    && walk.avoid === true, `${started} ${JSON.stringify(walk)}`);
  await shot('use-stairs-this-time.png');
  await page.click('[data-nav-stop]').catch(() => {});
  await frames(2);

  // ── 4. Hall 2: by the lift ──
  await page.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: 0, z: -6, yaw: 0, pitch: -0.1, floor: 0, fly: false }));
  await frames(3);
  const byLift = await page.evaluate(() => window.__ahdusViewer.navigation.show('room:hall2')?.route ?? null);
  log('Hall 2 (the lift stops there): the route goes by the lift', byLift?.by === 'lift', JSON.stringify(byLift));

  // ── 5. The tour: planned again, nothing on Floor 1 ──
  const tour = await page.evaluate(async () => {
    const n = window.__ahdusViewer.navigation;
    for (let i = 0; i < 600 && !n.tourPlanReady; i++) await new Promise((r) => setTimeout(r, 100));
    const p = n.tourPlanReady;
    return p && { floors: [...new Set(p.stops.map((s) => s.floor))], skipped: p.skipped.map((s) => `${s.name}: ${s.message ?? s.problem}`) };
  });
  log('the tour: Floor 2 by the lift, nothing on Floor 1 (no lift goes there: skipped, saying why)', !!tour && tour.floors.includes(2) && !tour.floors.includes(1)
    && tour.skipped.some((s) => /Hall 1.*stairs/.test(s)), JSON.stringify(tour));

  // ── 6. The card's switch turns it off: the card again with the stairs ──
  await find('Hall 1');
  await page.click('[data-place-search] [data-place="room:hall1"]');
  await page.waitForSelector('[data-place-shown]', { timeout: 30000 });
  const before = await page.evaluate(() => ({ walk: document.querySelector('[data-place-shown] [data-walk]')?.textContent, use: !!document.querySelector('[data-place-shown] [data-use-stairs]') }));
  await page.click('[data-place-shown] [data-avoid-stairs]');
  await frames(2);
  const after = await page.evaluate(() => ({
    switch: document.querySelector('[data-place-shown] [data-avoid-stairs]')?.getAttribute('data-avoid-stairs'),
    walk: document.querySelector('[data-place-shown] [data-walk]')?.textContent,
    take: !!document.querySelector('[data-place-shown] [data-route="auto"]'),
    engine: window.__ahdusViewer.navigation.avoidStairs,
  }));
  log('walking, the card says it plainly with "Use the stairs this time"; its switch off = the walk by the stairs, Take me there back',
    /No lift goes to Floor 1/.test(before.walk ?? '') && before.use && after.switch === 'off' && /by the stairs/.test(after.walk ?? '') && after.take
    && after.engine === false && (await stored()) === null, JSON.stringify({ before, after }));
  await shot('card-avoid-stairs-off.png');
  await more();
  const menuOff = await page.evaluate(() => document.querySelector('[data-more-item="avoid-stairs"]')?.getAttribute('data-avoid-stairs'));
  log('  More shows it off too', menuOff === 'off', String(menuOff));
  await closeMore();

  // ── 7. One floor: nothing to avoid, no switch ──
  await open(oneFloor);
  await frames(3);
  await more();
  const none = await page.locator('[data-more-item="avoid-stairs"]').count();
  log('a one-floor layout: no "Avoid stairs" in More', none === 0, `${none}`);
  await closeMore();
} catch (e) {
  log('ran to the end', false, String(e?.message ?? e).slice(0, 300));
}
await page.evaluate(() => localStorage.removeItem('ahdus.avoidStairs')).catch(() => {});
await b.close();
