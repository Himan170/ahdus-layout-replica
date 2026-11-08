// Start mode smoke test (v0.14.6, private-docs/EXPERIENCE_PLAN.md 3.1): viewer.html with ?start=walk. Walking is the
// default, from the main entrance, with the welcome card ("Welcome to Sample company · Start the tour · Explore ·
// Find someone"); the keys work at once (W walks and closes it), Esc / Explore close it, Find someone opens Find,
// Start the tour starts the tour. The Overview button (top right) shows the floor from above and keeps your place;
// Walk takes you back there. The last choice is remembered (per browser). A weak device (&weak=1, and SwiftShader
// itself when not told) starts in Overview with a Walk button. A page opened at a person (&at=) shows no card.
// Without ?start the viewer is as before (no card, no button). Phone (390 × 844): the card at the bottom, on screen.
// v0.14.7: a short view box (390 × 490, as AHDUS's 3D Company page gives a phone; and 1000 × 400) gets the compact
// card: the toolbar row and Overview stay visible and clickable, all three actions show with no scrolling, the
// joystick and the HUD line stay clear.
// v0.14.8: a weak device's note says why it started from above (software WebGL / quality low); "Stay above", Esc and a
// click on the view close it (not remembered); "Walk anyway" walks from the entrance with the welcome card and is
// remembered (the next visit walks); Overview chosen later wins again; the note compact in a 390 × 490 phone box.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev              (in one terminal)
//                   npm run e2e:welcome      (in another)
// SHOTS=<dir>: screenshots (desktop 1440 × 900, phone 390 × 844, short boxes 390 × 490 / 1000 × 400) into <dir>.
// Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
const SHOTS = process.env.SHOTS;
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
const desktop = SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 720 };
let ctx = await b.newContext({ viewport: desktop });
let p;
const hideAside = () => p.addStyleTag({ content: 'aside[aria-label="Bridge events"] { display: none !important; }' });

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const pos = () => p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: +v.x.toFixed(3), z: +v.z.toFixed(3) }; });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function hold(key, n = 4) {
  const from = await pos();
  await p.keyboard.down(key); await frames(n); await p.keyboard.up(key); await frames(1);
  return distance(from, await pos());
}
const viewerMode = () => p.getAttribute('[data-layout-viewer]', 'data-layout-viewer');
const modeButton = () => p.getAttribute('[data-mode-button]', 'data-mode-button', { timeout: 5000 }).catch(() => null);
const card = () => p.locator('[data-welcome]').count();
const shot = (name) => p.screenshot({ path: join(shotDir, name) });

/** Open viewer.html with these params; waits for the engine and the start floor. */
async function open(query, { clear = false, box = null } = {}) {
  if (!p) {
    p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
  }
  await p.goto(new URL(`viewer.html?${query}`, base).href);
  if (clear) {
    await p.evaluate(() => { try { localStorage.removeItem('ahdus.viewMode'); } catch { /* blocked */ } });
    await p.reload();
  }
  await hideAside();
  // a short box (v0.14.7): the viewer this size, whatever the window's
  if (box) {
    await p.addStyleTag({ content: `[data-layout-viewer] { flex: none !important; width: ${box.width}px !important; height: ${box.height}px !important; align-self: flex-start; }` });
  }
  await p.waitForFunction(() => window.__ahdusViewer && window.__ahdusScene, null, { timeout: 120000 });
  await p.evaluate(() => window.__ahdusViewer.whenBuilt());
  await p.waitForFunction(() => !document.querySelector('[data-build-progress="start"]'), null, { timeout: 120000 });
  await frames(2);
}

