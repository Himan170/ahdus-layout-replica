# Changelog

What changed in each version, newest first. Older versions (up to 0.14.9) are listed in the "DONE" sections of
`CLAUDE.md` and in the git tags.

## 0.15.3 (11 Nov 2026): Check my layout

- **Check** in Studio's top bar lists problems by floor: rooms with no door, no entrance, places nobody can
  walk to, furniture overlapping or in walls, blocked doors/windows, items outside rooms upstairs, and stair problems.
- Click a problem to switch floors, select it and focus the camera. The floating panel stays open beside the
  Inspector; on a phone, Check is in More and opens a bottom sheet.
- **Ignore / Show again** are saved with this layout, with one undo step per action. Saving and publishing
  always remain available. AHDUS's Publish dialog links to the check when problems are present.
- Checks run on demand and after 1.5 seconds without changes, in idle time; they wait during drags and Preview.
- **Data:** optional `ignoredChecks: string[]` in v1/v2 layouts and the generated JSON Schema. Old layouts start
  with no ignored problems. Export/import and version restore preserve the list.
- On the 72-room / 864-item performance layout: 132 ms cold, 112 ms with cached maps.
- Pure rules in `play/navigation/checkLayout.js`; Studio shares walking's map cache. The viewer's controls stay as before.

## 0.15.2 (10 Nov 2026): easy Walk through

### Walk through (Preview)
- **The viewer's easy controls:** the mouse no longer disappears. Drag (left or right button) to look around; W A S D
  walk at once, with no "Start preview" screen (the list of keys opens from the "?" button).
- **Everything is aimed at the mouse**, not at the middle of the view: placing, G / middle-click, right-click, E, Edit
  item, Stretch, doors and windows.
- **An empty hand walks:** a click on the floor walks there (the same routes and line as the 3D Company viewer); a
  click on an item walks up to it. An empty hand moves and removes nothing (G still picks an item up).
- **An item or a tool in your hand builds:** a click uses it where the mouse points and never walks; a slow, careful
  click counts too. Esc cancels what is half done, then puts the item away; the number of the slot you hold does too.
- **Mouse look is an option:** M, or the "Mouse look" button, captures the mouse with a crosshair in the middle, as
  before; Esc gives it back.
- **G / Edit item on a desk takes its chair and what stands on it**, and puts them down together. R turns the group.
  One undo step.
- **Hotbar and catalog:** a short name under each hotbar icon, a different icon for each room type, "Add to hotbar"
  (was "Choose an item for slot N"), and the catalog shows the same pictures as Studio's library.

### Workplace Studio
- **Turning a room turns what is in it:** R and the selection bar's Rotate turn the furniture and the rooms inside it
  with the room, around its centre. One undo step. Refused with a reason when the turned room would overlap another
  room, not fit the room it stands in, or share a door or window with a room that stays.
- **The chair follows the move arrows live**, not only when the arrow is let go, and the Inspector's X / Z follow
  every drag.
- **Floor-only items stay on the floor:** only small things (monitor, laptop, keyboard, mouse, Desk Plant, coffee
  machine, microwave, printer, first aid kit) go on a table top. A Large Plant over a desk turns red: "Large Plant
  stands on the floor". A rug and the floor markers count as the floor. Layouts saved before are not changed.

### Fixed
- Plan view: a desk dragged onto the spot where its own chair stood landed on that chair (Height 1.10 m).
- The catalog panel slid off the bottom of the view when its list was taller than the view.
- The room tool's hint said "Meeting Room room".

