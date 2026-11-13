/**
 * ui/Inspector.jsx
 *
 * Right card of Workplace Studio, open only when something is selected (or
 * Layers is on). Same edits as the old PropertiesInspector: every change goes
 * through the callbacks, which use editorHistory with the same merge keys.
 *
 *   item:   name, Position, Rotation, Size, Details (department, hook points,
 *           linked position); Duplicate / Lock / Delete
 *   room:   name, room type, department (v0.14.9), Width / Length / Ceiling, floor swatches, wall thickness,
 *           the doors and windows (a click selects one) + "Add a door or window"; Duplicate, Delete room
 *   layers: outline of rooms and items on this floor; each row's eye (hide / show in Studio's view only,
 *           ui/hiddenLayers.js) and lock (v0.15.6)
 */

import { useEffect, useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { livePosition } from '../utils/livePosition';
import {
  X, Copy, Lock, LockOpen, Trash2, Link2, Unlink2, LayoutGrid, DoorOpen, AppWindow, RotateCcw, Volume2, VolumeX, Plus,
  RotateCw, Boxes, ClipboardCopy, Search, Eye, EyeOff,
} from 'lucide-react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { ROOM_TYPES } from '../utils/roomStore';
import { assetIcon, sizeLabel } from './tools';
import {
  DOOR_DEFAULTS, MAX_ROOM_SIZE, WINDOW_DEFAULTS,
  wallThicknessOf, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS, WALL_THICKNESS_STEP, roomOpenings,
} from '../play/geometry';
import { FLOOR_FINISHES, floorKindOf } from '../utils/materialLibrary';
import { MIN_WALL_HEIGHT, MAX_WALL_HEIGHT, STAIRS_KEEP_SIZE } from '../play/building';
import { describeRoom, describeObject, describeAccessibilityRoutes } from '../utils/accessibleSummary';
import SeatSection from './SeatSection';
import { itemSize, scaleForSize, sizeLimits } from './itemSize';
import { departmentOptions, departmentPatch, MAX_DEPARTMENT_NAME } from './roomDepartment';
import { isCommitEnter, isComposing } from '../utils/keys';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

const HOOK_LABEL = {
  machine: 'Machine', workstation: 'Workstation', seat: 'Seat',
  reception: 'Reception', spawn: 'Spawn point', 'info-point': 'Info point',
};

const DEPARTMENTS = [
  'None', 'Engineering', 'Design', 'HR', 'Finance',
  'Marketing', 'Operations', 'Legal', 'Sales', 'IT', 'Management',
];

const toDeg = (rad) => Math.round((((rad * 180) / Math.PI) % 360 + 540) % 360 - 180);
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Number box that keeps what you type while you type it, sends each valid
 * value, and shows the stored value again when you leave it (so undo and
 * gizmo drags always show up).
 */
function NumberField({ label, value, onCommit, step = 0.1, min, max, digits = 2, suffix, disabled = false, title }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? Number(value ?? 0).toFixed(digits);
  return (
    <label className="insp-field">
      <span className="insp-field__label">{label}</span>
      <span className="insp-field__box">
        <input
          type="number"
          className="ui-input insp-field__input"
          aria-label={label}
          disabled={disabled}
          title={title}
          value={shown}
          step={step}
          min={min}
          max={max}
          onFocus={() => setDraft(Number(value ?? 0).toFixed(digits))}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onCommit(min !== undefined || max !== undefined
              ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => { if (isCommitEnter(e)) e.currentTarget.blur(); }}
        />
        {suffix && <span className="insp-field__suffix">{suffix}</span>}
      </span>
    </label>
  );
}

/** Name in the header: edits merge into one undo step (the caller's merge key). */
function NameInput({ value, placeholder, onChange }) {
  return (
    <input
      className="insp-name"
      aria-label="Name"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (isCommitEnter(e) || (e.key === 'Escape' && !isComposing(e))) e.currentTarget.blur(); }}
    />
  );
}

function Section({ title, children }) {
  return (
    <section className="insp-section">
      <h3 className="ui-section-title">{title}</h3>
      {children}
    </section>
  );
}

// ── Item ────────────────────────────────────────────────────────────────

