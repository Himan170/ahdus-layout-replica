# Changelog

What changed in each version, newest first. Older versions (up to 0.14.9) are listed in the "DONE" sections of
`CLAUDE.md` and in the git tags.

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
