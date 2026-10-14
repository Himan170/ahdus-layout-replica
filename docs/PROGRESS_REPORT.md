# AHDUS Company Layout Replica: Progress Report

**Project:** AHDUS (Advance Human Digital Unified System), Company Digital Twin
**Module:** Company layout replica (digital workplace engine)
**Owner:** Himan
**Report date:** 14 October 2026 (updated: floor heights)
**Latest build:** `company-digital-twin-storeys.zip` (multi-storey buildings added)

---

## 1. Summary

- The editor now opens in **Build mode**. You play as a character in third person and build the office Minecraft-style with a hotbar: draw rooms, **stretch rooms by pushing their walls**, add doors and windows, and place furniture.
- Rooms look **realistic**: wooden, carpet, tile and concrete floors by room type, plaster walls, skirting boards, door frames and glass windows, outdoors with grass, paving and sky.
- **Every edit can be undone** (Ctrl+Z / Ctrl+Y), in both Build mode and the planner.
- Several serious bugs were found and fixed. The biggest: **placing objects was completely broken** in the original code.
- **Teammates can now connect their modules** (step 1): hook points are saved with the layout, pressing E and walking into rooms send real events, desks can be linked to job positions, and three demo modules show it working.
- **Multi-storey buildings:** floors stack at real heights with floor slabs, roofs and indoor ceilings with lights; stairs climb one storey and you walk up and down them; you build on whichever floor you are on.
- **Real floor heights (14 Oct):** each floor has its own height, walls and floors always fit together (no gaps or overlaps between storeys), stairs climb whatever height their floor is, new floors can copy the rooms below, and Preview has Page Up / Page Down between floors.
- **185 unit tests** and **152 browser checks** all pass (see 3.9).
- **Not done yet:** a real backend (Supabase, decided), real 3D furniture models, elevators, free-form walls, floor-plan tracing, and the engine/UI split (needed for Dhruv's app).

---

## 2. Starting point (before this work)

Phases 1–6 were complete: a Babylon.js + React editor with rooms, floors, 30+ furniture items, a gizmo, snapping, undo for moving objects only, a first-person walkthrough and a PostgreSQL schema.

What was wrong with it:
- It looked and felt like a developer tool (dark grid, sidebar buttons, rooms as coloured boxes).
- Rooms were added and expanded with sidebar buttons, not in the 3D world.
- Undo only covered moving, rotating and scaling objects.
- Placing objects crashed in the browser (found during this work, see 3.3).
- There was no real backend: saving goes to the browser's localStorage.

---

## 3. What was done

### 3.1 Planning documents

| Document | Contents |
|---|---|
| `AHDUS_Digital_Twin_Improvement_Plan.md` | Whole-product gap analysis against the PRD, target architecture, data model, roadmap, demo script |
| `Himan_Company_Layout_Replica_Plan.md` | Plan scoped to my module only: Workstreams A–F, timeline, how teammates plug in |
| `docs/LAYOUT_ENGINE_API.md` | Integration contract for the team: engine API, **anchors** (seat, workstation, spawn, machine, reception, info-point), events, who owns what, with a status table |

### 3.2 Engine foundation (`src/engine/`)

- **Layout format v2** (Zod schema): building, floors, rooms, openings (doors/windows), objects, anchors, routes, floor links.
- **Migration from the old format**, with these bugs fixed:
  - Room types (Meeting, Production, Corridor, Staircase, Restroom) were turned into `CUSTOM`.
  - Lock flags were lost (old field `isLocked` vs new `locked`).
  - Anchor IDs changed on every load, which would break teammates' links. They are now fixed per object.
  - Anchors didn't follow their object when it moved.
  - The reception desk also got a workstation anchor.
  - "In front of the machine" ignored the machine's rotation.
  - Saved v2 layouts weren't validated.
- **Command history (undo/redo)** with merging: a slider drag or typing a name counts as one undo step.
- **`LayoutEngine`:** fixed a crash ("No camera defined" on every frame) and 2 TypeScript errors.

### 3.3 Undo for everything + critical editor bugs

All edits go through one file, `src/store/editorHistory.js`, so all of them can be undone:
place, delete, duplicate, move/rotate/scale, lock objects; add, edit, stretch, delete rooms; doors and windows; add, rename, remove floors (undoing a floor removal brings back everything on it).

Bugs fixed in the original editor:

| Bug | Effect |
|---|---|
| `require()` used in browser code (`placementManager.js`) | **No object could be placed at all** |
| `buildAssetMesh` called with arguments in the wrong order | Objects couldn't be drawn |
| Clicking an asset card did nothing | Card → canvas placement was broken |
| Dragging an asset onto the canvas | Would have added it twice |
| Click placement ignored height and rotation | Scroll-to-raise and R-to-rotate were lost |
| Properties panel kept stale values | Typing a label snapped a moved object back |
| A new preview material on every mouse move | Memory leak |
| Mixed CSS border styles | React warnings in the console |

### 3.4 Build mode: Minecraft-style building (`src/play/`)

> A first version of Build mode (character, hotbar, room drawing, realistic materials) came from a separate working session. It was reviewed, tested and extended here, not rewritten.

**Controls**

| Key | Action |
|---|---|
| W A S D, Shift | Move, run |
| Mouse | Look (click to capture, Esc to release) |
| Space / F / V | Jump / fly / first-person camera |
| 1–9, mouse wheel | Choose hotbar slot |
| B | Catalog: put any item in the selected slot |
| Left-click / Right-click | Build / remove (or cancel) |
| R | Rotate furniture |
| E | Interact (hook for teammates; placeholder for now) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Tab | Switch to the planner |

**Hotbar tools**

| Slot | Tool | How it works |
|---|---|---|
| 1–2 | Office room, Meeting room | Click one corner on the ground, then the opposite corner. The live preview shows the size; snaps back-to-back with neighbouring rooms; blocks overlaps |
| 3 | **Stretch room** (new) | Click a wall to grab it, look where it should go, click to drop. Shows the new size and the change; blocked if it would overlap a room, go below 1.5 m, or cut through a door, window or furniture; side-wall doors stay in place |
| 4–5 | Door, Window | Aim at a wall and click. On a shared wall, one door goes through both rooms |
| 6–9 | Desk, Chair, Meeting table, Plant | Aim at the floor (or a table top) and click |
| Catalog | All room types, free-standing wall, 30+ furniture and equipment items | Press B |

**Realism**
- Floors by room type: oak (office), carpet (meeting), large tiles (reception, corridor), concrete (production, staircase), raised floor (server room), small tiles (restroom). Textures keep their real-world size.
- Plaster walls built around openings, skirting boards, wooden door frames, aluminium window frames with glass.
- Outdoor site: sky, fog, grass, paving. A build grid appears only while holding a building tool.
- Character with a walk cycle, wall collisions, and a camera that doesn't pass through walls.

### 3.5 Furniture materials and performance

- Wood-grain texture on wooden furniture, woven texture on chairs and sofas.
- **Shared materials:** identical items use one material instead of one per part (50 desks no longer means hundreds of materials).
- The lock indicator now uses a per-object overlay, so locking one desk doesn't tint every desk.
- Deleting an object never disposes a material another object still uses. Checked in a browser.

### 3.6 Team integration (step 1, 13 Oct)

- **Bridge for other modules** (`src/integration/layoutBridge.js`): read hook points, objects and rooms; listen to events; add "Press E" actions; link desks to positions. Guide: `docs/TEAM_INTEGRATION.md`.
- **Hook points saved with the layout:** seats, workstations, machines, reception desks and spawn points follow their object; links (`positionRef`, labels) are saved, loaded, carried into the v2 format, and survive deleting + undoing the object.
- **Real events:** `interact` (E within 3.5 m), `enterRoom` / `exitRoom` (no flicker in doorways between back-to-back rooms), `anchorsChange`.
- **"Press E" prompt** under the crosshair, showing what the matching module will do ("E Watch CNC Machine video"). Without a module, E shows an info card.
- **Linked position** in the planner's properties panel (dropdown from Yashashwi's module, text box until then), undoable.
- **New shop-floor machines:** CNC machine and lathe (Industrial category) with machine hook points.
- **Demo modules** (`?demoModules=1`): fake Karthik (machine video), Yashashwi (positions + handover notes) and Harsh (greeter character at reception) modules, built only on the public bridge API.