function ObjectBody({ object, floorName, onUpdate, hookPoints, positions, onSetPositionRef, stairWarnings = [], wallMount = null, onMountOnWall }) {
  const [keepProportions, setKeepProportions] = useState(true);
  const commit = (patch) => onUpdate(object.id, patch);
  // while it is dragged (or a move arrow is): where it is now, not where the layout still has it
  const dragged = useSyncExternalStore(livePosition.subscribe, livePosition.get, livePosition.get);
  const live = dragged?.id === object.id ? dragged : null;
  const deg = toDeg(object.rotationY ?? 0);
  const isStairs = object.assetType === 'STAIRCASE'; // on its floor, one size: what you walk on is what you see

  // Sizes are shown and typed in metres (v0.15.1); what is saved is still the scale
  const def = ASSET_TYPES[object.assetType];
  const size = itemSize(object, def);
  const setSize = (axis, metres) => {
    const patch = scaleForSize(object, def, axis, metres, keepProportions);
    if (patch) commit(patch);
  };
  const sizeField = (axis, label) => {
    const { min, max } = sizeLimits(def, axis);
    return <NumberField label={label} value={size[axis]} step={0.05} min={min} max={max} suffix="m" onCommit={(v) => setSize(axis, v)} />;
  };

  const linkable = hookPoints.find((a) => a.kind === 'workstation') ?? hookPoints.find((a) => a.kind === 'reception');
  const kinds = [...new Set(hookPoints.map((a) => HOOK_LABEL[a.kind] ?? a.kind))].join(', ');
  const current = linkable?.positionRef ?? '';
  const known = positions.some((p) => p.id === current);

  return (
    <>
      {isStairs && stairWarnings.length > 0 && (
        <section className="insp-section" data-stairs-problems>
          {stairWarnings.map((text) => <p key={text} className="insp-note is-bad" role="alert">{text}.</p>)}
        </section>
      )}
      {wallMount && !wallMount.onWall && (
        <section className="insp-section" data-wall-mount="off">
          <p className="insp-note">This hangs on a wall, but it isn't on one.</p>
          <div className="insp-row">
            <button className="ui-btn" onClick={() => onMountOnWall?.(object.id)} disabled={!!object.isLocked}
              title={object.isLocked ? 'Unlock it first (L)' : 'Hang it on the nearest wall'}>
              Mount on wall
            </button>
          </div>
        </section>
      )}
      <Section title="Position">
        <div className="insp-grid">
          <NumberField label="X" value={live?.x ?? object.x} suffix="m" onCommit={(v) => commit({ x: v })} />
          <NumberField label="Z" value={live?.z ?? object.z} suffix="m" onCommit={(v) => commit({ z: v })} />
          {!isStairs && (
            <NumberField label="Height" value={object.y} step={0.05} min={0} max={10} suffix="m" onCommit={(v) => commit({ y: v })} />
          )}
          <div className="insp-field">
            <span className="insp-field__label">Floor</span>
            <span className="insp-field__static">{floorName}</span>
          </div>
        </div>
      </Section>

      <Section title="Rotation">
        <div className="insp-rotation">
          <NumberField label="Angle" value={deg} step={5} digits={0} suffix="°"
            onCommit={(v) => commit({ rotationY: toRad(v) })} />
        </div>
        <div className="ui-segmented insp-quick" role="group" aria-label="Quick rotation">
          {[0, 90, 180, -90].map((d) => (
            <button key={d} aria-pressed={deg === d} onClick={() => commit({ rotationY: toRad(d) })}>
              {d < 0 ? d + 360 : d}°
            </button>
          ))}
        </div>
      </Section>

      {isStairs ? (
        <Section title="Size">
          <p className="insp-note" data-stairs-size>{STAIRS_KEEP_SIZE}.</p>
          {/* a save from before v0.14.5 can hold another size: it is drawn and walked so, until this */}
          {((object.scaleX ?? 1) !== 1 || (object.scaleY ?? 1) !== 1 || (object.scaleZ ?? 1) !== 1) && (
            <div className="insp-row">
              <button className="ui-btn is-ghost insp-small" onClick={() => commit({ scaleX: 1, scaleY: 1, scaleZ: 1 })}>
                Normal size
              </button>
            </div>
          )}
        </Section>
      ) : (
        <Section title="Size">
          <div className="insp-grid insp-grid--3">
            {sizeField('width', 'Width')}
            {sizeField('depth', 'Depth')}
            {sizeField('height', 'Height')}
          </div>
          <div className="insp-row">
            <button
              className="ui-btn is-ghost insp-small"
              aria-pressed={keepProportions}
              title={keepProportions ? 'Sizes change together' : 'Each size changes on its own'}
              onClick={() => setKeepProportions((v) => !v)}
            >
              {keepProportions ? <Link2 {...ICON} /> : <Unlink2 {...ICON} />}
              Keep proportions
            </button>
            <button className="ui-btn is-ghost insp-small" onClick={() => commit({ scaleX: 1, scaleY: 1, scaleZ: 1 })}>
              Normal size
            </button>
          </div>
        </Section>
      )}

      <Section title="Details">
        <label className="insp-field insp-field--wide">
          <span className="insp-field__label">Department</span>
          <select
            className="ui-select"
            aria-label="Department"
            value={object.department ?? 'None'}
            onChange={(e) => commit({ department: e.target.value })}
          >
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>

      </Section>

      {(hookPoints.length > 0 || linkable) && (
        <details className="insp-advanced" data-inspector-advanced>
          <summary className="insp-advanced__summary">Advanced</summary>
        {hookPoints.length > 0 && (
          <p className="insp-note">{kinds}: other modules attach here.</p>
        )}
        {linkable && (
          <label className="insp-field insp-field--wide">
            <span className="insp-field__label">Linked position</span>
            {positions.length > 0 ? (
              <select
                className="ui-select"
                aria-label="Linked position"
                value={current}
                onChange={(e) => onSetPositionRef?.(linkable.id, e.target.value || null, false)}
              >
                <option value="">Not linked</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}{p.department ? ` (${p.department})` : ''}</option>
                ))}
                {current && !known && <option value={current}>{current} (not in the org chart)</option>}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  className="ui-input"
                  aria-label="Linked position ID"
                  placeholder="Position ID, e.g. eng-head"
                  value={current}
                  onChange={(e) => onSetPositionRef?.(linkable.id, e.target.value || null, true)}
                />
                <span className="insp-note">The People module will list positions here.</span>
              </>
            )}
          </label>
        )}
        </details>
      )}
    </>
  );
}

