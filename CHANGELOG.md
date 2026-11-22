# Changelog

What changed in each version, newest first. Older versions (up to 0.14.9) are listed in the "DONE" sections of
`CLAUDE.md` and in the git tags.

## 0.18.9 (22 Nov 2026): furniture never in walls, a clear selection, people on chairs

Himan's reports, each reproduced first (an e2e step that failed, `npm run e2e:walls-select` and e2e:seats, with a
made-up test layout). Nothing new is saved in a layout, and no saved layout moves by itself.
- **2D drag jump (from v0.18.8):** dragging an item that was not selected yet in Studio's 2D view made it jump
  several metres: the Inspector opening narrowed the view and slid the whole floor under the mouse. The 2D view now
  keeps its scale and its left / top edges when the canvas changes size, and a drag re-reads where it was pressed
  when the view changed under it.
- **Furniture never inside a wall:** placing, dragging, the move arrows, the arrow keys, R / Shift+R, a bigger
  size, typed X / Z, Duplicate and paste: an item's real outline (scaled and turned) never overlaps a wall (a room's
  walls, glass walls, a wall drawn with the Wall tool, a glass partition; wall thickness counted, and the height:
  under a door's opening is no wall). It stops flush against the wall, on the side it came from. An arrow key
  never jumps a wall in one step. No room for it there: "A wall is in the way: there is no room for it there".
  Wall items (whiteboard, TV, shelves…) sit ON the wall's face. Doors, windows, the Wall tool's walls, columns,
  rugs, markers and stairs may stand in walls.
- **Check my layout:** "Bookshelf is inside a wall of Board room" (a warning) with **Move out** (flush with the
  wall on its own room's side, one undo step; Ignore keeps it hidden). Wall items hung right get no warning. The
  templates and the sample layouts have none.
- **Ctrl+V at the mouse:** with the mouse over the view, a paste goes to the floor under the mouse even when the
  selection bar or the room's hover card is under it (it went 0.5 m beside the copy).
- **A clear selection:** the selected item has a blue outline in 3D and 2D (thicker, lightly tinted), the item or
  room under the mouse a lighter one, and Plan view marks both the same way (`data-plan-selected`,
  `data-plan-hover`). The selection bar starts with what is selected: its name and type ("Office Chair", "Team
  office · Office"). The item being dragged stays outlined.
- **A click selects what you clicked:** furniture first, then a wall, then the room (`play/pickCycle.js`): a chair,
  never the room or the wall behind it, even while that room is selected. A second click on the same spot selects
  the next thing under it (chair → wall → room → chair). Nothing behind a solid wall or under a floor counts.
- **People on chairs (inside AHDUS):** "Who sits here" on any chair that is not a desk's own chair (office chairs,
  visitor chairs, lounge chairs), with the same rules as desks: one person per seat, one seat per person, Admin and
  HR manage, editors only see, and the same "Move them here?" question. They sit on that chair in Studio and Walk
  through, and Find finds them there. A desk's own chair shows the desk's person; a seat the server has on one is
  never a second person (it is listed under "People without a desk"). The AHDUS server accepts chairs after its own
  v0.18.9 update; until then it says why and nobody is seated.
- **Check my layout on older layouts:** items already standing a little inside a wall now get the warning (with
  Move out); nothing moves by itself.

## 0.18.8 (22 Nov 2026): stairs against walls, never stuck in walk through

Two cases Himan reported on the live site (v0.18.7), reproduced first (`npm run e2e:stuck`, a test layout made
to match his screenshots), then fixed. Nothing new is saved in a layout, and no saved stairs move by themselves.
- **The avatar never stands inside a table** (or a desk, a cabinet, any blocking item, chairs too: walk past them,
  not through). The real table models let the body walk 2 m into them from the ends and corners (Babylon's
  collisions missed their faces). Walking now keeps the body out of every solid item's box as drawn (scaled and
  turned) every step and while standing still: keys in first and third person, click-to-walk, landing after flying,
  spawning. Click-to-walk still reaches a seat behind its chair.
- **Thin gaps:** a strip beside stairs or furniture narrower than a person (0.75 m) is blocked for the keys and
  click-to-walk; put into one (an old save, a landing), you are pushed out of its open end.
- **Under the stairs:** the floor under a flight is walked out of by the side with free floor, never into the wall
  (forward and back were both blocked there).
- **Get unstuck:** press **U** to go to the nearest free floor of the same room, on the same floor (never through a
  wall or to another floor). The same happens by itself when you press a direction for 1 s and move less than
  0.25 m where the body doesn't fit (a strip, a pocket closed in by desks). On open floor U says you are not stuck.
- **Stairs snap flush to a wall** within 0.5 m, by their real outline (an L is 3.2 × 3.2 m, not the straight flight's
  1.2 × 4 m), with the orange guide line: placing them, dragging, the move arrows, the arrow keys, R and the
  Inspector's Stairs shape. To leave a gap on purpose: Alt while dragging (no snap), arrow keys moving away from a
  wall are never pulled back, typed X / Z are never snapped.
- **Check my layout:** "Thin gap next to Stairs - people can get stuck. Push it to the wall or leave at least
  0.75 m." A warning only (it never blocks saving or publishing; Ignore keeps it hidden). **Snap to wall** puts the
  stairs flush, one undo step. Only stairs: chairs never count, and other furniture that close to a wall is a choice.
- Tests: `play/navigation/__tests__/thinGaps.test.js` (+ the real layout, read from private-docs at run time and
  skipped without it), `stairFit.test.js` (the snap), `npm run e2e:stuck`.
- Found, not fixed (first item of v0.18.9): in Studio's 2D view, dragging an item that is not selected yet makes it
  jump.

## 0.18.7 (22 Nov 2026): the rest of the outside audit

