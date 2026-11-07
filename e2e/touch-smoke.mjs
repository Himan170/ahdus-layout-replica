// Touch controls smoke test (v0.14.1, private-docs/EXPERIENCE_PLAN.md 3.2, the Touch row): viewer.html's
// walkthrough on a phone (390 × 844, hasTouch + isMobile). A joystick at the bottom left walks (push further =
// faster, let go = stop); a finger dragging anywhere else looks around (a second finger while the joystick is
// held too); a tap on the floor walks there (the route line); a tap on a person's desk keeps their card; the
// toolbar's buttons, Find and its card work by tap. The one-time hint, the screen readers' line and the "?"
// help use touch words (joystick, drag, tap); the HUD is one short line beside the joystick, never under its
// knob (v0.14.2); a mouse brings back the keys and mouse words.
// The mouse and keys on a computer: e2e:controls (unchanged). Studio's Preview: e2e:play (unchanged).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:touch      (in another)
// SHOTS=<dir>: phone screenshots (390 × 844, 2×) into <dir>.
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
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, isMobile: true });
// viewer.html's bridge-events panel would take 40 % of a phone: hidden, so the view is full width as on a phone page
await ctx.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = 'aside[aria-label="Bridge events"] { display: none !important; }';
    document.head.append(st);
  });
});
// Every hint shown, as it appears (it fades out after 6 s: at ~1 fps the page can be slower than that)
await ctx.addInitScript(() => {
  window.__hints = [];
  new MutationObserver(() => {
    const el = document.querySelector('[data-walk-hint]');
    if (el && window.__hints.at(-1) !== el) {
      window.__hints.push(el);
      window.__hintTexts = window.__hints.map((h) => h.textContent);
      window.__hintWords = el.getAttribute('data-walk-hint-words');
    }
  }).observe(document, { childList: true, subtree: true });
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const cdp = await ctx.newCDPSession(p);

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.__ahdusViewer.walkthrough.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: +v.x.toFixed(3), z: +v.z.toFixed(3) }; });
const yaw = () => p.evaluate(() => window.__ahdusViewer.walkthrough.getYaw());
const stick = () => p.evaluate(() => window.__ahdusViewer.walkthrough.getStick());
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const nav = () => p.evaluate(() => (window.__viewerNav ?? []).map((e) => ({ state: e.state, source: e.source ?? null, paused: !!e.paused })));
const walkingNow = () => p.evaluate(() => window.__ahdusViewer.navigation.walking);
const hudLine = () => p.locator('[data-hud="hint"]').textContent({ timeout: 5000 }).catch(() => '');
const keysState = () => p.locator('[data-hud="keys-state"]').textContent({ timeout: 5000 }).catch(() => '');
const rect = (sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null; }, sel);
/** Where a world point is on the page (px). */
const onScreen = (x, y, z) => p.evaluate(({ x, y, z }) => {
  const sc = window.__ahdusScene;
  const cam = sc.activeCamera;
  const canvas = sc.getEngine().getRenderingCanvas();
  const V = cam.position.constructor;
  const M = sc.getTransformMatrix().constructor;
  const r = canvas.getBoundingClientRect();
  const s = V.Project(new V(x, y, z), M.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
  return { x: r.left + s.x, y: r.top + s.y };
}, { x, y, z });
const shot = (name) => p.screenshot({ path: join(shotDir, name), timeout: 120000 });
const ready = () => p.waitForFunction(() => window.__ahdusViewer?.rooms.meshes.size === 3, null, { timeout: 90000 });

// ── Fingers (CDP touch events: Chromium turns them into touch pointer events, as a phone does) ──
const fingers = new Map(); // id → { x, y }
const touchPoints = () => [...fingers].map(([id, f]) => ({ x: f.x, y: f.y, id }));
async function fingerDown(id, x, y) {
  fingers.set(id, { x, y });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints() });
}
async function fingerMove(id, x, y, steps = 1) {
  const f = fingers.get(id);
  for (let i = 1; i <= steps; i++) {
    fingers.set(id, { x: f.x + ((x - f.x) * i) / steps, y: f.y + ((y - f.y) * i) / steps });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints() });
  }
}
async function fingerUp(id) {
  fingers.delete(id);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: touchPoints() });
}
const tap = (x, y) => p.touchscreen.tap(x, y);
const tapOn = async (sel) => { const r = await rect(sel); if (!r) throw new Error(`nothing to tap: ${sel}`); await tap(r.cx, r.cy); };

