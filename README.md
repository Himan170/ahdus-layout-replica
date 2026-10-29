# AHDUS Company Layout Replica

Himan's module of **AHDUS (Advance Human Digital Unified System)**: the 3D replica of a company's building.
You build the workplace in two ways that edit the same layout:

- **Workplace Studio** (or just "Studio"): the main screen. A Build panel on the left (Select, Rooms, Walls,
  Doors & Windows, Stairs, Furniture), the 3D view in the middle, and an Inspector on the right when
  something is selected. The floor switcher, the hint for the active tool and **Preview Workplace** are at the bottom.
- **Preview**: walk through the workplace as a character, and build Minecraft-style with the item in your hand.

Press **Tab** (or **Preview Workplace** / **Back to Studio**) to switch. The editor opens in Workplace Studio.

## Workplace Studio

| | |
|---|---|
| **Build panel** | Click a tile (or press 1–6) to open its options, pick one, then use it on the view. Esc goes back to Select. |
| Rooms | Pick a room type, then drag on the ground from one corner to the opposite corner. |
| Walls | Drag from where the wall starts to where it ends. |
| Doors & Windows | Click a room wall to add one; click an existing one to remove it. |
| Stairs / Furniture | Pick an item, then click the floor or a table top. R turns it, the wheel changes its height. Furniture cards can also be dragged onto the view. |
| Select | Click an item or a room. Drag a wall of a selected room to resize it. |
| **Doors & windows** | Select: click one. The Inspector shows its width and height (type new ones), and blue handles on its sides and top resize it by dragging. Delete removes it. |
| **Selection** | A small toolbar floats above what you selected (move / rotate / scale / duplicate / lock / delete, or rename / change type / delete for a room). The Inspector shows its exact numbers. Esc or X deselects. |
| **Measurements** | Measure Distance captures two world-coordinate points; independent controls show/hide wall lengths and rectangular room areas. Measurements are temporary annotations; Clear Measurements does not change the layout. |
| **Layout templates** | When creating a layout, choose Start from Blank Layout, Small Office, Factory Floor, or Clinic. Template previews are generated from the JSON room geometry. |
| **Layers** | Bottom of the Build panel: everything on this floor; click one to select it and fly to it. |
| **Header** | Click the layout name to rename it. Undo, Redo, and Settings (snap, grid, lighting). |
| **Footer** | Floor switcher (switch, add a floor above, rename, delete), the tool's hint, Preview Workplace. |
| Keys | W / E / R: move / rotate / scale gizmo · Ctrl+Z / Ctrl+Y · Ctrl+D duplicate · L lock · Delete · Tab: Preview |

## Getting started (for teammates)

You need **Node.js 20.19 or newer** (`node -v`) and git.

```bash
git clone https://github.com/Himan170/ahdus-layout-replica.git
cd ahdus-layout-replica
npm ci                 # install dependencies exactly as in package-lock.json
npm run dev            # http://localhost:3000
npm test               # unit tests
npm run lint           # ESLint: real mistakes only, no style rules
npm run typecheck      # TypeScript check
npm run build          # production build (and npm run build:embed for the embed)
```

Browser tests (one-time: `npx playwright install chromium`) need `npm run dev` running in another terminal;
run them one script at a time, e.g. `npm run e2e:planner`, `npm run e2e:measurements`, or `npm run e2e:templates` (the list is in `CLAUDE.md`).

> **⚠️ Do NOT zip or copy `node_modules` between machines.** The Windows-installed copy
> contains native binaries that do not run on other machines. Always run `npm ci` after cloning.

Read `CLAUDE.md` before making changes — it documents the architecture rules (e.g. every edit
goes through `editorHistory.js`, old saves must always load). Who does what: `TEAM_TASKS.md`.

### Making a change (pull request)

Nobody pushes to `main` directly: every change goes in through a pull request that CI has checked.

```bash
git switch main
git pull                          # start from the latest main
git switch -c yourname/short-topic  # a branch for this task, e.g. anish/lifts
# ...edit, then check:
npm run lint
npm test
npm run typecheck
npm run build
git add -A
git commit -m "Add: lifts between floors"   # style: "Add: ...", "Fix: ...", "Docs: ..."
git push -u origin yourname/short-topic
```

Then open the link git prints (or GitHub → **Pull requests** → **New pull request**), choose your branch, describe
what changed and how you tested it (which `npm run e2e:...` script), and ask Himan to review. GitHub runs the
**CI checks** (lint, typecheck, unit tests, both builds) on it; the pull request can be merged only when they are
green and it is approved. If `main` moved on meanwhile: `git pull origin main` on your branch, fix any conflicts,
push again.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Layouts are saved in the browser (localStorage) automatically, about a second after each change, and when you
go back to the layout list or close the tab. The header shows **Saving…**, **Saved** or **Not saved** (with the reason).

**Always use port 3000.** The browser keeps saved layouts per address, so layouts saved on `localhost:3000` are
not visible on `localhost:3001`. The dev server is set to `strictPort`: if port 3000 is busy, `npm run dev` stops
with an error instead of quietly moving to another port. Close the other dev server (or whatever uses port 3000) and
run it again.

## Preview controls

