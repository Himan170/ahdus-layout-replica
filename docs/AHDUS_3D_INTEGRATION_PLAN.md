# AHDUS: Connecting the 3D Workplace to the AI Training Platform

**Owner:** Himan (3D Workplace / Company Layout Replica)
**For:** Himan, the AI Training Platform lead (RUSBORN), Roshan, Harsh, Dhruv
**Date:** 22 Oct 2026 (updated with Himan's answers; Himan is now a collaborator on the Training Platform repo)
**Status:** plan, not yet agreed. Section 3 needs sign-off from the Training Platform lead.

---

## 1. The short answer

**We don't have to wait for the 3D model to be finished.**

You can start integrating while the model is still growing, because the parts other teams connect to are already stable:

| Stable now (safe to build on) | Still changing (other teams don't touch) |
|---|---|
| How the 3D view is put on a page (`<LayoutViewer />`, one `mount()` call) | How rooms, walls, stairs and furniture look |
| The IDs of layouts, floors, rooms and anchors (UUIDs that never change) | New features: L-shaped rooms, lifts, GLB furniture, 2D plan |
| The modes: `edit`, `view`, `walkthrough` | Performance and quality settings |
| `layoutBridge`: events (`interact`, `enterRoom`, `exitRoom`), anchors, "Press E" actions | |
| The saved layout format (versioned; old saves are migrated automatically) | |

New features in the model only add to the left-hand side. They don't break it. Every improvement to the 3D model then appears inside the Training Platform automatically, without changes on their side.

**So integrate the "plug" now, using a sample layout, and keep improving the model behind it.**

---

## 2. What each side has today

### 2.1 AI Training Platform (RUSBORN repo)
- **Backend:** Python FastAPI on port 8000. **Frontend:** plain HTML/CSS/JS served on port 3000 by `tools/serve_company_twin.py`, with no React and no build step.
- **One shared Supabase project** for login and data. The **server** decides roles (`ADMIN`, `HR`, `EMPLOYEE`, `VIEWER`, plus platform Super Admin); the browser never decides permissions.
- **Session and permission checks already exist** (`backend/auth/phase2_runtime.py`):
  - `GET /phase2/session?organization_id=<uuid>` with the Supabase login token in the `Authorization` header returns `{ allowed, organization_id, employee_id, system_role, department_scope, platform_administrator, … }`.
  - `POST /phase2/access` checks one **capability** on one resource. The capabilities are named like `training.view`, `training.manage`, `character.view`, `character.edit` and `organization.manage`; there are no workplace ones yet.
- **Existing identity tables:** `organizations` (UUID), `organization_memberships`, `employees` (bigint ID), `departments`, `positions` (UUID), `employee_assignments`.
- **Database access is server-only** (migration 014). Modules go through the FastAPI backend and never talk to the database straight from the browser.
- **`3d-model.html` ("3D Company")** is a **placeholder**: a fake building picture and a floor list that does nothing. Every page's menu already links to it. Their docs say this page and the Workplace module belong to Himan, and they are waiting for "Himan's workplace/location IDs".
- Their API plan (`docs/API_MAP.md`) proposes `GET /api/v1/workplace` and location/asset endpoints for this page. **These don't exist yet.**
- **Character:** no code yet. Every `character/` folder is a placeholder README. Harsh's work is not in this repo.

### 2.2 Our 3D Workplace (ahdus-layout-replica)
- React + Babylon.js + Vite. **Workplace Studio** (editor) and **Preview** (walk-around).
- **Embeddable engine done (H2, v0.4.0):** `<LayoutViewer mode="view|walkthrough" />` and `<LayoutEditor />`. Each loads a layout from JSON and has no Studio code inside the viewer.
- **`layoutBridge`:** the public API other modules use to get anchors and events. Documented in `docs/TEAM_INTEGRATION.md`.
- **Saving:** browser localStorage for now. Export and import of `.ahdus.json` files works.
- **Database:** Roshan's `db/schema.sql` (Supabase). **It needs reworking, see section 5.**

---

## 3. The contract (agree this first, before coding)

This is the one thing both teams must agree. After that, each side works independently.

### 3.1 IDs we share

| What | ID | Owned by | Notes |
|---|---|---|---|
| Company | `organizations.id` (UUID) | Training Platform | We never create our own company table |
| User / role | `GET /phase2/session` (`system_role`, `organization_id`, `employee_id`) | Training Platform | We only read it, through the server |
| Position (job seat) | `positions.id` (UUID) | Training Platform | Stored on a desk anchor as `positionRef` |
| Training video / assessment | their IDs (to confirm) | Training Platform | Linked to a machine or room anchor (section 6, step 6) |
| Layout (site) | `layout_id` (UUID) | 3D Workplace | **Several per company** (HQ, factory, branch), together they are the company's digital twin |
| Floor | `floor.id` (`0` = ground, `1`, `2`, …) | 3D Workplace | Unique inside a layout |
| Room | `room_<uuid>` | 3D Workplace | Never changes once created |
| Item (desk, machine) | `obj_<uuid>` | 3D Workplace | Never changes once created |
| Anchor (hook point) | uuid v5 of item ID + kind | 3D Workplace | Stable forever; safe to store in their tables |

### 3.2 Units and coordinates
- Metres. `y` is up. Each floor's height is stored; elevation is worked out from the floors below.
- Positions given to other modules (anchors, the player) are **world positions**.

### 3.3 Roles → 3D mode

**Decided (Himan, 22 Oct):** editing is a **permission the admin gives**, not a fixed role. An admin can let any person edit the workplace.

| Who | 3D mode | What they can do |
|---|---|---|
| `SUPER_ADMIN` / `ADMIN` | `edit` | Build and change layouts, and **give or take away** the "Edit workplace" permission |
| Anyone the admin gave **"Edit workplace"** | `edit` | Build and change layouts |
| Everyone else in the company (`EMPLOYEE`) | `walkthrough` | Walk around, press E, cannot change anything |
| Not logged in / other company | nothing shown | "Please log in" / not found |

- The permission is stored **in their system**, as a capability on the membership (for example `workplace.edit`), next to their other permissions. We don't keep our own list of editors.
- The **server** decides. It sends `mode` (or the capability) to the page, and the save API checks it again on every save. Our viewer only receives `mode`. A test already proves every edit is refused in `walkthrough` mode.
- Later, if needed, the permission can be limited to one site or one floor (`workplace.edit` + `layout_id`). Not needed for the first version.

### 3.4 Events their modules can use (already working)
- `interact`: the user pressed E on an item or anchor (machine, desk, reception).
- `enterRoom` / `exitRoom`: the user walked into or out of a room.
- `registerAction(kind or id, { label, run })` adds a "Press E" action, for example "E · Watch CNC training video".
- `anchors({ kind, roomId, floorId })` lists hook points, for example every workstation on Floor 1.

### 3.5 API endpoints (for the Training Platform backend)

Proposed, to be built in their FastAPI app, with all paths starting with `/api/v1`:

| Method | Path | Capability | What |
|---|---|---|---|
| GET | `/workplace/layouts` | `workplace.view` | All sites of my organization (name, floors, last edit) |
| GET | `/workplace/layouts/{id}` | `workplace.view` | One site's whole layout JSON (our v2 format) |
| POST | `/workplace/layouts` | `workplace.edit` | New site (for example "Pune factory") |
| PUT | `/workplace/layouts/{id}` | `workplace.edit` | Save the whole site; body has `expected_revision`; `409` if someone else saved first |
| GET / POST / DELETE | `/workplace/editors` | `organization.manage` (admin) | List, grant and remove the `workplace.edit` permission |
| GET | `/workplace/layouts/{id}/versions` | `workplace.edit` | Version history (later, R4) |

**Several sites in one digital twin:** the "3D Company" page shows a site picker (HQ, factory, branch). Each site is its own layout with its own floors. Sites never share rooms, so each one loads and saves on its own and stays fast.

**Who builds these endpoints:** not decided yet. It's either Roshan inside their backend or their backend team; decide at integration time. Until then our app keeps using localStorage and export/import files, so nothing is blocked.

The organization always comes **from the session on the server**, never from the request. That's their rule, and it's the right one.

---

## 4. How the 3D view gets onto their page

Their frontend is plain HTML with no build step, so we give them **one ready-built file**:

```
our repo:  npm run build:embed
   → dist-embed/ahdus-workplace.js     (Babylon + our viewer, no React needed by them)
   → dist-embed/ahdus-workplace.css

their repo: frontend/workplace/3d-environment/ahdus-workplace.js  (copied in)
```

Their `3d-model.html` then needs only this:

```html
<div id="workplace" style="width:100%;height:100%"></div>
<script src="frontend/workplace/3d-environment/ahdus-workplace.js"></script>
<script>
  const ws = AHDUSWorkplace.mount(document.getElementById('workplace'), {
    layoutUrl: '/api/v1/workplace/layouts/current',   // later; for now a sample file
    mode: 'walkthrough',                               // from their session (section 3.3)
    quality: 'high',
    onEvent: (name, data) => { /* their code: open a video, a quiz, … */ },
  });
</script>
```

Their server already allows `.js`, `.css`, `.woff2` and `.glb` files under `frontend/`, so nothing on their server has to change.

---

## 5. Database: what has to change

Roshan's current `db/schema.sql` **conflicts with the Training Platform**:

1. **It creates its own `companies`, `users` and `company_memberships`.** Their rules forbid a second identity system. **Fix:** remove these tables. `workspace_layouts.organization_id` references `organizations(id)`, and access is checked through their `organization_memberships` and roles.
2. **It is accessed from the browser** with `@supabase/supabase-js`. Their design is server-only. **Fix:** the FastAPI backend reads and writes the layout tables; our app calls the API from section 3.5. Remove `@supabase/supabase-js` from our frontend.
3. **The bugs found when testing** still apply: viewers could write, deleting a layout failed because of the change-log trigger, and objects→rooms used RESTRICT.
4. **Simplest storage to start with:** one row per site (layout) with the whole layout as `jsonb`, plus `organization_id`, `name`, `revision` and `updated_by`. Split it into floors/rooms/objects tables later, only if a feature needs it.
5. **Editor permission:** stored in **their** permission system as the `workplace.edit` capability on a membership (section 3.3). We add no editor table of our own.

**Roshan should pause R2 until the contract in section 3 is agreed.**

---

## 6. Order of work (the model keeps improving the whole time)

| Step | What | Who | Needs | Done when |
|---|---|---|---|---|
| **0** | ✅ Himan is a collaborator on RUSBORN's repo. Still to do: Harsh shares his character code | Himan | none | Himan can clone and open a PR |
| **1** | Agree the contract (section 3) with their lead; write it into both repos as `WORKPLACE_CONTRACT.md` | Himan + their lead | step 0 | Both leads approve |
| **2** | `npm run build:embed` + `AHDUSWorkplace.mount()` + a test page | Himan (Claude Code) | none, can start now | Test page shows a sample office in walkthrough mode |
| **3** | Replace the placeholder in their `3d-model.html` with the embed. Uses a **sample layout file** and `mode` from their session. If loading fails, show the old placeholder | Himan, PR to their repo | steps 1 + 2 | Logged-in employee opens "3D Company" and walks around the sample office |
| **4** | Rework the schema on their tables; FastAPI endpoints from 3.5 | Roshan + their backend lead | step 1 | Admin saves a layout, employee of the same company sees it, other company gets 404 |
| **5** | Our app saves and loads through the API (localStorage stays as the offline fallback) | Himan / Roshan | step 4 | `e2e/save-smoke` passes against the API |
| **6** | Training hooks: E on a machine or training-room anchor opens their video or assessment for that item | Himan + Training team | step 3 | Pressing E on the CNC machine opens its training video |
| **7** | Desks linked to `positions.id`; HR/handover panels | Himan + Yashashwi | steps 1 + 4 | A desk shows its position's details |
| **8** | Harsh's characters replace the placeholder character, standing on anchors. Where his code lives is decided when we integrate with the Training Platform | Harsh + Himan | Harsh's code | An HR character stands at reception and reacts to `enterRoom` |
| **9** | `workplace.view` / `workplace.edit` capabilities + "Workplace editors" list in their Admin panel | their backend + Himan | steps 1 + 4 | An admin grants edit to an employee; that employee sees Workplace Studio, others only walk around |
| **10** | Site picker on "3D Company" (HQ, factory, branch) | Himan | step 4 | Switching sites loads that site's layout |

Steps 2 and 3 can happen **this week** without a finished model or a database. That gives everyone a real 3D page to plug into.

---

## 7. Why integrating early is safe

- **IDs never change.** Room, item and anchor IDs are UUIDs, and anchor IDs are pinned by a test. Anything they store keeps working.
- **The layout format is versioned.** Old saves are upgraded automatically on load (`normaliseLayout`, `migrate.ts`), so new model features don't break saved layouts.
- **`layoutBridge` is a contract.** Its API only grows, and its tests run against both Studio and the viewer.
- **They get updates by copying one file.** A new `ahdus-workplace.js` brings every model improvement with no code change on their side.
- **Fallback.** If the 3D file fails to load, `3d-model.html` shows the old placeholder, so their app is never broken by us.

---

## 8. Rules for this integration

1. No second identity, company, role or employee system. Use theirs.
2. No database access from the browser. Everything goes through their FastAPI backend.
3. The role and organization always come from **their server session**, never from the URL or localStorage.
4. We only change files we own in their repo (`3d-model.html`, `frontend/workplace/**`), on our own branch, through a pull request they review.
5. They never change our engine code. If they need something, it becomes a request on the contract.
6. Secrets (Supabase keys) stay in their backend `.env`. None go in our files or in Git.
7. Every new hook (training, characters, handover) goes through `layoutBridge` events and anchors.

---

## 9. Message to send their lead

> Hi, I own the 3D Workplace module ("3D Company", `3d-model.html`). Our viewer is ready to embed (walkthrough and view mode, stable room/anchor IDs, events when someone enters a room or presses E on a machine). I'd like to:
> 1. agree a short workplace contract: which IDs we share (organization, position, layout, room, anchor), how roles map to edit/walkthrough, and the `/api/v1/workplace/...` endpoints;
> 2. replace the placeholder in `3d-model.html` with our viewer on a branch and send you a PR (sample layout first, falls back to the placeholder if anything fails);
> 3. store layouts through your FastAPI backend using your `organizations`/`positions` tables, with no separate identity tables.
>
> 4. add `workplace.view` / `workplace.edit` capabilities: admins choose who may edit the workplace, everyone else walks around; a company can have several sites (HQ, factory, branch).
>
> Thanks for adding me as a collaborator. Can we have a 30-minute call this week?

---

## 10. Claude Code prompt for step 2 (can start now)

```text
On a new branch himan/embed from the latest main (git switch main, git pull, git switch -c himan/embed).
Follow CLAUDE.md.

Goal: other teams' plain HTML pages (no React, no build step) can show our 3D viewer.
1. Add `npm run build:embed` (Vite library build, IIFE) → dist-embed/ahdus-workplace.js (+ .css),
   global `AHDUSWorkplace`. React and Babylon are bundled inside; no Studio code (check like viewer-smoke does).
2. API: AHDUSWorkplace.mount(element, { layout | layoutUrl, mode: 'view'|'walkthrough'|'edit',
   quality, onEvent(name, data), onError(err) }) → { setMode, setFloor, focusOn, highlight,
   anchors(), registerAction(), destroy() }. It uses <LayoutViewer /> and layoutBridge underneath;
   no new engine logic. mode 'edit' is refused in the embed for now (admins edit in Studio).
   layoutUrl is fetched with credentials: 'include' and must return our v2 JSON or an exported .ahdus.json.
3. If loading fails, call onError and leave the element empty, so the host page can show its own fallback.
4. embed-test.html (plain HTML, loads only dist-embed/ahdus-workplace.js) with a sample office:
   reception, 2 offices, a training room with a CNC machine, 2 floors with stairs.
   It shows a live list of onEvent calls and registers one action:
   "E · Watch CNC training video" on CNC_MACHINE.
5. Write docs/EMBED_GUIDE.md: how a plain HTML page uses the file, the options, events and
   the role → mode table from AHDUS_3D_INTEGRATION_PLAN.md section 3.3.
TESTS: e2e/embed-smoke.mjs (builds the embed, opens embed-test.html, walks into the training room,
enterRoom event arrives, E on the CNC machine runs the action, edits are refused, destroy() cleans up,
no errors). Also npm test, typecheck, build, e2e viewer.
Commit each step; merge into main when everything passes; update CLAUDE.md and PROGRESS_REPORT;
ask me before pushing.
```

---

## 11. Decisions and open questions

| # | Question | Answer |
|---|---|---|
| 1 | Which endpoint gives the user's session to a page? | ✅ `GET /phase2/session?organization_id=…` with the Supabase token. It returns `system_role`, `organization_id`, `employee_id`, `department_scope`. Permission checks use `POST /phase2/access` (found in `backend/auth/phase2_runtime.py`). |
| 2 | Who may edit the workplace? | ✅ **A permission the admin gives** (`workplace.edit`), not a fixed role. See 3.3. |
| 3 | One layout per company, or several? | ✅ **Several sites** (HQ, factory, branch) together form the company's digital twin. Site picker on "3D Company". |
| 4 | Do training videos and assessments have IDs we can link to a machine or room? | 🟡 Probably yes. **Confirm** the exact IDs and the URL that opens one, for example a video or assessment page with an ID. |
| 5 | Where does Harsh's character code live? | 🟡 Decided when we integrate. Until then he builds against the character interface in our repo (`src/play/character.js`: `root`, `update`, `setVisible`, `dispose`). |
| 6 | Who builds the `/api/v1/workplace` endpoints? | 🟡 Not decided (Roshan or their backend team). Nothing is blocked: we keep localStorage and export/import until then. |
| 7 | Does their `Capability` list accept two new values (`workplace.view`, `workplace.edit`) and a grants table? | ❓ Ask their lead. It's their authorization code. |