// ── 1. Walking starts on a phone: the joystick, and touch words everywhere ──
await p.goto(new URL('viewer.html?demoModules=1&people=1', base).href);
await ready();
await p.evaluate((s) => window.__ahdusScene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2); // fast without a GPU
await frames(3);
await p.waitForFunction(() => window.__hintTexts?.length > 0, null, { timeout: 30000 }).catch(() => {});
if (SHOTS) await shot('touch-start-hint.png');
const start = await p.evaluate(() => ({
  joystick: document.querySelector('[data-touch-joystick]')?.getAttribute('data-touch-joystick') ?? null,
  texts: window.__hintTexts ?? [], words: window.__hintWords ?? null,
  seen: localStorage.getItem('ahdus.walkHintSeen.touch'), mouseSeen: localStorage.getItem('ahdus.walkHintSeen'),
  help: document.querySelector('[data-hud="help"]')?.getAttribute('aria-label') ?? null,
}));
log('walking starts on a phone with the joystick; the one-time hint says "Joystick to walk · drag to look · tap the floor to go there"',
  start.joystick === 'idle' && start.texts.length === 1 && start.texts[0] === 'Joystick to walk · drag to look · tap the floor to go there' &&
  start.words === 'touch' && start.seen === '1' && start.mouseSeen === null && start.help === 'Touch controls',
  JSON.stringify(start));
await p.waitForSelector('[data-walk-hint]', { state: 'detached', timeout: 30000 }).catch(() => {});
await p.waitForFunction(() => !document.querySelector('[data-hud-line] [data-hud="hint"]'), null, { timeout: 15000 }).catch(() => {});
const line = await p.locator('[data-hud-line]').innerText({ timeout: 5000 }).catch(() => '');
const sr = await keysState();
log('the HUD is one short line ("Outside · Ground Floor"); the screen readers\' line uses touch words (no W A S D, no click, no E)',
  line === 'Outside · Ground Floor' && /joystick/.test(sr) && !/Click|Esc/.test(sr), `${line} | ${sr}`);

// The layout: the joystick at the bottom left, the HUD one line to its right, nothing off-screen
const layout = { stick: await rect('[data-touch-joystick]'), hud: await rect('[data-hud-line]') };
const fits = await p.evaluate(() => [...document.querySelectorAll('[data-viewer-toolbar] button, [data-touch-joystick], [data-hud-line]')]
  .every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; }));
log('the joystick sits at the bottom left, the HUD one line to its right (no overlap), nothing goes off-screen at 390 px',
  !!layout.stick && layout.stick.left < 40 && layout.stick.bottom > 844 - 40 && layout.stick.w >= 100 &&
  !!layout.hud && layout.hud.left >= layout.stick.right && layout.hud.h <= 34 && fits, JSON.stringify(layout));

