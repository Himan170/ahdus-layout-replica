// Team-integration smoke test: runs the app with ?demoModules=1 (fake Harsh,
// Karthik and Yashashwi modules) and checks the layout talks to them:
// "Press E" prompts and actions, enter/exit-room events, the greeter placed at
// the reception hook point, and linking a desk to a job position (with undo).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:modules    (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000/';
const url = `${base}${base.includes('?') ? '&' : '?'}demoModules=1`;
const exe = process.env.CHROME; // optional: path to a Chromium binary
mkdirSync('e2e/screens', { recursive: true });

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${ok ? 'pass' : 'FAIL'}  ${step}  ${detail}`);
};
process.on('exit', () => {
  for (const e of errs.slice(0, 6)) console.log('ERR ' + e.slice(0, 300));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  ${r.detail}`);
});

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0; let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(); });
  function done() { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(); }
  t = setTimeout(done, 20000);
}), n);
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.__ahdusPlay.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const events = (name) => p.evaluate((n) => (window.__ahdusEventLog ?? []).filter((e) => e.event === n).map((e) => e.payload), name);
const promptText = () => p.locator('[data-hud="prompt"]').textContent({ timeout: 2000 }).catch(() => '');
// Last card shown (recorded by the dev build), so slow machines can't miss a card that already timed out
const cardText = () => p.evaluate(() => {
  const c = (window.__ahdusCards ?? []).at(-1);
  return c ? `${c.title} ${c.text}` : '';
});
const anchorData = () => p.evaluate(() => window.__ahdusStore.getState().anchorData);

/** Stand so the crosshair (camera is 0.85 m over the right shoulder) lines up
 *  with x = targetX while facing -Z, then tilt down until the prompt matches. */
async function lookAt(targetX, standZ, re) {
  const yaw = Math.PI; // facing -Z: the shoulder camera sits 0.85 m towards -X
  for (const pitch of [-0.3, -0.2, -0.4, -0.15, -0.5, -0.1, -0.6, -0.05]) {
    await pose(targetX + 0.85, standZ, yaw, pitch);
    // the on-screen prompt can lag a few frames behind on a slow machine
    for (let i = 0; i < 8; i++) {
      const t = await promptText();
      if (re.test(t)) return t;
      await wait(500);
    }
  }
  return await promptText();
}

// ── Open the app with demo modules ──
await p.goto(url);
await p.waitForSelector('input[placeholder="Company name…"]', { timeout: 90000 });
await p.fill('input[placeholder="Company name…"]', 'Modules Co'); await p.click('button:has-text("Create")'); await wait(400);
await p.fill('input[placeholder="Layout name…"]', 'Main'); await p.click('button:has-text("Create")');
await p.waitForSelector('canvas', { timeout: 90000 }); await wait(2500);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2));
await p.mouse.move(640, 360);
// The editor opens in Workplace Studio; this test covers Preview
await p.click('[aria-label="Preview Workplace"]'); await wait(800);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")'); await wait(400);
}
log('demo modules are loaded', await p.locator('text=Demo modules on').isVisible());

// ── Set up a small company directly in the store (building is covered by play-smoke) ──
const ids = await p.evaluate(() => {
  const st = window.__ahdusStore.getState();
  const reception = st.addRoom({ type: 'RECEPTION', name: 'Reception', x: 0, z: 0, width: 8, depth: 6 }).id;
  const office = st.addRoom({ type: 'OFFICE', name: 'Engineering', x: 12, z: 0, width: 8, depth: 6 }).id;
  const recepDesk = st.addObject({ assetType: 'RECEPTION_DESK', x: 0, z: -1, roomId: reception }).id;
  const cnc = st.addObject({ assetType: 'CNC_MACHINE', x: 13, z: -1.5, roomId: office }).id;
  const desk = st.addObject({ assetType: 'DESK_STANDARD', x: 9.5, z: -1, roomId: office }).id;
  return { reception, office, recepDesk, cnc, desk };
});
await frames(4);
const anchorsEvents = await events('anchorsChange');
log('adding objects announces new hook points (anchorsChange)', anchorsEvents.length > 0 &&
  anchorsEvents.at(-1).anchors.some((a) => a.kind === 'machine' && a.objectId === ids.cnc),
  `${anchorsEvents.length} event(s)`);

// Harsh demo: a greeter stands behind the reception desk (anchor z = -1 + 1.2 = 0.2; 2 m on → z = -1.8)
const greeter = await p.evaluate(() => {
  const n = window.__ahdusScene.transformNodes.find((t) => t.name.startsWith('demo_greeter_'));
  return n ? { x: n.position.x, z: n.position.z } : null;
});
log('Harsh demo: greeter placed behind the reception desk from its hook point',
  !!greeter && Math.abs(greeter.x) < 0.01 && Math.abs(greeter.z + 1.8) < 0.01, JSON.stringify(greeter));

