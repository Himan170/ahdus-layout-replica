// Performance tip smoke test (v0.18.10, engine/perfTip.ts): under SwiftShader (WebGL drawn by software: a weak device)
// the tip shows by itself, once per visit, never as a dialog:
//   viewer.html (no start mode): its own small card (text exact, role note), clear of the toolbar; Got it closes it, a
//   reload in the same tab (the same visit) doesn't bring it back, nor do slow frames found later; More → Smoother 3D
//   tips opens it any time. A walking start: the card waits for the welcome card, then sits clear of the HUD.
//   viewer.html?start=walk (a weak start): ONE note: the tip's words inside the weak-device note, no card of its own,
//   not after the note closes either; its "Don't show again" closes the note and sticks: a new visit (a new context
//   with the same storage) shows no tip; More still opens it. A phone (390 × 844): the card full width at the bottom.
//   Studio: the card once everything is built, clear of the footer and the camera card; Settings → Smoother 3D tips
//   opens it; Don't show again sticks after a reload.
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev              (in one terminal)
//                   npm run e2e:perf-tip     (in another)
// SHOTS=<dir>: screenshots into <dir> (default e2e/screens). Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME;
const shotDir = process.env.SHOTS || 'e2e/screens';
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

const TIP = 'For a smoother 3D view: use a computer with a good graphics card, and turn on hardware (graphics) acceleration '
  + 'in your browser\'s settings. People far away show as simple figures until you come closer - that keeps things smooth.';
const REASON = 'Started from above: your browser isn\'t using the graphics card, so walking could be slow.';

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const desktop = { width: 1440, height: 900 };
let ctx;
let p;

const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n);
const shot = (name) => p.screenshot({ path: join(shotDir, name) });
const cards = () => p.locator('[data-perf-tip="card"]').count();
const tipTexts = () => p.locator('[data-perf-tip-text]').count();
const stored = () => p.evaluate(() => {
  const get = (s, k) => { try { return s.getItem(k); } catch { return 'blocked'; } };
  return { off: get(localStorage, 'ahdus.perfTipOff'), shown: get(sessionStorage, 'ahdus.perfTipShown') };
});

async function newContext(options = {}) {
  if (p) await p.close().catch(() => {});
  if (ctx) await ctx.close().catch(() => {});
  ctx = await b.newContext({ viewport: desktop, ...options });
  p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
}

/** viewer.html with these params, built; the Bridge events list hidden (it's the test page's, not the viewer's). */
async function openViewer(query, { reload = false } = {}) {
  if (reload) await p.reload();
  else await p.goto(new URL(`viewer.html?${query}`, base).href);
  await p.addStyleTag({ content: 'aside[aria-label="Bridge events"] { display: none !important; }' });
  await p.waitForFunction(() => window.__ahdusViewer && window.__ahdusScene, null, { timeout: 120000 });
  await p.evaluate(() => window.__ahdusViewer.whenBuilt());
  await p.waitForFunction(() => !document.querySelector('[data-build-progress="start"]'), null, { timeout: 120000 });
  await frames(3);
}

/** The card's box and whether each of these controls is still the topmost thing at its middle (not covered). */
const coverage = (controls) => p.evaluate((controls) => {
  const card = document.querySelector('[data-perf-tip="card"]');
  const r = card?.getBoundingClientRect();
  const els = [...document.querySelectorAll(controls)].filter((el) => el.offsetParent !== null);
  const overlaps = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  const covered = els.filter((el) => {
    const e = el.getBoundingClientRect();
    if (!r || !overlaps(e, r)) return false;
    const top = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
    return !el.contains(top);
  }).map((el) => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30));
  return {
    card: r ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null,
    onScreen: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    controls: els.length, covered,
    role: card?.getAttribute('role') ?? null, dialog: !!document.querySelector('[role="dialog"] [data-perf-tip-text]'),
    text: card?.querySelector('[data-perf-tip-text]')?.textContent ?? null,
  };
}, controls);

