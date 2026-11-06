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
npm test             # vitest unit tests (803, all must pass; `npx vitest run --exclude ".claude/**"` skips worktree copies)
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
npm run e2e:planner  # 44 checks   e2e/editor-smoke.mjs    (Workplace Studio + its screenshots, the AHDUS look in local
                     #                                       mode, the library, the Realistic look switch, no missing
                     #                                       asset files, floor plan PNG / PDF export, room names + hover
                     #                                       card, Settings → Room labels, Plan view: select, drag,
                     #                                       Ctrl+Z, a phone's hint at 390 px)
npm run e2e:play     # 19 checks   e2e/play-smoke.mjs
npm run e2e:modules  # 17 checks   e2e/modules-smoke.mjs   (uses ?demoModules=1)
npm run e2e:building # 27 checks   e2e/building-smoke.mjs  (multi-storey, floor heights, Page Up/Down)
npm run e2e:tools    # 45 checks   e2e/tools-smoke.mjs     (Studio mouse tools, door sizes, clicks on a selected
                     #                                       room's floor + Preview's Edit item)
npm run e2e:measurements # 23   e2e/measurements-smoke.mjs (off at start, the Measurements panel, measure distance
                     #                                       in 2D, wall lengths, room areas, toggles, Esc, per floor,
                     #                                       Clear Measurements keeps the room)
npm run e2e:templates # 9 checks  e2e/templates-smoke.mjs (new layout from a template: small office, clinic, factory floor)
npm run e2e:save     # 30 checks   e2e/save-smoke.mjs      (auto-save, reopen, version history, old saves, list, delete, export/import,
                     #                                       companies, two tabs on one layout)
npm run e2e:perf     # 10 checks   e2e/perf-smoke.mjs      (72 rooms + 864 items: ≤ 2,000 meshes, ≤ 1,500 draw calls;
                     #                                       one room change rebuilds only it + its neighbours; all items
                     #                                       real models; REALISTIC=off measures the simple look)
npm run e2e:shared-walls  # 17     e2e/shared-walls-smoke.mjs (one wall + one doorway; picks with either owner;
                          #                                    Inspector "Wall thickness" 0.4 m + Ctrl+Z)
npm run e2e:nested-rooms  # 27     e2e/nested-rooms-smoke.mjs (rooms inside rooms, cutouts, next to a shared wall,
                          #                                    rooms drawn inside sharing walls with each other and
                          #                                    the outer wall, doors, picks, upper floor, save + reopen)
npm run e2e:viewer   # 18 checks   e2e/viewer-smoke.mjs    (viewer.html: <LayoutViewer> with no Studio code (also in
                     #                                       the vite build), where walking starts (no room events) + Home, setPose
                     #                                       into a machine, walk in, E + a module's action, edits
                     #                                       refused, Page Up, view mode, a saved layout)
npm run e2e:embed    # 27 checks   e2e/embed-smoke.mjs     (NO dev server needed: builds the embed, no saving code
                     #                                       in it (no Supabase), serves embed-test.html itself; keys are the page's until the view is engaged, walk in,
                     #                                       E action, edits refused, load failures, cross-origin layoutUrl
                     #                                       with cookies, destroy(), assets next to the script, quality low)
npm run e2e:characters # 36     e2e/characters-smoke.mjs (NO dev server: builds the embed; 21 people at desks
                     #                                       on 2 floors: the view from above (no roof: at the start,
                     #                                       after setFloor, after walking), simple figures, full characters near the
                     #                                       camera (each file once), seated poses, hover card (text,
                     #                                       no email), a click keeps it, "Choose your character" on
                     #                                       your own card, a phone's tap, per floor, walking up,
                     #                                       walking as yourself (Mixamo + UE rigs, walk / stand,
                     #                                       eye height, V, your desk figure hidden, fallbacks),
                     #                                       quality low; SHOTS=<dir>: 1440×900 + 390×844 screenshots)
