# AHDUS: Company Layout Replica

Himan's internship module of **AHDUS (Advance Human Digital Unified System)**, a company digital twin.
This module is the **3D replica of the company's building**: rooms, floors, stairs, furniture, machines.
Other interns build modules that plug into it (see "Team" below), but **the current priority is making the
3D workspace complete and polished, not team integration.**

Full history, status and backlog: `docs/PROGRESS_REPORT.md`. Teammate API guide: `docs/TEAM_INTEGRATION.md`.

## Commands

```bash
npm install
npm run dev          # Vite on http://localhost:3000, opens in Workplace Studio
npm test             # vitest unit tests (185, all must pass)
npm run typecheck    # tsc --noEmit (covers src/engine)
npm run build

# Browser tests: Playwright, need `npm run dev` running in another terminal.
# One-time: npx playwright install chromium
npm run e2e:planner  # 29 checks   e2e/editor-smoke.mjs    (Workplace Studio + UI_SPEC screenshots)
npm run e2e:play     # 19 checks   e2e/play-smoke.mjs
npm run e2e:modules  # 17 checks   e2e/modules-smoke.mjs   (uses ?demoModules=1)
npm run e2e:building # 27 checks   e2e/building-smoke.mjs  (multi-storey, floor heights, Page Up/Down)
npm run e2e:tools    # 41 checks   e2e/tools-smoke.mjs     (Studio mouse tools, door sizes + Preview's Edit item)
npm run e2e:save     # 19 checks   e2e/save-smoke.mjs      (auto-save, reopen a layout, old saves, list, delete)
npm run e2e          # all of them
```

After any change: run `npm test`, and the e2e script for the area you touched. Screenshots go to `e2e/screens/`.

## Stack

React 18 + Babylon.js 7 + Zustand 4 (`subscribeWithSelector`) + Vite 5. Mostly JS; `src/engine/` is TypeScript
with a Zod schema. uuid v5 for stable anchor IDs. Aliases: `@` = `src`, `@engine` = `src/engine`.
UI: plain CSS with design tokens (`src/ui/theme.css`), `lucide-react` icons, Inter (`@fontsource/inter`). No UI framework.

## Two editing modes (same layout, Tab switches)

UI names (use them in all UI text): **Workplace Studio** (code: "planner", `WorkplaceEditor.jsx`, `plannerTools.js`)
and **Preview** (code: "play", `playController.js`, `PlayHUD.jsx`; formerly "Build mode" / "Play mode").
Spec of the look: `UI_SPEC.md` (repo root).

