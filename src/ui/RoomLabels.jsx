/**
 * ui/RoomLabels.jsx
 *
 * The room's name on the floor of every room on the floor being edited
 * ("Show Room Areas" adds its area). A label that would overlap one already
 * drawn is hidden (bigger rooms win), so names never pile up. The selected
 * room's label is its details card (RoomDetails). HTML labels positioned over
 * the 3D view after every frame (no React re-render per frame).
 *
 * Settings → "Room labels: Names / Off" (per browser). Off hides the names;
 * "Show Room Areas" still shows the labels with their areas.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { projectPoint } from './projection';
import { fitLabels } from './labelLayout';
import { sizeLabel } from './tools';
import { roomArea } from '../utils/measurements';
import { ROOM_TYPES } from '../utils/roomStore';
import { DEFAULT_WALL_HEIGHT } from '../play/building';

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
  return (
    <>
      <span className="room-card__name">{room.name}</span>
      <span className="room-card__type">{ROOM_TYPES[room.type]?.label ?? room.type}</span>
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
}) {
  const refs = useRef(new Map());
  const sizes = useRef(new Map()); // roomId → { w, h } of its label (measured after each render, not per frame)

  // Who wins a place: the selected room, then bigger rooms first
  const order = useMemo(() => [...rooms].sort((a, b) => {
    if (a.id === selectedRoomId) return -1;
    if (b.id === selectedRoomId) return 1;
    return (roomArea(b) ?? 0) - (roomArea(a) ?? 0);
  }), [rooms, selectedRoomId]);

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
        const p = projectPoint(scene, room.x, elevation + 0.05, room.z);
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
  }, [scene, order, elevation, hidden]);

  if (hidden) return null;
  return (
    <div className="room-labels" aria-hidden>
      {rooms.map((room) => {
        const detail = room.id === selectedRoomId;
        if (!detail && !showLabels) return null;
        const area = roomArea(room);
        return (
          <span
            key={room.id}
            className={detail ? 'room-label room-card is-selected' : 'room-label'}
            data-room-id={room.id}
            ref={(el) => { if (el) refs.current.set(room.id, el); else refs.current.delete(room.id); }}
          >
            {detail ? <RoomDetails room={room} withArea={!showArea} /> : <span>{room.name}</span>}
            {showArea && area !== null && (
              <span className="room-label__area">{area.toFixed(2)} m²</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