const VIEWER_CONTROLS = '[data-viewer-toolbar] button, [data-mode-button], [data-hud], [data-viewer-more]';

try {
  // ── 1. viewer.html from above: its own card ──
  await newContext();
  await openViewer('mode=view&people=1');
  await p.waitForSelector('[data-perf-tip="card"]', { timeout: 30000 }).catch(() => {});
  const c1 = await coverage(VIEWER_CONTROLS);
  log('SwiftShader, viewer.html: the tip\'s card shows by itself (role note, not a dialog), the text exactly, on screen',
    await cards() === 1 && c1.role === 'note' && !c1.dialog && c1.text === TIP && c1.onScreen
    && await p.locator('[data-weak-note]').count() === 0, JSON.stringify(c1));
  log('…it covers no toolbar control', c1.controls > 0 && c1.covered.length === 0, JSON.stringify(c1.covered));
  const s1 = await stored();
  log('…shown this visit (sessionStorage), not turned off', s1.shown === '1' && s1.off === null, JSON.stringify(s1));
  await shot('perf-tip-viewer-card.png');
  await p.click('[data-perf-tip-action="ok"]');
  await frames(2);
  log('Got it closes it', await cards() === 0);

  // ── 2. once per visit: a reload, slow frames later ──
  await openViewer('', { reload: true });
  await p.waitForTimeout(2500);
  log('a reload in the same tab (the same visit): no card', await cards() === 0 && await tipTexts() === 0);
  await p.evaluate(() => window.__ahdusViewer.emit('slow', { fps: 8 }));
  await frames(3);
  log('…slow frames found later this visit: still no card (at most once per visit)', await cards() === 0);

  // ── 3. More → Smoother 3D tips ──
  await p.click('[data-viewer-more]');
  await p.click('[data-more-item="perf-tip"]');
  await frames(2);
  const c3 = await coverage(VIEWER_CONTROLS);
  log('More → "Smoother 3D tips" opens it any time (shown already this visit)', await cards() === 1 && c3.text === TIP
    && (await p.locator('[data-more-item="perf-tip"]').count()) === 0, JSON.stringify(c3.card));
  await p.click('[data-perf-tip-action="ok"]');
  await frames(1);

  // ── 4. a weak start: ONE note with the tip in it ──
  await newContext();
  await openViewer('start=walk&people=1');
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const note = await p.evaluate(() => {
    const el = document.querySelector('[data-weak-note]');
    return {
      kind: el?.dataset.weakNote, reason: el?.querySelector('[data-weak-note-text]')?.textContent,
      tip: el?.querySelector('[data-perf-tip-text]')?.textContent, off: !!el?.querySelector('[data-perf-tip-action="off"]'),
      buttons: [...(el?.querySelectorAll('[data-weak-note-action]') ?? [])].map((x) => x.textContent.trim()),
    };
  });
  log('?start=walk on SwiftShader: one note: why it started from above + the tip + "Don\'t show again"; no card',
    note.kind === 'software' && note.reason === REASON && note.tip === TIP && note.off
    && note.buttons.join() === 'Walk anyway,Stay above' && await cards() === 0, JSON.stringify(note));
  await shot('perf-tip-weak-note.png');
  await p.click('[data-weak-note-action="stay"]');
  await frames(3);
  await p.waitForTimeout(2000);
  log('…Stay above: the note closes and no card follows it (one note, not two)', await cards() === 0
    && await p.locator('[data-weak-note]').count() === 0);

  // ── 5. Don't show again sticks ──
  await newContext();
  await openViewer('start=walk&people=1');
  await p.waitForSelector('[data-weak-note] [data-perf-tip-action="off"]', { timeout: 30000 }).catch(() => {});
  await p.click('[data-weak-note] [data-perf-tip-action="off"]');
  await frames(2);
  const s5 = await stored();
  log('the note\'s "Don\'t show again": the note closes, kept in this browser', await p.locator('[data-weak-note]').count() === 0
    && s5.off === '1', JSON.stringify(s5));
  const state = await ctx.storageState();
  await newContext({ storageState: state }); // a new visit: the same localStorage, a new session
  await openViewer('mode=view&people=1');
  await p.waitForTimeout(2500);
  log('a new visit (a new context with the same storage), from above: no card', await cards() === 0 && (await stored()).shown === null);
  await p.evaluate(() => window.__ahdusViewer.emit('slow', { fps: 8 }));
  await frames(3);
  log('…nor when slow frames are found', await cards() === 0);
  await openViewer('start=walk&people=1');
  await p.waitForSelector('[data-weak-note]', { timeout: 30000 }).catch(() => {});
  const plain = await p.evaluate(() => ({
    text: document.querySelector('[data-weak-note-text]')?.textContent, tip: !!document.querySelector('[data-perf-tip-text]'),
  }));
  log('…a weak start: the weak note as before v0.18.10 (its own words, no tip)',
    plain.text === `${REASON} Turn on graphics acceleration in your browser's settings for the smoothest view.` && !plain.tip,
    JSON.stringify(plain));
  await p.click('[data-weak-note-action="stay"]');
  await p.click('[data-viewer-more]');
  await p.click('[data-more-item="perf-tip"]');
  await frames(2);
  log('…More still opens it', await cards() === 1);

  // ── 6. walking: the card waits for the welcome card, then clear of the HUD ──
  await newContext();
  await openViewer('start=walk&weak=0&people=1');
  await p.waitForSelector('[data-welcome]', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  log('a walking start (the page says weak=0; SwiftShader still counts): the card waits while the welcome card shows',
    await p.locator('[data-welcome]').count() === 1 && await cards() === 0);
  await p.click('[data-welcome-action="explore"]');
  await p.waitForSelector('[data-perf-tip="card"]', { timeout: 15000 }).catch(() => {});
  await frames(3);
  const c6 = await coverage(VIEWER_CONTROLS);
  log('…Explore: the card, on screen, covering no toolbar or HUD control', await cards() === 1 && c6.onScreen
    && c6.covered.length === 0, JSON.stringify(c6));
  await shot('perf-tip-viewer-walking.png');

  // ── 7. a phone ──
  await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await openViewer('mode=view&people=1');
  await p.waitForSelector('[data-perf-tip="card"]', { timeout: 30000 }).catch(() => {});
  const c7 = await coverage(VIEWER_CONTROLS);
  log('a phone 390 × 844: the card full width at the bottom, on screen, covering no control',
    await cards() === 1 && c7.onScreen && c7.card && c7.card.left === 12 && c7.card.right === 378 && c7.card.bottom > 600
    && c7.covered.length === 0, JSON.stringify(c7));
  await shot('perf-tip-viewer-phone.png');
  await p.tap('[data-perf-tip-action="ok"]');
  await frames(1);
  log('…Got it by tap', await cards() === 0);

  // ── 8. Studio ──
  await newContext();
  await p.goto(base);
  await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
  await p.fill('input[placeholder="Company name…"]', 'Tip Co');
  await p.click('button:has-text("Create")');
  await p.waitForTimeout(400);
  if (await p.locator('input[placeholder="Layout name…"]').count() === 0) {
    await p.click('button:has-text("Tip Co")');
    await p.waitForTimeout(300);
  }
  await p.fill('input[placeholder="Layout name…"]', 'Tip Layout');
  await p.click('button:has-text("Create")');
  await p.waitForSelector('canvas', { timeout: 90000 });
  await p.waitForSelector('[aria-label="Add your first room"]', { timeout: 60000 });
  await p.waitForSelector('[data-perf-tip="card"]', { timeout: 30000 }).catch(() => {});
  await frames(3);
  const STUDIO_CONTROLS = '.canvas-card button, .canvas-footer *, .canvas-card [role="group"] button';
  const c8 = await coverage(STUDIO_CONTROLS);
  const footerClear = await p.evaluate(() => {
    const card = document.querySelector('[data-perf-tip="card"]')?.getBoundingClientRect();
    const hit = (el) => { const e = el.getBoundingClientRect(); return card && e.left < card.right && card.left < e.right && e.top < card.bottom && card.top < e.bottom; };
    return [...document.querySelectorAll('.canvas-footer > *, .canvas-card__controls, .empty-state > *')].filter((el) => el.offsetParent !== null && hit(el))
      .map((el) => el.className || el.tagName);
  });
  log('Studio on SwiftShader: the card once built, on screen, clear of the footer, the top controls and the empty state',
    await cards() === 1 && c8.text === TIP && c8.role === 'note' && c8.onScreen && c8.covered.length === 0 && footerClear.length === 0,
    JSON.stringify({ ...c8, footerClear }));
  await shot('perf-tip-studio-card.png');
  await p.click('[data-perf-tip-action="ok"]');
  await frames(1);
  log('…Got it closes it', await cards() === 0);
  await p.click('[aria-label="Settings"]');
  await p.click('[data-settings-perf-tip]');
  await frames(2);
  log('Settings → "Smoother 3D tips" opens it, the Settings popover closed', await cards() === 1
    && await p.locator('.settings-pop').count() === 0);
  await shot('perf-tip-studio-settings.png');
  // a phone: the card at the top, clear of the floor switcher, the camera card, the hint and the lower view
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(400);
  await frames(3);
  const phone = await p.evaluate(() => {
    const card = document.querySelector('[data-perf-tip="card"]')?.getBoundingClientRect();
    const canvas = document.querySelector('canvas')?.getBoundingClientRect();
    const hit = (e) => card && e.width && e.left < card.right && card.left < e.right && e.top < card.bottom && card.top < e.bottom;
    const over = [...document.querySelectorAll('.canvas-footer > *, .canvas-card .camera-controls, .canvas-card [class*="camera"], [data-studio="hint"]')]
      .filter((el) => el.offsetParent !== null && hit(el.getBoundingClientRect())).map((el) => el.className || el.tagName);
    return {
      card: card && { left: Math.round(card.left), top: Math.round(card.top), right: Math.round(card.right), bottom: Math.round(card.bottom) },
      over, onScreen: !!card && card.left >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
      // the lower half of the view (where the first touches go) stays clear
      lowerClear: !!card && !!canvas && card.bottom <= canvas.top + canvas.height * 0.6,
      // its buttons on top (nothing drawn over them: the empty state sits behind)
      onTop: [...document.querySelectorAll('[data-perf-tip-action]')].every((el) => {
        const e = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2));
      }),
    };
  });
  log('Studio on a phone 390 × 844: the card at the top of the view, on top, clear of the floor switcher, camera card and hint',
    await cards() === 1 && phone.onScreen && phone.over.length === 0 && phone.lowerClear && phone.onTop, JSON.stringify(phone));
  await shot('perf-tip-studio-phone.png');
  await p.setViewportSize(desktop);
  await p.waitForTimeout(400);
  await p.click('[data-perf-tip-action="off"]');
  await frames(1);
  const s8 = await stored();
  log('…Don\'t show again: closed, kept', await cards() === 0 && s8.off === '1', JSON.stringify(s8));
  await p.evaluate(() => { try { sessionStorage.clear(); } catch { /* blocked */ } });
  await p.reload();
  // a reload opens the companies list: open the layout again
  await p.click('button:has-text("Tip Co")', { timeout: 90000 });
  await p.click('text=Tip Layout', { timeout: 30000 });
  await p.waitForSelector('[aria-label="Add your first room"]', { timeout: 90000 });
  await p.waitForTimeout(4000);
  log('…after a reload with a new session (a new visit): no card in Studio', await cards() === 0);
} catch (e) {
  log('script', false, e.message);
  await p?.screenshot({ path: join(shotDir, 'perf-tip-failed.png') }).catch(() => {});
} finally {
  await b.close();
}