| Key | Action |
|---|---|
| W A S D | Move (Shift to run) |
| Mouse | Look around (click the view to capture the mouse, Esc to release it) |
| Space | Jump |
| F | Fly on/off (Space up, C down) |
| V | First-person / third-person camera |
| 1–9 or mouse wheel | Choose hotbar slot |
| B | Catalog: put any item into the selected slot |
| N | Add a new floor above the one you're on |
| Left-click | Build with the item in your hand |
| Right-click | Remove what you look at (or cancel a half-drawn room/wall, or a grabbed wall) |
| R | Rotate furniture before placing |
| E | Use what you look at (other modules add the actions; see `docs/TEAM_INTEGRATION.md`) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Tab | Back to Studio |

**Building with each item**

- **Room** (Office, Meeting, Reception, …): click one corner on the ground, then the opposite corner. The preview shows the size. A room drawn against another room snaps back-to-back with it.
- **Stretch room** (slot 3): aim at any wall of a room and click to grab it, look at the ground where the wall should go (the new size shows live), click again to put it there. Right-click cancels. It won't let a room overlap another room, get smaller than 1.5 m, or cut through a door, window or piece of furniture; doors and windows on the side walls stay where they are.
- **Wall** (in the catalog, B): click where it starts and where it ends. The next wall continues from the end; right-click stops.
- **Door / Window**: aim at a room wall and click. On a wall shared with a neighbouring room, the door goes through both walls.
- **Edit item** (slot 9): aim at an item to move it (click), turn it (R), resize it (+ / −), reset it (0) or lock it (L). Aim at a **door or window** to change its size: **+ / −** (the = and − keys, or the numpad) makes it 0.1 m wider or narrower, **Shift + / −** taller or shorter, **0** gives it the standard size. The hint shows the size ("Door 1.1 × 2.1 m"), or why it can't grow. A door shared by two rooms changes in both.
- **Furniture and equipment**: aim at the floor (or a table top, e.g. a monitor on a desk) and click.

**Multi-storey buildings**

- Press **N** to add a floor above. Reach it by flying (**F**, then **Space**) or by building stairs.
- **Staircase** (slot 8): place it inside a room; it climbs exactly one storey (3.5 m). The floor above gets an opening over it automatically, and you walk up and down it.
- While you are above a floor (flying or upstairs), the room, wall, door, window and furniture tools build on **that** floor.
- Outside you see the whole building with its roofs. Inside a room you get a ceiling with lights, and the camera stays under the ceiling.
- In Workplace Studio, choosing a floor shows that floor and the ones below it, with its own roof hidden so you can see inside.

Every action is undoable.

## Connecting other modules

Teammates' modules (characters, machine videos, handover notes, monitoring) connect through
`src/integration/layoutBridge.js`. Read **`docs/TEAM_INTEGRATION.md`**, and open
`http://localhost:3000/?demoModules=1` to see three demo modules working.

## Tests

```bash
npm test             # unit tests (geometry, collisions, undo history, layout migration)
npm run typecheck    # TypeScript check

# Browser tests (one-time: npx playwright install chromium), with `npm run dev` running:
npm run e2e:planner  # Workplace Studio: layout, empty state, placing, Inspector, floors, Preview switch
npm run e2e:play     # Preview: build rooms/doors/windows/furniture, walk through doors
npm run e2e:modules  # demo teammate modules: E prompts, room events, desk links
npm run e2e:building # two storeys: N, rooms upstairs, stair opening, walking up and down
npm run e2e:tools    # Studio build tools with the mouse, door/window sizes, and Preview's Edit item tool
npm run e2e:save     # saving: name, auto-save, reopen a layout, layout list, delete
```

## Code map

```
src/
├── components/
│   ├── WorkplaceEditor.jsx    Scene setup, mesh syncing, Studio wiring, Studio/Preview switching
│   └── PlayHUD.jsx            Preview screen: hotbar, crosshair, hints, catalog
├── ui/                        Workplace Studio (design tokens in theme.css)
│   ├── theme.css              Design tokens (colours, radii, spacing, font)
│   ├── tools.js               The build tools, defined once (Studio tiles + Preview icons)
│   ├── StudioShell.jsx        Header / Build panel / canvas card / Inspector / footer layout
│   └── …                      StudioHeader, BuildPanel, CanvasCard, SelectionToolbar, Inspector, StudioFooter
├── play/
│   ├── playController.js      Character movement, camera, aiming, building tools
│   ├── character.js           Placeholder character (to be replaced by Harsh's module)
│   ├── movement.js            Collision-safe movement in small steps
│   ├── geometry.js            Pure maths: room corners, wall splitting, doors, neighbours
│   └── hotbarItems.js         Everything you can hold, default hotbar, catalog sections
├── store/
│   ├── workspaceStore.js      Zustand store (rooms, objects, floors, selection)
│   └── editorHistory.js       The ONE place layout changes happen, all undoable
├── engine/                    Embeddable engine for the team (schema, migration, anchors, commands)
└── utils/
    ├── roomBuilder.js         Realistic rooms: textured floors, plaster walls, skirting, frames, glass
    ├── materialLibrary.js     Wood, carpet, tile, concrete, plaster, paving, grass (drawn in code)
    ├── siteEnvironment.js     Sky, fog, land around the plot, build grid
    └── assetCatalog.js        30+ furniture and equipment models
```

For teammates: see `docs/LAYOUT_ENGINE_API.md` for anchors and events.

## Known limits

- Persistence uses the browser's local storage; there is no server yet.
- Rooms are rectangles; free-form wall drawing with shared walls is planned (Workstream B).
- Furniture is built from simple shapes; real 3D models are planned (Workstream C).
- Stairs are one straight flight per storey; no lifts yet.
