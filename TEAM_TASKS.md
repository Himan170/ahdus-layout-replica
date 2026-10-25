# AHDUS Layout Replica: 3D Model Team Task Plan

**Team:** Himan (lead), Roshan, Anish, Anshu
**Module:** Digital Workplace Engine + Environment Editor (SRD sections 6 and 7)
**Repo:** `Himan170/ahdus-layout-replica`
**Last updated:** 25 October 2026 (v0.6.0)

---

## 1. Where we are now

| Done | Where it lives |
|---|---|
| Editable 3D workplace: rooms, floors, stairs, doors, windows, furniture | `src/components/WorkplaceEditor.jsx`, `src/play/`, `src/utils/` |
| Move, rotate, resize, duplicate, lock, delete, all undoable | `src/store/editorHistory.js`, `src/engine/commands/` |
| Layout v2 schema (Zod) and v1 to v2 migration | `src/engine/model/` |
| Anchors (`seat`, `workstation`, `reception`, `spawn`, `machine`) and `layoutBridge` | `src/engine/model/anchors.ts`, `src/integration/layoutBridge.js` |
| Auto-save, export/import, two-tab protection, UUID IDs | `src/services/apiService.js`, `src/store/` |
| Big buildings draw cheaply (mesh instancing) | `src/utils/assetInstances.js` |
| Workplace Studio UI, new companies/layouts screen | `src/ui/`, `src/components/CompanySelector.jsx` |
| Shared walls and rooms inside rooms (A1, Anish + Himan, v0.3.0) | `src/play/geometry.js`, `docs/ROOM_FORMAT.md` |
| Embeddable engine: `<LayoutViewer />`, `<LayoutEditor />`, the one-file embed for plain HTML pages (H2) | `src/engine/`, `src/embed/`, `docs/LAYOUT_ENGINE_API.md`, `docs/EMBED_GUIDE.md` |
| Realistic look: Kenney GLB furniture, photo textures, HDRI sky (A6, Himan) | `src/utils/modelRegistry.js`, `src/utils/modelLoader.js`, `public/assets/` |
| Floor plan export as PNG / PDF (S2, Anish) | `src/utils/floorPlanExporter.js`, `src/ui/ExportMenu.jsx` |
| Backend decision, schema, audit log (R1, R3, R5, Roshan) | `docs/decisions/001-backend.md`, `db/schema.sql` |
| Offline save queue, photo reconstruction plumbing (R7, R8, Roshan) | `src/services/syncQueue.js`, `src/services/reconstructionService.js`, `src/ui/ProposedLayoutBanner.jsx` |
| CI on every pull request (lint, typecheck, unit tests, both builds) + nightly browser tests | `.github/workflows/` |
| 436 unit tests (26 files) and 265 browser checks in 11 scripts (`e2e/`) | `npm test`, `npm run e2e:...` |

## 2. What is left (from the SRD)

1. A real 2D floor plan. The "2D" view today is only the 3D camera from above (PNG / PDF export exists: S2).
2. The real backend wired in: saving is still `localStorage`. Supabase is chosen and the schema is written; it waits for the Login team's logins and tenants.
3. Workplace version history (R4).
4. Elevators, emergency exits and accessible routes. `RouteSchema` exists, but nothing draws or edits routes.
5. Accessibility: keyboard use, screen reader, audio descriptions, route information.
6. Realism: L-shaped rooms, measure tool, industrial machine models.
7. Templates (small office, factory, clinic).