// ── 2. The joystick: push = walk that way, further = faster, let go = stop ──
await pose(0, -14, 0, -0.2); // in the open, facing +Z (the building)
const ring = await rect('[data-touch-joystick]');
const radius = ring.w / 2;
const from = await pos();
await fingerDown(1, ring.cx, ring.cy);
await fingerMove(1, ring.cx, ring.cy - radius * 1.2, 4); // pushed all the way up (past the ring)
const full = await stick();
const held = await p.locator('[data-touch-joystick="held"]').count();
await frames(4);
const walkedUp = await pos();
// the knob pushed all the way forward rises above the ring: never under the HUD (v0.14.2)
const knob = await rect('[data-touch-knob]');
const hudNow = await rect('[data-hud-line]');
const clear = !!knob && !!hudNow && (knob.right <= hudNow.left || knob.bottom <= hudNow.top || knob.top >= hudNow.bottom);
if (SHOTS) await shot('touch-joystick.png');
await fingerMove(1, ring.cx + radius * 0.45, ring.cy, 2); // half way to the right
const half = await stick();
await fingerUp(1);
await frames(2);
const letGo = { stick: await stick(), at: await pos(), idle: await p.locator('[data-touch-joystick="idle"]').count() };
await frames(3);
const still = distance(letGo.at, await pos());
log('the knob pushed forward is never under the HUD', clear && knob.top < ring.top, JSON.stringify({ knob, hud: hudNow, ring: { top: ring.top } }));
log('the joystick walks: pushed up = forward (+Z); half way = slower, that way; let go = stop at once',
  held === 1 && full.y > 0.99 && Math.abs(full.x) < 0.01 && walkedUp.z - from.z > 0.5 && Math.abs(walkedUp.x - from.x) < 0.3 &&
  half.x > 0.25 && half.x < 0.6 && Math.abs(half.y) < 0.05 && letGo.stick.x === 0 && letGo.stick.y === 0 && letGo.idle === 1 && still < 0.01,
  JSON.stringify({ from, walkedUp, full, half, letGo: letGo.stick, still }));

// ── 3. Drag anywhere else to look; a second finger looks while the joystick walks ──
await pose(0, -14, 0, -0.2);
const y0 = await yaw();
const at0 = await pos();
await fingerDown(2, 200, 420);
await fingerMove(2, 320, 410, 6);
await fingerUp(2);
await frames(2);
const dragged = { yaw: await yaw(), moved: distance(at0, await pos()), walking: await walkingNow(), nav: (await nav()).length };
log('a finger dragging on the view turns it (right), nobody walks, no route',
  dragged.yaw - y0 > 0.3 && dragged.moved < 0.05 && dragged.walking === null && dragged.nav === 0,
  `yaw ${y0.toFixed(2)} → ${dragged.yaw.toFixed(2)} | ${JSON.stringify(dragged)}`);

await pose(0, -14, 0, -0.2);
const y1 = await yaw();
const at1 = await pos();
await fingerDown(1, ring.cx, ring.cy);
await fingerMove(1, ring.cx, ring.cy - radius, 3);
await fingerDown(2, 250, 420);
await fingerMove(2, 150, 420, 6); // looking left with the other thumb
await frames(3);
await fingerUp(2);
await fingerUp(1);
await frames(2);
const both = { turned: (await yaw()) - y1, moved: distance(at1, await pos()) };
log('two thumbs at once: the joystick walks while the other finger looks around', both.turned < -0.2 && both.moved > 0.5, JSON.stringify(both));

// ── 4. Tap the floor: walk there (the line shows); the joystick ends that walk ──
await pose(0, -13, 0, -0.35);
const goal = { x: 0.8, z: -9 }; // a portrait view is narrow: straight ahead
const g = await onScreen(goal.x, 0, goal.z);
const navBefore = (await nav()).length;
await tap(g.x, g.y);
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.source === 'click', null, { timeout: 15000 }).catch(() => {});
const started = await walkingNow();
const lineMeshes = await p.evaluate(() => window.__ahdusScene.meshes.filter((m) => m.metadata?.routeLine && m.isEnabled() && m.thinInstanceCount > 0).length);
if (SHOTS) await shot('touch-tap-walk.png');
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking === null, null, { timeout: 90000 }).catch(() => {});
const arrived = await pos();
const tapNav = (await nav()).slice(navBefore);
log('a tap on the floor walks there: the route line shows, no strip, arrives within 1.2 m',
  started?.walk === 'auto' && started?.source === 'click' && lineMeshes >= 1 && distance(arrived, goal) < 1.2 &&
  tapNav.at(-1)?.state === 'arrived' && (await p.locator('[data-nav-strip]').count()) === 0,
  `${JSON.stringify(arrived)} | ${tapNav.map((e) => e.state).filter((s, i, a) => s !== a[i - 1]).join(' → ')} | line ${lineMeshes}`);

