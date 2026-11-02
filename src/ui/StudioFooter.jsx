/**
 * ui/StudioFooter.jsx
 *
 * Along the bottom of the canvas: the floor switcher (switch, floor height, add above (empty or
 * with the rooms below), rename, delete) and "Add floor" bottom left, the hint for the active
 * tool bottom centre ("Walk through" is in the top bar).
 */

import { useRef, useState } from 'react';
import { ChevronDown, Layers, Plus, Pencil, Trash2, Check, Copy, Square } from 'lucide-react';
import { MIN_FLOOR_HEIGHT, MAX_FLOOR_HEIGHT, STOREY_HEIGHT, GROUND_FLOOR_STAYS } from '../play/building';
import { usePopover } from './usePopover';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };
const rooms = (n) => `${n} room${n === 1 ? '' : 's'}`;

/**
 * "Floor height 3.5 m" (floor-to-floor) of the floor being edited. A value in
 * range is applied as you type (one undo step); anything else on Enter / leaving
 * the box, with the reason if it can't be done.
 */
function FloorHeightField({ floor, onSetHeight }) {
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const shown = draft ?? (floor?.height ?? STOREY_HEIGHT).toFixed(1);
  const apply = (text, final) => {
    const v = parseFloat(text);
    if (!Number.isFinite(v)) return;
    if (!final && (v < MIN_FLOOR_HEIGHT || v > MAX_FLOOR_HEIGHT)) return;
    setProblem(onSetHeight(floor.id, v));
  };
  return (
    <div className="floor-menu__height">
      <label className="floor-menu__height-row">
        <span>Floor height</span>
        <input
          type="number"
          className="ui-input"
          aria-label="Floor height"
          title={`From this floor up to the next one (${MIN_FLOOR_HEIGHT.toFixed(1)} to ${MAX_FLOOR_HEIGHT.toFixed(1)} m)`}
          value={shown}
          step={0.1}
          min={MIN_FLOOR_HEIGHT}
          max={MAX_FLOOR_HEIGHT}
          onChange={(e) => { setDraft(e.target.value); apply(e.target.value, false); }}
          onBlur={() => { if (draft !== null) apply(draft, true); setDraft(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); }
          }}
        />
        <span className="ui-muted">m</span>
      </label>
      {problem && <p className="floor-menu__problem" role="alert">{problem}</p>}
    </div>
  );
}

