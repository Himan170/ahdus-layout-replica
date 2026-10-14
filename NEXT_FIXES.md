# Next fixes: review of 15 Oct 2026

**For Claude Code.** An independent review of the project as of 15 Oct. Work through Part A in order. For each item:
reproduce it first, fix the cause, add the test named, run `npm test` + the e2e script for that area, and tell Himan
the cause in 1–2 simple sentences. Follow `CLAUDE.md` (editorHistory, undo, all floors, old saves still load).
When Part A is done, update `CLAUDE.md` (known limitations, test counts) and `docs/PROGRESS_REPORT.md`, then stop
and ask Himan which Part C feature to start.

**State at review time:**
- 185/185 unit tests pass, along with `typecheck` and `build`.
- e2e: 151 of 152 checks pass (save 19/19, Studio 29/29, building 26/27, tools 41/41, play 19/19, modules 17/17).
- The reviewer also ran extra browser probes; the results are below.

---

## Part A: bugs (confirmed by running the app)

### A1. Deleting the Ground Floor breaks the building (data changes on reopen)
**Repro:**
1. Add Floor 1 and build a room on it.
2. Delete the Ground Floor (the floor menu allows it).
3. The room drops to y = 0, because Floor 1 is now the lowest floor.
4. Go back to the layouts list and reopen the layout. `normaliseLayout` adds a new empty "Ground Floor" (id 0), and the room
   jumps back up to 3.5 m and floats.

Many places also fall back to floor `0` (`?? 0`, `currentFloor: 0`).

**Fix:** the ground floor (the lowest floor) can't be deleted:
- Disable its Delete button with the tooltip "The ground floor can't be deleted. Remove its rooms instead".
- Guard `editorHistory.removeFloor` as well.

`normaliseLayout` must not invent floor 0 when a save has other floors but no floor 0. Instead, renumber them so the
lowest floor becomes 0 and keep their order, updating the rooms' and objects' `floor` and the anchorData keys if needed.

**Tests:**
- unit: removeFloor refuses the lowest floor
- unit: normaliseLayout on a save with only floor 1
- e2e: the Delete button is disabled on the Ground Floor

### A2. Two tabs on the same layout silently lose work
**Repro:**
1. Open the same layout in two tabs.
2. Add a room in tab A and wait for "Saved".
3. Add a room in tab B.

The saved layout now has only tab B's room, and tab A's room is gone without any warning. Two people on one PC, or one
person with two tabs, will lose work this way, and the same problem will come back with Supabase.

**Fix:**
- Store a `revision` number in every save and keep the revision that was loaded.
- Before writing, re-read the stored revision. If it is newer than ours, don't overwrite. Show "This layout was changed
  in another tab" with **Reload** (load theirs) or **Save mine as a copy**.
- Listen to the `storage` event (and/or a `BroadcastChannel`): when another tab saves the open layout, show the same
  message at once.
- Opening a layout that is already open in another tab shows a small banner: "Also open in another tab".

**Test:** a new e2e step in `save-smoke`, using two pages in one browser context.

### A3. Undo of a + / − burst depends on the computer's speed
`CommandHistory` merges commands only within **800 ms of wall-clock time**. On a slow PC (and in the e2e run), a
burst of 8 presses becomes several undo steps. This is the one failing check: building-smoke "Ctrl+Z undoes the
whole burst of + in one step".

**Fix:** merge consecutive commands that have the same `mergeKey` and target when no other command came between them.
The burst ends when the target or tool changes, the mouse is released, or after 2 s without a key press (measured from
the key events, not from when the rebuild finishes).

**Tests:**
- unit, with a fake clock: slow presses still merge, and another command in between splits the burst
- e2e: the building-smoke check passes

### A4. Big buildings will be slow: far too many meshes and draw calls
**Probe:** 3 floors × 24 rooms with doors and windows, plus 864 chairs, desks and plants.

| Measure | Value |
|---|---|
| Meshes | 8,419 (2,402 enabled) |
| Materials | 249 |
| Active meshes | 788 |
| Babylon's draw-call counter | ~9,900 |

Every furniture part is its own mesh, and every part casts a shadow. A real company with 300 desks will stutter on a
normal laptop. `performanceOptimiser.optimiseObjectInstances` exists but is never called.

