# AHDUS: Company Layout Replica

Himan's internship module of **AHDUS (Advance Human Digital Unified System)**, a company digital twin.
This module is the **3D replica of the company's building**: rooms, floors, stairs, furniture, machines.
Other interns build modules that plug into it (see "Team" below), but **the current priority is making the
3D workspace complete and polished, not team integration.**

Teammate API guide: `docs/TEAM_INTEGRATION.md`. Plain HTML pages (the AI Training Platform): `docs/EMBED_GUIDE.md`.
**Not in git** (Himan's laptop only, folder `private-docs/`, ignored by git): `PROGRESS_REPORT.md` (full history, status,
backlog), `AHDUS_3D_INTEGRATION_PLAN.md`, `UI_SPEC.md`, `NEXT_FIXES.md`, the cost estimate and the SRD PDF. A cloud
copy of the repo doesn't have them: ask Himan, and never commit them (the repo is public).

## Commands

```bash
npm install
npm run dev          # Vite on http://localhost:3000, opens in Workplace Studio
npm test             # vitest unit tests (1481, all must pass; `npx vitest run --exclude ".claude/**"` skips worktree copies)
npm run typecheck    # tsc --noEmit (covers src/engine)
npm run lint         # ESLint (eslint.config.js): JS/JSX only, real mistakes + hooks rules, no style rules
npm run build
npm run build:embed  # dist-embed/ahdus-workplace.js (+ .css, + assets/): the one-file embed for plain HTML pages
npm run build:ahdus  # dist-ahdus/ (git-ignored) for AHDUS-FRONTEND (scripts/build-ahdus.mjs): workplace-studio/ = Studio
                     # with VITE_LAYOUT_BACKEND=ahdus + base /workplace-studio/ (vite.ahdus.config.js), 3d-environment/ =
                     # a copy of build:embed's output, layout.schema.json, VERSION (version=, commit=, built=)
npm run schema:json  # dist-ahdus/layout.schema.json (or: node scripts/schema-json.mjs <file>): JSON Schema (draft-07) of
                     # the v2 layout from the Zod LayoutSchema (engine/model/jsonSchema.ts); the AHDUS server checks saves
npm run assets:prepare  # public/assets/ from the downloaded packs (D:\assets-raw, outside the repo; sharp)
node scripts/make-thumbs.mjs   # library pictures (public/assets/thumbs/*.webp), drawn by the app headless (needs npm run dev; ~10 s)
npm run assets:env      # public/assets/env/sky.env from the HDRI (needs npm run dev)
npm run characters:placeholder  # public/assets/characters/: the self-made rigged test figures (+ manifest.json)

# Browser tests: Playwright, need `npm run dev` running in another terminal.
# One-time: npx playwright install chromium
npm run e2e:faster   # 44 checks   e2e/faster-building-smoke.mjs (v0.15.5: Plan view's floor switcher at 1366 × 768
                     #                                       and 1920 × 1080 with the Inspector open, Page Up / Down, the floor
                     #                                       below, stairs on both floors, All floors; Shift+click, Shift+drag
                     #                                       box, group arrows / drag / Delete with a locked desk + one undo;
                     #                                       Ctrl+C, Ctrl+Shift+V on Floor 1, Ctrl+V at the mouse; Layers
                     #                                       search; keys in a text field; review fixes: Ctrl+L not taken,
                     #                                       room names over furniture + inside their rooms, the bar's item
                     #                                       name, a room click selects it, filled chips, All floors' stairs,
                     #                                       group icons, 3D frames again after Plan; SHOTS=<dir>: screenshots)
npm run e2e:planner  # 46 checks   e2e/editor-smoke.mjs    (Workplace Studio + its screenshots, the AHDUS look in local
                     #                                       mode, the library, the Realistic look switch, no missing
                     #                                       asset files, floor plan PNG / PDF export, room names + hover
                     #                                       card, Settings → Room labels, Plan view: select, drag,
                     #                                       Ctrl+Z, a desk onto its own chair's old spot (v0.15.2),
                     #                                       a phone's hint at 390 px; v0.16.0: H = Reset view, nothing in Walk through)
npm run e2e:play     # 36 checks   e2e/play-smoke.mjs      (v0.15.2: no mouse capture, W with no click, drag looks, an
                     #                                       empty hand's click walks, M = mouse look, then the old
                     #                                       checks by crosshair; the catalog's pictures + hotbar names;
                     #                                       an item placed at the mouse, Esc, G on a desk with its chair
                     #                                       and monitor + one undo)
npm run e2e:modules  # 17 checks   e2e/modules-smoke.mjs   (uses ?demoModules=1)
npm run e2e:stairs   # 24 checks   e2e/stairs-smoke.mjs    (viewer.html: W climbs flights turned 0 / 90 / 180 / 270°, with an old y,
                     #                                       an old scale, on Floor 1: every frame on the tread DRAWN there (a ray), and
                     #                                       back down; first person; from the side it stops you; Take me there; Studio:
                     #                                       no Height / size for stairs, R says why, "lead nowhere"; SHOTS=<dir>: shots)
npm run e2e:building # 27 checks   e2e/building-smoke.mjs  (multi-storey, floor heights, Page Up/Down)
npm run e2e:tools    # 72 checks   e2e/tools-smoke.mjs     (Studio mouse tools, door sizes, clicks on a selected
                     #                                       room's floor + Preview's Edit item; v0.15.0: a desk
                     #                                       dragged with its monitor, a Desk Plant dragged onto a
                     #                                       desk, the move arrow still works past it, a door in a
                     #                                       Wall-tool wall, sliding a door, G in Preview; v0.15.1:
                     #                                       the desk's chair by drag / arrow / R / typed X, a room
                     #                                       with its furniture by drag / Room X, an empty hand;
                     #                                       v0.15.2: R turns a room with its furniture + one undo)
npm run e2e:measurements # 23   e2e/measurements-smoke.mjs (off at start, the Measurements panel, measure distance
                     #                                       in 2D, wall lengths, room areas, toggles, Esc, per floor,
                     #                                       Clear Measurements keeps the room)
npm run e2e:templates # 9 checks  e2e/templates-smoke.mjs (new layout from a template: small office, clinic, factory floor)
npm run e2e:save     # 30 checks   e2e/save-smoke.mjs      (auto-save, reopen, version history, old saves, list, delete, export/import,
                     #                                       companies, two tabs on one layout)
npm run e2e:perf     # 20 checks   e2e/perf-smoke.mjs      (72 rooms + 864 items: ≤ 2,000 meshes, ≤ 1,500 draw calls, also with a route shown,
                     #                                       and in viewer.html with the company tour walking / at a stop (TOUR=off skips it);
                     #                                       one room change rebuilds only it + its neighbours; all items
                     #                                       real models; REALISTIC=off measures the simple look)
npm run e2e:shared-walls  # 17     e2e/shared-walls-smoke.mjs (one wall + one doorway; picks with either owner;
                          #                                    Inspector "Wall thickness" 0.4 m + Ctrl+Z)
npm run e2e:nested-rooms  # 27     e2e/nested-rooms-smoke.mjs (rooms inside rooms, cutouts, next to a shared wall,
                          #                                    rooms drawn inside sharing walls with each other and
                          #                                    the outer wall, doors, picks, upper floor, save + reopen)
npm run e2e:viewer   # 34 checks   e2e/viewer-smoke.mjs    (viewer.html: <LayoutViewer> with no Studio code (also in
                     #                                       the vite build), where walking starts (no room events) + Home, setPose
                     #                                       into a machine, walk in, E + a module's action, edits
                     #                                       refused, Page Up, view mode, a saved layout; search: the
                     #                                       box, keys, a keystroke < 50 ms, show / clear, walking: W in
                     #                                       the box does not walk, the walk measured, search=0;
                     #                                       v0.14.2: the browse menu (chips of the kinds there are,
                     #                                       departments, kinds, floors; ↓ Enter / Esc), recent
                     #                                       searches, walking chips "Nearest stairs · 7 m");
                     #                                       v0.14.3: ?debug=tour (the plan, its panel, its route)
npm run e2e:embed    # 38 checks   e2e/embed-smoke.mjs     (NO dev server needed: builds the embed, no saving code
                     #                                       in it (no Supabase), serves embed-test.html itself; keys at once, the page's own field / button, hover, Esc, walk in,
                     #                                       E action, edits refused, load failures, cross-origin layoutUrl
                     #                                       with cookies, destroy(), assets next to the script, quality low,
                     #                                       find(), the search box (no email), full width at 390 px,
                     #                                       navigation: { search: false }, goTo + stopRoute,
                     #                                       setDepartments' description in the Find menu,
                     #                                       v0.14.6: startMode (the card, Overview, onEvent 'mode'),
                     #                                       quality low = from above + its note, onEvent 'start'
                     #                                       (v0.14.8), startMode 'edit' refused)
npm run e2e:welcome  # 39 checks   e2e/welcome-smoke.mjs   (viewer.html?start=walk, v0.14.6: walking at the entrance with
                     #                                       the welcome card, W walks at once and closes it, the hint
                     #                                       waits, Explore / Esc, Find someone, Start the tour, Overview
                     #                                       keeps your place + Walk back, the last choice remembered,
                     #                                       &weak=1 and SwiftShader itself = from above, &at= (no card),
                     #                                       no ?start = as before, phone; v0.14.8: a weak device's note
                     #                                       (software / &quality=low), Stay above / Esc / a click, Walk
                     #                                       anyway walks + is remembered, Overview wins again, the note
                     #                                       compact in a 390 × 490 box; SHOTS=<dir>: screenshots)
npm run e2e:characters # 39     e2e/characters-smoke.mjs (NO dev server: builds the embed; 21 people at desks
                     #                                       on 2 floors: the view from above (no roof: at the start,
                     #                                       after setFloor, after walking), simple figures, full characters near the
                     #                                       camera (each file once), seated poses, hover card (text,
                     #                                       no email), a click keeps it, "Choose your character" on
                     #                                       your own card, a phone's tap, per floor, walking up,
                     #                                       walking as yourself (Mixamo + UE rigs, walk / stand,
                     #                                       eye height, V, your desk figure hidden, fallbacks),
                     #                                       quality low; v0.16.0: manifest v2 (the neutral set,
                     #                                       the "seated" copy, a clip set), Type / Sit, at most 8
                     #                                       play, clothing, grey figures, Idle / Walk / Run / Wave (H);
                     #                                       SHOTS=<dir>: 1440×900 + 390×844 screenshots)
npm run e2e:live     # 23 checks   e2e/live-smoke.mjs      (NO dev server: builds the embed; fake live people, no server:
                     #                                       a live person's desk empty, drawn where they walk ~250 ms
                     #                                       behind (never ahead), a 5 m jump snaps, from above = beside
                     #                                       their desk, name tags (no email), full character from the
                     #                                       FULL file, Walk / Wave, remove / silent 10 s = seated, heard
                     #                                       again = live, the nearest 30, per floor, clear(); your pose
                     #                                       ≤ 5 / s + keepalive + wave; the cap = 12 on SwiftShader;
                     #                                       phone tags inside the view; SHOTS=<dir>: screenshots)
npm run e2e:navigation # 20 checks e2e/navigation-smoke.mjs (viewer.html, the Meridian-shaped layout; MERIDIAN=<layout.json>
                     #                                       MERIDIAN_PEOPLE=<people.json> = the real one: the card's Show route /
                     #                                       Take me there, from above = from the entrance, the line (≤ 2
                     #                                       meshes), re-route 3 m off, Kavya at reception (in front of the counter, facing her), Floor 1 by the
                     #                                       stairs, nearest washroom, every frame clear of walls / furniture,
                     #                                       E there = "E Details: Kavya Iyer" + her card (v0.14.7),
                     #                                       W pauses + G, the time, Esc / Stop, free walking, phone; run it
                     #                                       ALONE; SHOTS=<dir>: screenshots + a .webm recording)
npm run e2e:seats    # 26 checks   e2e/seats-smoke.mjs     (NO dev server: starts its own in AHDUS mode on port 3100,
                     #                                       the AHDUS API faked by page.route: "Who sits here",
                     #                                       search, move / replace questions, not in undo, People
                     #                                       without a desk, the Publish warning, editors read-only,
                     #                                       phone; SHOTS=<dir>: screenshots)
npm run e2e:touch   # 15 checks   e2e/touch-smoke.mjs     (viewer.html on a phone: 390 × 844, hasTouch + isMobile,
                     #                                       fingers through CDP touch events: the joystick (push =
                     #                                       walk, further = faster, let go = stop), drag to look, two
                     #                                       thumbs, tap the floor (the line), the joystick ends it, tap
                     #                                       a person, buttons / Find / Take me there by tap (the joystick
                     #                                       pauses: "Tap Continue"; Asha's desk), touch words (hint,
                     #                                       "?"), the HUD one line beside the joystick, the knob pushed
                     #                                       forward never under it,
                     #                                       a mouse = mouse words again; SHOTS=<dir>: phone screenshots)
npm run e2e:controls # 16 checks e2e/controls-smoke.mjs (viewer.html: keys with no click, the hint once, drag
                     #                                       to look (cursor stays), Back to entrance / ? / Find / Clear give
                     #                                       the keys back, click the floor walks there, a key ends it, a
                     #                                       desk = the card, the CNC = its action, double-click / L / Esc,
                     #                                       the pill only in mouse look, no HUD line under the hint, the sky's 6 sides;
                     #                                       SHOTS=<dir>: 1440×900 + 390×844 screenshots + a 17th check: the phone fits)
npm run e2e:tour     # 28 checks   e2e/tour-smoke.mjs      (viewer.html, the Meridian-shaped layout with its 13
                     #                                       departments (MERIDIAN=<layout.json> MERIDIAN_PEOPLE=<people.json>
                     #                                       = the real one): planned in idle time, Find's "Take the company
                     #                                       tour · N stops" (every count the same), from above = at the
                     #                                       entrance, the panel, narration off, Pause / P, Next, Previous
                     #                                       (fade), Exit, Walk me to stop 3 (outlined; ~2 m inside, the
                     #                                       camera higher + further back), W pauses + P,
                     #                                       I'll walk (the line; there = done), Skip the walk, ticks after
                     #                                       a reload, Restart, Esc, phone (above the joystick, touch words,
                     #                                       one line while walking, a tap opens it, full at a stop);
                     #                                       run it ALONE; SHOTS=<dir>: screenshots + a .webm recording)
npm run e2e:layers   # 38 checks   e2e/layers-walls-smoke.mjs (v0.15.6: Layers' eye hides a room / an item in Studio only
                     #                                       (Walk through + the saved layout keep it), "N hidden · Show all",
                     #                                       after a reload; a locked room: Delete, R, typed size, wall drag,
                     #                                       L + undo; wall items: a TV and a clock on a wall at their
                     #                                       height, facing in, never across a door; Mount on wall + Check's
                     #                                       warning; walking past a wall TV; snapping: guides, against the
                     #                                       wall, Alt = none, Plan view's guides; SHOTS=<dir>: screenshots)
npm run e2e          # all of them (Himan's laptop once hung on this: run the scripts ONE AT A TIME)
node e2e/real-assets-shots.mjs before|after   # screenshots of one sample layout: e2e/screens/real-assets-<tag>-*.png
```

After any change: run `npm test`, and the e2e script for the area you touched. Screenshots go to `e2e/screens/`.
CI (`.github/workflows/ci.yml`, job "CI checks") runs lint, typecheck, test, build and build:embed on every PR and
push to main; `e2e-nightly.yml` runs e2e:embed and e2e:planner nightly (and by hand from the Actions tab).

## Git

**Public** GitHub repo `Himan170/ahdus-layout-replica` (anyone can read it), branch `main`. Himan is new to git:
explain each step he must do in one sentence.
- **`main` is protected: every change reaches it through a pull request whose "CI checks" are green.** Nobody pushes
  to `main` directly (not Himan, not Claude) and no local merge into `main` is pushed: work on a branch
  (`fix/…`, `feat/…`, `docs/…`, teammates `name/topic`), push the branch, open a PR, merge on GitHub (merge commit),
  then `git switch main` + `git pull`. Tags go on `main`'s merge commit after the pull.
