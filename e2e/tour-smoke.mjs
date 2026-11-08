// Tour smoke test (v0.14.4): the company tour in viewer.html.
// Find's "Take the company tour · N stops · about M min" (every count the same as the plan's), the Tour
// button, the panel ("Stop 1 of N · Main entrance", from the view from above: at the entrance), Pause / P,
// Next, Previous (a fade), Exit; "Walk me" reaches stop 3 (the room outlined, the card's title), a movement
// key pauses it and P walks on; "I'll walk" (the line; arriving there yourself completes the stop); "Skip the
// walk" (a fade); the stop list's ticks after a reload and Restart; narration off by default; a phone
// (390 × 844, touch): the panel fits above the joystick, touch words.
//
// The layout: the Meridian-shaped test layout of the unit tests (src/play/navigation/__tests__/meridianLike.js,
// with its 13 departments), or the real Meridian with MERIDIAN=<layout.json> MERIDIAN_PEOPLE=<people.json> (not
// in git). SHOTS=<dir>: desktop 1440×900 + phone 390×844 screenshots and a short recording.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev          (in one terminal)
//                   npm run e2e:tour     (in another, alone: it is heavy)
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { meridianWithPeople } from '../src/play/navigation/__tests__/meridianLike.js';

const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
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

// ── The layout and who sits where (only what setPeople takes: never an email) ──
let layout;
let people;
const only = ({ personId, deskId, name, department }) => ({ personId, deskId, name, department });
if (process.env.MERIDIAN) {
  layout = JSON.parse(readFileSync(process.env.MERIDIAN, 'utf8'));
  people = JSON.parse(readFileSync(process.env.MERIDIAN_PEOPLE, 'utf8')).map(only);
} else {
  const m = meridianWithPeople();
  layout = { layoutName: 'Meridian-shaped test layout', ...m.layout };
  people = m.people.map(only);
}
const MERIDIAN = process.env.MERIDIAN ? 'Meridian' : 'the Meridian-shaped layout';

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args });
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  ...(SHOTS ? { recordVideo: { dir: join(shotDir, 'video'), size: { width: 1440, height: 900 } } } : {}),
});
let p = await ctx.newPage();
const watchErrors = (page, tag = '') => {
  page.on('pageerror', (e) => errs.push(tag + 'pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(tag + m.text()); });
};
watchErrors(p);
const shot = (name, page = p) => (SHOTS ? page.screenshot({ path: join(shotDir, `tour-${name}.png`) }) : null);

/** Open the viewer from above with this layout and these people; the walk maps and the tour planned in idle time. */
async function open(page) {
  await page.goto(base + 'viewer.html?mode=view', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ahdusViewer && window.__ahdusSetPeople, null, { timeout: 120000 });
  await page.evaluate(async ({ layout, people }) => {
    const e = window.__ahdusViewer;
    await e.whenBuilt();
    e.loadLayout(layout);
    window.__ahdusSetPeople(people);
    await e.whenBuilt();
    await e.whenNavigationReady();
    // every tour event, and whether the fade showed
    window.__tourEvents = [];
    e.on('tour', (ev) => window.__tourEvents.push({ type: ev.type, state: ev.state, index: ev.index, follow: ev.follow }));
    window.__faded = 0;
    new MutationObserver(() => { if (document.querySelector('[data-tour-fade="on"]')) window.__faded += 1; })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-tour-fade'] });
  }, { layout, people });
}
const status = (page = p) => page.evaluate(() => {
  const e = window.__ahdusViewer;
  const s = e.tour.status;
  const w = e.walkthrough;
  const pos = w?.isActive() ? w.getPosition() : null;
  return {
    state: s.state, index: s.index, count: s.count, follow: s.follow, visited: [...s.visited], stop: s.stop?.name ?? null,
    kind: s.stop?.kind ?? null, roomIds: s.stop?.rooms?.map((r) => r.id) ?? [], mode: e.mode,
    at: pos ? { x: pos.x, z: pos.z, floor: w.getLevel() } : null,
    nav: e.navigation.walking ? { walk: e.navigation.walking.walk, paused: e.navigation.walking.paused } : null,
    highlights: e.highlights.ids(),
  };
});
const waitTour = (test, arg, ms = 300000, page = p) => page.waitForFunction(test, arg, { timeout: ms, polling: 250 });
const panelText = async (sel, page = p) => ((await page.textContent(sel).catch(() => '')) ?? '').trim();

await open(p);
const plan = await p.evaluate(() => {
  const pl = window.__ahdusViewer.navigation.tourPlanReady;
  return pl && { count: pl.stops.length, minutes: pl.minutes, first: pl.stops[0].text, kinds: pl.stops.map((s) => s.kind), skipped: pl.skipped.length };
});
log(`${MERIDIAN}: the tour is planned in idle time after the walk maps`, !!plan && plan.count > 5,
  plan ? `${plan.count} stops, about ${plan.minutes} min, ${plan.skipped} skipped` : 'no plan');

// ── 1. Find's entry, every count the same ──
await p.click('[data-place-search-button]');
await p.waitForSelector('[data-tour-offer]', { timeout: 20000 });
const offer = await panelText('[data-tour-offer]');
const firstOption = await p.$eval('[data-place-search] [role="option"]', (el) => el.hasAttribute('data-tour-offer'));
log('Find\'s menu starts with "Take the company tour · N stops · about M min"', firstOption
  && offer.includes('Take the company tour') && offer.includes(`${plan.count} stops · about ${plan.minutes} min`), offer.replace(/\s+/g, ' '));
log('stop 1 says the same count ("The tour: N stops")', plan.first.includes(`The tour: ${plan.count} stops`), plan.first);
await shot('find-desktop');

// ── 2. From above: the tour starts at the main entrance ──
await p.click('[data-tour-offer]');
await p.waitForSelector('[data-tour-panel]', { timeout: 60000 });
let s = await status();
const spawn = await p.evaluate(async () => {
  const { entranceSpawn } = await import('/src/play/navigation/entrance.js');
  const e = window.__ahdusViewer;
  return entranceSpawn(e.getStore().getState(), { maps: e.navigation.walkMaps });
});
const fromSpawn = s.at ? Math.hypot(s.at.x - spawn.x, s.at.z - spawn.z) : Infinity;
const title = await panelText('[data-tour-title]');
log('from above, the tour starts walking at the main entrance: "Stop 1 of N · Main entrance"', s.mode === 'walkthrough'
  && s.state === 'stop' && s.index === 0 && s.kind === 'entrance' && fromSpawn < 1.5 && title === `Stop 1 of ${plan.count} · Main entrance`,
  `${title}; ${fromSpawn.toFixed(2)} m from the spawn`);
const text1 = await panelText('[data-tour-text]');
const dirs1 = await panelText('[data-tour-directions]');
log('the panel: the stop\'s text and the next leg\'s directions', text1.includes(`The tour: ${plan.count} stops`) && dirs1.length > 10,
  `${text1.slice(0, 60)} | ${dirs1.slice(0, 80)}`);
const speaker = await p.getAttribute('[data-tour-speak]', 'aria-pressed');
await p.click('[data-tour-speak]');
const speakerOn = await p.getAttribute('[data-tour-speak]', 'aria-pressed');
await p.click('[data-tour-speak]');
log('narration is off by default; the speaker button turns it on and off', speaker === 'false' && speakerOn === 'true',
  `${speaker} → ${speakerOn}`);
const tourBtn = await p.getAttribute('[data-tour-button]', 'aria-pressed');
log('the Tour button is in the view\'s buttons, pressed while the tour runs', tourBtn === 'true', `aria-pressed ${tourBtn}`);
await shot('start-desktop');

// ── 3. Pause / P, Next, Previous, Exit ──
await p.click('[data-tour-pause]');
await p.waitForTimeout(150); // the view takes the keys back after a click on its buttons
s = await status();
const pausedLine = await panelText('[data-tour-state]');
await p.keyboard.press('KeyP');
const afterP = await status();
log('Pause pauses (the countdown stops); P resumes', s.state === 'paused' && pausedLine.includes('Press P') && afterP.state === 'stop',
  `${s.state} "${pausedLine}" → ${afterP.state}`);
await p.click('[data-tour-next]');
s = await status();
log('Next: on the way to stop 2 ("Walk me": the walker is driven)', s.state === 'walking' && s.index === 1 && s.nav?.walk === 'auto',
  `${s.state} ${s.index} ${s.nav?.walk}`);
const fades0 = await p.evaluate(() => window.__faded);
await p.click('[data-tour-previous]');
await waitTour(() => window.__ahdusViewer.tour.status.state === 'stop' && window.__ahdusViewer.tour.status.index === 0, null, 30000);
s = await status();
const faded = (await p.evaluate(() => window.__faded)) > fades0;
log('Previous: back at stop 1 with a fade', s.index === 0 && faded && Math.hypot(s.at.x - spawn.x, s.at.z - spawn.z) < 1.5, `faded ${faded}`);
await p.click('[data-tour-exit]');
await p.waitForSelector('[data-tour-panel]', { state: 'detached', timeout: 10000 });
s = await status();
log('Exit: the tour ends where you are, still walking (free walking)', s.state === 'idle' && s.mode === 'walkthrough' && !s.nav,
  `${s.state}, ${s.mode}`);

// ── 4. "Walk me" reaches stop 3 (short pauses: the stops' time is game time) ──
await p.evaluate(() => { window.__ahdusViewer.tour.start({ follow: 'auto', pauseScale: 0.05 }); });
await waitTour(() => { const t = window.__ahdusViewer.tour.status; return t.index >= 2 && t.state === 'stop'; }, null, 400000);
s = await status();
const title3 = await panelText('[data-tour-title]');
const arrived = await p.evaluate(() => window.__tourEvents.filter((e) => e.type === 'arrived').map((e) => e.index));
log('"Walk me" walks from the entrance to stop 3 by itself', s.index === 2 && arrived.includes(1) && arrived.includes(2),
  `${title3}; arrived at ${arrived.join(', ')}`);
log('at the stop: its room outlined, the card "Stop 3 of N · …"', s.roomIds.length > 0 && s.roomIds.every((id) => s.highlights.includes(id))
  && title3 === `Stop 3 of ${plan.count} · ${s.stop}`, `${s.highlights.length} outlined`);
await shot('stop3-desktop');

// a movement key pauses "Walk me", P walks on
await waitTour(() => window.__ahdusViewer.tour.status.state === 'walking', null, 60000);
await p.keyboard.down('KeyW');
await waitTour(() => window.__ahdusViewer.tour.status.state === 'paused', null, 30000).catch(() => {});
await p.keyboard.up('KeyW');
const paused = await status();
await p.keyboard.press('KeyP');
await p.waitForTimeout(400);
const walkingOn = await status();
log('a movement key pauses "Walk me" (as G\'s pause); P walks on', paused.state === 'paused' && paused.nav?.paused === true
  && walkingOn.state === 'walking' && walkingOn.nav?.paused === false, `${paused.state} → ${walkingOn.state}`);

// ── 5. "I'll walk": the line; getting there yourself completes the stop (the tour again, the usual pauses) ──
await p.evaluate(() => { window.__ahdusViewer.tour.start({ follow: 'auto' }); });
await waitTour(() => { const t = window.__ahdusViewer.tour.status; return t.index === 0 && t.state === 'stop'; }, null, 30000);
await p.click('[data-tour-next]');
await p.click('[data-tour-mode="self"]');
s = await status();
const line = await p.evaluate(() => window.__ahdusScene.meshes.filter((m) => m.metadata?.routeLine && m.isEnabled())
  .map((m) => m.thinInstanceCount).reduce((a, n) => a + n, 0));
log('"I\'ll walk": the same route as a line, nobody drives', s.follow === 'self' && s.nav?.walk === 'guide' && line > 0,
  `${s.follow}, ${s.nav?.walk}, ${line} marks`);
await shot('self-desktop');
const target = s.index;
await p.evaluate((i) => {
  const e = window.__ahdusViewer;
  const spot = e.tour.status.plan.stops[i].spot;
  e.walkthrough.setPose({ x: spot.x, z: spot.z, floor: spot.floor });
}, target);
await waitTour((i) => { const t = window.__ahdusViewer.tour.status; return t.index === i && t.state === 'stop'; }, target, 60000);
s = await status();
log('"I\'ll walk": arriving completes the stop (ticked)', s.index === target && s.visited.length >= target + 1, `stop ${s.index + 1}`);

// ── 6. Skip the walk: a fade to the next stop ──
await p.click('[data-tour-mode="auto"]');
await p.click('[data-tour-next]'); // on the way to the next stop
const fades1 = await p.evaluate(() => window.__faded);
const goingTo = (await status()).index;
await p.click('[data-tour-skip]');
await waitTour((i) => { const t = window.__ahdusViewer.tour.status; return t.index === i && t.state === 'stop'; }, goingTo, 30000);
s = await status();
const spot = await p.evaluate((i) => window.__ahdusViewer.tour.status.plan.stops[i].spot, goingTo);
log('"Skip the walk": there at once, with a fade', (await p.evaluate(() => window.__faded)) > fades1
  && Math.hypot(s.at.x - spot.x, s.at.z - spot.z) < 1.2 && s.at.floor === spot.floor, `stop ${s.index + 1}: ${s.stop}`);

// ── 7. The stop list's ticks, kept after a reload; Restart ──
await p.click('[data-tour-list-toggle]');
const ticks = await p.$$eval('[data-tour-stop-item][data-visited]', (els) => els.length);
s = await status();
log('the stop list ticks the visited stops', ticks === s.visited.length && ticks >= 3, `${ticks} of ${plan.count}`);
await shot('list-desktop');
const stored = await p.evaluate(() => localStorage.getItem('ahdus.tourVisited'));
await p.keyboard.press('Escape');
await p.waitForSelector('[data-tour-panel]', { state: 'detached', timeout: 10000 });
log('Esc ends the tour', (await status()).state === 'idle');

if (SHOTS) {
  const video = p.video();
  await p.close();
  // saveAs waits until the file is written (a rename right away fails on Windows: the file is still open)
  if (video) { await video.saveAs(join(shotDir, 'tour-desktop.webm')); await video.delete(); }
  p = await ctx.newPage();
  watchErrors(p);
}
await open(p);
await p.click('[data-place-search-button]');
await p.waitForSelector('[data-tour-offer]', { timeout: 20000 });
const offer2 = await panelText('[data-tour-offer-detail]');
log('after a reload, Find says how many stops were visited', offer2.includes(`${ticks} visited`), `${offer2} (stored: ${stored ? 'yes' : 'no'})`);
await p.keyboard.press('Escape');
await p.click('[data-tour-button]');
await p.waitForSelector('[data-tour-panel]', { timeout: 60000 });
await p.click('[data-tour-list-toggle]');
const ticks2 = await p.$$eval('[data-tour-stop-item][data-visited]', (els) => els.length);
log('after a reload, the stop list keeps its ticks', ticks2 === ticks, `${ticks2}`);
await p.click('[data-tour-list] [data-tour-restart]');
await p.waitForTimeout(500);
const ticks3 = await p.$$eval('[data-tour-stop-item][data-visited]', (els) => els.length).catch(() => -1);
s = await status();
log('Restart: from stop 1 again, only it ticked', s.index === 0 && s.visited.length === 1 && (ticks3 === 1 || ticks3 === -1), `${ticks3}`);
await p.click('[data-tour-exit]');
await ctx.close();

// ── 8. A phone (390 × 844, touch): the panel fits above the joystick, touch words ──
const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const ph = await phoneCtx.newPage();
watchErrors(ph, 'phone ');
await open(ph);
// viewer.html gives the view only part of a phone (its bridge-events panel): hide it, as e2e:touch does
await ph.evaluate(() => { const a = document.querySelector('aside'); if (a) a.style.display = 'none'; window.dispatchEvent(new Event('resize')); });
await ph.waitForTimeout(500);
await ph.tap('[data-tour-button]');
await ph.waitForSelector('[data-tour-panel]', { timeout: 60000 });
await ph.waitForTimeout(800);
const fit = await ph.evaluate(() => {
  const r = document.querySelector('[data-tour-panel]').getBoundingClientRect();
  const j = document.querySelector('[data-touch-joystick]')?.getBoundingClientRect();
  return { left: r.left, right: r.right, bottom: r.bottom, top: r.top, joyTop: j ? j.top : null, narrow: document.querySelector('[data-tour-panel]').hasAttribute('data-tour-narrow'), hint: !!document.querySelector('[data-walk-hint]') };
});
const touchLine = await panelText('[data-tour-state]', ph);
log('a phone: the panel fits 390 px, above the joystick (the one-time hint waits: it would be under the panel)', !fit.hint && fit.narrow && fit.left >= 0 && fit.right <= 390 && fit.joyTop !== null
  && fit.bottom <= fit.joyTop, `${Math.round(fit.left)}–${Math.round(fit.right)} px, bottom ${Math.round(fit.bottom)}, joystick ${Math.round(fit.joyTop)}`);
await shot('start-phone', ph);
await ph.tap('[data-tour-pause]');
const touchPaused = await panelText('[data-tour-state]', ph);
const keysLine = await ph.$('[data-tour-panel] [data-tour-keys]');
log('a phone: touch words ("Tap Resume to go on"), no keys line', touchPaused.includes('Tap Resume') && !keysLine
  && !(await panelText('[data-tour-panel]', ph)).includes('Esc ends'), `"${touchLine}" → "${touchPaused}"`);
await ph.tap('[data-tour-pause]');
await ph.tap('[data-tour-next]');
await ph.waitForTimeout(1500);
await shot('walking-phone', ph);
await ph.tap('[data-tour-list-toggle]');
await shot('list-phone', ph);
await phoneCtx.close();
await b.close();
