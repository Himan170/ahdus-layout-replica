/**
 * floorplan/FloorPlanView.jsx (Anshu, S1)
 *
 * The floor plan of the current floor (the canvas card's "Plan" view): rooms and
 * items from the store, drawn in world metres (SVG x = x, SVG y = z). Click or
 * Enter selects; dragging an item moves it by Studio's rules (planMath.planDrop).
 */

import { useMemo, useState } from 'react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { planDrop } from './planMath';

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
    const validRooms = rooms.filter(
      (r) => Number(r.width) > 0 && Number(r.depth) > 0
    );

    const furniture = objects.filter(
      (o) => Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.z))
    );

    const items = [
      ...validRooms.map((r) => ({
        x: Number(r.x) || 0,
        z: Number(r.z) || 0,
        width: Number(r.width),
        depth: Number(r.depth),
      })),
      ...furniture.map((o) => {
        const type = ASSET_TYPES[o.assetType] || {};
        const width =
          (Number(o.width) || Number(type.defaultWidth) || 0.8) *
          (Number(o.scaleX) || 1);
        const depth =
          (Number(o.depth) || Number(type.defaultDepth) || 0.8) *
          (Number(o.scaleZ) || 1);

        return {
          x: Number(o.x) || 0,
          z: Number(o.z) || 0,
          width,
          depth,
        };
      }),
    ];

    if (!items.length) return null;

    const bounds = items.map((item) => ({
      minX: item.x - item.width / 2,
      minZ: item.z - item.depth / 2,
      maxX: item.x + item.width / 2,
      maxZ: item.z + item.depth / 2,
    }));

    return {
      rooms: validRooms,
      objects: furniture,
      minX: Math.min(...bounds.map((b) => b.minX)),
      minZ: Math.min(...bounds.map((b) => b.minZ)),
      maxX: Math.max(...bounds.map((b) => b.maxX)),
      maxZ: Math.max(...bounds.map((b) => b.maxZ)),
    };
  }, [rooms, objects]);

  if (!plan || (!plan.rooms.length && !plan.objects.length)) {
    return (
      <div className="floor-plan-empty">
        Add a room or furniture to see your 2D floor plan.
      </div>
    );
  }

  const padding = 2;
  const width = Math.max(plan.maxX - plan.minX, 1) + padding * 2;
  const height = Math.max(plan.maxZ - plan.minZ, 1) + padding * 2;

  function pointerDown(event, object) {
    if (object.isLocked) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectObject(object.id);

    const svg = event.currentTarget.ownerSVGElement;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const cursor = point.matrixTransform(svg.getScreenCTM().inverse());

    setDrag({
      id: object.id,
      startX: cursor.x,
      startZ: cursor.y,
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
      x: d.originalX + (d.currentX ?? d.startX) - d.startX,
      z: d.originalZ + (d.currentZ ?? d.startZ) - d.startZ,
    }, { objects, rooms, snap, ground });
  }

  function pointerMove(event) {
    if (!drag) return;

    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const cursor = point.matrixTransform(svg.getScreenCTM().inverse());

    setDrag((previous) =>
      previous
        ? {
            ...previous,
            currentX: cursor.x,
            currentZ: cursor.y,
            moved: true,
          }
        : previous
    );
  }

  function pointerUp() {
    if (!drag) return;

    const to = drag.moved ? dropOf(drag) : null;
    if (to) onMoveObject(drag.id, to);

    setDrag(null);
  }

  return (
    <div className="floor-plan-view" aria-label="2D floor plan">
      <div className="floor-plan-toolbar">
        <span>2D Floor Plan</span>
        {selectedObjectId && (
          <button
            type="button"
            onClick={() => onRotateObject(selectedObjectId)}
          >
            Rotate 90°
          </button>
        )}
        <span>Drag furniture to move it</span>
      </div>

      <svg
        className="floor-plan-svg"
        viewBox={`${plan.minX - padding} ${plan.minZ - padding} ${width} ${height}`}
        role="group"
        aria-label="Rooms and furniture"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        {plan.rooms.map((room) => {
          const x = Number(room.x) || 0;
          const z = Number(room.z) || 0;
          const w = Number(room.width);
          const d = Number(room.depth);
          const selected = room.id === selectedRoomId;

          return (
            <g
              key={room.id}
              role="button"
              tabIndex={0}
              aria-label={room.name || room.type || 'Room'}
              onClick={() => onSelectRoom(room.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectRoom(room.id);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x - w / 2}
                y={z - d / 2}
                width={w}
                height={d}
                fill={selected ? '#dbeafe' : room.color || '#e2e8f0'}
                stroke={selected ? '#2563eb' : '#334155'}
                strokeWidth={selected ? 0.12 : 0.07}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x}
                y={z - 0.12}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(0.12, Math.min(w, d) * 0.12)}
                fill="#111827"
                pointerEvents="none"
              >
                {room.name || room.type || 'Room'}
              </text>
              <text
                x={x}
                y={z + 0.22}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(0.09, Math.min(w, d) * 0.08)}
                fill="#475569"
                pointerEvents="none"
              >
                {w} × {d} m
              </text>
            </g>
          );
        })}

        {plan.objects.map((object) => {
          const type = ASSET_TYPES[object.assetType] || {};
          const w =
            (Number(object.width) || Number(type.defaultWidth) || 0.8) *
            (Number(object.scaleX) || 1);
          const d =
            (Number(object.depth) || Number(type.defaultDepth) || 0.8) *
            (Number(object.scaleZ) || 1);
          const activeDrag = drag?.id === object.id;
          const dropAt = activeDrag && drag.moved ? dropOf(drag) : null;
          const x = dropAt ? dropAt.x : Number(object.x) || 0;
          const z = dropAt ? dropAt.z : Number(object.z) || 0;
          const selected = object.id === selectedObjectId;
          const angle = Number(object.rotationY) || 0;
          const boxWidth = Math.abs(Math.cos(angle)) * w +
            Math.abs(Math.sin(angle)) * d;
          const boxDepth = Math.abs(Math.sin(angle)) * w +
            Math.abs(Math.cos(angle)) * d;

          return (
            <g
              key={object.id}
              role="button"
              tabIndex={0}
              aria-label={object.name || object.assetType || 'Furniture'}
              aria-pressed={selected}
              onClick={() => onSelectObject(object.id)}
              onPointerDown={(event) => pointerDown(event, object)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectObject(object.id);
                }
              }}
              style={{
                cursor: object.isLocked ? 'not-allowed' : 'move',
                touchAction: 'none',
              }}
            >
              <rect
                x={x - boxWidth / 2}
                y={z - boxDepth / 2}
                width={boxWidth}
                height={boxDepth}
                rx={0.04}
                fill={type.color || '#94a3b8'}
                fillOpacity={0.9}
                stroke={selected ? '#2563eb' : '#475569'}
                strokeWidth={selected ? 0.12 : 0.06}
                vectorEffect="non-scaling-stroke"
                transform={`rotate(${(-angle * 180) / Math.PI} ${x} ${z})`}
              />
              <text
                x={x}
                y={z}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(0.1, Math.min(boxWidth, boxDepth) * 0.16)}
                fill="#111827"
                pointerEvents="none"
              >
                {(object.name || object.assetType || 'Object').slice(0, 16)}
              </text>
              {activeDrag && (
                <circle cx={x} cy={z} r={0.1} fill="#2563eb" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
