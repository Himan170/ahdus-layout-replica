# Changelog

What changed in each version, newest first. Older versions (up to 0.14.9) are listed in the "DONE" sections of
`CLAUDE.md` and in the git tags.

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
