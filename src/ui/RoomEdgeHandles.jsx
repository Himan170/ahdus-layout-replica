/**
 * ui/RoomEdgeHandles.jsx (v0.18.7, Astra audit 3c)
 *
 * Studio's 2D view: the selected room's edge handles, drawn over the canvas (HTML, placed after every frame like
 * RoomLabels). They are pictures only: plannerTools grabs a wall within HANDLE_GRAB_PX of one (a drag moves that wall,
 * the opposite one stays; a click asks for the length). While a wall is dragged its new length shows at that edge
 * (utils/liveEdge.js). The typed length goes to `onResize(roomId, side, length)` (the same rule as Plan view's).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { projectPoint } from './projection';
import { EDGE_SIDES, edgeMidpoint, edgeLength, lengthText, parseLength } from '../play/roomEdges';
import { liveEdge } from '../utils/liveEdge';
import { isCommitEnter } from '../utils/keys';

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

export default function RoomEdgeHandles({ scene, room, elevation = 0, hidden = false, onResize }) {
  const live = useSyncExternalStore(liveEdge.subscribe, liveEdge.get);
  const handleRefs = useRef(new Map());
  const labelRef = useRef(null);
  const inputBoxRef = useRef(null);
  const drag = live.drag && room && live.drag.roomId === room.id ? live.drag : null;
  const typing = live.typing && room && live.typing.roomId === room.id ? live.typing : null;
  const [text, setText] = useState('');
  const [problem, setProblem] = useState(null);

  // a new typing box starts with the length it has now
  useEffect(() => {
    if (!typing || !room) return;
    setText(edgeLength(room, typing.side).toFixed(2));
    setProblem(null);
  }, [typing?.roomId, typing?.side]); // eslint-disable-line react-hooks/exhaustive-deps

  // another room selected, the view changed: no typing box
  useEffect(() => { if (hidden || !room) liveEdge.closeTyping(); }, [hidden, room?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scene || hidden || !room) return undefined;
    const place = () => {
      const shown = drag ? { ...room, ...drag.rect } : room;
      for (const side of EDGE_SIDES) {
        const el = handleRefs.current.get(side);
        if (!el) continue;
        const m = edgeMidpoint(shown, side);
        const p = projectPoint(scene, m.x, elevation + 0.05, m.z);
        el.style.visibility = p.visible ? 'visible' : 'hidden';
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      }
      const at = (side, el, out) => {
        if (!el) return;
        const m = edgeMidpoint(shown, side);
        const p = projectPoint(scene, m.x, elevation + 0.05, m.z);
        const dx = side === 'east' ? out : side === 'west' ? -out : 0;
        const dy = side === 'north' ? -out : side === 'south' ? out : 0;
        el.style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px) translate(-50%, -50%)`;
      };
      if (drag) at(drag.side, labelRef.current, 34);
      if (typing) at(typing.side, inputBoxRef.current, 44);
    };
    place();
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, hidden, room, drag, typing, elevation]);

  if (hidden || !room) return null;

  const apply = () => {
    const length = parseLength(text);
    if (length === null) { setProblem('Type a length in metres, like 6.4'); return false; }
    if (Math.abs(length - edgeLength(room, typing.side)) < 0.0005) { liveEdge.closeTyping(); return true; }
    if (onResize?.(room.id, typing.side, length) === false) { setProblem('Not changed: see the message below'); return false; }
    liveEdge.closeTyping();
    return true;
  };

  const along = typing && (typing.side === 'north' || typing.side === 'south');
  return (
    <div className="room-edge-handles" data-room-handles={room.id}>
      {EDGE_SIDES.map((side) => (
        <span
          key={side}
          aria-hidden
          data-room-handle={side}
          className={`room-edge-handle is-${side === 'north' || side === 'south' ? 'ns' : 'ew'}${drag?.side === side || typing?.side === side ? ' is-active' : ''}`}
          ref={(el) => { if (el) handleRefs.current.set(side, el); else handleRefs.current.delete(side); }}
        />
      ))}
      {drag && (
        <span ref={labelRef} className={`room-edge-label${drag.problem ? ' is-bad' : ''}`} data-room-edge-label={drag.problem ? 'bad' : 'ok'} role="status">
          {drag.problem ?? lengthText(drag.length)}
        </span>
      )}
      {typing && (
        <div ref={inputBoxRef} className="room-edge-typing" data-room-edge-typing={typing.side}>
          <label>
            <span>{along ? 'Depth' : 'Width'}</span>
            <input
              data-room-edge-input=""
              aria-label={`${along ? 'Depth' : 'Width'} of ${room.name || 'the room'} in metres (the ${OPPOSITE[typing.side]} wall stays)`}
              value={text}
              autoFocus
              inputMode="decimal"
              onFocus={(e) => e.target.select()}
              onChange={(e) => { setText(e.target.value); setProblem(null); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (isCommitEnter(e)) { e.preventDefault(); apply(); }
                else if (e.key === 'Escape') { e.preventDefault(); liveEdge.closeTyping(); }
              }}
              onBlur={() => { if (!apply()) liveEdge.closeTyping(); }}
            />
            <span>m</span>
          </label>
          {problem && <div role="alert" className="room-edge-typing__problem" data-room-edge-problem="">{problem}</div>}
        </div>
      )}
    </div>
  );
}
