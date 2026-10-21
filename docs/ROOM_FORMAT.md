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

New rooms get the id `room_<uuid v4>` (objects `obj_<uuid v4>`), so two tabs
or two people never make the same one. Ids from older saves (`room_3`,
`obj_12`) are kept as they are; anchor IDs derive from them.

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
is derived from same-floor containment (`roomContainedBy`; the innermost one is
`containerOf`). On each side a child either keeps at least `0.15 m` from the
parent's boundary (its own wall, clear of the parent's), or **stands on the
parent's wall**: its edge lies on the parent's edge (± `0.02 m`), and the
parent's wall is its wall there. Anything between (the two walls partly in each
other), sticking out, or the very same rectangle is not contained. A child may
stand on two opposite walls (a full-width strip). The full width and depth are
checked, not just the child's centre. A `1e-6 m` comparison epsilon handles
floating-point edge values.

**Snapping (one rule everywhere): `geometry.snapRoomRect`.** Drawing (Studio and
Preview), Stretch, the Studio wall drag, the Inspector size and dragging a room
by its floor all use it; Stretch moves only the dragged edge, the Inspector the
edges that change, moving keeps the size (`translate`). Within `ROOM_SNAP`
(`0.35 m`) an edge moves to the nearest of:
- a **sibling's** wall, back to back (`0.15 m` apart): rooms in the same parent,
  or both top-level. Rooms inside other rooms, or inside the room being
  changed, are never neighbours;
- the **parent's** wall on the same side (the child then stands on it); and the
  other way round, a parent's edge onto the children standing inside it;
- otherwise (top-level rooms only) a wall of the floor below (`OUTLINE_SNAP`).

A room drawn with a corner or its middle inside a room has that room as its
parent (the smallest if several). A contained room may overlap its parent, but
a candidate that overlaps or encloses an unrelated room remains blocked
(`roomPlacementBlocker`). Changing an existing room (`roomRectBlocker`): its
parents must still contain it, its children must still be inside it, and it may
not overlap anything else. Whole-room movement preserves the room's dimensions
and is undoable. Rooms on different floors do not contain or block one another.

**A child standing on the parent's wall** (`roomWallSegments`): the parent
builds nothing along the child's stretch of that wall; the child builds it,
full thickness, on the parent's line, as a piece shared with the parent
(`sameSide`, `partnerWall` = the same wall name). The child's other walls stop
at that wall's inside face, so no faces coincide. If an outside neighbour is back
to back with the parent there, the child shares that stretch with the neighbour
instead (the parent's spans exclude it, `ownWallSpans`). A door on that stretch
goes through the one wall and is stored on both rooms (`partnerWall`).

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
meeting room centred at `(0, 0)` fits inside it. Centred at `(4, 0)` its right
edge is on the office's east wall (`6 m`): it stands on it. Centred at `(3.9, 0)`
(right edge `5.9 m`) the walls would be in each other: not contained, but
drawing or moving it there snaps it onto the wall. Multiple non-overlapping
child rooms can be placed in the office. Rooms saved `0.15 m` or more in from the
wall (before this rule) stay as they are, with their own wall.

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
they coincide). The room whose `id` sorts first (string order) owns that
piece and builds it. With UUID ids the owner of two neighbours is stable but
not predictable (it is not necessarily the older room), so code and tests must
not assume which side builds the wall. The owner choice affects which room's
mesh holds the piece only, not picking, selection or the saved room format. A shared wall's height
reaches the taller adjoining room's wall height. The same ownership and
segmentation are used for wall bands and roof parapets. Unshared portions
retain the existing corner-aware wall lengths and materials.

As for every room part, the pieces of one room wall (split around openings)
are merged into one mesh per wall, with one sub-mesh per material and a frozen
world matrix. A shared piece is a mesh of its own under its owner, tagged with
`sharedWith` (the other room's id), `sharedWall` (the other room's wall name)
and `sharedAt` (the world coordinate of the shared wall's centre line).

### Picking and selection

A shared wall is a wall of both rooms. A click in Studio, or aiming in Preview
(Stretch, doors and windows, removing a room), means the room on the side it
was hit from: `geometry.wallPickTarget(meta, from)` compares a point on that
side with `sharedAt`. `pickHelpers.wallTargetOf(hit, eye)` finds that point
from the hit face's normal; on the top or end of the wall it uses the camera
position (3D) or the hit point itself (the 2D view: which half of the top was
clicked). Doors and windows on a shared piece carry the same tags, so Stretch
aimed at a frame also grabs the wall on your side. A child's piece on the
parent's wall carries `sameSide`, `innerRoom` and `outerRoom`: from inside it is
the child's wall, from outside the parent's. Selecting either room
outlines the shared wall (`roomBuilder.setRoomSelected` lights a shared piece
when its owner or `sharedWith` is selected).

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
references (the frame and glass are one merged mesh, the pane another). Matching kind, centre, and width are deduplicated; the stable owner
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
shared segment on the next mesh sync. The mesh key (`roomGeometryKey`) is
made from `geometry.roomBuildInput`: the room and the rooms touching it on its
floor (within `0.15 + 0.02 m`, the reach of a shared wall), with their
geometry and openings. So a change rebuilds the room and the rooms touching
its old or new rectangle, not the other rooms on the floor;
`geometry.roomsToRebuild(before, after)` gives that set. Removing a neighbour removes the shared segment and restores the
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
  separate-opening representation. Migration preserves existing room IDs
  (UUID or older `room_3` style),
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
