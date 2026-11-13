# Changelog

What changed in each version, newest first. Older versions (up to 0.14.9) are listed in the "DONE" sections of
`CLAUDE.md` and in the git tags.

## Unreleased (v0.16.2)

- **Typing names with an input tool (Hindi, Japanese, Chinese …):** the Enter that picks a word no longer saves
  the name half typed, and the Esc that drops a word no longer cancels the edit or closes the menu: the layout and
  workplace name, company and floor names, the Inspector's name and number fields, Floor height, Layers / library /
  catalog / people search, the viewer's Find box, popovers and dialogs (`utils/keys.js`: `isCommitEnter`,
  `isComposing`).

## 0.16.1 (13 Nov 2026): live presence

- **See who else is here:** the page can tell the 3D view who has it open right now (AHDUS: its WebSocket,
  coming in AHDUS-FRONTEND). They get up from their desk and are drawn where they walk, with their name over
  their head; everyone else sits at their desk as before. Someone looking from above stands beside their desk.
  When they leave (or nothing is heard from them for 10 s) they sit back down. Nothing is saved.
- **Smooth, never through walls:** each person is drawn about 250 ms behind what their browser sent, gliding
  between the samples (never ahead of them); a jump over 5 m, or to another floor, snaps there at once.
- **Their clips:** Idle, Walk, Run and Wave as their browser says (others see your wave, H), in their own
  character and clothing (the full file, not the lighter seated copy).
- **Many people stay light:** the nearest 30 on the floor shown are drawn, the rest wait; name tags are hidden
  behind walls, further than 25 m and off screen, kept inside the view near its sides.
- **More full characters on a strong device:** the limit of full characters (12) is now measured from the
  frame rate: windows of 3 s of frame times; smooth (50 fps or more) twice in a row while more people are near
  = 4 more, up to 24; under 35 fps = 4 fewer, then it holds 30 s. A weak device (software graphics or quality
  `low`) keeps 12. Live people come first.
- **Your own walk for the others:** the `pose` event gives the page your position, facing, floor and clip at
  most 5 times a second, only when it changes, with a keepalive every 4 s (from above: `{ state: 'overview',
  floor }`), small enough to send as is.
- Embed: `workplace.live.add / update / remove / clear / list / count`, the `pose` event and `workplace.pose`
  (docs/EMBED_GUIDE.md 4h). `npm run e2e:live` (23 checks, no server: fake live people).

## 0.16.0 (12 Nov 2026): characters, clips and clothing

- **Your character moves:** walking through the 3D Company page you stand in an idle pose, walk, run with
  Shift, lift your feet on stairs and **wave with H** (standing still). Clips cross-fade. In Workplace Studio's
  editor H is still Reset view, and Studio's Walk through is unchanged (the simple figure).
- **People at their desks work:** at a desk with a keyboard, laptop or dual monitor they type, at other desks
  they sit, at a desk with no chair they stand. The 8 nearest play their clip, the rest hold its first frame.
- **Clothing from the Wardrobe:** Rocketbox characters wear what the person chose (Office formal, shirt or
  T-shirt in their colour, black or blue trousers), at their desk and walking. Other characters keep their own
  outfit. Pass `clothing` in `setPeople` and `player`.
- **An even default:** people who never chose a character get one of six neutral Rocketbox characters in
  Office formal (three women, three men), always the same one for the same person (by their id, never the name).
- **Character manifest version 2:** clip sets shared by many characters, the neutral set, groups that can be
  switched off (`"groups": { "imported": false }`), outfits, and a lighter **seated** copy for people at their
  desks (about a quarter of the graphics memory; the person walking through uses the full file). Version 1
  manifests still work.
- **Many people stay light:** at most 12 full characters, the ones round the point you look at (from above: the
  middle of the view, not the edge under the camera); everyone else is a grey simple figure; a character file
  nobody near has used for 30 s is unloaded.
- Character files compressed with meshopt now load (the decoder is inside the app: nothing from a CDN).
- **Fixed:** clips of the Rocketbox files laid the character down (the file's mirrored root was left out when
  fitting a clip); a character standing in a T-pose kept its arms half raised in clips made in an A-pose.
- AHDUS side (AHDUS-FRONTEND `scripts/make-office-characters.mjs`): light copies of the 20 Rocketbox and 5
  Avatar SDK characters (about 2 MB each, from 5–15 MB), their seated copies, and two clip sets (Idle, Walk,
  Wave). Run, Sit and Type clips are still to add.
- Measured on Meridian (319 people, laptop RTX 4060): first frame 1.9 s, nearby characters within 1.5 s,
  ~129 FPS from above, ~113 FPS walking, 0.7 GB of graphics memory walking.

## 0.15.6 (12 Nov 2026): Layers, wall items and snapping

- **Layers: hide and show.** The eye next to a room or an item in Layers hides it in Studio's 3D, 2D and Plan
  views. It is a Studio view setting only: never saved in the layout, never hidden in Walk through, the 3D
  Company page or the embed. Remembered per workplace in this browser (localStorage `ahdus.hiddenLayers`).
  The footer says "3 hidden · Show all".
