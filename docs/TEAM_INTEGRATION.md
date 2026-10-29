# Connecting your module to the company layout

**For:** Harsh, Karthik, Yashashwi, Dhruv, Sunil & Kavyashree
**Owner of the layout module:** Himan
**Status:** working in Workplace Studio's Preview and in viewers (`<LayoutViewer />`, 22 Oct 2026)

The layout module is the 3D company building. It knows **where** things are (desks, chairs, machines, reception desks) and **when** the user does something (presses **E** on an object, walks into a room). Your module decides **what happens**: play a video, start a conversation, show handover notes.

You never need to change the layout code. Everything goes through one object:

```js
import { layoutBridge } from '@/integration/layoutBridge';
```

On a plain HTML page (no React, no build step) the 3D view comes from one file, `ahdus-workplace.js`, and the bridge is `AHDUSWorkplace.bridge`; see `docs/EMBED_GUIDE.md`.

---

## 1. Try it in 2 minutes

1. `npm install`, then `npm run dev`
2. Open **http://localhost:3000/?demoModules=1**. A yellow "Demo modules on" label appears.
3. In Build mode:
   - Press **B**, open **Industrial** and place a **CNC Machine**. Walk up to it and look at it: the screen shows **E Watch CNC Machine video**. Press E.
   - Place a **Reception Desk** inside a **Reception** room. A demo HR character appears behind it; walking into the room greets you; E on the desk says "Talk to HR".
   - Place a **Desk**, press **Tab** for the planner, click the desk, and pick a position under **Linked position** (e.g. Engineering Head). Back in Build mode (Tab), E on the desk shows the **handover notes**.
4. Open the browser console: every event is printed as `[AHDUS event] ...`. You can also try `ahdus.getAnchors()` there.

The fake modules live in `src/integration/demoModules.js`. **Copy your block from there as a starting point.**

---

## 2. Hook points ("anchors")

Placing certain objects creates hook points automatically. They move with the object, and their **ID never changes**, so you can safely store it in your own database.

| Kind | Created by | Used by | Position |
|---|---|---|---|
| `seat` | Office chair, sofa | Harsh (sitting characters) | Seat height, facing like the chair |
| `workstation` | Standard desk, L-shape desk | Yashashwi (position links), Harsh | Desk-top height |
| `reception` | Reception desk | Harsh (HR / greeter character) | Visitor side, 1.2 m in front, **facing the desk** |
| `machine` | CNC machine, lathe, server rack, printer, projector screen, TV, vending/coffee machine | Karthik (videos, manuals) | 0.8 m in front of the machine |
| `spawn` | Spawn point marker | Harsh (where characters appear) | On the marker |

Each anchor looks like this:

```js
{
  id: '0b6a…',            // stable UUID: save this in your module
  kind: 'workstation',
  objectId: 'obj_12',     // the desk / machine it belongs to (new items: 'obj_<uuid>'; treat ids as opaque strings)
  roomId: 'room_3',       // null if outside any room (new rooms: 'room_<uuid>')
  floorId: 0,
  position: { x, y, z },  // metres, world space (y includes the height of the floors below: Floor 1 starts at 3.5 m on standard floors)
  rotationY: 1.57,        // radians, the way it faces (0 = +Z / north)
  positionRef: 'pos-eng-head', // only if linked (see Yashashwi)
  label: 'Desk E-12',          // only if named
}
```

---

## 3. API

### Reading

| Call | Returns |
|---|---|
| `getAnchors({ kind?, roomId?, floorId?, objectId? })` | Anchors matching the filter |
| `getAnchor(id)` / `getAnchorsByRoom(roomId)` | One anchor / a room's anchors |
| `getObject(objectId)` | `{ id, assetType, label, category, department, roomId, floorId, position, rotationY, isLocked }` |
| `getRoom(roomId)` / `getRooms({ floorId? })` | `{ id, name, type, typeLabel, floorId, center, width, depth }` |
| `getCurrentFloor()` | `{ id, name }` |
| `getPlayer()` | `{ position, yaw, roomId }`, or null when no one is walking (Studio's Preview or a viewer's walkthrough) |
| `getScene()` | The Babylon.js scene, for drawing your own 3D things |

### Writing (undoable with Ctrl+Z, saved with the layout)

| Call | What it does |
|---|---|
| `setPositionRef(anchorId, positionId \| null)` | Link a desk to an org position, or remove the link |
| `setAnchorLabel(anchorId, label)` | Give a hook point a name |

Both return `false` (and change nothing) when the anchor doesn't exist, or when the layout in use can't be changed: a viewer in `view` or `walkthrough` mode (employees only look and walk).

