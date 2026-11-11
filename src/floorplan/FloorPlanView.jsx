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
  ZoomIn, ZoomOut, Maximize2, RotateCw, Ruler, Anchor, Layers2,
} from 'lucide-react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { WALL_THICKNESS, wallThicknessOf } from '../play/geometry';
import { sizeLabel } from '../ui/tools';
import { anchorsForObject } from '../integration/anchorsFromStore';
import { floorBelow, planStairs, loadPlanPrefs, savePlanPrefs } from './planFloors';
import AllFloorsView from './AllFloorsView';
import {
  planDrop, itemSize, roomWallPieces, wallSegmentEnds,
  toPlan, screenToWorld, planAngle, planViewBox,
  clampZoom, zoomViewBox, zoomTowards, roomDimensionLines,
  ANCHOR_COLORS, ANCHOR_BADGE_SYMBOLS,
} from './planMath';

/** World point → SVG plan coordinates { x, y: -z }. */
const at = (p) => toPlan(p);
const validRoom = (r) => Number(r.width) > 0 && Number(r.depth) > 0;
const placed = (o) => Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.z));

export default function FloorPlanView({
  rooms = [],
  objects = [],
  selectedRoomId = null,
  selectedObjectId = null,
  onSelectRoom = () => {},
  onSelectObject = () => {},
  onMoveObject = () => {},
  onProblem = () => {},   // (text) => void   a drop that was refused (a floor-only item over a table top)
  onRotateObject = () => {},
  onRotateByAngle = null,
  snap = null,        // { enabled, step }: Studio's snap setting
  ground = false,     // the ground floor (outside rooms is the ground)
  anchorData = {},    // metadata attached to anchors from store
  routes = [],        // evacuation/accessible routes
  // v0.15.5: every floor (one scale and place for all of them, the floor below, All floors)
  floors = [],        // [{ id, name }]
  currentFloor = 0,
  allRooms = null,    // every floor's rooms (null: just this floor's)
  allObjects = null,  // every floor's items
  onOpenFloor = null, // (floorId) => void   All floors: a click opens that floor
  prefsKey = null,    // the workplace: its Plan settings are remembered in this browser
}) {
  const svgRef = useRef(null);

  // ── Pan and Zoom State (v0.15.5: remembered per workplace, kept when the floor changes) ──
  const [initialPrefs] = useState(() => (prefsKey ? loadPlanPrefs(prefsKey) : null));
  const [zoom, setZoom] = useState(initialPrefs?.zoom ?? 1);
  const [pan, setPan] = useState(initialPrefs?.pan ?? { x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState(null); // { startClientX, startClientY, initialPan }

  // ── Toggles ──
  const [showDimensions, setShowDimensions] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showBelow, setShowBelow] = useState(initialPrefs?.below ?? true);
  const [allFloors, setAllFloors] = useState(false);

  // Remember zoom, place and the floor-below outline (a moment after the last change)
  useEffect(() => {
    if (!prefsKey) return undefined;
    const timer = setTimeout(() => savePlanPrefs(prefsKey, { zoom, pan, below: showBelow }), 300);
    return () => clearTimeout(timer);
  }, [prefsKey, zoom, pan, showBelow]);

  const buildingRooms = allRooms ?? rooms;
  const buildingObjects = allObjects ?? objects;
  const belowId = floorBelow(floors, currentFloor);
  const below = useMemo(() => (belowId == null ? [] : buildingRooms.filter((r) => r.floor === belowId)), [buildingRooms, belowId]);
  const stairs = useMemo(() => planStairs(buildingObjects, floors, currentFloor), [buildingObjects, floors, currentFloor]);
  const floorName = (id) => floors.find((f) => f.id === id)?.name ?? 'another floor';

  // ── Item Drag State ──
  const [drag, setDrag] = useState(null);
  // The same drag, kept at once: on a slow machine pointer moves can arrive before React re-renders
  const dragRef = useRef(null);
  const startDrag = (next) => { dragRef.current = next; setDrag(next); };

  // Base plan bounds: the WHOLE building (v0.15.5), so every floor has the same scale and place and
  // Page Up / Down keep where you were looking
  const baseView = useMemo(
    () => planViewBox(buildingRooms.filter(validRoom), buildingObjects.filter(placed), 2.5),
    [buildingRooms, buildingObjects],
  );
  const plan = useMemo(() => baseView && {
    rooms: rooms.filter(validRoom), objects: objects.filter(placed), baseView,
  }, [rooms, objects, baseView]);

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
      if (to?.problem) onProblem(to.problem);
      else if (to && !same) onMoveObject(d.id, to);
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

  // v0.15.5: this floor (to edit) or all floors side by side (to look and choose)
  const floorScope = floors.length > 1 && onOpenFloor && (
    <div className="ui-segmented floor-plan-scope" role="group" aria-label="Floors shown">
      <button type="button" aria-label="This floor" aria-pressed={!allFloors} onClick={() => setAllFloors(false)}>This floor</button>
      <button type="button" aria-label="All floors" aria-pressed={allFloors} onClick={() => setAllFloors(true)}>All floors</button>
    </div>
  );

  if (allFloors && floorScope) {
    return (
      <div className="floor-plan-view" aria-label="2D Floor plan view" data-plan-all-floors="">
        <div className="floor-plan-chrome">{floorScope}</div>
        <AllFloorsView
          floors={floors}
          rooms={buildingRooms}
          objects={buildingObjects}
          currentFloor={currentFloor}
          baseView={plan.baseView}
          onOpen={(id) => { setAllFloors(false); onOpenFloor(id); }}
        />
      </div>
    );
  }

  return (
    <div className="floor-plan-view" aria-label="2D Floor plan view">
      {/* ── Top left: zoom, then the plan's toggles under it. Nothing on the bottom row: that is
          the floor switcher's (v0.15.5: the old bottom bar covered it) ── */}
      <div className="floor-plan-chrome">
      {floorScope}
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

        <div className="floor-plan-toolbar__left" role="toolbar" aria-label="Floor plan options">
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
          {belowId != null && (
            <button
              type="button"
              className={`floor-plan-toggle-btn ${showBelow ? 'is-active' : ''}`}
              aria-pressed={showBelow}
              aria-label="Floor below"
              onClick={() => setShowBelow((v) => !v)}
              title={`Show ${floorName(belowId)} as a faint outline, to line up walls and stairs`}
            >
              <Layers2 size={14} strokeWidth={1.75} aria-hidden />
              <span>Floor below</span>
            </button>
          )}
        </div>
      </div>

      {/* ── The selected item: bottom right, above the floor switcher's row ── */}
      <div className="floor-plan-toolbar">
        {selectedObject && (
          <div className="floor-plan-toolbar__center" data-plan-selection="">
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

        {/* ── The floor below, a faint grey outline (v0.15.5): to line up walls and stairs ── */}
        {showBelow && below.length > 0 && (
          <g className="floor-plan-below" data-plan-below={belowId} pointerEvents="none" aria-hidden="true">
            {below.filter(validRoom).map((room) => {
              const c = at(room);
              const T = wallThicknessOf(room);
              return (
                <rect
                  key={room.id}
                  x={c.x - room.width / 2}
                  y={c.y - room.depth / 2}
                  width={room.width}
                  height={room.depth}
                  fill="none"
                  stroke="#94a3b8"
                  strokeOpacity={0.75}
                  strokeWidth={T}
                  strokeDasharray={`${T * 2} ${T * 1.4}`}
                />
              );
            })}
          </g>
        )}

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
          // a refused spot (a floor-only item over a table top): it shows where it stands
          const pos = (dropAt?.problem ? null : dropAt) ?? { x: Number(object.x) || 0, z: Number(object.z) || 0 };
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

        {/* ── Stairs on both floors they join (v0.15.5): up from here, down from the floor above's view ── */}
        {stairs.length > 0 && (
          <g className="floor-plan-stairs" pointerEvents="none" aria-label="Stairs">
            {stairs.map((s) => {
              const c = at(s);
              const label = s.dir === 'up' ? `Up to ${floorName(s.other)}`
                : s.dir === 'down' ? `Down to ${floorName(s.other)}` : 'Leads nowhere';
              const font = Math.max(0.16, Math.min(s.width, s.length) * 0.17);
              return (
                <g key={s.id} data-plan-stairs={s.dir} transform={`rotate(${planAngle(s.rotationY)} ${c.x} ${c.y})`}>
                  {s.dir === 'down' && (
                    <rect
                      x={c.x - s.width / 2} y={c.y - s.length / 2} width={s.width} height={s.length}
                      fill="#f1f5f9" fillOpacity={0.85} stroke="#64748b" strokeWidth={0.04} strokeDasharray="0.15 0.1"
                    />
                  )}
                  {/* the treads, every 0.4 m, and the way up as an arrow (+z of the flight = up) */}
                  {Array.from({ length: Math.max(1, Math.floor(s.length / 0.4)) - 1 }, (_, i) => {
                    const y = c.y + s.length / 2 - (i + 1) * 0.4;
                    return <line key={i} x1={c.x - s.width / 2} x2={c.x + s.width / 2} y1={y} y2={y} stroke="#64748b" strokeWidth={0.02} />;
                  })}
                  <line x1={c.x} x2={c.x} y1={c.y + s.length / 2 - 0.2} y2={c.y - s.length / 2 + 0.25}
                    stroke="#2563eb" strokeWidth={0.05} markerEnd="url(#fp-route-arrow)" />
                  <text
                    x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight="600"
                    fill="#1e3a8a" stroke="#ffffff" strokeWidth={font * 0.25} paintOrder="stroke"
                    transform={`rotate(-90 ${c.x} ${c.y})`}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        )}

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
