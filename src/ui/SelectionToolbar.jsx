/**
 * ui/SelectionToolbar.jsx
 *
 * A dark green bar floating above the selected item or room, icon + name: Move, Rotate,
 * Duplicate | Delete, for an item and for a room (a room's Move says how; Rotate turns it a
 * quarter turn). Lock, Scale (R) and the room's name and type are in the Inspector.
 * Follows its target every frame, stays inside the canvas card, and hides
 * while the camera moves fast.
 */

import { useEffect, useRef } from 'react';
import { Move, RotateCw, Copy, Trash2 } from 'lucide-react';
import { projectBox } from './projection';

const ICON = { size: 18, strokeWidth: 1.75 };
const GAP = 10;          // px between the target and the pill
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
  gizmoMode,
  onGizmoMode,
  onDuplicate,
  onDelete,
  onMoveRoom,        // says how to move a room
  onTurnRoom,        // a quarter turn
  onDuplicateRoom,   // a copy next to it
  minTop = 8,        // px from the canvas top it keeps clear (a phone: the floor switcher, Reset / Fit)
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
      if (!box || !box.visible || !card) { el.dataset.hidden = 'true'; return; }

      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const cw = card.clientWidth;
      const ch = card.clientHeight;
      let x = (box.left + box.right) / 2 - w / 2;
      let y = box.top - GAP - h;
      if (y < minTop) y = Math.min(box.bottom + GAP, ch - h - 8); // no room above: put it below
      x = Math.max(8, Math.min(cw - w - 8, x));
      y = Math.max(minTop, Math.min(ch - h - 8, y));

      const now = performance.now();
      const moved = last ? Math.hypot(x - last.x, y - last.y) : 0;
      if (moved > FAST) stillSince = now;
      last = { x, y };
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.dataset.hidden = now - stillSince < SETTLE_MS && stillSince > 0 ? 'true' : 'false';
    };
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, getBounds, targetKey, minTop]);

  const locked = !!object?.isLocked;
  const isRoom = kind === 'room';
  return (
    <div className="selection-toolbar is-labelled" ref={ref} data-hidden="true" role="toolbar"
      aria-label={isRoom ? 'Room actions' : 'Item actions'}>
      <ToolButton label="Move" text="Move" icon={Move}
        title={isRoom ? "Move: drag the room's floor" : (locked ? 'Unlock it first to move it' : 'Move (W)')}
        pressed={!isRoom && gizmoMode === 'position'} disabled={!isRoom && locked}
        onClick={() => (isRoom ? onMoveRoom() : onGizmoMode('position'))} />
      <ToolButton label="Rotate" text="Rotate" icon={RotateCw}
        title={isRoom ? 'Turn the room a quarter turn' : (locked ? 'Unlock it first to turn it' : 'Rotate (E)')}
        pressed={!isRoom && gizmoMode === 'rotation'} disabled={!isRoom && locked}
        onClick={() => (isRoom ? onTurnRoom() : onGizmoMode('rotation'))} />
      <ToolButton label="Duplicate" text="Duplicate" icon={Copy}
        title={isRoom ? 'A copy of this room next to it' : 'Duplicate (Ctrl+D)'}
        onClick={isRoom ? onDuplicateRoom : onDuplicate} />
      <span className="selection-toolbar__sep" aria-hidden />
      <ToolButton label="Delete" text="Delete" icon={Trash2} danger
        title={isRoom ? 'Delete room (Del)' : (locked ? 'Unlock it first to delete it' : 'Delete (Del)')}
        disabled={!isRoom && locked} onClick={onDelete} />
    </div>
  );
}