npm run e2e:seats    # 24 checks   e2e/seats-smoke.mjs     (NO dev server: starts its own in AHDUS mode on port 3100,
                     #                                       the AHDUS API faked by page.route: "Who sits here",
                     #                                       search, move / replace questions, not in undo, People
                     #                                       without a desk, the Publish warning, editors read-only,
                     #                                       phone; SHOTS=<dir>: screenshots)
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
- **Preview**: Minecraft-style. Third-person character, hotbar 1–9, B = catalog, left-click builds, right-click
  removes, R rotates, E interacts, N adds a floor above, F fly (Space up / C down), V first/third person, Tab or
  "Back to Studio" returns. Code: `src/play/playController.js` + `src/components/PlayHUD.jsx` (+ `src/ui/preview.css`).
  Default hotbar (`src/play/hotbarItems.js`): Office room, Meeting room, Stretch, Door, Window, Desk, Chair, Staircase, Edit item.
  **Edit item** (slot 9) = Studio's gizmo actions on what you look at: click picks it up / puts it down,
  R turns, + / − resizes (keeps proportions), 0 normal size, L lock/unlock. On a **door/window**: + / − width,
  Shift + / − height (0.1 m), 0 standard size; the hint shows "Door 0.9 × 2.1 m" or why it is blocked.
- **Both modes share the decisions and the look:** `planRoom`, `planOpening`, `planRemoveOpening`, `wallSegmentData`,
  `stretchRoom`, `resizeItem`, `resizeOpening` (`geometry.js`), `placementHeight` (`building.js`), previews in `utils/buildPreview.js`,
  forgiving picks in `utils/pickHelpers.js`, tokens in `src/ui/theme.css`.

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
src/hooks/useStudioKeyboard.js     Studio's keyboard shortcuts (keydown: Tab, Esc, 1–6, Delete, arrows, W / E / R, L,
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
src/play/playController.js         Preview: movement, camera, aiming, every hotbar tool, Stretch, Edit item, stairs, levels
src/planner/plannerTools.js        Studio mouse tools: draw room / wall, door / window, drag a wall to resize
src/utils/buildPreview.js          Blue/red build previews shared by both modes
src/play/navigation/               PURE (v0.13.0): walkMap.js (the walk map of a floor: 0.1 m cells, walls with door gaps,
                                   solid items, grown by the body; createWalkMapCache) + entrance.js (entranceSpawn: where
                                   walking starts; outsideDoors / mainEntrance; nearestFree). Tests in navigation/__tests__/
src/play/people.js                 PURE: people at desks: deskSeat / deskSeats (the chair of a desk), seatPose,
                                   personNear, chooseFullCharacters (≤ 12 nearest), BONE_TABLE (Mixamo ↔ Unreal
                                   names), normaliseBoneName, SEATED_POSE / STANDING_POSE (tests in play/__tests__)
src/engine/systems/CharacterSystem.ts  People: simple figures (thin instances) + full characters (GLB per file, a copy
                                   with its own skeleton per person, posed by bone names), per floor, not pickable
src/engine/systems/PlayerCharacter.ts  Walking as yourself: your character (copyCharacter) + the walk clip baked onto
                                   its bones (retargeted by name, rest-pose corrected), playController's character
src/embed/characterManifest.js     PURE: the character manifest (assetReference → { url, rig, height }), setPeople's list
src/play/geometry.js               PURE maths: room corners, wall splitting, doors, neighbours, stretchRoom, resizeOpening,
                                   shared walls (roomWallSegments, wallPickTarget), nesting (roomContainedBy, containerOf,
                                   planRoomMove, roomRectBlocker), snapping (snapRoomRect),
                                   roomsToRebuild
src/utils/pickHelpers.js           Forgiving picks: the floor under an item = that item; a shared wall = the room on your side
src/play/building.js               PURE maths: storeys, stairs, openings, supportHeight (where you stand)
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
viewer.html + src/viewer/          Blank test page for <LayoutViewer /> (sample company, bridge event list)
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
   deleteObject, duplicateObject, toggleLock, addRoom, updateRoom, deleteRoom, toggleDoor, addOpenings,
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
  (`stairDimsFor` in `supportHeight`) and openings all use it. Placing one with no room where it arrives warns
  "Build a room above to use these stairs" (`stairNeedsRoomAbove`). Walking uses `supportHeight` (STEP_UP 0.45),
  checked after every 0.1 m substep so it works at low fps. `levelForY` decides which floor you're on (1 m lead).