function FloorMenu({
  startMode = null, // 'add': open on "New floor above" (the AHDUS look's Add floor button)
  floors, currentFloor, roomCounts, onSelectFloor, onAddFloor, onSetFloorHeight, onRenameFloor, onRemoveFloor, onClose,
}) {
  const [mode, setMode] = useState(startMode);  // null | 'add' | 'rename' | 'delete'
  const current = floors.find((f) => f.id === currentFloor);
  const top = floors[floors.length - 1];         // a new floor goes on top of this one
  const [name, setName] = useState(current?.name ?? '');
  const isGround = floors[0]?.id === currentFloor; // floors come lowest first

  const saveName = () => {
    const next = name.trim();
    if (next && next !== current?.name) onRenameFloor(currentFloor, next);
    onClose();
  };

  return (
    <div className="ui-pop floor-menu" role="menu" aria-label="Floors">
      <ul className="floor-menu__list" role="none">
        {[...floors].reverse().map((f) => (
          <li key={f.id} role="none">
            <button
              role="menuitemradio"
              aria-checked={f.id === currentFloor}
              className="floor-menu__floor"
              onClick={() => { onSelectFloor(f.id); onClose(); }}
            >
              <span className="floor-menu__check">{f.id === currentFloor && <Check {...ICON} />}</span>
              <span className="floor-menu__name">{f.name}</span>
              <span className="ui-muted">{rooms(roomCounts[f.id] ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>

      {current && onSetFloorHeight && <FloorHeightField key={current.id} floor={current} onSetHeight={onSetFloorHeight} />}

      <div className="floor-menu__actions">
        {mode === 'add' && (
          <div className="floor-menu__confirm" role="group" aria-label="New floor above">
            <p>New floor above {top?.name}:</p>
            <div className="floor-menu__form floor-menu__form--stack">
              <button className="ui-btn is-primary" aria-label="Copy rooms from below" autoFocus
                title="Same room shapes, wall heights, doors and windows. No furniture or stairs."
                onClick={() => { onAddFloor(true); onClose(); }}>
                <Copy {...ICON} /> Copy rooms from {top?.name}
              </button>
              <button className="ui-btn" aria-label="Empty floor" onClick={() => { onAddFloor(false); onClose(); }}>
                <Square {...ICON} /> Empty floor
              </button>
            </div>
          </div>
        )}
        {mode === 'rename' && (
          <div className="floor-menu__form">
            <input
              className="ui-input"
              aria-label="Floor name"
              value={name}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') { e.stopPropagation(); setMode(null); }
              }}
            />
            <button className="ui-btn is-primary" onClick={saveName}>Save</button>
          </div>
        )}
        {mode === 'delete' && (
          <div className="floor-menu__confirm" role="alertdialog" aria-label="Delete floor">
            <p>Delete {current?.name}? Its rooms and items go too. You can undo this.</p>
            <div className="floor-menu__form">
              <button className="ui-btn" onClick={() => setMode(null)}>Cancel</button>
              <button
                className="ui-btn is-danger"
                onClick={() => { onRemoveFloor(currentFloor); onClose(); }}
              >
                Delete floor
              </button>
            </div>
          </div>
        )}
        {mode === null && (
          <>
            <button role="menuitem" className="floor-menu__action" aria-label="Add floor above"
              onClick={() => setMode('add')}>
              <Plus {...ICON} /> Add floor above
            </button>
            <button role="menuitem" className="floor-menu__action" aria-label="Rename"
              onClick={() => { setName(current?.name ?? ''); setMode('rename'); }}>
              <Pencil {...ICON} /> Rename
            </button>
            <button
              role="menuitem"
              className="floor-menu__action is-danger"
              aria-label="Delete floor"
              aria-disabled={isGround}
              title={isGround ? GROUND_FLOOR_STAYS : `Delete ${current?.name}`}
              onClick={() => { if (!isGround) setMode('delete'); }}
            >
              <Trash2 {...ICON} /> Delete floor
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StudioFooter({
  floors, currentFloor, roomCounts,
  onSelectFloor,
  onAddFloor,        // (copyRooms: boolean) => void
  onSetFloorHeight,  // (floorId, height) => problem | null
  onRenameFloor, onRemoveFloor,
  hint,          // { text, tone: 'hint' | 'message' | 'bad' } | null
}) {
  const [open, setOpen] = useState(false); // false | 'menu' | 'add'
  const wrapRef = useRef(null);
  const close = () => setOpen(false);
  usePopover(open, close, [wrapRef]);
  const current = floors.find((f) => f.id === currentFloor);

  const hintText = (
    <p className={`studio-footer__hint is-${hint?.tone ?? 'hint'}`} role="status" aria-live="polite" data-studio="hint">
      {hint?.text ?? ''}
    </p>
  );

  const floorsBox = (
    <div className="studio-footer__floors canvas-footer__floors" ref={wrapRef}>
      <button
        className="studio-footer__floor-btn"
        aria-label="Floor switcher"
        title="Switch, add, rename or delete floors"
        aria-haspopup="menu"
        aria-expanded={open === 'menu'}
        onClick={() => setOpen((v) => (v === 'menu' ? false : 'menu'))}
      >
        <Layers {...ICON} />
        <span className="studio-footer__floor-name">{current?.name ?? 'Floor'}</span>
        <span className="ui-muted">· {rooms(roomCounts[currentFloor] ?? 0)}</span>
        <ChevronDown {...ICON} />
      </button>
      {open && (
        <FloorMenu
          key={open}
          startMode={open === 'add' ? 'add' : null}
          floors={floors}
          currentFloor={currentFloor}
          roomCounts={roomCounts}
          onSelectFloor={onSelectFloor}
          onAddFloor={onAddFloor}
          onSetFloorHeight={onSetFloorHeight}
          onRenameFloor={onRenameFloor}
          onRemoveFloor={onRemoveFloor}
          onClose={close}
        />
      )}
      <button className="ui-btn canvas-footer__add" aria-label="Add floor" title="Add a floor above the top one"
        aria-expanded={open === 'add'} onClick={() => setOpen((v) => (v === 'add' ? false : 'add'))}>
        <Plus {...ICON} /> Add floor
      </button>
    </div>
  );

  return (
    <div className="canvas-footer">
      {floorsBox}
      {hintText}
    </div>
  );
}