### 3.7 Multi-storey buildings (13 Oct)

- **Floors stack at their real height** (3.5 m per storey) and are all built at once, not one flat world per floor.
- **Floor slabs** under upper-floor rooms fill the gap between storeys (the floor band you see from outside).
- **Roofs** (slab, membrane and parapet) on rooms with nothing built above; hidden where the floor above covers them.
- **Indoor ceilings with LED light panels.** Indoors the camera stays under the ceiling; you see upper floors through stairwells and windows.
- **Staircase** (hotbar slot 8): 16 solid steps with a handrail, climbing exactly one storey. The floor above gets an **opening cut over it automatically**, and the ceiling below too.
- **Walking up and down stairs** works at any frame rate (step-up is checked every 10 cm of movement).
- **The floor you are on follows your character:** the HUD, the building tools and teammates' events all use it.
- **N** adds a new floor above; fly (F, Space) or take the stairs to reach it, and build rooms there.
- **Planner:** choosing a floor shows it and the floors below, with its own roof hidden so you can see inside.
- Hook points and object positions are world positions (upper floors are 3.5 m higher), so teammates' characters stand on the right floor.

### 3.8 One way of working in both modes (13 Oct)

Himan found the planner hard to understand. Both modes now offer the same tools:

- **Planner toolbar moved to a vertical bar on the left** (`PlannerToolbar.jsx`), top to bottom: layout name, View (3D/2D), Floors (+ Add Floor), **Build**, Selected item (Move/Rotate/Scale), History (Undo/Redo), Grid (Snap + size), Lighting, ▶ Play and FPS. Play stays visible at the bottom.
- **Planner Build tools, done with the mouse** (`src/planner/plannerTools.js`):
  - **Draw room:** drag on the floor from one corner to the opposite corner (room type chosen under the button). Snaps back-to-back onto neighbours, turns red over another room.
  - **Resize a room:** select it, then drag one of its walls (Build mode's Stretch). Doors on the side walls stay put; furniture and neighbours block it.
  - **Door / Window:** click a room wall; a shared wall gets the opening in both rooms. Click an existing one to remove it.
  - **Wall:** drag from start to end.
  - **Furniture on table tops:** items from the Objects panel stack on desks, as in Build mode; the side of furniture shows red.
  - Same blue/red previews and the same hint box as Build mode. Esc leaves the tool; Delete also removes a selected room. Clicking the floor under a desk selects the desk.
- **Build mode Edit item tool** (hotbar slot 9, replaces the plant; the plant is in the catalog): the planner's gizmo actions on what you look at. Shows the item's size; **left-click** picks it up and it follows the crosshair over floors and table tops, left-click puts it down (right-click cancels); **R** turns 45°; **+ / −** resizes (keeps proportions, 20–500 %); **0** normal size; **L** locks/unlocks. All undoable; repeated presses on one item are one undo step.
- **No duplicated logic:** both modes call the same pure functions (`planRoom`, `planOpening`, `planRemoveOpening`, `wallSegmentData`, `stretchRoom`, `resizeItem` in `geometry.js`; `placementHeight` in `building.js`), draw with the same previews (`utils/buildPreview.js`) and share forgiving picking (`utils/pickHelpers.js`). The Build mode code was refactored onto them.

### 3.12 Real floor heights (14 Oct)

Requested by Himan: "Fix how floors and heights work." Each problem was reproduced in the browser first
(scratch script measuring meshes): a ground room with **4 m walls went 1.0 m into the floor above**, one with
**2.5 m walls left a 0.5 m gap**, and stairs with no room above had a **solid roof over the stairwell**.

**Cause:** floor elevation was fixed at floorId × 3.5 m, the slab at 0.5 m and stairs at 3.5 m, while the
Inspector let a room's walls be 2–6 m; nothing tied wall heights to floor heights. The roof was never cut for stairs
(only the ceiling was), so with no room above the roof sat over the stairwell.

**Fix:**
- **Floor heights.** Each floor stores `height` (floor-to-floor, default 3.5 m). Elevation is derived (the heights
  below, added up) and never stored. Slab: 0.3 m. New rooms' walls fill their floor (3.2 m on a 3.5 m floor).
- **Walls and floors stay fitted** (`planWallHeight`, `planFloorHeight` in `building.js`): walls higher than the
  floor allows raise the floor (walls + slab), rooms that filled it grow with it, and every floor above moves up,
  as one undo step. Lowering walls is allowed; from outside a wall band closes the gap under the floor above.
  "Floor height 3.5 m" in the Studio floor menu.
- **Stairs climb exactly their floor's height** (steps of 0.18–0.2 m, e.g. 18 for 3.5 m, 22 for 4.3 m) in the mesh,
  the walking maths and the openings; they are rebuilt when the floor height changes.
- **Stairwells:** the roof is cut over stairs too; placing stairs with nothing to arrive at says "Build a room above
  to use these stairs".
- **Rooms line up between floors:** a faint outline of the floor below while building on an upper floor (both modes),
  edges snap onto it within 0.3 m, and an overhanging room gets a warning in the hint (still allowed).
- **New floors:** "Add floor above" (Studio) and N (Preview) ask **Copy rooms from below** (default: footprints, types,
  wall heights, doors, windows; no furniture or stairs) or **Empty floor**. One undo step. N takes you there.
- **Getting around in Preview:** Page Up / Page Down (or ▲ ▼ next to **Floor 1 of 3** in the HUD) go to the floor
  above / below at the same spot: standing on a room there, otherwise flying at that height.
- **Room height in Preview:** Stretch (slot 3) on the top edge of a wall drags the walls up or down; + / − on a wall
  changes them 0.1 m a press ("Office · walls 3.4 m"). Studio: blue handles on top of the selected room's walls.
- **Old saves:** floors keep their place (height = distance to the next saved elevation); walls that met the old
  0.5 m slab grow 0.2 m to meet the new one; any floor shorter than its walls + slab is raised.
- Teammates: bridge positions and anchors use the derived elevation (unchanged API; Floor 1 is still 3.5 m up on
  standard floors). The v2 export computes `elevation` from the heights.

### 3.9 Testing

| Test file | What it covers | Tests |
|---|---|---|
| `engine/__tests__/migrate.test.ts` | v1 → v2 migration, anchors, validation | 15 |
| `engine/__tests__/commands.test.ts` | Undo/redo commands, history cap | 6 |
| `store/__tests__/editorHistory.test.js` | Every editor action undoable, merging | 14 |
| `play/__tests__/geometry.test.js` | Room corners, wall splitting, doors, neighbours | 22 |
| `play/__tests__/stretch.test.js` | Stretch room: grow, shrink, blocks, doors | 11 |
| `play/__tests__/movement.test.js` | Collision steps | 3 |
| `integration/__tests__/layoutBridge.test.js` | Hook points, links, save/load, events, E actions, upper floors | 20 |
| `play/__tests__/building.test.js` | Floors, stairs, openings, roofs, where you stand | 14 |
| `play/__tests__/buildActions.test.js` | Shared build decisions: rooms, doors/windows, walls, resizing, furniture heights | 17 |
| `play/__tests__/openingSize.test.js` | Door/window sizes: limits (walls, corners, other openings, stairs), shared doors | 16 |
| `store/__tests__/saveLoad.test.js` | Save → load round trip, old saves, layout list, auto-save, failed saves | 11 |
| `play/__tests__/floorHeights.test.js` | Floor heights, derived elevations, wall/floor height rules, stair rise, Page Up/Down arrival, outline snapping, overhangs, old-save migration | 24 |
| **Unit total** | (editorHistory now 25: + floor and wall heights, copy rooms) | **185 ✅** |
| `e2e/editor-smoke.mjs` | Workplace Studio: layout at 1280×720 and 1920×1080, empty state, placing, selection toolbar + Inspector, floor switcher, Preview ↔ Studio | 29 checks ✅ |
| `e2e/play-smoke.mjs` | Preview in a real browser (build, walk, doors, stretch, undo) | 19 checks ✅ |
| `e2e/modules-smoke.mjs` | Demo modules: E prompts/actions, room events, greeter, linking with undo | 17 checks ✅ |
| `e2e/building-smoke.mjs` | Multi-storey: N asks copy/empty, overhang warning, stair opening, walking up/down, Page Up/Down, Stretch raises the floor above (no gap), stairs on a 4.3 m floor, stairwell roof cut, Studio outline, wall/floor heights, copy rooms | 27 checks ✅ |
| `e2e/tools-smoke.mjs` | Build panel; Studio draw room / drag wall / door / window / wall / desk-top stacking / upper floor; door size (Inspector, handles, upstairs); Preview Edit item on furniture and doors | 41 checks ✅ |
| `e2e/save-smoke.mjs` | Typed name, auto-save (also floors), rename, list (rooms / floors / last edit), **reopen a layout**, tab close, old save, error card, delete confirmation | 19 checks ✅ |

When first written, these tests also caught the old bugs: the original migration code failed 10 of the 14 migration tests that existed then, and the original editor failed the "place object" browser check.

### 3.10 Workplace Studio UI (14 Oct)

The planner screen was rebuilt as **Workplace Studio**, following `UI_SPEC.md` (approved by Himan from a reference
screenshot). Build mode is now called **Preview**. UI only: the store, `editorHistory`, `layoutBridge`, the 3D scene
code and the pure maths did not change; every action still goes through `editorHistory`.

- **Layout** (`src/ui/StudioShell.jsx`): header, then three rounded cards (Build panel, canvas, Inspector) with 16 px
  gaps, then a footer. The page never scrolls. The canvas card is 83 % of the width at 1280×720 and 89 % at 1920×1080
  with nothing selected. The Inspector slides open (150 ms) only while something is selected; the 3D view resizes
  with it, and the 2D view keeps its proportions.
- **Design tokens** (`src/ui/theme.css`): one calm dark palette, one accent colour, Inter, thin dark scrollbars
  everywhere, a visible focus ring. Icons are `lucide-react` (no emoji in the UI). Plain CSS files, no UI framework.
- **One tool list** (`src/ui/tools.js`): Select, Rooms, Walls, Doors & Windows, Stairs, Furniture, with their icons,
  shortcuts (1–6), footer hints and tray options. Preview's hotbar and catalog use the same icons.
- **Build panel + options trays**: a tile opens a tray over the canvas (Rooms: every type with its colour and default
  size; Walls; Door / Window; Straight staircase, with Lift shown as "Coming soon"; Furniture: search, categories and
  a grid, also draggable onto the view). Picking closes the tray; the tile shows the choice ("Rooms · Office").
  Esc goes back to Select. Layers (bottom of the panel) lists everything on the floor; clicking one selects it
  and flies the camera to it. Below 1280 px the tiles become icon-only.
- **Canvas card**: 2D | 3D and Fit view in the corner; an empty state ("Build your workplace" → "Add your first room"
  opens the Rooms tray); labels on each room ("Office 1 · 6 × 4 m"); a **floating toolbar** above the selection
  (item: move, rotate, scale, duplicate, lock, delete; room: rename, change type, delete) that follows it and hides
  while the camera moves fast. Studio now uses the same sky, grass and paving as Preview; the grid shows only while
  a build tool is active (or with Settings → Show grid).
- **Inspector** (from `PropertiesInspector`, same edits and merge keys): editable name, Position, Rotation, Size
  (with keep proportions), Details (department, hook points, linked position); for rooms: type, width, depth, wall
  height, doors/windows. Duplicate / Lock / Delete at the bottom.
- **Header**: AHDUS (back to all layouts), breadcrumb with the layout name (click to rename; saved at once, not part
  of undo), save status, Undo / Redo (with "Nothing to undo" tooltips), Settings (snap and step, show grid,
  lighting Day / Evening / Night, units, FPS in development only).
- **Footer**: floor switcher ("Ground Floor · 3 rooms": switch, add floor above, rename, delete with a confirm step,
  undoable), the active tool's hint (problems in red, sizes while dragging), **Preview Workplace**.
- **Preview restyle** (`PlayHUD.jsx`, `src/ui/preview.css`): same tokens and icons, **Back to Studio** top left,
  the catalog (B) looks like the Furniture tray (search + categories).
- **The editor now opens in Workplace Studio** (it used to open in Build mode). Preview is one click (or Tab) away.
- **Removed**: `PlannerToolbar.jsx`, `RoomPanel.jsx`, `ObjectPanel.jsx`, `PropertiesInspector.jsx`, `FloorSelector.jsx`,
  the Rooms/Objects tabs, the gradient Play button, the status bar and the on-screen FPS text.
- **Tests**: every e2e script now selects controls by the labels in UI_SPEC section 7. `editor-smoke` became the
  Studio test (layout at both sizes, empty state → first room, selection toolbar + Inspector, floor switcher,
  Preview ↔ Studio) and saves `studio-empty.png`, `studio-tray-rooms.png`, `studio-selected.png`,
  `studio-floor-menu.png` and `preview-hud.png`.

### 3.11 Three bug fixes: opening layouts, saving, door sizes (14 Oct)

**1. Opening a saved layout showed a blank dark page.**
*Cause:* in development React runs the editor's effects twice (StrictMode: mount, unmount, mount). The first
unmount disposed the 3D scene but kept its room meshes in `roomMeshesRef`; the second mount found those dead meshes,
read `metadata._geometryKey` from them (null after dispose) and crashed. A new layout has no rooms yet, so only
reopening a saved one crashed. The saved data was fine all along.
*Fix:* the scene teardown clears the mesh maps, and the sync never reuses a disposed mesh. Loading now goes through
`normaliseLayout` (`src/store/layoutData.js`), which fills in what older saves lack (floors, elevations,
anchorData, door/window sizes, scale, ...). The editor is wrapped in `EditorErrorBoundary`: if anything fails it
shows "This layout could not be opened" with **Back to layouts** and logs the error. Never a blank page.

**2. Work not saved; every layout called "Untitled Layout v1".**
*What was really happening:* auto-save only watched rooms and objects, so adding/renaming floors and links to
positions were not saved until the next room change; nothing was saved when the tab was closed; and reopening
crashed (bug 1), which looked like lost work. A typed name **was** stored; "Untitled Layout" is the name when the
box is left empty, and "v1" was the version number, which never changes. If the dev server moved to port 3001
(3000 busy), the browser showed a different, empty set of layouts (localStorage is per port).
*Fix:* auto-save 1 s after any change to rooms, objects, floors or anchor data (so after every editorHistory
command, undo and redo), and at once on All layouts, Studio ↔ Preview and tab close / hide. The header shows
**Saving…**, **Saved** or **Not saved: reason** (e.g. browser storage full; the next change retries). The list is
built from the saved layouts themselves (entries without data are dropped) and shows "Edited 14 Oct, 10:42 ·
3 rooms · 2 floors". Back from the editor returns to that company's list. Deleting asks first. `vite.config.js`
has `strictPort: true`.

**3. Doors and windows had a fixed size.**
Every opening stores `width` and `height` (old saves get the defaults). The size maths is `resizeOpening` in
`geometry.js`: min width 0.6 m (door) / 0.4 m (window), min height 1.8 m / 0.4 m, at most the wall height − 0.1 m
(windows: sill + height), 0.1 m from each wall corner, 0.2 m from other openings, and a door keeps 0.5 m clear of
stairs. A door between two back-to-back rooms is resized in both. If a size is not allowed, the old size stays and
the reason is shown.
- **Preview:** the Edit item (slot 9) works on doors and windows: + / − width, Shift + / − height (0.1 m steps),
  0 standard size; the hint shows "Door 1.1 × 2.1 m". A burst of presses is one undo step. Each opening now has an
  invisible pane, so aiming through a doorway targets the door (not only its 7 cm frame).
- **Studio:** click a door or window to select it (in 2D, the wall over it). The Inspector shows width, height,
  room, wall, sill / shared room, Standard size and Delete; blue handles on its sides and top resize it by dragging
  (one undo step per drag). Works on upper floors; walls are rebuilt around the new size.
- New editorHistory action: `resizeOpening(list, { mergeKey })`.

---

## 4. Status against the plan

| Workstream | Status | Notes |
|---|---|---|
| **A. Engine / embeddable** | 🟡 Partly | Schema, migration, anchors, undo: done. `LayoutEngine` and the 6 systems are still stubs (45 TODOs); `WorkplaceEditor.jsx` is 1,348 lines and doesn't use the engine |
| **B. Replica-grade building** | 🟡 Partly | Rooms, Stretch, doors and windows in-world: done. Free-form walls with shared walls, floor-plan tracing, dimensions/measure tool, templates: not started |
| **C. Visual realism** | 🟡 Partly | Textured floors/walls/furniture, site, lighting, roofs, ceilings with lights: done. Real 3D models (GLB), post-processing: not done |
| **D. Floors, routes, safety** | 🟡 Partly | Stacked floors, slabs, walkable stairs with openings: done. Elevators, evacuation routes, safety checks: not done |
| **E. 2D floor plan (SVG)** | ❌ Not started | The "2D view" is still the 3D camera from above |
| **F. Saving, versions, sync** | 🟡 Local only | Reliable auto-save and reopening in browser localStorage (14 Oct); no backend, versions, conflict detection or change events yet |
| **Teammate integration** | ✅ In the editor | Bridge, saved hook points, real events, E actions, position links, demo modules. Still needed: embedding in Dhruv's app (Workstream A) |

---

## 5. What is left to do

### P0: next (most visible or blocking)

1. ~~Roofs~~ ✅ done (with ceilings and lights)
2. **Real 3D furniture models (GLB).** Replace the simple shapes with free CC0 models (Kenney, Quaternius, Poly Haven; check each licence). The loaders are already installed.
3. ~~E-to-interact events for the team~~ ✅ done (step 1)
4. ~~Anchors in the live editor~~ ✅ done (step 1)
5. ~~Stairs linking floors~~ ✅ done. **Elevators** still to do.

### P1: important

6. **Real backend and database.** Today all work is in browser localStorage: **clearing the browser deletes the layout**, and there is no login (anyone can open any company). Needs the database decision (section 7).
7. **Versioned saves:** save version, list, restore, and conflict detection when two people edit.
8. **Engine/UI split** (Workstream A): move scene setup and mesh syncing out of `WorkplaceEditor.jsx` into `LayoutEngine`, so Dhruv can embed `<LayoutEditor />` / `<LayoutViewer />`.
9. **Floor-plan tracing:** upload a floor-plan image, set the scale, build over it.
10. **Layout templates:** Small Office, Factory Floor, Clinic, etc.

### P2: later

11. Free-form wall drawing with **shared walls** (rooms are rectangles today; neighbouring rooms have two walls 15 cm apart).
12. Real **SVG 2D floor plan** with PNG/PDF export (also the mobile and accessibility view).
13. **Emergency exits and evacuation routes**, with warnings like "room has no door" or "exit blocked".
14. Dimension labels and a measure tool.
15. ~~Clean up the planner~~ ✅ done (14 Oct): the old Top/Left/Right/Bottom room buttons are gone; the Rooms panel has a **Draw room** button (the same tool as the left toolbar) and a one-click "+ Add" only on an empty floor.
16. Smaller bundle (the main file is ~1.6 MB; split Babylon into chunks).
17. Finish the TypeScript migration for the rest of the code.

### Known limitations in the current build

- Doors and windows can be resized but not slid along the wall yet; window sills stay at 0.9 m.
- **Stretching a wall that has a door shared with a neighbour** moves only this room's half; the neighbour keeps its door hole.
- **Stairs** are one straight flight of one storey. A staircase turned 45° cuts a larger, square opening.
- Stairs are always 4.0 m long, so on very tall floors (5–6 m) they get steep.
- Lowering a room's walls never lowers its floor (use "Floor height" in the floor menu).
- A roof that is only **partly** covered by the floor above is still shown and can poke slightly under the upper floor.
- When a room grows over furniture that was outside it, that furniture isn't reassigned to the room.
- The character is a placeholder until Harsh's character model replaces it (`character.js` defines the interface).
- Hotbar icons are emoji, not pictures of the models.
- On very slow computers (under ~4 fps) the character moves slower than normal.
- The project report still says "8 tables" but lists 7.

---

## 6. Team integration status

| Teammate | What they need from this module | Ready? |
|---|---|---|
| **Harsh** (characters, voice) | Seat, spawn, reception hook points; room events; the 3D scene | ✅ Ready: `getAnchors`, `anchorsChange`, `enterRoom`, `getScene`, E actions; swappable player character |
| **Karthik** (machine videos, files) | Machine hook points; E with the object ID | ✅ Ready: CNC machine and lathe added; E actions with `objectId` |
| **Yashashwi** (previous employee handover) | Desks linked to positions | ✅ Ready: positions dropdown in the planner, `setPositionRef`, E actions at linked desks |
| **Dhruv** (frontend) | An embeddable `<LayoutEditor />` with an API | ❌ The bridge works, but the editor is still a full-screen app |
| **Sunil & Kavyashree** (logins, sync, monitoring) | Activity events; versioned saves | 🟡 `interact`, `enterRoom`, `exitRoom` events ready; layout-edit events and versioned saves not yet |

---

## 7. Open decisions

- **Database:** ✅ decided: **Supabase** (PostgreSQL underneath, so the existing schema fits; can be self-hosted on the client's server).
- **Plug-in on the client company's own server:** this is a requirement, so the backend must be self-hostable (no dependence on one cloud service).
- **Roles:** Super Admin can hand tasks only to the next Admin. Layout editing permissions need to follow this.
- **Build mode vs planner:** keep both (Build mode for building, planner for precise work), or make Build mode the only editor?
- **3D model sources:** agree with the mentor on which free model libraries and licences are acceptable.

---

## 8. Suggested plan for the next two weeks

| Week | Work | Result to show |
|---|---|---|
| 1 | ✅ Team integration (done). Next: roofs; GLB models for desk, chair, monitor, meeting table, plant; share `TEAM_INTEGRATION.md` with the team | Buildings look real from outside; teammates start plugging in |
| 2 | Stairs between floors; start the backend once the database is decided; versioned saves | Walk between floors; work no longer lives only in the browser |

---

## 9. How to run and test

```bash
npm install
npm run dev              # opens in Workplace Studio at http://localhost:3000

npm test                 # 185 unit tests
npm run typecheck        # TypeScript check

# Browser tests (one-time setup: npx playwright install chromium), with npm run dev running:
npm run e2e:planner      # 29 Workplace Studio checks (+ UI_SPEC screenshots)
npm run e2e:play         # 19 Preview checks (slow without a graphics card)
npm run e2e:modules      # 17 team-integration checks (demo modules)
npm run e2e:building     # 27 multi-storey checks (floor heights, Page Up/Down, copy rooms)
npm run e2e:tools        # 41 checks: Studio mouse tools, door sizes + Preview Edit item
npm run e2e:save         # 19 checks: saving, reopening, layout list

# See the demo modules yourself: http://localhost:3000/?demoModules=1
```

---

## Appendix: new and changed files

| File | Purpose |
|---|---|
| `src/play/playController.js` | Build mode: camera, movement, all hotbar tools, Stretch |
| `src/play/geometry.js` | Pure maths: room corners, wall splitting, doors, neighbours, `stretchRoom` |
| `src/play/character.js` | Placeholder character with walk cycle |
| `src/play/hotbarItems.js` | Everything you can hold, default hotbar, catalog |
| `src/play/movement.js` | Collision-safe movement steps |
| `src/components/PlayHUD.jsx` | Preview screen: hotbar, crosshair, hints, catalog |
| `src/utils/materialLibrary.js` | Realistic textures drawn in code; shared materials |
| `src/utils/siteEnvironment.js` | Planner look vs Build mode look (sky, grass, paving) |
| `src/utils/roomBuilder.js` | Realistic rooms: floors, walls around openings, frames, glass |
| `src/store/editorHistory.js` | Every layout change goes through here (undoable) |
| `src/engine/model/*` | v2 schema, migration, anchors |
| `src/engine/commands/*` | Undo/redo commands with merging |
| `src/integration/layoutBridge.js` | How other modules connect (events, hook points, E actions) |
| `src/integration/anchorsFromStore.js` | Hook points for the live editor, with saved links |
| `src/integration/demoModules.js` | Fake teammate modules (`?demoModules=1`) |
| `docs/TEAM_INTEGRATION.md` | Guide for teammates, with a recipe for each |
| `src/play/building.js` | Multi-storey maths: floor heights and derived elevations, wall/floor height rules, stairs, openings, roofs, overhangs, where you stand |
| `src/utils/floorOutline.js` | Faint outline of the floor below while building on an upper floor |
| `src/planner/plannerTools.js` | Studio mouse tools: draw room / wall, door / window, drag a wall |
| `src/ui/*` | Workplace Studio: tokens, tool list, shell, header, Build panel + trays, canvas card, selection toolbar, Inspector, footer, Preview styles |
| `src/utils/buildPreview.js` | Blue/red build previews shared by both modes |
| `src/utils/pickHelpers.js` | Forgiving picks (floor under a desk = the desk) |
| `src/store/layoutData.js` | Old saves → current shape; layout list summary |
| `src/ui/EditorErrorBoundary.jsx` | "This layout could not be opened" instead of a blank page |
| `e2e/*.mjs` | Browser tests |
| Removed: `WalkthroughHUD.jsx`, `walkthroughCamera.js` | Replaced by Build mode |
| Removed: `PlannerToolbar.jsx`, `RoomPanel.jsx`, `ObjectPanel.jsx`, `PropertiesInspector.jsx`, `FloorSelector.jsx` | Replaced by Workplace Studio (`src/ui/`) |
