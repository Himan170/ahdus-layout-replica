/**
 * ui/RoomHoverCard.jsx
 *
 * Hovering a room (its floor or walls, 3D and 2D) shows its details card next
 * to the cursor. Cheap: the scene is picked at most every 50 ms while the
 * pointer moves; the card follows the cursor by a style write, and React
 * renders only when the hovered room changes. No card while a mouse button is
 * down (a drag of a build tool, the gizmo or the camera) or while `isBusy()`;
 * the selected room shows its details on its own label instead.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { wallTargetOf } from '../utils/pickHelpers';
import { RoomDetails } from './RoomLabels';

const PICK_EVERY_MS = 50;
const OFFSET = 14; // px from the cursor
const PARTS = new Set(['floor', 'wall', 'door', 'window', 'band', 'skirting']);
const WALL_PARTS = new Set(['wall', 'door', 'window', 'band']);

export default function RoomHoverCard({ scene, rooms, floorId, is3D, hidden, selectedRoomId, isBusy }) {
  const [roomId, setRoomId] = useState(null);
  const cardRef = useRef(null);
  const size = useRef({ w: 0, h: 0 });
  const placeRef = useRef(null); // positions the card at the cursor
  const live = useRef({});
  live.current = { floorId, is3D, isBusy };

  const room = rooms.find((r) => r.id === roomId && r.id !== selectedRoomId) ?? null;

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    size.current = { w: cardRef.current.offsetWidth, h: cardRef.current.offsetHeight };
    placeRef.current?.();
  });

  useEffect(() => {
    const canvas = scene?.getEngine().getRenderingCanvas();
    if (!canvas || hidden) { setRoomId(null); return undefined; }
    let last = 0;
    let timer = null;
    let pos = null; // the latest cursor, in CSS px inside the canvas

    const place = () => {
      const el = cardRef.current;
      if (!el || !pos) return;
      const { w, h } = size.current;
      let x = pos.x + OFFSET;
      let y = pos.y + OFFSET;
      if (x + w > canvas.clientWidth - 4) x = pos.x - OFFSET - w;
      if (y + h > canvas.clientHeight - 4) y = pos.y - OFFSET - h;
      el.style.transform = `translate(${Math.round(Math.max(4, x))}px, ${Math.round(Math.max(4, y))}px)`;
    };

    placeRef.current = place;

    const pick = () => {
      timer = null;
      last = performance.now();
      if (!pos) return;
      const { floorId: floor, is3D: threeD, isBusy: busy } = live.current;
      if (busy?.()) { setRoomId(null); return; }
      const hit = scene.pick(pos.x, pos.y, (m) => {
        const meta = m.metadata;
        return !!meta?.roomId && PARTS.has(meta.part) && Number(meta.floorId) === Number(floor) &&
          m.isPickable && m.isEnabled() && m.isVisible;
      });
      if (!hit?.hit || !hit.pickedMesh) { setRoomId(null); return; }
      const meta = hit.pickedMesh.metadata;
      const eye = threeD ? scene.activeCamera?.position ?? null : null;
      setRoomId(WALL_PARTS.has(meta.part) ? wallTargetOf(hit, eye).roomId ?? meta.roomId : meta.roomId);
    };

    const onMove = (e) => {
      if (e.buttons) { pos = null; setRoomId(null); return; }
      const rect = canvas.getBoundingClientRect();
      pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      place();
      if (timer) return;
      const wait = PICK_EVERY_MS - (performance.now() - last);
      if (wait <= 0) pick();
      else timer = setTimeout(pick, wait);
    };
    const onLeave = () => { pos = null; clearTimeout(timer); timer = null; setRoomId(null); };

    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerdown', onLeave, { passive: true });
    canvas.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      clearTimeout(timer);
      placeRef.current = null;
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onLeave);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [scene, hidden]);

  if (hidden || !room) return null;
  return (
    <div className="room-hover" aria-hidden>
      <div className="room-card room-hover__card" ref={cardRef} data-room-id={room.id}>
        <RoomDetails room={room} />
      </div>
    </div>
  );
}
