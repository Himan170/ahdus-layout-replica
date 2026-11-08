# Showing the 3D workplace on a plain HTML page

For teams whose pages are plain HTML, CSS and JavaScript, with no React and no build step (for example the AI Training Platform's "3D Company" page, `3d-model.html`). You add **one file** and make **one call**.

Plan and contract: the integration plan agreed with the Training Platform (ask Himan). Try it: `embed-test.html` in this repo.

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
- `mount()` returns at once. The layout is built a piece at a time, the floor you start on first, so a big building
  never freezes your page: the view shows "Building your workplace… 40 %" (`progress` events), then `ready` once
  everything is built.
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
| `dist-embed/ahdus-workplace.js` | Everything: our viewer, React and Babylon.js (≈ 2.6 MB, ≈ 650 kB gzipped). Sets the global `AHDUSWorkplace`. |
| `dist-embed/assets/` | The realistic look: furniture models, photo textures, the sky (≈ 2.8 MB, loaded only with `quality: 'high'`). Keep it next to the script, or say where it is with `assetBaseUrl`. All CC0 (`docs/ASSET_LICENSES.md`). |
| `dist-embed/ahdus-workplace.css` | The same styles the script adds itself. Only needed in the case described in section 8. |

Copy `ahdus-workplace.js` and the `assets/` folder into your repo, side by side (for example `frontend/workplace/3d-environment/`). To update, copy the new ones over the old ones. Its first line says which commit and day it was built from. It contains no Workplace Studio (editor) code; `e2e/embed-smoke.mjs` checks this.

---

## 3. `AHDUSWorkplace.mount(element, options)`

| Option | Type | What |
|---|---|---|
| `layout` | object | The layout itself: **v2 layout JSON** (what `GET /workplace/layouts/{id}` returns) or an **exported `.ahdus.json` file**. |
| `layoutUrl` | string | Or where to fetch it. Fetched with `credentials: 'include'` (your login cookie goes along). Must return one of the two formats above. Used only when `layout` is not given. |
| `headers` | object | Extra request headers for `layoutUrl`, e.g. `{ Authorization: 'Bearer ' + token }`. |
| `mode` | `'view'` \| `'walkthrough'` | `view` (default): orbit and zoom around the building, seen from above: the chosen floor (the ground floor at first) without its roof, the floors above it hidden, so its desks and people show. `walkthrough`: walk through it as a character; back in `view`, the floor you walked to is shown (a `floorChange` event says which). **`'edit'` is refused**: admins edit in Workplace Studio (section 6). |
| `quality` | `'high'` \| `'low'` | `high` (default): the realistic look: real furniture models, photo textures on floors and walls, a photographed sky. They load after the workplace is drawn (the simple look shows until then). `low`: the simple models and materials, nothing extra downloaded: for slow computers. |
| `assetBaseUrl` | string | Where the realistic look's files are (the `assets/` folder: `models/`, `textures/`, `env/`). Default: `assets/` next to `ahdus-workplace.js`. Set it when you host them elsewhere, e.g. `'https://cdn.example.com/ahdus/assets/'`. A file that can't be loaded keeps the simple look for that item or surface (a warning in the console, never an error). |
| `characters` | object | `{ manifestUrl }`: where the **character manifest** is (section 4b), fetched with `credentials: 'include'` and `headers` on the first `setPeople`. Or `{ manifest }`: the manifest itself. Without it everyone is the neutral simple figure. Also `chooseUrl`: where people choose their character (http / https, or relative to the page), for the "Choose your character" link (section 4b), and `walkClipUrl`: the walk clip your own character walks with in `walkthrough` (section 4c). |
| `player` | object | `{ personId, assetReference }`: the person looking, i.e. the signed-in user (the same `personId` and `assetReference` as in `setPeople`). In `walkthrough` they walk as their own character (section 4c); their own card offers "Choose your character" if they never chose one. Change it later with `setPlayer`. |
| `navigation` | object | `{ search: true, tour: true }` (default): a **Find** button in the view's toolbar opens the search box "Find a person, room or place" (section 4d); a **Tour** button and Find's "Take the company tour" start the company tour (section 4f). `{ search: false }` hides the search (`find()` still works), `{ tour: false }` the tour (`startTour()` still works). |
| `departments` | array | `[{ name, description }]`: a short description for each department (AHDUS: `GET /api/teams/departments`), shown in the Find box's menu under the department of that name (section 4d). Departments that aren't in the layout or among the people are left out; only `name` and `description` are kept (text, at most 280 characters shown). Change it later with `setDepartments`. |
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
| `setPeople(list)` | Who sits at which desk (section 4b). Replaces the list before; `setPeople([])` = nobody. Returns a promise of how many people were given (after the manifest is read). Can be called before `ready`. |
| `setPlayer({ personId, assetReference } \| null)` | The person looking (the signed-in user), as the `player` option. Returns a promise, done when their character is known (after the manifest is read). |
| `setDepartments([{ name, description }])` | The departments' descriptions, as the `departments` option (replaces the list before). Returns how many were taken. |
| `find(query, { limit? })` | Search people (name and department), rooms, departments and facilities (section 4d). `[]` until `ready`. |
| `goTo(target, { walk? })` | Go to a person, room or place (section 4e): `walk: 'guide'` (default) = **Show route**, `'auto'` = **Take me there**. From `view` it starts walking at the entrance. Returns `{ place, walk, length, seconds, floors }` or `{ problem, message }`. |
| `stopRoute()` | Ends Show route / Take me there (`false`: there was none). |
| `startTour({ follow? })` | The company tour (section 4f), from the main entrance (from `view` it starts walking there). `follow: 'auto'` (default) = **Walk me**, `'self'` = **I'll walk**. Returns `{ count, minutes, length }` or `{ problem, message }`. |
| `stopTour()` | Ends the tour (`false`: none); the user stays where they are, walking. |
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

### 4b. People at their desks (`setPeople`, option `characters`)

```js
const workplace = AHDUSWorkplace.mount(el, {
  layoutUrl, mode: 'walkthrough',
  characters: { manifestUrl: '/frontend/workplace/characters.json', chooseUrl: '/frontend/character/selection/index.html' },
  player: { personId: String(currentUser.id) },   // the signed-in user
});
workplace.setPeople([
  { personId: 'u_17', deskId: 'obj_3f…', name: 'Asha Rao', department: 'Engineering', assetReference: 'mixamo:aj-v1' },
  { personId: 'u_22', deskId: 'obj_9a…', name: 'Ben Iyer', department: 'HR', assetReference: null },
]);
```

- **A person** = `{ personId, deskId, name, department, assetReference }`. `deskId` is the desk's item id
  (`obj_…`, a `DESK_STANDARD`, `DESK_CORNER` or `RECEPTION_DESK`). Only these fields are kept; anything else you
  pass (an email, a user id) is dropped and never reaches the 3D view. A desk not in the layout is skipped; one desk
  shows one person (the first in the list).
- **Where they are:** seated on the desk's chair: a `CHAIR_…` within 1.2 m of the desk, facing it (within 60°; each
  chair belongs to the desk it fits best). A desk with no chair: standing where its chair would be (the desk's own +Z side,
  turned with the desk; a reception desk: behind the counter), facing it. People follow
  their desk: per floor (`setFloor`), and when the layout changes.
