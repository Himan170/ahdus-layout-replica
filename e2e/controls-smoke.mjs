// Easy controls smoke test (v0.14.0, private-docs/EXPERIENCE_PLAN.md 3.2): viewer.html's walkthrough.
// The keys work as soon as walking starts (no click) and right after the view's own buttons (Back to
// entrance, "?", Find); typing in the search box never walks. Drag to look: the view turns, the mouse is
// never captured (the cursor stays). A plain click on the floor walks there (a route, walk 'auto', source
// 'click'); a click on a person keeps their card; a click on a machine with a module's action runs it.
// Double-click or L = mouse look (a crosshair); the first Esc releases the mouse, the next the keys.
// The one-time hint shows once per browser; "?" lists every key. Studio's Preview: e2e:play (unchanged).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev              (in one terminal)
//                   npm run e2e:controls     (in another)
// SHOTS=<dir>: screenshots (desktop 1440 × 900, phone 390 × 844) into <dir>.
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
const ctx = await b.newContext({ viewport: SHOTS ? { width: 1440, height: 900 } : { width: 1280, height: 720 } });
// Every hint shown, as it appears (it fades out after 6 s: at ~1 fps the page can be slower than that)
await ctx.addInitScript(() => {
  window.__hints = [];
  new MutationObserver(() => {
    const el = document.querySelector('[data-walk-hint]');
    if (el && window.__hints.at(-1) !== el) { window.__hints.push(el); window.__hintTexts = window.__hints.map((h) => h.textContent); }
    // the HUD's own keys line while the hint shows (it shouldn't: the same words twice)
    if (el && document.querySelector('[data-hud="hint"]')) window.__hudLineWithHint = document.querySelector('[data-hud="hint"]').textContent;
  }).observe(document, { childList: true, subtree: true });
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });

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
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Hold a key while frames are drawn; how far the character moved. */
async function hold(key, n = 4) {
  const from = await pos();
  await p.keyboard.down(key); await frames(n); await p.keyboard.up(key); await frames(1);
  return distance(from, await pos());
}
const locked = () => p.evaluate(() => !!document.pointerLockElement);
const focus = () => p.evaluate(() => {
  const a = document.activeElement;
  // the view's box or its canvas (a press on the canvas focuses it): the view has the keys
  if (a?.matches('[data-layout-viewer], [data-layout-viewer] canvas')) return 'view';
  if (a?.closest('[data-layout-viewer]')) return `in view: ${a.getAttribute('aria-label') || a.textContent?.trim().slice(0, 20) || a.tagName}`;
  return a?.tagName ?? '';
});
const keysPill = () => p.locator('[data-hud="keys"]').textContent({ timeout: 5000 }).catch(() => '');
/** The pill "Mouse look · Esc to release": only in mouse look (v0.14.0). */
const pillCount = () => p.locator('[data-hud="keys"]').count();
/** The view's description for screen readers: who has the keys. */
const keysState = () => p.locator('[data-hud="keys-state"]').textContent({ timeout: 5000 }).catch(() => '');
const nav = () => p.evaluate(() => (window.__viewerNav ?? []).map((e) => ({ state: e.state, source: e.source ?? null })));
const walkingNow = () => p.evaluate(() => window.__ahdusViewer.navigation.walking);
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
const shot = (name, pg = p) => pg.screenshot({ path: join(shotDir, name), timeout: 120000 });
const ready = (pg = p) => pg.waitForFunction(() => window.__ahdusViewer?.rooms.meshes.size === 3, null, { timeout: 90000 });

// ── 1. Walking starts with the keys: no click ──
await p.goto(new URL('viewer.html?demoModules=1&people=1', base).href);
await ready();
await p.evaluate((s) => window.__ahdusScene.getEngine().setHardwareScalingLevel(s), SHOTS ? 1 : 2); // fast without a GPU
await frames(3);
if (SHOTS) await shot('controls-start.png');
const atStart = { focus: await focus(), lock: await locked(), ring: await p.locator('[data-focus-ring]').count(), pill: await pillCount(), state: await keysState() };
const walked = await hold('KeyW');
log('walking starts with the keys: the view has the focus (no ring, no click), W walks; the mouse is not captured; no "Esc to release" button',
  atStart.focus === 'view' && !atStart.lock && atStart.ring === 0 && atStart.pill === 0 && atStart.state === 'Esc to release' && walked > 0.1,
  JSON.stringify({ ...atStart, walked: +walked.toFixed(2) }));