// ── Walk in and out of rooms ──
await pose(0, -9, 0, 0);                 // outside
await pose(0, 1.5, Math.PI, -0.3);       // inside Reception
await frames(3);
const entered = await events('enterRoom');
log('entering a room sends enterRoom', entered.some((e) => e.roomId === ids.reception && e.room?.type === 'RECEPTION'),
  JSON.stringify(entered.map((e) => e.room?.name)));
log('Harsh demo: greeting card on entering Reception', /Welcome to Reception/.test(await cardText()), await cardText());

// ── Press E: reception desk → Harsh demo ──
let prompt = await lookAt(0, 1.5, /Talk to HR/);
log('looking at the reception desk shows "E Talk to HR"', /Talk to HR/.test(prompt), prompt);
await shot('m1-reception-prompt.png');
await p.keyboard.press('KeyE'); await frames(3);
let card = await cardText();
let inter = (await events('interact')).at(-1);
log('E on the reception desk runs Harsh\'s action and sends interact', /conversation/.test(card) &&
  inter?.anchorKind === 'reception' && inter?.objectId === ids.recepDesk, `${card.slice(0, 60)} | ${inter?.anchorKind}`);

// ── Press E: CNC machine → Karthik demo ──
await pose(12, 1.5, Math.PI, 0);
prompt = await lookAt(13, 1.2, /Watch CNC Machine video/);
log('looking at the CNC machine shows "E Watch CNC Machine video"', /Watch CNC Machine video/.test(prompt), prompt);
await shot('m2-cnc-prompt.png');
await p.keyboard.press('KeyE'); await frames(3);
card = await cardText();
inter = (await events('interact')).at(-1);
log('E on the machine runs Karthik\'s action with the machine\'s IDs', /operation video/.test(card) &&
  inter?.anchorKind === 'machine' && inter?.objectId === ids.cnc && inter?.room?.name === 'Engineering',
  `${card.slice(0, 50)} | ${inter?.objectId}`);
await shot('m3-cnc-card.png');
const exited = await events('exitRoom');
log('leaving a room sends exitRoom', exited.some((e) => e.roomId === ids.reception && e.toRoomId === ids.office),
  JSON.stringify(exited.map((e) => `${e.room?.name} → ${e.toRoomId}`)));

// ── An unlinked desk has no handover action yet ──
prompt = await lookAt(9.5, 1.2, /Details|handover/);
log('an unlinked desk offers only "Details"', /Details/.test(prompt) && !/handover/.test(prompt), prompt);

// ── Studio: link the desk to a position, undo, redo ──
await p.keyboard.press('Tab'); await wait(1500);
await p.evaluate((id) => {
  const st = window.__ahdusStore.getState();
  st.selectObject(id);
}, ids.desk);
await wait(800);
const select = p.locator('select[aria-label="Linked position"]');
const hasDropdown = await select.isVisible().catch(() => false);
log('the Inspector shows a "Linked position" dropdown with Yashashwi\'s positions', hasDropdown &&
  (await select.locator('option').allTextContents()).some((t) => /Engineering Head/.test(t)));
await shot('m4-planner-link.png');
await select.selectOption('pos-eng-head');
await p.evaluate(() => document.activeElement.blur());
await wait(400);
let data = await anchorData();
log('choosing a position saves the link on the desk\'s hook point',
  Object.values(data).some((d) => d.positionRef === 'pos-eng-head'), JSON.stringify(data));
await p.keyboard.press('Control+z'); await wait(400);
const afterUndo = await anchorData();
await p.keyboard.press('Control+y'); await wait(400);
data = await anchorData();
log('Ctrl+Z / Ctrl+Y undo and redo the link', Object.keys(afterUndo).length === 0 &&
  Object.values(data).some((d) => d.positionRef === 'pos-eng-head'));

// ── Back to Preview: E on the linked desk → Yashashwi demo ──
await p.keyboard.press('Tab'); await wait(1500);
await p.mouse.move(640, 360);
if (!(await p.evaluate(() => !!document.pointerLockElement))) {
  await p.click('button:has-text("Start preview")').catch(() => {}); await wait(400);
}
prompt = await lookAt(9.5, 1.2, /See handover notes/);
log('the linked desk now offers "E See handover notes"', /See handover notes/.test(prompt), prompt);
await p.keyboard.press('KeyE'); await frames(3);
card = await cardText();
log('E shows the previous employee\'s handover for that position', /Engineering Head/.test(card) && /Rahul/.test(card), card.slice(0, 80));
await shot('m5-handover.png');

log('no page errors', errs.length === 0);
await b.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
