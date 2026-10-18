# Room format and shared walls

## Existing representations

The editor's live workspace and local saves use the v1 store shape. A room is
an ID-keyed store record (saved as an array) with fields such as:

```js
{
  id, floor, type, name, x, z, width, depth, wallHeight, color,
  doors: [{ wall, offset, width, height }],
  windows: [{ wall, offset, width, height, sill }]
}
```

`x` and `z` are the room centre, `width` spans X, and `depth` spans Z. The
floor's `height` determines its elevation; a room's `wallHeight` is its wall
height above its own floor. Floors and room elevations are not duplicated in
the live room record. The room store creates rectangular rooms and the
workspace store retains this shape for undo, localStorage saves, and reloads.
Doors and windows are nested in the room and use wall-relative offsets.

The engine's v2 export format is separate. Its `RoomSchema` uses `floorId` and
keeps the same rectangular centre/dimensions, while doors and windows are
serialized in the top-level `openings` array with a `roomId`. `migrateV1toV2`
maps nested v1 openings to that array; the workspace loader independently
normalizes older local saves back to v1 store records. These formats are not
interchangeable at the renderer boundary.

## Nested rooms

Room nesting uses the same centre-based rectangles and world coordinates; it
does not add a parent ID or change either serialized format. The enclosing room
is derived from same-floor containment. A child footprint must fit completely
inside the parent's usable interior, leaving `0.15 m` from each parent room
boundary so the two `0.15 m` walls do not overlap. The full width and depth are
checked, not just the child's centre. A `1e-6 m` comparison epsilon handles
floating-point edge values.

When a new room is being drawn inside an existing room, neighbour snapping is
skipped when the drawn rectangle, its centre, or either drag endpoint indicates
an interior placement attempt. An attempt that crosses the usable boundary is
rejected rather than pushed to the parent's exterior.
Normal back-to-back edge snapping remains active for adjacent rooms. A
contained room may overlap its enclosing room, but a candidate that overlaps
or encloses an unrelated room remains blocked. The same containment rule applies when a room wall is resized or when a
selected room is dragged by its floor in Workplace Studio. Whole-room movement
preserves the room's dimensions, is undoable, and is blocked if it leaves an
existing parent or overlaps a sibling. Rooms on different floors do not
contain or block one another.

The parent floor surface is cut out beneath a nested room's wall footprint to
avoid coplanar floor surfaces. If the child wall reaches the parent's ceiling,
the parent ceiling surface is cut out as well. These are render-time surface
holes only: upper-floor slabs and roofs are not cut, and no parent/child
references are persisted. Nested rooms therefore retain their coordinates
when moved, resized, saved, loaded, or migrated; old rectangular layouts need
no migration. Each room keeps its own doors, windows, floor, finishes, and
undoable store record.

For example, a `12 × 10 m` office centred at `(0, 0)` has a usable interior
from `-5.85` to `5.85 m` on X and `-4.85` to `4.85 m` on Z. A `4 × 3 m`
meeting room centred at `(0, 0)` fits inside it. The same meeting room centred
at `(3.9, 0)` does not: its right edge reaches `5.9 m`, past the usable
interior. Multiple non-overlapping child rooms can be placed in the office.

## Shared-wall representation

Shared walls are derived from room rectangles; they are not saved as a second
source of truth. No room fields, opening fields, schema version, or generated
IDs are added. This keeps editing, history, saving, and existing team-facing
v2 data compatible.

Wall orientation follows the editor conventions:

| Wall | Boundary | Along-wall axis | Opposite |
| --- | --- | --- | --- |
| north | `z + depth / 2` | X | south |
| south | `z - depth / 2` | X | north |
| east | `x + width / 2` | Z | west |
| west | `x - width / 2` | Z | east |

An opening's `offset` is measured from its room's centre along the wall
(positive X on north/south; positive Z on east/west). A boundary is shared
only by opposite-facing walls on the same floor whose centre lines coincide
within `0.02 m`, or are separated by the existing `0.15 m` wall thickness
within `0.02 m`. The latter is the current planner's back-to-back placement.
The intersection of the walls' physical along-wall extents is the shared
segment; a point or corner contact is not enough. This tight tolerance avoids
merging rooms merely because they are nearby. The same matching rule is used
for wall openings.

