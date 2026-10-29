/**
 * ui/Inspector.jsx
 *
 * Right card of Workplace Studio, open only when something is selected (or
 * Layers is on). Same edits as the old PropertiesInspector: every change goes
 * through the callbacks, which use editorHistory with the same merge keys.
 *
 *   item:   name, Position, Rotation, Size, Details (department, hook points,
 *           linked position); Duplicate / Lock / Delete
 *   room:   name, Room (type, width, depth, wall height, doors/windows); Delete
 *   layers: outline of rooms and items on this floor
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  X, Copy, Lock, LockOpen, Trash2, Link2, Unlink2, LayoutGrid, DoorOpen, AppWindow, RotateCcw, Volume2, VolumeX,
} from 'lucide-react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { ROOM_TYPES } from '../utils/roomStore';
import { assetIcon, sizeLabel } from './tools';
import { DOOR_DEFAULTS, MAX_ROOM_SIZE, WINDOW_DEFAULTS } from '../play/geometry';
import { describeRoom, describeObject, describeAccessibilityRoutes } from '../utils/accessibleSummary';

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
function NumberField({ label, value, onCommit, step = 0.1, min, max, digits = 2, suffix }) {
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
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        {suffix && <span className="insp-field__suffix">{suffix}</span>}
      </span>
    </label>
  );
}

/** Name in the header: edits merge into one undo step (the caller's merge key). */
function NameInput({ value, placeholder, onChange, focusToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focusToken) { ref.current?.focus(); ref.current?.select(); }
  }, [focusToken]);
  return (
    <input
      ref={ref}
      className="insp-name"
      aria-label="Name"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
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

function ObjectBody({ object, floorName, onUpdate, hookPoints, positions, onSetPositionRef }) {
  const [keepProportions, setKeepProportions] = useState(true);
  const commit = (patch) => onUpdate(object.id, patch);
  const deg = toDeg(object.rotationY ?? 0);

  const setScale = (axis, v) => {
    const old = object[axis] || 1;
    if (!keepProportions || v <= 0) { commit({ [axis]: v }); return; }
    const f = v / old;
    commit({
      scaleX: +((object.scaleX ?? 1) * f).toFixed(3),
      scaleY: +((object.scaleY ?? 1) * f).toFixed(3),
      scaleZ: +((object.scaleZ ?? 1) * f).toFixed(3),
    });
  };

  const linkable = hookPoints.find((a) => a.kind === 'workstation') ?? hookPoints.find((a) => a.kind === 'reception');
  const kinds = [...new Set(hookPoints.map((a) => HOOK_LABEL[a.kind] ?? a.kind))].join(', ');
  const current = linkable?.positionRef ?? '';
  const known = positions.some((p) => p.id === current);

  return (
    <>
      <Section title="Position">
        <div className="insp-grid">
          <NumberField label="X" value={object.x} suffix="m" onCommit={(v) => commit({ x: v })} />
          <NumberField label="Z" value={object.z} suffix="m" onCommit={(v) => commit({ z: v })} />
          <NumberField label="Height" value={object.y} step={0.05} min={0} max={10} suffix="m" onCommit={(v) => commit({ y: v })} />
          <div className="insp-field">
            <span className="insp-field__label">Floor</span>
            <span className="insp-field__static">{floorName}</span>
          </div>
        </div>
      </Section>

      <Section title="Rotation">
        <div className="insp-rotation">
          <input
            type="range" min={-180} max={180} step={5}
            aria-label="Rotation slider"
            value={deg}
            onChange={(e) => commit({ rotationY: toRad(parseFloat(e.target.value)) })}
          />
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

      <Section title="Size">
        <div className="insp-grid insp-grid--3">
          <NumberField label="Width" value={object.scaleX ?? 1} step={0.05} min={0.1} max={5} suffix="×" onCommit={(v) => setScale('scaleX', v)} />
          <NumberField label="Height" value={object.scaleY ?? 1} step={0.05} min={0.1} max={5} suffix="×" onCommit={(v) => setScale('scaleY', v)} />
          <NumberField label="Depth" value={object.scaleZ ?? 1} step={0.05} min={0.1} max={5} suffix="×" onCommit={(v) => setScale('scaleZ', v)} />
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
      </Section>
    </>
  );
}

// ── Room ────────────────────────────────────────────────────────────────

function RoomBody({ room, floorName, onUpdate }) {
  const doors = room.doors?.length ?? 0;
  const windows = room.windows?.length ?? 0;
  return (
    <Section title="Room">
      <label className="insp-field insp-field--wide">
        <span className="insp-field__label">Type</span>
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
      <div className="insp-grid insp-grid--3">
        <NumberField label="Width" value={room.width} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} suffix="m"
          onCommit={(v) => onUpdate(room.id, { width: v })} />
        <NumberField label="Depth" value={room.depth} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} suffix="m"
          onCommit={(v) => onUpdate(room.id, { depth: v })} />
        <NumberField label="Wall height" value={room.wallHeight ?? 3} step={0.1} min={2} max={6} digits={1} suffix="m"
          onCommit={(v) => onUpdate(room.id, { wallHeight: v })} />
      </div>
      <dl className="insp-facts">
        <div><dt>Floor</dt><dd>{floorName}</dd></div>
        <div><dt>Doors</dt><dd>{doors}</dd></div>
        <div><dt>Windows</dt><dd>{windows}</dd></div>
        <div><dt>Area</dt><dd>{Math.round(room.width * room.depth)} m²</dd></div>
      </dl>
    </Section>
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

function LayersBody({ rooms = [], objects = [], floors = [], routes = [], onPick }) {
  const roomName = (id) => rooms.find((r) => r.id === id)?.name;
  const routeSummary = describeAccessibilityRoutes(floors, rooms, objects, routes);

  return (
    <>
      <Section title="Accessibility & Routes">
        <p className="insp-note" role="status">
          {routeSummary}
        </p>
      </Section>
      <Section title={`Rooms (${rooms.length})`}>
        {rooms.length === 0 && <p className="insp-note">No rooms on this floor yet.</p>}
        <ul className="layers-list" role="list" aria-label="Rooms and spaces">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                className="layers-list__item"
                onClick={() => onPick({ type: 'room', id: r.id })}
                aria-label={`Room: ${r.name}, ${sizeLabel(r.width, r.depth)}`}
              >
                <span className="ui-dot" style={{ background: r.color }} aria-hidden />
                <span className="layers-list__name">{r.name}</span>
                <span className="ui-muted">{sizeLabel(r.width, r.depth)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`Items (${objects.length})`}>
        {objects.length === 0 && <p className="insp-note">No items on this floor yet.</p>}
        <ul className="layers-list" role="list" aria-label="Furniture and equipment items">
          {objects.map((o) => {
            const Icon = assetIcon(o.assetType);
            const label = o.label || ASSET_TYPES[o.assetType]?.label || o.assetType;
            return (
              <li key={o.id}>
                <button
                  className="layers-list__item"
                  onClick={() => onPick({ type: 'object', id: o.id })}
                  aria-label={`Item: ${label}${o.isLocked ? ' (locked)' : ''}`}
                >
                  <Icon {...ICON} />
                  <span className="layers-list__name">{label}</span>
                  <span className="ui-muted">{roomName(o.roomId) ?? ''}</span>
                  {o.isLocked && <Lock {...ICON} />}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

export default function Inspector({
  mode,                 // 'object' | 'room' | 'opening' | 'layers' | null
  object, room, floorName,
  opening,              // { roomId, kind, index, room, data, partnerRoom } (a selected door/window)
  onResizeOpening,      // (change) => problem text or null
  onDeleteOpening,
  rooms, objects,       // layers: this floor
  floors = [],
  routes = [],
  onClose,
  onUpdateObject, onDuplicate, onToggleLock, onDeleteObject,
  onUpdateRoom, onRenameRoom, onDeleteRoom,
  hookPoints = [], positions = [], onSetPositionRef,
  onPickLayer,
  nameFocusToken,
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
    return '';
  }, [mode, object, room, opening, floorName, objects, rooms, floors, routes]);

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
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector__header">
        <span className="inspector__icon" aria-hidden>
          {mode === 'object' && ObjIcon && <ObjIcon size={20} strokeWidth={1.75} />}
          {mode === 'room' && <span className="ui-dot inspector__room-dot" style={{ background: room.color }} />}
          {mode === 'layers' && <LayoutGrid size={20} strokeWidth={1.75} />}
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
                focusToken={nameFocusToken}
              />
              <span className="inspector__type">{def?.label ?? object.assetType}{object.isLocked ? ' · Locked' : ''}</span>
            </>
          )}
          {mode === 'room' && (
            <>
              <NameInput value={room.name} placeholder="Room name" onChange={(v) => onRenameRoom(room.id, v)} focusToken={nameFocusToken} />
              <span className="inspector__type">Room · {ROOM_TYPES[room.type]?.label ?? room.type}</span>
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
        {mode === 'object' && (
          <ObjectBody object={object} floorName={floorName} onUpdate={onUpdateObject}
            hookPoints={hookPoints} positions={positions} onSetPositionRef={onSetPositionRef} />
        )}
        {mode === 'room' && <RoomBody room={room} floorName={floorName} onUpdate={onUpdateRoom} />}
        {mode === 'opening' && <OpeningBody opening={opening} floorName={floorName} onResize={onResizeOpening} />}
        {mode === 'layers' && (
          <LayersBody rooms={rooms} objects={objects} floors={floors} routes={routes} onPick={onPickLayer} />
        )}
      </div>

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
          <button className="ui-btn is-danger" onClick={() => onDeleteRoom(room.id)} title="Delete room (Del)">
            <Trash2 {...ICON} /> Delete room
          </button>
        </footer>
      )}
    </aside>
  );
}