**Fix:**
1. Build each asset type once as a template: merge its parts per material (`Mesh.MergeMeshes` with
   `multiMultiMaterials`), then place copies with **instances** (or thin instances). Selection, picking, the lock
   overlay and `metadata.objectId` must keep working, and so must removing a single item.
2. Merge the static parts of each room by material: floor pieces, wall pieces, skirting and frames.
3. Freeze world matrices of things that don't move, and turn shadows off for small items (plants, monitors, chairs).
4. Don't rebuild unchanged rooms when one room changes. Check that `roomGeometryKey` covers this.

**Target:** with the probe building, ≤ 1,500 draw calls and ≤ 2,000 meshes, with every e2e check still passing.

**Test:** a new `e2e/perf-smoke.mjs` that builds the probe building through the store and asserts mesh and draw-call
counts (not fps; the CI machine has no GPU).

### A5. Object and room IDs will collide once there is a database
IDs are counters (`obj_12`, `room_3`) per browser session. With two tabs, two people or Supabase, two new desks can
get the same ID. Anchor IDs are derived from the object ID, so teammates' links would break.

**Fix:**
- New rooms and objects get UUIDs (`uuid` v4, already a dependency).
- Existing IDs stay as they are, so old saves and anchors keep working.
- Keep `claimObjectId` for loading.

**Test:** unit: new IDs are unique across two simulated sessions, and old IDs load unchanged.

### A6. No backup: everything lives only in this browser
A layout with 24 rooms and 288 items is ~85 KB, and the browser allows about 5 MB for **all** layouts together.
Clearing the browser deletes everything.

**Fix, until Supabase:**
- Add **Export layout** (downloads `<name>.ahdus.json`) and **Import layout** (adds it to the list) on the layouts
  screen and in Studio's Settings.
- Import goes through `normaliseLayout`.
- When storage is nearly full, show a clear message asking the user to export and delete old layouts.

**Test:** an e2e round trip: export, delete, import, and the room is back.

### A7. The company and layout screen still has the old look
`CompanySelector.jsx` uses old inline styles and emoji (🏢), so it doesn't match Workplace Studio.

**Fix:**
- Restyle it with `theme.css` tokens and lucide icons, using the same card style as Studio.
- Add **rename** and **delete** for companies. Delete asks for confirmation and also deletes that company's layouts.
- Keep the aria-labels the e2e scripts use.

### A8. Clean-up
- Remove the files that shouldn't be in the project root: `dist/` (build output), `p1-room-preview.png` and
  `e2e/last-run.png`.
- `src/engine/` has 45 TODO stubs that the editor doesn't use. Don't delete them, but add a short note at the top of
  `LayoutEngine.ts` saying which parts are real.
- `uuid@9` is deprecated: update to `uuid@11` and check that anchor IDs stay identical (uuid v5 must give the same IDs).
  Add a unit test with a fixed known ID.

---

## Part B: for Himan (not code)

1. **Use git.** The project has no version control, so one bad change can't be undone.
   - Run `git init`, commit, and push to a **private** GitHub repo.
   - Claude Code can do this: "set up git for this project, make a first commit".
   - After every working step, ask Claude Code to commit.
2. **Don't send zips with `node_modules`.** It is 239 MB and the next PC will reinstall it anyway. Share the GitHub
   link, or zip without `node_modules` and `dist`.
3. **Test on a normal laptop** with 50+ rooms after A4, and send the FPS from Settings.

---

## Part C: next features (Himan picks the order)

| Feature | Why it matters |
|---|---|
| Real 3D furniture (GLB, e.g. the Kenney Furniture Kit, CC0) | The biggest jump in realism. Needs A4's template and instance system first |
| Measure tool and dimension lines | A replica has to match real sizes; this is also how a company checks it |
| Shared walls and L-shaped rooms | Back-to-back rooms currently have two walls 15 cm apart |
| Real 2D floor plan (SVG) with PDF/PNG export | What managers print and share |
| Templates (small office, factory floor, clinic) | A new company gets a building in one click |
| Lifts | Needed for buildings with many floors |
| Supabase backend | Login, shared layouts and versions. Replaces A2's tab check with real conflict handling |