The audit items v0.18.6 left (`private-docs/V0.18.7_PLAN.md`), each with a test that failed before the fix. Nothing
new is saved in a layout.
- **Resize a room by one wall:** a selected room shows a blue handle on each edge, in Plan view and in Studio's 2D
  view. Drag one and only that wall moves (the opposite wall stays), with the new length shown at the edge; one
  Ctrl+Z puts it back. Click a handle to type the length (6.4 + Enter). A length that runs into another room, cuts
  off a door or leaves a desk outside is refused with the reason (the wall drag's rule, `geometry.stretchRoom`). A
  handle never sits on a door or window: it slides along the wall to the nearest free spot. Locked rooms have none.
  The hints say which wall stays. Pure rules in `play/roomEdges.js`.
- **Sizes to the millimetre:** a typed 6.65 m is saved as 6.65 (it was 6.6499999999999995), centres too.
- **A click on a big table** walks to its edge, not "no room to stand there" (`play/navigation/itemGoal.js`).
- **The embed's `await setPeople(…)`** resolves once `find()` knows the people.
- **Mouse look:** the second L always gives the mouse back; a click in mouse look walks where the crosshair was (a
  flight's other end).
- **Find:** the keys, the highlighted row and `aria-activedescendant` agree in every render. The welcome card closes
  in the same render as Find or More opens (no 250 ms overlap).
- **No WebGL sampler warnings** when Studio switches between 2D and 3D (D3D11: ~50 per session, now 0).
- **No freeze after opening a layout:** Studio's performance monitor lowered the resolution 0.25 at a time, four
  canvas resizes in four seconds (each a 150 to 600 ms task with software WebGL). It now waits until the layout is
  built, goes straight to the level the frame rate needs and keeps the pixel ratio. The longest task while the
  72-room building opens: 615 → 157 ms.
- **Check my layout is faster:** each floor's door gaps are made once, not once per room (72 rooms: 284 → 146 ms
  cold, 211 → 102 ms warm).
- **Measured, not changed:** walking among 300 seated people, our JavaScript is about 5 ms of a frame; the rest is
  the drawing (software WebGL ~770 ms a frame). e2e:perf now checks both numbers.
- Tests: `roomEdges.test.js`, `buildActions.test.js`, `itemGoal.test.js`, `performanceOptimiser.test.js`,
  `checkLayout.test.js`, `CharacterSystem.test.ts`, the embed / Find / pointer-lock tests, new `npm run
  e2e:room-edges` (20 checks); e2e:touch, e2e:nested-rooms and e2e:characters made steady; e2e:lifts checks an L over a lift
  shaft by its arms (v0.18.6's rule); e2e:perf's long-task limit leaves out the driver's shader compiling.

## 0.18.6 (21 Nov 2026): fixes from an outside audit

Thirteen problems found by an outside audit of v0.18.5 (and Himan's own notes), each with a test that failed before
the fix. Nothing new is saved in a layout; saved values read as before.
- **A typed room size can't leave a door or desk outside:** Width / Depth in the Inspector use the same check as
  dragging a wall (`geometry.checkRoomRect`): doors and windows keep their place, one that no longer fits its wall is
  in the way, the room's items stay inside. The message says what blocks ("Desk is in the way. The size was not
  changed.").
- **Locked items stay put:** a locked item's X / Z, height, angle and size can't be typed in the Inspector (the boxes
  are disabled, with a note), and `editor.updateObject` refuses them on every path (arrow keys, gizmo, Walk through)
  and says why (`locks.allowedItemPatch`).
- **L-shaped stairs are checked by their arms:** a room in the L's empty corner no longer gives "The stairs run
  into …" and a Fix it.
- **Find closes like a menu:** a click or tap on the view closes it, and Esc closes it when the focus has left its
  box. What was typed is kept.
- **Room size boxes:** Width / Depth / Wall height (were Width / Length / Ceiling) change the room once, on Enter or
  on leaving the box (typing 12 no longer resizes the room to 1 m on the way). Esc puts the saved value back, a click selects
  the number, and the box shows what is saved (12.34, not 12.3).
- **Stairs against a wall:** a staircase dropped near a wall has its side flush with the wall's inner face (its
  thickness counted) before the 0.5 m grid; Alt = exactly where the mouse is (`stairFit.snapStairToWall`).
- **Wood and Carpet floors:** choosing Wood gave a carpet and Carpet a parquet. Each now has its own material, and a
  room that never chose a floor keeps its type's look. The Inspector's floor choices show each floor's own photo and
  name, with **Room default** first (a Cabin's walnut, an Office's carpet).
- **Table tops are real:** an item dropped in Plan view onto a corner desk stands on its L (the open corner is
  floor), on a round table only inside its round top, on a wall shelf at its board. Plan view draws those shapes
  (`play/surfaces.js`). In 3D, what is under the spot the grid snapped to is what the item stands on (a Desk Plant
  snapped past a desk's edge goes to the floor, not to desk height in the air).
- **Ending a flight over a table** (F in Walk through) lands you beside it, at the nearest spot where you fit, as
  walking does. You no longer end up standing inside it.
- **Check finds enlarged furniture in each other:** two meeting tables made three times bigger, 6.1 m apart, overlap
  and are now reported (pairs were skipped by a 6 m distance between their centres).
- **Copied rooms keep their look:** "Copy rooms from below" and Duplicate keep a room's glass walls and its chosen
  floor (one rule, `building.roomLook`). Duplicate still copies no doors or windows.
- Tests: `buildActions.test.js`, `editorHistory.test.js`, `inspectorFields.test.jsx`, `stairFit.test.js`,
  `placeSearchClose.test.tsx`, `floorFinish.test.js`, `planSurfaces.test.js`, `playController.landing.test.js`,
  `checkLayout.test.js`, `floorHeights.test.js`; e2e:viewer (Find closes), e2e:building (the new labels).
- The rest of the audit is planned for v0.18.7.

## 0.18.5 (20 Nov 2026): Studio fixes

Seven Studio bugs, each with a test that failed before the fix. Nothing new is saved in a layout.
- **Fix it right after Import:** Check's **Fix it**, and a click on a problem, did nothing after Import (or a
  template, or restoring a version) until a reload. Restoring a layout now keeps rooms and items by id, as opening one
  does (`editorHistory.restoreVersion`).
- **Layers search with a dot:** "Meeting Room 0.2" is found by typing "0.2" (also "floor-1", "r&d"). Punctuation at
  the start or end of a word, or on its own, is ignored (`matchesLayerQuery`).
- **A cabin's door always leads in:** a private cabin is placed turned so its door opens onto the floor of the room it
  stands in (not against an outer wall, into another room or into furniture; 0°, then 180°, then 90° / 270°). Check's
  "Nobody can walk to Cabin" gets **Fix it**: turn the cabin, else move it off the wall (and turn it), with its
  furniture, one undo step. Nothing is offered while it, or something in it, is locked. New PURE `play/cabinDoor.js`.
- **Click to place in Plan view:** a library tile clicked while the Plan is shown lands in the middle of the Plan (it
  landed in the middle of the hidden 3D view).
- **A room inside a room moves out by its X / Z:** typing a position (or dragging) wholly outside the room it stands in
  now moves it there (into another room, or the open floor); half through a wall is still refused.
- **Dragging a cabin moves its room:** dragging a private cabin's group (or the arrow keys, or R) moves or turns the
  cabin room with its furniture, one undo step. A locked cabin room says so.
- **Narrow windows (601-1023 px):** Studio no longer overflows sideways. The top bar keeps the tool icons (names in the
  tooltips), Walk through shows its icon, Publish says "Publish", the layout's name shortens (…); the Inspector's
  buttons wrap.
- **Dev tools:** `npm audit fix` updated Playwright to 1.65.1 and minimatch (under eslint). Left: vite / esbuild and
  vitest / tinypool / @vitest/mocker (dev server and test runner only, not in the built files; they need vite 8 and
  vitest 5), and zod 3 (in the built files: a very large crafted layout file could use a lot of memory in the browser
  tab that opens it; the fix is zod 4, a breaking change).
- Tests: `cabinDoor.test.js`, `roomMove.test.js`, `groupActions.test.js`, `libraryClickSpot.test.js`,
  `editorHistory.test.js`, `layersSearch.test.js`; e2e:workstations (42 checks) and e2e:stability (13 checks).

## 0.18.4 (20 Nov 2026): avoid stairs (use lifts)

For people who can't use stairs. Nothing new is saved in a layout; the option is per browser (or set by the page).
- **The option:** "Avoid stairs (use lifts)" in the viewer's **More** menu (remembered in this browser) and under the
  place in Find's card (the Take me there card). Shown when the workplace has more than one floor. While it is on,
  **Show route, Take me there, My desk and the company tour go between floors by lift only**; routes on one floor are
  unchanged.
- **Never a silent fallback:** a place only the stairs reach says so, "No lift goes to Floor 2: this route needs the
  stairs" (or "No lift stops at Floor 1: …" from a floor no lift stops at), with **Use the stairs this time** (that one
  walk may use them; the option stays on). A problem the stairs would not solve keeps its own words ("…: it has no
  door").
- **Find** marks such places **Stairs only** while the option is on (from where you walk; from above, from the
  ground floor).
- **The tour** is planned again when the option changes: by lift only, a floor no lift stops at is skipped (saying
  why), and the tour goes on to the next floor the lift reaches (before, a tour ended at the first floor it could
  not climb to).
- **Check my layout** (Studio): "Floor 2 has no lift stop: people who can't use stairs can't get there" for a floor with
  rooms no lift from the ground floor reaches (in a building with a lift), and **Fix it** "Add a lift stop on Floor 2"
  where the shaft's spot there is free of rooms and items (one undo step). "The lift skips Floor 1" has the same Fix it.
  The check keeps its old key, so a warning ignored in v0.18.3 stays ignored.
- **Embed** (docs/EMBED_GUIDE.md 4e2): option `navigation: { avoidStairs }`, `workplace.avoidStairs`,
  `setAvoidStairs(on)`, `onEvent('avoidStairs', { on })`, `goTo(target, { stairs: true })`; `goTo` answers
  `{ problem: 'NEEDS_STAIRS', message }`. For AHDUS later (a person's profile setting).
- Code: `route.findRoute(…, { avoidStairs })` (then once more with the stairs: if that works, `NEEDS_STAIRS`),
  `floorLinks(…, { avoidStairs })`, `lifts.liftFloorsFrom` / `liftStopSpot`, `engine.navigation.setAvoidStairs`,
  `play/navigation/avoidStairs.js`. Tests: `avoidStairs.test.js`, `engine/__tests__/avoidStairsNav.test.ts`,
  `npm run e2e:avoid-stairs` (12 checks), e2e:lifts (Fix it), e2e:embed (the option).

## 0.18.3 (20 Nov 2026): lifts and L-shaped stairs

`private-docs/V0.18.3_PLAN.md` (decisions and what changed from the plan). Old builds open these layouts without an
error (checked with the built v0.17.3, v0.18.0 and v0.18.1 embeds).
- **Lifts:** the Stairs library's **Lift** tile places a lift shaft room (new room type Lift, 2.2 × 2.2 m, one door).
  Its Inspector has **Lift stops**, one button per floor: a stop adds the same shaft on that floor, taking one away
  removes it there (one undo step each, `editor.setLiftStops`). A lift is the lift shafts in the same place on
  several floors (`play/lifts.js`): nothing else is saved.
- **A lift stays in one piece:** moving, resizing or turning a lift shaft on one floor (drag, Room X / Z, Width,
  a wall dragged, Rotate) does the same on every floor of its lift, with what stands in each shaft, in ONE undo
  step; refused with the floor named when a shaft there is locked or would overlap a room.
- **Riding one** (viewer, embed): the car, its sliding steel doors and a call button panel are drawn on every floor it
  serves (`LiftSystem`, three meshes for all lifts). Inside the car a panel "Lift: choose a floor" takes you to the
  floor you pick (the car waits on every floor).
- **Take me there and Find use it:** routes join floors by lift too (the ride time counted, so for one floor the
  stairs usually win, for several the lift); the walk rides it by itself and goes on. Find has "Lift" places and
  "Nearest lift" while walking.
- **Check my layout:** "No lift stops at Floor 2" (a floor with rooms no lift serves), "The lift skips Floor 1" and
  "The lift shafts on Floor 1 and Floor 2 don't line up" (shafts that overlap on other floors without matching, from
  an old save or a file) (warnings); a shaft with no door is the usual "has no door" error.
- **L-shaped stairs:** two new Stairs tiles (turns right / turns left) and the staircase Inspector's **Stairs shape**
  (Straight | L right | L left, one undo step). 3.2 × 3.2 m: half the steps, a 1.2 m landing, the rest turned 90°.
  Walked, blocked from the sides, routed (through the landing), checked by `stairFit` at its real top, drawn in 3D,
  Plan view and two openings in the floor above (the corner the L leaves free stays floor).
- **Format:** a lift shaft is written as `CUSTOM` + `subtype: 'LIFT'` in v2 / exported files; an L staircase is a
  STAIRCASE with `metadata.stairShape` (`docs/ROOM_FORMAT.md`). Older builds draw a small Custom room on each floor
  and a straight flight from the same spot.
- **After the review (Himan, 20 Nov):**
  - Inside the lift car the view is first person (your character hidden): the third-person camera sat right behind
    your head there and covered the floor panel. Out of the car the usual view comes back (V is unchanged). Also: a
    smaller room you walk into (the car in a hall) is now the room you are in at once, so the panel shows as you step in.
  - Stairs never belong to a lift shaft (`stairFit.stairRoomAt`): L stairs dropped over a shaft in a hall said "The
    stairs stick out of Lift shaft 1" and stayed there; now they belong to the hall and move to the nearest spot beside
    the shaft. Stairs that hit a room inside their room say "The stairs run into Lift shaft 1"; Check and Fix it the same.
  - Room labels: a lift shaft is labelled "Lift" with its icon, and a room with rooms inside it puts its name at the
    free spot nearest its middle (`geometry.labelSpot`), not on the shaft; in 2D / 3D and in Plan view.
- New: `npm run e2e:lifts` (26 checks).
- Next (v0.18.4, first item): a route option "avoid stairs (use lifts)" for Find / Take me there and the tour.

## 0.18.2 (20 Nov 2026): stability

Fixes from an outside audit of Studio's input and the viewer (`private-docs/V0.18.2_PLAN.md`: each item checked
on v0.18.1 first; only the ones that really happened were fixed). Nothing in the layout format changes.
- **A drop over a control places nothing:** a library tile released over Reset view, the selection bar or a menu
  used to place the item on the floor behind it (`ui/canvasHit.js`). A tile drag whose pointer is cancelled drops
  nothing.
- **Only the main mouse button edits:** a right or middle press never confirms an armed item (stairs after a tap on
  the tile) nor changes the selection; it still turns / pans the camera and cancels a drag.
- **The wheel:** over a panel it scrolls the panel (it used to lift the armed item instead); over the 3D view it
  lifts the item and no longer zooms the camera at the same time.
- **A cancelled drag changes nothing:** after a `pointercancel`, a lost pointer capture or the window losing the
  focus, a later release (another finger, a stale one) no longer finishes the move; no undo step, the camera works
  again. A second finger never takes over a drag.
- **Tab:** for someone moving through Studio with the keyboard, or inside an open menu or popover (Settings), it
  moves the focus as everywhere else; after a mouse click (or on the 3D view) it is still the shortcut to Walk
  through.
- **Esc closes one level:** the phone's More → Settings: the first Esc closes Settings, the second More.
- **The hidden selection bar** (its item off screen or dragged) is out of the Tab order.
- **A small laptop:** 1024 × 768 with the library and the Inspector open: the 3D view is 443 px wide instead of
  312, and every canvas control is visible and clickable (narrower panels between 601 and 1199 px; Export /
  Measure, the selection bar and Add floor turn into icons when the canvas itself is narrow).
- **The walk starts outside** even when a big blocked area fills the front of the main door (it could start inside
  the room behind it). An indoor spawn point is still the editor's choice.
- **The tour:** a walk that fails (stuck, no route from here) leaves you where you are, unticked, with the reason
  ("Stopped · Press P to try again, or Skip the walk"); Resume walks again. It used to fade you to the stop and tick it.
- **One seat per person:** a person sent twice, or two people at one desk, are drawn, found and seated once (the
  first entry wins), the same for Find and the people drawn (`people.uniqueSeats`).
- **Rooms inside rooms:** an item placed, moved or pasted in a cabin inside an open office belongs to the cabin,
  whichever room was added first (`findRoomAt`: the smallest room there).
- **Steadier timing tests:** the route (100 ms) and tour (500 ms) checks measure again, after a pause, only while
  over their limit; the limits are unchanged.
- Not changed (checked, by design): an indoor SPAWN_POINT stays the start; the audit's CAD import, wardrobe and
  build-size points are backlog, not stability bugs.
- New: `npm run e2e:stability` (12 checks: drop over Reset view, the drop on the floor, right / middle presses with
  a selection and with the stairs armed, the wheel over a panel and over the view, a cancelled drag, the hidden bar,
  Tab from Settings and on the canvas, 1024 × 768 with both panels, Esc on a phone).

## 0.18.1 (20 Nov 2026): doors, windows and glass

Real doors that open, more kinds of windows, glass walls and five new room types (`private-docs/V0.18.1_PLAN.md`).
- **Door types** (Doors & windows library, one tile each; a selected door's Inspector: **Type**, one undo step):
  wooden door (as before), glass door with a metal frame, double glass entrance door (1.8 m), sliding glass door
  (1.8 m) and emergency exit (green EXIT sign above it; it swings OUT of the room it was placed from). A door in a
  shared wall is one door: changing it from either room changes both.
- **Doors open:** in the viewer, the embed and Walk through a door opens smoothly (0.5 s) when someone walking comes
  within 1.5 m (you, Take me there, the tour, live people walking) and closes 1 s after they have gone; someone
  standing in an open doorway holds it open. Seated people never open a door, nor does someone on another floor; at
  most 4 doors move at once, yours first. Studio shows every door half open, so you see which way it swings. Plan
  view and the floor plan export draw the same swing. The leaves are drawn apart from the rooms (`DoorSystem`, at most
  4 meshes for all doors), are not pickable and never block: a doorway is walkable as before (walk map, routes and
  Check are unchanged).
- **Window types:** standard (as before), tall (1.0 × 2.2 m, low sill, with a transom) and a full-height glass panel
  (floor to ceiling, 2.0 m, it follows its wall's height). Windows still block walking.
- **Glass walls:** the room Inspector's **Walls**: North / East / South / West each Solid or Glass, + All glass (one
  undo step). A glass wall has a thin metal frame; people and desks inside show through it; it still blocks walking
  and is selected like a wall. A shared wall is glass when either room says so. **A new Meeting room's first door
  makes its wall glass** (in the same undo step); a wall set by hand, Cabins and rooms from before stay as they are.
  In the viewer a click or hover through glass reaches the person or desk behind it, and a click on the floor behind
  it walks there through the door (no door: "…: it has no door").
- **Room types:** Cafeteria, Lounge, Cabin, Training Room and Lobby, each with its own floor, default name and size,
  library tile, icon and catalog item. Find: "Nearest cafeteria" (canteen, pantry, lunch…) and a kind for each in the
  browse menu; Cafeteria, Lounge, Training Room and Lobby are shared rooms (no department from their seats), a Cabin
  takes its person's department. The tour stops at one cafeteria per floor; with no Reception, a Lobby's door is the
  main entrance. New private cabins (the workstation prefab) are Cabins.
- **Save format:** only new optional fields (an opening's `style` and an exit's `swing`, a room's `glassWalls` and
  `glassOnFirstDoor`, in v2 a room's `subtype`). v0.18.0 layouts open unchanged. **What older embeds and viewers
  (v0.18.0, v0.17.x) do with a v0.18.1 layout:** every door is a plain open doorway with a wooden frame at its saved
  size; a tall window or glass panel is a standard window frame at its saved size; glass walls are solid walls; the
  new room types show as their nearest older type (Cafeteria and Lounge: Custom; Lobby: Reception; Training Room:
  Meeting Room; Cabin: Office), with their names. Never an error, never a magenta box. **Saving again from an older
  Studio drops the new settings** (doors wooden, walls solid, room types their older type). From now on an unknown
  room type, door or window style reads as Custom / the plain one instead of failing.
- **Performance:** measured before (v0.18.0) and after on the same machine.
  - **Meridian on a real GPU** (Intel UHD, the built embed, 300 people seated, the same camera spots and scripted walk;
    `private-docs/screenshots/v0.18.1/perf/`). With no glass: +2 draw calls (the door leaves: 174 → 176 from above,
    151 → 153 walking), +2 meshes (1,149 → 1,151), the same frame times (looking along a corridor: median 9.7 ms both).
    With its 3 meeting rooms all glass, looking through them from the corridor: median 9.7 → 12.0 ms, p90 10.3 →
    12.6 ms, the worst frame unchanged (~30 ms), the same draw calls (153), fewer meshes (1,154: a glass wall has no
    skirting). The stress case, every office and meeting room all glass (17 rooms): median 11.6 ms, 1,111 meshes. Far
    under the limits (≤ 2,000 meshes, ≤ 1,500 draw calls).
  - **e2e:perf** (SwiftShader, 72 rooms + 864 items): Studio 1,796 → 1,798 meshes, 285 → 287 draw calls (ground floor),
    921 → 923 (all floors); the tour walking 371 → 372; the 300-seat office 72 → 74 in Studio. 300 seated people and
    a walker standing among them: 0 doors open.
- **Old embeds checked for real** (A1): a layout made in v0.18.1 Studio with every new type, style and a glass wall,
  as its AHDUS save and as its exported file, opened in the v0.17.3 and v0.18.0 embeds built from their tags: no error,
  no magenta, every room walkable through its door, the glass wall solid, drawn as described above; reopened in v0.18.1
  everything is still there (`private-docs/screenshots/v0.18.1/a1/`).
- **Fixed on the way:** a jump (Back to entrance, a tour fade, a live person's 5 m snap) never opens the door where you
  land.
- New: `npm run e2e:doors` (24 checks, `SHOTS=<dir>`: each door shut and open, a glass meeting room with people
  inside); e2e:perf checks that 300 seated people open no door.

## 0.18.0 (16 Nov 2026): workstations

Open offices are built from workstation clusters, not one desk at a time
(`private-docs/REALISTIC_WORKPLACE_PLAN.md`).
- **The asset manifest:** furniture can now be described as data (`src/catalog/workstations.json`: size, parts,
  footprint boxes, seats, desk rules) and joins the catalogue through one adapter (`catalog/manifest.js`). The 53
  hand-built items are unchanged.
- **Workstation desks** are drawn at their real size from simple parts: top, frame, pedestal, fabric or glass
  partitions, side screens, a built-in monitor and keyboard. There is no third-party branding. Desks with the same
  options share one instanced shape (`play/workstation.js`, `utils/workstationMesh.js`).
- **Prefabs** are in the Furniture library under **Workstations**, each with a plan picture: Desk with partition, 2-,
  4-, 6- and 8-person clusters, Desk row (4), Manager workstation (with 2 visitor chairs) and Private cabin (a room
  with a door and its desk). Drag one onto the floor and it is placed in one undo step. The drop says what is in the
  way ("Overlaps …", "Crosses the wall of …") and warns when it would leave less than 0.9 m to walk.
- **A click selects the whole cluster; Alt+click selects one desk or chair** (listed in Shortcuts). The cluster's
  Inspector has:
  - Desk width / depth, Partition (None / Fabric / Glass) and its height. A change rebuilds the cluster in one undo
    step and keeps every desk's id, so the people seated there stay.
  - A **Seats** list (Seat 1…N). Inside AHDUS each seat has its own **Who sits here**. Hovering a row tints that
    desk amber.
  - **Ungroup**.
- **A copy, paste or duplicate** of a cluster is a new group with new desks, so its seats are empty: nobody sits
  twice.
- **Every seat is a desk like any other:** people sit there and **type at the built-in screen** (switch off "Monitor
  and keyboard" and they just sit). Find, Take me there, the tour and live presence work for every seat, upstairs
  too. A manager's visitor chairs are never anyone's seat.
- **Check my layout:**
  - "Only 0.6 m between the 6-person cluster and the 6-person cluster: an aisle needs 0.9 m" (also to the walls).
    Clusters pushed together are fine.
  - A cluster that shuts a door or leaves seats nobody can walk to is ONE line naming it and the cause ("The
    4-person cluster blocks the door of Open Office", "The 6-person cluster in Open Office leaves no way to one of
    its seats: only 0.5 m to the wall"), never a "Nobody can walk to Workstation Desk" line per desk; the narrow
    aisle behind it is folded into that line. **Fix it** moves the whole cluster, 0.9 m clear.
  - A private cabin is placed with its door: you walk in through it, and Take me there reaches its desk.
- **An item type this version doesn't know** (a layout from a newer version) is a plain grey desk-sized box standing
  on the floor, with one warning per type, and never an error. Before this it was a magenta 1 m cube half under the
  floor: the v0.17.4 embed opens a workstation layout without an error but draws those cubes, so AHDUS should
  update its embed before editors place workstations.
- **Small notes from Himan:**
  - Studio's hint along the bottom wraps onto more lines instead of being cut off (the red stairs warning).
  - The Publish dialog has **Fix all** when several walking problems come from one item: "2 of these come from one
    item. Move the stairs fixes them all."
- **Performance** (e2e:perf, 300 seats on 2 floors, 50 six-person clusters, everyone seated and typing; SwiftShader
  with no GPU, so the FPS only compare the two): the same seats as v0.17 desks (desk + chair + monitor + keyboard)
  against v0.18 clusters:
  - Studio, both floors shown: 1,200 → 600 items, 1,263 → 665 meshes, 46 → 72 draw calls, 2.3 → 3.2 FPS.
  - Walking among them in the viewer: 1,266 → 664 meshes, 60 → 84 draw calls, 1.3 → 1.4 FPS.
  - The 300 desks are drawn from 2 shapes (a cluster's end desk and the others). A workstation desk has more materials
    (top, frame, fabric, screen), so a few more draw calls, still far under the 1,500 limit, whatever the number of
    desks. Check my layout on the 300 seats: ~40 ms.
- New: `npm run e2e:workstations` (32 checks); e2e:perf adds the 300-seat office (WS=off skips it).

## 0.17.4 (16 Nov 2026): stairs that always work

Found in a real layout on Render: the ground-floor stairs stood 0.3 m from a wall, in front of the stair room's only
way in, so nobody could reach the room, and the editor had ignored two of Check's warnings. Editors never need
coordinates to fix this now.
- **Placing or moving stairs in Studio:** where there isn't 0.8 m of free floor in front of the bottom step and past
  the top on the floor above (walls, furniture, other stairs, a door's way), the stairs turn red and the floor they
  miss is shaded red, with the reason in the hint. Dropped or let go there, they move to the nearest spot that works
  (same room, same turn): "Moved the stairs a little, so there is room to step on and off." Hold **Alt** to put them
  exactly where you drop them. The library, dragging the stairs and Plan view alike (`play/stairFit.js`).
- **Fix it:** every stairs problem in Check my layout, and "Nobody can walk to …" or a blocked door caused by stairs
  or furniture, has a **Fix it** button: it moves the item to the nearest spot that works, as one undo step, and
  selects it. The selected stairs' Inspector has it too. A fix is offered only when it really clears the problem.
- **Plain words:** "The stairs are too close to the wall of Staircase 3: there is no room to step onto them", "The
  stairs end too close to a wall on Floor 1: there is no room to step off at the top", "Desk is in the way at the
  bottom of the stairs" (v0.17.3's "only 0.25 m … move them 0.6 m" is gone). Stairs problems now count as errors.
- **Publish (AHDUS):** problems that stop people walking somewhere (a room nobody can reach, stairs with no space, a
  room with no door, no way in) are listed in the Publish dialog even when ignored, each with Fix it; the button
  reads "Publish anyway". Publishing is never blocked.
- **Ignored problems:** Check shows "2 ignored · Show" (the Check button's tooltip counts them too), and ignoring a
  problem that stops people walking asks once: "People can't walk there while this is wrong. Ignore it anyway?"
- New: `npm run e2e:stairs-fit` (24 checks, on a copy of the Render layout when it is there); e2e:check 14 checks.

## 0.17.3 (15 Nov 2026): a click on the stairs climbs them

- **A click on a staircase walks up (or down) it:** found on Render in a real layout: a click on the steps (also in
  mouse look, L) walked to the door in front of the stairs and stopped. A click used to walk to the spot clicked, on
  the floor the flight starts on, and a step is not a place to stand: the route ended at the nearest spot in front
  of the flight, or found none. Now a click anywhere on a flight walks to its other end, through the same link the
  routes use (`route.stairsClickGoal`, from `playController.clickTarget`): from its floor (or below) up to where it
  arrives, from the floor above down to the spot in front of its bottom step; and it ends ON that landing, not 1 m
  short on the last steps (`NavigationSystem` `routeTo(…, { arriveWithin })`, `STAIRS_ARRIVE_WITHIN` 0.35 m). The
  viewer, the embed and Studio's Walk through alike; the `walkClick` event carries `stairs: { objectId, direction }`.
  Stairs that lead nowhere: a click walks as before. W and Take me there already climbed them.
- **"Click the floor or the stairs to walk there":** a walking click that walks nowhere (a wall, a window, a ceiling, the
  sky, a spot no route reaches) shows this short hint next to the click (a phone: "Tap the floor or the stairs"), for
  ~2 s, at most once every 4 s (`play/clickHint.js`, `engine/react/ClickHint.tsx`; viewer, embed and Studio's Walk
  through). It replaces "No walking route to …" there; a room nobody can reach keeps its own message ("…: it has no
  door", "…: no stairs lead to Floor 1"). Clicks on a person, an item with an action, a door, the toolbar or menus
  never show it. A wall click used to walk to the spot in front of the wall: it walks nowhere now. The `walkClick`
  event carries `hint` (the words) when one shows.
- **Check my layout says how far to move stairs:** "These stairs don't fit Staircase 3: only 0.25 m of floor in front
  of the bottom step (0.8 m needed). Move them 0.6 m away from the wall there" (was "there's no room in front of the
  bottom step"). The check's key is unchanged, so a warning someone ignored stays ignored until Show again.

## 0.17.2 (15 Nov 2026): small polish

- **One loading screen for Workplace Studio:** in the AHDUS look (AHDUS green, Inter, light; dark only when AHDUS is
  in dark mode), with steps: "Creating your workplace… → Loading Studio… → Ready". It is there from the very first
  paint (`index.html` draws it before Studio's code arrives; `ui/StudioSplash.jsx` takes over in the same place,
  styles in `ui/splash.css`, words in `ui/splashSteps.js`), so there is no second loader any more. A new workplace
  (`?new=1`, removed from the address at once) keeps "Creating your workplace" ticked and says how to rename it.
  Studio's files failing to load = "Workplace Studio could not be opened" with Try again (no endless spinner).
  `build:ahdus` copies `splash.css` next to Studio, so the 3D Company page draws the same screen from the click.
- **Faster opening for editors:** `build:ahdus` writes `workplace-studio/prefetch.json` (`scripts/studio-prefetch.mjs`:
  Studio's start files from Vite's manifest, 39 files). The 3D Company page prefetches them at the lowest priority,
  for editors only (never employees, never with Save-Data). Measured click → Studio ready (local AHDUS, RTX 4060,
  fresh browser profile, median of 3): Edit 1,233 → 1,196 ms, Create 2,087 → 1,242 ms; at 20 Mbit/s + 40 ms: Edit
  1,919 → 1,204 ms, Create 2,707 → 1,334 ms. After the click Studio downloads 141 kB instead of ~1 MB (24 of its 26
  files from the cache). Create no longer waits 800 ms before leaving.
- **Simple figures in colour:** when the full-character limit is reached, the people drawn as simple figures wear
  their outfit's main colours (top, trousers; skin-toned head) with softer shading, instead of grey dummies
  (`play/figureLook.js`: the Wardrobe's clothing, else the manifest's new optional `colors`, else a suit colour for a
  Rocketbox outfit, else a palette colour by `personId`). Each pose is 3 thin-instance meshes (6 for any number of
  people).
- **The full-character limit really rises:** the frames spent making characters counted as slow, so the limit fell
  back to 12 and the quality dropped a step on a fast graphics card. Now the frame-rate windows wait while characters
  are being made (and 1.5 s after). Measured (Meridian, 319 people, RTX 4060): 12 → 16 → 20 → 24 within ~30 s, ~125
  FPS, full quality, in every run (before: back to 12, shadows off for a minute).
- **Room type only when it says something new:** "Corridor · Corridor", "Stairs · Staircase", "Meeting room · Meeting
  room" show just the name (`play/roomNames.js`), in Find's results and menus and Studio's room card / hover card.
  AHDUS's 3D Company room list uses the same rule.

## 0.17.1 (14 Nov 2026): simple

Fewer things on screen in the 3D view (the viewer and the embed; Workplace Studio is unchanged). Every key still
works, and every button keeps a name for screen readers.

- **One toolbar:** Find · Overview / Walk · **My desk** · **More**. More holds Back to entrance, the company tour (its
  stops and minutes), the help, Low graphics and Hide me. The tour starts from More only (no Tour button, not in
  Find's menu), Find from its own button only. Overview / Walk is the one view switch inside the view. The floor's
  name shows in one place (the box at the bottom left).
- **My desk:** walks you to your own desk (as Take me there). Only shown when you have a desk.
- **Help:** 6 rows, with "All shortcuts" for the rest. No line of keys stays on screen. The keys are explained
  once: in the welcome card on the first visit (then no separate hint). The welcome card's main button is Explore,
  with a second, smaller **Start the tour** ("5 stops · about 1 min"); the tour is in More too. Opening Find or More,
  or starting the tour, closes the card.
- **One box at a time after arriving:** the "You have arrived" strip holds the E prompt ("E Details: Kavya Iyer"),
  and the room / floor box is hidden meanwhile. E (or a click) opens the person's card in place of the strip.
- **You never hide who you came to:** when Take me there or My desk arrives, the camera moves over your shoulder,
  higher, looking at the person or place (desktop and phone; a wall on one side: the other shoulder; no room for the
  camera at all: your character is hidden). Moving or turning brings the usual camera back.
- **No freeze while the company tour is planned:** the plan (made in the background after loading) runs in slices
  of a few milliseconds, and so do the route finder's first parts. Measured (Meridian-shaped layout, walking; Intel
  UHD graphics, the processor slowed 4 ×): the worst frame after loading went from 1,293 ms (and one of 385 ms) to
  176 ms, with no frame over 200 ms; the plan is ready ~5 s after the building.
- **Phones:** the toolbar's buttons are 44 px high, in one row (More shows only "···").
- **Hide me** (More) says what it does: "Others on this page won't see you walk". The page decides what it means:
  the embed's option `hideMe`, `setHideMe`, the `hideMe` event (docs/EMBED_GUIDE.md).
- **Name tags** of live people stay under the help, More and Find: never on top of them.
- **No freeze when the quality turns shadows off or on:** the meshes stop (or start) receiving shadows a batch of
  materials per frame, each batch waiting until its shaders are ready. The light's own switch is never flipped any
  more: that froze a frame whatever received shadows. Measured (Meridian-shaped layout, 319 people, walking; Intel
  UHD graphics, the processor slowed 4 ×): shadows off went from one 250–270 ms frame (and one of ~160 ms) to at most
  ~95 ms over ~17 frames; on, 120 ms → ~70 ms. Software WebGL (no graphics driver) still has ~1 s frames there: one
  material's new shader takes that long to compile.
- Engine: `engine.shadowsOn`, `engine.shadowsSwitching` (`systems/ShadowSwitch.ts`); `<LayoutViewer hideMe>`;
  `walkthrough.setArrivalView` / `getArrivalView` (`play/arrivalView.js`); `planTourSteps` (`play/navigation/tour.js`),
  `prepareMap` (`route.js`). e2e:controls 19 checks, e2e:touch 16, e2e:welcome 40, e2e:embed 40, e2e:live 24,
  e2e:navigation 22 (Kavya on screen, not covered by you, desktop and phone).

## 0.17.0 (14 Nov 2026): smooth

The 3D view on slow laptops and phones (the viewer and the embed; Workplace Studio is unchanged unless said).

- **Smoother walking and stairs:** walking, the camera and aiming test only what is within 8 m of you, and the
  layout's lists are made again only when the layout changes. Stairs no longer stutter.
- **The building first:** the people's full characters (and your own) come only once the floor you start on is
  drawn, then one at a time, the nearest first. Room surfaces wait for their photo textures instead of being
  painted twice. Character skinning runs on the graphics card (it always did; a box we measured from the bones on
  the processor is now fixed).
- **Quality that follows the device:** never sharper than a pixel ratio of 2 (a phone at 3 drew 2.25 × the pixels).
  When frames are slow for 3 s the view drops a step at once (sharpness, then shadows, then fewer full characters);
  it rises again slowly (5 smooth windows, never within a minute of a drop).
- **Low graphics:** a switch in the "?" help (the simple look, no full characters, no shadows), remembered in this
  browser.
- **Less work every frame:** the sun's shadows are drawn once and again only when the layout or the floor shown
  changes; no pick under the mouse on every move; the picture isn't copied after each frame (Studio still is, for
  its exports).
- **A smaller embed file:** no WebGPU shaders and no editing code in it: 2,959 → 2,643 kB (762 → 705 kB gzipped).
- **Memory:** walking for a long time no longer keeps every character file's baked clips after the file is
  unloaded. The heap growth seen during a walk was not a leak: it comes back down.
- **Measured** (Meridian, 319 people, the processor slowed 4 ×): walking 5.7 → 12.5 FPS on a laptop
  (9.0 with the best quality held), 6.7 → 14.2 FPS on a phone (10.3); stairs 7.1 → 25 FPS; the start floor shows
  after 9.7 s instead of 17.7 s.
- Engine: `engine.drawQuality`, option `autoQuality`, the `quality` event, `engine.setLowGraphics` /
  `lowGraphics` (docs/LAYOUT_ENGINE_API.md). e2e:controls 17 checks, e2e:embed 39.

## 0.16.2 (14 Nov 2026): small fixes

- **Typing names with an input tool (Hindi, Japanese, Chinese …):** the Enter that picks a word no longer saves
  the name half typed, and the Esc that drops a word no longer cancels the edit or closes the menu: the layout and
  workplace name, company and floor names, the Inspector's name and number fields, Floor height, Layers / library /
  catalog / people search, the viewer's Find box, popovers and dialogs (`utils/keys.js`: `isCommitEnter`,
  `isComposing`).
- **Steadier route timing test:** each Meridian route counts its fastest of 3 runs (as the tour test), the middle
  route is held to 100 ms (CI 250 ms), the slowest to 400 ms (CI 800 ms): no false failures on a busy machine.
- AHDUS (AHDUS-FRONTEND, with this update): the live WebSocket closes a page (code 4401, no retry) when its login
  token expires or the account is deactivated, checked every 2 minutes and at the token's expiry.

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
