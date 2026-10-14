# Workplace Studio: UI spec

**For Claude Code.** This replaces the planner's current screen (the left toolbar, the right RoomPanel/ObjectPanel
tabs and the bottom status bar) with a clean, card-based layout called **Workplace Studio**. Himan approved the
look from a reference screenshot (described in section 1). Build it in the order of section 9, run the tests after
each step, and show Himan screenshots at the end.

**Do not change:** the Zustand store, `editorHistory`, `layoutBridge`, the 3D scene code, or the pure maths in
`geometry.js` / `building.js`. This is a UI change only. Every action still goes through `editorHistory`.

---

## 1. The reference look

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🏢 AHDUS / Workplace Studio / HQ Layout ✎                     Saved  ↶  ↷  ⚙ │  header
│──────────────────────────────────────────────────────────────────────────────│  1px divider
│ ┌──────────┐ ┌───────────────────────────────────────────────┐ ┌───────────┐ │
│ │ Build    │ │                                    [2D|3D] ⤢  │ │ Inspector │ │
│ │ ┌──────┐ │ │                                               │ │ (only when│ │
│ │ │ ⠿    │ │ │                                               │ │ something │ │
│ │ │Select│ │ │            3D view (canvas card)              │ │ is        │ │
│ │ └──────┘ │ │                                               │ │ selected) │ │
│ │  ▦ Rooms │ │              [✥ ⟳ ⤢ ⧉ 🗑]  floating toolbar   │ │           │ │
│ │  ▤ Walls │ │              ┌──────────┐                     │ │           │ │
│ │  ⌂ Doors │ │              │   Desk   │                     │ │           │ │
│ │  ⇅ Stairs│ │                                               │ │           │ │
│ │  ⌑ Furn. │ │                                               │ │           │ │
│ └──────────┘ └───────────────────────────────────────────────┘ └───────────┘ │
│ ▾ Ground Floor · 3 rooms       Drag on the ground to draw a room   ▶ Preview Workplace │  footer
└──────────────────────────────────────────────────────────────────────────────┘
```

- Calm dark theme, **three rounded cards** (Build panel, canvas, Inspector) on a slightly lighter app background,
  16 px gaps between them and around the edge.
- Tool tiles: **icon above a short label**, the active one filled with a soft accent background.
- Few words, no shouting colours, no gradients. One accent colour (soft blue-violet).
- Empty layout: a centred empty state inside the canvas card ("Build your workplace" + "Add your first room").

## 2. Names (what the user sees)

| Old name | New name in the UI | Code (unchanged) |
|---|---|---|
| Planner | **Workplace Studio** (or just "Studio") | `WorkplaceEditor.jsx`, planner tools |
| Build mode / Play mode | **Preview** ("Preview Workplace" button, "Back to Studio" in Preview) | `playController.js`, `PlayHUD.jsx` |

Use these names in all UI text, tooltips and hints. Update `README.md` and the Two modes section of `CLAUDE.md`.

## 3. Design tokens

Create `src/ui/theme.css` with CSS variables and import it once in `main.jsx`. All new UI uses these variables;
no hard-coded colours in components.

```css
:root {
  --bg-app: #121726;        /* behind the cards */
  --bg-panel: #1c2335;      /* Build panel, Inspector, menus */
  --bg-canvas: #0b0f1a;     /* canvas card (before the 3D world draws) */
  --bg-hover: #26304a;
  --bg-active: #34405f;     /* active tile */
  --border: #2a3350;
  --text: #e8ebf4;
  --text-muted: #9aa3b8;
  --accent: #6b7cff;        /* primary buttons, focus ring, selection */
  --accent-hover: #7d8cff;
  --danger: #ef6b6b;
  --radius-sm: 6px; --radius: 10px; --radius-lg: 14px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --font: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --shadow-pop: 0 8px 24px rgba(0,0,0,.35);
}
```

- Font: Inter (`@fontsource/inter`, weights 400/500/600). Body 14 px; labels 13 px; header title 18 px/600.
  Nothing smaller than 12 px.
- Icons: `lucide-react`, 18 px (20 px in tiles), stroke 1.75, colour `--text-muted`, `--text` when active.
  Suggested icons: header `Building2`; Select `MousePointer2`; Rooms `LayoutGrid`; Walls `BrickWall`;
  Doors & windows `DoorOpen`; Stairs `Footprints` (or `ArrowUpDown`); Furniture `Armchair`; empty state `Boxes`;
  undo `Undo2`; redo `Redo2`; settings `SlidersHorizontal`; preview `CirclePlay`; floors `Layers`.
- Styling: plain CSS files next to the components (`src/ui/*.css`) using the variables. No new UI framework.
  Move away from the big inline `styles` objects in `WorkplaceEditor.jsx` for everything you touch.
- Every scrollable area: thin dark scrollbar (`scrollbar-width: thin; scrollbar-color: var(--border) transparent;`
  plus the `::-webkit-scrollbar` equivalents). **No white browser scrollbars anywhere.**
- Focus: visible 2 px `--accent` ring on every button for keyboard users. Hover: `--bg-hover`.

## 4. Layout and components (new folder `src/ui/`)

### 4.1 `StudioShell.jsx`
CSS grid: header (56 px) / main (1fr) / footer (44 px). Main = `[Build panel 168px] [canvas 1fr] [Inspector 320px]`;
the Inspector column is 0 when closed. Gaps 16 px. The page itself never scrolls.
The Babylon canvas lives inside the canvas card; resize the engine when the card changes size (an Inspector
opening or closing must not stretch the picture).

### 4.2 Header (`StudioHeader.jsx`)
- Left: `Building2` icon + **AHDUS** (600) + muted breadcrumb `/ Workplace Studio / <layout name>`. Clicking the
  layout name edits it inline (Enter saves, Esc cancels; undoable like other renames if the store supports it,
  otherwise as today). The back arrow to the company list is the AHDUS logo itself (tooltip "All layouts").
- Right: save status text ("Saved" / "Saving…" / "Not saved"), then icon buttons **Undo**, **Redo** (disabled
  look when unavailable), **Settings** (`SlidersHorizontal`).
- Settings opens a small popover: Snap on/off + step (0.25 / 0.5 / 1 m), Show grid, Lighting (Day / Evening /
  Night, from the existing lighting buttons), Units (m). FPS counter: dev only (`import.meta.env.DEV`), shown here
  as a small muted line, not on the main screen.
- A 1 px `--border` divider under the header, inset by 16 px (as in the reference).

### 4.3 Build panel (`BuildPanel.jsx`)
- Card titled **Build**. Vertical list of tiles (icon above label, 136 × 60 px, radius 10):
  **Select**, **Rooms**, **Walls**, **Doors & Windows**, **Stairs**, **Furniture**.
- The tool list is defined **once** in `src/ui/tools.js` (id, label, icon, shortcut, hint text, options) and also
  used by Preview's hotbar, so both screens show the same tools with the same icons.
- Clicking a tile (except Select) opens its **options tray**: a 264 px popover card attached to the right edge of
  the Build panel, over the canvas, with `--shadow-pop`:
  - **Rooms:** every room type (coloured dot, name, default size, e.g. "Office · 8 × 6 m"). Picking one arms the
    "draw room" tool for that type.
  - **Walls:** Wall.
  - **Doors & Windows:** Door, Window.
  - **Stairs:** Straight staircase (Lift later: show it disabled with "Coming soon").
  - **Furniture:** search box, category chips (Office, Meeting, Kitchen, Industrial, …), and a grid of items
    (name + small icon; real thumbnails later). Picking one starts placement as today. The tray may scroll
    (dark thin scrollbar).
- After a pick the tray closes, the tile stays active and shows the choice as a second muted line
  ("Rooms · Office"). Clicking the active tile again reopens the tray. **Esc** returns to Select.
- Shortcuts: 1–6 for the tiles (shown in tooltips "Rooms (2)"). Keep W / E / R for Move / Rotate / Scale and
  Ctrl+Z / Ctrl+Y.
- Below 1280 px window width the tiles become icon-only (72 px wide panel) with tooltips.
- This panel replaces: `PlannerToolbar.jsx`, the "Add room" area of `RoomPanel`, and the Rooms/Objects tabs.

### 4.4 Canvas card (`CanvasCard.jsx`)
- Rounded card (radius 14, 1 px border). Inside, top-right: a small floating group **2D | 3D** and **Fit view**
  (`Maximize2`). Bottom-right: nothing else (no FPS, no compass blobs). **Remove the black circle that currently
  overlaps the footer at the bottom centre.**
- The scene uses the same site environment as Preview (sky, grass, paving); the build grid shows only while a
  build tool is active. Room labels on the floor in Studio: "Office · 8 × 6 m".
- **Empty state** (no rooms on any floor): centred `Boxes` icon (40 px, accent), **Build your workplace** (18 px,
  600), muted line "Start by adding your first room to the workspace.", and a primary button **+ Add your first
  room** that activates Rooms and opens its tray.
- **Floating selection toolbar** (`SelectionToolbar.jsx`): a small pill above the selected object/room (project its
  bounding box to screen every frame; keep it inside the card). Object: Move, Rotate, Scale, Duplicate, Lock,
  Delete. Room: Rename, Change type, Delete. Hidden when nothing is selected or the camera is moving fast.

### 4.5 Inspector (`Inspector.jsx`)
- Right card, **closed when nothing is selected** (animate width 0 → 320 px, 150 ms).
- Header: item name (editable) + type label + close `X` (close = deselect).
- Sections with small uppercase muted titles: **Position** (X, Z, height, floor), **Rotation**, **Size**
  (scale with keep-proportions toggle), **Details** (label, department, linked position for desks: keep the
  current positionRef UI), **Room** (for rooms: type, width, depth, wall height, doors/windows count).
- Footer of the card: Duplicate, Lock, Delete (danger).
- Reuse the logic of `PropertiesInspector.jsx` (same `editorHistory` calls and merge keys), restyled.
- Also reachable: a **Layers** button (`Layers` icon) at the bottom of the Build panel opens the Inspector as an
  outline of rooms and objects on this floor; clicking one selects it and flies the camera to it.

### 4.6 Footer (`StudioFooter.jsx`)
- Left: **floor switcher** button "▾ Ground Floor · 3 rooms". Click opens a menu listing floors top first, each with
  its room count; plus **Add floor above**, **Rename**, **Delete floor** (confirm; undoable). Replaces
  `FloorSelector.jsx` and the old floors section.
- Centre: the **hint** for the active tool (muted, one line), e.g. "Drag on the ground to draw a room", "Click a
  wall to add a door". Reuse the hint texts from `tools.js`. This replaces the old status bar.
- Right: **▶ Preview Workplace** (`CirclePlay` icon, text button; Tab also works).

### 4.7 Preview (Walk mode) restyle
- Keep all behaviour. Restyle `PlayHUD.jsx` with the same tokens: hotbar slots use the `tools.js` icons
  (lucide, no emoji), same radius and colours; the catalog (B) looks like the Furniture tray.
- Top-left: **Back to Studio** button (Tab). Hints use the same small card style.

## 5. What gets deleted

- `PlannerToolbar.jsx` (replaced by header + Build panel + footer).
- The big gradient **Play** button, the bottom status bar, the on-screen FPS text.
- `RoomPanel`'s "Room Builder / Add Office" area and the old up/down/left/right room buttons.
- The Rooms / Objects tabs on the right (Inspector + Layers replace them).
- Emoji icons in the UI.

Remove dead code and unused styles when you delete these.

## 6. Behaviour rules

- Each feature exists in **one place**. Anything is reachable in **≤ 2 clicks**.
- Opening a tray, menu or popover never moves the canvas; clicking outside or Esc closes it.
- Disabled things look disabled and have a tooltip saying why (e.g. Redo: "Nothing to redo").
- All text is short, plain English, sentence case ("Add floor above", not "ADD FLOOR").
- Works on upper floors exactly like on the ground floor.

## 7. Accessibility and test hooks

- Every icon button has an `aria-label` and a tooltip. Use these exact labels (tests rely on them):
  `Undo`, `Redo`, `Settings`, `Select`, `Rooms`, `Walls`, `Doors & Windows`, `Stairs`, `Furniture`, `Layers`,
  `Floor switcher`, `Add floor above`, `Preview Workplace`, `Back to Studio`, `Add your first room`,
  `2D view`, `3D view`, `Fit view`, `Close inspector`.
- Update the e2e scripts (`editor-smoke`, `tools-smoke`, `play-smoke`, `modules-smoke`, `building-smoke`) to use
  these labels instead of the old button texts ("▶ Play", "+ Add Floor", "Start building", …).

## 8. Done when

- At 1280×720 and 1920×1080: the page and the Build panel do not scroll; the canvas card is **≥ 75 % of the
  width** when nothing is selected; nothing overlaps the footer.
- The empty state shows on a new layout, and "Add your first room" → pick Office → drag → a room appears.
- Select an object → floating toolbar + Inspector appear; Esc / X → both disappear.
- Floor switcher adds, renames, deletes (undo brings it back) and switches floors.
- Preview Workplace ↔ Back to Studio works with the button and with Tab.
- `npm test`, `npm run typecheck` and **every** e2e script pass. No console errors.
- Screenshots saved to `e2e/screens/`: `studio-empty.png`, `studio-tray-rooms.png`, `studio-selected.png`,
  `studio-floor-menu.png`, `preview-hud.png`. Show them to Himan.

## 9. Order of work (test after each step)

1. `theme.css`, fonts, `lucide-react`, `src/ui/tools.js`.
2. `StudioShell` + header + footer around the existing canvas (old panels still inside, temporarily).
3. `BuildPanel` + options trays, wired to the existing planner tools (`src/planner/plannerTools.js`).
4. Canvas card: view controls, empty state, environment, room labels, selection toolbar.
5. `Inspector` (from `PropertiesInspector`) + Layers outline.
6. Floor switcher in the footer.
7. Delete the old UI (section 5) and dead code.
8. Restyle Preview's HUD with the same tokens and icons.
9. Update e2e selectors, run everything, take the screenshots, update `README.md`, `CLAUDE.md` and
   `docs/PROGRESS_REPORT.md` (new section: "Workplace Studio UI").