- **Workplace Studio** (`src/ui/`): header (AHDUS = all layouts, breadcrumb with the layout name (click to rename),
  save status, Undo, Redo, Settings popover: snap, step, show grid, lighting, FPS in dev); **Build panel** of tiles
  (Select, Rooms, Walls, Doors & Windows, Stairs, Furniture; keys 1–6) whose **options trays** arm a planner tool or
  start placing an asset; Layers at its bottom; **canvas card** (2D | 3D, Fit view, empty state, room labels,
  floating **selection toolbar**); **Inspector** card only while something is selected (or Layers is on);
  **footer**: floor switcher menu, the active tool's hint, "Preview Workplace". The tool list is defined once in
  `src/ui/tools.js` (also gives Preview's hotbar/catalog icons). Studio uses the same sky/grass/paving as Preview;
  the build grid shows only while a build tool is active (or "Show grid" is on).
  **Build tools** (`src/planner/plannerTools.js`): Select (drag a wall of the selected room to resize it),
  room (drag corner to corner), wall (drag), door / window (click a wall; click one to remove).
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
src/components/WorkplaceEditor.jsx  Scene setup, store→mesh syncing, Studio wiring, mode switching, level visibility (~1450 lines)
src/ui/                            Workplace Studio: theme.css, tools.js, StudioShell, StudioHeader, BuildPanel (+ trays,
                                   CatalogPicker), CanvasCard, RoomLabels, SelectionToolbar, Inspector, StudioFooter, EditorErrorBoundary, preview.css
src/play/playController.js         Preview: movement, camera, aiming, every hotbar tool, Stretch, Edit item, stairs, levels
src/planner/plannerTools.js        Studio mouse tools: draw room / wall, door / window, drag a wall to resize
src/utils/buildPreview.js          Blue/red build previews shared by both modes
src/play/geometry.js               PURE maths: room corners, wall splitting, doors, neighbours, stretchRoom, resizeOpening
src/play/building.js               PURE maths: storeys, stairs, openings, supportHeight (where you stand)
src/play/movement.js               Collision-safe movement in 0.1 m substeps (afterStep callback for step-up)
src/play/character.js              Placeholder character; interface { root, update(dt,speed,flying), setVisible, dispose }
src/store/workspaceStore.js        Zustand store: rooms, objects, floors, anchorData, selection, save/load
src/store/layoutData.js            PURE: normaliseLayout (old saves → current shape), layoutSummary (layout list)
src/store/editorHistory.js         THE place layout changes happen; every change is an undoable command
src/utils/roomBuilder.js           Room meshes: floors, walls around openings, slab, roof, ceiling + lights
src/utils/materialLibrary.js       Procedural textures; SHARED materials
src/utils/assetCatalog.js          30+ furniture/equipment built from primitives (incl. STAIRCASE, CNC_MACHINE, LATHE)
src/utils/siteEnvironment.js       Sky, fog, grass, paving, build grid
src/integration/layoutBridge.js    Public API for teammates' modules (events, anchors, Press-E actions)
src/engine/                        Embeddable engine: v2 schema, v1→v2 migration, anchors, commands. LayoutEngine
                                   and systems/ are mostly stubs; the editor does NOT use them yet.
src/services/apiService.js         Save/load + auto-save (1 s debounce, tab close): localStorage mock backend for now
db/schema.sql                      PostgreSQL schema (base for the Supabase backend)
```

## Rules (follow these)

1. **Every layout change goes through `editorHistory`** (`createEditorHistory()`: addObject, updateObject,
   deleteObject, duplicateObject, toggleLock, addRoom, updateRoom, deleteRoom, toggleDoor, addOpenings,
   removeOpenings, resizeOpening, setWallHeight, setFloorHeight, setAnchorData, addFloor({ copyRooms }), removeFloor,
   renameFloor). Never call store mutators directly from
   UI or tools, or undo breaks. Continuous edits (slider drag, typing) pass `{ mergeKey }` so they are one undo step.
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
   floor | wall | door | window | slab | roof | ceiling | band; objects carry `objectId` and `floorId`. Keep it on new meshes.
   Each door/window has an invisible pickable pane (`*_pick`, visibility 0, `metadata.pickPane`): Studio clicks and
   Preview's Edit item pick the door with it; Preview's other aiming looks through it (`aimPick(..., { panes })`).
6. **Pure maths stays pure:** geometry/building logic goes in `geometry.js` / `building.js` (no Babylon imports)
   with vitest tests in `src/play/__tests__/`.
7. **Anchor IDs** are uuid v5 of objectId + kind. Never change this; teammates store these IDs.
8. **`layoutBridge` is a contract with teammates.** Don't break its API; if you change it, update
   `docs/TEAM_INTEGRATION.md` and `src/integration/__tests__/layoutBridge.test.js`.
9. User-facing text: short, plain English. Every new feature must be undoable and must work on upper floors.

## Multi-storey (how it works)

- `WorkplaceEditor` builds **all** floors at once. `applyLevelVisibility` uses a view `{ mode, level }`:
  `planner` shows floors ≤ selected and hides the selected floor's roof; `outside` shows all + roofs on uncovered
  rooms; `inside` shows all + ceilings, and the camera is clamped under the ceiling (except on stairs).
- **Floor heights** (`building.js`): floor `{ id, name, height }`; `elevationOf` sums the heights below. Upper-floor
  rooms sit on a `SLAB` (0.3 m) that starts exactly where full-height walls below end, so storeys never gap or overlap.
  `planWallHeight`: lower walls change only that room; walls higher than the floor allows raise the floor to
  walls + SLAB, rooms that filled it grow with it, floors above follow (one undo step: `HeightsCommand` in
  editorHistory, mergeable for + / − bursts). `planFloorHeight` (Studio floor menu "Floor height"): filling rooms
  follow, taller ones shrink. A room made lower than its floor gets a wall **band** (part `band`) up to the slab,
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
- **Adding floors:** Studio's "Add floor above" and Preview's N ask "Copy rooms from below" (default) or "Empty floor";
  `editor.addFloor({ copyRooms })` copies footprints, types, wall heights, doors and windows (no furniture, no stairs),
  one undo step. N takes you to the new floor; Studio switches to it.
- **Preview floors:** Page Up / Page Down (or ▲ ▼ by "Floor 1 of 3" in the HUD) = `play.stepFloor(±1)` →
  `arrivalOnFloor`: same x, z, standing on a room there, else flying at that floor's height.
- **Room height:** Stretch (slot 3) aimed at the top edge of a wall grabs the top (drag up / down), or + / − on a
  wall (0.1 m, a burst = one undo step). Studio: blue handles on top of the selected room's walls (3D), Inspector
  "Wall height". Hint: "Office · walls 3.4 m · Ground Floor is now 3.7 m high".
- Build tools act on `currentLevel` (the floor under the character). `__ahdusPlay.setPose({x,z,yaw,pitch,floor,y,fly})`,
  `goToFloor(id)`, `stepFloor(±1)`, `isFlying()`.

## Testing gotchas

- Studio controls have fixed `aria-label`s (UI_SPEC section 7: `Rooms`, `Floor switcher`, `Preview Workplace`, …);
  e2e scripts select by them. While Preview has the mouse captured, clicks go to the canvas: release it first.
- Dev-only hooks for tests/console: `window.__ahdusPlay`, `__ahdusScene`, `__ahdusStore`, `window.ahdus` (bridge),
  `__ahdusCards`, `__ahdusEventLog` (demo modules), `__ahdusCrashOnOpen = true` (the editor throws: error card test).
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
- Loading goes through `normaliseLayout` (`src/store/layoutData.js`): old saves get floors, elevations,
  anchorData, opening sizes. The layout list is built from the saved data (name, rooms, floors, last edit).
- The editor is wrapped in `EditorErrorBoundary`: a failure shows "This layout could not be opened" + Back to layouts.
- Decided: **Supabase** (PostgreSQL; must be self-hostable on the client company's server). Not started.
  Start from `db/schema.sql`. Versioned saves + conflict detection come with it.

## Team (other interns' modules plug in through layoutBridge)

Harsh: characters & voice · Karthik: machine videos & files · Yashashwi: handover of previous employees' work ·
Dhruv: frontend app shell (needs an embeddable `<LayoutEditor />` later) · Sunil & Kavyashree: logins,
activity monitoring, sync. Demo modules: `?demoModules=1` (`src/integration/demoModules.js`).

## Known limitations

- One straight flight per staircase, always 4.0 m long: on tall floors (5–6 m) the steps get short and the flight steep.
  A staircase turned 45° cuts a square opening. Stairs can't be resized (Preview's Edit item says so; Studio's scale gizmo still can).
- A partly covered roof is still drawn; the wall band of a lowered room shows only when ≥ 90 % of it is covered.
- Lowering a room's walls never lowers its floor (use "Floor height" in the floor menu for that).
- The outline of the floor below is hidden where it lies exactly under walls of the floor being edited.
- Rooms are rectangles; neighbouring rooms have two walls 15 cm apart (no shared walls yet).
- Furniture is built from primitives (no GLB models yet); item icons are generic lucide icons, not thumbnails.
- Stretching a wall with a door shared with a neighbour moves only this room's half.
- The "2D" view is the 3D camera from above, not a real floor plan.
- Room labels and the selection toolbar are HTML over the canvas (always on top, even behind a wall).
- The layout name is saved at once but is not part of undo.
- Doors and windows can be resized but not moved along the wall (remove and add again); window sills are fixed (0.9 m).
- Door/window limits: min width 0.6 m (door) / 0.4 m (window), min height 1.8 m / 0.4 m, 0.1 m from corners and
  below the top of the wall, 0.2 m from other openings, and a door keeps 0.5 m clear of stairs on both sides.
- Preview: + / − is the = / − key (or numpad); on a US keyboard "+" needs Shift, which changes the height.

## DONE: "make both modes work the same way" (requested by Himan, 13 Oct 2026)

The planner "felt very hard to understand". Done (see docs/PROGRESS_REPORT.md section 3.8):
1. Planner toolbar is now a vertical bar on the left (`PlannerToolbar.jsx`).
2. Build mode has the Edit item tool (slot 9): move, turn, resize, lock what you look at.
3. The planner has Build mode's tools with the mouse: draw room, drag a wall to resize, door / window, wall,
   furniture on table tops. Both modes use the same pure functions and previews.

## DONE: Workplace Studio UI (approved by Himan, 14 Oct 2026)

The planner screen is now **Workplace Studio** and Build mode is **Preview**, per `UI_SPEC.md`
(see docs/PROGRESS_REPORT.md section 3.10). The store, `editorHistory`, `layoutBridge` and the pure maths are unchanged.

Ask Himan before big UI changes beyond this. Backlog after it (he prioritises): lifts; free-form walls, shared
walls, L-shaped rooms; measure tool + dimensions; real GLB furniture (e.g. Kenney Furniture Kit, CC0); SVG 2D
floor plan; templates; floor-plan image tracing; evacuation routes; the Supabase backend.