await p.waitForFunction(() => window.__hintTexts?.length > 0, null, { timeout: 30000 }).catch(() => {});
const hints = await p.evaluate(() => ({ texts: window.__hintTexts ?? [], seen: localStorage.getItem('ahdus.walkHintSeen'), lineWithHint: window.__hudLineWithHint ?? null }));
await p.waitForSelector('[data-walk-hint]', { state: 'detached', timeout: 30000 }).catch(() => {});
const hintGone = (await p.locator('[data-walk-hint]').count()) === 0;
const lineAfter = await p.locator('[data-hud="hint"]').textContent({ timeout: 5000 }).catch(() => '');
log('the one-time hint: "W A S D to walk · drag to look · click the floor to go there", then it goes; the HUD line under the room name only after it',
  hints.texts.length === 1 && hints.texts[0] === 'W A S D to walk · drag to look · click the floor to go there' && hints.seen === '1' && hintGone &&
  hints.lineWithHint === null && /^W A S D walk/.test(lineAfter),
  JSON.stringify({ ...hints, hintGone, lineAfter }));

// ── 2. Drag to look: the view turns, the cursor stays, no walk ──
await pose(0, -12, 0, -0.2);
const before = { yaw: await yaw(), at: await pos() };
await p.mouse.move(640, 420);
await p.mouse.down();
await p.mouse.move(700, 420, { steps: 4 });
await p.mouse.move(860, 400, { steps: 6 });
const dragLock = await locked();
await p.mouse.up();
await frames(2);
const afterDrag = { yaw: await yaw(), at: await pos(), lock: await locked(), walking: await walkingNow(), nav: (await nav()).length };
log('drag to look: the view turns right, the mouse is never captured (the cursor stays), nobody walks',
  afterDrag.yaw - before.yaw > 0.3 && !dragLock && !afterDrag.lock && afterDrag.walking === null && afterDrag.nav === 0 &&
  distance(afterDrag.at, before.at) < 0.05,
  `yaw ${before.yaw.toFixed(2)} → ${afterDrag.yaw.toFixed(2)} | ${JSON.stringify({ lock: afterDrag.lock, nav: afterDrag.nav })}`);
const y2 = await yaw();
await p.mouse.down({ button: 'right' });
await p.mouse.move(560, 400, { steps: 6 });
await p.mouse.up({ button: 'right' });
await frames(2);
log('a right-button drag looks too (left)', (await yaw()) < y2 - 0.2 && !(await locked()), `${y2.toFixed(2)} → ${(await yaw()).toFixed(2)}`);

// ── 3. The view's own buttons work while walking, and the keys come back at once ──
await pose(6, -10, 0, 0);
await p.click('[data-hud="entrance"]');
await frames(3);
const home = await pos();
await wait(200);
const afterHome = { focus: await focus(), walked: +(await hold('KeyW')).toFixed(2) };
log('"Back to entrance" works while walking; then W walks at once (the focus back in the view)',
  Math.abs(home.x) < 0.1 && Math.abs(home.z + 6.075) < 0.1 && afterHome.focus === 'view' && afterHome.walked > 0.1,
  JSON.stringify({ home, ...afterHome }));

await p.click('[data-hud="help"]');
const help = await p.evaluate(() => {
  const el = document.querySelector('[data-walk-help]');
  return el ? { rows: el.querySelectorAll('dt').length, text: el.innerText, expanded: document.querySelector('[data-hud="help"]').getAttribute('aria-expanded') } : null;
});
if (SHOTS) await shot('controls-help.png');
await p.keyboard.press('Escape');
const helpEsc = { open: await p.locator('[data-walk-help]').count(), focus: await focus(), walked: +(await hold('KeyW')).toFixed(2) };
log('"?" lists every key (W A S D, drag, click the floor, Page Up / Page Down, L, Esc…); Esc closes it, W walks',
  help?.rows >= 12 && /W A S D/.test(help.text) && /Click the floor/.test(help.text) && /Page Up \/ Page Down/.test(help.text) &&
  /Double-click or L/.test(help.text) && help.expanded === 'true' && helpEsc.open === 0 && helpEsc.walked > 0.1,
  JSON.stringify({ rows: help?.rows, ...helpEsc }));

