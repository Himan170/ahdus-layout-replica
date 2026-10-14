# Connecting your module to the company layout

**For:** Harsh, Karthik, Yashashwi, Dhruv, Sunil & Kavyashree
**Owner of the layout module:** Himan
**Status:** working in the editor's Build mode (13 Oct 2026)

The layout module is the 3D company building. It knows **where** things are (desks, chairs, machines, reception desks) and **when** the user does something (presses **E** on an object, walks into a room). Your module decides **what happens**: play a video, start a conversation, show handover notes.

You never need to change the layout code. Everything goes through one object:

```js
import { layoutBridge } from '@/integration/layoutBridge';
```

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
  objectId: 'obj_12',     // the desk / machine it belongs to
  roomId: 'room_3',       // null if outside any room
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
| `getPlayer()` | `{ position, yaw, roomId }`, or null outside Build mode |
| `getScene()` | The Babylon.js scene, for drawing your own 3D things |

### Writing (undoable with Ctrl+Z, saved with the layout)

| Call | What it does |
|---|---|
| `setPositionRef(anchorId, positionId \| null)` | Link a desk to an org position, or remove the link |
| `setAnchorLabel(anchorId, label)` | Give a hook point a name |

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

- The editor is still mounted as `<WorkplaceEditor />`. The embeddable `<LayoutEditor />` / `<LayoutViewer />` from `LAYOUT_ENGINE_API.md` is the next big step.
- `layoutBridge` works as long as the editor is open, and is the same object whichever page imports it.
- `showCard` is temporary. When your shell has a panel area, modules should render there instead.

---

## 5. Limits right now

- Events and E-interactions happen in **Build mode** only (not in the planner).
- Multi-storey: anchor and object positions are world positions (an object on Floor 1 is one floor height higher, 3.5 m by default; floors can be taller). Use `floorId` to tell floors apart; the `getPlayer()` result and room events follow the floor the character is on.
- `showCard` is a placeholder UI.
- Layout data is saved in the browser (localStorage) until the backend exists. Links (`positionRef`) are saved with it.
