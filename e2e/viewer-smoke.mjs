// Viewer smoke test: the blank page viewer.html mounts <LayoutViewer mode="walkthrough" />
// with no Workplace Studio code, draws a layout, walks into rooms (enterRoom), presses E
// (interact + a teammate's "Press E" action through layoutBridge), refuses every edit,
// changes floor, switches to view mode, and opens a layout saved in the browser.
// The production bundle of viewer.html is checked for Studio code too (vite build).
//
// One-time setup:   npx playwright install chromium
// Run:              npm run dev            (in one terminal)
//                   npm run e2e:viewer     (in another)
// Screenshots go to e2e/screens/. Exits with code 1 if any check fails.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:3000/';
const exe = process.env.CHROME; // optional: path to a Chromium binary
mkdirSync('e2e/screens', { recursive: true });
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

// ── 0. The production bundle of viewer.html has no Studio code ──
// (Studio's UI texts are only in its own chunk; the viewer loads its chunk and the shared engine)
execSync('npx vite build --logLevel error', { stdio: 'inherit' });
const viewerHtml = readFileSync('dist/viewer.html', 'utf8');
const chunks = [...viewerHtml.matchAll(/assets\/[^"]+\.(?:js|css)/g)].map((m) => m[0]);
const STUDIO = /Add your first room|Floor switcher|All layouts/;
const withStudio = chunks.filter((c) => STUDIO.test(readFileSync(`dist/${c}`, 'utf8')));
const appHasStudio = [...readFileSync('dist/index.html', 'utf8').matchAll(/assets\/[^"]+\.js/g)]
  .some((m) => STUDIO.test(readFileSync(`dist/${m[0]}`, 'utf8')));
log('viewer.html\'s bundle has no Studio code (and no stylesheet)', appHasStudio && withStudio.length === 0 && !chunks.some((c) => c.endsWith('.css')),
  `${chunks.join(', ')}${withStudio.length ? ` | Studio in: ${withStudio}` : ''}`);

const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BJS')) errs.push(m.text()); });
const requests = [];
p.on('request', (r) => requests.push(new URL(r.url()).pathname));

const wait = (ms) => p.waitForTimeout(ms);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => {
  const sc = window.__ahdusScene; let c = 0;
  let t = null;
  const o = sc.onAfterRenderObservable.add(() => { if (++c >= n) done(true); });
  function done(ok) { sc.onAfterRenderObservable.remove(o); clearTimeout(t); res(ok); }
  t = setTimeout(() => done(false), 20000);
}), n).then((ok) => { if (!ok) console.error('  (no frames rendered for 20 s)'); });
const pose = async (x, z, yaw, pitch) => { await p.evaluate((a) => window.__ahdusViewer.walkthrough.setPose(a), { x, z, yaw, pitch }); await frames(3); };
const pos = () => p.evaluate(() => { const v = window.__ahdusViewer.walkthrough.getPosition(); return { x: v.x, z: v.z }; });
const walkUntil = async (key, done, maxMs = 25000) => {
  const start = Date.now();
  await p.keyboard.down(key);
  while (Date.now() - start < maxMs && !done(await pos())) await wait(250);
  await p.keyboard.up(key);
  await frames(2);
};
const events = (name) => p.evaluate((n) => (window.__viewerEvents ?? []).filter((e) => e.event === n).map((e) => e.payload), name);
const cardText = () => p.evaluate(() => { const c = (window.__ahdusCards ?? []).at(-1); return c ? `${c.title} ${c.text}` : ''; });
const promptText = () => p.locator('[data-hud="prompt"]').textContent({ timeout: 2000 }).catch(() => '');
const layoutJson = () => p.evaluate(() => JSON.stringify(window.__ahdusViewer.getLayout()));
const shot = (name) => p.screenshot({ path: `e2e/screens/${name}`, timeout: 120000 });
const ready = (rooms) => p.waitForFunction((n) => window.__ahdusViewer?.rooms.meshes.size === n, rooms, { timeout: 90000 });

/** Stand so the crosshair (the camera is 0.85 m over the right shoulder) is on x = targetX facing -Z, then tilt until the prompt matches. */
async function lookAt(targetX, standZ, re) {
  for (const pitch of [-0.3, -0.2, -0.4, -0.15, -0.5, -0.1, -0.6]) {
    await pose(targetX + 0.85, standZ, Math.PI, pitch);
    for (let i = 0; i < 8; i++) {
      const t = await promptText();
      if (re.test(t)) return t;
      await wait(500);
    }
  }
  return promptText();
}

// ── 1. The page: the sample company, walking through, with the teammates' demo modules ──
await p.goto(new URL('viewer.html?demoModules=1', base).href);
await ready(3);
await p.evaluate(() => window.__ahdusScene.getEngine().setHardwareScalingLevel(2)); // fast without a GPU
await frames(3);
const drawn = await p.evaluate(() => ({
  rooms: window.__ahdusViewer.rooms.meshes.size, items: window.__ahdusViewer.objects.meshes.size, mode: window.__ahdusViewer.mode,
}));
log('viewer.html draws the layout (3 rooms on 2 floors, 6 items) in walkthrough mode',
  drawn.rooms === 3 && drawn.items === 6 && drawn.mode === 'walkthrough', JSON.stringify(drawn));
const studioFiles = requests.filter((u) => /\/src\/(components|ui|planner)\//.test(u) || /WorkplaceEditor|StudioPanel/.test(u));
log('no Studio code is loaded (dev server)', studioFiles.length === 0 && requests.some((u) => u.includes('LayoutViewer')),
  studioFiles.slice(0, 3).join(', ') || `${requests.filter((u) => u.startsWith('/src/')).length} source files`);
const bridge = await p.evaluate(() => ({
  rooms: window.ahdus.getRooms().map((r) => r.name).sort(),
  machine: window.ahdus.getAnchors({ kind: 'machine' })[0]?.objectId,
  scene: window.ahdus.getScene() === window.__ahdusViewer.scene,
}));
log('layoutBridge reads the viewer\'s layout (rooms, anchors, scene)',
  bridge.rooms.join() === 'Engineering,Meeting room,Reception' && bridge.machine === 'obj_cnc' && bridge.scene, JSON.stringify(bridge));

// ── 2. Walk in through the door: enterRoom ──
// v0.14.0: no click needed (a click on the floor would walk there): the view has the keys, the mouse stays free
await p.mouse.move(500, 360);
await wait(500);
log('walking: the view has the keys without a click, and never captures the mouse by itself',
  await p.evaluate(() => !document.pointerLockElement && !!document.activeElement?.closest('[data-layout-viewer]')));

// Where walking starts (v0.13.0): the ground floor, 3 m outside the main entrance (the Reception's door), facing it.
// It is outside: the page opened walking, and no room event came before anything moved the character.
const startEvents = (await events('enterRoom')).length + (await events('exitRoom')).length;
const start = await p.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { level: w.getLevel(), x: +v.x.toFixed(3), z: +v.z.toFixed(3), yaw: +w.getYaw().toFixed(3), free: w.isFree(v.x, v.z, 0),
    source: w.spawnPoint().source, button: !!document.querySelector('[data-hud="entrance"]') };
});
log('walking starts on the ground floor, 3 m outside the Reception door, facing it; "Back to entrance" shows',
  start.level === 0 && Math.abs(start.x) < 0.05 && Math.abs(start.z + 6.075) < 0.05 && Math.abs(start.yaw) < 0.01 &&
  start.free && start.source === 'entrance' && start.button && startEvents === 0, `${JSON.stringify(start)} | room events ${startEvents}`);
await pose(12, 1.5, Math.PI, 0);
await p.keyboard.press('Home'); await frames(3);
const home = await pos();
log('Home takes you back to the entrance', Math.abs(home.x) < 0.05 && Math.abs(home.z + 6.075) < 0.05, JSON.stringify(home));
await pose(13, -1.5, 0, 0); // the CNC machine's middle
const beside = await p.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { x: +v.x.toFixed(2), z: +v.z.toFixed(2), free: w.isFree(v.x, v.z, 0) };
});
log('setPose into a machine lands on the nearest free spot beside it', beside.free && Math.hypot(beside.x - 13, beside.z + 1.5) > 1, JSON.stringify(beside));

await pose(0, -7, 0, 0); // outside, south of the Reception door, facing it
await walkUntil('KeyW', ({ z }) => z > -2.5); // through the door (south wall at z = -3); the reception desk stops you at about -1.75
const at = await pos();
await frames(3);
const entered = await events('enterRoom');
log('walking in through the door sends enterRoom (with the room) and the HUD names it',
  at.z > -2.5 && entered.some((e) => e.roomId === 'room_reception' && e.room?.name === 'Reception') &&
  (await p.locator('[data-hud="room"]').textContent()) === 'Reception',
  `z=${at.z.toFixed(2)} | ${entered.map((e) => e.room?.name).join(',')}`);
await shot('viewer-walkthrough.png');

// ── 3. E on the CNC machine: interact, and Karthik's demo action runs in the viewer ──
await pose(12, 1.5, Math.PI, 0); // inside Engineering
const prompt = await lookAt(13, 1.2, /Watch CNC Machine video/);
log('looking at the CNC machine shows "E Watch CNC Machine video"', /Watch CNC Machine video/.test(prompt), prompt);
await p.keyboard.press('KeyE'); await frames(3);
const inter = (await events('interact')).at(-1);
const card = await cardText();
log('E sends interact with the machine\'s ids and runs the module\'s action',
  inter?.objectId === 'obj_cnc' && inter?.anchorKind === 'machine' && inter?.room?.name === 'Engineering' && /operation video/.test(card),
  `${inter?.objectId} ${inter?.anchorKind} | ${card.slice(0, 50)}`);
await shot('viewer-interact.png');

// ── 4. Nothing can change the layout ──
const before = await layoutJson();
await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await frames(3); // "remove" what you look at
await p.keyboard.press('KeyN'); await frames(3);                                                // "add a floor"
const refused = await p.evaluate(() => {
  const v = window.__ahdusViewer;
  const ws = window.ahdus.getAnchors({ kind: 'workstation' })[0];
  return {
    addRoom: v.editor.addRoom({ type: 'OFFICE', x: 30, z: 0, width: 4, depth: 4 }),
    deleteObject: v.editor.deleteObject('obj_cnc'),
    undo: v.undo(),
    positionRef: window.ahdus.setPositionRef(ws.id, 'POS-1'),
  };
});
log('right-click and N change nothing; editor commands, undo and the bridge\'s writes are refused',
  (await layoutJson()) === before && refused.addRoom?.problem && refused.deleteObject?.problem && refused.undo === false && refused.positionRef === false,
  JSON.stringify(refused));

// ── 5. Page Up: the floor above ──
await p.keyboard.press('PageUp'); await frames(4);
const level = await p.evaluate(() => window.__ahdusViewer.walkthrough.getLevel());
log('Page Up takes you to Floor 1', level === 1, `level ${level} | ${await p.locator('[data-hud="floor"]').textContent().catch(() => '')}`);

// ── 6. View mode: orbit camera, still read-only ──
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
await p.click('button:has-text("View")'); await frames(4);
const view = await p.evaluate(() => ({
  mode: window.__ahdusViewer.mode,
  walking: window.__ahdusViewer.walkthrough.isActive(),
  camera: window.__ahdusScene.activeCamera?.name,
  refused: !!window.__ahdusViewer.editor.addRoom({ type: 'OFFICE', x: 30, z: 0, width: 4, depth: 4 })?.problem,
}));
log('"View" switches to the orbit camera; edits are still refused',
  view.mode === 'view' && !view.walking && view.camera === 'mainCamera' && view.refused, JSON.stringify(view));
await shot('viewer-view.png');

// Walking again while Floor 1 is shown from above: straight to the entrance, no room entered on the way
await p.evaluate(() => { window.__ahdusViewer.getStore().getState().selectFloor(1); window.__viewerEvents = []; });
await frames(3);
await p.click('button:has-text("Walk through")'); await frames(6);
const again = await p.evaluate(() => {
  const w = window.__ahdusViewer.walkthrough; const v = w.getPosition();
  return { level: w.getLevel(), x: +v.x.toFixed(3), z: +v.z.toFixed(3), room: w.getRoomId(),
    roomEvents: (window.__viewerEvents ?? []).filter((e) => e.event === 'enterRoom' || e.event === 'exitRoom').length };
});
log('walking again with Floor 1 shown starts at the entrance on the ground floor, with no enterRoom / exitRoom',
  again.level === 0 && Math.abs(again.x) < 0.05 && Math.abs(again.z + 6.075) < 0.05 && again.room === null && again.roomEvents === 0,
  JSON.stringify(again));
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
await p.click('button:has-text("View")'); await frames(3);

// ── 7. A layout saved in this browser (companyId + layoutId) ──
await p.evaluate(() => {
  const save = {
    companyId: 'co_viewer', layoutId: 'lay_viewer', layoutName: 'Saved one', layoutVersion: 1, revision: 1,
    floors: { 0: { id: 0, name: 'Ground Floor', height: 3.5 } },
    rooms: [{ id: 'room_saved', type: 'OFFICE', name: 'Saved office', floor: 0, x: 0, z: 0, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [] }],
    objects: [], anchorData: {},
  };
  localStorage.setItem('dwtwin_co_viewer_lay_viewer', JSON.stringify(save));
});
await p.goto(new URL('viewer.html?companyId=co_viewer&layoutId=lay_viewer&mode=view', base).href);
await ready(1);
const saved = await p.evaluate(() => ({ rooms: window.ahdus.getRooms().map((r) => r.name), mode: window.__ahdusViewer.mode }));
log('?companyId=…&layoutId=… opens a layout saved in this browser', saved.rooms.join() === 'Saved office' && saved.mode === 'view', JSON.stringify(saved));
await p.evaluate(() => localStorage.removeItem('dwtwin_co_viewer_lay_viewer'));

await p.goto(new URL('viewer.html?companyId=co_viewer&layoutId=nope', base).href);
const alert = await p.locator('[role="alert"]').textContent({ timeout: 90000 }).catch(() => '');
log('a layout that doesn\'t exist says so', /no longer exists/.test(alert), alert);

// ── 8. Search: "Find a person, room or place" (v0.13.3) ──
await p.goto(new URL('viewer.html?mode=view&people=1', base).href);
await ready(3);
await frames(3);
const SEARCH = '[aria-label="Find a person, room or place"]';
await p.click(`button${SEARCH}`);
const opened = await p.evaluate(() => {
  const a = document.activeElement;
  return { focus: a?.getAttribute('role'), label: a?.getAttribute('aria-label'), quick: [...document.querySelectorAll('[data-quick]')].map((q) => q.textContent) };
});
log('the toolbar button opens the search box, the focus in it (a combobox), with quick picks of the kinds there are (no washroom here)',
  opened.focus === 'combobox' && opened.label === 'Find a person, room or place' && opened.quick.join() === 'Meeting room,Reception,Stairs',
  JSON.stringify(opened));
// The browse menu (v0.14.2): built from the layout and the seats; the keys work through it
const browse = await p.evaluate(() => ({
  view: document.querySelector('[data-browse]')?.dataset.browse,
  groups: [...document.querySelectorAll('[data-browse-group]')].map((g) => g.dataset.browseGroup).filter((g) => g !== 'recent'),
  open: [...document.querySelectorAll('[data-browse-open]')].map((o) => `${o.dataset.browseOpen}=${o.innerText.split('\n').slice(0, 2).join(' · ')}`),
}));
log('an empty box is a browse menu: the company tour first (v0.14.4), departments (from the seats), places by kind, by floor; nothing this layout lacks',
  browse.view === 'home' && browse.groups.join() === 'tour,quick,departments,kinds,floors' && browse.open.join() === [
    // v0.14.9: Asha is the only one seated in the Engineering room, so it is the department's room
    'department:engineering=Engineering · 1 room · Ground Floor · 1 person', 'department:hr=HR · Ground Floor · 1 person',
    'kind:OFFICE=Offices · Ground Floor', 'kind:MEETING=Meeting rooms · Floor 1', 'kind:RECEPTION=Reception · Ground Floor',
    'kind:STAIRCASE=Stairs · Ground Floor', 'floor:0=Ground Floor · 2 rooms', 'floor:1=Floor 1 · 1 room'].join(), JSON.stringify(browse));
for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowDown'); // past the tour and the 3 chips: Engineering
await p.keyboard.press('Enter');
const dept = await p.evaluate(() => {
  const input = document.querySelector('[data-place-search] input');
  return {
    view: document.querySelector('[data-browse]')?.dataset.browse, head: document.querySelector('[data-browse-head]')?.innerText.replace(/\n/g, ' | '),
    active: document.getElementById(input.getAttribute('aria-activedescendant'))?.dataset.place,
    status: document.querySelector('[data-search-status]').textContent,
  };
});
await p.keyboard.press('Escape');
const back = await p.evaluate(() => {
  const input = document.querySelector('[data-place-search] input');
  return { view: document.querySelector('[data-browse]')?.dataset.browse, active: document.getElementById(input.getAttribute('aria-activedescendant'))?.dataset.browseOpen };
});
log('↓ Enter opens Engineering (its room first, v0.14.9: from Asha\'s seat; the status says what it is); Esc goes back to it, the box stays open',
  dept.view === 'department' && dept.head === 'Engineering | 1 room · Ground Floor · 1 person' && dept.active === 'room:room_engineering' &&
  dept.status === 'Engineering: 1 room · Ground Floor · 1 person' && back.view === 'home' && back.active === 'department:engineering',
  JSON.stringify({ dept, back }));
await p.keyboard.type('kav');
const kav = await p.evaluate(() => {
  const input = document.querySelector('[data-place-search] input');
  const opts = [...document.querySelectorAll('[data-place-search] [role="option"]')];
  return {
    options: opts.map((o) => o.innerText.replace(/\n/g, ' | ')), selected: opts.map((o) => o.getAttribute('aria-selected')),
    active: input.getAttribute('aria-activedescendant') === opts[0]?.id, status: document.querySelector('[data-search-status]').textContent,
    groups: [...document.querySelectorAll('[data-place-search] [role="group"]')].map((g) => g.dataset.group),
    email: /@example\.com/.test(document.body.innerHTML),
  };
});
log('typing "kav" finds Kavya Iyer under People, with her department, floor and room; no email anywhere',
  kav.options.join() === 'Kavya Iyer | HR · Ground Floor, Reception' && kav.selected.join() === 'true' && kav.active &&
  kav.groups.join() === 'people' && kav.status === '1 result' && !kav.email, JSON.stringify(kav));
// One keystroke: from the input event to the results in the page
const keyMs = await p.evaluate(async () => {
  const input = document.querySelector('[data-place-search] input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const times = [];
  for (const v of ['m', 'me', 'mee', 'meet', 'meeti', 'meetin', 'meeting']) {
    const t0 = performance.now();
    set.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    times.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 20));
  }
  return Math.max(...times);
});
const meeting = await p.evaluate(() => [...document.querySelectorAll('[data-place-search] [role="group"]')]
  .map((g) => `${g.dataset.group}: ${[...g.querySelectorAll('[role="option"]')].map((o) => o.innerText.replace(/\n/g, ' | ')).join(' ; ')}`));