const SEARCH = 'button[aria-label="Find a person, room or place"]';
await pose(0, -14, 0, -0.2); // in the open, so W has room to walk
await p.click(SEARCH);
const fromType = await pos();
await p.keyboard.type('wasd wsad', { delay: 20 });
await frames(3);
const typedMoved = distance(fromType, await pos());
await p.keyboard.press('Escape');
const findWalk = +(await hold('KeyW')).toFixed(2);
await p.click(SEARCH);
await p.fill('[data-place-search] input', 'Asha');
await p.click('[data-place-search] [role="option"]');
await frames(2);
await wait(200);
const pickFocus = await focus();
await pose(0, -14, 0, -0.2);
const afterPick = { focus: pickFocus, walked: +(await hold('KeyW')).toFixed(2), shown: await p.locator('[data-place-shown]').count() };
log('Find: typing W A S D in the box never walks; after Esc, and after picking a result, W walks',
  typedMoved < 0.01 && findWalk > 0.1 && afterPick.focus === 'view' && afterPick.walked > 0.1 && afterPick.shown === 1,
  JSON.stringify({ typedMoved, findWalk, ...afterPick }));
await p.click('button[aria-label="Clear the place found"]');
await wait(200);
const clearFocus = await focus();
await pose(0, -13, 0, -0.2); // in the open, so W has room to walk
const clearWalk = +(await hold('KeyW')).toFixed(2);
log('a card\'s button (Clear) gives the keys back too', clearFocus === 'view' && clearWalk > 0.1, JSON.stringify({ clearFocus, clearWalk }));

// ── 4. Click the floor to walk there ──
await pose(0, -13, 0, -0.35);
const goal = { x: 3.5, z: -9 };
const at = await onScreen(goal.x, 0, goal.z);
const navBefore = (await nav()).length;
await p.mouse.click(at.x, at.y);
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.source === 'click', null, { timeout: 15000 }).catch(() => {});
const started = await walkingNow();
const line = await p.evaluate(() => window.__ahdusScene.meshes.filter((m) => m.metadata?.routeLine && m.isEnabled() && m.thinInstanceCount > 0).length);
if (SHOTS) await shot('controls-click-walk.png');
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking === null, null, { timeout: 90000 }).catch(() => {});
const arrived = await pos();
const clickNav = (await nav()).slice(navBefore);
const strip = await p.locator('[data-nav-strip]').count();
log('a click on the floor walks there (Take me there to that spot): the line shows, no strip, arrives within 1.2 m',
  started?.walk === 'auto' && started?.source === 'click' && line >= 1 && distance(arrived, goal) < 1.2 &&
  clickNav.at(-1)?.state === 'arrived' && clickNav.every((e) => e.source === 'click') && strip === 0 && !(await locked()),
  `${JSON.stringify(arrived)} | ${clickNav.map((e) => e.state).filter((s, i, a) => s !== a[i - 1]).join(' → ')} | line ${line}`);

// a movement key ends a click's walk (you walk yourself)
await pose(0, -13, 0, -0.35);
const at2 = await onScreen(-3.5, 0, -8.5);
await p.mouse.click(at2.x, at2.y);
await p.waitForFunction(() => window.__ahdusViewer.navigation.walking?.source === 'click', null, { timeout: 15000 }).catch(() => {});
const wasWalking = !!(await walkingNow());
await hold('KeyS', 2);
const ended = { walking: await walkingNow(), last: (await nav()).at(-1) };
log('a movement key ends a click\'s walk (no "Press G")', wasWalking && ended.walking === null && ended.last?.state === 'stopped',
  JSON.stringify(ended.last));