### For developers
- `playController`: with `look: 'drag'` and no `isEngaged` (Studio's Walk through) it is in **mouse aim**: `aimLine()`
  goes through the mouse; options `onEmptyHand`, `onDeactivate`; `setKeysPaused`, `setPointer`, `clickAt`, `getAim`,
  `aimsAtMouse` (tests). A viewer's walkthrough (on a page) and `look: 'lock'` are unchanged.
- Studio makes its own `NavigationSystem` + `RouteLineSystem` for a click's walk (`hooks/useStudioScene.js`).
- `geometry.planRoomTurn(room, rooms, objects)` also returns the rooms and items that turn; `editor.turnRoom(id, plan)`.
- `carry.carryDrop` (pure); `utils/itemRiders.js` (`ridersOf`, shared by both modes); `utils/livePosition.js`;
  `building.canStandOn`, `TABLE_TOP_TYPES`, `FLOOR_LIKE_TYPES`; `planMath.planCarried`; `planDrop` may return
  `{ problem }`; `hotbarItems.shortLabel`; `tools.ROOM_ICONS`; `ui/ItemPicture.jsx`; `dragLook` presses can be `patient`.
- e2e scripts that aim with the crosshair turn mouse look on with M (there is no "Start preview" button any more).

## 0.15.1 (9 Nov 2026): easy building, part 2

### Workplace Studio
- **A desk takes its chair along:** dragging a desk, the arrow keys, R, typing its X / Z in the Inspector and Plan
  view move or turn its chair with it (the chair that faces it, as for the people at desks) and what stands on it. The
  chair turns round the desk. One undo step.
- **Moving a room takes what is in it:** dragging a room by its floor, or typing its position (Inspector "Room X" /
  "Room Z"), moves its furniture and the rooms inside it too. One undo step.
- **One way to move and turn:** R turns the selected item 90° (Shift+R: 15°), in Studio and in Walk through. The move
  arrows show only after Move (the selection bar's Move, or W). Resize handles: S (was R). E (rotation rings) is gone.
  The Inspector's Rotation keeps its four buttons and the angle box (no slider). R on a room turns it only when no
  furniture stands in it ("Turning a room with its furniture comes later"; the selection bar's Rotate turns the room
  alone, as before).
- **Ctrl+S saves now** (Studio and Walk through), instead of the browser's "Save page as".
- **Focus on the selection:** double-click an item, room, door or window, or press F, and the camera flies to it.
  F with nothing selected still fits the whole building.
- **Inspector sizes in metres:** Width, Depth and Height in m (the saved data is unchanged); "Keep proportions" works
  on them. The hook-point note and "Linked position" are in a closed **Advanced** section.
- The selection bar sits above the item, clear of it and of the room labels, and hides while you drag.

### Walk through (Preview)
- **Starts with an empty hand:** walking first, building is a choice (1–9 or B picks an item). An item chosen in the
  catalog goes to a slot and is held at once.
- **The camera near walls:** it never ends up behind a wall under a low ceiling, slides behind your head (smoothly,
  over a quarter of a second, and back) before it pulls in, and the character hides when the camera is closer than 0.5 m (no more looking through your own head or
  the wall). First person (V) is unchanged.
- Catalog names: "Meeting Room", "Restroom", "Production Area" (no "Meeting Room room").

### Fixed
- The Small Office template: two workstation chairs faced away from their desks.

### For developers
- `editorHistory`: `moveRoom(id, plan, { label, mergeKey })` (the room, the rooms inside it and its items, one undo
  step); `moveObjects(moves, { label, mergeKey })` merges a burst (typing, arrow keys) into one step.
- `play/carry.js` (pure): `carriedBy`, `carryMoves`, `turnStep`, `turnText`. `geometry.planRoomMove(room, x, z, rooms,
  objects)` also returns the rooms and items that go along; `roomsInside`, `itemInRoom`.
- `plannerTools.moveItem(id, patch, { label, mergeKey })`: every move of one item (keys, Inspector, gizmo, Plan view)
  takes its chair and riders along.
- `playController.thirdPersonCamera`, `easeShoulder` (pure), `HIDE_CHARACTER_BELOW`, `SHOULDER_EASE_S`; `hotbarItems.EMPTY_HAND`, `nextSlot`,
  `catalogSlot`, `roomItemLabel`; `ui/selectionSpot.js`, `ui/itemSize.js` (pure, tested).

## 0.15.0 (9 Nov 2026): easy building

### Workplace Studio
- **Drag any item** with the Select tool: it follows the mouse onto the floor or onto a table top, and what stands on
  it (the monitor, the plant on a desk) comes along. One undo step for all of them. A click still selects; locked
  items stay put and say so.
- **Doors and windows in free-standing walls:** the Door or Window tool now works on a wall drawn with the Wall tool.
  The wall is cut around the door or window (one undo step). A wall that is too short, too low or locked says why.
- **Slide a door or window along its wall:** select it, then drag it (the blue handles still resize it). It moves in
  0.1 m steps, stops at the corners, and is refused next to another opening or the stairs. A door shared by two rooms
  moves in both.
- The move gizmo has no up arrow any more (items stand on the floor or a table top; the Inspector's Height still lifts
  one on purpose). Moving an item with the arrows or the keyboard also updates which room it is in.

### Preview
- **G or the middle mouse button** picks up the item you look at, whatever is in your hand. Click to put it down, R
  turns it, right-click cancels. With an empty hand a left-click picks it up too.
- **Edit item** (slot 9) on a door or window: click to pick it up, look along the wall to slide it, click to put it
  there.
- The Door and Window slots also work on walls drawn with the Wall tool.

### Fixed
- A Desk Plant (or another small item) that was selected, for example right after placing it, and then dragged onto
  a desk stayed on the floor. The move gizmo's arrows covered the whole plant and took the press, so the plant slid
  along one arrow at its old height. Now the nearest thing under the mouse wins: the item itself where it is in front,
  an arrow where it sticks out past the item.
- The door item's frame now sits on the door leaf (no gap to see through).

### For developers
- `editorHistory`: `moveObjects(moves, { label })` (several items, one undo step) and
  `replaceObjects(removeIds, addList, { label })` (remove and add items, one undo step).
- `geometry`: `planWallSegmentOpening`, `wallSegmentLine`, `WALL_ASSET_HEIGHT`, `moveOpening` (pure, tested in
  `src/play/__tests__/wallSegmentOpening.test.js`).
- `gizmoController`: `isPointerOver()` (the gizmo is under the mouse and in front of the item), `gizmoScene()`; dev
  hook `window.__ahdusGizmo`.
- e2e:tools: 58 checks (12 new).

### Known limits
- Preview's carry moves only the item, not what stands on it.
- A door cut into a free-standing wall can't slide or be resized like a room door; removing it leaves the gap
  (Ctrl+Z brings the whole wall back).
