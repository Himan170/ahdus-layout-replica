/**
 * ui/RoomLabels.jsx
 *
 * "Office 1 · 6 × 5 m" on the floor of every room on the floor being edited.
 * HTML labels positioned over the 3D view after every frame (no React
 * re-render per frame).
 */

import { useEffect, useRef } from 'react';
import { projectPoint } from './projection';
import { sizeLabel } from './tools';

export default function RoomLabels({ scene, rooms, elevation, hidden }) {
  const refs = useRef(new Map());

  useEffect(() => {
    if (!scene || hidden) return undefined;
    const place = () => {
      for (const room of rooms) {
        const el = refs.current.get(room.id);
        if (!el) continue;
        const p = projectPoint(scene, room.x, elevation + 0.05, room.z);
        el.style.visibility = p.visible ? 'visible' : 'hidden';
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      }
    };
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, rooms, elevation, hidden]);

  if (hidden) return null;
  return (
    <div className="room-labels" aria-hidden>
      {rooms.map((room) => (
        <span
          key={room.id}
          className="room-label"
          ref={(el) => { if (el) refs.current.set(room.id, el); else refs.current.delete(room.id); }}
        >
          {room.name} · {sizeLabel(room.width, room.depth)}
        </span>
      ))}
    </div>
  );
}