log('"meeting" lists the meeting room under Facilities; each keystroke well under 50 ms',
  meeting.join() === 'facilities: Meeting room | Meeting room · Floor 1' && keyMs < 50, `${meeting.join()} | slowest key ${keyMs.toFixed(1)} ms`);
await p.keyboard.press('Enter');
await frames(8);
const shownMeeting = await p.evaluate(() => ({
  shown: document.querySelector('[data-place-shown]')?.innerText.replace(/\n/g, ' | '), panel: !!document.querySelector('[data-place-search]'),
  floor: window.__ahdusViewer.getStore().getState().currentFloor, lit: window.__ahdusViewer.highlights.ids(),
  focus: document.activeElement?.getAttribute('aria-label'),
}));
log('Enter shows it: its floor (Floor 1), outlined; the box closes, the focus back on the button',
  shownMeeting.shown === 'Meeting room | Meeting room · Floor 1 | Show route | Take me there' && !shownMeeting.panel && shownMeeting.floor === 1 &&
  shownMeeting.lit.join() === 'room_meeting' && shownMeeting.focus === 'Find a person, room or place', JSON.stringify(shownMeeting));
await p.click(`button${SEARCH}`);
await p.fill('[data-place-search] input', 'Engineering');
await p.keyboard.press('ArrowDown');
const eng = await p.evaluate(() => ({
  options: [...document.querySelectorAll('[data-place-search] [role="option"]')].map((o) => `${o.getAttribute('aria-selected')}:${o.innerText.split('\n')[0]}`),
}));
log('"Engineering": the Engineering room (Rooms) first, then Asha Patel (People); ↓ chooses the next one',
  eng.options.join() === 'false:Engineering,true:Asha Patel', JSON.stringify(eng));
