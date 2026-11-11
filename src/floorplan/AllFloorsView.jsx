/**
 * floorplan/AllFloorsView.jsx (v0.15.5)
 *
 * Plan view's "All floors": every floor's plan side by side, at ONE scale and place (the whole
 * building's bounds), each with its name, to compare them. Only for looking and choosing: a click (or
 * Enter) on a floor opens it for editing. Drawn plainly (rooms, walls with their openings, items as
 * boxes, stairs on BOTH floors they join: up from the floor they start on, a dashed outline + "Down"
 * on the floor they arrive at) and memoised per floor, so a big building (2 floors × 300+ items) stays quick.
 */

import { memo, useMemo } from 'react';
import { roomWallPieces, itemSize, planAngle, toPlan, wallSegmentEnds } from './planMath';
import { wallThicknessOf, WALL_THICKNESS } from '../play/geometry';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { planStairs } from './planFloors';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const FloorTile = memo(function FloorTile({ floor, rooms, objects, stairs = [], viewBox, current, onOpen }) {
  const label = `${floor.name}: ${plural(rooms.length, 'room')}, ${plural(objects.length, 'item')}`;
  const open = () => onOpen(floor.id);
  return (
    <div
      className={`all-floors__tile${current ? ' is-current' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${label}`}
      aria-current={current ? 'true' : undefined}
      data-floor-tile={floor.id}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
    >
      <div className="all-floors__head">
        <span className="all-floors__name">{floor.name}</span>
        <span className="ui-muted">{plural(rooms.length, 'room')} · {plural(objects.length, 'item')}</span>
      </div>
      <svg className="all-floors__svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {rooms.map((room) => {
          const c = toPlan(room);
          return (
            <rect key={room.id} x={c.x - room.width / 2} y={c.y - room.depth / 2} width={room.width} height={room.depth}
              fill={room.color || '#e2e8f0'} fillOpacity={0.55} />
          );
        })}
        {rooms.map((room) => {
          const T = wallThicknessOf(room);
          const { walls } = roomWallPieces(room);
          return walls.map((w, i) => {
            const a = toPlan(w.a);
            const b = toPlan(w.b);
            return <line key={`${room.id}-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1f2937" strokeWidth={T} strokeLinecap="square" />;
          });
        })}
        {objects.map((o) => {
          const wall = wallSegmentEnds(o);
          if (wall) {
            const a = toPlan(wall.a);
            const b = toPlan(wall.b);
            return <line key={o.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#374151" strokeWidth={WALL_THICKNESS} />;
          }
          const { width, depth } = itemSize(o);
          const c = toPlan({ x: Number(o.x) || 0, z: Number(o.z) || 0 });
          return (
            <rect key={o.id} x={c.x - width / 2} y={c.y - depth / 2} width={width} height={depth}
              fill={ASSET_TYPES[o.assetType]?.color || '#94a3b8'} stroke="#475569" strokeWidth={0.03}
              transform={`rotate(${planAngle(o.rotationY)} ${c.x} ${c.y})`} />
          );
        })}
        {stairs.map((st) => {
          const c = toPlan(st);
          const up = st.dir === 'up';
          // the tile is small: the word as big as the flight's width allows (it runs along the flight)
          const font = Math.max(0.3, Math.min(st.width * 0.75, st.length * 0.3));
          return (
            <g key={`stairs-${st.id}`} data-tile-stairs={st.dir} transform={`rotate(${planAngle(st.rotationY)} ${c.x} ${c.y})`}>
              <rect x={c.x - st.width / 2} y={c.y - st.length / 2} width={st.width} height={st.length}
                fill={up ? '#dbeafe' : '#f1f5f9'} fillOpacity={0.9}
                stroke={up ? '#2563eb' : '#64748b'} strokeWidth={0.06} strokeDasharray={up ? undefined : '0.2 0.12'} />
              <line x1={c.x} x2={c.x} y1={c.y + st.length / 2 - 0.25} y2={c.y - st.length / 2 + 0.3}
                stroke={up ? '#2563eb' : '#64748b'} strokeWidth={0.08} />
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight="700"
                fill={up ? '#1e3a8a' : '#334155'} stroke="#ffffff" strokeWidth={font * 0.25} paintOrder="stroke"
                transform={`rotate(-90 ${c.x} ${c.y})`}>
                {up ? 'Up' : st.dir === 'down' ? 'Down' : 'Stairs'}
              </text>
            </g>
          );
        })}
      </svg>
      {rooms.length === 0 && objects.length === 0 && <p className="all-floors__empty">Nothing on this floor yet</p>}
    </div>
  );
});

export default function AllFloorsView({ floors = [], rooms = [], objects = [], currentFloor = 0, baseView, onOpen }) {
  // one pass over the building, grouped by floor (so a floor's tile only redraws when its own things change)
  const byFloor = useMemo(() => {
    const groups = new Map(floors.map((f) => [f.id, { rooms: [], objects: [] }]));
    for (const r of rooms) if (Number(r.width) > 0 && Number(r.depth) > 0) groups.get(r.floor ?? 0)?.rooms.push(r);
    for (const o of objects) if (Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.z))) groups.get(o.floor ?? 0)?.objects.push(o);
    return groups;
  }, [floors, rooms, objects]);

  // the stairs of each floor: its own flights and the ones arriving from the floor below
  const stairsByFloor = useMemo(() => {
    const flights = objects.filter((o) => o.assetType === 'STAIRCASE');
    return new Map(floors.map((f) => [f.id, flights.length ? planStairs(flights, floors, f.id) : []]));
  }, [floors, objects]);

  const viewBox = baseView ? `${baseView.x} ${baseView.y} ${baseView.width} ${baseView.height}` : '0 0 100 100';
  // read like a page: the ground floor first, then up
  const ordered = [...floors].sort((a, b) => a.id - b.id);

  return (
    <div className="all-floors" role="list" aria-label="All floors: click one to open it" data-all-floors={floors.length}>
      {ordered.map((f) => (
        <div role="listitem" key={f.id}>
          <FloorTile
            floor={f}
            rooms={byFloor.get(f.id)?.rooms ?? []}
            objects={byFloor.get(f.id)?.objects ?? []}
            stairs={stairsByFloor.get(f.id)}
            viewBox={viewBox}
            current={f.id === currentFloor}
            onOpen={onOpen}
          />
        </div>
      ))}
    </div>
  );
}