- **Layers: lock rooms.** A room can be locked like an item (the Layers lock, the Inspector's Lock button, L):
  a locked room can't be moved, resized, turned, have its wall height changed or be deleted. Locking is one
  undo step. Saved as `locked: true` on the room (v2; missing = unlocked, so old layouts and AHDUS's
  `layout.schema.json` copy still work: the schema only gains this optional field).
- **Wall items.** The whiteboard, TV, projector screen, exit sign and fire extinguisher, plus three new items,
  the **wall clock**, **wall shelf** and **AC unit** (simple built-in shapes, noted in the catalogue), snap to
  the nearest wall when placed or dragged (Studio's library, drag, Plan view, Walk through's placing, G and
  Edit item): back against the wall, facing into the room, at their own height (TV 1.4 m, whiteboard 1.35 m,
  clock 2.0 m, AC 2.3 m, extinguisher 1.0 m, exit sign just above the door under it). They slide along the
  wall in 5 cm steps and never go into it or across a door or window.
- Hung items are no floor obstacles (walk map, Walk through's collisions); one standing on the floor still is.
  An exit sign above a door never blocks the door.
- Nothing in old layouts moves by itself: a selected wall item standing on the floor gets **Mount on wall**
  (one undo step), and **Check my layout** warns "TV is not on a wall: select it, then Mount on wall".
- The TV is now drawn by its own flat panel (the Kenney model stood on a foot); the whiteboard lost its legs;
  the Factory Floor template's whiteboard hangs on its wall.
- **Snapping while dragging items** (3D, 2D and Plan view): an item lines up with a wall in reach (it wins),
  else with other items' edges and middles, else the grid. Thin guide lines show what it snapped to (orange: a
  wall, pink: an item) and the hint says "Against the wall · hold Alt for no snapping". **Hold Alt** for no
  snapping. Measured on Meridian (2 floors, 720 items): the targets take a few ms, each move well under 1 ms.
- Lint ignores `private-docs/`; the tour and route timing tests allow slow machines (no more false failures).
- Shortcuts help: L locks a room too, Alt+Drag moves with no snapping. New e2e script `npm run e2e:layers`
  (38 checks).

## 0.15.5 (12 Nov 2026): Faster building

- **Plan view floors:** the floor switcher and Add floor are no longer covered (checked at 1366 × 768 and
  1920 × 1080 with the Inspector open). Page Up / Page Down change floors in every Studio view; in Plan the
  view stays where it was. A faint dashed outline of the floor below (the "Floor below" button hides it),
  stairs drawn on both floors they join ("Up to Floor 1" / "Down to Ground Floor" / "Leads nowhere"). The
  plan's zoom, position and the Floor below choice are remembered per workplace (localStorage `ahdus.planView`).
- **All floors** (Plan view, "This floor | All floors"): every floor's plan side by side, labelled with its
  rooms and items; a click opens that floor. For looking and choosing only. The 3D view draws no frames while
  Plan view covers it, so Meridian (2 floors, 720 items) opens All floors in ~20 ms (it was ~1.5 fps).
- **Multi-select:** Shift+click adds or removes an item, Shift+drag draws a box (3D, 2D and Plan). The group is
  tinted blue; the Inspector shows "N items selected" with Turn 90°, Duplicate, Copy, Lock all, Delete. Drag one
  of them, the arrows, R / Shift+R, L, Delete and Ctrl+D act on the whole group, each one undo step. Locked items
  can be selected but stay: "2 locked items were not moved". Esc clears the selection. Groups hold items only.
- **Copy and paste:** Ctrl+C copies the selection (a desk with its chair and what stands on it), Ctrl+V pastes
  at the mouse (else 0.5 m aside, further each time), Ctrl+Shift+V at the same place, also on another floor.
  One Ctrl+Z removes everything pasted. Pasted desks get new ids, so nobody sits at them ("Who sits here" is
  not copied).
- **Layers search:** a box at the top of Layers filters the floor's rooms and items.
- **Typing is safe:** in a text field, dropdown or search box the new keys do nothing to the layout, and
  Ctrl+C / Ctrl+V copy text as usual.
- **Plan view, easier to read:** room names are drawn over the furniture, the stairs and the hook-point badges
  with a white halo; a long name shrinks to fit its room, then is cut with "…" (the full name shows on hover).
  The toggle chips (Dimensions, Anchors, Floor below) are filled green while on. The selected item's bar names
  it ("Reception Desk", not RECEPTION_DESK). The fitted plan starts below the controls at its top left.
  All floors draws the stairs on both floors ("Up" / "Down").
- **Fixed:** a click on a room in Plan view never selected it (the plan took the pointer at once, so the
  click went to the plan; only Enter worked). The plan now takes it only once a pan starts (4 px).
- **Fixed:** the group's Duplicate and Turn 90° icons were squeezed to a dot. Ctrl+L stays the browser's
  (the address bar): only L alone locks. `e2e/check-smoke.mjs` uses `http://localhost:3000/` by default.
- Shortcuts help lists the new keys. New e2e script `npm run e2e:faster` (44 checks).

## 0.15.4 (11 Nov 2026): Edit and Stretch fixed in the hotbar

- Walk through: hotbar slots 1 Edit and 2 Stretch stay fixed. Office moves to 3 and Meeting to 9; slots 4–8 keep their items.
- Edit now shows a named Delete button when you aim at an item (or a room's door / window). It stays reachable when
  the mouse moves onto the HUD, respects locks, and deletes in one undo step. Catalog picks never replace slots 1 / 2;
  picking Edit or Stretch in the catalog selects its fixed slot.

## 0.15.3 (11 Nov 2026): Check my layout

- Walk through: right-click removes aimed items with an empty hand again; right-drag still looks around.
- Doors placed in drawn walls now look open, matching their passable doorway and room doors. Solid walls
  and windows still stop walking from either side. Floor controls are unchanged.

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