// ── Room ────────────────────────────────────────────────────────────────

/** The floor swatches: name and colour of each floor. */
const FLOOR_SWATCH = {
  wood: { label: 'Wood', color: '#d8b98f' },
  carpet: { label: 'Carpet', color: '#c8d4de' },
  tile: { label: 'Tiles', color: '#e7e5df' },
  concrete: { label: 'Concrete', color: '#b8bbb6' },
};
const SIDE = { north: 'North wall', south: 'South wall', east: 'East wall', west: 'West wall' };

/**
 * The room's department (v0.14.9, room.departmentRef: Find and the company tour use it): the page's departments + None,
 * or free text when the page gives none. A pick is one undo step; typing is one step per burst.
 */
function RoomDepartmentField({ room, choices, onUpdate }) {
  const [draft, setDraft] = useState(null);
  const hint = 'Find and the company tour use it. None: the department of most people seated here';
  if (choices) {
    const { value, options } = departmentOptions(choices, room.departmentRef);
    return (
      <label className="insp-field insp-field--wide" title={hint}>
        <span className="insp-field__label">Department</span>
        <select className="ui-select" aria-label="Room department" data-room-department="list" value={value}
          onChange={(e) => onUpdate(room.id, departmentPatch(e.target.value))}>
          {options.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="insp-field insp-field--wide" title={hint}>
      <span className="insp-field__label">Department</span>
      <input type="text" className="ui-input" aria-label="Room department" data-room-department="text" placeholder="None"
        maxLength={MAX_DEPARTMENT_NAME} value={draft ?? room.departmentRef ?? ''}
        onChange={(e) => { setDraft(e.target.value); onUpdate(room.id, departmentPatch(e.target.value), { typing: true }); }}
        onBlur={() => setDraft(null)} />
    </label>
  );
}

function RoomBody({ room, departmentChoices: choices, onUpdate, onSetFloor, onSelectOpening, onAddOpening }) {
  const area = room.width * room.depth;
  const floor = floorKindOf(room);
  const openings = roomOpenings(room);
  // a locked room keeps its size, place and walls (v0.15.6): unlock it first
  const locked = !!room.isLocked;
  const lockTip = locked ? 'Locked: unlock it (L) to change this' : undefined;
  return (
    <div className="insp-room">
      <label className="insp-field insp-field--wide">
        <span className="insp-field__label">Room type</span>
        <select
          className="ui-select"
          aria-label="Room type"
          value={room.type}
          onChange={(e) => {
            const t = e.target.value;
            onUpdate(room.id, { type: t, color: ROOM_TYPES[t]?.color ?? room.color });
          }}
        >
          {Object.entries(ROOM_TYPES).map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
        </select>
      </label>

      <RoomDepartmentField key={room.id} room={room} choices={choices} onUpdate={onUpdate} />

      <div className="insp-room__group">
        <h3 className="insp-room__title">Size</h3>
        <div className="insp-grid insp-grid--3">
          <NumberField label="Width" value={room.width} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { width: v })} />
          <NumberField label="Length" value={room.depth} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { depth: v })} />
          <NumberField label="Ceiling" value={room.wallHeight ?? 3} step={0.1} min={MIN_WALL_HEIGHT} max={MAX_WALL_HEIGHT} digits={1} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { wallHeight: v })} />
        </div>
        <p className="insp-room__note">{Math.round(area * 10) / 10} m² · {locked ? 'locked: unlock it to resize it' : 'or drag its walls in the view'}</p>
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title">Position</h3>
        <div className="insp-grid">
          <NumberField label="Room X" value={room.x} step={0.5} digits={2} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { x: v })} />
          <NumberField label="Room Z" value={room.z} step={0.5} digits={2} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { z: v })} />
        </div>
        <p className="insp-room__note">{locked ? 'Locked: unlock it (L) to move it' : 'Its furniture and the rooms inside it move with it · or drag its floor'}</p>
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title" id="insp-floor">Floor</h3>
        <div className="insp-swatches" role="radiogroup" aria-labelledby="insp-floor">
          {FLOOR_FINISHES.map((kind) => (
            <button key={kind} type="button" role="radio" className="insp-swatch" aria-checked={floor === kind}
              aria-label={FLOOR_SWATCH[kind].label} title={FLOOR_SWATCH[kind].label}
              style={{ '--swatch': FLOOR_SWATCH[kind].color }} onClick={() => onSetFloor(room.id, kind)} />
          ))}
        </div>
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title">Walls</h3>
        <div className="insp-grid">
          <NumberField label="Wall thickness" value={wallThicknessOf(room)} step={WALL_THICKNESS_STEP}
            min={MIN_WALL_THICKNESS} max={MAX_WALL_THICKNESS} digits={2} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { wallThickness: v })} />
        </div>
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title">Doors & windows</h3>
        {openings.length > 0 ? (
          <ul className="insp-openings" role="list">
            {openings.map((o) => (
              <li key={`${o.kind}-${o.index}`}>
                <button type="button" className="insp-opening" title={`Select this ${o.kind}`}
                  onClick={() => onSelectOpening({ roomId: room.id, kind: o.kind, index: o.index })}>
                  <span className="insp-opening__kind">{o.kind === 'door' ? 'Door' : 'Window'}</span>
                  <span className="insp-opening__where">{SIDE[o.wall] ?? o.wall} · {o.width.toFixed(1)} m</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="insp-room__note">None yet.</p>}
        <button type="button" className="ui-btn is-ghost insp-room__add" onClick={onAddOpening}
          title="Pick a door or window, then click a wall of the room">
          <Plus {...ICON} /> Add a door or window
        </button>
      </div>
    </div>
  );
}

// ── Door / window ───────────────────────────────────────────────────────

const WALL_NAME = { north: 'North', south: 'South', east: 'East', west: 'West' };

function OpeningBody({ opening, floorName, onResize }) {
  const { kind, data, room, partnerRoom } = opening;
  const [problem, setProblem] = useState(null);
  const key = `${opening.roomId}:${kind}:${opening.index}`;
  useEffect(() => setProblem(null), [key]);
  const resize = (change) => setProblem(onResize(change));
  const defaults = kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  const isDefault = Math.abs(data.width - defaults.width) < 1e-6 && Math.abs(data.height - defaults.height) < 1e-6;
  return (
    <Section title="Size">
      <div className="insp-grid">
        <NumberField label="Width" value={data.width} step={0.1} digits={2} suffix="m"
          onCommit={(v) => resize({ width: v })} />
        <NumberField label="Height" value={data.height} step={0.1} digits={2} suffix="m"
          onCommit={(v) => resize({ height: v })} />
      </div>
      {problem && <p className="insp-note is-bad" role="alert">{problem}</p>}
      <dl className="insp-facts">
        <div><dt>Room</dt><dd>{room.name}</dd></div>
        <div><dt>Wall</dt><dd>{WALL_NAME[data.wall] ?? data.wall}</dd></div>
        <div><dt>Floor</dt><dd>{floorName}</dd></div>
        {kind === 'window'
          ? <div><dt>Sill</dt><dd>{data.sill.toFixed(2)} m</dd></div>
          : <div><dt>Shared with</dt><dd>{partnerRoom?.name ?? 'No other room'}</dd></div>}
      </dl>
      <button className="ui-btn is-ghost insp-reset" disabled={isDefault} onClick={() => resize({ width: defaults.width, height: defaults.height })}
        title={`Standard size: ${defaults.width.toFixed(1)} × ${defaults.height.toFixed(1)} m`}>
        <RotateCcw {...ICON} /> Standard size
      </button>
    </Section>
  );
}

// ── Layers ──────────────────────────────────────────────────────────────

/**
 * Layers search (v0.15.5): every word of the query starts a word of the text (3+ letters: anywhere
 * in a word), case-insensitive. An empty query matches everything.
 */
export function matchesLayerQuery(text, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const own = String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.every((w) => own.some((o) => o.startsWith(w) || (w.length >= 3 && o.includes(w))));
}

let lastLayersQuery = ''; // kept while the panel closes for a selection and opens again

/** A Layers row's own buttons (v0.15.6): the eye (Studio's view only) and the lock. */
function RowButtons({ name, hidden, locked, onToggleHidden, onToggleLock }) {
  return (
    <>
      {onToggleHidden && (
        <button type="button" className="layers-row__btn" aria-pressed={hidden} data-layer-eye={hidden ? 'hidden' : 'shown'}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${name}`}
          title={hidden ? 'Show it again' : 'Hide it while you work (only here, in Studio)'} onClick={onToggleHidden}>
          {hidden ? <EyeOff {...ICON} /> : <Eye {...ICON} />}
        </button>
      )}
      {onToggleLock && (
        <button type="button" className="layers-row__btn" aria-pressed={locked} data-layer-lock={locked ? 'locked' : 'open'}
          aria-label={`${locked ? 'Unlock' : 'Lock'} ${name}`}
          title={locked ? 'Unlock it' : "Lock it: it can't be moved, resized, turned or deleted"} onClick={onToggleLock}>
          {locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
        </button>
      )}
    </>
  );
}

function LayersBody({
  rooms = [], objects = [], floors = [], routes = [], onPick,
  hidden = null,          // { rooms: Set, objects: Set } hidden in Studio's view (v0.15.6)
  hiddenNote = null,      // '3 hidden' (the whole workplace) or null
  onToggleHidden, onShowAll, onToggleRoomLock, onToggleLock,
}) {
  const [query, setQuery] = useState(lastLayersQuery);
  const roomName = (id) => rooms.find((r) => r.id === id)?.name;
  const routeSummary = describeAccessibilityRoutes(floors, rooms, objects, routes);
  const itemLabel = (o) => o.label || ASSET_TYPES[o.assetType]?.label || o.assetType;
  const shownRooms = rooms.filter((r) => matchesLayerQuery(`${r.name} ${ROOM_TYPES[r.type]?.label ?? ''}`, query));
  const shownObjects = objects.filter((o) => matchesLayerQuery(
    `${itemLabel(o)} ${ASSET_TYPES[o.assetType]?.label ?? ''} ${roomName(o.roomId) ?? ''}`, query));
  const searching = query.trim().length > 0;
  const count = (shown, all) => (searching ? `${shown.length} of ${all.length}` : `${all.length}`);
  const setSearch = (v) => { lastLayersQuery = v; setQuery(v); };

  return (
    <>
      <div className="layers-search">
        <Search {...ICON} aria-hidden />
        <input
          type="search"
          className="ui-input"
          placeholder="Search rooms and items"
          aria-label="Search layers"
          value={query}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query && !isComposing(e)) { e.stopPropagation(); setSearch(''); } }}
        />
      </div>
      {searching && (
        <p className="insp-note" role="status" data-layers-found>
          {shownRooms.length + shownObjects.length === 0
            ? `Nothing on this floor matches "${query.trim()}"`
            : `${shownRooms.length + shownObjects.length} found`}
        </p>
      )}
      {hiddenNote && (
        <p className="layers-hidden-note" role="status" data-layers-hidden={hiddenNote}>
          <EyeOff {...ICON} /> {hiddenNote}
          <button type="button" className="ui-btn is-ghost" onClick={onShowAll}>Show all</button>
        </p>
      )}
      {!searching && (
        <Section title="Accessibility & Routes">
          <p className="insp-note" role="status">
            {routeSummary}
          </p>
        </Section>
      )}
      <Section title={`Rooms (${count(shownRooms, rooms)})`}>
        {rooms.length === 0 && <p className="insp-note">No rooms on this floor yet.</p>}
        <ul className="layers-list" role="list" aria-label="Rooms and spaces">
          {shownRooms.map((r) => {
            const off = !!hidden?.rooms.has(r.id);
            return (
              <li key={r.id} className={`layers-row${off ? ' is-hidden' : ''}`} data-layer-room={r.id}>
                <button
                  className="layers-list__item"
                  onClick={() => onPick({ type: 'room', id: r.id })}
                  aria-label={`Room: ${r.name}, ${sizeLabel(r.width, r.depth)}${r.isLocked ? ' (locked)' : ''}${off ? ' (hidden)' : ''}`}
                >
                  <span className="ui-dot" style={{ background: r.color }} aria-hidden />
                  <span className="layers-list__name">{r.name}</span>
                  <span className="ui-muted">{sizeLabel(r.width, r.depth)}</span>
                </button>
                <RowButtons name={r.name} hidden={off} locked={!!r.isLocked}
                  onToggleHidden={onToggleHidden && (() => onToggleHidden('rooms', r.id))}
                  onToggleLock={onToggleRoomLock && (() => onToggleRoomLock(r.id))} />
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={`Items (${count(shownObjects, objects)})`}>
        {objects.length === 0 && <p className="insp-note">No items on this floor yet.</p>}
        <ul className="layers-list" role="list" aria-label="Furniture and equipment items">
          {shownObjects.map((o) => {
            const Icon = assetIcon(o.assetType);
            const label = itemLabel(o);
            const off = !!hidden?.objects.has(o.id);
            return (
              <li key={o.id} className={`layers-row${off ? ' is-hidden' : ''}`} data-layer-item={o.id}>
                <button
                  className="layers-list__item"
                  onClick={() => onPick({ type: 'object', id: o.id })}
                  aria-label={`Item: ${label}${o.isLocked ? ' (locked)' : ''}${off ? ' (hidden)' : ''}`}
                >
                  <Icon {...ICON} />
                  <span className="layers-list__name">{label}</span>
                  <span className="ui-muted">{roomName(o.roomId) ?? ''}</span>
                </button>
                <RowButtons name={label} hidden={off} locked={!!o.isLocked}
                  onToggleHidden={onToggleHidden && (() => onToggleHidden('objects', o.id))}
                  onToggleLock={onToggleLock && (() => onToggleLock(o.id))} />
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// ── Several items (v0.15.5) ─────────────────────────────────────────────

/** "3 × Standard Desk, 3 × Office Chair": what the group holds, most first. */
export function groupSummary(items = []) {
  const counts = new Map();
  for (const o of items) {
    const name = ASSET_TYPES[o.assetType]?.label ?? o.assetType;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function GroupBody({ items }) {
  const locked = items.filter((o) => o.isLocked).length;
  return (
    <>
      <Section title="In the selection">
        <ul className="layers-list" role="list" aria-label="Selected items">
          {groupSummary(items).map(([name, n]) => (
            <li key={name} className="insp-group-row">
              <span className="layers-list__name">{name}</span>
              <span className="ui-muted">× {n}</span>
            </li>
          ))}
        </ul>
        {locked > 0 && (
          <p className="insp-note" data-group-locked={locked}>
            {locked} locked: {locked === 1 ? 'it stays' : 'they stay'} when the group moves, turns or is deleted.
          </p>
        )}
      </Section>
      <Section title="Tips">
        <p className="insp-note">
          Drag one of them to move them all. Shift+click adds or removes an item; Shift+drag draws a box.
          Arrow keys move, R turns, Ctrl+C / Ctrl+V copy and paste, Esc clears the selection.
        </p>
      </Section>
    </>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

export default function Inspector({
  mode,                 // 'object' | 'room' | 'opening' | 'layers' | null
  object, room, floorName,
  stairWarnings = [],   // a staircase: why it can't be used as it stands (building.stairProblems' texts)
  opening,              // { roomId, kind, index, room, data, partnerRoom } (a selected door/window)
  onResizeOpening,      // (change) => problem text or null
  onDeleteOpening,
  rooms, objects,       // layers: this floor
  floors = [],
  routes = [],
  onClose,
  onUpdateObject, onDuplicate, onToggleLock, onDeleteObject,
  wallMount = null,     // v0.15.6: a selected wall item: { onWall } (off its wall: "Mount on wall")
  onMountOnWall,        // (objectId) => void
  onUpdateRoom, onRenameRoom, onDeleteRoom,
  hookPoints = [], positions = [], onSetPositionRef,
  onPickLayer,
  onSetFloorFinish,     // (roomId, kind) => void
  onSelectOpening,      // ({ roomId, kind, index }) => void
  onAddOpening,         // () => void: the Doors & windows tool
  onDuplicateRoom,      // (roomId) => void
  seatPanel = null,     // a desk inside AHDUS: SeatSection's props ("Who sits here"), else null
  departmentChoices = null, // a room's Department field (v0.14.9): the page's names (roomDepartment.departmentChoices); null: free text
  group = [],           // v0.15.5: the selected items when 2+ are selected (mode 'group')
  groupActions = null,  // planner/groupActions.js: turn, duplicate, copy, lock, delete
  onToggleRoomLock,     // v0.15.6: (roomId) => void
  hiddenLayers = null,  // v0.15.6: { rooms: Set, objects: Set } hidden in Studio's view
  hiddenNote = null,    // v0.15.6: '3 hidden' or null
  onToggleHidden,       // v0.15.6: ('rooms' | 'objects', id) => void
  onShowAllHidden,      // v0.15.6: () => void
}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speechText = useMemo(() => {
    if (!mode) return '';
    if (mode === 'object' && object) {
      const parentRoom = rooms?.find((r) => r.id === object.roomId);
      return describeObject(object, parentRoom?.name, floorName);
    }
    if (mode === 'room' && room) {
      return describeRoom(room, objects, floorName);
    }
    if (mode === 'opening' && opening) {
      const kind = opening.kind === 'door' ? 'Door' : 'Window';
      const w = (Number(opening.data?.width) || 0).toFixed(1);
      return `${kind}, ${w} metres wide on ${opening.room?.name || 'wall'}.`;
    }
    if (mode === 'layers') {
      const summary = describeAccessibilityRoutes(floors, rooms, objects, routes);
      return `${floorName} outline. ${rooms?.length || 0} rooms and ${objects?.length || 0} items on this floor. ${summary}`;
    }
    if (mode === 'group') {
      return `${group.length} items selected: ${groupSummary(group).map(([name, n]) => `${n} ${name}`).join(', ')}.`;
    }
    return '';
  }, [mode, object, room, opening, floorName, objects, rooms, floors, routes, group]);

  const handleToggleSpeech = useCallback(() => {
    if (!canSpeak || !speechText) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [canSpeak, speechText]);

  // Cancel speech if inspector closes or selection changes
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [mode, object?.id, room?.id]);

  if (!mode) return null;
  const def = object ? ASSET_TYPES[object.assetType] : null;
  const ObjIcon = object ? assetIcon(object.assetType) : null;

  return (
    <aside className="inspector is-ahdus" aria-label="Inspector" data-mode={mode}>
      <header className="inspector__header">
        <span className="inspector__icon" aria-hidden>
          {mode === 'object' && ObjIcon && <ObjIcon size={20} strokeWidth={1.75} />}
          {mode === 'room' && <span className="ui-dot inspector__room-dot" style={{ background: room.color }} />}
          {mode === 'layers' && <LayoutGrid size={20} strokeWidth={1.75} />}
          {mode === 'group' && <Boxes size={20} strokeWidth={1.75} />}
          {mode === 'opening' && (opening.kind === 'door'
            ? <DoorOpen size={20} strokeWidth={1.75} /> : <AppWindow size={20} strokeWidth={1.75} />)}
        </span>
        <div className="inspector__titles">
          {mode === 'object' && (
            <>
              <NameInput
                value={object.label ?? ''}
                placeholder={def?.label ?? 'Name this item'}
                onChange={(v) => onUpdateObject(object.id, { label: v })}
               
              />
              <span className="inspector__type">{def?.label ?? object.assetType}{object.isLocked ? ' · Locked' : ''}</span>
            </>
          )}
          {mode === 'room' && (
            <>
              <span className="inspector__eyebrow" data-room-locked={room.isLocked ? 'true' : undefined}>
                Room{room.isLocked ? ' · Locked' : ''}
              </span>
              <NameInput value={room.name} placeholder="Room name" onChange={(v) => onRenameRoom(room.id, v)} />
            </>
          )}
          {mode === 'opening' && (
            <>
              <h2 className="inspector__title">{opening.kind === 'door' ? 'Door' : 'Window'}</h2>
              <span className="inspector__type">
                {opening.data.width.toFixed(1)} × {opening.data.height.toFixed(1)} m · {opening.room.name}
              </span>
            </>
          )}
          {mode === 'group' && (
            <>
              <h2 className="inspector__title" data-group-count={group.length}>{group.length} items selected</h2>
              <span className="inspector__type">On {floorName}</span>
            </>
          )}
          {mode === 'layers' && (
            <>
              <h2 className="inspector__title">Layers</h2>
              <span className="inspector__type">Everything on {floorName}</span>
            </>
          )}
        </div>
        <div className="inspector__actions">
          {canSpeak && (
            <button
              type="button"
              className={`ui-icon-btn ${isSpeaking ? 'is-active' : ''}`}
              aria-pressed={isSpeaking}
              aria-label={isSpeaking ? 'Stop reading description aloud' : 'Read description aloud'}
              title={isSpeaking ? 'Stop speech' : 'Read aloud (Browser Speech)'}
              onClick={handleToggleSpeech}
            >
              {isSpeaking ? <VolumeX size={18} strokeWidth={1.75} /> : <Volume2 size={18} strokeWidth={1.75} />}
            </button>
          )}
          <button className="ui-icon-btn" aria-label="Close inspector" title="Close (Esc)" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="inspector__body">
        {mode === 'object' && seatPanel && <SeatSection key={object.id} {...seatPanel} />}
        {mode === 'object' && (
          <ObjectBody object={object} floorName={floorName} onUpdate={onUpdateObject} stairWarnings={stairWarnings}
            wallMount={wallMount} onMountOnWall={onMountOnWall}
            hookPoints={hookPoints} positions={positions} onSetPositionRef={onSetPositionRef} />
        )}
        {mode === 'room' && (
          <RoomBody room={room} departmentChoices={departmentChoices} onUpdate={onUpdateRoom} onSetFloor={onSetFloorFinish}
            onSelectOpening={onSelectOpening} onAddOpening={onAddOpening} />
        )}
        {mode === 'opening' && <OpeningBody opening={opening} floorName={floorName} onResize={onResizeOpening} />}
        {mode === 'layers' && (
          <LayersBody rooms={rooms} objects={objects} floors={floors} routes={routes} onPick={onPickLayer}
            hidden={hiddenLayers} hiddenNote={hiddenNote} onToggleHidden={onToggleHidden} onShowAll={onShowAllHidden}
            onToggleRoomLock={onToggleRoomLock} onToggleLock={onToggleLock} />
        )}
        {mode === 'group' && <GroupBody items={group} />}
      </div>

      {mode === 'group' && groupActions && (
        <footer className="inspector__footer is-wrap" data-group-actions="">
          <button className="ui-btn" onClick={() => groupActions.turn(false)} title="Turn them all 90° about their middle (R)">
            <RotateCw {...ICON} /> Turn 90°
          </button>
          <button className="ui-btn" onClick={() => groupActions.duplicate()} title="A copy of them beside them (Ctrl+D)">
            <Copy {...ICON} /> Duplicate
          </button>
          <button className="ui-btn" onClick={() => groupActions.copy()} title="Copy, then paste with Ctrl+V (Ctrl+C)">
            <ClipboardCopy {...ICON} /> Copy
          </button>
          <button className="ui-btn" onClick={() => groupActions.toggleLock()}
            title={group.every((o) => o.isLocked) ? 'Unlock them all (L)' : 'Lock them all (L)'}>
            {group.every((o) => o.isLocked) ? <LockOpen {...ICON} /> : <Lock {...ICON} />}
            {group.every((o) => o.isLocked) ? 'Unlock all' : 'Lock all'}
          </button>
          <button className="ui-btn is-danger" onClick={() => groupActions.remove()} title="Delete them (Del); locked items stay">
            <Trash2 {...ICON} /> Delete
          </button>
        </footer>
      )}

      {mode === 'opening' && (
        <footer className="inspector__footer">
          <button className="ui-btn is-danger" onClick={onDeleteOpening} title={`Delete ${opening.kind} (Del)`}>
            <Trash2 {...ICON} /> Delete {opening.kind}
          </button>
        </footer>
      )}

      {mode === 'object' && (
        <footer className="inspector__footer">
          <button className="ui-btn" onClick={() => onDuplicate(object.id)} title="Duplicate (Ctrl+D)">
            <Copy {...ICON} /> Duplicate
          </button>
          <button className="ui-btn" aria-pressed={!!object.isLocked} onClick={() => onToggleLock(object.id)}
            title={object.isLocked ? 'Unlock (L)' : 'Lock so it cannot be moved or deleted (L)'}>
            {object.isLocked ? <LockOpen {...ICON} /> : <Lock {...ICON} />} {object.isLocked ? 'Unlock' : 'Lock'}
          </button>
          <button className="ui-btn is-danger" aria-disabled={!!object.isLocked}
            title={object.isLocked ? 'Unlock it first to delete it' : 'Delete (Del)'}
            onClick={() => { if (!object.isLocked) onDeleteObject(object.id); }}>
            <Trash2 {...ICON} /> Delete
          </button>
        </footer>
      )}
      {mode === 'room' && (
        <footer className="inspector__footer">
          <button className="ui-btn" onClick={() => onDuplicateRoom(room.id)} title="A copy of this room next to it">
            <Copy {...ICON} /> Duplicate
          </button>
          {onToggleRoomLock && (
            <button className="ui-btn" aria-pressed={!!room.isLocked} onClick={() => onToggleRoomLock(room.id)}
              title={room.isLocked ? 'Unlock (L)' : 'Lock so it cannot be moved, resized, turned or deleted (L)'}>
              {room.isLocked ? <LockOpen {...ICON} /> : <Lock {...ICON} />} {room.isLocked ? 'Unlock' : 'Lock'}
            </button>
          )}
          <button className="ui-btn is-danger" aria-disabled={!!room.isLocked}
            onClick={() => { if (!room.isLocked) onDeleteRoom(room.id); }}
            title={room.isLocked ? 'Unlock it first to delete it' : 'Delete room (Del)'}>
            <Trash2 {...ICON} /> Delete room
          </button>
        </footer>
      )}
    </aside>
  );
}