// ── 5. A click on a person keeps their card; on a machine with a module's action, the action ──
await pose(9.5, -2.6, 0, -0.35); // Engineering, in front of Asha's desk (9.5, -1), facing it
await wait(500);
const desk = await onScreen(9.5, 0.75, -1.1);
await p.mouse.click(desk.x, desk.y);
await p.waitForSelector('[data-person-card][data-pinned]', { timeout: 30000 }).catch(() => {});
const card = await p.evaluate(() => document.querySelector('[data-person-card][data-pinned]')?.innerText.replace(/\n/g, ' | ') ?? null);
const cardWalk = await walkingNow();
if (SHOTS) await shot('controls-person-card.png');
log('a click on a person\'s desk keeps their card (name and department); nobody walks', !!card && cardWalk === null, String(card));

await pose(13, 1.2, Math.PI, -0.25); // inside Engineering, 2.7 m from the CNC machine (13, -1.5), facing it
await wait(500);
const cardsBefore = await p.evaluate(() => (window.__viewerEvents ?? []).filter((e) => e.event === 'interact').length);
const cnc = await onScreen(13, 1.0, -1.5);
await p.mouse.click(cnc.x, cnc.y);
await p.waitForFunction((n) => (window.__viewerEvents ?? []).filter((e) => e.event === 'interact').length > n, cardsBefore, { timeout: 20000 }).catch(() => {});
const inter = await p.evaluate(() => (window.__viewerEvents ?? []).filter((e) => e.event === 'interact').at(-1)?.payload ?? null);
const cncCard = await p.evaluate(() => (window.__ahdusCards ?? []).at(-1)?.title ?? '');
log('a click on the CNC machine (in reach, a module has an action) runs it, as E; the person card went',
  inter?.objectId === 'obj_cnc' && /operation video/.test(cncCard) && (await walkingNow()) === null &&
  (await p.locator('[data-person-card][data-pinned]').count()) === 0, `${inter?.objectId} | ${cncCard}`);

// ── 6. Mouse look: double-click or L; Esc releases the mouse, the next Esc the keys ──
await pose(0, -12, 0, 0.2); // looking up a little: a double-click on the sky walks nowhere
const sky = { x: 640, y: 120 };
await p.mouse.dblclick(sky.x, sky.y);
await p.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 10000 }).catch(() => {});
await frames(2);
const mouseLook = { lock: await locked(), crosshair: await p.locator('[data-crosshair]').count(), pill: await keysPill(), walking: await walkingNow() };
if (SHOTS) await shot('controls-mouse-look.png');
await p.keyboard.press('Escape');
await frames(2);
const esc1 = { lock: await locked(), focus: await focus(), crosshair: await p.locator('[data-crosshair]').count(), pill: await pillCount(), walked: +(await hold('KeyW')).toFixed(2) };
await wait(500); // an Esc within 0.4 s of the release is the same key press (the browser's own Esc), not a second one
await p.keyboard.press('Escape');
await frames(2);
const esc2 = { focus: await focus(), walked: +(await hold('KeyW')).toFixed(2), pill: await pillCount(), state: await keysState() };
log('double-click: mouse look (crosshair, "Mouse look · Esc to release"); Esc releases the mouse (the pill goes) and the keys stay; the next Esc gives them back',
  mouseLook.lock && mouseLook.crosshair === 1 && mouseLook.pill === 'Mouse look · Esc to release' && mouseLook.walking === null &&
  !esc1.lock && esc1.focus === 'view' && esc1.crosshair === 0 && esc1.pill === 0 && esc1.walked > 0.1 &&
  esc2.focus !== 'view' && esc2.walked < 0.01 && esc2.pill === 0 && esc2.state === 'Click the view to walk',
  JSON.stringify({ mouseLook, esc1, esc2 }));

await p.mouse.click(sky.x, sky.y); // takes the keys back (a click on the sky walks nowhere)
await frames(2);
const back = { focus: await focus(), walking: await walkingNow() };
await p.keyboard.press('KeyL');
await p.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 10000 }).catch(() => {});
const lLock = await locked();
await p.keyboard.press('KeyL');
await frames(2);
log('a click on the view takes the keys back; L switches mouse look on and off',
  back.focus === 'view' && back.walking === null && lLock && !(await locked()), JSON.stringify({ ...back, lLock }));