try {
  // ── 1. walking by default, the welcome card; keys at once ──
  await open('start=walk&weak=0&people=1', { clear: true });
  const m1 = await viewerMode();
  await p.waitForSelector('[data-welcome]', { timeout: 30000 }).catch(() => {});
  const title = await p.locator('[data-welcome-title]').textContent({ timeout: 5000 }).catch(() => '');
  const actions = await p.$$eval('[data-welcome-action]', (els) => els.map((e) => e.dataset.welcomeAction));
  log('?start=walk: walking at the entrance, the welcome card "Welcome to Sample company" (tour, explore, find)',
    m1 === 'walkthrough' && title === 'Welcome to Sample company' && actions.join() === 'tour,explore,find', JSON.stringify({ m1, title, actions }));
  const noHint = await p.locator('[data-walk-hint]').count();
  log('the one-time walk hint waits while the card shows', noHint === 0, `hints: ${noHint}`);
  log('the Overview button at the top right while walking', await modeButton() === 'overview'
    && await p.evaluate(() => { const r = document.querySelector('[data-mode-button]').getBoundingClientRect(); const v = document.querySelector('[data-layout-viewer]').getBoundingClientRect(); return v.right - r.right < 20 && r.top - v.top < 20; }));
  if (SHOTS) await shot('welcome-desktop.png');
  await p.mouse.move(desktop.width / 3, 150); // over the view (the sky), no click
  const walked = await hold('KeyW', 6);
  log('W walks with no click, and closes the card (= Explore)', walked > 0.2 && await card() === 0, `walked ${walked.toFixed(2)} m, card ${await card()}`);
  const hintAfter = await p.waitForSelector('[data-walk-hint]', { timeout: 15000 }).then(() => true, () => false);
  log('…then the one-time hint shows', hintAfter);

  // ── 2. Explore, Esc ──
  await open('start=walk&weak=0&people=1');
  await p.waitForSelector('[data-welcome]', { timeout: 30000 });
  await p.click('[data-welcome-action="explore"]');
  await frames(2);
  const exploreWalk = await hold('KeyW', 5);
  log('Explore: the card closes, the keys are the view\'s', await card() === 0 && exploreWalk > 0.2, `walked ${exploreWalk.toFixed(2)} m`);
  await open('start=walk&weak=0&people=1');
  await p.waitForSelector('[data-welcome]', { timeout: 30000 });
  await p.keyboard.press('Escape');
  await frames(2);
  const escWalk = await hold('KeyW', 5);
  log('Esc closes the card, and the keys stay the view\'s', await card() === 0 && escWalk > 0.2, `walked ${escWalk.toFixed(2)} m`);

  // ── 3. Find someone, Start the tour ──
  await open('start=walk&weak=0&people=1');
  await p.waitForSelector('[data-welcome]', { timeout: 30000 });
  await p.click('[data-welcome-action="find"]');
  await p.waitForSelector('[data-place-search]', { timeout: 10000 }).catch(() => {});
  const findFocus = await p.evaluate(() => document.activeElement?.closest?.('[data-place-search]') !== null && document.activeElement?.tagName === 'INPUT');
  log('Find someone: the card closes, Find opens with the box focused', await card() === 0 && findFocus);
  await p.keyboard.type('Asha');
  const found = await p.locator('[data-place-search] [role="option"]', { hasText: 'Asha Patel' }).count();
  log('…and finds Asha Patel', found > 0);
  await open('start=walk&weak=0&people=1');
  await p.waitForSelector('[data-welcome]', { timeout: 30000 });
  await p.waitForFunction(() => /stops/.test(document.querySelector('[data-welcome-action="tour"]')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
  const tourText = await p.locator('[data-welcome-action="tour"]').textContent();
  await p.click('[data-welcome-action="tour"]');
  const tourPanel = await p.waitForSelector('[data-tour-panel]', { timeout: 30000 }).then(() => true, () => false);
  const tourTop = await p.evaluate(() => {
    const t = document.querySelector('[data-tour-panel]')?.getBoundingClientRect();
    const m = document.querySelector('[data-mode-button]')?.getBoundingClientRect();
    return t && m ? Math.round(t.top - m.bottom) : null;
  });
  log('Start the tour (with its size: "5 stops · about 1 min": with people, Engineering is a stop, v0.14.9): the tour starts, its panel under the Overview button',
    /stops · about \d+ min/.test(tourText) && tourPanel && await card() === 0 && tourTop !== null && tourTop >= 0, `${tourText} · gap ${tourTop}px`);
  await p.click('[data-tour-exit]').catch(() => {});

  // ── 4. Overview keeps your place; Walk takes you back ──
  await open('start=walk&weak=0&people=1');
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.__ahdusViewer.walkthrough.setPose({ x: 12, z: 1, yaw: 1.2, pitch: -0.1, floor: 0 }));
  await frames(3);
  const here = await pos();
  if (SHOTS) await shot('overview-button-walking.png');
  await p.click('[data-mode-button]');
  await frames(4);
  const over = await p.evaluate(() => {
    const e = window.__ahdusViewer;
    const c = e.scene.activeCamera;
    return { mode: e.mode, x: c.target.x, z: c.target.z, stored: localStorage.getItem('ahdus.viewMode') };
  });
  log('Overview: from above, looking at where you stood, remembered', over.mode === 'view' && await modeButton() === 'walk'
    && Math.hypot(over.x - here.x, over.z - here.z) < 1 && over.stored === 'view', JSON.stringify(over));
  if (SHOTS) await shot('overview-button-from-above.png');
  await p.click('[data-mode-button]');
  await frames(4);
  const back = await pos();
  const backYaw = await p.evaluate(() => window.__ahdusViewer.walkthrough.getYaw());
  log('Walk: back where you were, facing the same way (no card)', await viewerMode() === 'walkthrough'
    && distance(back, here) < 0.3 && Math.abs(backYaw - 1.2) < 0.05 && await card() === 0, JSON.stringify({ here, back, backYaw }));
  const walkKeys = await hold('KeyW', 4);
  log('…and the keys walk at once after the button', walkKeys > 0.2, `${walkKeys.toFixed(2)} m`);

  // ── 5. the last choice, remembered ──
  await p.click('[data-mode-button]'); // Overview again: remembered 'view'
  await frames(2);
  await open('start=walk&weak=0&people=1');
  log('opened again after Overview: from above, no card, a Walk button', await viewerMode() === 'view' && await card() === 0
    && await modeButton() === 'walk');
  await p.click('[data-mode-button]');
  await frames(4);
  const spawn = await p.evaluate(() => {
    const e = window.__ahdusViewer; const s = e.walkthrough.spawnPoint?.() ?? null; const v = e.walkthrough.getPosition();
    return { at: { x: v.x, z: v.z }, s };
  });
  log('Walk with no place kept: at the entrance', await viewerMode() === 'walkthrough'
    && (!spawn.s || Math.hypot(spawn.at.x - spawn.s.x, spawn.at.z - spawn.s.z) < 0.5), JSON.stringify(spawn));
  await open('start=walk&weak=0&people=1');
  log('opened again after Walk: walking, with the card', await viewerMode() === 'walkthrough'
    && await p.waitForSelector('[data-welcome]', { timeout: 30000 }).then(() => true, () => false));

  // ── 6. weak devices ──
  await open('start=walk&weak=1&people=1', { clear: true });
  const weakTitle = await p.getAttribute('[data-mode-button]', 'title').catch(() => '');
  log('&weak=1: starts from above, no card, a Walk button ("it may be slow")', await viewerMode() === 'view' && await card() === 0
    && await modeButton() === 'walk' && /slow/.test(weakTitle ?? ''), weakTitle);
  // v0.14.8: the note says why (WebGL drawn by software), and the page hears it (onStart)
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const weakNote = await p.evaluate(() => {
    const el = document.querySelector('[data-weak-note]');
    return {
      kind: el?.dataset.weakNote, role: el?.getAttribute('role'), place: el?.dataset.weakNotePlace,
      text: el?.querySelector('[data-weak-note-text]')?.textContent,
      buttons: [...(el?.querySelectorAll('[data-weak-note-action]') ?? [])].map((b) => b.textContent.trim()),
      start: window.__viewerStart,
    };
  });
  log('v0.14.8 &weak=1: the note (role=status) "Started from above: your browser isn\'t using the graphics card…", Walk anyway · Stay above; onStart reason weak',
    weakNote.kind === 'software' && weakNote.role === 'status' && weakNote.place === 'wide'
    && weakNote.text === 'Started from above: your browser isn\'t using the graphics card, so walking could be slow. Turn on graphics acceleration in your browser\'s settings for the smoothest view.'
    && weakNote.buttons.join() === 'Walk anyway,Stay above'
    && JSON.stringify(weakNote.start) === JSON.stringify({ mode: 'view', reason: 'weak', weak: 'software' }), JSON.stringify(weakNote));
  if (SHOTS) await shot('weak-device-overview.png');
  const note = () => p.locator('[data-weak-note]').count();
  const stored = () => p.evaluate(() => localStorage.getItem('ahdus.viewMode'));
  await p.click('[data-weak-note-action="stay"]');
  await frames(2);
  log('Stay above: the note closes, still from above, nothing remembered', await note() === 0 && await viewerMode() === 'view'
    && await stored() === null);
  await open('start=walk&weak=1&people=1');
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const noteAgain = await note();
  await p.keyboard.press('Escape');
  await frames(1);
  const afterEsc = await note();
  await open('start=walk&weak=1&people=1');
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  await p.mouse.click(desktop.width / 3, 150); // the view (the sky)
  await frames(1);
  log('…shown again next time (Stay above is not remembered); Esc closes it, so does a click on the view',
    noteAgain === 1 && afterEsc === 0 && await note() === 0 && await viewerMode() === 'view', `again ${noteAgain}, after Esc ${afterEsc}`);
  await open('start=walk&weak=1&people=1');
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  await p.click('[data-weak-note-action="walk"]');
  await frames(4);
  const anyway = await p.evaluate(() => {
    const e = window.__ahdusViewer; const s = e.walkthrough?.spawnPoint?.() ?? null; const v = e.walkthrough?.getPosition();
    return { at: v && { x: v.x, z: v.z }, s };
  });
  const anywayCard = await p.waitForSelector('[data-welcome]', { timeout: 30000 }).then(() => true, () => false);
  log('Walk anyway: walking at the entrance, then the welcome card; remembered', await viewerMode() === 'walkthrough' && await note() === 0
    && anywayCard && await stored() === 'walkthrough' && !!anyway.at && (!anyway.s || Math.hypot(anyway.at.x - anyway.s.x, anyway.at.z - anyway.s.z) < 0.5),
    JSON.stringify(anyway));
  if (SHOTS) await shot('weak-device-walk-anyway.png');
  await open('start=walk&weak=1&people=1');
  const rememberedWalk = await p.waitForSelector('[data-welcome]', { timeout: 30000 }).then(() => true, () => false);
  log('opened again on the weak device after Walk anyway: walking with the welcome card, no note (reason remembered)',
    await viewerMode() === 'walkthrough' && rememberedWalk && await note() === 0
    && await p.evaluate(() => window.__viewerStart?.reason) === 'remembered');
  await p.keyboard.press('Escape');
  await p.click('[data-mode-button]'); // Overview: remembered 'view'
  await frames(2);
  await open('start=walk&weak=1&people=1');
  await frames(2);
  log('…Overview chosen later still wins: from above, no note, no card', await viewerMode() === 'view' && await note() === 0
    && await card() === 0 && await p.evaluate(() => window.__viewerStart?.reason) === 'remembered');
  await open('start=walk&quality=low&people=1', { clear: true });
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const lowNote = await p.evaluate(() => ({
    kind: document.querySelector('[data-weak-note]')?.dataset.weakNote,
    text: document.querySelector('[data-weak-note-text]')?.textContent, start: window.__viewerStart,
  }));
  log('quality low: from above, the note "Started from above to keep things fast on this device." (weak low)',
    await viewerMode() === 'view' && lowNote.kind === 'low' && lowNote.text === 'Started from above to keep things fast on this device.'
    && lowNote.start?.weak === 'low', JSON.stringify(lowNote));
  await open('start=walk&people=1', { clear: true });
  const detected = await p.evaluate(() => ({ weak: window.__ahdusViewer.weakDevice, renderer: window.__ahdusViewer.babylonEngine.getGlInfo().renderer }));
  log('not told: SwiftShader (this test\'s WebGL) is found weak and starts from above', detected.weak && await viewerMode() === 'view', detected.renderer);
  await p.click('[data-mode-button]');
  await frames(3);
  log('…its Walk button walks', await viewerMode() === 'walkthrough');

  // ── 7. deep links ──
  await open('start=walk&weak=0&people=1&at=person:p_asha', { clear: true });
  const strip = await p.waitForSelector('[data-nav-strip]', { timeout: 60000 }).then((el) => el.textContent(), () => '');
  log('&at=person:p_asha walking: no card, Show route to Asha from the entrance', await card() === 0 && await viewerMode() === 'walkthrough'
    && /Going to Asha Patel/.test(strip), strip);
  await open('start=walk&weak=1&people=1&at=person:p_asha', { clear: true });
  await p.waitForFunction(() => window.__ahdusViewer.navigation.current === 'person:p_asha', null, { timeout: 30000 }).catch(() => {});
  await frames(4);
  const shown = await p.evaluate(() => {
    const e = window.__ahdusViewer; const c = e.scene.activeCamera; const d = e.getStore().getState().objects.obj_desk;
    return { current: e.navigation.current, near: Math.hypot(c.target.x - d.x, c.target.z - d.z) };
  });
  log('&at= from above: Asha\'s desk shown (the camera on it, outlined), no card', shown.current === 'person:p_asha' && shown.near < 2
    && await card() === 0, JSON.stringify(shown));
  if (SHOTS) await shot('opened-at-person.png');

  // ── 8. without startMode: as before ──
  await open('people=1', { clear: true });
  log('no ?start: walking as before, no card, no Overview button', await viewerMode() === 'walkthrough' && await card() === 0
    && await p.locator('[data-mode-button]').count() === 0);

  // ── 9. a phone ──
  await p.close();
  p = null;
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, isMobile: true });
  await open('start=walk&weak=0&people=1', { clear: true });
  await p.waitForSelector('[data-welcome]', { timeout: 30000 }).catch(() => {});
  const phone = await p.evaluate(() => {
    const box = document.querySelector('[data-layout-viewer]').getBoundingClientRect();
    const c = document.querySelector('[data-welcome]')?.getBoundingClientRect();
    const m = document.querySelector('[data-mode-button]')?.getBoundingClientRect();
    const tools = [...document.querySelectorAll('[data-viewer-toolbar] button')].map((el) => el.getBoundingClientRect());
    const stick = document.querySelector('[data-touch-joystick]')?.getBoundingClientRect();
    const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      narrow: document.querySelector('[data-welcome]')?.dataset.welcome,
      onScreen: !!c && c.left >= box.left && c.right <= box.right + 0.5 && c.top >= box.top && c.bottom <= box.bottom,
      aboveStick: !stick || !c || c.bottom <= stick.top,
      modeOnScreen: !!m && m.right <= box.right && m.left >= box.left,
      toolsClear: tools.every((t) => !overlap(t, m)),
      words: document.querySelector('[data-welcome-action="explore"]')?.textContent,
      compact: document.querySelector('[data-welcome]')?.hasAttribute('data-welcome-compact'),
    };
  });
  log('phone: the card full width at the bottom, on screen, above the joystick; Overview clear of the toolbar; touch words',
    phone.narrow === 'narrow' && phone.onScreen && phone.aboveStick && phone.modeOnScreen && phone.toolsClear && /Joystick/.test(phone.words ?? ''),
    JSON.stringify(phone));
  if (SHOTS) await shot('welcome-phone.png');
  await p.tap('[data-welcome-action="explore"]');
  await frames(2);
  log('phone: Explore closes it', await card() === 0);
  log('full-height phone: the full card, not the compact one', phone.compact === false, `compact: ${phone.compact}`);

  // ── 10. a short box (v0.14.7): AHDUS's 3D Company page gives a phone's view ~490 px ──
  await open('start=walk&weak=0&people=1', { clear: true, box: { width: 390, height: 490 } });
  await p.waitForSelector('[data-welcome]', { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => /stops/.test(document.querySelector('[data-welcome-action="tour"]')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
  const fits = () => p.evaluate(() => {
    const rect = (el) => el?.getBoundingClientRect();
    const box = rect(document.querySelector('[data-layout-viewer]'));
    const el = document.querySelector('[data-welcome]');
    const c = rect(el);
    const inside = (a, b) => a && b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    const overlap = (a, b) => !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    const tools = [...document.querySelectorAll('[data-viewer-toolbar] button'), document.querySelector('[data-mode-button]')].filter(Boolean);
    const names = tools.map((t) => t.getAttribute('aria-label') || t.textContent.trim());
    // visible and clickable: on screen, nothing over its middle (elementFromPoint finds the button itself)
    const clickable = tools.map((t) => { const r = rect(t); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return inside(r, box) && !!hit && t.contains(hit); });
    const actions = [...document.querySelectorAll('[data-welcome-action]')];
    const stick = rect(document.querySelector('[data-touch-joystick]'));
    const hud = rect(document.querySelector('[data-hud-line]'));
    return {
      box: [Math.round(box.width), Math.round(box.height)], compact: el?.hasAttribute('data-welcome-compact'), names,
      clickable, toolsClear: tools.every((t) => !overlap(rect(t), c)),
      actions: actions.map((a) => a.dataset.welcomeAction).join(),
      actionsShown: actions.length === 3 && actions.every((a) => inside(rect(a), c) && inside(rect(a), box)),
      noScroll: !!el && el.scrollHeight <= el.clientHeight + 1,
      stickClear: !stick || !overlap(stick, c), hudClear: !hud || !overlap(hud, c),
      tourRead: document.querySelector('[data-welcome-action="tour"]')?.textContent,
    };
  });
  const s1 = await fits();
  log('short box 390 × 490: the compact card, all three actions on screen with no scrolling, clear of the joystick and the HUD line',
    s1.box.join() === '390,490' && s1.compact && s1.actions === 'tour,explore,find' && s1.actionsShown && s1.noScroll && s1.stickClear && s1.hudClear,
    JSON.stringify(s1));
  log('short box: Back to entrance, ?, Find, Tour and Overview visible and clickable (the card covers none of them)',
    s1.names.length >= 5 && ['Back to entrance', 'Find a person, room or place', 'Company tour', 'Overview'].every((n) => s1.names.includes(n))
    && s1.clickable.every(Boolean) && s1.toolsClear, JSON.stringify({ names: s1.names, clickable: s1.clickable }));
  log('short box: the detail of each action is still read out (Start the tour, 4 stops · about 1 min)', /Start the tour, \d+ stops · about \d+ min/.test(s1.tourRead ?? ''), s1.tourRead);
  if (SHOTS) await shot('welcome-phone-short.png');
  await p.tap('[data-welcome-action="find"]');
  await p.waitForSelector('[data-place-search]', { timeout: 10000 }).catch(() => {});
  log('short box: Find someone opens Find', await card() === 0 && await p.evaluate(() => document.activeElement?.tagName === 'INPUT'));
  // v0.14.8: a weak phone in the short box: the note, compact at the bottom, the toolbar and Walk clickable
  await open('start=walk&weak=1&people=1', { clear: true, box: { width: 390, height: 490 } });
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const phoneNote = await p.evaluate(() => {
    const rect = (el) => el?.getBoundingClientRect();
    const box = rect(document.querySelector('[data-layout-viewer]'));
    const el = document.querySelector('[data-weak-note]');
    const c = rect(el);
    const inside = (a, b) => a && b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    const overlap = (a, b) => !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    const tools = [...document.querySelectorAll('[data-viewer-toolbar] button'), document.querySelector('[data-mode-button]')].filter(Boolean);
    const clickable = tools.map((t) => { const r = rect(t); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return inside(r, box) && !!hit && t.contains(hit); });
    return {
      place: el?.dataset.weakNotePlace, compact: el?.hasAttribute('data-weak-note-compact'), onScreen: inside(c, box),
      buttons: [...(el?.querySelectorAll('[data-weak-note-action]') ?? [])].every((b) => inside(rect(b), c)),
      noScroll: !!el && el.scrollHeight <= el.clientHeight + 1, clickable, toolsClear: tools.every((t) => !overlap(rect(t), c)),
    };
  });
  log('v0.14.8 short phone box, weak: the note compact at the bottom, on screen with both buttons and no scrolling; toolbar and Walk clickable',
    phoneNote.place === 'narrow' && phoneNote.compact && phoneNote.onScreen && phoneNote.buttons && phoneNote.noScroll
    && phoneNote.clickable.length >= 2 && phoneNote.clickable.every(Boolean) && phoneNote.toolsClear, JSON.stringify(phoneNote));
  if (SHOTS) await shot('weak-note-phone-short.png');
  await p.tap('[data-weak-note-action="walk"]');
  const phoneWalk = await p.waitForSelector('[data-welcome]', { timeout: 30000 }).then(() => true, () => false);
  log('…Walk anyway by tap: walking, the compact welcome card', await viewerMode() === 'walkthrough' && phoneWalk
    && await p.evaluate(() => document.querySelector('[data-welcome]')?.hasAttribute('data-welcome-compact')));
  if (SHOTS) await shot('weak-note-phone-walk-anyway.png');
  await p.close();
  p = null;
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await open('start=walk&weak=0&people=1', { clear: true, box: { width: 1000, height: 400 } });
  await p.waitForSelector('[data-welcome]', { timeout: 30000 }).catch(() => {});
  const s2 = await fits();
  log('short wide box 1000 × 400: compact, in the middle, toolbar and Overview clickable, all actions with no scrolling',
    s2.compact && s2.actionsShown && s2.noScroll && s2.clickable.every(Boolean) && s2.toolsClear && s2.hudClear, JSON.stringify(s2));
  if (SHOTS) await shot('welcome-wide-short.png');
} catch (e) {
  log('script', false, e.message);
} finally {
  await b.close();
}
