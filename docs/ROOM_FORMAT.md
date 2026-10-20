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
not assume which side builds the wall. The owner choice affects mesh lifetime
and picking metadata only, not the saved room format. A shared wall's height
reaches the taller adjoining room's wall height. The same ownership and
segmentation are used for wall bands and roof parapets. Unshared portions
retain the existing corner-aware wall lengths and materials.

As for every room part, the pieces of one room wall (its shared and unshared
segments, split around openings) are merged into one mesh per wall, with one
sub-mesh per material and a frozen world matrix; a shared piece is part of its
owner's wall mesh.

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
shared segment on the next mesh sync. The mesh key (`roomGeometryKey`)
includes the geometry and openings of every room on the same floor, so both
affected sides rebuild when either room changes (and so do the other rooms on
that floor). Removing a neighbour removes the shared segment and restores the
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