await p.keyboard.press('Enter');
await frames(10);
const asha = await p.evaluate(() => {
  const v = window.__ahdusViewer; const t = v.scene.activeCamera.target;
  return { floor: v.getStore().getState().currentFloor, lit: v.highlights.ids(), target: [+t.x.toFixed(1), +t.z.toFixed(1)], shown: document.querySelector('[data-place-shown]')?.innerText.split('\n')[0] };
});
log('picking Asha Patel: the ground floor, the camera on the desk, desk and chair outlined',
  asha.floor === 0 && asha.lit.join() === 'obj_desk,obj_chair' && Math.hypot(asha.target[0] - 9.5, asha.target[1] + 0.8) < 1.5 && asha.shown === 'Asha Patel',
  JSON.stringify(asha));
await shot('viewer-search-shown.png');
await p.click('button[aria-label="Clear the place found"]');
const cleared = await p.evaluate(() => ({ lit: window.__ahdusViewer.highlights.ids().length, shown: !!document.querySelector('[data-place-shown]') }));
log('"Clear" takes the outline away', cleared.lit === 0 && !cleared.shown, JSON.stringify(cleared));
await p.click(`button${SEARCH}`);
const recent = await p.evaluate(() => ({ list: [...document.querySelectorAll('[data-recent]')].map((o) => o.dataset.place), kept: localStorage.getItem('ahdus.findRecent') }));
log('the recent searches: newest first, kept in this browser', recent.list.join() === 'person:p_asha,room:room_meeting' &&
  recent.kept === '["person:p_asha","room:room_meeting"]', JSON.stringify(recent));
