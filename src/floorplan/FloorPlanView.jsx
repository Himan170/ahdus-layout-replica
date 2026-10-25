/**
 * floorplan/FloorPlanView.jsx (Anshu, S1)
 *
 * The floor plan of the current floor (the canvas card's "Plan" view): rooms and
 * items from the store, drawn in world metres with north up, as in the 2D view
 * (planMath: toPlan / toWorld): walls with their doors and windows from the room
 * data (planMath.roomWallPieces), room names, items. Click, or Tab to it and
 * Enter, selects (it is also the accessible view); dragging an item moves it by
 * Studio's rules (planMath.planDrop).
 */

import { useMemo, useState } from 'react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { WALL_THICKNESS } from '../play/geometry';
import { sizeLabel } from '../ui/tools';
import {
  planDrop, itemSize, roomWallPieces, wallSegmentEnds,
  toPlan, screenToWorld, planAngle, planViewBox,
} from './planMath';

/** World point → SVG attributes. */
const at = (p) => toPlan(p);

export default function FloorPlanView({
  rooms = [],
  objects = [],
  selectedRoomId = null,
  selectedObjectId = null,
  onSelectRoom = () => {},
  onSelectObject = () => {},
  onMoveObject = () => {},
  onRotateObject = () => {},
  snap = null,        // { enabled, step }: Studio's snap setting
  ground = false,     // the ground floor (outside rooms is the ground)
}) {
  const [drag, setDrag] = useState(null);

  const plan = useMemo(() => {
    const validRooms = rooms.filter((r) => Number(r.width) > 0 && Number(r.depth) > 0);
    const furniture = objects.filter((o) => Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.z)));
    const view = planViewBox(validRooms, furniture);
    return view && { rooms: validRooms, objects: furniture, view };
  }, [rooms, objects]);

  if (!plan) {
    return (
      <div className="floor-plan-empty">
        Add a room or furniture to see the floor plan.
      </div>
    );
  }

  /** Where the pointer is, in world metres. */
  const pointerWorld = (event, svg) => {
    const inv = svg.getScreenCTM().inverse();
    return screenToWorld(event.clientX, event.clientY, inv);
  };

  function pointerDown(event, object) {
    if (object.isLocked) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectObject(object.id);

    const start = pointerWorld(event, event.currentTarget.ownerSVGElement);
    setDrag({
      id: object.id,
      start,
      current: start,
      originalX: Number(object.x) || 0,
      originalZ: Number(object.z) || 0,
      moved: false,
    });

    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /** Where the dragged item would land (snapped, on a table top or the floor). */
  function dropOf(d) {
    const object = objects.find((o) => o.id === d.id);
    if (!object) return null;
    return planDrop(object, {
      x: d.originalX + d.current.x - d.start.x,
      z: d.originalZ + d.current.z - d.start.z,
    }, { objects, rooms, snap, ground });
  }

  function pointerMove(event) {
    if (!drag) return;
    const current = pointerWorld(event, event.currentTarget);
    setDrag((previous) => (previous ? { ...previous, current, moved: true } : previous));
  }

  function pointerUp() {
    if (!drag) return;

    const to = drag.moved ? dropOf(drag) : null;
    const object = objects.find((o) => o.id === drag.id);
    const same = to && object && to.x === object.x && to.z === object.z && to.y === (object.y ?? 0);
    if (to && !same) onMoveObject(drag.id, to);

    setDrag(null);
  }

  const selectOnKey = (select) => (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      select();
    }
  };

  const { view } = plan;
  return (
    <div className="floor-plan-view" aria-label="Floor plan">
      <div className="floor-plan-toolbar">
        <span>Floor plan</span>
        {selectedObjectId && (
          <button
            type="button"
            onClick={() => onRotateObject(selectedObjectId)}
          >
            Rotate 90°
          </button>
        )}
        <span>Tab to a room or item, Enter selects · drag furniture to move it</span>
      </div>

      <svg
        className="floor-plan-svg"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="group"
        aria-label="Rooms and furniture"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        {plan.rooms.map((room) => {
          const c = at(room);
          const w = Number(room.width);
          const d = Number(room.depth);
          const selected = room.id === selectedRoomId;
          const name = room.name || room.type || 'Room';

          return (
            <g
              key={room.id}
              className="floor-plan-room"
              data-room-id={room.id}
              role="button"
              tabIndex={0}
              aria-label={`Room: ${name}, ${sizeLabel(w, d)}`}
              aria-pressed={selected}
              onClick={() => onSelectRoom(room.id)}
              onKeyDown={selectOnKey(() => onSelectRoom(room.id))}
              style={{ cursor: 'pointer' }}
            >
              <rect
                className="floor-plan-shape"
                x={c.x - w / 2}
                y={c.y - d / 2}
                width={w}
                height={d}
                fill={selected ? '#dbeafe' : room.color || '#e2e8f0'}
                stroke={selected ? '#2563eb' : 'none'}
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={c.x}
                y={c.y - 0.12}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(0.12, Math.min(w, d) * 0.12)}
                fill="#111827"
                pointerEvents="none"
              >
                {name}
              </text>
              <text
                x={c.x}
                y={c.y + 0.22}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(0.09, Math.min(w, d) * 0.08)}
                fill="#475569"
                pointerEvents="none"
              >
                {sizeLabel(w, d)}
              </text>
            </g>
          );
        })}

        {/* Walls from the room data, with gaps where the doors and windows are */}
        <g className="floor-plan-walls" pointerEvents="none" aria-hidden="true">
          {plan.rooms.map((room) => {
            const pieces = roomWallPieces(room);
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => at({
              x: room.x + (sx * room.width) / 2, z: room.z + (sz * room.depth) / 2,
            }));
            const line = (s) => {
              const a = at(s.a);
              const b = at(s.b);
              return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
            };
            return (
              <g key={room.id}>
                {pieces.walls.map((w, i) => (
                  <line key={`w${i}`} {...line(w)} stroke="#1f2937" strokeWidth={WALL_THICKNESS} />
                ))}
                {corners.map((c, i) => (
                  <rect key={`c${i}`} x={c.x - WALL_THICKNESS / 2} y={c.y - WALL_THICKNESS / 2}
                    width={WALL_THICKNESS} height={WALL_THICKNESS} fill="#1f2937" />
                ))}
                {pieces.windows.map((w, i) => (
                  <g key={`n${i}`} data-plan-window="">
                    <line {...line(w)} stroke="#ffffff" strokeWidth={WALL_THICKNESS} />
                    <line {...line(w)} stroke="#0ea5e9" strokeWidth={WALL_THICKNESS / 3} />
                  </g>
                ))}
                {pieces.doors.map((door, i) => {
                  const b = at(door.b);
                  const open = at(door.open);
                  return (
                    <g key={`d${i}`} data-plan-door="">
                      <line {...line({ a: door.hinge, b: door.open })} stroke="#1f2937" strokeWidth={0.04} />
                      <path
                        d={`M ${b.x} ${b.y} A ${door.width} ${door.width} 0 0 ${door.sweep} ${open.x} ${open.y}`}
                        fill="none" stroke="#64748b" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>

        {plan.objects.map((object) => {
          const type = ASSET_TYPES[object.assetType] || {};
          const { width: w, depth: d } = itemSize(object);
          const activeDrag = drag?.id === object.id;
          const dropAt = activeDrag && drag.moved ? dropOf(drag) : null;
          const pos = dropAt ?? { x: Number(object.x) || 0, z: Number(object.z) || 0 };
          const c = at(pos);
          const selected = object.id === selectedObjectId;
          const label = object.label || type.label || object.assetType || 'Item';
          const wall = wallSegmentEnds({ ...object, ...pos });

          return (
            <g
              key={object.id}
              className="floor-plan-item"
              data-object-id={object.id}
              role="button"
              tabIndex={0}
              aria-label={`Item: ${label}${object.isLocked ? ' (locked)' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelectObject(object.id)}
              onPointerDown={(event) => pointerDown(event, object)}
              onKeyDown={selectOnKey(() => onSelectObject(object.id))}
              style={{
                cursor: object.isLocked ? 'not-allowed' : 'move',
                touchAction: 'none',
              }}
            >
              {wall ? (
                <line
                  className="floor-plan-shape"
                  x1={at(wall.a).x} y1={at(wall.a).y} x2={at(wall.b).x} y2={at(wall.b).y}
                  stroke={selected ? '#2563eb' : '#374151'}
                  strokeWidth={Math.max(d, WALL_THICKNESS)}
                />
              ) : (
                <>
                  <rect
                    className="floor-plan-shape"
                    x={c.x - w / 2}
                    y={c.y - d / 2}
                    width={w}
                    height={d}
                    rx={0.04}
                    fill={type.color || '#94a3b8'}
                    fillOpacity={0.9}
                    stroke={selected ? '#2563eb' : '#475569'}
                    strokeWidth={selected ? 2.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    transform={`rotate(${planAngle(object.rotationY)} ${c.x} ${c.y})`}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.max(0.1, Math.min(w, d) * 0.16)}
                    fill="#111827"
                    pointerEvents="none"
                  >
                    {label.slice(0, 16)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
