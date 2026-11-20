/**
 * ui/RoomLabels.jsx
 *
 * The room's name on the floor of every room on the floor being edited
 * ("Show Room Areas" adds its area). A label that would overlap one already
 * drawn is hidden (bigger rooms win), so names never pile up. The selected
 * room's label is its details card (RoomDetails); in the AHDUS look (`selectedAsPill`) it stays
 * the name, marked as selected (the properties panel shows the details). HTML labels positioned over
 * the 3D view after every frame (no React re-render per frame).
 *
 * v0.18.3: a lift shaft's label is "Lift" with its icon; a room with rooms inside it puts its label at the free spot
 * nearest its middle (geometry.labelSpot), not on the lift shaft or cabin standing there.
 *
 * Settings → "Room labels: Names / Off" (per browser). Off hides the names;
 * "Show Room Areas" still shows the labels with their areas.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { projectPoint } from './projection';
import { fitLabels } from './labelLayout';
import { sizeLabel, ROOM_ICONS } from './tools';
import { roomArea } from '../utils/measurements';
import { ROOM_TYPES } from '../utils/roomStore';
import { DEFAULT_WALL_HEIGHT } from '../play/building';
import { roomTypeShown } from '../play/roomNames';
import { labelSpot } from '../play/geometry';

/** The floor a room's label needs, in metres (about its pill at the usual zoom). */
const LABEL_SIZE = { w: 3, d: 1 };
export const LIFT_LABEL = 'Lift';
const isLift = (room) => String(room.type ?? '').toUpperCase() === 'LIFT';

const STORAGE_KEY = 'ahdus.roomLabels';

/** 'names' (default) or 'off', as kept in this browser. */
export function storedRoomLabels() {
  try { return localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'names'; } catch { return 'names'; }
}
export function storeRoomLabels(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private window: this session only */ }
}

const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Name, type, W × D, area, wall height, doors / windows: the hover card and the selected room's label.
 * `withArea` false leaves the area out (when the label shows it already).
 */
export function RoomDetails({ room, withArea = true }) {
  const area = roomArea(room);
  const doors = room.doors?.length ?? 0;
  const windows = room.windows?.length ?? 0;
  // v0.17.2: the type only when it says something the name doesn't (play/roomNames.js)
  const type = roomTypeShown(room.name, ROOM_TYPES[room.type]?.label ?? room.type);
  return (
    <>
      <span className="room-card__name">{room.name}</span>
      {type && <span className="room-card__type">{type}</span>}
      <span className="room-card__row">
        {sizeLabel(room.width, room.depth)}{withArea && area !== null && ` · ${area.toFixed(1)} m²`}
      </span>
      <span className="room-card__row">Walls {(room.wallHeight ?? DEFAULT_WALL_HEIGHT).toFixed(1)} m high</span>
      <span className="room-card__row">{count(doors, 'door')} · {count(windows, 'window')}</span>
    </>
  );
}

export default function RoomLabels({
  scene, rooms, elevation, hidden, showArea = false, showNames = true, selectedRoomId = null,
  selectedAsPill = false,
}) {
  const refs = useRef(new Map());
  const sizes = useRef(new Map()); // roomId → { w, h } of its label (measured after each render, not per frame)

  // Who wins a place: the selected room, then lift shafts (small, inside a hall), then bigger rooms first
  const order = useMemo(() => [...rooms].sort((a, b) => {
    if (a.id === selectedRoomId) return -1;
    if (b.id === selectedRoomId) return 1;
    if (isLift(a) !== isLift(b)) return isLift(a) ? -1 : 1;
    return (roomArea(b) ?? 0) - (roomArea(a) ?? 0);
  }), [rooms, selectedRoomId]);
  // Where each label goes: the room's middle, or beside the rooms inside it
  const spots = useMemo(() => new Map(rooms.map((room) => [room.id, labelSpot(room, rooms, LABEL_SIZE)])), [rooms]);

  const showLabels = showNames || showArea;

  useLayoutEffect(() => {
    sizes.current.clear();
    for (const [id, el] of refs.current) sizes.current.set(id, { w: el.offsetWidth, h: el.offsetHeight });
  });

  useEffect(() => {
    if (!scene || hidden) return undefined;
    const placed = []; // reused every frame
    const place = () => {
      const shown = [];
      const labels = [];
      for (const room of order) {
        const el = refs.current.get(room.id);
        if (!el) continue;
        const at = spots.get(room.id) ?? room;
        const p = projectPoint(scene, at.x, elevation + 0.05, at.z);
        const size = sizes.current.get(room.id) ?? { w: 0, h: 0 };
        shown.push({ el, p });
        labels.push({ x: p.x, y: p.y, w: size.w, h: size.h, visible: p.visible });
      }
      const drawn = fitLabels(labels, undefined, placed);
      shown.forEach(({ el, p }, i) => {
        el.style.visibility = drawn[i] ? 'visible' : 'hidden';
        if (drawn[i]) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      });
    };
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, order, spots, elevation, hidden]);

  if (hidden) return null;
  return (
    <div className="room-labels" aria-hidden>
      {rooms.map((room) => {
        const selected = room.id === selectedRoomId;
        const detail = selected && !selectedAsPill;
        if (!selected && !showLabels) return null;
        const area = roomArea(room);
        const lift = isLift(room) && !detail;
        const Icon = lift ? ROOM_ICONS.LIFT : null;
        return (
          <span
            key={room.id}
            className={detail ? 'room-label room-card is-selected' : selected ? 'room-label is-selected' : 'room-label'}
            data-room-id={room.id}
            data-room-label-kind={lift ? 'lift' : undefined}
            title={lift ? room.name : undefined}
            ref={(el) => { if (el) refs.current.set(room.id, el); else refs.current.delete(room.id); }}
          >
            {detail ? <RoomDetails room={room} withArea={!showArea} />
              : lift ? <span className="room-label__lift">{Icon && <Icon size={12} aria-hidden />}{LIFT_LABEL}</span>
                : <span>{room.name}</span>}
            {showArea && area !== null && (
              <span className="room-label__area">{area.toFixed(2)} m²</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