For a shared segment, the renderer removes the matching portions from both
room walls and emits one wall of `0.15 m` thickness. Its fixed coordinate is
the midpoint of the two room wall centre lines (the centre line itself when
they coincide). Stable room-ID ordering chooses which room mesh owns that
piece. The owner choice affects mesh lifetime and picking metadata only, not
the saved room format. A shared wall's height reaches the taller adjoining
room's wall height. The same ownership and segmentation are used for wall
bands and roof parapets. Unshared portions retain the existing corner-aware
wall lengths and materials.

### Adjacent-room example

Room A is centred at `(0, 0)` and is `6 × 4 m`. Its east wall centre line is
`x = 3`, spanning approximately `z = -1.925 .. 1.925` after the existing
east/west corner inset. Room B is centred at `(5.15, 0)` and is `4 × 4 m`.
Its west wall centre line is `x = 3.15`, with the same span. Their shared
physical wall is emitted once at `x = 3.075`, from `x = 3.0` to `x = 3.15`,
over the common Z span.

If B is only `2 m` deep and centred at `z = -1`, its wall overlaps only part
of A's east wall. Only that interval is emitted as shared; the rest of A's east
wall remains external. B's other wall portions likewise remain external.

## Openings

The planner can store one door/window on both rooms when an opening connects
back-to-back rooms. The renderer gathers openings from both sides of the
shared segment, converts their offsets to the owner's wall coordinates, and
emits one opening, frame, glass set, and invisible picking pane for matching
references. Matching kind, centre, and width are deduplicated; the stable owner
side wins if both sides disagree. A reference present on only one room still
cuts the shared wall. Door panes remain non-blocking, and wall pieces remain
split around openings, preserving the current pass-through collision behavior.

Room geometry still carries `roomId`, `floorId`, `wallName`, opening kind and
index metadata. An opening sourced from the partner keeps that partner's
`roomId` and opening index, so existing Inspector selection, removal, and
resizing workflows continue to address the source record. The opening
placement and resizing functions still update both room records as one
undoable operation when a partner exists.

## Editing and lifecycle

Moving or resizing a room changes its boundary and therefore the derived
shared segment on the next mesh sync. The mesh key includes same-floor room
geometry and openings, so both affected sides rebuild when either room
changes. Removing a neighbour removes the shared segment and restores the
remaining room's full external wall. Undo/redo uses the existing room
commands; no shared-wall command or persistent link needs to be synchronized.
Rebuilt room meshes dispose their child meshes but keep shared materials.

The geometry is derived independently on each floor, so identical footprints
on different storeys do not share walls. Existing floors, slabs, ceilings,
roofs, stair openings, room selection, and mesh picking remain on their
existing paths.

## Compatibility, migration, and edge cases

- Existing v1 store saves remain unchanged and gain shared walls at render
  time; no data migration is required for this feature.
- v1-to-v2 export continues to use `schemaVersion: 2` and the existing
  separate-opening representation. Migration preserves existing room IDs,
  finishes, department references, opening values, objects, anchor data,
  routes, and floor links where those values are present. The v2 Zod schema
  remains the validator; malformed migrated values are rejected by
  `loadLayout`.
- Repeated load/export does not append shared-wall records or duplicate
  openings because neither is written to the room data.
- `0.02 m` is the intentional boundary matching tolerance, distinct from the
  planner's much wider `0.35 m` snapping range. A separation outside the
  coincidence or `0.15 m` bands remains two separate walls.
- Partial overlap is supported. Multiple non-overlapping neighbours can share
  separate intervals along one wall. If malformed input places multiple rooms
  over the exact same interval, a stable partner ordering prevents duplicate
  wall output; overlapping room footprints themselves are not repaired by
  this feature.
- The engine v2 `RoomSchema` does not encode `wallHeight` as optional; old v1
  saves without it keep the existing migration default. The local store loader
  continues to apply its own historical floor/wall-height defaults.