- **What they look like:** their character comes from the manifest by `assetReference`. Unknown, missing or `null`
  = the **neutral simple figure** (no face, no clothes). Characters are drawn only for the people nearest the camera
  (at most 12, on the current floor, within ~15 m); everyone else is a simple figure (hundreds cost two draw calls).
  Each character file is downloaded once (at most 3 at once), only when someone near needs it; until then, or if it
  fails (a warning in the console), that person is a simple figure. Seated / standing is a pose made from the bone
  names: no animation file is needed.
- **The card:** pointing at a desk with a person (`view`), or walking up to one (`walkthrough`, within 1.8 m),
  shows a small card with their **name and department**, as plain text. No labels float over the desks.
  **A click or a tap** on a desk (or a person) keeps the card open until the next click or tap elsewhere (phones
  have no pointing: a tap is how they see who sits there); dragging the view hides it.
- **"Choose your character":** on the `player`'s own card, when their `assetReference` is `null` (they never chose
  one), the card links to `characters.chooseUrl`. An asset reference the manifest doesn't know is a choice made (no
  link), and so is any character, even while its file loads. No `chooseUrl` (or one that isn't http / https) = no link.
- People are not pickable: a click, the crosshair and E go to the desk or chair as before.
- `quality: 'low'`: no people at all, nothing downloaded.

**The manifest** (JSON, served by AHDUS): asset reference → file.

```json
{
  "mixamo:aj-v1":          { "url": "aj.glb",       "rig": "mixamo", "height": 1.78 },
  "mixamo:ch22-v1":        { "url": "olivia.glb",   "rig": "mixamo", "height": 1.66 },
  "ahdus-human:studio-v1": { "url": "victoria.glb", "rig": "ue",     "height": 1.68 }
}
```

| Field | What |
|---|---|
| `url` | The `.glb` file. Relative to the manifest's own address, or absolute (http / https only). Loaded by the browser like any model: give it CORS headers if it is on another origin. |
| `rig` | `'mixamo'` (default): Mixamo bone names, any prefix (`mixamorig:`, `mixamorig4:`, …). `'ue'`: Unreal-style names (`pelvis`, `spine_01`, `thigh_l`, …). |
| `height` | The person's height in metres (1 to 2.3; default 1.75): the model is scaled to it. |
| `walk` | Optional, `false`: walking through, this character doesn't use the walk clip (it stands and slides). For a skeleton the clip doesn't fit. |

The file must be a skinned glTF binary facing +Z with its feet at 0 (as Mixamo exports). Office copies should be
light (`docs/TEAM_INTEGRATION.md` section 4, "Harsh"). glTF extensions it may use: `EXT_texture_webp`,
`KHR_materials_specular`, `KHR_materials_unlit` (no Draco, meshopt or KTX2 compression). A file that requires any
other extension can't be loaded: that person stays a simple figure (a warning in the console). Entries that can't be used are left out (a warning).
Test files: `assets/characters/manifest.json` next to `ahdus-workplace.js` (self-made placeholder figures).

### 4c. Walking as yourself (`player`, `characters.walkClipUrl`)

```js
const workplace = AHDUSWorkplace.mount(el, {
  layoutUrl, mode: 'view',
  characters: {
    manifestUrl: '/frontend/workplace/characters.json',
    walkClipUrl: '/frontend/character/office/walk.glb',     // the walk animation only (no mesh)
  },
  player: { personId: String(currentUser.id), assetReference: mySeat?.assetReference ?? myCharacter ?? null },
});
```

- In `walkthrough` you are **your own character** (from the manifest by `assetReference`) instead of the simple
  figure. It is made when walking starts (each file is downloaded once, shared with the people at their desks).
- **The walk:** the clip at `walkClipUrl` (an animation-only `.glb`, Mixamo bone names, one cycle) is put onto your
  character by bone names: Mixamo and Unreal-style skeletons (`rig: 'ue'`), with a correction for a skeleton whose
  bones point another way. It plays as fast as you move, so the feet keep up with the floor (its own speed is read
  from the clip: its forward motion, else its steps); the clip's forward motion is taken out. Standing still or flying:
  the standing pose. No `walkClipUrl`, a clip that can't be loaded, or `walk: false` in the manifest: the standing
  pose all the time (the character slides).
- **The camera** sits at your eye height (0.93 × `height`: 1.62 m for 1.75 m). `V` (first person) hides your body.
- **Your seated figure** (the `setPeople` entry with your `personId`) is hidden while you walk, and back in `view`.
- `assetReference` `null` or unknown, a character file that fails, or `quality: 'low'`: the simple figure walks, as before.
- Test files: `assets/characters/placeholder-walk.glb` next to `ahdus-workplace.js` (our own clip: 1.2 m a second).

### 4d. Search: "Find a person, room or place" (`find`, option `navigation`)

The view has a **Find** button (top left). It opens a search box; results come as you type (a few ms, even with
hundreds of people), grouped **People**, **Rooms** and **Facilities**, each with its floor and room, e.g.
"Kavya Iyer · HR · Ground Floor, Lobby & Reception". When the text matches a department or room name better than any
person's name ("Engineering", "Sales"), **Rooms** comes first (the department, then its people). Keyboard: ↑ ↓ choose, Enter picks, Esc closes. On a phone it is
as wide as the view.

- **What it finds:** people from `setPeople` (their **name and department only**: nothing else you pass, such as an
  email, is kept or shown), every room by its name (or type), departments (`departmentRef` of several rooms), and
  facilities: washrooms (`washroom`, `restroom`, `toilet`, `WC`…), meeting rooms, reception, stairs.
- **Picking a result** in `view`: its floor is shown, the camera flies to it and it is outlined in green (a person:
  their desk and chair). In `walkthrough` it is outlined and the box says how far it is to walk ("42 m walk, about
  10 s · by the stairs") or why you can't ("No walking route to Server Room: it has no door"). There, "washroom"
  offers **Nearest washroom** first: the nearest by walking from where you stand.
- **The card's buttons:** **Show route** and **Take me there** (section 4e).
- **Before typing** (v0.14.2) the box is a menu of this workplace, made from the layout and `setPeople` (never a fixed
  list, so it offers only what is there):
  - **chips** for the kinds of facility it has (Washroom, Meeting room, Reception, Stairs). In `walkthrough` each
    is the nearest one and the walk there, "Nearest washroom · 8 m", and a tap shows it;
  - **My desk** (the `player`'s seat, if they have one) and **Recent** searches (the last 5 places picked, kept in
    this browser);
  - **Departments**: rooms' `departmentRef` plus the people's departments, "Engineering · 2 rooms · Floor 1 · 92
    people", with the description from the `departments` option. Opening one lists all of it, its rooms and its
    people;
  - **Places** by kind (Offices, Meeting rooms, Washrooms, Reception, Stairs, then other room types), each with a
    count; opening one lists them by floor;
  - **By floor**: "Ground Floor · 13 rooms" → its rooms.
  Every place in it has the same card (Show route / Take me there). Keyboard: ↑ ↓, Enter opens or picks, ← or Esc
  goes back.

```js
workplace.find('Kavya');
// [{ id: 'person:42', kind: 'person', group: 'people', name: 'Kavya Iyer', detail: 'HR · Ground Floor, Lobby & Reception',
//    floorId: 0, floorName: 'Ground Floor', roomId: 'room_f0_02', roomName: 'Lobby & Reception', department: 'HR',
//    facility: null, personId: '42', deskId: 'obj_f0_reception', entityId: 'obj_f0_reception' }]
const [first] = workplace.find('washroom');            // kind 'facility', facility 'RESTROOM'
workplace.focusOn(first.entityId); workplace.highlight(first.entityId); // show it yourself (view mode)
```

`kind` is `person`, `room`, `department` or `facility` (in `walkthrough` also `nearest`: "Nearest washroom",
with `places`, the ids it chooses from). At most 6 results per group (`{ limit }` to change it).

### 4e. Show route and Take me there (`goTo`, `stopRoute`, the `navigation` event)

From the search card, or from your page with `goTo`. Both start walking (from `view`: at the entrance).

- **Show route** (`walk: 'guide'`): a green line of chevrons on the floor you are on (a blue ring at the stairs to
  take, a green ring at the goal), and a strip "Going to Kavya Iyer · 42 m" with **Stop**. You walk yourself; the
  line follows you, and a new route is made when you are more than 3 m off it. `G` (or the strip's "Take me there")
  walks you the rest.
- **Take me there** (`walk: 'auto'`): the character walks the route by itself at walking speed, through the same
  collisions as the keys, turning smoothly, keeping about 0.44 m from furniture where there is room, up or down the
  stairs. Stuck (less than 0.3 m in 1.5 s): a new route; stuck twice: it stops with "Can't get past here".
  **Any movement key pauses it** ("Press G to continue"); **G** continues; **Esc** or **Stop** ends it.
- **Arriving** (within 1 m): it stops, faces the person or room, and shows "You have arrived" (and the person's
  card). The place stays outlined until the strip is closed.
- Walking without a route is exactly as before.

```js
workplace.goTo('Kavya Iyer', { walk: 'auto' });       // a name: the first search result
workplace.goTo({ personId: '42' });                    // Show route to a person's desk
workplace.goTo({ type: 'RESTROOM' }, { walk: 'auto' }); // the nearest washroom
workplace.goTo('room:room_f0_08');                     // a search result's id; also { roomId }, { deskId }, { x, z, floor }
workplace.stopRoute();
```

`target`: a search result's `id` (`person:…`, `room:…`, `department:…`, `item:…`, `nearest:RESTROOM`), a name or
words to search for, `{ personId }`, `{ roomId }`, `{ deskId }` / `{ objectId }`, `{ type: 'RESTROOM' | 'MEETING' |
'RECEPTION' | 'STAIRS' }` (the nearest by walking) or a spot `{ x, z, floor, name? }`. A problem is
`{ problem, message }`: `NOT_FOUND`, `NOT_WALKING` (walking could not start), or a route problem ("No walking route to Server Room: it has no door").

### 4f. The company tour (`startTour`, `stopTour`, the `tour` event)

A guided walk through the workplace, made from the layout and the seats (nothing to write): the main entrance, the
reception, each department once, a washroom and a meeting room on each floor, floor by floor (up the stairs), back to
reception. The **Tour** button (next to Find) and **"Take the company tour · 20 stops · about 8 min"** at the top of
Find's menu start it; so does `startTour()`. It is planned while the page is idle after loading, so it starts at once.

- **The panel** (top right; on a phone at the bottom, above the joystick, and one line while walking between stops: "Stop 2 of 20 · Lobby & Reception", Pause and ⌃ to open it): "Stop 4 of 20 · Marketing", what the stop
  is (its department's description, how many people work there, some names), the way to the next stop ("Out of
  Reception, turn right along the corridor. Sales is the second door on your right."), passing rooms ("On your left:
  Restrooms"). **Pause / Resume** (P), **Previous**, **Next**, **Skip the walk**, **Exit** (Esc), and **All stops**: the
  list, with a tick for each stop visited (kept per browser and layout) and **Restart**.
- **Walk me** (default): the character walks to each stop by itself, as Take me there; a movement key or the joystick
  pauses it, P or Resume walks on. **I'll walk**: the route line shows the way and getting there completes the stop.
  Switch between them at any time. **Skip the walk**: a short fade, and you are at the next stop.
- **At a stop:** the character stands about 2 m inside the room, its room is outlined, the view turns to face it and the
  camera eases higher and further back so the desks and people show (with *reduced motion* set: a fade instead), and the
  panel shows it; after a short pause (about 20 s, washrooms and meeting rooms about 8 s) the tour walks on.
- **Narration:** the browser reads each stop aloud after the speaker button in the panel is turned on (off by default).
- Without a tour, walking, Find and Take me there are exactly as before.

```js
workplace.startTour();                 // Walk me, from the main entrance
workplace.startTour({ follow: 'self' }); // I'll walk
workplace.stopTour();
```

---

## 5. Events (`onEvent(name, data)`)

| Name | When | `data` |
|---|---|---|
| `progress` | While the layout is being built (the last one has `allBuilt: true`) | `{ done, total, floor, currentFloorReady, allBuilt }` |
| `ready` | The layout is built and drawn | `{ name, mode, floors: [{ id, name }], rooms: [room, …] }` |
| `enterRoom` | The character walked into a room (also: up the stairs into one) | `{ roomId, room, floorId, fromRoomId }` |
| `exitRoom` | The character left a room (also: switching to `view`) | `{ roomId, room, floorId, toRoomId }` |
| `interact` | E was pressed on an item, door or window | the target (section 4) |
| `floorChange` | The floor shown or walked on changed | `{ floorId, name }` |
| `card` | The viewer showed a card (E with no action for it) | `{ title, body }` |
| `tour` | The company tour (section 4f) | `{ type, state, follow, index, count, visited, remaining, message, mention, stop }`; `type`: `started`, `walking`, `arrived`, `paused`, `resumed`, `follow`, `mention`, `progress`, `done`, `ended`, `problem`; `state`: `idle`, `walking`, `stop`, `paused`, `done`; `stop`: `{ id, n, kind, name, floor, floorName, text }` |
| `navigation` | Show route / Take me there (section 4e) | `{ state, walk, place, remaining, length?, seconds?, floor?, paused?, rerouted?, problem?, message? }`; `state`: `started`, `progress` (about every metre or second; `paused: true` after a movement key), `arrived`, `stopped`, `failed` |

`room` is `{ id, name, type, typeLabel, floorId, center: { x, z }, width, depth }`. Floors are numbered `0` (ground), `1`, `2`, … Positions are in metres, `y` is up.

Room and E events happen only in `walkthrough` mode. They are the same events `layoutBridge` sends to our modules (`docs/TEAM_INTEGRATION.md`); `onEvent` gives you only this viewer's.

---

## 6. Which mode for whom

From the integration plan, section 3.3 (decided by Himan, 22 Oct 2026). Editing is a **permission the admin gives**, not a fixed role:

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
| `walkthrough`, touch screens (v0.14.1) | A **joystick** at the bottom left walks (push further = faster, let go = stop; it pauses a "Take me there" and ends a walk you tapped, as a key does); **drag** anywhere else to look around (a second finger looks while the joystick walks); **tap the floor** to walk there (the route line shows), tap a person (or their desk) for their card, tap a machine in reach to use it. The toolbar's buttons, Find and its cards work by tap. The first walk shows "Joystick to walk · drag to look · tap the floor to go there" once (per browser, apart from the mouse one); the HUD line and the "?" help ("Touch controls") use the same touch words. The words follow how the user last pointed: a finger = touch words and the joystick, a mouse = the keys and mouse words (a laptop with a touch screen gets both) |
| `walkthrough` | The keys work **as soon as walking starts** (no click needed): W A S D (or the arrows) walk, Shift runs, **drag** (left or right button) to look around (the cursor stays visible, nothing is captured), **click the floor** to walk there, click a person (or their desk) for their card, click a machine in reach to use it (as E), Space jumps, F flies (Space up, C down), V first / third person, Page Up / Page Down change floor, **E** uses what you look at, **Home** (or the "Back to entrance" button) goes back to the start, G walks on after a paused "Take me there", P pauses / resumes the company tour (section 4f). **Double-click or L** = mouse look (the mouse is captured, a crosshair shows); **Esc** releases the mouse, the next Esc gives the keys back to the page. The "?" button lists every key; the first walk shows "W A S D to walk · drag to look · click the floor to go there" once (per browser). Every walk starts on the ground floor, outside the main entrance and facing it (or at the layout's spawn point); you never start or land inside a wall or furniture |

---

## 10. Good to know

- **Several viewers on one page** work; each `onEvent` gets only its own viewer's events, and `registerAction` only acts in its own viewer.
- **`AHDUSWorkplace.bridge`** is `layoutBridge` (`docs/TEAM_INTEGRATION.md`), for modules that need more than `onEvent`, e.g. `bridge.getPlayer()` (where the character is) or `bridge.getScene()` (to draw your own 3D things, such as a character).
- **Keyboard:** while walking, the view takes the keys when walking starts, when the mouse is over it, when the user presses on it or tabs to it (a blue focus ring shows for Tab only), and again right after the user uses the view's own buttons (Back to entrance, Find, "?", a card's buttons). It never takes them while the focus is in a text field (the search box, or a field of your page), and it doesn't move the focus out of your page's own fields or buttons. With the mouse away from the view and the focus on your page, typing, Tab, Space and Page Up / Page Down work on your page as always, and the character doesn't move. The arrows and Space stop scrolling your page only while the view has the keys. Esc gives them back (after mouse look: the second Esc). The viewer never captures the mouse by itself (only on a double-click or L). The view is one Tab stop, and Tab moves focus as on any page, also out of the view.
- Nothing is saved from the embed. Layouts are built and saved in Workplace Studio.
- Size: ≈ 500 kB gzipped. Serve `.js` files compressed (gzip or brotli) and let browsers cache it.

---

## 11. Testing (in this repo)

- `npm run build:embed`, then open `embed-test.html` through any web server, e.g. `npm run dev` → <http://localhost:3000/embed-test.html>. It loads only the embed file, shows a sample office (`embed-sample.ahdus.json`: reception, 2 offices, a training room with a CNC machine, 2 floors with stairs), lists every `onEvent` call, registers "E · Watch CNC training video", and has a text field, a button and content below the view to try the keys with. `?mode=view` orbits; `?layoutUrl=missing.json` shows the page's own fallback.
- `npm run e2e:embed` (24 checks, `e2e/embed-smoke.mjs`) builds the file and tests all of the above from a plain static server, with no dev server needed.
- `npm run e2e:characters` (`e2e/characters-smoke.mjs`): 21 people with the placeholder figures (section 4b): full characters near the camera, each file once, seated poses, the card (text only, no email), a click keeps it, a tap on a phone shows it, "Choose your character" on your own card, per floor, walking up to a desk, `quality: 'low'`. No dev server needed either.
- Code: `src/embed/index.jsx` (`mount`), `src/embed/embedLayout.js` (loading, matching; unit tests in `src/embed/__tests__/`), `src/embed/characterManifest.js` (the manifest, `setPeople`'s list), `vite.embed.config.js`. People: `src/engine/systems/CharacterSystem.ts`, `src/play/people.js`.