await p.fill('[data-place-search] input', 'zzzz');
const none = await p.locator('[data-search-status]').textContent();
await p.keyboard.press('Escape');
const esc = await p.evaluate(() => ({ panel: !!document.querySelector('[data-place-search]'), focus: document.activeElement?.getAttribute('aria-label') }));
log('nothing found says so; Esc closes the box (focus back on the button)',
  /Nothing found for “zzzz”/.test(none) && !esc.panel && esc.focus === 'Find a person, room or place', `${none} | ${JSON.stringify(esc)}`);

// Walking: typing in the box doesn't walk; picking measures the walk there
await p.click('button:has-text("Walk through")'); await frames(6);
await p.evaluate(() => document.exitPointerLock?.()); await wait(300);
const startPos = await pos();
await p.click(`button${SEARCH}`);
await p.keyboard.type('wwwwsssskavya', { delay: 15 }); // W / S in the box: letters, not steps
await frames(4);
const stillPos = await pos();
await p.fill('[data-place-search] input', 'Kavya');
await p.keyboard.press('Enter');
await frames(3);
const walkInfo = await p.evaluate(() => ({ text: document.querySelector('[data-place-shown]')?.innerText.replace(/\n/g, ' | '), lit: window.__ahdusViewer.highlights.ids(), mode: window.__ahdusViewer.mode }));
log('walking: W / S typed in the box don\'t move you; picking Kavya outlines her desk and says how far it is to walk',
  Math.hypot(stillPos.x - startPos.x, stillPos.z - startPos.z) < 0.05 && walkInfo.mode === 'walkthrough' &&
  /^Kavya Iyer \| HR · Ground Floor, Reception \| \d+ m walk, about \d+ (s|min) \| Show route \| Take me there$/.test(walkInfo.text ?? '') && walkInfo.lit.join() === 'obj_reception_desk',
  JSON.stringify({ startPos, stillPos, ...walkInfo }));