await pose(0, -13, 0, -0.35);
const g2 = await onScreen(-0.8, 0, -8.5);
await tap(g2.x, g2.y);
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.source === 'click', null, { timeout: 15000 }).catch(() => {});
const wasWalking = !!(await walkingNow());
await fingerDown(1, ring.cx, ring.cy);
await fingerMove(1, ring.cx, ring.cy + radius, 2); // back
await frames(2);
await fingerUp(1);
await frames(1);
const ended = { walking: await walkingNow(), last: (await nav()).at(-1) };
log('the joystick ends a tapped walk (you walk yourself)', wasWalking && ended.walking === null && ended.last?.state === 'stopped', JSON.stringify(ended.last));

// ── 5. Tap a person: their card stays ──
await pose(9.5, -2.6, 0, -0.35); // Engineering, in front of Asha's desk (9.5, -1), facing it
await wait(500);
const desk = await onScreen(9.5, 0.75, -1.1);
await tap(desk.x, desk.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
const card = await p.evaluate(() => document.querySelector('[data-person-card][data-pinned]')?.innerText.replace(/\n/g, ' | ') ?? null);
const cardFits = await p.evaluate(() => { const r = document.querySelector('[data-person-card]')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth + 0.5; });
if (SHOTS) await shot('touch-person-card.png');
log('a tap on a person\'s desk keeps their card (name and department), on screen; nobody walks',
  !!card && /Asha/.test(card) && cardFits && (await walkingNow()) === null, String(card));

// ── 6. The toolbar's buttons, Find and its card by tap ──
await pose(6, -10, 0, 0);
await tapOn('[data-hud="entrance"]');
await frames(3);
const home = await pos();
log('a tap on "Back to entrance" works', Math.abs(home.x) < 0.1 && Math.abs(home.z + 6.075) < 0.1, JSON.stringify(home));

await tapOn('[data-hud="help"]');
await p.waitForSelector('[data-walk-help]', { timeout: 10000 }).catch(() => {});
const help = await p.evaluate(() => {
  const el = document.querySelector('[data-walk-help]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { words: el.getAttribute('data-walk-help'), rows: el.querySelectorAll('dt').length, text: el.innerText, title: el.getAttribute('aria-label'), fits: r.left >= 0 && r.right <= innerWidth + 0.5 };
});
if (SHOTS) await shot('touch-help.png');
await tapOn('button[aria-label="Close touch controls"]').catch(() => {});
await wait(300);
log('"?" by tap: the touch help (joystick, drag, tap the floor, tap a person; no W A S D, Page Up or Esc), fits, closes',
  help?.words === 'touch' && help.title === 'Touch controls' && help.rows >= 6 && /Joystick/.test(help.text) && /Drag/.test(help.text) &&
  /Tap the floor/.test(help.text) && /Tap a person/.test(help.text) && !/W A S D|Page Up|Esc|Double-click/.test(help.text) && help.fits &&
  (await p.locator('[data-walk-help]').count()) === 0, JSON.stringify({ ...help, text: undefined }));

const SEARCH = 'button[aria-label="Find a person, room or place"]';
await tapOn(SEARCH);
await p.waitForSelector('[data-place-search] input', { timeout: 10000 });
await p.fill('[data-place-search] input', 'Asha'); // every desk and room of the sample has a route (src/viewer/__tests__/sampleLayout.test.js)
await p.waitForSelector('[data-place-search] [role="option"]', { timeout: 10000 });
await tapOn('[data-place-search] [role="option"]');
await p.waitForSelector('[data-place-shown]', { timeout: 15000 }).catch(() => {});
const shown = await p.locator('[data-place-shown]').count();
await p.waitForSelector('[data-route="auto"]', { timeout: 15000 }).catch(() => {});
if (SHOTS) await shot('touch-find-card.png');
await pose(0, -14, 0, -0.2); // 8 m out (the ground is walkable 10 m around the building): a walk long enough to pause at ~1 fps
await tapOn('[data-route="auto"]');
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.walk === 'auto', null, { timeout: 15000 }).catch(() => {});
const going = await walkingNow();
await frames(2);
await fingerDown(1, ring.cx, ring.cy);
await fingerMove(1, ring.cx, ring.cy - radius, 2);
await frames(2);
await fingerUp(1);
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.paused, null, { timeout: 15000 }).catch(() => {});
const paused = { walking: await walkingNow(), strip: await p.locator('[data-nav-strip]').innerText({ timeout: 5000 }).catch(() => '') };
if (SHOTS) await shot('touch-take-me-there-paused.png');
await tapOn('[data-nav-continue]').catch(() => {});
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking && !window.__ahdusViewer.navigation.walking.paused, null, { timeout: 15000 }).catch(() => {});
const resumed = await walkingNow();
await tapOn('[data-nav-stop]').catch(() => {});
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking === null, null, { timeout: 15000 }).catch(() => {});
log('Find by tap: a result (Asha) shows its card; Take me there walks; the joystick pauses it ("Tap Continue"); Continue and Stop by tap',
  shown === 1 && going?.walk === 'auto' && paused.walking?.paused === true && /Tap Continue/.test(paused.strip) && !/Press G/.test(paused.strip) &&
  resumed && !resumed.paused && (await walkingNow()) === null,
  JSON.stringify({ shown, going: !!going, paused: paused.walking?.paused, strip: paused.strip.replace(/\n/g, ' | '), resumed: !!resumed }));

