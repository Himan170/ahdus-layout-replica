# AHDUS Layout Engine — Integration API

**Module:** Company Digital Twin (Layout Replica)  
**Owner:** Himan  
**Version:** Draft 1 — 11 October 2026, updated 22 October 2026  
**Status:** Built (see the status table below); the package name is still to come

---

## Implementation Status (read this first)

As of 22 Oct 2026 (TEAM_TASKS H2 done): `LayoutEngine` draws a layout on its own, and `<LayoutViewer />` / `<LayoutEditor />` mount it in any page. The blank test page `viewer.html` (`e2e/viewer-smoke.mjs`) mounts `<LayoutViewer mode="walkthrough" />` with no editor UI loaded. There is no `@ahdus/layout-engine` package yet: import from `src/engine` (`@engine`) and `src/engine/react` (`@engine/react`).

| Part | Status |
|---|---|
| Layout v2 schema (Zod) + v1 → v2 migration, and back (`toV1`): a save, an exported file or v2 in, the same v2 out | ✅ Done, tested |
| Anchors: auto-created, stable IDs, follow their object, keep `positionRef`/`label` | ✅ Done, tested |
| Command history: every edit is undoable (`src/store/editorHistory.js`, also `engine.editor`) | ✅ Done, tested, used by Workplace Studio |
| `loadLayout`, `getLayout`, `getAnchors`, `getAnchorsByRoom`, `getObjectById`, `on`/`off` events | ✅ Done, tested |
| `setFloor`, `setView`, `focusOn`, `fitView`, `highlight`, `clearHighlights` | ✅ Done, tested |
| `setMode`: `edit`, `view`, `walkthrough`; outside `edit` every edit is refused (TEAM_TASKS H3's test) | ✅ Done, tested |
| Systems in `engine/systems/`: `SceneSetup`, `RoomSystem`, `ObjectSystem`, `FloorSystem`, `CameraSystem`, `HighlightSystem`, `WalkthroughSystem` | ✅ Done, tested (Studio draws with the first four). `PlacementSystem`, `SelectionSystem` are still stubs |
| `<LayoutViewer />` (view / walkthrough) and `<LayoutEditor />` (edit = today's Workplace Studio) | ✅ Done; `e2e/viewer-smoke.mjs` |
| `layoutBridge` in viewers (teammates' modules, "Press E" actions) | ✅ Done (`connectEngine`; rule in `TEAM_INTEGRATION.md`) |
| `quality="low"` | ⏳ Accepted, changes nothing yet (TEAM_TASKS H7) |
| `onSelect` in a viewer, clicking things in `view` mode | ⏳ Not yet (Studio's selection, through `<LayoutEditor />`, works) |
| **Team integration (`src/integration/layoutBridge.js`)** | ✅ **Use this now.** Anchors live in the editor and are saved with the layout; `interact`, `enterRoom`, `exitRoom`, `anchorsChange` events; "Press E" actions; linking desks to positions (undoable). See **`docs/TEAM_INTEGRATION.md`** |

Teammates should connect through **`layoutBridge`** today (see `docs/TEAM_INTEGRATION.md`). It uses the same Anchor type and event names as this document, and `LayoutEngine` will offer the same calls once the engine/UI split is done.

---

## 1. Overview

The Layout Engine is the core 3D/2D runtime that owns the building geometry: floors, rooms, walls, doors, furniture, equipment, and routes. It does **not** own characters, videos, file attachments, login, or the app shell — it provides **hooks** so those modules can plug into the spatial model.

This document defines two things your module needs to know:

1. **The Engine API** — how Dhruv's frontend mounts and controls the layout
2. **Anchors** — how Harsh, Karthik, and Yashashwi attach their features to physical locations

---

## 2. Engine API (for Dhruv)

Dhruv's AHDUS app mounts the layout as a React component or instantiates the engine class directly.

### 2.1 React Component

```tsx
import { LayoutEditor, LayoutViewer } from '@engine/react';   // later: '@ahdus/layout-engine/react'

// Admin / designer: Workplace Studio (for now <LayoutEditor mode="edit"> wraps today's Studio)
<LayoutEditor
  layout={layoutJson}             // the layout you fetched: a save, an exported file or v2
  mode="edit"                     // "edit" | "view" | "walkthrough" (view / walkthrough show a viewer)
  onReady={(handle) => { ... }}   // edit: { mode: 'edit', getLayout() }; else the viewer's LayoutEngine
  onSelect={({ entityId, entityType }) => { ... }} // a room or an item was selected
  onChange={(layoutV2) => save(layoutV2)}          // the layout changed (v2; at most every 300 ms)
  onExit={() => { ... }}          // Studio's "All layouts" was clicked
/>

// Employee / visitor: read-only, look around or walk through
<LayoutViewer
  layout={layoutJson}
  mode="walkthrough"              // "view" (orbit) | "walkthrough" (W A S D, mouse, E, Page Up / Down)
  quality="low"                   // accepted; changes nothing yet (H7)
  onReady={(engine) => { ... }}   // the LayoutEngine (focusOn, highlight, getAnchors, …)
  onInteract={({ anchorId, objectId, roomId, part }) => { ... }}
  onEnterRoom={({ roomId, roomName, fromRoomId }) => { ... }}
  onExitRoom={({ roomId, toRoomId }) => { ... }}
  onCard={(card) => { ... }}      // a card was shown (to show it in your own panel)
  onError={(error) => { ... }}    // the layout could not be loaded
/>
```

Instead of `layout`, both take `companyId` + `layoutId`: a layout saved in this browser (our test page uses it). Giving `<LayoutEditor />` back the layout `onChange` gave you doesn't reload Studio. Both connect to `layoutBridge` for you.

### 2.2 Imperative Engine API

When you need more control (or aren't using React), use the engine class directly:

```ts
import { LayoutEngine } from '@ahdus/layout-engine';

// Create engine attached to a canvas element
const engine = await LayoutEngine.create(canvas, {
  mode: 'edit',        // "edit" | "view" | "walkthrough"
  quality: 'high',     // "high" | "low"
});

// --- Loading & Reading Data ---
engine.loadLayout(layoutJson);       // A save, an exported file or v2 (throws on bad data)
engine.getLayout(): Layout;          // The current layout as v2 (null before loadLayout)

// --- Navigation ---
engine.setFloor(floorId);            // Switch to a specific floor
engine.setView('3d');                // Switch between "3d" and "2d" views
engine.focusOn(entityId);            // Fly to a room, object or anchor (false if unknown)
engine.fitView();                    // The whole building in view
engine.highlight(entityIds, color?); // Highlight entities (e.g., for training,
                                     // explanations, or search results)
engine.clearHighlights();            // Remove all highlights

// --- Querying ---
engine.getAnchors(): Anchor[];                    // Get all anchors in the layout
engine.getAnchors({ kind: 'seat' }): Anchor[];    // Filter by kind
engine.getAnchorsByRoom(roomId): Anchor[];        // All anchors in a room
engine.getObjectById(objectId): LayoutObject;     // Look up any placed object

// --- Events ---
engine.on('select', (entity) => { ... });           // Object or room was selected
engine.on('change', (event) => { ... });            // Any state mutation happened
engine.on('enterRoom', ({ roomId }) => { ... });    // Walkthrough: entered a room
engine.on('interact', ({ anchorId, objectId }) => { ... }); // E key / click in walkthrough

// --- Mode and edits ---
engine.setMode('walkthrough');       // "edit" | "view" | "walkthrough"
engine.editor.addRoom({ ... });      // every Studio edit (store/editorHistory.js); outside edit mode
                                     // each one changes nothing and returns { problem }
engine.undo(); engine.redo();        // false outside edit mode
engine.on('exitRoom', ({ roomId, toRoomId }) => { ... });

// --- Cleanup ---
engine.dispose();  // Destroy the Babylon scene and release GPU resources
```

Without React: `connectEngine(engine)` from `src/integration/layoutBridge.js` connects an engine to the bridge (call the function it returns before `dispose()`).

### 2.3 Notes for Dhruv

- The engine handles its own canvas sizing — just give it a container div and mount `<LayoutEditor />` inside it.
- The engine does **not** handle authentication or API calls. The app shell (Dhruv's frontend) fetches the layout JSON from the backend and passes it as `layout` (or to `loadLayout()`). Saving: `<LayoutEditor onChange>` gives you the layout (v2) to POST, or call `engine.getLayout()`.
- The `mode` determines what the user can do:
  - `"edit"` — Workplace Studio: Build panel, Inspector, gizmos, its Preview
  - `"view"` — read-only 3D view, can orbit and zoom but not change anything
  - `"walkthrough"` — Preview's character (third person; V switches to first person), W A S D, mouse, E; interactions fire events; nothing can be changed
- Role-based mode selection (admin = edit, employee = walkthrough) is Dhruv's responsibility — the engine just follows the mode it's given.

---

## 3. Anchors (for Harsh, Karthik, Yashashwi)

An **anchor** is a named point in the 3D layout that another module attaches behavior to. The layout engine creates and stores anchors; other modules read and react to them.

### 3.1 Anchor Type Definition

```ts
type Anchor = {
  id: string;                // Stable UUID — never changes once created
  kind: AnchorKind;          // What this point is for (see below)
  floorId: string;           // Which floor it's on
  roomId: string;            // Which room it's in
  position: {                // World-space coordinates in meters
    x: number;
    y: number;
    z: number;
  };
  rotationY: number;         // Facing direction in radians (0 = +Z / north)
  objectId?: string;         // The furniture/machine this anchor belongs to
                             // (e.g., the desk a "seat" is attached to)
  positionRef?: string;      // Org position ID (filled by Yashashwi's module)
  label?: string;            // Human-readable name (e.g., "Reception Desk A")
};

type AnchorKind =
  | 'seat'           // Chair/seat position — Harsh places characters here (seated animation)
  | 'workstation'    // Desk + chair combo — Yashashwi links employee roles to this
  | 'spawn'          // Entry/start points — where characters appear by default
  | 'machine'        // Equipment point — Karthik attaches videos and manuals here
  | 'info-point'     // General information marker — any module can show info
  | 'reception';     // Reception desk anchor — Harsh places the HR/greeter character here
```

### 3.2 How Anchors Are Created

Anchors are created **automatically** by the layout engine when certain objects are placed:

| Object placed | Anchor auto-created | Position |
|---|---|---|
| Office Chair | `seat` anchor | At the seat center, facing the desk |
| Standard Desk + Chair | `workstation` anchor | At the desk center |
| Reception Desk | `reception` anchor | On the visitor-facing side |
| Any machine/equipment (Server Rack, Printer, etc.) | `machine` anchor | In front of the machine |
| Spawn Point marker | `spawn` anchor | At the marker position |

The designer can also manually add, move, or delete anchors from the editor. The `objectId` links the anchor to the furniture it's attached to — if the desk is moved, its anchor moves with it.

### 3.3 Who Uses What

| Teammate | Anchor kinds they care about | What they do with it |
|---|---|---|
| **Harsh** (Characters) | `seat`, `workstation`, `spawn`, `reception` | Places animated characters at anchor positions. A character at a `seat` uses a sitting animation at the correct height and rotation. A character at a `spawn` uses a standing/walking animation. The `reception` anchor is where the HR/greeter character stands. |
| **Karthik** (Machine videos) | `machine`, (also reads `objectId` directly) | Attaches operation videos and PDF manuals to equipment. When a user interacts with a machine in walkthrough mode, Karthik's module opens the video/file. Uses `objectId` to identify which machine. |
| **Yashashwi** (Employee handover) | `workstation` + `positionRef` | Links workstations to organizational positions. "This was the Engineering Lead's desk — here's what they worked on." The `positionRef` field holds the org-chart position ID (Yashashwi's system sets this, the layout engine just stores it). |

### 3.4 Integration Pattern

```ts
// Example: Harsh's character module
const engine = getLayoutEngine(); // from Dhruv's app context

// Get all seat anchors to know where characters can sit
const seats = engine.getAnchors({ kind: 'seat' });
seats.forEach(seat => {
  characterSystem.placeCharacter(seat.id, {
    position: seat.position,
    rotationY: seat.rotationY,
    animation: 'sitting',
  });
});

// React to interactions in walkthrough mode
engine.on('interact', ({ anchorId, objectId }) => {
  const anchor = engine.getAnchors().find(a => a.id === anchorId);
  if (anchor?.kind === 'reception') {
    characterSystem.startDialogue(anchorId, 'welcome-greeting');
  }
});
```

```ts
// Example: Karthik's machine video module
engine.on('interact', ({ anchorId, objectId }) => {
  if (objectId) {
    const obj = engine.getObjectById(objectId);
    if (['SERVER_RACK', 'PRINTER', 'PROJECTOR_SCREEN'].includes(obj.assetType)) {
      videoModule.openMachineVideo(objectId);
    }
  }
});
```

```ts
// Example: Yashashwi's employee handover module
const workstations = engine.getAnchors({ kind: 'workstation' });
const linkedStations = workstations.filter(w => w.positionRef);

// When user clicks "Show previous employee's work" in the UI
engine.focusOn(linkedStation.objectId);  // Camera flies to the desk
engine.highlight([linkedStation.objectId], '#FFD700');
handoverModule.showEmployeeHistory(linkedStation.positionRef);
```

### 3.5 Interaction Events

When a user is in walkthrough mode and presses E (interact key) or clicks on an object:

```ts
engine.on('interact', (event) => {
  event.anchorId   // string | null — the anchor nearest to the interaction point
  event.objectId   // string | null — the object that was clicked/interacted with
  event.position   // { x, y, z } — world-space point of interaction
  event.roomId     // string — the room the user is currently in
});

engine.on('enterRoom', (event) => {
  event.roomId     // string — room being entered
  event.floorId    // string — floor the room is on
  event.roomName   // string — human-readable room name
  event.roomType   // string — "OPEN_OFFICE", "SERVER_ROOM", etc.
});
```

Other modules listen to these events and respond with their own UI (dialogue, video player, info panel). The layout engine fires the event — it never opens the dialogue or video itself.

---

## 4. Data Ownership Boundaries

| Data | Owned by | Layout engine's role |
|---|---|---|
| Building geometry (walls, floors, rooms, doors) | Himan (layout engine) | Full CRUD |
| Furniture & equipment placement | Himan (layout engine) | Full CRUD |
| Anchor positions & kinds | Himan (layout engine) | Creates, stores, moves with objects |
| `positionRef` on anchors | Yashashwi (org chart module) | Stores the value — does not interpret it |
| Character models & animations | Harsh (character module) | Engine provides position via anchors |
| Video/file attachments on machines | Karthik (file module) | Engine provides `objectId` via events |
| Login, auth tokens, user sessions | Sunil & Kavyashree | Engine does not touch auth |
| App shell, routing, page layout | Dhruv (frontend) | Engine runs inside Dhruv's app |

### 4.1 What the Layout Engine Does NOT Do

- It does **not** fetch user data or validate auth tokens. The app shell does that.
- It does **not** render characters, play videos, or show employee histories. Other modules do.
- It does **not** send `company_id` as trusted data. The backend determines the tenant from the login session.
- It does **not** store files. Karthik's module handles file upload/storage; the engine just provides the `objectId` for linking.

---

## 5. Next Steps

1. **Team meeting**: Walk through this doc together. Confirm the anchor kinds cover everyone's needs. Add new kinds if needed.
2. **Dhruv**: Confirm the React component API shape works for the app shell. Discuss mode switching (edit vs. view vs. walkthrough) and how layout JSON flows between backend and engine.
3. **Harsh**: Confirm `seat` / `spawn` / `reception` anchors give enough spatial info for character placement. Do you need a `standingHeight` or `seatHeight` property?
4. **Karthik**: Confirm `machine` anchors + `objectId` on interact events are enough. Do you need a list of attached files stored on the anchor, or will you query your own DB by `objectId`?
5. **Yashashwi**: Confirm `positionRef` on `workstation` anchors is the right linkage point. What API will you expose for the layout engine to call `setPositionRef(anchorId, positionId)`?
6. **Sunil & Kavyashree**: Review the `change` event shape. What fields do you need for activity monitoring?