// The sky: all six sides of its cube map decoded (the first one was black in dev: React StrictMode's first engine
// still ran on the same WebGL context; it is disposed at once now)
await p.waitForFunction(() => window.__ahdusScene.environmentTexture?.isReady(), null, { timeout: 60000 }).catch(() => {});
const skyFaces = await p.evaluate(async () => {
  const tex = window.__ahdusScene.environmentTexture;
  if (!tex) return null;
  const means = [];
  for (let f = 0; f < 6; f++) {
    const d = await tex.readPixels(f, 0);
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    means.push(+(s / (d.length / 4) / 3).toFixed(2));
  }
  return means;
});
log('the sky has all six sides (none black)', !!skyFaces && skyFaces.every((m) => m > 0.1), JSON.stringify(skyFaces));

// v0.17.0: "Low graphics" in the help: the simple look at once (no reload), remembered after a reload
await p.click('[data-hud="help"]');
const lowOff = await p.getAttribute('[data-low-graphics]', 'data-low-graphics');
await p.click('[data-low-graphics]');
await frames(2);
const lowOn = await p.evaluate(() => {
  const e = window.__ahdusViewer;
  const sw = document.querySelector('[data-low-graphics]');
  return { attr: sw?.getAttribute('data-low-graphics'), checked: sw?.getAttribute('aria-checked'), low: e.lowGraphics,
    shadows: e._layoutScene.lights.directional.shadowEnabled, full: e.characters?.fullCount ?? 0,
    stored: localStorage.getItem('ahdus.lowGraphics') };
});
await p.keyboard.press('Escape');

// ── 7. The hint only once per browser ──
await p.reload();
await ready();
await frames(3);
await wait(2000);
const again = await p.evaluate(() => ({ texts: window.__hintTexts ?? [], focus: document.activeElement?.matches('[data-layout-viewer]') }));
log('after a reload the hint doesn\'t show again; the keys are the view\'s again at once', again.texts.length === 0 && again.focus,
  JSON.stringify(again));
const lowAfter = await p.evaluate(() => window.__ahdusViewer.lowGraphics);
await p.click('[data-hud="help"]');
const lowAfterAttr = await p.getAttribute('[data-low-graphics]', 'data-low-graphics');
await p.click('[data-low-graphics]');
await frames(2);
const lowBack = await p.evaluate(() => {
  const e = window.__ahdusViewer;
  // off again: the measured step's shadows (SwiftShader may have dropped them by itself)
  return { low: e.lowGraphics, shadows: e._layoutScene.lights.directional.shadowEnabled === e.drawQuality.step.shadows,
    forced: e.drawQuality.isForced, stored: localStorage.getItem('ahdus.lowGraphics') };
});
await p.keyboard.press('Escape');
log('v0.17.0: "Low graphics" in the help: off, then on at once (no shadows, no full characters), remembered after a reload, off again',
  lowOff === 'off' && lowOn.attr === 'on' && lowOn.checked === 'true' && lowOn.low && !lowOn.shadows && lowOn.full === 0
    && lowOn.stored === '1' && lowAfter === true && lowAfterAttr === 'on' && !lowBack.low && lowBack.shadows && !lowBack.forced
    && lowBack.stored === null,
  JSON.stringify({ lowOff, lowOn, lowAfter, lowAfterAttr, lowBack }));

// ── 8. Screenshots: the hint and the help on a phone (390 × 844), nothing off-screen ──
if (SHOTS) {
  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const ph = await phoneCtx.newPage();
  await ph.goto(new URL('viewer.html?people=1', base).href);
  await ready(ph);
  await ph.waitForSelector('[data-walk-hint]', { timeout: 30000 }).catch(() => {});
  await shot('controls-phone-hint.png', ph);
  await ph.click('[data-hud="help"]');
  const fits = await ph.evaluate(() => [...document.querySelectorAll('[data-viewer-toolbar] button, [data-walk-help]')]
    .every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }));
  await shot('controls-phone-help.png', ph);
  log('390 px wide (mouse and keys): the toolbar and the help fit', fits);
  await phoneCtx.close();
}

await b.close();
