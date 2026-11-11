/**
 * ui/SelectionToolbar.jsx
 *
 * A dark green bar floating above the selected item or room, icon + name: Move, Rotate,
 * Duplicate | Delete, for an item and for a room (a room's Move says how; Rotate turns it a
 * quarter turn). Lock, Scale (R) and the room's name and type are in the Inspector.
 * Follows its target every frame, stays inside the canvas card, and hides
 * while the camera moves fast and while something is dragged. It sits above the
 * item's top edge and clear of the room labels (ui/selectionSpot.js, v0.15.1).
 */

import { useEffect, useRef } from 'react';
import { Move, RotateCw, Copy, Trash2 } from 'lucide-react';
import { projectBox } from './projection';
import { selectionSpot } from './selectionSpot';

const ICON = { size: 18, strokeWidth: 1.75 };
const FAST = 14;         // px per frame: the view is moving fast → hide
const SETTLE_MS = 160;   // shown again once the view has been still this long

function ToolButton({ label, title, icon: Icon, pressed, disabled, danger, onClick, text }) {
  return (
    <button
      className={`ui-icon-btn${danger ? ' is-danger' : ''}${text ? ' has-text' : ''}`}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <Icon {...ICON} />
      {text && <span className="selection-toolbar__text">{text}</span>}
    </button>
  );
}

export default function SelectionToolbar({
  scene,
  getBounds,         // () => { min, max } world box of the target, or null
  targetKey,         // changes when the selection changes
  kind,              // 'object' | 'room'
  object,            // selected object (kind 'object')
  room = null,       // selected room (kind 'room'; v0.15.6: a locked one can't move, turn or be deleted)
  gizmoMode,
  onGizmoMode,
  onTurn,            // an item: R's 90° turn (with its chair)
  onDuplicate,
  onDelete,
  onMoveRoom,        // says how to move a room
  onTurnRoom,        // a quarter turn
  onDuplicateRoom,   // a copy next to it
  minTop = 8,        // px from the canvas top it keeps clear (a phone: the floor switcher, Reset / Fit)
  isBusy = () => false, // () => true while an item, a room, a wall or a gizmo arrow is dragged: hidden
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!scene) return undefined;
    let last = null;
    let stillSince = 0;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const b = getBounds();
      const card = el.parentElement;
      const box = b && projectBox(scene, b.min, b.max);
      if (!box || !box.visible || !card || isBusy()) { el.dataset.hidden = 'true'; return; }

      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const cw = card.clientWidth;
      const ch = card.clientHeight;
      // the room labels on screen: the bar keeps clear of them
      const at = card.getBoundingClientRect();
      const avoid = [...card.querySelectorAll('.room-label')].map((l) => l.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ left: r.left - at.left, top: r.top - at.top, right: r.right - at.left, bottom: r.bottom - at.top }));
      const spot = selectionSpot({ box, w, h, cw, ch, minTop, avoid });
      const x = spot.x;
      const y = Math.max(minTop, Math.min(ch - h - 8, spot.y));

      const now = performance.now();
      const moved = last ? Math.hypot(x - last.x, y - last.y) : 0;
      if (moved > FAST) stillSince = now;
      last = { x, y };
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.dataset.hidden = now - stillSince < SETTLE_MS && stillSince > 0 ? 'true' : 'false';
    };
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, getBounds, targetKey, minTop, isBusy]);

  const isRoom = kind === 'room';
  const locked = isRoom ? !!room?.isLocked : !!object?.isLocked;
  return (
    <div className="selection-toolbar is-labelled" ref={ref} data-hidden="true" role="toolbar"
      aria-label={isRoom ? 'Room actions' : 'Item actions'}>
      <ToolButton label="Move" text="Move" icon={Move}
        title={locked ? 'Unlock it first to move it' : (isRoom ? "Move: drag the room's floor" : 'Move: drag it, or show the arrows (W)')}
        pressed={!isRoom && gizmoMode === 'position'} disabled={locked}
        onClick={() => (isRoom ? onMoveRoom() : onGizmoMode(gizmoMode === 'position' ? null : 'position'))} />
      <ToolButton label="Rotate" text="Rotate" icon={RotateCw}
        title={locked ? 'Unlock it first to turn it' : (isRoom ? 'Turn the room a quarter turn (R)' : 'Turn 90° (R; Shift+R: 15°)')}
        disabled={locked}
        onClick={() => (isRoom ? onTurnRoom() : onTurn())} />
      <ToolButton label="Duplicate" text="Duplicate" icon={Copy}
        title={isRoom ? 'A copy of this room next to it' : 'Duplicate (Ctrl+D)'}
        onClick={isRoom ? onDuplicateRoom : onDuplicate} />
      <span className="selection-toolbar__sep" aria-hidden />
      <ToolButton label="Delete" text="Delete" icon={Trash2} danger
        title={locked ? 'Unlock it first to delete it' : (isRoom ? 'Delete room (Del)' : 'Delete (Del)')}
        disabled={locked} onClick={onDelete} />
    </div>
  );
}
