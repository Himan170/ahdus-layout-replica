/**
 * floorplan/FloorPlanView.jsx (Anshu, Task S1)
 *
 * Interactive 2D SVG Floor Plan view:
 * - Pure SVG plan of the current floor (rooms, cut walls with door arcs & windows, items).
 * - Interactive Pan & Zoom: mouse wheel zoom towards pointer, click & drag to pan,
 *   plus on-screen zoom toolbar (+, -, Reset, Zoom %).
 * - Selection, grid-snapped drag, table-top elevation detection, 90° and 45° rotation.
 * - Module hook points (Anchors: workstations, seats, reception, machines, spawn points).
 * - Architectural wall dimensions and room metrics.
 * - Full accessibility: Tab navigation, Enter/Space selection, high-contrast focus rings.
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCw, Ruler, Anchor,
} from 'lucide-react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { WALL_THICKNESS, wallThicknessOf } from '../play/geometry';
import { sizeLabel } from '../ui/tools';
import { anchorsForObject } from '../integration/anchorsFromStore';
import {
  planDrop, itemSize, roomWallPieces, wallSegmentEnds,
  toPlan, screenToWorld, planAngle, planViewBox,
  clampZoom, zoomViewBox, zoomTowards, roomDimensionLines,
  ANCHOR_COLORS, ANCHOR_BADGE_SYMBOLS,
} from './planMath';

/** World point → SVG plan coordinates { x, y: -z }. */
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
  onRotateByAngle = null,
  snap = null,        // { enabled, step }: Studio's snap setting
  ground = false,     // the ground floor (outside rooms is the ground)
  anchorData = {},    // metadata attached to anchors from store
  routes = [],        // evacuation/accessible routes
}) {
  const svgRef = useRef(null);

  // ── Pan and Zoom State ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState(null); // { startClientX, startClientY, initialPan }

  // ── Toggles ──
  const [showDimensions, setShowDimensions] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);

  // ── Item Drag State ──
  const [drag, setDrag] = useState(null);
  // The same drag, kept at once: on a slow machine pointer moves can arrive before React re-renders
  const dragRef = useRef(null);
  const startDrag = (next) => { dragRef.current = next; setDrag(next); };

  // Base plan bounds from room & furniture geometry
  const plan = useMemo(() => {
    const validRooms = rooms.filter((r) => Number(r.width) > 0 && Number(r.depth) > 0);
    const furniture = objects.filter((o) => Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.z)));
    const baseView = planViewBox(validRooms, furniture, 2.5);
    return baseView && { rooms: validRooms, objects: furniture, baseView };
  }, [rooms, objects]);

  // Dynamic viewBox string computed with current zoom and pan
  const dynamicView = useMemo(() => {
    if (!plan?.baseView) return null;
    return zoomViewBox(plan.baseView, zoom, pan);
  }, [plan?.baseView, zoom, pan]);

  // Derived module anchors
  const allAnchors = useMemo(() => {
    if (!plan?.objects) return [];
    return plan.objects.flatMap((obj) => anchorsForObject(obj, anchorData));
  }, [plan?.objects, anchorData]);

  // ── Helper: Screen → World metres ──
  const pointerWorld = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const inv = svg.getScreenCTM()?.inverse();
    if (!inv) return { x: 0, z: 0 };
    return screenToWorld(clientX, clientY, inv);
  }, []);

  // ── Helper: Where the dragged item lands (snapped, on table or floor) ──
  const dropOf = useCallback((d) => {
    const object = objects.find((o) => o.id === d.id);
    if (!object) return null;
    return planDrop(object, {
      x: d.originalX + d.current.x - d.start.x,
      z: d.originalZ + d.current.z - d.start.z,
    }, { objects, rooms, snap, ground });
  }, [objects, rooms, snap, ground]);

  // ── Wheel Event for Zoom centered at cursor ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!plan?.baseView) return;

      const cursorWorld = pointerWorld(event.clientX, event.clientY);
      const cursorPlan = at(cursorWorld);

      const factor = event.deltaY < 0 ? 1.15 : 0.87;
      setZoom((prevZoom) => {
        const nextZoom = clampZoom(prevZoom * factor);
        setPan((prevPan) => zoomTowards(cursorPlan, plan.baseView, prevZoom, nextZoom, prevPan));
        return nextZoom;
      });
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [plan?.baseView, pointerWorld]);

  if (!plan) {
    return (
      <div className="floor-plan-empty" role="region" aria-label="Empty floor plan">
        Add a room or furniture to see the 2D floor plan.
      </div>
    );
  }

  // ── Pointer Down on Items (Drag item) ──
  function handleItemPointerDown(event, object) {
    if (object.isLocked) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectObject(object.id);

    const start = pointerWorld(event.clientX, event.clientY);
    startDrag({
      id: object.id,
      start,
      current: start,
      originalX: Number(object.x) || 0,
      originalZ: Number(object.z) || 0,
      moved: false,
    });

    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  // ── Pointer Down on Background (Pan plan) ──
  function handleBackgroundPointerDown(event) {
    if (event.button !== 0) return; // Left mouse button only
    if (dragRef.current) return;

    // Deselect if clicking pure background
    if (event.target === svgRef.current || event.target.classList.contains('floor-plan-bg')) {
      onSelectRoom(null);
      onSelectObject(null);
    }

    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      initialPan: { ...pan },
    });

    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  // ── Pointer Move (Pan background or move item) ──
  function handlePointerMove(event) {
    // 1. Moving an item
    if (dragRef.current) {
      const current = pointerWorld(event.clientX, event.clientY);
      startDrag({ ...dragRef.current, current, moved: true });
      return;
    }

    // 2. Panning the plan
    if (panDrag && svgRef.current) {
      const svgRect = svgRef.current.getBoundingClientRect();
      if (!svgRect.width || !svgRect.height || !dynamicView) return;

      const scaleX = dynamicView.width / svgRect.width;
      const scaleY = dynamicView.height / svgRect.height;
      const dx = (event.clientX - panDrag.startX) * scaleX;
      const dy = (event.clientY - panDrag.startY) * scaleY;

      setPan({
        x: panDrag.initialPan.x - dx,
        y: panDrag.initialPan.y - dy,
      });
    }
  }

  // ── Pointer Up (Finish drag or pan) ──
  function handlePointerUp() {
    const d = dragRef.current;
    if (d) {
      const to = d.moved ? dropOf(d) : null;
      const object = objects.find((o) => o.id === d.id);
      const same = to && object && to.x === object.x && to.z === object.z && to.y === (object.y ?? 0);
      if (to && !same) onMoveObject(d.id, to);
      startDrag(null);
    }

    if (panDrag) {
      setPanDrag(null);
    }
  }

  // ── Zoom Toolbar Actions ──
  const handleZoomIn = () => setZoom((z) => clampZoom(z * 1.25));
  const handleZoomOut = () => setZoom((z) => clampZoom(z / 1.25));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const selectedObject = objects.find((o) => o.id === selectedObjectId);

  const selectOnKey = (select) => (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      select();
    }
  };

  const viewBoxAttr = dynamicView?.viewBoxStr || '0 0 100 100';

  return (
    <div className="floor-plan-view" aria-label="2D Floor plan view">
      {/* ── Top-Left: Mini Zoom & View Controls ── */}
      <div className="floor-plan-zoom-bar" role="toolbar" aria-label="Floor plan zoom controls">
        <button
          type="button"
          className="floor-plan-icon-btn"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={handleZoomIn}
        >
          <ZoomIn size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="floor-plan-icon-btn floor-plan-zoom-label"
          aria-label="Reset zoom to 100%"
          title="Click to reset zoom to 100%"
          onClick={handleResetView}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="floor-plan-icon-btn"
          aria-label="Zoom out"
          title="Zoom out (-)"
          onClick={handleZoomOut}
        >
          <ZoomOut size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="floor-plan-icon-btn"
          aria-label="Fit entire floor"
          title="Fit view: show the whole floor"
          onClick={handleResetView}
        >
          <Maximize2 size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {/* ── Bottom Controls Toolbar ── */}
      <div className="floor-plan-toolbar">
        <div className="floor-plan-toolbar__left">
          <span className="floor-plan-toolbar__title">2D Floor Plan</span>
          <button
            type="button"
            className={`floor-plan-toggle-btn ${showDimensions ? 'is-active' : ''}`}
            aria-pressed={showDimensions}
            onClick={() => setShowDimensions((v) => !v)}
            title="Toggle architectural dimension labels"
          >
            <Ruler size={14} strokeWidth={1.75} aria-hidden />
            <span>Dimensions</span>
          </button>
          <button
            type="button"
            className={`floor-plan-toggle-btn ${showAnchors ? 'is-active' : ''}`}
            aria-pressed={showAnchors}
            onClick={() => setShowAnchors((v) => !v)}
            title="Toggle module anchor points (seats, workstations, etc.)"
          >
            <Anchor size={14} strokeWidth={1.75} aria-hidden />
            <span>Anchors ({allAnchors.length})</span>
          </button>
        </div>

        {selectedObject && (
          <div className="floor-plan-toolbar__center">
            <span className="floor-plan-toolbar__item-name">
              {selectedObject.label || selectedObject.name || selectedObject.assetType}
            </span>
            <button
              type="button"
              className="floor-plan-btn"
              onClick={() => onRotateObject(selectedObjectId)}
              title="Rotate selected object 90°"
            >
              <RotateCw size={14} strokeWidth={1.75} aria-hidden />
              <span>Rotate 90°</span>
            </button>
            {onRotateByAngle && (
              <button
                type="button"
                className="floor-plan-btn"
                onClick={() => onRotateByAngle(selectedObjectId, Math.PI / 4)}
                title="Rotate selected object 45°"
              >
                <span>+45°</span>
              </button>
            )}
            <span className="floor-plan-angle-tag">
              {Math.round(((Number(selectedObject.rotationY) || 0) * 180 / Math.PI + 360) % 360)}°
            </span>
          </div>
        )}

        <div className="floor-plan-toolbar__right ui-muted">
          <span>Scroll to zoom · Drag background to pan · Drag items to move</span>
        </div>
      </div>

      {/* ── Main SVG Canvas ── */}
      <svg
        ref={svgRef}
        className="floor-plan-svg"
        viewBox={viewBoxAttr}
        role="group"
        aria-label="Rooms and furniture floor plan"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: panDrag ? 'grabbing' : drag ? 'move' : 'grab',
          touchAction: 'none',
        }}
      >
        <defs>
          {/* Subtle grid pattern in SVG space */}
          <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e2e8f0" strokeWidth="0.04" />
          </pattern>
          {/* Dimension arrow markers */}
          <marker id="fp-arrow-start" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <polyline points="8,2 2,5 8,8" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <marker id="fp-arrow-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <polyline points="2,2 8,5 2,8" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          {/* Route arrow marker */}
          <marker id="fp-route-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#ef4444" />
          </marker>
        </defs>

        {/* Interactive background rect catching clicks and drags */}
        <rect
          className="floor-plan-bg"
          x={dynamicView?.x ?? -100}
          y={dynamicView?.y ?? -100}
          width={dynamicView?.width ?? 200}
          height={dynamicView?.height ?? 200}
          fill="url(#plan-grid)"
        />

        {/* ── Room Footprints ── */}
        {plan.rooms.map((room) => {
          const c = at(room);
          const w = Number(room.width);
          const d = Number(room.depth);
          const selected = room.id === selectedRoomId;
          const name = room.name || room.type || 'Room';

          // name above the size; the gap grows with the text (big halls have big text)
          const nameSize = Math.max(0.12, Math.min(w, d) * 0.12);
          const sizeSize = Math.max(0.09, Math.min(w, d) * 0.08);
          return (
            <g
              key={room.id}
              className="floor-plan-room"
              data-room-id={room.id}
              role="button"
              tabIndex={0}
              aria-label={`Room: ${name}, ${sizeLabel(w, d)}`}
              aria-pressed={selected}
              onClick={(e) => {
                e.stopPropagation();
                onSelectRoom(room.id);
              }}
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
                fillOpacity={0.85}
                stroke={selected ? '#2563eb' : '#cbd5e1'}
                strokeWidth={selected ? 0.12 : 0.04}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={c.x}
                y={c.y - sizeSize * 0.7}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={nameSize}
                fill="#111827"
                fontWeight="600"
                pointerEvents="none"
              >
                {name}
              </text>
              <text
                x={c.x}
                y={c.y + nameSize * 0.7}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={sizeSize}
                fill="#64748b"
                pointerEvents="none"
              >
                {sizeLabel(w, d)}
              </text>
            </g>
          );
        })}

        {/* ── Dimension Annotation Lines (Toggleable) ── */}
        {showDimensions && (
          <g className="floor-plan-dimensions" pointerEvents="none" aria-hidden="true">
            {plan.rooms.map((room) => {
              const { top, right } = roomDimensionLines(room, 0.4);
              return (
                <g key={`dim-${room.id}`}>
                  {/* Width Dimension (Top) */}
                  <line x1={top.x1} y1={top.y1} x2={top.x2} y2={top.y2} stroke="#64748b" strokeWidth={0.03} markerStart="url(#fp-arrow-start)" markerEnd="url(#fp-arrow-end)" />
                  <line x1={top.tick1.x1} y1={top.tick1.y1} x2={top.tick1.x2} y2={top.tick1.y2} stroke="#64748b" strokeWidth={0.03} />
                  <line x1={top.tick2.x1} y1={top.tick2.y1} x2={top.tick2.x2} y2={top.tick2.y2} stroke="#64748b" strokeWidth={0.03} />
                  <text x={top.textX} y={top.textY} textAnchor="middle" dominantBaseline="baseline" fontSize={0.22} fill="#475569" fontWeight="500">
                    {top.label}
                  </text>

                  {/* Depth Dimension (Right) */}
                  <line x1={right.x1} y1={right.y1} x2={right.x2} y2={right.y2} stroke="#64748b" strokeWidth={0.03} markerStart="url(#fp-arrow-start)" markerEnd="url(#fp-arrow-end)" />
                  <line x1={right.tick1.x1} y1={right.tick1.y1} x2={right.tick1.x2} y2={right.tick1.y2} stroke="#64748b" strokeWidth={0.03} />
                  <line x1={right.tick2.x1} y1={right.tick2.y1} x2={right.tick2.x2} y2={right.tick2.y2} stroke="#64748b" strokeWidth={0.03} />
                  <text
                    x={right.textX}
                    y={right.textY}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={0.22}
                    fill="#475569"
                    fontWeight="500"
                    transform={`rotate(90 ${right.textX} ${right.textY})`}
                  >
                    {right.label}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* ── Walls with Door Arcs and Windows ── */}
        <g className="floor-plan-walls" pointerEvents="none" aria-hidden="true">
          {plan.rooms.map((room) => {
            const pieces = roomWallPieces(room);
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => at({
              x: room.x + (sx * room.width) / 2, z: room.z + (sz * room.depth) / 2,
            }));
            const T = wallThicknessOf(room); // this room's walls
            const line = (s) => {
              const a = at(s.a);
              const b = at(s.b);
              return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
            };
            return (
              <g key={room.id}>
                {pieces.walls.map((w, i) => (
                  <line key={`w${i}`} {...line(w)} stroke="#1f2937" strokeWidth={T} strokeLinecap="square" />
                ))}
                {corners.map((c, i) => (
                  <rect
                    key={`c${i}`}
                    x={c.x - T / 2}
                    y={c.y - T / 2}
                    width={T}
                    height={T}
                    fill="#1f2937"
                  />
                ))}
                {pieces.windows.map((w, i) => (
                  <g key={`win${i}`} data-plan-window="">
                    <line {...line(w)} stroke="#ffffff" strokeWidth={T} />
                    <line {...line(w)} stroke="#0ea5e9" strokeWidth={T / 2.5} />
                  </g>
                ))}
                {pieces.doors.map((door, i) => {
                  const b = at(door.b);
                  const open = at(door.open);
                  return (
                    <g key={`door${i}`} data-plan-door="">
                      <line {...line({ a: door.hinge, b: door.open })} stroke="#1f2937" strokeWidth={0.05} />
                      <path
                        d={`M ${b.x} ${b.y} A ${door.width} ${door.width} 0 0 ${door.sweep} ${open.x} ${open.y}`}
                        fill="none"
                        stroke="#64748b"
                        strokeWidth={0.03}
                        strokeDasharray="0.1 0.08"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>

        {/* ── Evacuation & Accessible Routes (if defined) ── */}
        {routes.length > 0 && (
          <g className="floor-plan-routes" pointerEvents="none" aria-label="Routes">
            {routes.map((route) => {
              const pts = (route.waypoints || []).map((wp) => `${at(wp).x},${at(wp).y}`).join(' ');
              if (!pts) return null;
              const isEvac = route.kind === 'evacuation';
              return (
                <polyline
                  key={route.id}
                  points={pts}
                  fill="none"
                  stroke={isEvac ? '#ef4444' : '#10b981'}
                  strokeWidth={0.08}
                  strokeDasharray="0.2 0.15"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        )}

        {/* ── Placed Furniture & Items ── */}
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
              onClick={(e) => {
                e.stopPropagation();
                onSelectObject(object.id);
              }}
              onPointerDown={(event) => handleItemPointerDown(event, object)}
              onKeyDown={selectOnKey(() => onSelectObject(object.id))}
              style={{
                cursor: object.isLocked ? 'not-allowed' : 'move',
                touchAction: 'none',
              }}
            >
              {wall ? (
                <line
                  className="floor-plan-shape"
                  x1={at(wall.a).x}
                  y1={at(wall.a).y}
                  x2={at(wall.b).x}
                  y2={at(wall.b).y}
                  stroke={selected ? '#2563eb' : '#374151'}
                  strokeWidth={Math.max(d, WALL_THICKNESS)}
                  strokeLinecap="round"
                />
              ) : (
                <>
                  <rect
                    className="floor-plan-shape"
                    x={c.x - w / 2}
                    y={c.y - d / 2}
                    width={w}
                    height={d}
                    rx={0.05}
                    fill={type.color || '#94a3b8'}
                    fillOpacity={activeDrag ? 0.95 : 0.9}
                    stroke={selected ? '#2563eb' : '#475569'}
                    strokeWidth={selected ? 0.08 : 0.03}
                    transform={`rotate(${planAngle(object.rotationY)} ${c.x} ${c.y})`}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.max(0.12, Math.min(w, d) * 0.2)}
                    fill="#111827"
                    fontWeight="500"
                    pointerEvents="none"
                  >
                    {label.slice(0, 16)}
                  </text>
                  {activeDrag && (
                    <circle cx={c.x} cy={c.y} r={0.12} fill="#2563eb" fillOpacity={0.8} />
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* ── Module Anchors (Workstations, Seats, Reception, Machines, Spawn) ── */}
        {showAnchors && (
          <g className="floor-plan-anchors" aria-label="Module Anchors">
            {allAnchors.map((anchor) => {
              const pt = at(anchor.position);
              const color = ANCHOR_COLORS[anchor.kind] || '#64748b';
              const symbol = ANCHOR_BADGE_SYMBOLS[anchor.kind] || 'A';
              const isSelectedObj = anchor.objectId === selectedObjectId;
              const owner = plan.objects.find((o) => o.id === anchor.objectId);

              return (
                <g
                  key={anchor.id}
                  className="floor-plan-anchor"
                  transform={`translate(${pt.x}, ${pt.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (anchor.objectId) onSelectObject(anchor.objectId);
                  }}
                  // The badge sits on its item: a press on it grabs the item (else the plan would pan)
                  onPointerDown={(event) => { if (owner) handleItemPointerDown(event, owner); }}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{`Hook point: ${anchor.kind}${anchor.label ? ` (${anchor.label})` : ''}`}</title>
                  <circle
                    r={isSelectedObj ? 0.24 : 0.18}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={0.04}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#ffffff"
                    fontSize={0.2}
                    fontWeight="700"
                    pointerEvents="none"
                  >
                    {symbol}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