**Waits for integration** (with the Login team's roles and tenants): R2, R4 (server part), R6, H3.

---

## 3. Who does what (summary)

| Person | Main area | Task IDs |
|---|---|---|
| **Himan** | Lead, embeddable engine, integration with the other 4 teams, reviews | H1 to H7 |
| **Roshan** | Backend, tenant isolation, version history, tests for tenant security | R1 to R8 |
| **Anish** | Building geometry (walls, rooms), lifts, exits and routes, measure tool, GLB furniture | A1 to A7 |
| **Anshu** | 2D floor plan, accessibility, templates, UI polish | S1 to S6 |

**Now (from 25 October):**

| Person | Next | Then |
|---|---|---|
| **Anish** | A3 lifts | A4 exits and routes |
| **Anshu** | S1 real 2D plan (reuse the drawing in `src/utils/floorPlanExporter.js`) | S4 templates |
| **Roshan** | R4 groundwork: version history kept locally, built so it can move to the server later | The nightly browser tests workflow (`.github/workflows/e2e-nightly.yml`): make it reliable, add more scripts |
| **Himan** | Reviews, H4 support for the other teams, H7 | H6 demo |

Each task lists **what to build**, **files to start in**, and **done when**. A task is only finished when its "done when" is true and a pull request is merged.

---

## 4. Himan (lead)

### H1. Get the team working (Day 1)
- [x] Run `git push origin main` (10 commits are not on GitHub yet).
- [ ] Add Roshan, Anish and Anshu as collaborators (GitHub, Settings, Collaborators).
- [ ] Turn on branch protection for `main`: pull request required, no direct pushes, the "CI checks" check must pass.
- [x] Add a "Getting started" section to `README.md`: `git clone`, `npm ci`, `npm run dev`, `npm test`, `npm run e2e`. Tell people **not to zip `node_modules`**, because the Windows-installed copy does not run on other machines.
- **Done when:** all three can clone, run the app and see the tests pass.

### H2. Embeddable engine (the main task) ✅ done
- [x] Implement the stubs in `src/engine/LayoutEngine.ts`: `setFloor`, `setView`, `focusOn`, `highlight`, `clearHighlights`, `setMode`.
- [x] Move the rendering of rooms and objects into `src/engine/systems/` so the engine can draw a layout without the editor UI.
- [x] Build `<LayoutViewer />` (read-only, orbit) and `<LayoutEditor />`, both taking `layoutId`, `mode` (`edit`, `view`, `walkthrough`) and `quality` (`high`, `low`).
  (Done 22 Oct 2026: they take a `layout` prop, or `companyId` + `layoutId`; `viewer.html` + `e2e/viewer-smoke.mjs`. H3's test is in `LayoutEngine.test.ts`.)
- **Files:** `src/engine/LayoutEngine.ts`, `src/engine/systems/*`, `src/components/WorkplaceEditor.jsx`, `docs/LAYOUT_ENGINE_API.md`.
- **Done when:** a blank test page can mount `<LayoutViewer layoutId="..." mode="walkthrough" />` and walk around, with no editor UI loaded. `LAYOUT_ENGINE_API.md` shows ✅ for these rows.

### H3. Role-based mode with the Login team ⏳ waits for integration
- [ ] The engine takes its mode from outside (admin gets `edit`, employee gets `walkthrough`). In `view` and `walkthrough` mode, no command can change the layout.
  (The engine part is ready: outside `edit` mode every command answers `READ_ONLY`. What is left is taking the mode from the Login team's roles.)
- **Done when:** a test proves that in `walkthrough` mode every edit command is rejected.

### H4. Support the other four teams
- [ ] Keep `docs/TEAM_INTEGRATION.md` correct (Character, Handover, Login, AI/ML).
- [ ] Build a small demo page that lists every anchor and shows `interact`, `enterRoom`, `exitRoom` events live, so other teams can see the bridge working.
- [ ] Hold a fixed weekly 30-minute sync with the other team leads.
- **Done when:** each other team has connected to `layoutBridge` once, and any problems they found are logged.

### H5. Review and merge
- [ ] Review every pull request within 24 hours. Himan's own pull requests are reviewed by Roshan.
- [ ] Keep `docs/PROGRESS_REPORT.md` and `CLAUDE.md` up to date after each merge.

### H6. First gate demo (SRD section 33)
- [ ] Prepare the 3D part of the demo journey: company creation, digital workplace, employee characters, HR explanation, knowledge, training, completion, employee replacement. Record a screen demo.

### H7. Low-quality mode 🟡 partly done
- [ ] With Anish: `quality="low"` for phones and weak GPUs (fewer lights and shadows, simpler models, fixed distance culling).
  (Done so far: `quality: 'low'` on `LayoutEngine`, `<LayoutViewer />` and the embed turns the realistic look off, so items use the simple models and rooms the simple materials. Left: fewer lights and shadows, distance culling, the perf check.)
- **Done when:** a big test building keeps a playable frame rate in low mode (add to `e2e/perf-smoke.mjs`).

---

## 5. Roshan (backend and security)

### R1. Pick the backend (Week 1) ✅ done
- [x] Decide with the **Login team** which backend the whole project uses (Supabase or your own Postgres). One backend for all teams.
- [x] Write the decision in `docs/decisions/001-backend.md` (what, why, alternatives). Decided: Supabase.

### R2. Replace `localStorage` with the real backend ✅ prototype (off by default)
- [x] Keep the same function names in `src/services/apiService.js` (save, load, list, delete, export, import) so the rest of the app does not change.
- [x] Keep `localStorage` as an offline cache and fallback.
- [x] Move the two-tab `revision` check to the server (compare-and-set on a `revision` column).
- **Files:** `src/services/apiService.js`, `src/store/workspaceStore.js`.
- **Done when:** `e2e/save-smoke.mjs` passes against the real backend, and a conflict between two sessions still shows the "changed in another tab" message.
- **Status:** the browser-side Supabase path is a PROTOTYPE, OFF unless `VITE_LAYOUT_BACKEND=supabase` (`.env.example`). Production saving goes through the platform API with the tenant from the server session, never a `company_id` sent by the browser.

### R3. Schema aligned with layout v2 ✅ done
- [x] Update `db/schema.sql` for floors, anchors, routes and floor links (stairs and lifts).
- [x] Every table has a `company_id` (tenant). Tenant is read from the logged-in user on the server, **never** from the client.
- [x] Row-level security policies for each table.
- **Done when:** a fresh database built from `schema.sql` can store and return a full layout round trip.

### R4. Version history ✅ done
- [x] Groundwork now: versions kept in the browser (list, restore, who and when), behind the same functions the server will answer later.
- [x] Write a row to `layout_versions` on save (an auto checkpoint at most every 10 minutes of editing, plus a manual "Save version"; at most 20 auto + 30 named per layout).
- [x] API: list versions, restore a version, show who and when.
- [x] A small "Version history" list in the Studio header menu (Anshu styles it).
- **Done when:** you can restore an old version, and undo history still works after restoring.

### R5. Object identity and change log ✅ done
- [x] Keep each object's UUID stable across versions.
- [x] Record "who changed what, when" for rooms and objects (audit log).

### R6. Cross-tenant tests (release blocker, SRD section 15) ⏳ waits for integration
- [ ] Automated tests: a user from Company A cannot read, write or list Company B's layouts, versions or assets, by any normal route or by guessing IDs.
- **Done when:** the tests run in CI (`npm test`) and fail if any row-level security rule is removed.

### R7. Sync (V1, later) ✅ done
- [x] Offline queue, retry, conflict detection. Reuse the existing `TabNotice` conflict UI.

### R8. Photo reconstruction plumbing (V1, later, with AI/ML) ✅ done
- [x] Upload a photo, store it tenant-scoped, send it to the AI/ML team's analysis, store the result as a **proposed** layout that a human approves in the editor (SRD: AI output is never trusted blindly).

---

## 6. Anish (building geometry and 3D assets)

### A1. Shared walls (start with a written format) ✅ done (v0.3.0, plus rooms inside rooms)
- [x] First write down the new room format in `docs/ROOM_FORMAT.md` and get Himan's approval. Anshu's floor plan and Roshan's database both read this data.
- [x] Neighbouring rooms share one wall instead of two walls about 15 cm apart.
- [x] Old saves must still load (shared walls are worked out from the room rectangles, so nothing new is saved).
- **Files:** `src/play/geometry.js` (1,205 lines), `src/play/building.js`, `src/utils/roomBuilder.js`.

### A2. L-shaped and non-rectangular rooms
- [ ] Rooms with more than four corners: draw, edit, door placement, floor and ceiling.
- **Done when:** an L-shaped room can be built, saved, reloaded and walked through.

### A3. Elevators (lifts) ▶ Anish, next
- [ ] Add elevators as floor links (stairs already exist; see `FloorLink` in `src/engine/model/schema.ts`).
- [ ] Walkthrough: enter the lift, choose a floor, arrive on that floor.

### A4. Emergency exits and routes ▶ Anish, after A3
- [ ] Place exit doors and exit-sign objects.
- [ ] Draw and edit `evacuation` and `accessible` routes (`RouteSchema` exists but nothing uses it).
- [ ] Let the admin configure the number and type of access routes for a room (SRD section 7).
- **Done when:** a route can be drawn on a floor, saved and shown again after reload.

### A5. Measure tool
- [ ] Click two points to show the distance in metres. Show wall lengths and room area.

### A6. Real 3D furniture (GLB) ✅ done (Himan: the realistic look, v0.6.0)
- [x] Load models with `@babylonjs/loaders`.
- [x] Replace the box furniture for the most-used items (27 item types have a Kenney model) using the instancing in `src/utils/assetInstances.js` so performance stays good.
- [x] Use only free-to-use models (CC0: Kenney), and record each model's licence in `docs/ASSET_LICENSES.md`.
- [x] Keep file size small and fall back to the old box if a model fails to load.
- **Done when:** `e2e/perf-smoke.mjs` still passes with models in the big test building.

### A7. Tests
- [ ] Every task above adds vitest unit tests, and an `e2e/` check where it changes what the user sees.

---

## 7. Anshu (2D, accessibility, templates, UI)

### S1. Real 2D floor plan ✅ done (25 Oct 2026)
- [x] **Step 1 (Anshu):** an **SVG** plan of the current floor (`src/floorplan/FloorPlanView.jsx`, maths in `src/floorplan/planMath.js`): rooms with names and sizes, walls with doors (and their swing) and windows from the room data, free-standing walls, items. It follows the floor switcher.
- [x] Select (click, or Tab + Enter), move (Studio's snap step, locked items stay, table tops, one undo step per drag) and rotate 90° through `editorHistory.js`, so undo works.
- [x] The toggle: **"Plan"**, a third option in the canvas card's view control (2D | 3D | Plan), not a second switch in the header.
- [x] **Step 2 (Anshu):** interactive pan and cursor-invariant zoom, module anchors visualization (workstations, seats, reception, machines, spawn, info points), toggleable architectural dimension lines, angle rotation (+45° & 90°), routes, mobile responsive layout.
- **Files:** `src/floorplan/`, `src/ui/studio.css`, `src/components/WorkplaceEditor.jsx`.
- **Done when:** the 2D view works on a phone-sized screen and stays smooth on a big building.

### S2. Export the plan ✅ done (Anish)
- [x] Export the 2D plan as PNG and PDF (in the browser, no server needed). Studio's "Export floor plan" button.

### S3. Accessibility (SRD section 18) ✅ done (25 Oct 2026)
- [x] Keyboard use for the editor and training views: Tab order, arrow keys to nudge/move selected object (snap step, Shift 1.0m, Alt 0.05m; undoable in `WorkplaceEditor.jsx`), visible focus rings.
- [x] Screen reader: ARIA polite live region announcing object/room selection and movements (`WorkplaceEditor.jsx`), and semantic list/outline hierarchy in Layers view (`Inspector.jsx`).
- [x] Audio description: `describeRoom`, `describeObject`, and `describeAccessibilityRoutes` (`src/utils/accessibleSummary.js`) with Web Speech API read-aloud toggle in the Inspector header.
- [x] Accessible route summary in Layers panel describing single vs multi-floor navigation and vertical access (stairs, elevators).
- [x] Contrast, visible focus (`:focus-visible`), and reduced-motion checks (`@media (prefers-reduced-motion: reduce)` in `studio.css`).

### S4. Templates
- [ ] Layout templates: Small Office, Factory Floor, Medical Clinic.
- [ ] A template picker with card previews, room/item statistics, and blank start option when creating a new layout in `CompanySelector.jsx`.

### S5. UI for new features
- [ ] Style Roshan's version history list, Anish's route panel and measure tool using `UI_SPEC.md` and `src/ui/theme.css`.

### S6. Mobile pass
- [ ] Check the Studio screens at phone width and fix layout problems.

---

## 8. Order of work

| Phase | When | Focus |
|---|---|---|
| **0: Setup** | Days 1 to 2 | H1. Everyone clones, runs the app and reads `CLAUDE.md`. |
| **1: Foundations** | Weeks 1 to 2 | H2 starts. R1 to R3. A1 (written format first). S1 step 1 (read-only 2D), S3 starts. |
| **2: Features** | Weeks 3 to 4 | H3, H7. R4 to R6. A2 to A5. S1 step 2, S2, S3, S4. |
| **3: Polish and integration** | Weeks 5 to 6 | A6 (GLB). R7, R8. S5, S6. H4 and H6 (demo), with the other teams. |

Change the weeks to fit your real deadline. If time is short, cut in this order: R7, R8, A6, S4.

## 9. Dependencies

| Task | Waits for |
|---|---|
| S1 (floor plan) and R3 (schema) | **A1**: they read the new room format |
| A6 (GLB) | Existing `assetInstances.js` (done) |
| S3 route text | A3 and A4 |
| S5 version panel | R4 |
| H3 | Login team's role system |
| R2 | R1 (backend decision) |

## 10. Cross-team connections

| Team | They use | Owner on our side |
|---|---|---|
| Character (Harsh, Aditya, Manashri) | `seat`, `workstation`, `reception`, `spawn` anchors; `src/play/character.js` is only a placeholder | Himan |
| Handover (Yashashwi, Mangali, Bhumi, Aman) | `workstation` anchors and `positionRef` | Himan |
| Login (Sunil, Sahil, Manish) | Roles, tenant ID, access codes | Roshan (backend), Himan (modes) |
| AI/ML (Karthik, Pratham, Dinesh) | `machine` anchors and `objectId`; photo reconstruction | Himan, Roshan (R8) |

## 11. Rules for everyone

1. **One branch per task**, named `name/short-topic` (for example `anish/shared-walls`). Never push to `main`.
2. **Small pull requests.** Himan reviews. Himan's own pull requests are reviewed by Roshan.
3. **Before every pull request:** run `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`, and the matching `npm run e2e:...` script. CI runs the first four (and `build:embed`) on every pull request; it must be green before merging.
4. **Follow `CLAUDE.md`:** every layout change goes through `editorHistory.js` (so it stays undoable), works on all floors, and old saves must still load.
5. **Tell the group before editing a hot file:** `WorkplaceEditor.jsx` (1,538 lines), `playController.js` (1,419 lines), `geometry.js` (1,205 lines), `workspaceStore.js`, `editorHistory.js`. These cause the most merge conflicts.
6. **Pull `main` every morning** and rebase before opening a pull request.
7. **Commit messages** use the repo style: `Add: ...`, `Fix: ...`.
8. **Never commit `node_modules`** or send it in a zip.
9. Do not change the room data format, layout schema or tenant rules without writing it in `docs/` and getting Himan's approval.

## 12. Definition of done (whole module)

- [x] `<LayoutViewer />` and `<LayoutEditor />` work in a blank test page.
- [ ] Layouts save to the real backend, with version history and restore.
- [ ] Cross-tenant tests pass.
- [ ] 2D floor plan works on a phone and exports PNG/PDF.
- [ ] Lifts, exits and routes can be built and shown.
- [ ] Keyboard, screen-reader and audio-description support exist for the core flows.
- [ ] At least 3 templates and real 3D furniture for the common items.
- [ ] Old saves still load, `npm test` and `npm run e2e` pass.
- [ ] The other four teams are connected through `layoutBridge`, and the demo runs end to end.
