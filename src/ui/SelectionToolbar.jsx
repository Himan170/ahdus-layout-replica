/**
 * ui/SelectionToolbar.jsx
 *
 * A small pill floating above the selected item or room.
 *   Item: Move, Rotate, Scale, Duplicate, Lock, Delete
 *   Room: Rename, Change type, Delete
 * Follows its target every frame, stays inside the canvas card, and hides
 * while the camera moves fast.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Move, RotateCw, Scale3d, Copy, Lock, LockOpen, Trash2, Pencil, Shapes,
} from 'lucide-react';
import { projectBox } from './projection';
import { ROOM_OPTIONS } from './tools';
import { usePopover } from './usePopover';

const ICON = { size: 18, strokeWidth: 1.75 };
const GAP = 10;          // px between the target and the pill
const FAST = 14;         // px per frame: the view is moving fast → hide
const SETTLE_MS = 160;   // shown again once the view has been still this long

function ToolButton({ label, title, icon: Icon, pressed, disabled, danger, onClick }) {
  return (
    <button
      className={`ui-icon-btn${danger ? ' is-danger' : ''}`}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <Icon {...ICON} />
    </button>
  );
}

function TypeMenu({ current, onPick, onClose, anchorRef }) {
  const menuRef = useRef(null);
  usePopover(true, onClose, [menuRef, anchorRef]);
  return (
    <ul className="ui-pop selection-toolbar__menu" ref={menuRef} role="menu" aria-label="Room type">
      {ROOM_OPTIONS.map((o) => (
        <li key={o.id} role="none">
          <button role="menuitemradio" aria-checked={current === o.id} onClick={() => { onPick(o.id); onClose(); }}>
            <span className="ui-dot" style={{ background: o.color }} aria-hidden />
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SelectionToolbar({
  scene,
  getBounds,         // () => { min, max } world box of the target, or null
  targetKey,         // changes when the selection changes
  kind,              // 'object' | 'room'
  object,            // selected object (kind 'object')
  room,              // selected room (kind 'room')
  gizmoMode,
  onGizmoMode,
  onDuplicate,
  onToggleLock,
  onDelete,
  onRename,
  onChangeType,
}) {
  const ref = useRef(null);
  const typeBtnRef = useRef(null);
  const [typeOpen, setTypeOpen] = useState(false);

  useEffect(() => setTypeOpen(false), [targetKey]);

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
      if (y < 8) y = Math.min(box.bottom + GAP, ch - h - 8);   // no room above: put it below
      x = Math.max(8, Math.min(cw - w - 8, x));
      y = Math.max(8, Math.min(ch - h - 8, y));

      const now = performance.now();
      const moved = last ? Math.hypot(x - last.x, y - last.y) : 0;
      if (moved > FAST) stillSince = now;
      last = { x, y };
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.dataset.hidden = now - stillSince < SETTLE_MS && stillSince > 0 ? 'true' : 'false';
    };
    const obs = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(obs);
  }, [scene, getBounds, targetKey]);

  const locked = !!object?.isLocked;

  return (
    <div className="selection-toolbar" ref={ref} data-hidden="true" role="toolbar"
      aria-label={kind === 'room' ? 'Room actions' : 'Item actions'}>
      {kind === 'object' && (
        <>
          <ToolButton label="Move" title="Move (W)" icon={Move} pressed={gizmoMode === 'position'}
            disabled={locked} onClick={() => onGizmoMode('position')} />
          <ToolButton label="Rotate" title="Rotate (E)" icon={RotateCw} pressed={gizmoMode === 'rotation'}
            disabled={locked} onClick={() => onGizmoMode('rotation')} />
          <ToolButton label="Scale" title="Scale (R)" icon={Scale3d} pressed={gizmoMode === 'scale'}
            disabled={locked} onClick={() => onGizmoMode('scale')} />
          <span className="selection-toolbar__sep" aria-hidden />
          <ToolButton label="Duplicate" title="Duplicate (Ctrl+D)" icon={Copy} onClick={onDuplicate} />
          <ToolButton label={locked ? 'Unlock' : 'Lock'} title={locked ? 'Unlock (L)' : 'Lock (L)'}
            icon={locked ? LockOpen : Lock} pressed={locked} onClick={onToggleLock} />
          <ToolButton label="Delete" title={locked ? 'Unlock it first to delete it' : 'Delete (Del)'}
            icon={Trash2} danger disabled={locked} onClick={onDelete} />
        </>
      )}
      {kind === 'room' && (
        <>
          <ToolButton label="Rename" title="Rename room" icon={Pencil} onClick={onRename} />
          <span ref={typeBtnRef} className="selection-toolbar__menu-wrap">
            <ToolButton label="Change type" title="Change room type" icon={Shapes} pressed={typeOpen}
              onClick={() => setTypeOpen((v) => !v)} />
            {typeOpen && (
              <TypeMenu current={room?.type} anchorRef={typeBtnRef}
                onPick={onChangeType} onClose={() => setTypeOpen(false)} />
            )}
          </span>
          <span className="selection-toolbar__sep" aria-hidden />
          <ToolButton label="Delete" title="Delete room (Del)" icon={Trash2} danger onClick={onDelete} />
        </>
      )}
    </div>
  );
}