await p.click(`button${SEARCH}`);
const chips = await p.evaluate(() => [...document.querySelectorAll('[data-quick]')].map((q) => q.textContent));
log('walking, the chips are the nearest of each kind and the walk there ("Nearest stairs · 7 m")',
  chips.length === 3 && /^Nearest meeting room · \d+ m$/.test(chips[0]) && /^Nearest reception · \d+ m$/.test(chips[1]) && /^Nearest stairs · \d+ m$/.test(chips[2]),
  JSON.stringify(chips));
await p.fill('[data-place-search] input', 'meeting');
await p.keyboard.press('Enter');
await frames(3);
const upstairs = await p.locator('[data-place-shown] [data-walk]').textContent().catch(() => '');
log('walking: "meeting" + Enter = the nearest meeting room, upstairs: the walk there, by the stairs (the sample has a route to every room)',
  /^\d+ m walk, about \d+ (s|min) · by the stairs$/.test(upstairs), upstairs);
await shot('viewer-search-walking.png');
await p.click('button:has-text("View")'); await frames(3);

await p.goto(new URL('viewer.html?mode=view&search=0', base).href);
await ready(3);
log('search={false} (viewer.html?search=0): no search button', (await p.locator(`button${SEARCH}`).count()) === 0);

// v0.14.3: ?debug=tour draws the tour's plan: the sample = entrance, reception, the meeting room upstairs, back
await p.goto(new URL('viewer.html?mode=view&debug=tour', base).href);
await ready(3);
await p.waitForFunction(() => window.__ahdusTourDebug?.plan, null, { timeout: 120000 });
const tourDebug = await p.evaluate(() => {
  const plan = window.__ahdusTourDebug.plan;
  return {
    stops: plan.stops.map((s) => s.name),
    panel: document.querySelector('[data-tour-debug] [data-tour-stops]')?.textContent,
    listed: document.querySelectorAll('[data-tour-debug] [data-tour-stop]').length,
    meshes: window.__ahdusScene.meshes.filter((m) => m.metadata?.debug === 'tour').length,
    skipped: plan.skipped.length,
  };
});
log('?debug=tour: the plan (Main entrance, Reception, Meeting room, Reception), its panel and its route drawn',
  tourDebug.stops.join() === 'Main entrance,Reception,Meeting room,Reception' && tourDebug.panel === '4 stops'
    && tourDebug.listed === 4 && tourDebug.meshes > 4 && tourDebug.skipped === 0,
  JSON.stringify(tourDebug));

log('no page errors', errs.length === 0, errs[0] ?? '');
await b.close();