- Never commit when tests fail: run `npm test` (and the e2e script for the area touched) before every commit.
- Commit after every working step, with a clear message ("Fix: deleting ground floor", "Add: export layout").
- Bigger tasks (e.g. a review's list of fixes) get their own branch (`fix/next-fixes`), one commit per fixed item.
- Never force-push, never rewrite history on `main`, never delete branches without asking.
- **Always ask Himan before pushing to GitHub, opening a PR, merging one, or pushing a tag.**
- Secrets (Supabase keys later) go in `.env`, never in git; keep a `.env.example` with no real values.
- Tag a version when something big is finished (`v0.2.0`, `v0.3.0` …). `v0.1.0` = initial commit.

## Stack

React 18 + Babylon.js 7 + Zustand 4 (`subscribeWithSelector`) + Vite 5. Mostly JS; `src/engine/` is TypeScript
with a Zod schema. uuid v5 for stable anchor IDs. Aliases: `@` = `src`, `@engine` = `src/engine`.
UI: plain CSS with design tokens (`src/ui/theme.css`), `lucide-react` icons, Inter (`@fontsource/inter`). No UI framework.

## Two editing modes (same layout, Tab switches)

UI names (use them in all UI text): **Workplace Studio** (code: "planner", `WorkplaceEditor.jsx`, `plannerTools.js`)
and **Preview** (code: "play", `playController.js`, `PlayHUD.jsx`; formerly "Build mode" / "Play mode").
Spec of the look: `private-docs/UI_SPEC.md` (not in git); its test hooks are under "Testing gotchas".

- **Workplace Studio** (`src/ui/`, in the AHDUS look: see "The AHDUS look"): top bar ("All layouts", breadcrumb with
  the layout name (click to rename), the status pill, Undo, Redo, Versions, Settings popover: snap, step, show grid,
  lighting, realistic look, room labels, FPS in dev; Walk through = Preview);
  **tool rail** of tiles
  (Select, Rooms, Walls, Doors & Windows, Stairs, Furniture; keys 1–6) whose **library** (docked next to the rail) arms a
  planner tool or places an asset; Layers and Shortcuts at its bottom; **canvas** (camera controls, Export floor plan,
  Measurements, 2D | 3D | Plan, Full screen, empty state, room labels, floating **selection bar**, floor switcher + the
  active tool's hint along the bottom); **Inspector** only while something is selected (or Layers is on). The tool list is defined once in
  `src/ui/tools.js` (also gives Preview's hotbar/catalog icons). Studio uses the same sky/grass/paving as Preview;
  the build grid shows only while a build tool is active (or "Show grid" is on).
  **Build tools** (`src/planner/plannerTools.js`): Select (drag a wall of the selected room to resize it, drag its
  floor to move it), room (drag corner to corner; also inside another room), wall (drag), door / window (click a
  wall; click one to remove).
  **Easy building (v0.15.0):** with Select, **drag any item** (selected or not; after a 5 px drag, a click still
  selects): its real mesh follows the mouse onto the floor or a table top (`dragSurface`: `placementHeight` from what is
  under the mouse; building parts and stairs keep their height), and what stands on it comes along (`ridersOf`: unlocked
  items whose foot is at its top, inside its outline: the monitor and the plant on a desk). One undo step for all of them
  (`editor.moveObjects`; each item's `roomId` = the room it ends in). Locked items say "Locked. Select it and press L".
  The move gizmo has no up arrow any more (the Inspector's Height lifts an item on purpose), and **the nearest thing
  under the mouse wins** (`gizmoController`, a top-priority pre-pointer observer): where the item itself is nearer than
  the gizmo (from above, always over the item: the arrows lie at its foot) the press is the item's drag; where an arrow
  or ring sticks out in front of it, the gizmo's. **v0.15.1:** a desk also takes its chair (`play/carry.js` `carriedBy`: the
  chair `people.deskSeat` pairs with it) on every move of one item: the drag, the arrow keys, R, the Inspector's X / Z / angle,
  the gizmo and Plan view all go through `plannerTools.moveItem(id, patch, { label, mergeKey })` → one `moveObjects`
  (`carryMoves`: the chair turns round the desk). **v0.15.2:** while a move arrow is dragged the chair and the riders
  follow as meshes (`gizmoController` `onMoveLive` → `plannerTools.carryPreview` / `endCarryPreview`), and
  `utils/livePosition` tells the Inspector's X / Z where a dragged item is now (never saved, cleared when the drag ends).
  Plan view's `planDrop` ignores what moves with the item (`planMath.planCarried`: its chair, its riders). **Keys (v0.15.1):** R turns the selected item 90° (Shift+R 15°,
  `carry.turnStep`; a room: a quarter turn, but not a room with items in it yet: "Turning a room with its furniture
  comes later" until v0.15.2: now R and the selection bar's Rotate turn it with its furniture and the rooms inside it,
  `geometry.planRoomTurn(room, rooms, objects)` → `editor.turnRoom`, one undo step; refused when the turned room would
  overlap a room, not fit the room it stands in, or a door / window is shared with a room that stays), W shows / hides the move arrows (hidden until then; the selection bar's Move
  too), S the resize handles (was R; stairs say why), no E (rotation rings gone; the Inspector's Rotation = 4 buttons +
  the angle box), Ctrl+S saves now (`saveNow`, also in Preview; never the browser's "Save page as"), F or a double-click flies to the selection (`focusSelection`; nothing selected: F fits the building).
  The Inspector's sizes are in metres (`ui/itemSize.js`: Width / Depth / Height ↔ scale, 0.1 to 5); the hook-point note
  and Linked position sit in a closed **Advanced** section (`data-inspector-advanced`). The selection bar sits above the
  item, clear of room labels (`ui/selectionSpot.js`), hidden while dragging. **Door / window tool on a wall drawn with the Wall tool** (a
  WALL_SEGMENT item): the wall is cut there (`geometry.planWallSegmentOpening`: the side pieces, the part above a door /
  below and above a window, plus a DOOR_SINGLE / WINDOW_FRAME item), one undo step (`editor.replaceObjects`); too
  short / too low / locked walls say why. **Slide a door / window:** select it, drag it (not a blue handle) along its
  wall in 0.1 m steps (`geometry.moveOpening`: it stops at the corners, refused next to another opening or the stairs;
  a shared door moves on both rooms), one `editor.resizeOpening` step "Move door". The keyboard arrows and every gizmo
  drag also set the item's `roomId`. Dev hook `window.__ahdusGizmo` (`gizmoScene()`: the arrows' scene, `isPointerOver()`).
  **Export floor plan** (Anish, S2; button left of 2D | 3D, `ui/ExportMenu.jsx`): the current floor as a PNG
  (`floor-plan-<floor>.png`) or an A4 PDF (jsPDF, loaded on first use), drawn on an offscreen 2D canvas from the store
  by `utils/floorPlanExporter.js` (rooms, walls, doors, windows, items, dimensions; no Babylon). Disabled with no rooms.
  **Measurements** (Anish, A5; the ruler button `Measurements` next to Export opens a small panel, `ui/MeasureMenu.jsx`;
  labels in `ui/MeasurementOverlay.jsx`, pure maths in `utils/measurements.js`; not in Plan view): "Measure Distance"
  closes the panel, switches to 2D and takes two clicks on the current floor (Esc or "Exit Measurement Mode", in a hint
  under the controls, cancels); "Show Wall Lengths" (room walls + WALL_SEGMENT items, overlapping runs merged) and
  "Show Room Areas" (on the room labels) toggle on their own, both OFF when a layout opens; "Clear Measurements".
  Esc or a click outside closes the panel; the button shows as active (`data-active`) while any measurement is on.
  Measurements are temporary annotations per floor (React state, not saved, not in undo) and never change the layout.
  **Room labels** (`ui/RoomLabels.jsx`): only the room's name, small; a label that would overlap one already drawn is
  hidden, bigger rooms first (`ui/labelLayout.js`, pure + tested); the selected room's label is its details card.
  Settings → "Room labels: Names / Off" (per browser, localStorage `ahdus.roomLabels`; Off still shows areas when
  "Show Room Areas" is on). **Hover card** (`ui/RoomHoverCard.jsx`): hovering a room's floor or walls (3D and 2D) shows
  name, type, W × D, area, wall height, doors / windows next to the cursor; picked at most every 50 ms, React renders
  only when the hovered room changes; none in Preview / Plan, while a mouse button is down, measuring or placing.
  **Wall thickness** (Inspector "Wall thickness", 0.10 to 0.60 m, step 0.05; room field `wallThickness`, default 0.15):
  see "Shared walls and nested rooms". `geometry.planWallThickness` checks it; `editor.updateRoom`, one undo step.
  **Limits:** rooms 2 to 200 m wide / deep (`geometry.MAX_ROOM_SIZE`: drawing stops there, Stretch / wall drag refuse,
  Inspector clamps); walls 2 to 15 m (`building.MAX_WALL_HEIGHT`), floors 2.3 to 15.3 m. Big halls stay light: at most
  24 ceiling light panels along a wall; the Studio camera zooms out to 320 m and the fog thins past 80 m.
  **Plan** (Anshu, S1 step 1; third option of the canvas card's view control, aria-label `Plan view`;
  `floorplan/FloorPlanView.jsx`, pure maths in `floorplan/planMath.js`): an SVG plan of the current floor, north up as
  in 2D, in place of the 3D canvas (`planView` in WorkplaceEditor; Preview always shows 3D). Rooms with names, walls
  cut by their doors (with swing) and windows (`roomWallPieces` from `roomOpenings`), free-standing walls
  (`wallSegmentEnds`, the inverse of `wallSegmentData`), items. Click, or Tab + Enter (the accessible view, S3),
  selects; dragging an item = `planDrop`: Studio's snap step, locked items stay, table tops via `placementHeight`,
  one `editor.updateObject` per drag (+ `endBurst`); Rotate 90°. Plan stops the 3D tools and hides the measure buttons.
  Each item's hook-point badge (anchors, on by default) sits on top of it: a press on the badge grabs the item
  (else the plan would pan). The plan's drag state is kept in a ref too, so slow machines don't drop the first moves.
  Select a door/window (click it; in 2D the wall over it): Inspector width/height + blue drag handles on its sides
  and top (`store.selectedOpening` = { roomId, kind, index }; one undo step per drag).
  Furniture stacks on table tops. Clicking the floor under a desk selects the desk.
  Code: `WorkplaceEditor.jsx` (wiring) + `src/ui/*`, `src/utils/gizmoController.js`, `src/utils/placementManager.js`.
- **Preview**: Third-person character (over the shoulder; centred on a portrait phone: `shoulderOffset(aspect)`), hotbar 1–9, B = catalog.
  **The viewer's easy controls (v0.15.2):** Studio runs the controller with `look: 'drag'` and no `isEngaged` = **mouse aim**
  (`mouseAim`): the mouse is never captured by itself, a drag (left or right) looks, the keys work with no click (no
  "Start preview" screen; the HUD's "?" `data-hud="help"` lists the keys), and everything is aimed at the MOUSE
  (`aimLine()`; before the mouse has moved: the middle of the view). An **empty hand**: a click walks there
  (`onPointClick` → Studio's own `NavigationSystem` + `RouteLineSystem` in `useStudioScene`, `routeTo(…, { walk: 'auto',
  source: 'click' })`; a machine in reach with a module's action runs it, as E); left-click only walks, right-click removes the aimed item (G /
  middle-click pick up). **An item or tool in your hand**: a click uses it at the mouse and never walks (a press is
  `patient`: no time limit), right-click removes / cancels there. Esc cancels what is half done, then empties the hand
  (`onEmptyHand`); the held slot's number again does too. **M** / the HUD's "Mouse look" (`data-hud="mouse-look"`,
  aria-label `Mouse look`, aria-pressed) = the old capture with a crosshair, Esc ends it. A dialog over the view (the
  catalog, New floor) takes the keys: `play.setKeysPaused`. Tests: `play/__tests__/previewControls.test.js` (the real
  controller; `setPointer`, `clickAt`, `getAim`). Left-click builds, right-click
  removes, R turns 90° (Shift+R 15°), E interacts, N adds a floor above, F fly (Space up / C down), V first/third person, Shift runs, Tab or
  "Back to Studio" returns. Code: `src/play/playController.js` + `src/components/PlayHUD.jsx` (+ `src/ui/preview.css`).
  Default hotbar (`src/play/hotbarItems.js`): **1 Edit and 2 Stretch are fixed (v0.15.4)**, 3 Office, 4 Door, 5 Window, 6 Desk, 7 Chair, 8 Stairs, 9 Meeting.
  Catalog picks cannot replace slots 1/2 (`catalogSlot(hotbar, selected, item)`: Edit / Stretch = their slot, else the
  chosen slot 3–9, a free one, or 3). **Edit's Delete button (v0.15.4):** aiming Edit at an item or a room's door /
  window shows `data-hud="edit-actions"` with "Delete <name>" (aria-label; disabled while locked); the controller keeps
  that target while the mouse moves onto the HUD (`editItemId` / `editOpening`) and `play.deleteEditItem(id)` re-checks
  lock, floor and reach, then deletes through `actions.deleteObject` / `removeOpenings` (one undo step).
  **It starts with an empty hand (v0.15.1, `EMPTY_HAND` −1):** nothing is built until 1–9 / B picks an item (the catalog puts
  it in a slot, `catalogSlot`, and holds it). **The third-person camera** (`thirdPersonCamera`, pure, v0.15.1): a ray to the wanted
  spot pulls it in front of a wall, then the ceiling lowers it and a ray to the lowered spot is tested too (a ray over a
  wall's top, lowered afterwards, ended behind it); blocked over the shoulder = behind the head (shoulder 0) before it
  pulls in, sliding there and back over `SHOULDER_EASE_S` 0.25 s (`easeShoulder`); closer than `HIDE_CHARACTER_BELOW` 0.5 m = the character hidden. First person (V) unchanged.
  **Edit item** (slot 1) = Studio's gizmo actions on what you look at: click picks it up / puts it down,
  R turns 90° (Shift+R 15°), + / − resizes (keeps proportions), 0 normal size, L lock/unlock. On a **door/window**: + / − width,
  Shift + / − height (0.1 m), 0 standard size; the hint shows "Door 0.9 × 2.1 m" or why it is blocked.
  **v0.15.0:** a click on a door / window picks it up: look along its wall to slide it (`moveOpening`, the same rule as
  Studio), click puts it there, right-click cancels. **G or middle-click** picks up the item you look at whatever is in
  your hand (an empty hand: a left-click too) and carries it like Edit item (click puts it down, R turns it, right-click
  cancels; the item in your hand waits). The **Door / Window** slots also cut a door into a wall drawn with the Wall
  tool (`planWallSegmentOpening`, `actions.replaceObjects`).
  **v0.15.2:** carrying a desk (G, Edit item) takes its chair and what stands on it (`carry.carriedBy` +
  `utils/itemRiders.ridersOf`, the rule Studio's drag uses): they follow live, R turns the group, nothing carried is a
  surface for it, and putting down is ONE `actions.moveObjects` (`carry.carryDrop`). The hotbar shows a short name under
  each icon (`hotbarItems.shortLabel`), every room type has its own icon (`tools.ROOM_ICONS`), the catalog is "Add to
  hotbar" with the library's pictures (`ui/ItemPicture.jsx`, `RoomPicture`).
  **Table tops (v0.15.2, both modes):** `building.canStandOn(type, surface, onType)`: only `TABLE_TOP_TYPES` (monitor,
  laptop, keyboard, mouse, Desk Plant, coffee machine, microwave, printer, first aid kit) go on top of another item;
  the rest is refused with `floorOnlyText` ("Large Plant stands on the floor") in Studio's drag, the library drop, Plan
  view (`planDrop` → `{ problem }`) and Walk through. A rug and the floor markers (`FLOOR_LIKE_TYPES`) are the floor.
  Old layouts are not changed.
- **Both modes share the decisions and the look:** `planRoom`, `planOpening`, `planRemoveOpening`, `wallSegmentData`,
  `stretchRoom`, `resizeItem`, `resizeOpening` (`geometry.js`), `placementHeight` (`building.js`), previews in `utils/buildPreview.js`,
  forgiving picks in `utils/pickHelpers.js`, tokens in `src/ui/theme.css`.

## Faster building (v0.15.5, how it works)

- **Plan view floors** (`floorplan/FloorPlanView.jsx`, pure `floorplan/planFloors.js`): the plan's controls sit in
  `.floor-plan-chrome` (top left), so Studio's floor switcher / Add floor are never covered. All floors share ONE scale
  and position (`planViewBox` of the whole building), so Page Up / Down (`useStudioKeyboard`, every Studio view,
  `adjacentFloor`; "This is the top floor" / "…ground floor") keep the plan where it was. The floor below: dashed grey
  rects (`[data-plan-below]`, button `Floor below`); stairs: `planStairs` → `[data-plan-stairs]` = up | down | nowhere.
  Zoom, pan and Floor below per workplace in localStorage `ahdus.planView` (`{ "<company>/<layout>": { below, zoom,
  pan, at } }`, ≤ 30, try / catch). **All floors** (`This floor` | `All floors`, `floorplan/AllFloorsView.jsx`,
  `[data-all-floors]`, tiles `[data-floor-tile]` = id, aria-label "Open Floor 1: N rooms, M items"): looking and
  choosing only. While Plan view shows, the 3D view draws no frames (`layoutScene.pauseRendering`, via
  `pauseRenderingRef`): Meridian's All floors opens in ~20 ms; its cards draw the stairs on both floors (`[data-tile-stairs]`).
  **Plan labels:** room names in their own layer (`.floor-plan-labels`, `[data-plan-label]`, `data-truncated`) drawn LAST
  (over furniture, stairs, badges), white halo, `planMath.roomLabelFit` (shrink to 88 % of the room width, then "…";
  the room's `<title>` has the full name). The fitted plan leaves `CHROME_ROOM` (28 %) above the building for the
  controls; a press pans only after `PAN_START_PX` 4 px (then the pointer is captured), so a click selects a room.
  Toggle chips are filled (AHDUS green) while on.
- **Multi-select:** store `selectedObjectIds` (2+ items; `selectedObjectId` is null then), `setObjectSelection(ids)`,
  `toggleObjectSelection(id)`; every place that clears the selection clears it. Shift+click toggles an item (locked ones
  too), Shift+drag a box (`plannerTools` `kind: 'box'`, `[data-select-box]`; items whose middle is in it; Plan:
  `rect[data-plan-box]`). Groups hold ITEMS only. Pressing a member drags the group (`drag.group`); a click on a
  member selects just it. `planner/groupActions.js` (`createGroupActions`): move / turn / remove / toggleLock / copy /
  paste / duplicate, each ONE editor command (`moveObjects`, `replaceObjects`, new `lockObjects(ids, locked)`); pure
  maths in `play/group.js` (`groupMembers` with `carriedWith`, `groupMoves`, `groupTurn`, `copyItems`, `pasteOffset`,
  `pasteItems`, `lockedNote` "2 locked items were not moved"). Locked members never move / turn / delete. Studio
  tints the group (`HighlightSystem.add(ids, GROUP_HIGHLIGHT, { tint: true })`; a lock tint wins). Inspector mode
  `'group'`: "N items selected" (`data-group-count`), `data-group-actions`, `data-group-locked`.
- **Copy / paste:** Studio's own clipboard (per page, not the system's). Ctrl+C = the selection + each unlocked
  item's chair and riders; Ctrl+V = the selected items' middle at the mouse (`pasteTarget`: the Plan's pointer, else
  `plannerTools.pointerGround()` while the mouse is over the canvas), else 0.5 m aside (further each time);
  Ctrl+Shift+V = same x / z, on the floor being edited. New `obj_<uuid>` ids: "Who sits here" stays with the old
  desk. One undo step ("Paste N items"); the pasted items are selected.
- **Layers search** (`Search layers`, `matchesLayerQuery` in `ui/Inspector.jsx`; `[data-layers-found]`).
- **Typing:** `ui/typing.js` `isTypingTarget` (inputs, textarea, select, contenteditable, role textbox / combobox /
  searchbox / listbox): Studio's keys do nothing there.
- Tests: `play/__tests__/group.test.js`, `planner/__tests__/groupActions.test.js` (the real store + editor),
  `floorplan/__tests__/planFloors.test.js`, `ui/__tests__/layersSearch.test.js`, `npm run e2e:faster`.

## Layers, wall items and snapping (v0.15.6, how they work)

- **Hide / show** (Layers' eye, `ui/hiddenLayers.js`): a Studio VIEW setting only: localStorage `ahdus.hiddenLayers`
  = { "<company>/<layout>": { rooms, objects } } (≤ 30 workplaces, try / catch), never in the layout, never hidden in
  Walk through, the viewer or the embed (`FloorSystem` hides them in Studio's planner view only; Plan view leaves them
  out). The footer's "N hidden · Show all" (`data-hidden-note`).
- **Room locks** (`play/locks.js`): store field `isLocked` (v2 `locked`, optional, written only when true; the ONE
  layout format change of v0.15.6, in `schema.ts` / `migrate.ts` / `toV1.ts`, so `layout.schema.json` gains it).
  `editorHistory` refuses moving, resizing, turning, wall height / thickness and deleting a locked room
  (`allowedRoomPatch`, `lockedText`); name, type, finish, department, doors and windows still change, and its items
  still move on their own. `lockRooms(ids, locked)` / `toggleRoomLock(id)`: one undo step. L, the Inspector's Lock,
  the Layers lock.
- **Wall items** (`play/wallMount.js`, PURE + tested): `WALL_ITEMS` = whiteboard 1.35 m, TV 1.4, projector screen 1.6,
  exit sign (`aboveDoor`: `EXIT_GAP` 0.1 m over the door / window under it, else 2.2 m), extinguisher 1.0, wall clock
  2.0, wall shelf 1.5, AC unit 2.3 (heights of the item's middle). `wallPieces(rooms, objects)` = the floor's walls cut
  by doors and windows + WALL_SEGMENT items; `wallFaces` (cached per pieces array); `mountOnWall(obj, point, pieces)` →
  `{ x, z, y, rotationY, face }`: back against the nearest face within `SNAP_DISTANCE` 3 m (`MOUNT_GAP` 5 mm), facing
  into the room (θ = atan2(n.x, n.z)), along the wall in 0.05 m steps, never across an opening, under the wall's top.
  `play/floorWalls.js` `createFloorWalls()` caches a floor's pieces until rooms / items change. Used by Studio's
  placement manager (`setWallSource`), the library drop (`mountText` in the hint), the drag (`plannerTools`
  `updateWallItemDrag`: the item turns to the wall, a wall guide), Plan view's `planDrop`, Walk through's placing,
  G and Edit item (`aimWall`; a wall item carries nothing). Nothing saved differently: being on a wall is derived.
- **Not floor obstacles:** `hangsOnWall(obj)` (a wall type with its foot ≥ `OFF_FLOOR` 0.3 m): `walkMap.isSolidItem`
  skips it and ObjectSystem makes it non-solid (`setItemSolid`); one standing on the floor still collides.
- **Old layouts:** nothing moves by itself. A selected wall item off its wall: the Inspector's "Mount on wall"
  (`[data-wall-mount="off"]`, `mountOnWall` with no distance limit, one undo step); Check my layout's
  `WALL_ITEM_OFF_WALL` warning (also FIRST_AID). The new types (WALL_CLOCK, WALL_SHELF, AC_UNIT) and the TV are
  primitive models (`source: 'Built-in (simple shapes, v0.15.6)'`, thumbs in `PRIMITIVE_THUMBS`).
- **Snapping while dragging** (`play/dragSnap.js`, PURE + tested): `snapTargets(objects, pieces, { catalog, ignore })`
  once per drag (items' axis-aligned boxes from `itemFootprints`, wall faces along X / Z), `snapDrag(obj, at, targets,
  { grid, free })` per move: per axis within `SNAP_TOLERANCE` 0.15 m, a wall in reach always wins (only from the
  room's side), else the nearest item edge / middle (`SNAP_REACH` 8 m), else Studio's grid step. Guides
  `[{ ax, az, bx, bz, kind: wall | edge | centre }]`: Studio draws them as one LineSystem `snap_guides` (orange wall,
  pink item; `metadata.guides`), Plan view as `line[data-plan-guide]`; the hint "Against the wall · hold Alt for no
  snapping". **Alt** held (or `free`) = 1 cm, no grid. Groups snap to the grid only. Meridian: targets < 200 ms (a
  few ms in practice), a move < 4 ms (unit test).
- Tests: `play/__tests__/wallMount.test.js`, `dragSnap.test.js`, `ui/__tests__/hiddenLayers.test.js`,
  `editorHistory.test.js` (room locks), `npm run e2e:layers`.

## Check my layout (v0.15.3)

Studio's top bar **Check** (phone: More) opens a floating panel grouped by floor. A click switches floor,
selects the room/item and focuses the camera; the panel stays open beside the Inspector. There is no new key.
The button counts errors and warnings; window notes do not count. A green tick means no counted problems.
Ignore and Show again use `editor.setIgnoredChecks` (one undo step), saved with the layout. Problems never block
saving/publishing; the AHDUS Publish dialog adds a count and Show button.

Pure rules: `src/play/navigation/checkLayout.js`; UI: `ui/LayoutCheckPanel.jsx`, delayed idle scheduling in
`hooks/useLayoutCheck.js` (1.5 s, no checks while dragging or in Preview). Walking and checking share
`hooks/studioWalkMaps.js`. Optional `ignoredChecks: string[]` survives v1/v2 conversion, autosave, backup and version
restore; the generated JSON Schema allows up to 500 keys of 300 characters. Old saves have none.
Walk through follow-up: plain right-click removes aimed items even with an empty hand; right-drag only looks.
Door items in drawn walls are visibly open doorways, matching room doors; floor controls stay unchanged.

Measured on 72 rooms / 864 items: 132 ms cold, 112 ms with warm walk maps (11 Nov 2026).
Regression script: `npm run e2e:check` (12 checks) (template door removed/restored, selection, floor switching, Ignore/undo/reopen, phone).

## Code map

```
src/components/WorkplaceEditor.jsx  Studio wiring, mode switching, level visibility (~1,170 lines)
src/hooks/useStudioScene.js        Studio's scene lifecycle, ONE effect: createLayoutScene, Room/Object/FloorSystem,
                                   SceneBuilder, perf monitor, play controller, bridge context, placement manager, planner
                                   tools, floor outline, gizmo controller, pointer handlers, FPS counter; one cleanup.
                                   WorkplaceEditor owns the refs / state and passes them in (same names)
src/hooks/studioPointer.js         installStudioPointer(): Studio's scene.onPointerMove / onPointerDown (measure clicks,
                                   placing, planner build tools, selection), called inside useStudioScene's effect
src/hooks/useStoreMeshSync.js      Store → scene, right after useStudioScene: room + item meshes of every floor
                                   (builder.start() / request()), the floor being edited + camera height, the gizmo on
                                   the selected object. Refs and values passed in by WorkplaceEditor (same names)
src/hooks/useStudioKeyboard.js     Studio's keyboard shortcuts (keydown: Tab, Esc, 1–6, Delete, arrows, W / R / S, L,
                                   Ctrl+Z / Y / D; Preview: undo / redo only) + the wheel (placement ghost height)
src/hooks/useStudioFileActions.js  Returns Studio's file / layout actions: All layouts, reload the other tab's save, export /
                                   import layout, save as copy, floor plan PNG / PDF, photo reconstruction (flag-checked)
src/hooks/useAhdusPublish.js       AHDUS only: publish state, Publish dialog + toasts, leave dialog + beforeunload, save
                                   errors as toasts, rename the site (rules: PURE ui/publishFlow.js, tested)
src/hooks/useAhdusSeats.js         AHDUS only: who sits at which desk (GET /me, seats, people; PUT / DELETE a seat), the
                                   people Studio draws, the Move here / Replace question, "Assign a desk" (rules: PURE
                                   ui/seatFlow.js, tested); UI: ui/SeatSection.jsx (Inspector), ui/SeatsBanner.jsx
src/ui/                            Workplace Studio: theme.css + ahdus.css (the AHDUS look), look.js (usePhone), tools.js, StudioShell,
                                   StudioHeader, BuildPanel (the tool rail) + LibraryPanel, CatalogPicker (Preview's catalog), CanvasCard, ExportMenu, MeasureMenu, RoomLabels (+ labelLayout.js),
                                   RoomHoverCard, SelectionToolbar, Inspector, StudioFooter, EditorErrorBoundary, preview.css,
                                   StudioSplash (loading screen; firstFrame.js), Toast, Dialog, PublishDialogs (overlays.css)
src/utils/floorPlanExporter.js     2D floor plan of one floor on an offscreen canvas → PNG / PDF download (Anish, S2; tested
                                   in src/utils/__tests__/floorPlanExporter.test.js with jsdom)
src/floorplan/                     Plan view (Anshu, S1): FloorPlanView.jsx (SVG) + planMath.js (PURE: bounds, world / plan /
                                   screen, walls + openings, planDrop; tests in src/floorplan/__tests__/)
src/utils/measurements.js          PURE: distance, room area, wall runs to label (Anish, A5; tests in src/utils/__tests__/)
src/ui/MeasurementOverlay.jsx      Distance / wall-length labels over the canvas (HTML, like RoomLabels)
src/play/playController.js         Preview: movement, camera, aiming, every hotbar tool, Stretch, Edit item, stairs, levels;
                                   look: 'drag' (viewer / embed: drag to look, clickTarget, L) or 'lock' (Studio)
src/play/dragLook.js               PURE (v0.14.0): click vs drag vs double-click (6 px, 250 ms), the drag's look deltas;
                                   touch (v0.14.1): a tap (10 px, 500 ms, never a double), stickVector (the joystick)
src/engine/react/TouchControls.tsx The viewer's touch joystick (v0.14.1): bottom left, walkthrough.setStick
src/engine/startMode.ts            PURE (v0.14.6): chooseStart (how a viewer with startMode starts), softwareRenderer
                                   (a weak device), the welcome card's words; the last choice (localStorage, try / catch)
src/engine/react/WelcomeCard.tsx   The welcome card (v0.14.6): "Welcome to …" · Start the tour · Explore · Find someone
src/planner/plannerTools.js        Studio mouse tools: draw room / wall, door / window, drag a wall to resize
src/utils/buildPreview.js          Blue/red build previews shared by both modes
src/play/navigation/               PURE (v0.13.0): walkMap.js (the walk map of a floor: 0.1 m cells, walls with door gaps,
                                   solid items, grown by the body; createWalkMapCache) + entrance.js (entranceSpawn: where
                                   walking starts; outsideDoors / mainEntrance; nearestFree) + route.js (v0.13.2: findRoute,
                                   findNearestRoute, floorLinks) + places.js (v0.13.3: buildPlaces, searchPlaces: what the
                                   search finds) + browse.js (v0.14.2: browsePlaces, the Find box's menu; recent searches) + tour.js (v0.14.3: planTour, the
                                   company tour's plan; its 0.3 m ordering grid). Tests in navigation/__tests__/ (meridianLike.js,
                                   randomLayouts.js: shared test layouts)
src/engine/systems/NavigationSystem.ts  engine.navigation: find / search / show / clear (v0.13.3), routeTo / stop / resume +
                                   the 'navigation' event (v0.13.4: the pilot that Show route / Take me there give the walker),
                                   the shared walk maps (walkMaps) and warm() (built in idle time after loadLayout)
src/play/navigation/follow.js      PURE (v0.13.4): following a route: routePath, createFollower (steering, furniture
                                   clearance, speed, stuck, off route, arrival), routeMarks (the line's chevrons + markers)
src/engine/systems/RouteLineSystem.ts  The route line: 2 thin-instance meshes (chevrons, markers), not pickable
src/engine/react/PlaceSearch.tsx   The viewer's search box "Find a person, room or place" (toolbar button, inline styles)
src/engine/systems/TourSystem.ts   engine.tour (v0.14.4): the company tour's state machine (idle / walking / stop / paused /
                                   done), driving NavigationSystem.routeTo (source 'tour'), the 'tour' event
src/engine/react/TourPanel.tsx     The tour's panel ("Stop 4 of 20 · Marketing", text, directions, controls, the stop list,
                                   narration); pure stopTitle / stateLine / spokenText
src/play/navigation/tourVisited.js PURE (v0.14.4): the tour's visited stops per browser + layout (localStorage, try / catch)
src/play/people.js                 PURE: people at desks: deskSeat / deskSeats (the chair of a desk), seatPose,
                                   personNear, chooseFullCharacters (≤ 12 nearest), BONE_TABLE (Mixamo ↔ Unreal
                                   names), normaliseBoneName, SEATED_POSE / STANDING_POSE (tests in play/__tests__)
src/engine/systems/CharacterSystem.ts  People: simple figures (thin instances) + full characters (GLB per file, a copy
                                   with its own skeleton per person, posed by bone names), per floor, not pickable
src/engine/systems/PlayerCharacter.ts  Walking as yourself: your character (copyCharacter) + the walk clip baked onto
                                   its bones (retargeted by name, rest-pose corrected), playController's character
src/embed/characterManifest.js     PURE: the character manifest (v1 flat map; v2: clip sets, neutral set, groups, outfit,
                                   seated copies), setPeople's list, neutralFor (the even default by personId)
src/engine/systems/ClipLibrary.ts  v0.16.0: clips baked once per character file (bakeClip: by bone names, under the glTF
                                   root's mirror, limbs aligned to the clip's rest), Animator (cross-fades), holdClip
src/play/live.js                   PURE (v0.16.1): live presence: cleanLive / cleanSample, createTrack (the 250 ms
                                   glide + snap), chooseLiveDrawn (nearest 30), standingSpot, createPoseThrottle / poseOf
                                   (your pose ≤ 5 / s), nextFullCap / windowFps (the full-character limit from frames)
src/engine/systems/LiveSystem.ts   engine.live (v0.16.1): live people drawn (figures `live_people`, full characters
                                   `live_<id>` via animatedCharacter), their desks emptied, name tags (DOM, `[data-live-tag]`)
src/engine/systems/FullCap.ts      FullCapMonitor (v0.16.1): the full-character limit measured from the frame rate
src/play/outfit.js                 PURE (v0.16.0): the Wardrobe's clothing on Rocketbox parts (cleanClothing, parts, tints)
src/utils/gltfExtensions.js        The glTF extensions we load (webp, specular, unlit; v0.16.0 meshopt + quantization,
                                   the npm decoder bundled, never Babylon's CDN)
src/play/group.js                  PURE (v0.15.5): several items: groupMembers, groupMoves, groupTurn, copyItems, paste
src/planner/groupActions.js        Studio's group actions + copy / paste (one editor command each)
src/floorplan/planFloors.js        PURE (v0.15.5): adjacentFloor, floorBelow, planStairs, the Plan's saved zoom / position
src/play/wallMount.js              PURE (v0.15.6): wall items (WALL_ITEMS heights), wallPieces / wallFaces, mountOnWall,
                                   isOnWall, hangsOnWall (no floor obstacle); play/floorWalls.js caches a floor's pieces
src/play/dragSnap.js               PURE (v0.15.6): snapping while dragging (walls, items' edges / middles, grid) + guides
src/play/locks.js                  PURE (v0.15.6): what a lock stops (a locked room: no move / resize / turn / delete)
src/ui/hiddenLayers.js             Layers' eye (v0.15.6): hidden rooms / items per workplace, Studio's view only
src/play/carry.js                  PURE (v0.15.1): what an item takes along (carriedBy: a desk's chair + riders), carryMoves,
                                   turnStep (R 90°, Shift+R 15°), carryDrop (v0.15.2: putting it down in Walk through)
src/utils/itemRiders.js            ridersOf: what stands on an item, from its mesh (Studio's drag + Walk through's carry)
src/utils/livePosition.js          Where the dragged item is now (the Inspector's X / Z during a drag); not saved
src/play/geometry.js               PURE maths: room corners, wall splitting, doors, neighbours, stretchRoom, resizeOpening,
                                   shared walls (roomWallSegments, wallPickTarget), nesting (roomContainedBy, containerOf,
                                   planRoomMove, roomRectBlocker), snapping (snapRoomRect),
                                   roomsToRebuild
src/utils/pickHelpers.js           Forgiving picks: the floor under an item = that item; a shared wall = the room on your side
src/play/building.js               PURE maths: storeys, stairs, openings, supportHeight (where you stand)
src/play/speeds.js                 THE walking speeds (v0.14.5): WALK_SPEED 2.2, RUN_SPEED 4.5, FLY_SPEED 6 m/s; the keys, the joystick, Take me there, the tour and every time estimate
src/play/movement.js               Collision-safe movement in 0.1 m substeps (afterStep callback for step-up)
src/play/character.js              Placeholder character; interface { root, update(dt,speed,flying), setVisible, dispose }
src/store/workspaceStore.js        Zustand store: rooms, objects, floors, anchorData, selection, save/load
src/store/layoutData.js            PURE: normaliseLayout (old saves → current shape), layoutSummary (layout list)
src/store/editorHistory.js         THE place layout changes happen; every change is an undoable command
src/utils/roomBuilder.js           Room meshes: floors, walls around openings, slab, roof, ceiling + lights (parts merged, frozen)
src/utils/assetInstances.js        Items = instances of one template per asset type; mergeByMaterial; own look (lock/outline)
src/components/CompanySelector.jsx Companies + layouts screen (ui/selector.css): open, create, rename, delete, export, import
src/utils/materialLibrary.js       Procedural textures; SHARED materials; their PBR photo-texture twins (realistic look)
src/utils/assetCatalog.js          50 furniture/equipment items built from primitives (incl. STAIRCASE, CNC_MACHINE, LATHE);
                                   the primitive model is also the fallback of a real model
src/utils/modelRegistry.js         PURE data: catalogue item → Kenney GLB (+ fit), room surface → texture set, asset paths
src/utils/modelLoader.js           Loads each GLB once per scene (AssetContainer), fits it, our shared materials
src/utils/realLook.js              "Realistic look" per scene (on / off, assetBaseUrl, whenLoaded, Studio setting)
src/play/modelFit.js               PURE maths: fit a model's box into the primitive model's box (stretch / contain)
public/assets/                     models/kenney/*.glb, textures/<set>/{color,normal,rough}.jpg, env/sky.env (all CC0,
                                   docs/ASSET_LICENSES.md); made by scripts/prepare-assets.mjs + scripts/make-env.mjs
src/utils/siteEnvironment.js       Sky, fog, grass, paving, build grid
src/engine/systems/SceneBuilder.ts Progressive loading: builds rooms + items in ~10 ms slices, start floor first (Studio + engine)
src/play/buildSchedule.js          PURE: floor build order, slice budget, big change (> 50 new), progress
src/integration/layoutBridge.js    Public API for teammates' modules (events, anchors, Press-E actions)
src/engine/                        Embeddable engine (H2): LayoutEngine (own store, loadLayout / getLayout, camera,
                                   highlights, modes, `editor` refused outside edit mode); model/ (v2 schema, v1→v2 and
                                   back: toV1), anchors, commands; systems/: SceneSetup, RoomSystem, ObjectSystem,
                                   FloorSystem (Studio uses these four), CameraSystem, HighlightSystem, WalkthroughSystem
                                   (Placement/Selection still stubs); react/: <LayoutViewer />, <LayoutEditor />
viewer.html + src/viewer/          Blank test page for <LayoutViewer /> (sample company, bridge event list);
                                   walkMapDebug.js: ?mode=view&debug=walkmap (the walk map + a route, loaded only then);
                                   tourDebug.js: ?mode=view&debug=tour (the tour's plan drawn, v0.14.3; loaded only then)
src/embed/                         The one-file embed for plain HTML pages: index.jsx (AHDUSWorkplace.mount → <LayoutViewer />
                                   + layoutBridge), embedLayout.js (pure: layout / layoutUrl, action matching), embed.css;
                                   built by vite.embed.config.js. embed-test.html + embed-sample.ahdus.json: its test page
src/services/apiService.js         Save/load + auto-save (1 s debounce, tab close), revisions + other tabs, export/import,
                                   companies, version history: localStorage for now (Supabase path: prototype, flag off)
src/services/savedLayouts.js       Reads a layout saved in this browser (LayoutViewer, the embed): not apiService, so a viewer
                                   bundles no saving code (no Supabase client)
src/services/ahdusBackend.js       VITE_LAYOUT_BACKEND=ahdus: a site's draft, versions, publish through the AHDUS API (v2, Bearer token)
db/schema.sql                      PostgreSQL schema (base for the Supabase backend)
```

## Rules (follow these)

1. **Every layout change goes through `editorHistory`** (`createEditorHistory()`: addObject, updateObject,
   deleteObject, duplicateObject, moveObjects, replaceObjects, toggleLock, lockObjects, lockRooms, toggleRoomLock, addRoom, updateRoom, moveRoom, turnRoom, deleteRoom, toggleDoor, addOpenings,
   removeOpenings, resizeOpening, setWallHeight, setFloorHeight, setAnchorData, addFloor({ copyRooms }), removeFloor,
   renameFloor, restoreVersion). Never call store mutators directly from
   UI or tools, or undo breaks. Continuous edits (slider drag, typing, + / − bursts) pass `{ mergeKey }` so they are
   one undo step: same mergeKey + same target merge until 2 s without input (timed from the input events,
   `inputTime`), the mouse is released or the tool changes (`editor.endBurst()`), or another command comes between.
2. **Store uses the v1 field names** (`floor`, `isLocked`, `scaleX`, …). The v2 format (`src/engine/model`) is for
   export/teammates; `migrate.ts` converts. Don't rename store fields.
3. **Heights:** each floor stores its `height` (floor-to-floor, default `STOREY_HEIGHT` 3.5 m). Its elevation is
   **derived**, never stored: `elevationOf(floors, id)` = the heights of the floors below (floors stack in id order).
   An object's `y` in the store is **relative to its floor**. Meshes, anchors and bridge positions are **world space**
   (elevation + y). Room walls fill their floor (`wallHeight` = floor height − `SLAB` 0.3 m) unless made lower;
   change heights only through `editorHistory.setWallHeight` / `setFloorHeight` (they keep walls and floors fitting).
4. **Materials are shared** between meshes/objects. Never `material.dispose()` directly; use
   `disposeMaterialIfOwned` / `markShared` from `materialLibrary.js`.
5. **Mesh metadata drives picking and visibility:** room parts carry `{ roomId, floorId, part }` with part in
   floor | wall | door | window | slab | roof | ceiling | band | skirting; objects carry `objectId` and `floorId`. Keep it on new meshes.
   Room parts with the same metadata are merged into one mesh per role (one per wall, per frame, …), one sub-mesh per
   material, world matrices frozen. Items: a root TransformNode (moved by gizmos) + ONE child, an instance of the
   asset's template (`assetInstances.createItemMesh`); per-item looks (overlay, outline) need `setItemLook(root, reason, on)`.
   Each door/window has an invisible pickable pane (`*_pick`, visibility 0, `metadata.pickPane`): Studio clicks and
   Preview's Edit item pick the door with it; Preview's other aiming looks through it (`aimPick(..., { panes })`).
6. **Pure maths stays pure:** geometry/building logic goes in `geometry.js` / `building.js` (no Babylon imports)
   with vitest tests in `src/play/__tests__/`.
7. **Anchor IDs** are uuid v5 of objectId + kind. Never change this; teammates store these IDs
   (`engine/__tests__/anchors.test.ts` pins known values). New rooms / objects get `room_<uuid v4>` / `obj_<uuid v4>`;
   IDs from saves (`obj_12`) are kept as they are.
8. **`layoutBridge` is a contract with teammates.** Don't break its API; if you change it, update
   `docs/TEAM_INTEGRATION.md` and `src/integration/__tests__/layoutBridge.test.js`.
9. User-facing text: short, plain English. Every new feature must be undoable and must work on upper floors.

## Multi-storey (how it works)

- `WorkplaceEditor` builds **all** floors at once (`engine/systems/RoomSystem`, `ObjectSystem`). `FloorSystem` uses a view `{ mode, level }`:
  `planner` shows floors ≤ selected and hides the selected floor's roof; `outside` shows all + roofs on uncovered
  rooms; `inside` shows all + ceilings, and the camera is clamped under the ceiling (except on stairs).
  `LayoutEngine` (viewer, embed: the 3D Company page's "Upper view") is always `planner` outside walkthrough, on the
  store's `currentFloor`: the ground floor at first, the chosen one (`setFloor`), the floor walked to after walking,
  so the desks and people of that floor show from above. Walking uses `outside` / `inside` (`onViewChange`).
- **Floor heights** (`building.js`): floor `{ id, name, height }`; `elevationOf` sums the heights below. Upper-floor
  rooms sit on a `SLAB` (0.3 m) that starts exactly where full-height walls below end, so storeys never gap or overlap.
  `planWallHeight`: lower walls change only that room; walls higher than the floor allows raise the floor to
  walls + SLAB, rooms that filled it grow with it, floors above follow (one undo step: `HeightsCommand` in
  editorHistory, mergeable for + / − bursts). `planFloorHeight` (Studio floor menu "Floor height"): filling rooms
  follow, taller ones shrink (walls 2 to 15 m, floors 2.3 to 15.3 m; on floors over 6.3 m the hints add "Stairs here
  would be very steep": `steepStairsText`). A room made lower than its floor gets a wall **band** (part `band`) up to the slab,
  shown only where rooms above cover it, so no gap shows from outside. Old saves (`normaliseLayout`): height =
  distance between the saved elevations; walls that met the old 0.5 m slab grow 0.2 m; every floor ≥ tallest wall + SLAB.
- Stair openings are cut from the floor above and from the ceiling **and roof** below (`stairHolesFor` →
  `subtractRects`), so stairs with no room above look up at the sky.
- **Staircase:** 1.2 × 4.0 m, climbs exactly the height of the floor it starts on (`stairDims(rise)`: steps of at
  most 0.2 m, e.g. 18 for 3.5 m). Mesh (`buildAssetMesh(..., { rise })`, rebuilt when the floor height changes), walking
  (`stairDimsFor` in `supportHeight`) and openings all use it. **What is drawn is what is walked on (v0.14.5):**
  `building.stairDrawn` is the one rule ObjectSystem draws by: on its floor (a saved `y` is ignored), level (saved
  rotationX / Z ignored), its floor's height (scaleY ignored); an old save's scaleX / Z stay and count everywhere
  (`stairSize`: `stairHeightAt`, `stairOpening`, `stairTop`, `stairBottom`, the walk map). Nothing new makes one: `stairPatch`
  in `editorHistory.updateObject` drops y, tilt and resizing ("Normal size" is the only scale change), the Inspector has
  no Height or size (`STAIRS_KEEP_SIZE`), the gizmos (`attachToMesh(…, { fixedShape })`) no up arrow, no tilt rings and
  no scale, the R key says why. A flight has no collision mesh, so its **sides** are `building.stairPushOut` (playController
  `stepUp`, not when flying): where its surface is more than `STEP_UP` over your feet it pushes you out, sideways or
  out of the block; under a flight of the floor above nothing happens. Placing one with no room where it arrives warns
  "Build a room above to use these stairs" (`stairNeedsRoomAbove`). **Stairs that lead nowhere (v0.14.6)** (no floor
  above, or no room where they arrive) can't be climbed: `supportHeight` ignores their steps, `stairPushOut` (given
  `rooms`) blocks them all round, the bottom step too (`nowhere: true`: the walker says "These stairs lead nowhere",
  `STAIRS_LEAD_NOWHERE`), and the walk map blocks the whole flight. **Studio** (`building.stairProblems`, shown in the
  Inspector of a selected staircase, `data-stairs-problems`, and as the message after placing one): NOWHERE ("These
  stairs lead nowhere: …"), and, in the innermost room holding its middle: STICKS_OUT, NO_STEP_ON (no
  `STAIR_STEP_ON` 0.8 m in front of the bottom step inside the room), BLOCKS_DOOR (the flight in a door's `DOOR_CLEAR`
  0.8 m). Walking uses `supportHeight` (STEP_UP 0.45),
  checked after every 0.1 m substep so it works at low fps. A room's floor reaches under its own walls there too
  (v0.13.4): the doorway between two rooms back to back upstairs is not a gap to fall into. `levelForY` decides which floor you're on (1 m lead).
- **Rooms line up between floors:** on an upper floor both modes draw a faint outline of the floor below
  (`utils/floorOutline.js`) while building, and `planRoom` / `stretchRoom` snap edges within 0.3 m onto its walls
  (`snapRectToOutline`, pass `below`). A room that overhangs gets "Part of it has nothing under it" in the hint.
- **The ground floor (lowest, always id 0) can't be deleted** (floor menu, `editor.removeFloor`, store). Old saves
  without floor 0 are renumbered by `normaliseLayout` so the lowest floor becomes 0.
- **Adding floors:** Studio's "Add floor above" and Preview's N ask "Copy rooms from below" (default) or "Empty floor";
  `editor.addFloor({ copyRooms })` copies footprints, types, wall heights, doors and windows (no furniture, no stairs),
  one undo step. N takes you to the new floor; Studio switches to it.
- **Preview floors:** Page Up / Page Down (or ▲ ▼ by the floor's name in the HUD, `floorPosition(…).name`; the viewer HUD shows it too, v0.13.1) = `play.stepFloor(±1)` →
  `arrivalOnFloor`: same x, z, standing on a room there, else flying at that floor's height; a wall or a desk there
  = the nearest free spot (`freeSpot`, see "Where walking starts"). Preview again after another floor was chosen
  (Studio's floor switcher) starts on that floor the same way, and a message left from the last walk is cleared
  (`activate`, `playController.floors.test.js`). A viewer's walkthrough always starts at the entrance instead.
- **Room height:** Stretch (slot 2) aimed at the top edge of a wall grabs the top (drag up / down), or + / − on a
  wall (0.1 m, a burst = one undo step). Studio: blue handles on top of the selected room's walls (3D), Inspector
  "Wall height". Hint: "Office · walls 3.4 m · Ground Floor is now 3.7 m high".
- Build tools act on `currentLevel` (the floor under the character). `__ahdusPlay.setPose({x,z,yaw,pitch,floor,y,fly})`,
  `goToFloor(id)`, `stepFloor(±1)`, `isFlying()`.

## Shared walls and nested rooms (how they work)

Both are **derived from the room rectangles and their `wallThickness`; nothing extra is saved** (no wall records, no
parent ids). Details: `docs/ROOM_FORMAT.md`.
- **Wall thickness** (per room, `geometry.wallThicknessOf`: `room.wallThickness` or 0.15 m for old saves and drawn
  rectangles; 0.1 to 0.6 m): walls are centred on the room's edge (half inside, half outside). Never use the
  constant `WALL_THICKNESS` for a room's walls; it is only the default.
- **Shared walls:** two rooms on one floor are back to back when opposite walls are at most the thicker wall apart
  (± 0.02 m; 0 or 0.15 m for default rooms). The shared part is built ONCE, as thick as the thicker wall
  (`sharedWallThickness`), centred between them, by the room whose **id sorts first** (with UUIDs that is unpredictable:
  never assume which), as its own mesh tagged `{ sharedWith, sharedWall, sharedAt }`.
  - **Picks:** every pick of a wall goes through `pickHelpers.wallTargetOf(hit, eye)`, which returns the room on the
    side it was hit from (face normal; camera or hit point on its top). This covers Studio select, wall drag and
    door/window, and Preview door/window, Stretch, + / − and remove room. Selecting either room outlines the shared wall.
  - **Doors:** a door through a shared wall is stored on both rooms (`planOpening`) and drawn once.
- **Rebuilds:** `roomGeometryKey` is made from `geometry.roomBuildInput` (the room and the rooms touching it), so a
  change rebuilds that room plus the rooms touching its old or new rectangle (`roomsToRebuild`), not the whole floor.
  Every rebuild input must be in that key.
- **Nested rooms:** a room may lie inside another one (`roomContainedBy`; the innermost is `containerOf`): on each
  side at least (outer + inner wall thickness) / 2 from the outer walls (0.15 m for default rooms), or **standing on the outer wall** (its edge on the outer room's edge,
  ± 0.02 m: that wall is its wall there). Walls partly in each other, partial overlaps and sticking out stay blocked.
  - **Snapping: one rule, `geometry.snapRoomRect`**, used by drawing (Studio + Preview), Stretch, the Studio wall drag,
    the Inspector size and moving a room by its floor (`translate`: the size stays). Within `ROOM_SNAP` 0.35 m an edge
    goes back to back onto a **sibling** (same outer room, or both top-level; never rooms inside other rooms), or onto
    the **outer room's wall** (an outer room's edge also onto the rooms standing inside it); else, top-level only,
    onto the floor below. `roomRectBlocker`: changing a room keeps its children inside and itself inside its parent.
  - **One wall on the outer wall:** where an inner room stands on it the outer room builds nothing; the inner room
    builds that stretch, as thick as the outer room's walls, on the outer line, shared with the outer room (`sameSide`, `innerRoom`,
    `outerRoom` tags: a pick from inside is the inner room, from outside the outer room). Its other walls stop at that
    wall's inside face. A door there is stored on both rooms (`partnerWall`). Siblings share through the normal code.
  - **Drawing:** the outer room's floor (and ceiling, if the inner walls reach it) is cut out under the inner room
    (`floorSurfaceHoles`). The inner room's own walls are drawn 1 cm thinner on the outside (`nested`), so no wall
    faces coincide, and it has no roof of its own under an outer room at least as tall (`roofCovered`).
  - **Studio:** drag a selected room's floor (or type its Room X / Z) to move it (`planRoomMove(room, x, z, rooms, objects)`:
    v0.15.1, the rooms inside it (`roomsInside`) and the items standing in it (`itemInRoom`, locked ones too) go along,
    one `editor.moveRoom` step). This happens only after a 5 px drag, and
    never where an item stands (a click selects what is under the cursor). The Inspector size snaps the edges it
    moves (so it sets x / z too) and keeps inner rooms inside (`planRoomResize`).

## Where walking starts (v0.13.0, how it works)

Step v0.13.0 of `private-docs/NAVIGATION_PLAN.md` (4.1, 4.2, 4.6). Pure maths in `src/play/navigation/` (no Babylon).
- **Walk map** (`walkMap.js`, `buildWalkMap(layout, floorId, { catalog })`): one grid per floor, 0.1 m cells
  (bigger on huge floors, ≤ 2.5 M cells), from the LAYOUT DATA: each cell is `FREE` (the body's centre fits),
  `BLOCKED` (a wall or solid item closer than `CLEARANCE` = body radius 0.32 + 0.05 m, measured exactly from the cell's
  centre; or within `HOLE_MARGIN` 0.15 m of a stair opening, v0.13.4: the body's centre over it falls), `STAIRS` (a flight starting on this floor) or `VOID` (nothing to stand on: outside an upper floor's rooms, a
  stair opening, off the map). The ground floor is walkable 10 m around the building (`STREET`). Walls = what
  roomBuilder builds (`roomWallSegments` / `wallSegmentOpenings` / `splitWall`: shared walls once, doors of either
  room cut them, windows don't), + skirting (it collides). Items: as ObjectSystem makes them collide (not markers,
  stairs, `solid: false` (a DOOR_SINGLE item in an old save: v0.14.5), nor y ≥ 1.8 m), catalogue size × scale, turned; `MODEL_SIZES` for the 10 models bigger than
  their catalogue size (`footprints.test.js` measures every model). Items keep `ITEM_CLEARANCE` (0.32 + 0.02 m, v0.13.2),
  walls `CLEARANCE`: a 0.8 m aisle between a chair and the next desk row is open. Upper floors: a room's floor
  reaches under its own walls (v0.13.2), so doors between rooms upstairs are walkable. A 1 m door leaves ~0.26 m. Doors from `MIN_DOOR_PASS`
  0.6 m (Studio's narrowest) are open, as for the real collision (v0.14.5, measured with the real meshes and controller in
  `play/__tests__/doorsWalk.test.js`: 0.6 m passes, sliding to the middle; 0.4 m does not): the cells a door's centre line
  crosses are tested ON that line (step 5, door passages, kept in `map.passages`: cell → its point on the line; a jamb
  counts only up to the door's half width, walls and items still exact). A flight is an obstacle too (`kind: 'stairs'`,
  v0.14.5): the cells beside it are BLOCKED, those on it stay `STAIRS` (a flight that leads nowhere: all BLOCKED, v0.14.6).
  **The L-shaped corner desk (v0.14.6)** blocks its two arms, not its square (`ITEM_PARTS`, `itemFootprints`; turned
  and mirrored with it): an arm along its local −Z side and one along −X, `people.CORNER_DESK_ARM` (0.4) of its size
  deep, as its real model draws it (the primitive model was made the same L; `footprints.test.js` checks it); the
  +X, +Z corner is open, where its chair goes. `map.isClear(x, z)`: FREE and the exact point clear (a cell's centre can be 7 cm further from a desk;
  the spawn and `freeSpot` use it). Meridian: ~15 ms per floor. `createWalkMapCache` rebuilds only when the store's
  room / item records or floors change.
- **Spawn** (`entrance.js` `entranceSpawn`): always the ground floor: its `SPAWN_POINT` (if blocked: the nearest free
  spot), else the **main entrance** (`outsideDoors`: on a part of the wall no room shares, its room not inside another,
  no room 1 m in front; a RECEPTION's first, then the widest) 3 m outside it, facing it; else 3 m outside the middle of
  the −Z side, facing the building; no rooms: (0, −8). Then `nearestFree` (≤ 6 m), preferring spots where the whole body
  is outside every room. Tests: Meridian-shaped layout (`__tests__/meridianLike.js`) + 200 seeded random layouts.
- **playController:** `spawnPoint()` / `respawn()` (= `placeAtSpawn`: ground floor, standing, facing the entrance,
  pitch −0.12) / `backToEntrance()` (Home key, + "Back at the entrance") / `isFree(x, z, floor)`. Option
  `respawnOnActivate` (WalkthroughSystem: true, every walk starts there; Studio's Preview: only the first time, then
  it keeps your place). `goToFloor` (Page Up / Down, a viewer's `setFloor` while walking) and `setPose` move a spot in a
  wall / solid item to the nearest free one (`freeSpot`; flying or `y` given: only off walls and items);
  `setPose({ …, exact: true })` = exactly there, even in a wall: **tests only** (play-smoke's `aimAtGround` aims
  from a spot computed through a wall); features and teammates' code must never pass it.
  Collisions themselves (walls, windows, solid furniture, `moveWithSteps`) and free walking are unchanged.
- **UI:** viewer / embed HUD button "Back to entrance" (`data-hud="entrance"`, top left next to the keys hint);
  Preview's HUD "Entrance" (aria-label `Back to entrance`) + Home in its key list. The spawn point's marker (the blue
  disc) shows in Studio only (Preview too): LayoutEngine outside edit mode hides `STUDIO_ONLY_TYPES`
  (`ObjectSystem.setHiddenTypes`, FloorSystem never enables them; the item, its anchor and focusOn stay), v0.13.1.
- Not yet: Studio hints ("No door leads outside…", "Spawn point is inside furniture…"); "Take me there" is v0.13.4
  (search is v0.13.3, see "Search"; Take me there v0.13.4, see "Going there").

## Routes (v0.13.2, how they work)

Step v0.13.2 of `private-docs/NAVIGATION_PLAN.md` (4.3, 5.2). PURE: `src/play/navigation/route.js`. Used by the
viewer's debug view, search while walking (v0.13.3: how far, "Nearest washroom") and Show route / Take me there (v0.13.4).
- `findRoute(layout, from, to, { catalog | maps, links, name })` → `{ legs: [{ floor, points, stairsAtEnd? }], length,
  seconds, from, to }` or `{ problem, message }`. Exact A* over the FREE cells of all floors (8 neighbours, no
  corner cutting, octile); floors joined by **links** (`floorLinks`: a staircase from the spot in front of its bottom
  step to `stairTop`, both ways, `via` = up the flight's own line (v0.14.5: a landing can move aside, the flight's sides are solid), cost = its length; stairs that lead nowhere are none; `options.links` for
  lifts later); the heuristic goes through the links. `stairsAtEnd` = { kind, objectId, direction, toFloor, length, via }.
- Walking within 4 cells of a wall or item costs up to double (`NEAR_WALL_COST`): routes keep to the middle of
  doors and corridors. Never a block: a door under ~0.9 m is ONE cell wide on the walk map and routes go through
  it (on its centre line, `map.passages`).
- Smoothing: the furthest point in line of sight (every crossed cell FREE + the segment ≥ body + 0.02 m from every
  wall and item, exactly), and no closer to any obstacle than the cell path came (− 5 cm).
- Start / goal in a wall or desk: the nearest free spot (start: not a pocket between furniture). **A goal only moves
  within its own room, never across a wall (v0.14.5):** the room = `to.roomId` (places give their goals one, an item's or a
  person's from where the desk stands, not a saved id) or `roomAt`; pulled inside it, then the nearest reachable spot within
  `ROOM_SNAP_DISTANCE` 4 m in that same innermost room (`sameRoomTest`; none: `SNAP_DISTANCE` 1.5 m on the same side of every
  wall, for a spot outside). Else it says why: "No walking route to Dhruv Khatwani's desk: Dhruv's office has no door" or
  "…: something blocks the way into Dhruv's office", never a walk to the window outside. The walkable areas are labelled per map and joined by links, so "no route"
  is known at once: `NO_FLOOR`, `START_BLOCKED`, `NO_STAIRS` ("…: no stairs lead to Floor 2"), `GOAL_BLOCKED`,
  `NO_DOOR` ("No walking route to Server Room: it has no door"), `START_NO_DOOR`, `NO_ROUTE` ("…: something blocks
  the way"). The name: `options.name`, else the room there, else the floor.
- `findNearestRoute(layout, from, goals)`: the nearest by walking (nearest-first by straight line, stops when no
  other can be nearer) + `goalIndex`.
- Speed: the longest Meridian route (entrance → Floor 1's far corner, 122 m) ~30 ms warm in Node (the plan's limit),
  ~100 ms the first time after a layout change (pass one `maps` = `createWalkMapCache` to reuse the maps).
- Tests (`route.test.js`): an independent checker (every 2 cm of the route FREE and ≥ body radius from walls and
  items; wall crossings only in doors), door middles, 0.6 m / 0.5 m doors, no door, stairs up / down, the
  Meridian-shaped layout (entrance → the far desk upstairs through the expected doors; every 3rd desk upstairs)
  and 200 random layouts.
- **Debug view:** `viewer.html?mode=view&debug=walkmap` (`&to=x,z,floor`, `&from=x,z,floor`): the current floor's
  walk map (green free, red too close, blue stairs, yellow narrow-door cells), the route in orange, a panel
  (`[data-walkmap-debug]`, `data-route-problem`) with length / time / ms; click the floor = the goal, Shift + click =
  the start. Dev hook `window.__ahdusWalkDebug` ({ route(from, to), last, ms }).

## Search (v0.13.3, how it works)

Step v0.13.3 of `private-docs/NAVIGATION_PLAN.md` (4.4, and the "not walking" part of 4.5). No backend change.
- **Index** (`src/play/navigation/places.js`, PURE): `buildPlaces(layout, people)` = people (setPeople: personId, deskId,
  **name and department only**: nothing else is copied, so an email can never show or match; a desk not in the layout
  = not found), rooms (name, else type label), departments (a room's department, `places.roomDepartments` (v0.14.9): `room.departmentRef`, else the department of MORE THAN
  HALF of the people seated in it (a tie or nobody: none; never for `SHARED_ROOM_TYPES`: reception, washrooms, meeting
  rooms, stairs, corridors), the same for Find, the browse menu and the tour; of several rooms, or one room of
  another name), facilities (`FACILITIES`: RESTROOM = washroom / restroom / toilet / WC / bathroom…, MEETING,
  RECEPTION, STAIRS: rooms of those types, and RECEPTION_DESK / STAIRCASE items not in a room of their kind). Each
  place: `detail` ("HR · Ground Floor, Lobby & Reception"), `entityId` (focusOn), `highlight` ids (a person: desk +
  chair), `goals` (where a walk ends: just inside each door, 0.7 m behind a chair (a
  reception desk: in front of its counter, `people.visitorSpot`: its visitor side, `COUNTER_GAP` 0.45 m out; a corner
  desk (v0.14.6): at an open side of its L, `OPEN_SIDE_GAP` 0.3 m out, level with its person, only the sides at least
  `VISITOR_WALL_GAP` 0.4 m inside the room, `people.visitorSpots` + `places.deskGoals`; none: behind the chair), in
  front of a stair's bottom step (in the flight's own room when that spot is through its wall, v0.14.6)).
- **Search** (`searchPlaces`): every query word must start a word of the place (name words first; 3+ letters also
  inside a name word); whole names first; then the floor shown / where you stand. A query naming a facility
  ("wash") lists all of them; walking (`from` with x, z) a "Nearest washroom" entry comes first. Groups People /
  Rooms / Facilities (`order`, `groupOrder`: Rooms first when a room or department matches better than any person,
  "Engineering", "Sales"; a tie keeps People first), `GROUP_LIMIT` 6 each, the rest counted ("and 84 more"). Meridian (319 people): 1–4 ms per
  keystroke in the page, ~15 ms the first (the index is made then); remade when rooms / items / floors / people change.
- **Engine** (`engine.navigation`, `systems/NavigationSystem.ts`): `find(q, { limit })` (flat, `publicPlace` shape),
  `search(q)` (grouped), `show(id)`: from above `focusOn` (+ `around` 4 m for a person or item, `beta` ≤ 0.75:
  looking down so walls don't hide it; `CameraSystem.flyTo` tilts) + `highlight` (`SEARCH_HIGHLIGHT` green);
  walking: highlight + `findNearestRoute` from where you stand → `{ route: { length, seconds, floors } }` or
  `{ problem, message }` (each goal named after its own place). `clear()`. People are kept here too, so search works
  with quality 'low' (no CharacterSystem).
- **UI** (`engine/react/PlaceSearch.tsx`, in `<LayoutViewer search>`, default true; embed option `navigation: { search }`):
  a "Find" button (aria-label `Find a person, room or place`) in the viewer's top-left toolbar (walking: after the
  keys hint and Back to entrance); the panel below it, `width: 100%` of the toolbar column, max 400 px (a phone: the
  view less 12 px each side). Input = combobox + listbox (`aria-activedescendant`), groups, a live status ("1
  result"). ↑ ↓ Enter; Esc closes (stopPropagation: not the walkthrough's Esc) and focuses the button. A pick
  empties the box (Esc keeps what was typed). After a pick: a card (`data-place-shown`) with the name, detail, walking
  "42 m walk, about 10 s · by the stairs" or the problem, and Clear. The AHDUS look (white, AHDUS green) as inline
  styles (the viewer has no stylesheet; there is no separate "AHDUS mode" in the viewer / embed). Typing in the box
  never walks (playController ignores inputs); focus in it shows no focus ring.
- **Embed:** `workplace.find(query, { limit })` ([] until ready); `navigation: { search: false }` hides the box.
- **The browse menu** (v0.14.2, private-docs/EXPERIENCE_PLAN.md 3.3, decisions in its section 6): while the box is empty.
  PURE `play/navigation/browse.js` `browsePlaces(index, { departments, me })` from the SAME index (`buildPlaces`, which
  now also keeps rooms' `roomType` and the floors in order): `chips` = the FACILITIES that exist (`only`: the one of
  its kind); `myDesk` = `person:<me>`; `departments` = rooms' `departmentRef` + people's departments (matched by
  `words`, by name): "Engineering · 2 rooms · Floor 1 · 92 people", `place` = the department place (several rooms)
  or its one room (people only: none), the description from the page (`DESCRIPTION_MAX` 280); `kinds` = room types
  (+ item facilities under RECEPTION / STAIRCASE), `KIND_LABELS` (Offices, Meeting rooms, Washrooms, Reception,
  Stairs first, then others by name; an unknown type "LAB_SPACE" = "Lab space") with their places by floor; `floors`
  = "Ground Floor · 13 rooms" → its rooms (empty floors left out). `addRecent` / `recentPlaces`: place ids, newest
  first, at most `RECENT_MAX` 5, only those that still exist. `engine.navigation.browse({ recent })` = that in the
  public shape + walking, each chip's `nearest` ({ place: 'nearest:X', length, seconds } by `findNearestRoute`; null:
  no route); `setDepartments` (`LayoutEngine.setDepartments`, `<LayoutViewer departments>`, the embed's
  `departments` option + `setDepartments`, cleaned by `embedLayout.cleanDepartments`: name + description only); "me"
  = `setPlayer`'s personId (`getMe` hook). UI (`PlaceSearch`, pure `browseScreen(menu, view, { walking })` +
  `chipLabel`, tested in `engine/__tests__/PlaceSearch.test.ts`): the start = chips ("Quick picks"; walking "Nearest":
  "Nearest washroom · 8 m", a tap shows it; else one of its kind = shown, several = its list), My desk, Recent,
  Departments, Places (a count), By floor; a list opened = Back ("‹ All", `data-browse-back`), a head
  (`data-browse-head`: name, detail, description) and its places (a department: "All of Engineering", Rooms, People
  (n)). All of them options of the one listbox (`data-browse` = home | department | kind | floor; `data-browse-open`,
  `data-quick` = the kind's label, `data-my-desk`, `data-recent`, `data-place`): ↑ ↓, Enter opens / picks, ← /
  Backspace (empty box) / Esc go back (Esc at the start closes), back lands on the entry opened; the status line says
  where you are. Recent: localStorage `ahdus.findRecent` (try / catch), read again on each open; a pick adds the
  place shown ("Nearest washroom" = the one chosen). While Find is open the one-time walk hint waits (`onOpenChange`);
  walking, the toolbar column (and so the panel) ends above the joystick (touch) or 100 px up (the HUD).
- The card's buttons **Show route** / **Take me there**: v0.13.4, see "Going there".

## Going there: Show route and Take me there (v0.13.4, how it works)

Step v0.13.4 of `private-docs/NAVIGATION_PLAN.md` (4.5, 4.6, 4.7, notes in 5.2 / 5.3). Viewer / embed only (Studio's
Preview has no search box).
- **Walk maps in idle time:** `engine.navigation.walkMaps` is ONE `createWalkMapCache`, shared with the walkthrough's
  controller (`WalkthroughSystem` passes it as `walkMaps`; `playController` option, default its own). After
  `loadLayout` and `whenBuilt`, `navigation.warm()` builds each floor's map in its own idle callback, then one route
  from the entrance; it stops if the layout changes. `engine.whenNavigationReady()` (tests).
- **`routeTo(target, { walk: 'guide' | 'auto' })`** (`NavigationSystem`): target = a place id, `{ personId }`,
  `{ roomId }`, `{ deskId | objectId }`, `{ type }` (`nearest:TYPE`), `{ x, z, floor, name }` (a spot). Not walking:
  `setMode('walkthrough')` first (every walk starts at the entrance), the 'mode' event tells the page. Then
  `findNearestRoute` from where you stand, the place outlined, the walker's **pilot** set
  (`playController.setAutopilot`), the line drawn, 'started'. Answers `{ place, walk, length, seconds, floors }` or
  `{ problem, message }` (NOT_FOUND, NOT_WALKING, a route problem; 'failed' too). `stop()`, `resume()` (G),
  `walking` ({ place, walk, paused, remaining, elapsed }).
- **The pilot** (`playController.update`): each frame `pilot.drive(dt, { x, z, y, floor, yaw, userMoving, flying })` →
  `{ dirX, dirZ, speed, yaw, pitch? }` or null. A drive replaces the keys' move and goes through the SAME
  `moveWithSteps` (collisions, step-up, stairs); null = free walking exactly as before (no pilot = no change at all).
  G and Esc go to `pilot.key` first. 'guide' never drives (the line only); 'auto' does.
- **Following** (`follow.js`, PURE): `createFollower(route, { mapFor })` projects you on the route (`routePath`:
  points with their distance along it, a flight along its own line, as long as the route says), steers to the furthest clear point ahead
  (1.8 / 1.3 / 0.9 / 0.6 m, side offsets ± 0.1 / 0.2 m; clear = cells walkable + `FURNITURE_CLEARANCE` 0.44 m from
  items, or as much as there is), pushes away from furniture across the way; where it is **tight** (`tightAhead`: the map
  blocked on both sides within 0.3 m of the line in the next 1.5 m, a 1 m door, a narrow aisle) it follows the route's
  own line closely, at most `TIGHT_SPEED` (0.9 × walking) and 0.2 m per frame (a slow frame cut the corner into a door frame); a step never
  ends closer than 0.36 m to a wall or item (`SAFE_CLEARANCE`, nor closer than you are), else it is halved (the turn off
  the top of a flight at 0.25 s frames), turns at most `TURN_RATE` (270°/s) and
  slows for turns, corners and the last 2 m (`AUTO_SPEED` = `WALK_SPEED`). `offRoute` (> 3 m: `OFF_ROUTE`),
  `stuck` (< 0.3 m in 1.5 s), `arrived` (within 1 m on the goal's floor).
- **NavigationSystem's rules:** off route → a new route (≤ every 0.5 s); stuck → a new route, stuck twice (the count
  resets after 3 m) → 'failed' "Can't get past here"; a movement key in 'auto' → paused (progress, `paused: true`),
  G → walk on (from 'guide' too: it becomes 'auto'), Esc / Stop → 'stopped'. Arrival: 'auto' turns to face the place
  (pitch −0.18), then 'arrived'; 'guide' at once. The outline stays after arriving (closing the strip clears it);
  leaving walkthrough, a new layout or dispose stops the route. Events ('navigation'): started, progress (each 1 m or
  1 s; `rerouted`, `paused`), arrived, stopped, failed: `{ state, walk, place, remaining, length, seconds, floor,
  paused, rerouted, problem, message }`.
- **The line** (`RouteLineSystem`, made on first use): chevrons every 1 m from where you are to the goal, on the
  floor you are on (+ the flight you are on), 2 cm above the floor (`supportHeight`); a blue ring + post at the stairs
  to take, a green one at the goal. TWO meshes with thin instances, emissive, unlit, not pickable, `zOffset`:
  ≤ 2 draw calls. Redrawn ≤ every 0.5 s while you move.
- **UI** (`PlaceSearch`): the card gets **Show route** (`data-route="guide"`) and **Take me there** (`data-route="auto"`);
  a pick then focuses the view (`focusView`: the keys are the view's). While a route is followed the strip
  (`data-nav-strip` = state, `data-nav-walk`, `data-nav-paused`) replaces the card: "Going to Kavya Iyer · 42 m
  [· Floor 1]" (`goingLine`), "Paused · Press G to continue", Continue / Take me there (`data-nav-continue`), Stop
  (`data-nav-stop`); then "You have arrived" + name + detail, or the problem (`data-nav-problem`), with Close. The
  person card shows by itself there (within 1.8 m; after a walk arrives at a person, their card stays while you are
  within 3 m: across a reception counter too, `personNearWalker(radius, personId)`). `<LayoutViewer onModeChange onNavigation>`; viewer.html keeps
  `window.__viewerNav` (dev).
- **E at a person (v0.14.7):** after a walk ('arrived' with `place.personId`) the engine keeps `arrivedPerson()` until you
  are `ARRIVED_NEAR_M` 3 m from where it arrived, on another floor, a new walk starts, walking ends or a layout loads.
  Meanwhile the walkthrough's `nearTarget` (a playController option, `eTarget`) makes E and its hint mean them ("E Details:
  Asha Patel", not the window behind a corner desk), unless the crosshair is on an item a module has an action for; E =
  the `personDetails` event ({ person }), and LayoutViewer pins their card. Tests: LayoutEngine.test.ts,
  WalkthroughSystem.test.ts (the real controller, a window aimed at), e2e:navigation (Kavya).
- **Embed:** `workplace.goTo(target, { walk })` (a name = the first search result), `stopRoute()`, the 'navigation'
  event; the handle's `mode` follows the engine's 'mode' event.

## The tour's plan (v0.14.3, how it works)

Section 3.5 of `private-docs/EXPERIENCE_PLAN.md` (decisions in its section 6). PURE planning; the tour itself (TourSystem
+ its panel) is v0.14.4, see "The company tour". `src/play/navigation/tour.js`, tests in `__tests__/tour.test.js`.
- **`planTour(layout, people, departments, { catalog | maps, speed, pause, facilityPause, backToReception })`** (engine:
  `engine.navigation.planTour(options)`, with its walk maps, people and departments) → `{ stops, floors, length,
  seconds, walkSeconds, pauseSeconds, minutes, mentions, skipped, missed, ms }`. Nothing to author: made from the
  layout and the seats. **Planned in idle time** (v0.14.4): the last step of `navigation.warm()`, after the walk maps;
  `navigation.tourPlanReady` (null until then), `tourPlan()` = that plan (cached, keyed on rooms, items, floors,
  people and departments), so "Start tour" never waits.
- **Stops, in order:** the main entrance (`entranceSpawn`), the reception (a RECEPTION_DESK's `visitorSpot`, facing
  it, else just inside its door); each department once (`places.roomDepartments`: `departmentRef`, else from the seats, v0.14.9; by `words`; its rooms on one floor
  grouped, on several floors it stops where most of them are, the others in "Also on Floor 1: …"); ONE washroom and
  ONE meeting room per floor (`TOUR_FACILITIES`: the one that adds the least walking, `insertBest`); floor by floor,
  ground floor first, then up by the stairs (`floorLinks`); back to reception (`backToReception`, default true).
- **Order within a floor:** walking distances from a Dijkstra field per stop on a COARSE copy of the walk map (0.3 m
  cells, a cell free if any of its 9 is; `coarseField`, Float64: Float32 broke the heap), nearest neighbour, then 2-opt
  (`twoOpt`: an open path, ending at the stairs up when a floor above is visited; the best stairs chosen). Each leg is
  then a real `findRoute` between two stops' spots: never through a wall. Meridian: ~150 ms with warm walk maps.
  **Where a room stop stands** (v0.14.4): about `STOP_INSIDE` 2 m in from one of its doors (`places.roomDoorFrames`),
  on a free, reachable spot in sight of the door (nearer, or 0.4 / 0.8 m to the side, where furniture is in the way;
  just inside the door when nothing fits), facing into the room (halfway towards its middle when that is ahead), so its
  desks and people are in view. The reception stays in front of its counter.
  A facility (washroom, meeting room) never comes right after reception when a department is about as near
  (`notRightAfter`: within `NEAR_FACTOR` 1.5 × its distance + `NEAR_EXTRA` 4 m): it moves further along the way.
- **Each stop:** `{ id ('entrance' | 'reception' | 'department:<key>' | 'room:<id>' | 'return'), n, kind, facility,
  name, floor, floorName, roomId, rooms, department, description (≤ 280), spot { x, z, floor }, yaw, people, names
  ([{ name, department }], at most 3: NOTHING else from the seats), lines, text, leg }`. `lines`: "Engineering · 2
  rooms: … · Floor 1", the description, "92 people work here", "Among them: …".
- **The leg:** `{ legs (findRoute's), length, seconds, directions, steps, mentions }`. Directions from the rooms along
  the route (samples every 0.25 m, runs under 1 m dropped): "Out of Reception, turn right along the corridor. Sales is
  the second door on your right." (`doorOrdinal`), "the stairs on your left, up to Floor 1".
- **Passing mentions:** a room whose door the route passes within `MENTION_DISTANCE` 4 m, in sight (`cellsClear` to
  the spot in front of it), not a stop, not walked through, once per tour: "On your left: Restrooms" / "Ahead: …" at
  that point (`at`, `door`, `side`: facing +Z, +X is on your right). `missed` = rooms neither stopped at nor mentioned.
- **Skipped:** a room no walk reaches (another walkable area than the floor's arrival point, `areaOf`) is left out
  with findRoute's reason (`NO_DOOR` "…: it has no door", `NO_STAIRS`, …).
- **Time:** walking at `speed` (WALK_SPEED) + each stop's `pause` (v0.14.4): departments and reception `pause`
  (`STOP_PAUSE` 20 s), the entrance and facilities `facilityPause` (`FACILITY_PAUSE` 8 s), the return 0;
  `minutes` rounded (at least 1). **Every count agrees:** stop 1's "The tour: N stops, about M min" (`tourSummary`) is
  made from the final list, as are Find's entry and the panel's "Stop 4 of N".
- **Debug view:** `viewer.html?mode=view&debug=tour` (`src/viewer/tourDebug.js`): the current floor's legs (orange,
  drawn over the walls), numbered stop discs with a stick the way they face, mentions (yellow, a line to the door), and
  a panel (`[data-tour-debug]`: `data-tour-stops`, `data-tour-length`, `data-tour-ms`, `data-tour-stop`,
  `data-tour-skipped`) with every stop, its directions and mentions. Planned again when the layout, the people or the
  departments change. Dev hook `window.__ahdusTourDebug` ({ plan, replan, dispose }).

## The company tour (v0.14.4, how it works)

Section 3.5 of `private-docs/EXPERIENCE_PLAN.md` (decisions in its section 6), from `planTour` (above). Viewer / embed
only (Studio's Preview has no tour). Free walking, Find and Take me there are unchanged when no tour runs.
- **`engine.tour`** (`systems/TourSystem.ts`, tested with fake hooks in `engine/__tests__/TourSystem.test.ts`, and in
  `LayoutEngine.test.ts`): `start({ follow: 'auto' | 'self', from, pauseScale })` / `restart` / `pause` / `resume` /
  `next` / `previous` / `skip` / `goTo(i)` / `setFollow` / `stop`, `status` ({ state, pausedFrom, follow, index,
  count, stop, plan, dwell, remaining, visited, mention, message }), the **'tour' event** (started, walking, arrived,
  paused, resumed, follow, mention, progress, done, ended, problem). States: idle, walking, stop (the stop's pause
  counts down in game time: `tick(dt)` each frame, dt ≤ 0.25 s), paused (`pausedFrom` walking | stop), done.
- **Start:** always the main entrance (stop 1): from above, walking starts there (`startWalking`); already walking,
  a jump there. `pauseScale` shortens every stop's pause (tests, demos).
- **Walks** are `navigation.routeTo(spot, { walk, source: 'tour', face })`: no Find strip, no navigation outline,
  'auto' pauses on a movement key / the joystick like Take me there (the tour shows "Paused"), G or P walks on; on
  arrival it turns to the stop's `yaw` (`face`, pitch −0.12) unless `turn: false`; a tour walk arrives within
  `TOUR_ARRIVE_WITHIN` 0.35 m of the spot (other routes: 1 m), so it ends well inside the room. "Walk me" = 'auto', "I'll walk" =
  'guide' (the line; arriving within 1 m completes the stop); `setFollow` switches the walk in progress
  (`navigation.setWalk`). Walking away from a stop (> 0.8 m): "I'll walk" goes on to the next, "Walk me" pauses.
  A click on the floor (source 'click') pauses the tour; resume = a new route. A failed walk (stuck, no route) = a fade
  there, and the panel says why. A route stopped by anything else (a new layout, leaving walkthrough) ends the tour.
- **Jumps** (Skip the walk, Previous, a stop from the list) go through the viewer's fader (`tour.setFader`: 250 ms to
  dark, `setPose` at the stop facing it, back; `[data-tour-fade="on"]`). **prefers-reduced-motion:** no turning on
  arrival, a fade + `setPose` with the yaw instead.
- **At a stop:** its rooms outlined (`TOUR_HIGHLIGHT` green), ticked, the panel shows it, and the **stop view**: the
  third-person camera eases (about a second) 1.6 m further back, 0.8 m higher and 0.24 rad further down
  (`playController.STOP_VIEW`, `setStopView(on, { instant })`, WalkthroughSystem `setStopView`, the tour's
  `stopView` hook); walls still pull it in, the ceiling caps it. Off when it walks on, walking away or the end; reduced
  motion: at once. Passing mentions ("On your
  left: Store") within 2.5 m of their point of the route, once each (shown 6 s, `MENTION_MS`).
- **Keys:** `playController.setKeyHandler` (WalkthroughSystem's `setKeyHandler`): the tour sees each key first while it
  runs (only when the view has the keys, never in a text field): P = pause / resume, Esc = end. Nothing else changes.
- **Visited** (`navigation/tourVisited.js`): localStorage `ahdus.tourVisited` = { [layoutName · building]: stop ids },
  at most 20 layouts, all in try / catch (blocked: this visit only). Restart clears this layout's.
- **UI** (`LayoutViewer` prop `tour`, default true; embed `navigation: { tour }`): the **Tour** button
  (`data-tour-button`, aria-label `Company tour`, aria-pressed; running: opens / closes the stop list) after Find in the
  toolbar; Find's menu starts with **"Take the company tour · 20 stops · about 8 min [· 3 visited]"** (`data-tour-offer`,
  `tourDetail`, from `tourPlanReady`: never planned in the menu; hidden while a tour runs). **TourPanel**
  (`[data-tour-panel]` = state, `data-tour-follow`, `data-tour-index`): top right, 360 px; a view under 640 px
  (`data-tour-narrow`): full width at the bottom, above the joystick (touch) or the HUD, max 48 % high; **walking
  between stops it is one line** (`data-tour-compact`: "Stop 2 of 20 · Lobby & Reception · Pause · ⌃", 48 px; the
  title `data-tour-expand` or the chevron `data-tour-expand-icon` opens it fully, `data-tour-collapse` "Show less"
  makes it one line again; each new walk starts as one line, a stop or the open stop list shows it fully). Title "Stop 4 of
  20 · Marketing" (`data-tour-title`), the state line (`data-tour-state`, touch words: "Tap Resume to go on"), the
  stop's text (`data-tour-text`), a mention (`data-tour-mention`), the next leg's directions (`data-tour-directions`),
  Walk me / I'll walk (`data-tour-mode` = auto | self), Pause / Resume (`data-tour-pause`), Previous, Next, Skip the
  walk (`data-tour-previous` / `-next` / `-skip`), Exit (`data-tour-exit`), the speaker (`data-tour-speak`,
  aria-pressed: **narration** with `speechSynthesis`, off by default), All stops (`data-tour-list-toggle`; the list
  `data-tour-list`, items `data-tour-stop-item` = id + `data-visited`, Restart `data-tour-restart`), done: Restart. A
  phone hides the walking person card under the panel while touring, and the one-time walk hint waits until the tour
  ends (it would sit under the panel). Help rows: P (keys), Tour (touch).
- **Embed:** `workplace.startTour({ follow })`, `stopTour()`, `onEvent('tour', { type, state, follow, index, count,
  visited, remaining, message, mention, stop: { id, n, kind, name, floor, floorName, text } })` (not the plan).

## Easy controls (v0.14.0, how they work)

Section 3.2 of `private-docs/EXPERIENCE_PLAN.md` (decisions in its section 6); touch: see "Touch controls". Viewer / embed
walkthrough only: **Studio's Preview keeps pointer lock exactly as before** (playController option `look`, default
`'lock'`; `WalkthroughSystem` passes `'drag'`).
- **Drag to look** (`src/play/dragLook.js`, PURE + tested): a press (left or right button, a mouse or pen; a finger:
  see "Touch controls") that moves more than `CLICK_PX` 6 px is a drag and turns the view (`DRAG_SENS` 0.0035 rad / px);
  the pointer is captured to the canvas (`setPointerCapture`), never locked: the cursor stays visible. A press of
  ≤ 6 px and ≤ `CLICK_MS` 250 ms is a **click**; two clicks within 400 ms / 10 px a **double-click**.
- **A click** (`playController.clickTarget(x, y)`: the ray from the camera, items / room parts / the ground only, not
  the player, ghosts or door panes; the floor under a desk = the desk) goes to `LayoutEngine._walkClick`, in this order:
  a person (`pickPerson`) = their card, pinned (it stays until another click or 4 m of walking); an item within
  `INTERACT_REACH` 3.5 m whose action is handled (`describeInteraction`) = 'interact', as E; else **walk there**:
  `navigation.routeTo({ x, z, floor }, { walk: 'auto', source: 'click' })` (a hit on a wall or item: the spot 0.4 m
  back towards you). No route = the problem as a short HUD message (`walk.say`). Event `walkClick` { action: person |
  interact | walk | none, at, person?, objectId?, to?, problem?, message? }.
- **A click's walk** (`source: 'click'`): no highlight, no strip (PlaceSearch ignores its events), a movement key or a
  double-click ends it ('stopped', no "Press G"), arrival ends it without turning. The line shows as for Take me there.
- **The keys** (`WalkthroughSystem.isEngaged`): the view's while it has pointer lock, the focus is in its box, or the
  mouse is over it (pointerenter / leave; touch ignored) unless Esc released it while there. Walking starts with the
  focus in the box (`takeFocus`: no ring, `data-auto-focus` while it focuses itself), unless a text field has it. A
  mouse click on one of the view's own buttons (button, link, option, role=button; never a text field) gives the focus
  back to the box 30 ms later (`onBoxClick`), unless a text field took it. `isTextField` (inputs that take text,
  textarea, select, contenteditable): playController ignores keys there. Arrows / Space are preventDefault'ed only
  while engaged. The focus ring shows only when the focus came by Tab (LayoutViewer `tabbedRef`: the last key before it was Tab, no press since; `:focus-visible` is not enough: after typing in Find, Chrome counts the view's own focus as keyboard focus).
- **Mouse look:** double-click or L = `lockPointer` (a crosshair, "Mouse look · Esc to release"); L again or Esc
  releases it; the next Esc (> 400 ms later, `ESC_AFTER_UNLOCK_MS`: the browser's own Esc never counts twice) gives
  the keys back (blur). An Esc that a route takes (stops it) does nothing else (defaultPrevented).
- **Hint + help** (`LayoutViewer`): the first walk in a browser shows `WALK_HINT` "W A S D to walk · drag to look ·
  click the floor to go there" for 6 s (localStorage `ahdus.walkHintSeen`, try / catch; touch screens: their own hint, see "Touch controls");
  the "?" button (`data-hud="help"`, aria-label `Keys and mouse`) opens `WALK_HELP` (15 rows, `data-walk-help`), Esc or a
  press outside closes it. While the hint shows, the HUD's own keys line under the room name is hidden (not the same words
  twice; a message still shows). The pill "Mouse look · Esc to release" (`data-hud="keys"`) shows only in mouse look;
  who has the keys is the view's description for screen readers (`data-hud="keys-state"`, hidden: "Click the view to
  walk" / "Esc to release" / "Mouse look · Esc to release").
- **One engine per canvas at a time:** `LayoutEngine.create(canvas, { signal })`: aborted before it is ready = disposed
  at once (an AbortError). `<LayoutViewer>` aborts on unmount: in dev (StrictMode) the first engine used to keep running
  on the canvas's WebGL context while the second started, and the second one's first sky face (+X) decoded black.
- Tests: `play/__tests__/dragLook.test.js`, `engine/__tests__/WalkthroughSystem.test.ts` (jsdom, the real controller on
  a NullEngine), `LayoutEngine.test.ts` (walkClick), `e2e/controls-smoke.mjs`.

## Touch controls (v0.14.1, how they work)

The Touch row of `private-docs/EXPERIENCE_PLAN.md` 3.2. Viewer / embed walkthrough only (look 'drag'); **Studio's
Preview ignores touch as before** (look 'lock' listens to mousedown only).
- **The joystick** (`engine/react/TouchControls.tsx`, `data-touch-joystick` = idle | held): a 128 px ring 16 px from
  the box's bottom left (`STICK_SIZE`, `STICK_MARGIN`), its pointer captured; `dragLook.stickVector` (PURE): up =
  forward, a dead zone of 15 % (`STICK_DEAD`), then push further = faster. → `walkthrough.setStick(x, y)` →
  `playController.setStick`: in `update` when no movement key is held (keys win), `(flying ? FLY : WALK) × length`,
  through the same `moveWithSteps`, and it counts as `userMoving` (pauses Take me there, ends a tapped walk). Works
  without the keys being engaged (a phone has none). Let go / pointercancel / page hidden / walking ends = 0, 0.
- **A finger on the canvas** (`playController.onPointerDown`, `touch`): drag to look (`TOUCH_DRAG_SENS` 0.005 rad / px:
  a phone is narrow); a **tap** (`TAP_PX` 10, `TAP_MS` 500: fingers wander) = a click (`clickTarget` →
  `_walkClick`: walk there / a person's card / a machine's action); two taps are never a double-click (no lock on
  touch). The joystick is a DOM element over the canvas, so a second finger on the canvas looks while it walks.
- **Touch words** (`LayoutViewer` `touchUI`): true when the last pointerdown was a finger, false on any mouse pointer
  event; before any, `(pointer: coarse)`. Then: the joystick shows; `WALK_HINT_TOUCH` "Joystick to walk · drag to look
  · tap the floor to go there" (its own localStorage key `ahdus.walkHintSeen.touch`, shown at 40 % height); the
  controller's readOnly hint (`walkthrough.setTouch`: "Joystick to walk, drag to look, …"; not drawn on touch since
  v0.14.2, see below); the screen readers' line; the "?" help = `WALK_HELP_TOUCH` (10 rows), its
  button / dialog named "Touch controls" (`data-walk-help` = touch | mouse); the E prompt reads "Tap it: …";
  PlaceSearch (`touch`) says "Paused · Tap Continue to walk on" / "the joystick pauses". **The HUD (v0.14.2)** is ONE
  short line (`data-hud-line="touch"`) to the right of the joystick, level with its bottom: a message, else "Tap it:
  …", else "Outside · Ground Floor" (room · floor), cut with … (a knob pushed forward rises 28 px above the ring, and
  the HUD above the ring hid it). The walking person card sits above the knob's reach (`personNearTouch`).
- Tests: `dragLook.test.js` (taps, stickVector), `WalkthroughSystem.test.ts` ("touch (v0.14.1)": drag, taps, the
  stick's speed, keys not needed, the route pauses, touch words), `e2e/touch-smoke.mjs` (hides viewer.html's
  bridge-events panel so the view is a phone's full width).

## Start mode: walk by default, the welcome card, Overview (v0.14.6, how it works)

Section 3.1 of `private-docs/EXPERIENCE_PLAN.md` (decisions in its section 6). Viewer / embed only: Studio and a viewer
without `startMode` are unchanged (no card, no button; `mode` as before).
- **`startMode: 'walkthrough' | 'view'`** (`<LayoutViewer startMode>`, the embed's `startMode` option, AHDUS sets it):
  the viewer decides the start. The engine is made in 'view'; once its first layout is loaded, `startMode.chooseStart({
  startMode, remembered, weak, openAt })` (PURE, tested) gives `{ mode, welcome, reason }`: the **last choice** first
  (localStorage `ahdus.viewMode`, try / catch: set ONLY by the viewer's own Overview / Walk button and "Walk anyway";
  v0.14.8: on a weak device too, reason 'remembered'); none: a **weak device** = 'view' (reason 'weak'; startMode 'view'
  anyway: reason 'start'), else startMode; **`openAt`** = no card (reason 'link'); a walk otherwise shows the card. `mode` is
  then only for changing it later (its first value is ignored; a change applies). The embed's `mode` follows the
  'mode' events (`onModeChange` → `onEvent('mode', { mode })`, `handle.mode`). **v0.14.8:** `onStart({ mode, reason, weak })`
  (LayoutViewer prop, once, before the first 'mode') → the embed's `onEvent('start', …)` + `handle.start`; viewer.html
  keeps it as `window.__viewerStart`.
- **Weak device** (`engine.weakDevice`): quality 'low', or `getGlInfo().renderer` names a software renderer
  (`softwareRenderer`: SwiftShader, llvmpipe, softpipe, Microsoft Basic Render, …). Override: `weakDevice` prop /
  option (viewer.html `&weak=1 | 0`). **e2e runs on SwiftShader, so it counts as weak**: scripts that want the walk start
  pass `weak=0` (or `weakDevice: false`).
- **The weak device's note** (v0.14.8, `WeakDeviceNote` in `react/WelcomeCard.tsx`, `[data-weak-note]` = software | low,
  `data-weak-note-place` = wide | narrow, `data-weak-note-compact`, role=status): only when the start's reason is 'weak',
  from above once the start floor is built; the words are `startMode.weakNote(kind)` (kind: quality 'low' = 'low', else
  'software'; viewer.html `&quality=low`). Buttons (`data-weak-note-action`): **Walk anyway** (walk = `rememberStartMode
  ('walkthrough')` + `resumeWalk()` (the entrance) + the welcome card; with `openAt` its route's line instead) and
  **Stay above** (closes it, nothing remembered). Esc, a press on the canvas, the Walk button or walking close it too.
- **The welcome card** (`react/WelcomeCard.tsx`, `[data-welcome]` = wide | narrow): "Welcome to <layoutName>"
  (`welcomeTitle`; none: "Welcome"), "You are at the main entrance. How would you like to start?", buttons
  (`data-welcome-action`, `welcomeActions`): tour (with the plan's size, `tourDetail`, once `whenNavigationReady`),
  explore, find (only with `tour` / `search`). It never takes the keys: a walking key (W A S D, arrows) closes it AND
  walks, Esc closes it (preventDefault: not the walkthrough's Esc), a press on the canvas closes it; leaving walking or a
  tour starting closes it. Explore = focus the view; Find someone = `PlaceSearch` `openRequest` (the box focused); Start
  the tour = the Tour button's start. Shown only once the start floor is built; the one-time walk hint waits for it.
  Desktop: centred, 520 px; under 640 px: full width at the bottom, above the joystick / HUD (the tour panel's spot).
  **Compact (v0.14.7):** a box under `SHORT_PX` 600 px high (its own height, never the window's: AHDUS's 3D Company page
  gives a phone ~490 px) gets `compact` (`data-welcome-compact`): a 15 px title, one short line, the three actions in one
  row with no detail lines (read out, and in `title`), so the toolbar row and Overview stay clear and clickable and
  nothing scrolls; a narrow card also keeps `WELCOME_TOOLBAR_ROOM` 96 px of the top clear (`maxHeight`). e2e:welcome
  checks 390 × 490 and 1000 × 400 boxes.
- **Overview / Walk** (`data-mode-button` = overview | walk, aria-label `Overview` / `Walk`, top right, 12 px):
  `engine.overview()` = the walker's pose kept (`walkPlace`: x, z, yaw, pitch, floor), 'view', `setFloor(that floor)`,
  the camera on that spot (`OVERVIEW_AROUND` 6 m, beta ≤ 0.75); `engine.resumeWalk()` = 'walkthrough' + `setPose(walkPlace)`
  (none: the entrance, as every walk). A new layout forgets the place. With it the toolbar row keeps 124 px of the right
  clear (`rowStyle`), and the bridge card and the tour panel (`TourPanel top`) sit 56 px down.
- **`openAt`** (prop / embed option, `embedLayout.cleanOpenAt`: one of personId / roomId / deskId, or a place id;
  viewer.html `&at=person:p_asha`): after `whenBuilt`, from above `navigation.show(openAt)` (show takes routeTo's targets
  now), walking `navigation.routeTo(openAt, { walk: 'guide' })` (the strip: "Going to …").

## Progressive loading (how it works)

Opening a layout never freezes the page: `engine/systems/SceneBuilder` builds the rooms and items in slices of
~10 ms (`BUILD_BUDGET_MS`), yielding between them (`scheduler.postTask` / MessageChannel). Used by Workplace Studio
(`hooks/useStoreMeshSync.js`, called by WorkplaceEditor: the one effect that syncs meshes calls `builder.start()` for a
new scene, else `request()`) and `LayoutEngine` (viewer, embed).
- **Order** (`buildSchedule.floorBuildOrder`): the floor you are on, then the floors below (nearest first), then above.
  Each floor's room materials first, one per piece (painting textures is slow; painted tiles are kept for the next scene).
- **The store is the only truth:** every slice reads the latest layout, so edits, undo and floor changes during a build
  are part of it; a deleted room / item goes at once; nothing is built twice (geometry keys).
- **After the first build** a change is built at once, as before; one that brings > 50 new rooms + items
  (`BIG_CHANGE`: a restored version, an import) is built in slices again.
- **While the start floor builds, no frames are drawn** (`layoutScene.holdRendering`, ends by itself after 30 s): a frame
  of a half-built floor shows nothing, and without a GPU one frame costs more than the building. The page (progress
  text, clicks) keeps working. Studio's performance monitor is paused until everything is built (a low FPS while
  building says nothing about rendering; it would lower the resolution).
- **Progress:** `{ done, total, floor, currentFloorReady, allBuilt }`. Studio: "Building your workplace… 40 %" in the
  middle until the floor you are on is built, then "Building the other floors… %" in a corner (`.build-progress`:
  top left in Studio, clear of the canvas controls; bottom right in Preview; not shown in Plan view).
  Viewer / embed: the same text, `progress` events, `onReady` / `ready` once everything is built.
- Measured by `e2e:perf` (72 rooms + 864 items, no GPU): the floor you are on shows after ~1.6 s instead of ~2.6 s, and
  the rest builds while you can already work. Numbers from SwiftShader; compare runs on the same machine only.

## People at their desks (v0.11.0, how it works)

Phase 1 step A of `private-docs/CHARACTERS_PLAN.md` (decisions in its §5). **Never put a character .glb from
Harsh or AHDUS into this repo** (public; Mixamo licence): tests and demos use our own placeholder figures
(`public/assets/characters/placeholder-mixamo.glb` / `placeholder-ue.glb`, `npm run characters:placeholder`).
- **Who sits where** is not in the layout (never saved here): `setPeople([{ personId, deskId, name, department,
  character: { url, rig: 'mixamo' | 'ue', height } | null }])` on `LayoutEngine`, `<LayoutViewer people>`,
  `<LayoutEditor people>` (Studio: only when given; dev hook `__ahdusCharacters`). The embed: `mount(el, {
  characters: { manifestUrl } })` + `handle.setPeople([{ personId, deskId, name, department, assetReference }])`,
  resolved through the manifest (`embed/characterManifest.js`; unknown / null = simple figure; other fields such as
  email are dropped). AHDUS will send seats from `workplace_seats` (TEAM_INTEGRATION.md, Harsh).
- **Where:** `people.deskSeats`: a `CHAIR*` within 1.2 m of a desk's edge (`DESK*`, `RECEPTION_DESK`), facing it
  (≤ 60°); each chair goes to the desk it fits best. No chair: standing where a chair would be, facing it
  (`people.DESK_WORK_SIDE`: the desk's local +Z, a reception desk's −Z behind the counter; turned with the desk).
- **Look:** everyone starts as the neutral simple figure (one mesh per pose, a thin instance each: 2 draw calls for
  any number). `chooseFullCharacters`: at most 12 on the current floor within 15 m of the camera (kept until 18 m)
  become full characters when their file has loaded (each url once per scene, ≤ 3 downloads at once,
  `modelLoader.loadGlbContainer`); each gets `instantiateModelsToScene` (own skeleton, shared geometry and
  materials; glTF extensions loaded: `EXT_texture_webp`, `KHR_materials_specular`, `KHR_materials_unlit`, imported
  next to the lazy loader in `utils/modelLoader.js`: a file that REQUIRES another one fails). Pose: bones found by
  name (`canonicalBoneName`), aimed in the parent's frame (`aimBone`, mirror-safe); hips onto the seat; the nearest
  3 breathe. A failed file = simple figure (a warning).
- A person shows while their desk's mesh is built and enabled (so per floor, like FloorSystem). Character meshes are
  not pickable; `pickPerson(x, y)` (desk / chair hit, else the nearest person within 0.6 m of the hit point) gives the
  hover card: LayoutViewer (view: next to the cursor; walkthrough: within 1.8 m, `personNearWalker`) and Studio
  (RoomHoverCard). Text only: name and department. In a viewer a click or tap (≤ 8 px, ≤ 600 ms) on a desk keeps
  the card (`data-pinned`, clickable) until the next click / tap elsewhere; a drag hides it (phones: tap = the card).
  `player: { personId }` (LayoutViewer prop; embed option + `setPlayer`) = the signed-in person: on their own card,
  with `characterChosen` false (assetReference null; `resolvePeople` sets it), "Choose your character" links to
  `chooseCharacterUrl` (embed: `characters.chooseUrl`; http(s) only, `safeLink`).
- **None with quality 'low'** (`engine.characters` is null) or Studio's Realistic look off (`setEnabled`).
- **Walking as yourself** (v0.12.0, viewer / embed walkthrough only; Studio's Preview keeps the simple figure):
  `LayoutEngine.setPlayer({ personId, character, walkClipUrl, walk })` (`<LayoutViewer player walkClipUrl>`; the embed:
  `player: { personId, assetReference }` + `characters.walkClipUrl`, resolved by `resolvePlayer` / `walkClipUrlOf`).
  Made when walking starts (`_syncPlayer`, keyed on url / rig / height / clip / walk; a token drops stale loads), the
  file through CharacterSystem's queue (`loadFile`, once per scene; while the ≤ 3 slots are busy it waits, first in
  the queue, never refused: v0.12.1). `PlayerCharacter.bakeWalk`: the clip (an
  animation-only GLB, Mixamo names) sampled at 30 / s in character space (`D = inv(srcRest) × src(t)`, `want =
  tgtRest × D`), so a skeleton whose bones point another way (UE) walks too; hips bob scaled, root motion removed.
  srcRest / tgtRest must be the files' REST poses: `modelLoader.GLB_LOAD_OPTIONS` (every .glb load) starts no
  animation of a file (the loader's default plays the first one in its container, and copies then start mid-walk),
  and `restContainer` resets a file that runs one anyway (v0.12.2).
  Speed: `people.clipSpeed` (root motion ≥ 0.2 m, else 2 × the foot's range / duration); (the built-in figure: `people.figureWalkCycle`, a step covers what the body moves, v0.14.5); `walkRatio` = your speed /
  that (0.25 to 6); below 0.3 m/s or flying = the standing pose. Eye height `playerEyeHeight` (0.93 × height).
  `playController.setCharacter(c, { eyeHeight })` (null = the simple figure). Your seated figure is hidden while
  walking (`CharacterSystem.setHiddenPerson`). No / unknown character, a failed file, quality 'low' = the simple
  figure; no clip, a failed clip or manifest `walk: false` = the standing pose (slides). Our test clip:
  `public/assets/characters/placeholder-walk.glb` (`scripts/make-placeholder-character.mjs`: 1.2 m/s).

## Live presence (v0.16.1, how it works)

Part A of Himan's v0.16.1 request (13 Nov 2026); Part B (AHDUS-FRONTEND: the WebSocket, Hide me) comes after the tag.
The viewer / embed only; **the engine never connects anywhere**: the page adds the others and sends on your pose.
Nothing is saved. Studio is unchanged.
- **API:** `engine.live` (`systems/LiveSystem.ts`): `add(raw)`, `update(id, patch)` (false: unknown), `remove`, `clear`,
  `list()` → `{ personId, name, floor, state, drawn: 'full' | 'figure' | null, at, atDesk }`, `count`. The embed's
  `workplace.live` (+ `characterManifest.resolveLive`: name, department, character (`fileOf` the FULL file) and
  clothing default to setPeople's entry; only those fields are kept, never an email); its `update` adds again someone
  dropped by silence. States `LIVE_STATES`: idle, walk, run, wave, overview. Bad data (no id, NaN / huge positions, a
  floor id that isn't one, unknown states, names > 120 characters) is cleaned or left out (`cleanLive`); names reach the
  page only as `textContent`. Someone with no desk just disappears when removed / silent.
- **Desks:** `CharacterSystem.setLivePeople(ids)` hides their seated figures (`isShown`), except the player's own
  (`getMe`). Removed, `clear()` or silent `SILENT_MS` 10 s = seated again.
- **Where they are drawn** (`play/live.js`, PURE): `createTrack`: the samples' path `LIVE_DELAY_MS` 250 ms behind,
  never ahead, a spring (`FOLLOW_RATE`), the yaw the short way round; > `SNAP_DISTANCE` 5 m or another floor = snap
  at that sample. `overview` = `standingSpot(seat)`: `STAND_BEHIND_SEAT` 0.55 m behind their chair, facing the desk
  (`seatPose` of their desk when CharacterSystem has not placed them). No position = not drawn (another floor).
- **Who is drawn** (every 300 ms): `chooseLiveDrawn`: the nearest `MAX_LIVE_DRAWN` 30 on the floor shown (to the walker,
  else the camera's target); full characters by `chooseFullCharacters` with the live share of the cap (files through
  `CharacterSystem.useFile` / `fileState`, clips by `ClipLibrary`, `PlayerCharacter.animatedCharacter(…, { name:
  'live_<id>', metadata: { livePersonId } })`, `update(dt, speed, false, { gait })`, `wave()` on 'wave'); the rest one
  thin-instance mesh `live_people` (material `live_figure`, a little green).
- **Name tags:** `LiveSystem.setTagLayer(el)` (LayoutViewer's `[data-live-tags]`, pointer-events none, aria-hidden):
  `div[data-live-tag=<id>]` = a green dot + the name, placed after each render; hidden further than `TAG_RANGE` 25 m,
  off screen, or behind a room mesh (a ray every 250 ms; doors and pick panes don't count); `clampTagX` keeps a tag
  `TAG_EDGE` 4 px inside the view.
- **The cap** (`systems/FullCap.ts` `FullCapMonitor`, `play/live.js` `nextFullCap`): `engine.fullCap.cap` starts at
  `FULL_CAP_MIN` 12; per `CAP_WINDOW_MS` 3 s window of frame times (p90, `windowFps`; only once allBuilt and the page is
  visible): ≥ `CAP_RAISE_FPS` 50 twice (`CAP_RAISE_AFTER`) while more are wanted = +4 (`FULL_CAP_STEP`) up to
  `FULL_CAP_MAX` 24, < `CAP_LOWER_FPS` 35 = −4, then held `CAP_HOLD_MS` 30 s. Weak device (`engine.weakDevice`) = 12;
  option `fullCharacters` = fixed (≤ 24; any state given is clamped to 12–24). Each frame CharacterSystem gets `setMaxFull(cap − live.fullCount)`. `history` (≤ 50).
- **Your pose** (`LayoutEngine.getPose()`, the `pose` event, the embed's `onEvent('pose')` + `workplace.pose`): view =
  `{ state: 'overview', floor }`; walking = `poseOf` (cm, 0.01 rad; y relative to the floor) with `liveStateOf(gait,
  speed, flying)`; `createPoseThrottle`: ≤ `POSE_RATE` 5 / s, only when moved 5 cm / turned 0.035 rad / state changed,
  a keepalive every `KEEPALIVE_MS` 4 s; only while someone listens and the current floor is built.
- Tests: `play/__tests__/live.test.js`, `engine/__tests__/LiveSystem.test.ts` (NullEngine + jsdom, the placeholder
  files), `LayoutEngine.test.ts` ("live presence"), `embed/__tests__/characterManifest.test.js` (resolveLive),
  `npm run e2e:live`.

## Characters, clips and clothing (v0.16.0, how they work)

`private-docs/CHARACTERS_V016_PLAN.md` (decisions in its section 1). Builds on "People at their desks" below.
- **Manifest v2** (`embed/characterManifest.js`, EMBED_GUIDE 4b): `{ version: 2, groups, clips, neutral, characters }`;
  a character: url, rig, height, gender, group, outfit ('rocketbox'), clips (a clip set's name), **seated** (a lighter
  copy: people at their desks use it, the person walking the full `url`; `fileOf(entry, { seated })`, also Studio's
  `seatFlow.seatedPeople`). v1 still read. `groups: { imported: false }` leaves a group out.
- **Even default:** no / unknown / switched-off character = `neutralFor(personId)` = `neutral[idHash(personId) % n]`
  (FNV-1a, never the name), in the viewer, the embed and Studio.
- **Clothing** (`play/outfit.js`, PURE): the Wardrobe's `{ schemaVersion: 1, pantsColor, upperBody, upperColor }` on a
  file with `outfit: 'rocketbox'`: Office formal (Outfit_formal + Skin_formal, or the own suit Outfit_original), shirt
  (Top_shirt …) or T-shirt (Top_tee …), trousers tinted; other parts hidden. Others wear their own outfit.
- **Clips** (`engine/systems/ClipLibrary.ts`): a clip set (animation-only .glb, Mixamo names) is baked ONCE per character
  file (`bakeClip`, matrices only, every bone the two share; the glTF `__root__` MESH and its mirror are part of the
  chain: leaving it out laid Rocketbox down; `alignLimbs` turns a limb whose rest points another way (a T-pose arm, A-pose
  clips) first, within 70°). People clone the baked tracks (`instantiateClip`), `Animator` cross-fades (`FADE_S` 0.25 s).
  Clip names: Idle, Walk, Run, Wave, Sit, Type (`CLIP_NAMES`).
- **People at desks:** `people.workClip`: seated at a desk with a keyboard, laptop or dual monitor = Type, other desks Sit,
  standing = Idle. The nearest `MAX_ANIMATED` 8 full characters play it, the rest `holdClip` frame 0; hips on the seat
  in the clip's pose. Full characters (≤ 12) are the nearest to the point the camera LOOKS at (`chooseFullCharacters`
  `focus` = camera.getTarget(), while the camera is within `VIEW_REACH` 30 m of it; else the camera; those full already
  `KEEP_BONUS` 2 m nearer). Simple figures are grey (`FIGURE_GREY`). A file nobody near used for 30 s is unloaded
  (`unloadAfterMs`).
- **You** (`PlayerCharacter.ts`, viewer / embed walkthrough): with a clip set Idle / Walk / Run (`people.chooseGait`,
  `RUN_FROM` 3.3 m/s) / Wave (**H**, standing still; else "Stand still to wave"), the forward leg lifted on stairs
  (`stairLift`, `liftLegs`). No clip set: the v0.12 walk clip. Studio's Walk through is the simple figure (H does
  nothing); Studio's editor H = Reset view (e2e:planner checks both).
- **Files** (AHDUS-FRONTEND `scripts/make-office-characters.mjs`, never in this repo): the 20 Rocketbox + 5 Avatar SDK
  light copies (~2 MB, one skin, WebP ≤ 1024 / 512 px, meshopt) and `-seated` copies (512 / 256 px, ~¼ of the GPU
  memory), clip sets `clips-female.glb` / `clips-male.glb` (Idle, Walk, Wave so far). Meridian (319 people, RTX 4060,
  12 Nov 2026): first frame 1.9 s, nearby characters 0.6 s / all 1.5 s, 129 FPS from above, ~113 walking, GPU 0.7 GB
  walking (1.6 GB before the seated copies). Script + report: private-docs/screenshots/v0.16.0/meridian-after/.
- Tests: `engine/__tests__/ClipLibrary.test.ts`, `clipMirror.test.ts`, `workClips.test.ts`, `play/__tests__/outfit.test.js`,
  `people.test.js`, `embed/__tests__/characterManifest.test.js`, `npm run e2e:characters` (39).

## Realistic look (how it works)

On by default; Settings → "Realistic look" (Studio, per browser: localStorage `ahdus.realisticLook`), `quality: 'low'`
(LayoutEngine / `<LayoutViewer />` / the embed) turns it off. Per scene (`utils/realLook.js`: `configureLook` in
`SceneSetup`, `setRealistic`, `onLookChange`). Files: `public/assets/` (or `assetBaseUrl`; the embed: `assets/` next to
its script, copied there by `build:embed`). Saves, sizes and behaviour never change: only the look.
- **Furniture:** `modelRegistry.MODEL_REGISTRY` maps a catalogue type to Kenney GLB part(s) (`turn`, `region`,
  `fit: 'stretch' | 'contain'`). `modelLoader.buildModelParts` loads each GLB once per scene, fits it into the box of
  the type's PRIMITIVE template (`modelFit.fitTransform`) so footprints / stacking / picks stay as they were, and
  maps Kenney's material names to our shared `getAssetMaterial`s. `assetInstances` merges that into a second template
  per type and switches the type's items to it (and back when the look is off); lock / outline looks carry over.
  Failure or loading = the primitive template. A type not in the registry keeps its primitive model.
  Adding a model: put it in the registry, run `npm run assets:prepare` (copies only registry models), then `node scripts/make-thumbs.mjs`, add its row to
  `docs/ASSET_LICENSES.md`. New catalogue items need a primitive model too (the fallback).
- **Rooms:** every procedural room material (`floor:<kind>`, `plaster` = walls, `structure` = slab / roof / parapet /
  band, `ceiling`) has a PBR twin (`REALISTIC_SURFACES` → `TEXTURE_SETS`, tile size in metres). When its 3 textures
  have loaded, built rooms swap materials in place (also inside shared MultiMaterials); new rooms get it directly.
  Room UVs are in metres (`worldUVs`, `boxWorldUVs` in roomBuilder): keep them on new room parts.
- **Sky:** `env/sky.env` (prefiltered HDRI) is `scene.environmentTexture` (lights the PBR rooms) and a skybox on the
  Day preset (`siteEnvironment`); grass, paving and fog are unchanged.

## The AHDUS look (v0.10.0; every mode since v0.10.1, how it works)

Workplace Studio has one look, the AHDUS look: light page (#f6f7f3), white panels, AHDUS green (#28664f), a dark green
tool rail, Inter. Since v0.10.1 also in local mode (the dark "classic" look of v0.9, its trays, bottom bar and header,
were removed). The companies screen, Preview's HUD, dialogs and the splash use the same tokens.
**Only these stay AHDUS-only (`VITE_LAYOUT_BACKEND=ahdus`, `inAhdus` in WorkplaceEditor):** the "AHDUS" brand text
(local mode: "All layouts"), Publish (+ its dialog, toasts and the "· Published" part of the status pill), renaming the
site on the server (local mode renames the layout), the leave check. Saving, undo and the scene are the same in both.
- **Styles:** tokens in `theme.css` (`:root`, one palette; contrast pinned by `themeContrast.test.js`), the look in
  `ui/ahdus.css` on top of `studio.css`. Rules that override a `studio.css` rule start with `:root` (the specificity of
  the old `[data-look]` prefix), so the order the bundle puts the two files in never matters.
- **Top bar:** "All layouts" (AHDUS: AHDUS) / Workplace Studio / the name (rename), the status pill (`StatusPill`: "Saved",
  AHDUS: "Saved · Unpublished changes"), Undo, Redo, Versions, Settings, Walk through (= Preview), Publish (AHDUS).
- **Tool rail** (`BuildPanel`): the six tools with labels, Layers and Shortcuts (`ShortcutsPopover`, from
  `tools.SHORTCUT_GROUPS`) at the bottom.
- **Library** (`ui/LibraryPanel.jsx`, pure parts in `ui/library.js` + tests), one page per tool (Rooms: tiles,
  "Draw your own size" (draws the last picked room type, an Office at first), templates; Walls, Doors & windows: tool
  tiles; Stairs; Furniture): picture tiles (rooms: `RoomPicture`; furniture: `public/assets/thumbs/*.webp`, drawn by
  `scripts/make-thumbs.mjs`; `modelRegistry.thumbnailFor`, `PRIMITIVE_THUMBS` for types with no model), search, category chips, templates. `hooks/useLibraryDrop.js`: drag a tile onto the
  floor (a dashed footprint with name and size, red with "Overlaps …"; Shift = square room), click = placed in the
  middle of the view, Esc cancels, touch = tap the tile then the floor. Rooms via `geometry.planRoomAt` +
  `editor.addRoom`, items via the placement manager: one undo step each.
- **Camera controls** (`ui/CameraControls.jsx`, maths in `utils/cameraControls.js` + tests) top left of the canvas:
  view cube (Top / Front / Side), Reset view, Fit building, Zoom in / out, Orbit / Pan (Pan = left-drag pans;
  `setPanMode` survives the planner re-attaching the camera). Keys (`tools.CAMERA_KEYS`, through `cameraKeyRef` in
  `useStudioKeyboard`): 7 / 8 / 9, H, F, + / −, O, P; not in Plan view. Top right: Export, Measure, 2D | 3D | Plan,
  Full screen. Bottom left: floor switcher + "Add floor" (`StudioFooter`); bottom centre: the hint.
- **Selection:** a dark green bar with Move, Rotate, Duplicate, Delete (`SelectionToolbar`; rooms too:
  Rotate = `geometry.planRoomTurn` (a quarter turn about its centre, doors and windows go round with it; refused with
  rooms inside, a shared door / window or an overlap), Duplicate = `geometry.planRoomCopy` (first free spot beside it;
  type, colour, heights, thickness, floor; no doors / windows)). The selected room keeps its small name pill
  (`RoomLabels selectedAsPill`). Inspector (`RoomBody`): room type, Width / Length / Ceiling, floor swatches
  (Wood / Carpet / Tiles / Concrete = room field `floorFinish`, `materialLibrary.floorKindOf`; 'default' = the type's
  floor; in `roomBuildInput`, so only that room rebuilds), wall thickness, the doors and windows (a click selects one),
  "Add a door or window", Duplicate, Delete room. Walls finishes: not yet.
- **Phone** (≤ 600 px, `look.usePhone` / `PHONE_QUERY`): top bar = back, name (cut with …), Undo, ⋯ (`More`: Redo,
  Versions, Settings, Walk through), Publish; `ui/PhoneBar.jsx` under it (status + 2D | 3D | Plan); the rail is a
  bottom bar, the library a pull-up sheet (tap a tile, then the floor: "Tap the floor where the room goes"), the
  Inspector a bottom sheet, Reset / Fit on the right. Nothing may go off-screen at 390 px. The idle hint "Drag to turn ·
  pinch to zoom · tap a room to select it" (`tools.phoneIdleHint`) hides while a bottom sheet is open and for good
  after the first touch on the canvas (`canvasTouched`, per editor).
- **Leaving:** `publishFlow.leaveCheck` = 'leave' | 'ask' | 'check'. Back to AHDUS before the publish state is known
  ('check', e.g. while Studio is still loading) asks AHDUS first (up to `LEAVE_CHECK_MS` 3 s), then decides; still
  unknown = the Stay / Publish now / Leave dialog.

## Testing gotchas

- Studio controls have fixed `aria-label`s and e2e scripts select by them; keep these exact labels: `Undo`, `Redo`,
  `Settings`, `Select`, `Rooms`, `Walls`, `Doors & Windows`, `Stairs`, `Furniture`, `Layers`, `Floor switcher`,
  `Add floor above`, `Walk through`, `Back to Studio`, `Add your first room`, `2D view`, `3D view`, `Plan view`,
  `Fit view`, `Close inspector`, `Measurements` (and its panel `Measurement tools`: `Measure Distance`,
  `Show Wall Lengths`, `Show Room Areas`, `Clear Measurements`), `Room labels`. Studio at 1280×720 and 1920×1080: no page / tool rail scroll, canvas ≥ 75 % wide. While Preview has the mouse captured, clicks go to the canvas: release it first.
  Also (keep them too): `All layouts` (AHDUS: `Back to AHDUS`), `Versions`, `Shortcuts`, `Search rooms`, `Search furniture`,
  the libraries (`Rooms library`, …; `data-library`), `Add floor`, `Full screen` / `Exit full screen`, `Reset view`, `Zoom in`, `Zoom out`, `Orbit`, `Pan`, `Top view`,
  `Front view`, `Side view`, `Room type`, `Room department`; on a phone `More` (menu `More actions`) and `Close the library`.
  AHDUS seats: the section `Who sits here`, `Search people`, `People found`, the banner `People without a desk`.
  `Export floor plan` and `Measurements` keep their labels (the visible text is "Export" / "Measure").
  e2e scripts pick a tool with `pick(tile, option)`: it opens the tile's library unless it is open (a click on an open
  tile closes it), then clicks the option; Rooms = "Draw your own size". Furniture: drag the tile onto the floor.
- viewer.html's dev hooks: `__ahdusViewer` (the LayoutEngine; `.walkthrough.setPose`), `__ahdusScene`, `ahdus`,
  `__viewerEvents` (bridge events), `__ahdusCards`, `__ahdusWalkDebug` (only with `&debug=walkmap`), `__ahdusTourDebug` (only with `&debug=tour`; the tour itself: `__ahdusViewer.tour`), `__ahdusSetPeople`
  (the people prop; `?people=1` = two sample people, `?search=0` = no search box), `__viewerNav` (every 'navigation'
  event); `?start=walk | view` = startMode (v0.14.6; `&weak=1 | 0`, `&at=<place id>`: see "Start mode"). On a touch screen (v0.14.1, the last press a finger) the "?" button and its dialog are named `Touch controls`
  (`Keys and mouse` with a mouse); `walkthrough.getStick()` = the joystick now. viewer.html gives the view only 60 % of
  a phone (its bridge-events `aside`): e2e:touch hides it. Take me there's time is GAME time (`navigation.walking.elapsed`): SwiftShader frames are capped at 0.25 s. The search's Find button sits at the
  viewer's top left (12, 12): raw clicks / taps meant for the canvas must avoid it. Since v0.14.0 a viewer's walk
  needs no click (the keys are its own at once) and never locks the mouse except on a double-click or L; a plain click
  on its canvas WALKS THERE (or pins a person's card, or runs a machine's action), a drag turns the view, so tests that
  only want the keys must not click the canvas (aim at the sky, or move the mouse over it). The focus may be on the
  canvas, inside the box. Two Esc presses for mouse look need > 400 ms between them. Babylon prevents the default of
  pointerdown (no mousedown arrives): use pointer events.
- embed-test.html's hooks (also in production: it's a plain page): `window.workplace` (the handle; `._engine` = its
  LayoutEngine, for tests only), `window.embedEvents` (every onEvent call). A viewer's walkthrough doesn't capture the
  mouse (see above; Preview still does, and headless Chromium grants it without a click).
- People: `__ahdusCharacters` (Studio, dev: the CharacterSystem: `setPeople`, `getPlaced()`, `whenSettled()`,
  `fullCount`); viewer / embed: `engine.characters`. Simple figures are the meshes `people_seated` / `people_standing`
  (`thinInstanceCount`), full characters `person_<id>` nodes (meshes with `metadata.personId`).
- Dev-only hooks for tests/console: `window.__ahdusPlay`, `__ahdusScene`, `__ahdusStore`, `window.ahdus` (bridge),
  `__ahdusCards`, `__ahdusEventLog` (demo modules), `__ahdusCrashOnOpen = true` (the editor throws: error card test),
  `__ahdusRoomSync` ({ rebuilt, ms } of the last room sync that built something: perf test),
  `__ahdusAssets` ({ whenLoaded(), setRealistic(on) }: wait for the realistic look's files; switch it).
- **Loading screen:** right after opening a layout the full-screen `[data-splash]` covers Studio until the first
  full frame; raw `page.mouse` clicks must wait until it is gone (Playwright's `page.click` waits by itself).
- **Progressive loading:** after opening a layout (or a change with > 50 new rooms + items), meshes appear over
  several slices: `await __ahdusBuild.whenBuilt()` (Studio, dev) or `engine.whenBuilt()` before checking meshes.
- Real assets load AFTER the scene is drawn: wait for `__ahdusAssets.whenLoaded()` before checking models or
  textures. An item drawn by its real model has `metadata.model` on its child mesh; a room surface's realistic
  material is named `real_<key>` (procedural: `mat_<key>`).
- If the dev server serves an old copy of a file after edits (its watcher missed a change), restart it.
- Opening a layout builds its scene inside the click (twice in dev, StrictMode): without a GPU that blocks the tab
  ~10 s, ~25 s with a second tab rendering. Clicks that open a layout need a long timeout (save-smoke uses 90 s).
- The dev build runs in React StrictMode: effects mount → unmount → mount. Scene teardown must leave no stale
  references (the mesh maps are cleared there; reopening a layout with rooms crashed before that).
- Without a GPU, Playwright runs on SwiftShader at ~1 fps; e2e scripts allow long timeouts. A long run can use ~2 GB.
- **Preview aims (v0.15.1):** the third-person camera is 0.85 m over the right shoulder only while nothing is close
  behind you; with a wall there it moves behind the head first (`thirdPersonCamera`), so the crosshair moves 0.85 m.
  e2e aims indoors try both places (tools, modules) or measure where the crosshair lands (play-smoke). The slide takes
  0.25 s: on a fast machine wait for it after `setPose` before a click (play-smoke's `settle`).
- **Walk through's mouse (v0.15.2):** it is not captured by itself and there is no "Start preview" button. e2e checks
  that aim with the crosshair press **M** first (mouse look) and wait for `document.pointerLockElement`; the catalog
  (B) gives the mouse back, so press M again after it. Checks of the easy controls put the mouse where a world point
  is on the page (play-smoke's `screenOf`) and use real `page.mouse` moves and clicks. A plain click with an empty
  hand WALKS there. Item fixtures for a real-controller unit test need every store field (scaleX / Y / Z,
  rotationX / Z): a missing scale makes the mesh's matrix NaN and nothing is picked.
- **Don't edit app files while an e2e test runs**: Vite HMR reloads the page and the test fails.
- When killing dev servers, don't use a `pkill -f` pattern that also matches your own shell command.

## Data and backend

- Now: browser localStorage (`apiService.js`, `dwtwin_companies`). Clearing the browser deletes layouts.
  localStorage is **per port**: the dev server uses `strictPort` (3000 only), or layouts seem to vanish.
- Saving: auto-save 1 s after any change to rooms/objects/floors/anchorData, and at once on "All layouts",
  Studio ↔ Preview, tab close/hide. Header: Saving… / Saved / Not saved: reason (`store.saveError`).
- **Two tabs:** every save has a `revision`; a tab never overwrites a newer one (`store.saveConflict` →
  `ui/TabNotice.jsx`: "This layout was changed in another tab", Reload / Save mine as a copy; the `storage` event
  shows it at once). Tabs with the same layout open say hello on a BroadcastChannel ("Also open in another tab").
- **Backup:** Export layout (`<name>.ahdus.json`, `{ format: 'ahdus-layout', formatVersion: 1, layout }`) and Import
  layout (through `normaliseLayout`, keeps ids) on the layouts screen and in Studio's Settings. `storageUse()` warns at
  80 % of ~5 MB (`store.storageNearlyFull`); it counts everything the app keeps, version history included.
- **Version history** (Roshan, R4; header button "Version history", `ui/VersionHistory.jsx`; `createVersion`,
  `listVersions`, `restoreVersion` in `apiService.js`): kept next to the layout in localStorage
  (`dwtwin_<company>_<layout>_versions`, newest first). Named versions ("Save" in the popover) and auto checkpoints
  (at most one per 10 minutes of editing, `AUTO_VERSION_EVERY`). At most 20 auto + 30 named per layout
  (`MAX_AUTO_VERSIONS`, `MAX_NAMED_VERSIONS`), oldest dropped first. Storage full: old auto checkpoints (any
  layout's) are dropped so the layout still saves; a version that fails never fails the save. Restore =
  `editor.restoreVersion(snapshot)`, one undo step; the layout name is left alone.
- Loading goes through `normaliseLayout` (`src/store/layoutData.js`): old saves get floors, elevations,
  anchorData, opening sizes. The layout list is built from the saved data (name, rooms, floors, last edit).
- The editor is wrapped in `EditorErrorBoundary`: a failure shows "This layout could not be opened" + Back to layouts
  + Try again (a new editor on the same layout).
- **Loading screen** (all modes, `ui/StudioSplash.jsx`, rendered by `App.jsx` over the editor): the Studio's name
  ("AHDUS" above it in AHDUS mode), a spinner, "Opening Workplace Studio…". It stays until the layout is loaded AND
  the editor calls `onFirstFrame`: the first frame after the current floor is built (`progress.currentFloorReady`)
  whose shown meshes are ready (`ui/firstFrame.js`: shaders compiled; at most `MAX_WAIT_MS` 4 s more; downloads of
  the realistic look don't count). Then a 300 ms fade (`FADE_MS`; none with prefers-reduced-motion). An editor crash
  hides it (the error card shows). AHDUS: a failed load, or none after 45 s (`LOAD_TIMEOUT_MS`), is the error card
  with Try again (loads again) + Back to AHDUS.
- Decided: **Supabase** (PostgreSQL; must be self-hostable on the client company's server). Start from `db/schema.sql`.
- **The browser-side Supabase path in `apiService.js` (Roshan, R2: CAS on `revision`, realtime) is a PROTOTYPE.**
  It is OFF unless `VITE_LAYOUT_BACKEND=supabase` is set as well as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  (`.env.example`); without the flag apiService makes zero network calls (`apiService.noBackend.test.js`).
  The switch is ONE helper, `services/backendFlags.js` (`isSupabaseBackendOn`); every browser → Supabase path uses it.
- **Photo reconstruction (Roshan, R8; `reconstructionService.js`, `ui/ProposedLayoutBanner.jsx`) uses the same switch.**
  Off: upload, analysis, staging and review return `{ ok: false, off: true, error: 'Photo reconstruction is off' }`
  with no Supabase call and no fetch (`reconstructionService.noBackend.test.js`); the banner renders nothing and
  Settings hides "Reconstruct from photo". On: photos stay private (no `getPublicUrl`, ever): the upload returns the
  storage path, the analysis endpoint gets a `createSignedUrl` that expires in 10 minutes (`SIGNED_URL_SECONDS`),
  and `proposed_layouts.photo_url` stores the path.
  Production saving goes through the platform API, which takes the tenant from the server session, never a
  `company_id` sent by the browser (private-docs/AHDUS_3D_INTEGRATION_PLAN.md).
- **AHDUS backend (W1 of private-docs/WORKPLACE_INTEGRATION_PLAN.md): `VITE_LAYOUT_BACKEND=ahdus`**, for the AHDUS
  build only (`isAhdusBackendOn` in `backendFlags.js`; the default build and its localStorage saves are unchanged,
  zero network calls). Requests in `services/ahdusBackend.js` (its header lists the API), called only by apiService:
  same origin, `/api/workplace/sites/{site}/…`, token = localStorage `authToken` as `Authorization: Bearer <token>`.
  - **AHDUS mode** (`App.jsx`): the site in the address (`?site=<id>`) opens straight in Studio (no companies screen;
    no site or a refused load: "This workplace could not be opened" + Back to AHDUS). Store: companyId `ahdus`,
    layoutId = the site id. "All layouts" is "Back to AHDUS" (`/3d-model.html`). Only editors get here (the draft
    needs edit rights), so the rest is for editors. All of it: `hooks/useAhdusPublish.js` + `ui/publishFlow.js`.
  - **Rename:** the site name in the breadcrumb is a button (aria-label `Rename workplace: <name>`): Enter or a click
    away saves, Escape cancels. `ahdusBackend.renameSite` = `PATCH …/sites/{site}` `{ name }`: trimmed, 1 to 200
    characters (`MAX_SITE_NAME` = the server's `MAX_NAME`); the name shows at once and goes back if AHDUS refuses.
  - **Publish:** the button opens a dialog (`ui/PublishDialogs.jsx`): "Publish <site>?", "Everyone in your company will
    see this version.", "Last published: <date>" (newest `published` version) or "Not published yet"; Publish saves,
    then `POST …/publish` with `expectedRevision`, then a green toast (`ui/Toast.jsx`, ~6 s, aria-live) with "View on
    the 3D Company page" (`/3d-model.html?site=<id>`). Button state from the store's `draftRevision` (as saved) and
    `publishedRevision` (`GET /api/workplace/sites`, on open and after each publish; null = never, undefined = not
    known yet): "Published ✓" (disabled) / "Publish changes" + dot / "Publish"; after "Saved": "· Published",
    "· Unpublished changes", "· Not published yet". `ui/Dialog.jsx`: focus trapped, Escape = Cancel, no key reaches
    Studio's shortcuts while open.
  - **Leaving with unpublished changes** (`shouldWarnOnLeave`: a save waiting, a newer draft, or a never-published
    site with a saved draft): Back to AHDUS asks Stay / Publish now / Leave; closing or reloading the tab gets the
    browser's `beforeunload` prompt. Save and publish failures (409, 401 + a Log in link, 403, no connection) also
    show a red toast.
  - **Not logged in** (no `authToken`, or the first load answers 401): the browser goes to
    `/login.html?redirect=<this /workplace-studio/ address, encoded>` (`ahdusBackend.goToLogin`; "Taking you to the
    AHDUS login…" meanwhile), so AHDUS-FRONTEND's `studio-login.js` patch is no longer needed. No site: the error card.
    Tests: `src/__tests__/App.ahdusLogin.test.jsx` (jsdom, editor mocked) + `loginUrl` with a mocked location.
  - **Who sits here** (v0.11.2; `hooks/useAhdusSeats.js`, rules `ui/seatFlow.js`): seats live on the AHDUS server
    (`workplace_seats`), never in the layout: saved at once, not in undo, no publish, no layout save. `GET /me`:
    `canAppoint` (Admin / HR) = 'manage', else `canEdit` = 'view' (names only). A desk (DESK*, RECEPTION_DESK)
    in the Inspector: `SeatSection` (person + Change / Remove, or "Assign someone": search `GET /people?q=`,
    debounced 250 ms; e-mail only in its results). Moving someone from a desk of this layout asks "X already sits at
    <desk>. Move them here?", a taken desk "This replaces Y." (`assignPlan`; desk names: own label, else
    "Standard Desk 3", `deskLabel`). `SeatsBanner` (manage only): "People without a desk (N)" = seats whose desk is
    not in the draft, with Assign a desk (the next desk selected; the hint says so; Esc cancels) / Remove. The
    Publish dialog: "N people lose their desk: …" (desk gone from the draft, `hasDesk` on the server). Studio draws
    the seated people with AHDUS's manifest (`AHDUS_CHARACTERS` = `/frontend/workplace/characters.json`).
  - Load = `GET …/layout?state=draft` (`{ layout (v2 | null), revision, name? }`); save = `PUT …/layout`
    `{ layout (v2), expectedRevision }` (v2 via the engine's model; routes / links / underlays of the loaded layout kept
    by `mergeV2Extras`). Saves run one at a time; nothing about the layout goes to localStorage (no offline queue: a
    failed save says why, the next change retries). **409** → TabNotice "This workplace was changed by someone else",
    Reload only (no copies); **401** → "Not saved: Your AHDUS login has expired. Log in again." (opening: the login
    page, see above); **403** → "Not saved: you are not allowed to edit this workplace".
  - Versions on the server (`GET` / `POST …/versions`, `POST …/versions/{v}/restore`); restore saves pending changes,
    then `editor.restoreVersion` (one undo step). The restored layout is the server's draft already, so it is marked
    saved and its auto-save dropped (the revision goes up by 1, not 2); undo / redo save like any change. Export layout stays; Import layout puts the file into this workplace
    (`editor.restoreVersion`, one undo step) instead of adding a layout. Tests: `ahdusBackend.test.js` (mocked fetch).
  - **Dev:** with `VITE_LAYOUT_BACKEND=ahdus` (in `.env`), `npm run dev` proxies `/api` to `VITE_AHDUS_API` (default
    `http://127.0.0.1:8000`, the AHDUS FastAPI); open `localhost:3000/?site=<id>` and copy the AHDUS `authToken` into
    localStorage there (`.env.example` says how). Without the flag there is no proxy.
  - **Build (W2):** `npm run build:ahdus` → `dist-ahdus/` (see Commands), which AHDUS-FRONTEND copies in after a
    `git subtree pull` of a tag (plan section 3). It sets `VITE_LAYOUT_BACKEND=ahdus` itself and blanks the Supabase URL /
    key and `VITE_AHDUS_API` (Vite inlines every `VITE_*` value into the built files AHDUS commits). The server checks
    each saved layout against `layout.schema.json` (`npm run schema:json`: unknown fields are accepted, as in Zod).

## Team (other interns' modules plug in through layoutBridge)

Harsh: characters & voice · Karthik: machine videos & files · Yashashwi: handover of previous employees' work ·
Dhruv: frontend app shell (`<LayoutEditor />` / `<LayoutViewer />` from `src/engine/react`) · Sunil & Kavyashree: logins,
activity monitoring, sync. Demo modules: `?demoModules=1` (`src/integration/demoModules.js`).

## Known limitations

- One straight flight per staircase, always 4.0 m long: on tall floors the steps get short and the flight steep; over
  6.3 m (walls go up to 15 m) it is very steep and the hints say so. A proper fix (landings / U-shaped flights) is not done.
  A staircase turned 45° cuts a square opening. Stairs can't be resized anywhere (v0.14.5; an old save's scale stays until "Normal size").
- Room labels: a name hidden because it would overlap a bigger room's shows on hover only. The hover card ignores items
  (pointing at a desk shows the room under it).
- Old saves that stored elevations (no floor heights) still read a gap over 6.3 m as a missing floor, not one tall floor.
- A partly covered roof is still drawn; the wall band of a lowered room shows only when ≥ 90 % of it is covered.
- Lowering a room's walls never lowers its floor (use "Floor height" in the floor menu for that).
- The outline of the floor below is hidden where it lies exactly under walls of the floor being edited.
- Faster building (v0.15.5): groups hold items, not rooms; the clipboard is Studio's own (lost on reload, not
  shared with other tabs); a pasted item may overlap what is already there (Check finds it); All floors is for
  looking only; the floor-below outline hides under walls in the same place (a copied floor).
- Layers, wall items, snapping (v0.15.6): hidden rooms / items are per browser (not shared with other editors);
  wall items hang on any straight wall (a Wall-tool wall at an angle too), but snapping guides use walls along
  X / Z only; a group snaps to the grid only
  (no guides); an item snaps to items on its own floor only. Wall items don't check what hangs next to them
  (two TVs can overlap on one wall; Check doesn't say). The AC unit, clock and shelf are simple shapes (no model).
- Rooms are rectangles (no L-shapes or free-form walls). Neighbours share one wall only when back to back
  (at most the thicker wall apart); further apart they keep two walls.
- Wall thickness is per room, not per wall (a room's outside and inside walls are equally thick). Thickening a
  wall checks only that room's items, not the neighbour's on the other side of a shared wall. The build previews
  and the wall highlight use the room's own thickness, not the shared wall's. Free-standing walls (Walls tool) are
  still 0.15 m.
- Nested rooms: the outer room's slab and roof are not cut; resizing the outer room doesn't take the rooms
  inside along (it is blocked if they would stick out of it); rooms can be
  moved by their floor only in Studio. A nested room's own walls are drawn 1 cm thinner on the outside than the data says.
- Rooms saved before 22 Oct with a gap (0.15 m or more from the outer wall, or apart from a sibling) keep their own
  walls; stretching or moving the edge to within 0.35 m snaps it. With the 0.5 m grid on, drawing to a grid line
  0.5 m from a wall doesn't snap (draw to the wall itself). Nested rooms don't snap to the floor below.
- Two levels deep (a room inside a room inside a room, all on one wall line): from outside, the wall picks the
  middle room, not the outermost.
- An Inspector size whose edge snaps moves the room's centre a little; doors on the other two walls move with it.
- Realistic look: 26 item types have a Kenney model (low-poly, stretched into the primitive model's box, so some
  proportions differ a little; the open bookcase has no back). Stairs, machines, lockers, racks, signs and markers
  keep their primitive models. The placement ghost shows the primitive model. A faint vertical line can show on
  textured walls where wall pieces meet beside a door or window. Item icons are generic lucide icons, not thumbnails.
- Stretching a wall with a door shared with a neighbour moves only this room's half.
- The "2D" view is the 3D camera from above; the "Plan" view is the real floor plan (scroll zooms, dragging the background pans;
  room names can sit under items; rotation in 90° steps only).
- Room labels and the selection toolbar are HTML over the canvas (always on top, even behind a wall).
- The layout name is saved at once but is not part of undo.
- Doors and windows slide along their own wall (v0.15.0) but can't move to another wall (remove and add again);
  window sills are fixed (0.9 m).
- Walk through (v0.15.2): no joystick or phone layout in Studio's Walk through (a finger drag looks, a tap is a click);
  a click's walk has no "Paused" strip (a movement key ends it); the
  Inspector's X / Z do not follow a drag in Plan view (3D / 2D drags and the move arrows do); a move arrow shows the
  chair live, but what the carried chair overlaps is not checked. Turning a room: quarter turns only; a staircase in it
  turns too (check where it arrives); a door shared with a neighbour must be removed first.
- Easy building (v0.15.0): A door cut into a free-standing wall is an item with wall pieces around it: removing
  the door leaves the gap (Ctrl+Z puts the whole wall back), and it can't slide or be resized like a room door. From
  above, the move arrows can be grabbed only where they stick out past the item. Dragging an item that isn't selected
  opens the Inspector, so the view narrows under the mouse while you drag (the item stays under the cursor).
- Door/window limits: min width 0.6 m (door) / 0.4 m (window), min height 1.8 m / 0.4 m, 0.1 m from corners and
  below the top of the wall, 0.2 m from other openings, and a door keeps 0.5 m clear of stairs on both sides.
- Preview: + / − is the = / − key (or numpad); on a US keyboard "+" needs Shift, which changes the height.
- "Also open in another tab" can stay shown a while if the other tab crashed instead of closing.
- The storage warning is an estimate (~5 MB per site); browsers differ.
- Skirting isn't pickable on its own (a click goes to the wall behind it).
- People (v0.16.0): the clip sets have Idle, Walk and Wave only: Run, Sit and Type clips (Microsoft's Rocketbox
  repository, MIT) are still to add, so on the real files people at desks hold the procedural pose and Shift plays the
  walk faster; no stairs clip (the forward leg is lifted instead). Hands don't follow the keyboard; the imported
  (Avatar SDK) hands angle out a little in the clips. Twist of bones in the procedural pose is not set. A desk with no chair has its person on its local +Z side (a
  reception desk: −Z), turned with the desk; a corner desk with no chair has its person outside its +Z side (its open side), not in the L. No
  "Choose your character" hint yet. Full characters' skeletons are not frozen (≤ 12, cheap).
- Walking as yourself: with a clip set the gaits cross-fade (v0.16.0); with only the v0.12 walk clip walk ↔ stand
  switches at once; no turn-on-the-spot or flying clip (flying stands); Studio's Walk through still walks as the
  simple figure. The 20 Rocketbox and 5 Avatar SDK light copies are checked in the browser; AJ / ch12 / Victoria (v1)
  only with our placeholder figures.
- Walk map: a door passage is one cell wide where the door is under ~0.9 m (routes allow it). A desk whose chair
  stands against a wall can't be reached by the body: a route ends at the nearest reachable spot (within 1.5 m). Studio doesn't warn yet about a layout with no door outside or a spawn point inside furniture.
- E at a person (v0.14.7): only the person a walk arrived at; walking up to someone yourself, E still means what the
  crosshair is on. On touch the HUD line reads "Tap it: Details: …" there, but a tap on the window walks: tap the person.
- Take me there: no lifts, no running; the line is drawn on the floor you are on only (the stairs marker shows where
  to go up); a route through a door narrower than ~0.9 m keeps the body on its centre line (slow there). Studio's
  Preview has no search box, so no Show route there.
- Tour plan (v0.14.3): mentions are made at doors only (within 4 m, in sight); a room with a door the route never
  comes near is `missed`. A department on several floors has one stop. The order is planned on a 0.3 m grid, so it can
  differ a little from the shortest by real routes. No lifts.
- Tour (v0.14.4): visited ticks are per browser only (not per person on the server); narration uses the browser's own
  voice (none in some browsers: the button does nothing there); the tour is not in Studio's Preview; no tour editing
  (stops, order and texts all come from the layout and the seats).
- Touch (v0.14.1): no pinch to zoom, no flying or floor buttons by touch (Find + Take me there, or the stairs); the
  joystick has no run speed. The joystick is hidden from screen readers (Find + Take me there cover them).
- A click on a wall walks to the spot in front of it; there is no "walk to the room behind this wall".
- Start mode (v0.14.6): a weak device is found by the WebGL renderer's name only (software rendering) or quality 'low';
  a slow graphics card is not measured. The welcome card shows on every start that walks (not once per browser). Deep
  links are the page's to read (`openAt`): the viewer reads no address itself.
- The embed's `focusOn` works in view mode only. A keyboard-only user who tabs to a walking view can walk and press E
  but not turn (turning needs the mouse).

## DONE: "make both modes work the same way" (requested by Himan, 13 Oct 2026)

The planner "felt very hard to understand". Done (see private-docs/PROGRESS_REPORT.md section 3.8):
1. Planner toolbar is now a vertical bar on the left (`PlannerToolbar.jsx`).
2. Build mode has the Edit item tool (slot 1): move, turn, resize, lock what you look at.
3. The planner has Build mode's tools with the mouse: draw room, drag a wall to resize, door / window, wall,
   furniture on table tops. Both modes use the same pure functions and previews.

## DONE: Workplace Studio UI (approved by Himan, 14 Oct 2026)

The planner screen is now **Workplace Studio** and Build mode is **Preview**, per `private-docs/UI_SPEC.md`
(see private-docs/PROGRESS_REPORT.md section 3.10). The store, `editorHistory`, `layoutBridge` and the pure maths are unchanged.

## DONE: review fixes, Part A (15 Oct 2026, private-docs/NEXT_FIXES.md)

Ground floor protected, two-tab conflicts, undo bursts, instancing/merging for big buildings, UUIDs, export/import,
companies screen restyle, clean-up (private-docs/PROGRESS_REPORT.md section 3.13).

## DONE: shared walls + nested rooms (v0.3.0, 20 Oct 2026)

Anish's shared walls and nested rooms merged into main (his commits keep his name), plus: shared-wall picks on the
side you are on, rebuilding only the rooms touching a change, clicks vs drags on a selected room's floor, no
coinciding faces for nested rooms. See "Shared walls and nested rooms" above.

## DONE: H2 embeddable engine (22 Oct 2026, branch `himan/engine`)

`LayoutEngine` draws a layout without the editor UI (docs/LAYOUT_ENGINE_API.md, private-docs/PROGRESS_REPORT.md 3.14):
- **Own copy:** each engine has its own workspace store (`createWorkspaceStore()`, the app's shape); `loadLayout`
  takes a save, an exported file or v2 (`toV1`), `getLayout` returns v2 (`mergeV2Extras` keeps routes, links, …).
- **Modes:** `edit` / `view` (orbit) / `walkthrough` (Preview's controller with `readOnly`). `engine.editor` =
  `createEditorHistory(_, { workspace })` on its store; outside edit mode every command answers `{ problem: READ_ONLY }`.
- **Bridge:** Studio and connected engines (`connectEngine`) attach contexts; the bridge uses the last attached in
  edit / walkthrough mode, else the last attached (TEAM_INTEGRATION.md). Writes return false in view / walkthrough.
- **React:** `<LayoutViewer />` (no Studio code: checked in the vite build) and `<LayoutEditor />` (edit = today's
  Studio on the app store, lazily loaded; `onChange(layoutV2)`). viewer.html is the test page.
- Studio now uses CameraSystem's `setCameraView` / `flyTo` and the bridge's `_interact` / `_prompt` / `_roomView`.

## DONE: the embed for plain HTML pages (22 Oct 2026, branch `himan/embed`)

Step 2 of `private-docs/AHDUS_3D_INTEGRATION_PLAN.md` (docs/EMBED_GUIDE.md, private-docs/PROGRESS_REPORT.md 3.16): the Training Platform's
pages are plain HTML, so they get one file, `dist-embed/ahdus-workplace.js` (`npm run build:embed`, IIFE, React +
Babylon inside, global `AHDUSWorkplace`; it injects its own small stylesheet).
- `AHDUSWorkplace.mount(element, { layout | layoutUrl, headers, mode, quality, onEvent, onError })` → `{ ready, setMode,
  setFloor, focusOn, highlight, anchors(), registerAction(), destroy() }`; `AHDUSWorkplace.bridge` = layoutBridge.
  It renders `<LayoutViewer />` and adds no engine logic. Import LayoutViewer directly, never `engine/react/index.ts`
  (it pulls in LayoutEditor → Studio, and an IIFE build inlines dynamic imports). LayoutViewer reads saved layouts
  through `services/savedLayouts.js`, never apiService (that bundled the Supabase client: 2,864 → 2,636 kB, 713 → 654 kB
  gzip); e2e:embed fails if saving code comes back.
- Mode `edit` is refused. `layoutUrl`: `credentials: 'include'`, only v2 JSON or an exported `.ahdus.json` (a bare
  save or other JSON is an error). Loading fails → our box is removed, then `onError`, so the page shows its fallback.
- Events (`ready`, `enterRoom`, `exitRoom`, `interact`, `floorChange`, `card`) come from that viewer's engine in
  layoutBridge's payload shapes; `registerAction(match, { label, run })` is a bridge interaction limited to its viewer.
- **Keys (fix/embed-keys; changed in v0.14.0, see "Easy controls"):** in a viewer's walkthrough (`<LayoutViewer>`, the embed) the keys are the page's until the
  view is **engaged**: its canvas has pointer lock or focus is in its box (`tabIndex 0`, one Tab stop, focus ring;
  `LayoutEngine` option `focusTarget`). Not engaged: no preventDefault, no movement. Click = focus + pointer lock;
  Esc or losing the lock = blur. Tab never calls onExit there. `WalkthroughSystem` passes `isEngaged` to the
  controller; Studio's Preview passes nothing and is unchanged.

## DONE: realistic look, real assets (25 Oct 2026, branch `feat/real-assets`)

Real furniture models, photo textures and an HDRI sky (private-docs/PROGRESS_REPORT.md 3.18); see "Realistic look" above.

## DONE: walking routes (v0.13.2, 7 Nov 2026, branch `feature/walk-routes`)

Step v0.13.2 of private-docs/NAVIGATION_PLAN.md (4.3, 5.2): `route.js` + the `?debug=walkmap` view (see "Routes"),
and the walk map fixes routes needed (upper floors under walls, `ITEM_CLEARANCE`, `isClear`, `passages`, 5 more
`MODEL_SIZES`). Screenshots (Meridian, entrance → a desk on Floor 1): private-docs/screenshots/v0.13.2/ (not in git).
Search followed as v0.13.3 (below).

## DONE: live presence, Part A (v0.16.1, 13 Nov 2026, branch `feature/v0.16.1-live-presence`)

The embed's `live` API (people who have the page open now, drawn where they walk, ~250 ms behind, gliding, a 5 m jump
snaps, beside their desk from above, name tags, the nearest 30), the `pose` event (your walk ≤ 5 / s), the
full-character limit measured from the frame rate (12 to 24; weak devices 12): see "Live presence". e2e:live 23 checks.
Part B (AHDUS-FRONTEND WebSocket + Hide me) after the v0.16.1 tag.

## DONE: characters, clips and clothing (v0.16.0, 12 Nov 2026, branch `feature/v0.16.0-characters`)

private-docs/CHARACTERS_V016_PLAN.md parts 1–10: meshopt files load, manifest v2, Wardrobe clothing, the even default,
clips baked once per file (Idle / Walk / Run / Wave for you, Type / Sit at desks, H = wave), many people stay light
(grey figures, files unloaded), the light Rocketbox copies + seated copies (AHDUS-FRONTEND branch
`feature/3d-workplace-v0.16-characters`, not committed there yet), the Meridian measurement (see "Characters, clips
and clothing"). Fixed on the way: Rocketbox clips laid the character down (the glTF root's mirror), T-pose arms in
A-pose clips, the full characters from above went to the edge of the view. e2e:characters 39, e2e:controls 16,
e2e:planner 46. Screenshots: private-docs/screenshots/v0.16.0/ (not in git).

## DONE: Layers, wall items and snapping (v0.15.6, 12 Nov 2026, branch `feature/v0.15.6-layers-wall-snapping`)

The rest of "faster building": Layers hide / show (Studio's view only) and lock for rooms (the one format change: an
optional room `locked`), wall items that hang on walls (+ wall clock, wall shelf, AC unit; Mount on wall, Check's
warning, not floor obstacles), snapping while dragging with guide lines (Alt: none), lint ignores private-docs/,
steadier timing tests (see "Layers, wall items and snapping"; CHANGELOG.md). e2e:layers 38 checks. Screenshots:
private-docs/screenshots/v0.15.6/ (not in git).

## DONE: faster building (v0.15.5, 12 Nov 2026, branch `feature/v0.15.5-faster-building`)

Plan view floors (switcher uncovered, Page Up / Down, the floor below, stairs on both floors, All floors), multi-select,
copy / paste, Layers search, safe typing (see "Faster building"; CHANGELOG.md). Layers hide / show and lock, wall-mounted
items and snapping guides move to v0.15.6. Screenshots: private-docs/screenshots/v0.15.5/ (not in git). e2e:faster 44.

## DONE: Edit and Stretch fixed in the hotbar (v0.15.4, 11 Nov 2026, branch `codex/walkthrough-edit-hotbar`)

Walk through's hotbar: 1 Edit and 2 Stretch are fixed, Office 3, Meeting 9; Edit shows a Delete button for what it
aims at (see "Preview"). Released apart from v0.15.3 (its tag was already published). The "faster building" plan
(multi-select, copy / paste, hide) moves to v0.15.5. e2e:play 36 checks.

## DONE: easy Walk through (v0.15.2, 10 Nov 2026, branch `feature/easy-walkthrough`)

private-docs/EASY_BUILDING_REVIEW.md items 8, 10, 11, 13: Walk through with the viewer's easy controls (drag to look,
the mouse aims, an empty hand's click walks, M = mouse look), G / Edit item takes a desk's chair and riders, turning a
room turns what is in it (`planRoomTurn` + `editor.turnRoom`), the chair follows the move arrows live + live X / Z,
hotbar names / room icons / "Add to hotbar" / catalog pictures, floor-only items off table tops (see "Preview" and
"Easy building"; CHANGELOG.md). Fixed first: a desk dragged in Plan view onto its own chair's old spot landed on the
chair. e2e:play 28, e2e:tools 71, e2e:planner 45 checks.

## DONE: easy building, part 2 (v0.15.1, 9 Nov 2026, branch `fix/easy-building-2`)

A desk takes its chair along (every move of one item, one undo step), a room what stands in it and the rooms inside it
(`editor.moveRoom`), R = 90° / Shift+R = 15° in both modes, W = move arrows (hidden until then), S = resize, no E, F /
double-click = focus on the selection, Inspector sizes in metres + Advanced, the selection bar above the item, Walk
through with an empty hand, catalog room names, the third-person camera near walls (see "Easy building" and
"Preview"; CHANGELOG.md). Also fixed: two Small Office template chairs faced away from their desks. e2e:tools 70 checks.

## DONE: easy building (v0.15.0, 9 Nov 2026, branch `feature/easy-building`)

Studio: drag any item onto the floor or a table top with what stands on it (`editor.moveObjects`), doors and windows
in walls drawn with the Wall tool (`editor.replaceObjects`), sliding a door / window along its wall; Preview: G /
middle-click picks up an item, Edit item slides a door (see "Easy building" under Two editing modes). Fixed with it: a
selected Desk Plant dragged onto a desk stayed on the floor: the move gizmo's arrows covered the small plant and took
the press (Babylon gives the gizmo layer every press), so it slid along one arrow at its old height; now the nearest
thing under the mouse wins. CHANGELOG.md starts here. e2e:tools 58 checks.

## DONE: departments for Studio's layouts (v0.14.9, 8 Nov 2026, branch `fix/room-departments`)

private-docs/EXPERIENCE_PLAN.md 3.5: a department stop needed `room.departmentRef`, which only seed data set, so a
Studio-made company's tour had almost no stops. Now a room with none takes the department of most of the people seated
in it (`places.roomDepartments`, used by Find, the browse menu and the tour; see "Search"), and Studio's room Inspector
has a **Department** field (`ui/roomDepartment.js`, aria-label `Room department`, `data-room-department` = list | text):
the page's departments (AHDUS: `ahdusBackend.listDepartments` = `GET /api/teams/departments`; `<LayoutEditor
departments>`) + None, free text when there are none; saved as `departmentRef` through `editor.updateRoom` (a pick =
one undo step, typing = `mergeKey: 'room-department'`). The furniture "Department" field is unchanged. e2e:tools 46,
e2e:seats 26.

## DONE: a weak device's note (v0.14.8, 8 Nov 2026, branch `fix/weak-device-note`)

private-docs/EXPERIENCE_PLAN.md 3.1, guard 2: a weak device used to start from above with only a Walk button and no
reason. Now a note says why (software WebGL / quality 'low'), "Walk anyway" walks with the welcome card and is
remembered (`chooseStart`: the last choice first, on a weak device too), and the embed says how it started
(`onEvent('start', { mode, reason, weak })`, `handle.start`); see "Start mode". e2e:welcome 39 checks. Screenshots
(desktop 1440 × 900, phone box 390 × 490): private-docs/screenshots/v0.14.8/ (not in git).

## DONE: a short phone view + E at a person (v0.14.7, 8 Nov 2026, branch `fix/welcome-card-short-view`)

Found in AHDUS: on the 3D Company page a phone's view is ~490 px high and the welcome card covered the toolbar and
Overview (Find someone needed scrolling): a box under 600 px gets the compact card (see "Start mode"; e2e:welcome 30
checks). And after Take me there arrived at a person by a window the hint said "E Details: Window": E now means the
person (see "E at a person" in "Going there"). Screenshots (390 × 490 before / after, 390 × 400, 1000 × 400):
private-docs/screenshots/v0.14.7/ (not in git).

## DONE: stairs that lead nowhere, the corner desk's L + walk by default (v0.14.6, 8 Nov 2026, branch `fix/stairs-corner-desk-start-mode`)

Part 1, found in a customer's real layout: stairs that lead nowhere can't be climbed, Studio's stair warnings
(`stairProblems`), the corner desk's real L on the walk map and a visitor at its open side (see "Multi-storey", "Where
walking starts", "Search"). Part 2, private-docs/EXPERIENCE_PLAN.md 3.1: `startMode`, the welcome card, Overview / Walk,
the last choice, weak devices, `openAt` (see "Start mode"); e2e:welcome. Screenshots: private-docs/screenshots/v0.14.6/
(not in git).

## DONE: stairs, goals, walking speed (v0.14.5, 8 Nov 2026, branch `fix/stairs-goal-speed`)

Dhruv's bugs, on AHDUS v0.13.4. **Stairs** (see "Staircase" in "Multi-storey"): the turn was never wrong; a flight's
sides had no collision, so from the side or behind you ended up inside the block; `y`, scale and tilt were drawn but not
walked; a landing moved aside made Take me there cut through the side. **Goals** (see "Routes"): a goal moves only
inside its own room; doors from 0.6 m are open on the walk map as they are in the walkthrough; a DOOR_SINGLE item never
blocks. **Speed:** `play/speeds.js`: walk 2.2, run 4.5, fly 6 m/s for everything (was 4.2 / 7.5 / 9). Tests: stairsWalk,
doorsWalk (real meshes + real controller), goalRoom; e2e:stairs. Screenshots: private-docs/screenshots/v0.14.5/ (not in git).
The welcome card (start walking) is v0.14.6.

## DONE: the company tour (v0.14.4, 8 Nov 2026, branch `feature/tour`)

private-docs/EXPERIENCE_PLAN.md 3.5: three plan fixes (every count agrees; facility stops 8 s and kept on the way;
planned in idle time), then `engine.tour` (TourSystem), the Tour button, Find's "Take the company tour", TourPanel
(Walk me / I'll walk / Skip the walk, Pause / P, Previous, Next, Exit / Esc, the stop list with ticks, Restart,
narration), the embed's `startTour` / `stopTour` / 'tour' event (see "The company tour"); e2e:tour. Screenshots and a
recording (desktop 1440×900, phone 390×844): private-docs/screenshots/v0.14.4/ (not in git).

## DONE: tour planning (v0.14.3, 8 Nov 2026, branch `feature/tour-plan`)

private-docs/EXPERIENCE_PLAN.md 3.5, pure code, no UI: `navigation/tour.js` `planTour` (stops, order, texts, directions,
passing mentions, skipped rooms, time), `engine.navigation.planTour()`, `?debug=tour` (see "The tour's plan"). Meridian:
20 stops on both floors, every department once, 0 skipped, ~322 m, about 8 min. Screenshots (the sample; Meridian's
ground floor and Floor 1): private-docs/screenshots/v0.14.3/ (not in git).

## DONE: Find browse menu (v0.14.2, 7 Nov 2026, branch `feature/find-browse`)

private-docs/EXPERIENCE_PLAN.md 3.3: while Find's box is empty, a menu built from the layout and the seats (chips of
the facility kinds there are, walking "Nearest washroom · 8 m"; My desk; recent searches; departments with counts and
the `departments` option's descriptions; places by kind; by floor), see "Search". Two fixes with it: on a touch screen
the HUD is one short line beside the joystick (the knob pushed forward went under it), and viewer.html's sample layout
is walkable everywhere (Engineering's door no longer behind the CNC machine; the staircase's top inside the meeting
room upstairs; `src/viewer/__tests__/sampleLayout.test.js`), so e2e:touch takes Asha again. Screenshots (the real
Meridian, 13 departments, 319 people; a small layout with no meeting room; desktop 1440×900 + phone 390×844):
private-docs/screenshots/v0.14.2/ (not in git).

## DONE: touch controls (v0.14.1, 7 Nov 2026, branch `feature/touch-controls`)

The Touch row of private-docs/EXPERIENCE_PLAN.md 3.2: the joystick, drag to look and tap by finger, touch words in
the hint, the HUD line and the "?" help (see "Touch controls"); e2e:touch. A mouse and Studio's Preview are
unchanged. Phone screenshots (390 × 844): private-docs/screenshots/v0.14.1/ (not in git).

## DONE: easy controls (v0.14.0, 7 Nov 2026, branch `feature/easy-controls`)

Section 3.2 of private-docs/EXPERIENCE_PLAN.md without touch (that is v0.14.1): drag to look, a click walks there /
opens a person's card / uses a machine, keys with no click, mouse look on double-click or L, the hint and the "?" help
(see "Easy controls"); e2e:controls. Screenshots (desktop 1440×900 + phone 390×844): private-docs/screenshots/v0.14.0/
(not in git).

## DONE: Take me there (v0.13.4, 7 Nov 2026, branch `feature/take-me-there`)

Step v0.13.4 of private-docs/NAVIGATION_PLAN.md (4.5, 4.6, 4.7 + 5.2 / 5.3): walk maps in idle time, the card's
Show route / Take me there, the route line, the strip, `engine.navigation.routeTo / stop`, the 'navigation' event,
`workplace.goTo` (see "Going there"); e2e:navigation. Screenshots + a recording (desktop 1440×900, phone 390×844):
private-docs/screenshots/v0.13.4/ (not in git).

## DONE: search (v0.13.3, 7 Nov 2026, branch `feature/search`)

Step v0.13.3 of private-docs/NAVIGATION_PLAN.md (4.4 + the "not walking" part of 4.5): `places.js`, `engine.navigation`,
the viewer / embed search box, `workplace.find`, option `navigation` (see "Search"). Meridian every-desk route check
with the fixed seed (corner desks): 359 of 359. Screenshots (Meridian, 319 people; desktop 1440×900 + phone 390×844):
private-docs/screenshots/v0.13.3/ (not in git). Take me there followed as v0.13.4 (above).

## DONE: the v0.13.0 review fixes (v0.13.1, 7 Nov 2026, branch `fix/v0.13.1`)

private-docs/NAVIGATION_PLAN.md 5.1, one commit each: doors from 0.8 m are open on the walk map (door passages,
see "Where walking starts"; 0.6 / 0.7 m stay closed); the third-person camera is centred on a portrait phone
(`playController.shoulderOffset(aspect)`); the viewer / embed HUD and Preview's floor control show the floor's own
name (`floorPosition(…).name`), not "Floor 1 of 2"; the spawn point's blue disc shows in Studio only
(`LayoutEngine.STUDIO_ONLY_TYPES`). Screenshots (viewer.html, 1440×900 + 390×844): private-docs/screenshots/v0.13.1/
(not in git). Routes followed as v0.13.2 (below).

## DONE: walkthrough starts at the entrance (v0.13.0, 6 Nov 2026, branch `fix/walkthrough-spawn`)

Step v0.13.0 of private-docs/NAVIGATION_PLAN.md: the walk map + entrance spawn, Home / "Back to entrance", Page Up /
Down and setPose never land in a wall or a desk (see "Where walking starts"). Screenshots (Meridian, with and without
its spawn point, opened while Floor 1 was shown): private-docs/screenshots/v0.13.0/ (not in git).
The four fixes of its review are v0.13.1 (below).

## DONE: no red pointer-lock errors (v0.12.3, 6 Nov 2026, branch `fix/pointer-lock-promise`)

Found in Task 3's AHDUS check: browsers reject `requestPointerLock()`'s promise when they refuse the lock (a click
right after Esc, a frame, a pane that can't lock), and nobody caught it: a red "Uncaught (in promise)". Every lock
request (Preview, viewer / embed walkthrough, Studio's resume) now goes through `utils/pointerLock.lockPointer`,
which catches it (resolves false; the next click asks again). Tests in `utils/__tests__/pointerLock.test.js`.

## DONE: the walk keeps the arms down (v0.12.2, 6 Nov 2026, branch `fix/walk-clip-rest`)

Found in AHDUS with Harsh's walk clip: the legs walked but the arms stayed straight out. The glTF loader started the
clip's animation inside its container, the scene moved those bones every frame, and the copy `bakeWalk` measured
the clip's "rest" from was a frame of the walk. Now no file's animation is started (`GLB_LOAD_OPTIONS`) and
`restContainer` resets one that runs (tests in `PlayerCharacter.test.ts`). Our placeholder clip hid it in e2e.

## DONE: the walk clip waits its turn (v0.12.1, 6 Nov 2026, branch `fix/walk-clip-queue`)

Found in AHDUS: walking started while three seated people's files filled the 3 download slots, and
`CharacterSystem.loadFile` refused the queued walk clip (and would have refused a queued character file), so you slid
in the standing pose. Now a queued file waits, ahead of the people's (test in `CharacterSystem.test.ts`).

## DONE: walking as yourself (v0.12.0, 4 Nov 2026, branch `feature/walk-as-yourself`)

Task 2 of private-docs/TASKS_CHARACTERS.md: in a viewer's walkthrough you are your own character with one shared walk
clip (see "Walking as yourself" in "People at their desks"), plus the 3D Company page's view from above showing the
chosen floor without its roof (LayoutEngine keeps FloorSystem on the store's current floor). Screenshots:
private-docs/screenshots/v0.12.0/ (not in git).

## DONE: "Who sits here" (v0.11.2, 4 Nov 2026, branch `feature/seats-studio`)

Task 1 of private-docs/TASKS_CHARACTERS.md: Admin / HR seat people from Studio inside AHDUS (see "Who sits here" in
"Data and backend"), names on phones (a tap keeps the person card) and "Choose your character" on your own card
(see "People at their desks"). No AHDUS backend changes. Screenshots: private-docs/screenshots/v0.11.2/ (not in git).

## DONE: glTF extensions for the characters (v0.11.1, 3 Nov 2026, branch `fix/gltf-extensions`)

`modelLoader` loaded Babylon's glTF loader without any extension, so the AHDUS office characters (WebP textures,
EXT_texture_webp required) failed and stayed simple figures, and KHR_materials_specular was ignored. Now the three
extensions our files use are registered (see "People at their desks"). The placeholder figures REQUIRE
EXT_texture_webp and KHR_materials_specular (a 4 × 4 white WebP, `scripts/make-placeholder-character.mjs`), so
e2e:characters fails if one goes missing.

## DONE: people at their desks, step A (v0.11.0, 3 Nov 2026, branch `feature/characters-a`)

See "People at their desks" above. Screenshots: private-docs/screenshots/v0.11/ (not in git). Next (phase 1, rest):
AHDUS seats table + API, the manifest and light office copies, the desk Inspector "Who sits here" (AHDUS only).

## DONE: the AHDUS look everywhere + 3 fixes (v0.10.1, 2 Nov 2026, branch `fix/v0.10.1`)

The AHDUS look is the only look (local mode too; the dark classic look and its markup removed); AHDUS-only parts stay
AHDUS-only (see "The AHDUS look"). The phone's "Drag to turn…" hint hides under a bottom sheet and after the first
touch. e2e scripts moved to the library / "Walk through". Screenshots: private-docs/screenshots/v0.10.1/ (not in git).

## DONE: Studio in the AHDUS look, a trial (v0.10.0, 2 Nov 2026, branch `feature/studio-ahdus-look`)

Approved mockups (outside the repo: "Workplace Studio v0.10 mockups-png"); one commit per part, A theme to G phone.
See "The AHDUS look" above. Screenshots: private-docs/screenshots/v0.10/ (not in git).

Ask Himan before big UI changes beyond this. Backlog after it (he prioritises): lifts; free-form walls,
L-shaped rooms; measure tool + dimensions; industrial machine models (Industrial Pack: FBX → GLB first); SVG 2D
floor plan; templates; floor-plan image tracing; evacuation routes; the Supabase backend.