// ── 7. A mouse brings back the keys and mouse words (a laptop with a touch screen) ──
await p.mouse.move(200, 300);
await p.mouse.move(220, 310);
await frames(2);
// (a short HUD message, e.g. "Back at the entrance", can still be showing: wait for the line)
await p.waitForFunction(() => /^W A S D walk/.test(document.querySelector('[data-hud="hint"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const mouseWords = { joystick: await p.locator('[data-touch-joystick]').count(), line: await hudLine(), help: await p.locator('[data-hud="help"]').getAttribute('aria-label') };
// a finger again: a tap on the "?" button (opens the help), and another (closes it)
await tapOn('[data-hud="help"]');
await wait(300);
await tapOn('[data-hud="help"]');
await frames(2);
await p.waitForFunction(() => !!document.querySelector('[data-hud-line]'), null, { timeout: 15000 }).catch(() => {});
const touchAgain = { joystick: await p.locator('[data-touch-joystick]').count(), line: await p.locator('[data-hud-line]').count() };
log('a mouse: no joystick, the keys and mouse words; a finger again: the joystick and touch words',
  mouseWords.joystick === 0 && /^W A S D walk/.test(mouseWords.line) && mouseWords.help === 'Keys and mouse' &&
  touchAgain.joystick === 1 && touchAgain.line === 1, JSON.stringify({ mouseWords, touchAgain }));

// ── 8. The hint only once per browser (a reload) ──
await p.reload();
await ready();
await frames(3);
await wait(2000);
const again = await p.evaluate(() => ({ texts: window.__hintTexts ?? [], joystick: !!document.querySelector('[data-touch-joystick]') }));
log('after a reload the touch hint doesn\'t show again; the joystick is there', again.texts.length === 0 && again.joystick, JSON.stringify(again));

await b.close();