- **Rooms line up between floors:** on an upper floor both modes draw a faint outline of the floor below
  (`utils/floorOutline.js`) while building, and `planRoom` / `stretchRoom` snap edges within 0.3 m onto its walls
  (`snapRectToOutline`, pass `below`). A room that overhangs gets "Part of it has nothing under it" in the hint.
- **The ground floor (lowest, always id 0) can't be deleted** (floor menu, `editor.removeFloor`, store). Old saves
  without floor 0 are renumbered by `normaliseLayout` so the lowest floor becomes 0.
- **Adding floors:** Studio's "Add floor above" and Preview's N ask "Copy rooms from below" (default) or "Empty floor";
  `editor.addFloor({ copyRooms })` copies footprints, types, wall heights, doors and windows (no furniture, no stairs),
  one undo step. N takes you to the new floor; Studio switches to it.
- **Preview floors:** Page Up / Page Down (or ▲ ▼ by "Floor 1 of 3" in the HUD) = `play.stepFloor(±1)` →
  `arrivalOnFloor`: same x, z, standing on a room there, else flying at that floor's height; a wall or a desk there
  = the nearest free spot (`freeSpot`, see "Where walking starts"). Preview again after another floor was chosen
  (Studio's floor switcher) starts on that floor the same way, and a message left from the last walk is cleared
  (`activate`, `playController.floors.test.js`). A viewer's walkthrough always starts at the entrance instead.
- **Room height:** Stretch (slot 3) aimed at the top edge of a wall grabs the top (drag up / down), or + / − on a
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
  - **Studio:** drag a selected room's floor to move it (`planRoomMove`). This happens only after a 5 px drag, and
    never where an item stands (a click selects what is under the cursor). The Inspector size snaps the edges it
    moves (so it sets x / z too) and keeps inner rooms inside (`planRoomResize`).

## Where walking starts (v0.13.0, how it works)

Step v0.13.0 of `private-docs/NAVIGATION_PLAN.md` (4.1, 4.2, 4.6). Pure maths in `src/play/navigation/` (no Babylon).
- **Walk map** (`walkMap.js`, `buildWalkMap(layout, floorId, { catalog })`): one grid per floor, 0.1 m cells
  (bigger on huge floors, ≤ 2.5 M cells), from the LAYOUT DATA: each cell is `FREE` (the body's centre fits),
  `BLOCKED` (a wall or solid item closer than `CLEARANCE` = body radius 0.32 + 0.05 m, measured exactly from the cell's
  centre), `STAIRS` (a flight starting on this floor) or `VOID` (nothing to stand on: outside an upper floor's rooms, a
  stair opening, off the map). The ground floor is walkable 10 m around the building (`STREET`). Walls = what
  roomBuilder builds (`roomWallSegments` / `wallSegmentOpenings` / `splitWall`: shared walls once, doors of either
  room cut them, windows don't), + skirting (it collides). Items: as ObjectSystem makes them collide (not markers,
  stairs, `solid: false`, nor y ≥ 1.8 m), catalogue size × scale, turned; `MODEL_SIZES` for the 5 models bigger than
  their catalogue size (`footprints.test.js` measures every model). A 1 m door leaves ~0.26 m; doors under ~0.9 m can
  be closed on the map (cell size). Meridian: ~15 ms per floor. `createWalkMapCache` rebuilds only when the store's
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
  Preview's HUD "Entrance" (aria-label `Back to entrance`) + Home in its key list.
- Not yet: Studio hints ("No door leads outside…", "Spawn point is inside furniture…"); routes, search and "take me
  there" are v0.13.1–v0.13.3.

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
  Speed: `people.clipSpeed` (root motion ≥ 0.2 m, else 2 × the foot's range / duration); `walkRatio` = your speed /
  that (0.25 to 6); below 0.3 m/s or flying = the standing pose. Eye height `playerEyeHeight` (0.93 × height).
  `playController.setCharacter(c, { eyeHeight })` (null = the simple figure). Your seated figure is hidden while
  walking (`CharacterSystem.setHiddenPerson`). No / unknown character, a failed file, quality 'low' = the simple
  figure; no clip, a failed clip or manifest `walk: false` = the standing pose (slides). Our test clip:
  `public/assets/characters/placeholder-walk.glb` (`scripts/make-placeholder-character.mjs`: 1.2 m/s).

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
  `Front view`, `Side view`, `Room type`; on a phone `More` (menu `More actions`) and `Close the library`.
  AHDUS seats: the section `Who sits here`, `Search people`, `People found`, the banner `People without a desk`.
  `Export floor plan` and `Measurements` keep their labels (the visible text is "Export" / "Measure").
  e2e scripts pick a tool with `pick(tile, option)`: it opens the tile's library unless it is open (a click on an open
  tile closes it), then clicks the option; Rooms = "Draw your own size". Furniture: drag the tile onto the floor.
- viewer.html's dev hooks: `__ahdusViewer` (the LayoutEngine; `.walkthrough.setPose`), `__ahdusScene`, `ahdus`,
  `__viewerEvents` (bridge events), `__ahdusCards`. A viewer captures the mouse on pointerdown (Babylon prevents
  the default of pointerdown, so the browser sends no mousedown; Studio captures it from its button).
- embed-test.html's hooks (also in production: it's a plain page): `window.workplace` (the handle; `._engine` = its
  LayoutEngine, for tests only), `window.embedEvents` (every onEvent call). A viewer's walkthrough doesn't capture the
  mouse by itself: click its canvas first (Preview still does, and headless Chromium grants it without a click).
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
  A staircase turned 45° cuts a square opening. Stairs can't be resized (Preview's Edit item says so; Studio's scale gizmo still can).
- Room labels: a name hidden because it would overlap a bigger room's shows on hover only. The hover card ignores items
  (pointing at a desk shows the room under it).
- Old saves that stored elevations (no floor heights) still read a gap over 6.3 m as a missing floor, not one tall floor.
- A partly covered roof is still drawn; the wall band of a lowered room shows only when ≥ 90 % of it is covered.
- Lowering a room's walls never lowers its floor (use "Floor height" in the floor menu for that).
- The outline of the floor below is hidden where it lies exactly under walls of the floor being edited.
- Rooms are rectangles (no L-shapes or free-form walls). Neighbours share one wall only when back to back
  (at most the thicker wall apart); further apart they keep two walls.
- Wall thickness is per room, not per wall (a room's outside and inside walls are equally thick). Thickening a
  wall checks only that room's items, not the neighbour's on the other side of a shared wall. The build previews
  and the wall highlight use the room's own thickness, not the shared wall's. Free-standing walls (Walls tool) are
  still 0.15 m.
- Nested rooms: the outer room's slab and roof are not cut; moving or resizing the outer room doesn't take the rooms
  inside along (it is blocked if they would stick out of it); moving a room doesn't move its furniture; rooms can be
  moved by their floor only in Studio. A nested room's own walls are drawn 1 cm thinner on the outside than the data says.
- Rooms saved before 22 Oct with a gap (0.15 m or more from the outer wall, or apart from a sibling) keep their own
  walls; stretching or moving the edge to within 0.35 m snaps it. With the 0.5 m grid on, drawing to a grid line
  0.5 m from a wall doesn't snap (draw to the wall itself). Nested rooms don't snap to the floor below.
- Two levels deep (a room inside a room inside a room, all on one wall line): from outside, the wall picks the
  middle room, not the outermost.
- An Inspector size whose edge snaps moves the room's centre a little; doors on the other two walls move with it.
- Realistic look: 27 item types have a Kenney model (low-poly, stretched into the primitive model's box, so some
  proportions differ a little; the open bookcase has no back). Stairs, machines, lockers, racks, signs and markers
  keep their primitive models. The placement ghost shows the primitive model. A faint vertical line can show on
  textured walls where wall pieces meet beside a door or window. Item icons are generic lucide icons, not thumbnails.
- Stretching a wall with a door shared with a neighbour moves only this room's half.
- The "2D" view is the 3D camera from above; the "Plan" view is the real floor plan (scroll zooms, dragging the background pans;
  room names can sit under items; rotation in 90° steps only).
- Room labels and the selection toolbar are HTML over the canvas (always on top, even behind a wall).
- The layout name is saved at once but is not part of undo.
- Doors and windows can be resized but not moved along the wall (remove and add again); window sills are fixed (0.9 m).
- Door/window limits: min width 0.6 m (door) / 0.4 m (window), min height 1.8 m / 0.4 m, 0.1 m from corners and
  below the top of the wall, 0.2 m from other openings, and a door keeps 0.5 m clear of stairs on both sides.
- Preview: + / − is the = / − key (or numpad); on a US keyboard "+" needs Shift, which changes the height.
- "Also open in another tab" can stay shown a while if the other tab crashed instead of closing.
- The storage warning is an estimate (~5 MB per site); browsers differ.
- Skirting isn't pickable on its own (a click goes to the wall behind it).
- People: the pose is procedural (no sit / type animation); twist of bones is not set (hands may turn oddly on real
  characters); hands don't follow the keyboard. A desk with no chair has its person on its local +Z side (a
  reception desk: −Z), turned with the desk; a corner desk's person stands outside its long side, not in the L. No
  "Choose your character" hint yet. Full characters' skeletons are not frozen (≤ 12, cheap).
- Walking as yourself: walk ↔ stand switches at once (no blend); no turn-on-the-spot, running or flying clip (Shift
  plays the walk faster, flying stands); Studio's Preview still walks as the simple figure. Checked with our
  placeholder figures only, not yet with AJ / ch12 / Victoria (AHDUS step after the tag).
- Walk map: doors narrower than ~0.9 m may show as closed (0.1 m cells, body 0.64 m + margin); only routes (v0.13.1)
  will care. Studio doesn't warn yet about a layout with no door outside or a spawn point inside furniture.
- The embed's `focusOn` works in view mode only. A keyboard-only user who tabs to a walking view can walk and press E
  but not turn (turning needs the mouse).

## DONE: "make both modes work the same way" (requested by Himan, 13 Oct 2026)

The planner "felt very hard to understand". Done (see private-docs/PROGRESS_REPORT.md section 3.8):
1. Planner toolbar is now a vertical bar on the left (`PlannerToolbar.jsx`).
2. Build mode has the Edit item tool (slot 9): move, turn, resize, lock what you look at.
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
- **Keys (fix/embed-keys):** in a viewer's walkthrough (`<LayoutViewer>`, the embed) the keys are the page's until the
  view is **engaged**: its canvas has pointer lock or focus is in its box (`tabIndex 0`, one Tab stop, focus ring;
  `LayoutEngine` option `focusTarget`). Not engaged: no preventDefault, no movement. Click = focus + pointer lock;
  Esc or losing the lock = blur. Tab never calls onExit there. `WalkthroughSystem` passes `isEngaged` to the
  controller; Studio's Preview passes nothing and is unchanged.

## DONE: realistic look, real assets (25 Oct 2026, branch `feat/real-assets`)

Real furniture models, photo textures and an HDRI sky (private-docs/PROGRESS_REPORT.md 3.18); see "Realistic look" above.

## DONE: walkthrough starts at the entrance (v0.13.0, 6 Nov 2026, branch `fix/walkthrough-spawn`)

Step v0.13.0 of private-docs/NAVIGATION_PLAN.md: the walk map + entrance spawn, Home / "Back to entrance", Page Up /
Down and setPose never land in a wall or a desk (see "Where walking starts"). Screenshots (Meridian, with and without
its spawn point, opened while Floor 1 was shown): private-docs/screenshots/v0.13.0/ (not in git).
**Next, v0.13.1 (first, before routes; private-docs/NAVIGATION_PLAN.md 5.1):** doors from 0.8 m open on the walk
map (as the real collision); centre the third-person character on phones (390 px: half off the left edge); the HUD
shows the floor's own name, not "Floor 1 of 2" (confusing next to a floor named "Floor 1"); hide the spawn-point
marker (blue disc) outside Studio.

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
