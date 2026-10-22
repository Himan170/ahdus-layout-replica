# Showing the 3D workplace on a plain HTML page

For teams whose pages are plain HTML, CSS and JavaScript, with no React and no build step (for example the AI Training Platform's "3D Company" page, `3d-model.html`). You add **one file** and make **one call**.

Plan and contract: `AHDUS_3D_INTEGRATION_PLAN.md` (sections 3 and 4). Try it: `embed-test.html` in this repo.

---

## 1. Quick start

```html
<div id="workplace" style="width: 100%; height: 600px"></div>

<script src="frontend/workplace/3d-environment/ahdus-workplace.js"></script>
<script>
  const workplace = AHDUSWorkplace.mount(document.getElementById('workplace'), {
    layoutUrl: '/api/v1/workplace/layouts/current',  // or layout: { ... } if you already have the JSON
    mode: 'walkthrough',                              // from your server's session (section 6)
    onEvent(name, data) {
      if (name === 'enterRoom') console.log('Walked into', data.room.name);
    },
    onError(err) {
      // The element is empty again: show your own placeholder here
      document.getElementById('workplace').textContent = '3D view unavailable: ' + err.message;
    },
  });

  // "E · Watch CNC training video" on every CNC machine
  workplace.registerAction('CNC_MACHINE', {
    label: 'Watch CNC training video',
    run(target) { openTrainingVideo(target.objectId); },  // your code
  });
</script>
```

- **Give the element a size.** The viewer fills it, and follows it when it changes size.
- `mount()` returns at once. The layout is drawn a few seconds later (the `ready` event).
- The file brings its own styles. You don't need a stylesheet (see section 8 for the exception).

---

## 2. Getting the file

In this repo:

```bash
npm run build:embed
```

This makes:

| File | What |
|---|---|
| `dist-embed/ahdus-workplace.js` | Everything: our viewer, React and Babylon.js (≈ 2.0 MB, ≈ 500 kB gzipped). Sets the global `AHDUSWorkplace`. |
| `dist-embed/ahdus-workplace.css` | The same styles the script adds itself. Only needed in the case described in section 8. |

Copy `ahdus-workplace.js` into your repo (for example `frontend/workplace/3d-environment/`). To update, copy the new file over the old one. Its first line says which commit and day it was built from. It contains no Workplace Studio (editor) code; `e2e/embed-smoke.mjs` checks this.

---

## 3. `AHDUSWorkplace.mount(element, options)`

| Option | Type | What |
|---|---|---|
| `layout` | object | The layout itself: **v2 layout JSON** (what `GET /workplace/layouts/{id}` returns) or an **exported `.ahdus.json` file**. |
| `layoutUrl` | string | Or where to fetch it. Fetched with `credentials: 'include'` (your login cookie goes along). Must return one of the two formats above. Used only when `layout` is not given. |
| `headers` | object | Extra request headers for `layoutUrl`, e.g. `{ Authorization: 'Bearer ' + token }`. |
| `mode` | `'view'` \| `'walkthrough'` | `view` (default): orbit and zoom around the building. `walkthrough`: walk through it as a character. **`'edit'` is refused**: admins edit in Workplace Studio (section 6). |
| `quality` | `'high'` \| `'low'` | `low` is accepted but changes nothing yet. |
| `onEvent(name, data)` | function | Everything that happens (section 5). |
| `onError(error)` | function | The layout could not be shown (section 7). Without it, the message goes to the console. |

`mount()` throws only if `element` is not an element. Anything else that goes wrong comes to `onError`.

---

## 4. What `mount()` returns

| Call | What it does |
|---|---|
| `ready` | A promise. Resolves (with this object) when the layout is drawn, rejects if it can't be. |
| `mode` | The current mode. |
| `setMode('view' \| 'walkthrough')` | Switches mode. Returns `false` for anything else (`'edit'` is refused). |
| `setFloor(floorId)` | `view`: shows the building up to that floor, without its roof. `walkthrough`: takes the character there (as Page Up / Page Down). `false` if there's no such floor. |
| `focusOn(id)` | `view` mode: the camera flies to a room, an item or a hook point (`room_…`, `obj_…` or a hook-point id). `false` in `walkthrough` mode or for an unknown id. |
| `highlight(ids, color?)` | Outlines rooms, items or hook points (default colour `#FFD700`). Replaces the ones highlighted before; `highlight([])` clears them. |
| `anchors({ kind?, roomId?, floorId?, objectId? })` | Hook points, e.g. `anchors({ kind: 'machine' })` or every workstation on Floor 1: `anchors({ kind: 'workstation', floorId: 1 })`. `[]` until `ready`. |
| `registerAction(match, { label, run, when? })` | A "Press E" action (below). Returns a function that removes it. |
| `destroy()` | Removes the viewer: the element is as you gave it, the 3D engine, its keys and its actions are gone. Safe to call twice. |

Calls made before `ready` (`setFloor`, `focusOn`, `highlight`) wait for it and return `undefined`. After `destroy()` every call returns `false` (or `[]`).

### "Press E" actions

When the user (walking through) looks at something within 3.5 m, the prompt says **E** and your `label`; pressing E calls `run(target)`.

`match` says what the action is for:

| `match` | Example | Matches |
|---|---|---|
| An asset type | `'CNC_MACHINE'`, `'LATHE'`, `'DESK_STANDARD'` | Every item of that type |
| A hook-point kind | `'machine'`, `'workstation'`, `'seat'`, `'reception'`, `'info-point'` | Every item with that kind of hook point |
| An item or hook-point id | `'obj_…'`, a hook-point UUID | That one item |
| `'door'` or `'window'` | `'door'` | Any door / window |
| A list | `['CNC_MACHINE', 'LATHE']` | Any of them |
| A function | `(t) => t.room?.name === 'Training room'` | Whatever it returns `true` for |

`label` may also be a function of the target. `when(target)` can narrow it further. If two actions match, the first one registered wins. If none matches, E shows a small card with the item's details (the `card` event).

The **target** (also the data of the `interact` event) is the one in `docs/TEAM_INTEGRATION.md` section 3:

```js
{
  kind: 'object' | 'door' | 'window',
  objectId, object,      // object: { id, assetType, label, category, roomId, floorId, position, rotationY, … }
  anchors, anchor,       // the item's hook points, and the main one
  anchorId, anchorKind,  // the main hook point (machine > reception > workstation > seat > spawn)
  positionRef,           // the org position linked to it, if any
  roomId, room, floorId, // room: { id, name, type, typeLabel, floorId, center, width, depth }
  point: { x, y, z }, distance,
}
```

Ids never change once created: store `objectId` or `anchorId` in your tables to link your videos, assessments or positions to an item (plan, section 3.1).

---

## 5. Events (`onEvent(name, data)`)

| Name | When | `data` |
|---|---|---|
| `ready` | The layout is drawn | `{ name, mode, floors: [{ id, name }], rooms: [room, …] }` |
| `enterRoom` | The character walked into a room (also: up the stairs into one) | `{ roomId, room, floorId, fromRoomId }` |
| `exitRoom` | The character left a room (also: switching to `view`) | `{ roomId, room, floorId, toRoomId }` |
| `interact` | E was pressed on an item, door or window | the target (section 4) |
| `floorChange` | The floor shown or walked on changed | `{ floorId, name }` |
| `card` | The viewer showed a card (E with no action for it) | `{ title, body }` |

`room` is `{ id, name, type, typeLabel, floorId, center: { x, z }, width, depth }`. Floors are numbered `0` (ground), `1`, `2`, … Positions are in metres, `y` is up.

Room and E events happen only in `walkthrough` mode. They are the same events `layoutBridge` sends to our modules (`docs/TEAM_INTEGRATION.md`); `onEvent` gives you only this viewer's.

---

## 6. Which mode for whom

From `AHDUS_3D_INTEGRATION_PLAN.md` section 3.3 (decided by Himan, 22 Oct 2026). Editing is a **permission the admin gives**, not a fixed role:

| Who | 3D mode | What they can do |
|---|---|---|
| `SUPER_ADMIN` / `ADMIN` | `edit` | Build and change layouts, and **give or take away** the "Edit workplace" permission |
| Anyone the admin gave **"Edit workplace"** | `edit` | Build and change layouts |
| Everyone else in the company (`EMPLOYEE`) | `walkthrough` | Walk around, press E, cannot change anything |
| Not logged in / other company | nothing shown | "Please log in" / not found |

- **The server decides.** It sends `mode` (or the `workplace.edit` capability) to the page, and the save API checks it again on every save. The page only passes `mode` on.
- **In the embed, `edit` is refused for now.** For people who may edit, show `walkthrough` (or `view`) here and link to Workplace Studio to make changes.
- **Not logged in / other company:** don't call `mount()`; show your own message.
- Nothing in the embed can change or save the layout, whatever the page does: in `view` and `walkthrough` every edit is refused (`e2e/embed-smoke.mjs` checks).

---

## 7. When loading fails

If the layout can't be shown, `onError(error)` is called and **the element is left as you gave it** (our part is removed), so you can put your own placeholder in it. `error.message` is short and readable:

| Message | Why |
|---|---|
| `Could not load the layout from <url> (HTTP 404)` | The server answered with an error (`error.status` has the code, e.g. 401 when not logged in) |
| `Could not load the layout from <url>: Failed to fetch` | Network or CORS problem (below) |
| `<url> did not send JSON` | The answer was not JSON (e.g. an HTML login page) |
| `This is not an AHDUS layout: expected v2 layout JSON or an exported .ahdus.json file` | JSON, but not a layout (e.g. `{ "detail": "Not authenticated" }`) |
| `This AHDUS layout is damaged: rooms.0.width: Expected number, …` | A layout with a wrong field |
| `Editing isn't available here: admins edit the workplace in Workplace Studio` | `mode: 'edit'` |
| `This browser could not start the 3D view` | No WebGL (very old browser or graphics turned off) |

### Layout API on another origin (CORS)

If the page and the API have different origins (e.g. page on port 3000, FastAPI on port 8000), the API must answer with:

- `Access-Control-Allow-Origin: <the page's origin>` (not `*`, because cookies go along)
- `Access-Control-Allow-Credentials: true`
- with `headers`: `Access-Control-Allow-Headers: Authorization` on the preflight (`OPTIONS`)

In FastAPI: `CORSMiddleware(allow_origins=["http://localhost:3000"], allow_credentials=True, allow_headers=["Authorization"])`.

---

## 8. Styles

The script adds a small stylesheet at the start of `<head>` (removed when the last viewer is destroyed). Your own CSS comes later, so it wins. You can restyle:

| Class | What |
|---|---|
| `.ahdus-workplace` | Our box inside your element (fills it; `min-height: 200px`) |
| `.ahdus-workplace__loading` | "Loading the workplace…", until `ready` |

If your Content-Security-Policy blocks added `<style>` elements, link the file instead and the script won't add its own: `<link rel="stylesheet" href="…/ahdus-workplace.css">`.

---

## 9. What the user can do

| Mode | Controls |
|---|---|
| `view` | Drag to orbit, right-drag to pan, wheel to zoom |
| `walkthrough` | Click the view to look around with the mouse (Esc releases it). W A S D walk, Space jumps, F flies (Space up, C down), V first / third person, Page Up / Page Down change floor, **E** uses what you look at |

---

## 10. Good to know

- **Several viewers on one page** work; each `onEvent` gets only its own viewer's events, and `registerAction` only acts in its own viewer.
- **`AHDUSWorkplace.bridge`** is `layoutBridge` (`docs/TEAM_INTEGRATION.md`), for modules that need more than `onEvent`, e.g. `bridge.getPlayer()` (where the character is) or `bridge.getScene()` (to draw your own 3D things, such as a character).
- **Keyboard:** while a viewer is in `walkthrough` mode, it listens to the keys of the whole page (except in text fields). Tab, Space and Page Up / Page Down then don't move focus or scroll the page. Switch to `view` or `destroy()` the viewer when the user leaves the 3D part.
- Nothing is saved from the embed. Layouts are built and saved in Workplace Studio.
- Size: ≈ 500 kB gzipped. Serve `.js` files compressed (gzip or brotli) and let browsers cache it.

---

## 11. Testing (in this repo)

- `npm run build:embed`, then open `embed-test.html` through any web server, e.g. `npm run dev` → <http://localhost:3000/embed-test.html>. It loads only the embed file, shows a sample office (`embed-sample.ahdus.json`: reception, 2 offices, a training room with a CNC machine, 2 floors with stairs), lists every `onEvent` call and registers "E · Watch CNC training video". `?mode=view` orbits; `?layoutUrl=missing.json` shows the page's own fallback.
- `npm run e2e:embed` (20 checks, `e2e/embed-smoke.mjs`) builds the file and tests all of the above from a plain static server, with no dev server needed.
- Code: `src/embed/index.jsx` (`mount`), `src/embed/embedLayout.js` (loading, matching; unit tests in `src/embed/__tests__/`), `vite.embed.config.js`.