### Events

```js
const stop = layoutBridge.on('interact', (target) => { … });
stop(); // stop listening
```

| Event | When | Payload |
|---|---|---|
| `interact` | User presses **E** on an object, door or window within 3.5 m | target (below) |
| `enterRoom` | Character walks into a room (also when Build mode starts inside one) | `{ roomId, room, floorId, fromRoomId }` |
| `exitRoom` | Character leaves a room (also when leaving Build mode) | `{ roomId, room, floorId, toRoomId }` |
| `anchorsChange` | Any hook point is added, removed, moved or re-linked | `{ anchors }` (all of them) |

The **target** for `interact` (and for `addInteraction` below):

```js
{
  kind: 'object' | 'door' | 'window',
  objectId, object,          // object as in getObject(), or null
  anchors, anchor,           // all of the object's anchors, and the main one
  anchorId, anchorKind,      // main anchor (machine > reception > workstation > seat > spawn)
  positionRef,               // main anchor's linked position, if any
  roomId, room, floorId,
  point: { x, y, z },        // where the user was looking
  distance,                  // metres from the character
}
```

### Press E: adding an action

```js
const remove = layoutBridge.addInteraction({
  id: 'karthik.machine-video',                 // unique; adding the same id again replaces it
  when: (t) => t.anchorKind === 'machine',     // which targets
  label: (t) => `Watch ${t.object.label} video`, // shown on screen as "E Watch …"
  run: (t) => { /* open your UI */ },
});
```

- When the user looks at something, **the first registered interaction whose `when` matches** decides the on-screen prompt and runs on E.
- If no interaction matches, E shows a small info card (hook point, room, linked position).
- `label` may be a string or a function; return `null` from it to skip this interaction for that target.

### Showing something (temporary)

```js
layoutBridge.showCard({ title: 'CNC Machine', body: 'Line one\nLine two', duration: 6000 });
```

A simple card in Build mode, until Dhruv's app shell gives each module its own UI area.

---

### In a viewer: which layout the bridge uses

Most of your modules will run inside a **viewer**, `<LayoutViewer mode="walkthrough" />` (see `LAYOUT_ENGINE_API.md`), not in Workplace Studio. The bridge works the same there, with the same calls and events. Walking into rooms gives `enterRoom` / `exitRoom`, pressing E gives `interact` and runs your "Press E" action, and `getScene()` is the viewer's scene.

Each viewer keeps its own copy of the layout, and Studio uses the app's. When more than one is on the page, the bridge uses **one** of them:

1. The one in **edit** (Studio) or **walkthrough** mode. A `view`-mode viewer only shows the layout, so it doesn't take the bridge from Studio.
2. If several qualify, the one **mounted last**.
3. When it closes, the bridge goes back to the one before it (no viewer and no Studio: the app's saved layout).

`anchorsChange` fires when the bridge switches to a layout with other anchors. Events (`enterRoom`, `interact`, …) come from whichever one the user is walking in. A viewer made with `<LayoutViewer />` or `<LayoutEditor />` is connected for you. If you use `LayoutEngine` directly, call `connectEngine(engine)` from `@/integration/layoutBridge` (it returns `disconnect`).

### The realistic look and its files (`quality`, `assetBaseUrl`)

By default the workplace has the **realistic look**: real furniture models, photo textures on floors and walls and
a photographed sky. They are files in an `assets/` folder (`models/`, `textures/`, `env/`, ≈ 2.8 MB, all CC0:
`docs/ASSET_LICENSES.md`), loaded after the workplace is drawn; until then, or if a file can't be loaded, the simple
look shows (a warning in the console, never an error). Nothing in the bridge changes: anchors, events, positions,
`getScene()` and the item meshes' `metadata.objectId` are the same in both looks. An item drawn by a real model also
has `metadata.model` on its mesh (e.g. `'desk'`); don't depend on it.

| Where | Option | Default |
|---|---|---|
| `<LayoutViewer />`, `LayoutEngine.create(canvas, …)` (and `<LayoutEditor />` in view / walkthrough mode) | `quality: 'low'` = the simple look, nothing downloaded; `assetBaseUrl` = where `assets/` is | `'high'`; the app's `public/assets/` (`/assets/`) |
| `AHDUSWorkplace.mount(element, …)` (plain HTML pages, `docs/EMBED_GUIDE.md`) | the same two options | `'high'`; `assets/` next to `ahdus-workplace.js` |
| Workplace Studio (and `<LayoutEditor />` in edit mode) | Settings → **Realistic look** (kept per browser); files from `/assets/` | on |

If your app serves the files from somewhere else (a CDN, another path), pass the folder's URL, ending in `/`:
`<LayoutViewer assetBaseUrl="https://cdn.example.com/ahdus/assets/" … />`.

## 4. Recipes per teammate

### Harsh: characters and voice

```js
const scene = layoutBridge.getScene();

function placeCharacters() {
  // remove your old meshes first, then:
  for (const seat of layoutBridge.getAnchors({ kind: 'seat' })) {
    // put a sitting character at seat.position, rotated by seat.rotationY
  }
  for (const desk of layoutBridge.getAnchors({ kind: 'reception' })) {
    // the anchor faces the desk: stand 2 m along that direction to be behind it,
    // and turn around (rotationY + Math.PI) to face visitors
  }
}
placeCharacters();
layoutBridge.on('anchorsChange', placeCharacters); // desks moved / added / removed

layoutBridge.on('enterRoom', ({ room }) => {
  if (room.type === 'RECEPTION') { /* greet the user */ }
});
layoutBridge.addInteraction({
  id: 'harsh.talk-hr', when: (t) => t.anchorKind === 'reception', label: 'Talk to HR',
  run: (t) => { /* start the conversation */ },
});
```

Rules: add your own meshes to the scene, set `isPickable = false` on them unless you want them under the crosshair, and **never dispose or change the layout's meshes or materials** (materials are shared between objects).

The player character is a placeholder in `src/play/character.js`. Yours can replace it as long as it provides `{ root, update(dt, speed, flying), setVisible(bool), dispose() }`.

### Karthik: machine videos and files

```js
layoutBridge.addInteraction({
  id: 'karthik.machine-video',
  when: (t) => t.anchorKind === 'machine',
  label: (t) => `Watch ${t.object.label} video`,
  run: (t) => openVideoFor(t.objectId),   // look up your files by objectId
});
```

Store your videos and manuals against the **objectId** (or the machine **anchorId**). Both stay the same when the machine is moved.

### Yashashwi: previous employee handover

```js
// 1. Tell the layout which positions exist (the planner shows them in a dropdown)
layoutBridge.setPositionProvider(() => positions.map((p) => ({ id: p.id, title: p.title, department: p.dept })));

// 2. Show handover notes at a linked desk
layoutBridge.addInteraction({
  id: 'yashashwi.handover',
  when: (t) => t.anchorKind === 'workstation' && !!t.positionRef,
  label: 'See handover notes',
  run: (t) => showHandover(t.positionRef),
});

// 3. Find the desk of a position (e.g. to fly the camera there later)
const desk = layoutBridge.getAnchors({ kind: 'workstation' }).find((a) => a.positionRef === positionId);
```

Admins link a desk in the planner (click the desk → **Linked position**). Your module can also link one directly with `setPositionRef(anchorId, positionId)`.

### Sunil & Kavyashree: activity monitoring

```js
for (const e of ['interact', 'enterRoom', 'exitRoom']) {
  layoutBridge.on(e, (payload) => sendToActivityLog(e, payload));
}
```

The user and company should be added **by the backend from the login**, not trusted from these events. Layout edits (add/move/delete) are not events yet; they will come with versioned saving.

### Dhruv: app shell

- Rooms in the v2 layout JSON have `wallThickness` (metres, 0.1 to 0.6; missing = 0.15, the old fixed thickness), next to `wallHeight`. Walls are centred on the room's edge. Nothing else changed: older files still load.
- Mount `<LayoutEditor layout={json} mode="edit" onChange={save} />` for admins and `<LayoutViewer layout={json} mode="walkthrough" />` for employees (`src/engine/react`, props in `LAYOUT_ENGINE_API.md`). You fetch the layout JSON and save what `onChange` gives you (v2).
- `layoutBridge` is the same object whichever page imports it, and follows the rule above when Studio and viewers share a page.
- `showCard` is temporary. When your shell has a panel area, modules should render there instead.

---

## 5. Limits right now

- Events and E-interactions happen while walking: Studio's **Preview**, or a viewer in **walkthrough** mode (not in Studio's planner, not in a `view`-mode viewer).
- Multi-storey: anchor and object positions are world positions (an object on Floor 1 is one floor height higher, 3.5 m by default; floors can be taller). Use `floorId` to tell floors apart; the `getPlayer()` result and room events follow the floor the character is on.
- `showCard` is a placeholder UI.
- Layout data is saved in the browser (localStorage) until the backend exists. Links (`positionRef`) are saved with it.
