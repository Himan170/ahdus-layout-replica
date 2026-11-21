/**
 * ui/Inspector.jsx
 *
 * Right card of Workplace Studio, open only when something is selected (or
 * Layers is on). Same edits as the old PropertiesInspector: every change goes
 * through the callbacks, which use editorHistory with the same merge keys.
 *
 *   item:   name, Position, Rotation, Size, Details (department, hook points,
 *           linked position); Duplicate / Lock / Delete
 *   room:   name, room type, department (v0.14.9), Width / Depth / Wall height (drafts until Enter), floor swatches, wall thickness,
 *           the doors and windows (a click selects one) + "Add a door or window"; Duplicate, Delete room
 *   layers: outline of rooms and items on this floor; each row's eye (hide / show in Studio's view only,
 *           ui/hiddenLayers.js) and lock (v0.15.6)
 */

import { styleOf, styleSize, styleOptions, styleName } from '../play/openingStyles';
import { useEffect, useRef, useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { livePosition } from '../utils/livePosition';
import {
  X, Copy, Lock, LockOpen, Trash2, Link2, Unlink2, LayoutGrid, DoorOpen, AppWindow, RotateCcw, Volume2, VolumeX, Plus,
  RotateCw, Boxes, ClipboardCopy, Search, Eye, EyeOff, Ungroup,
} from 'lucide-react';
import { ASSET_TYPES } from '../utils/assetCatalog';
import { ROOM_TYPES } from '../utils/roomStore';
import { assetIcon, sizeLabel } from './tools';
import {
  MAX_ROOM_SIZE,
  wallThicknessOf, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS, WALL_THICKNESS_STEP, roomOpenings,
} from '../play/geometry';
import { FLOOR_FINISHES, FLOOR_NAMES, floorKindOf, floorChoiceOf, floorSwatch } from '../utils/materialLibrary';
import { MIN_WALL_HEIGHT, MAX_WALL_HEIGHT, STAIRS_KEEP_SIZE, STAIR_SHAPES, STAIR_SHAPE_LABELS, stairShape } from '../play/building';
import { describeRoom, describeObject, describeAccessibilityRoutes } from '../utils/accessibleSummary';
import SeatSection from './SeatSection';
import { isWorkstation, wsParams, wsPatch, PARTITION_HEIGHT_MIN, PARTITION_HEIGHT_MAX } from '../play/workstation';
import { groupOf, DESK_WIDTH_MIN, DESK_WIDTH_MAX, DESK_DEPTH_MIN, DESK_DEPTH_MAX } from '../play/prefab';
import { prefabById } from '../catalog/manifest';
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
 * How a number box shows a value: `digits` decimals; `exact` (v0.18.6): up to 3 decimals, at least `digits`,
 * so what is saved is what you read (12.34 m, not 12.3).
 */
export function formatField(value, digits = 2, exact = false) {
  const v = Number(value ?? 0);
  if (!exact) return v.toFixed(digits);
  let text = (Math.round(v * 1000) / 1000).toFixed(3);
  while (text.includes('.') && text.endsWith('0') && text.split('.')[1].length > digits) text = text.slice(0, -1);
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

/**
 * Number box that keeps what you type while you type it, sends each valid
 * value, and shows the stored value again when you leave it (so undo and
 * gizmo drags always show up). Focus selects what is there, so typing replaces it.
 * lazy (v0.18.0; room sizes v0.18.6): a draft, sent once, on Enter or leaving the box; Esc puts the saved value back.
 */
function NumberField({ label, value, onCommit, step = 0.1, min, max, digits = 2, suffix, disabled = false, title, lazy = false, exact = false }) {
  const [draft, setDraft] = useState(null);
  const cancelRef = useRef(false);
  const clampV = (v) => (min !== undefined || max !== undefined ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
  const shown = draft ?? formatField(value, digits, exact);
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
          onFocus={(e) => {
            setDraft(formatField(value, digits, exact));
            const el = e.currentTarget;
            try { el.select(); } catch { /* a browser that can't select a number box */ }
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseFloat(e.target.value);
            if (!lazy && Number.isFinite(v)) onCommit(clampV(v));
          }}
          onBlur={() => {
            const v = parseFloat(draft);
            const cancelled = cancelRef.current;
            cancelRef.current = false;
            if (lazy && !cancelled && draft !== null && Number.isFinite(v) && Math.abs(clampV(v) - Number(value)) > 1e-6) onCommit(clampV(v));
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) e.currentTarget.blur();
            else if (lazy && e.key === 'Escape' && !isComposing(e)) {
              // the draft goes, the saved value stays (and Studio's Esc doesn't also clear the selection)
              e.preventDefault();
              e.stopPropagation();
              cancelRef.current = true;
              e.currentTarget.blur();
            }
          }}
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

/** The stairs shape buttons' words (their full names: STAIR_SHAPE_LABELS). */
const SHAPE_SHORT = { straight: 'Straight', 'L-right': 'L right', 'L-left': 'L left' };

function ObjectBody({ object, floorName, onUpdate, hookPoints, positions, onSetPositionRef, stairWarnings = [], onFixStairs = null, wallMount = null, onMountOnWall }) {
  const [keepProportions, setKeepProportions] = useState(true);
  const commit = (patch) => onUpdate(object.id, patch);
  // while it is dragged (or a move arrow is): where it is now, not where the layout still has it
  const dragged = useSyncExternalStore(livePosition.subscribe, livePosition.get, livePosition.get);
  const live = dragged?.id === object.id ? dragged : null;
  const deg = toDeg(object.rotationY ?? 0);
  const isStairs = object.assetType === 'STAIRCASE'; // on its floor, one size: what you walk on is what you see
  // v0.18.6: a locked item keeps its place, angle and size (the editor refuses them too)
  const locked = !!object.isLocked;
  const lockTip = locked ? 'Locked: unlock it (L) to change this' : undefined;

  // Sizes are shown and typed in metres (v0.15.1); what is saved is still the scale
  const def = ASSET_TYPES[object.assetType];
  const size = itemSize(object, def);
  const setSize = (axis, metres) => {
    const patch = scaleForSize(object, def, axis, metres, keepProportions);
    if (patch) commit(patch);
  };
  const sizeField = (axis, label) => {
    const { min, max } = sizeLimits(def, axis);
    return <NumberField label={label} value={size[axis]} step={0.05} min={min} max={max} suffix="m" disabled={locked} title={lockTip}
      onCommit={(v) => setSize(axis, v)} />;
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
          {onFixStairs && <button className="ui-btn is-primary" data-stairs-fix onClick={onFixStairs}>Fix it</button>}
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
          <NumberField label="X" value={live?.x ?? object.x} suffix="m" disabled={locked} title={lockTip} onCommit={(v) => commit({ x: v })} />
          <NumberField label="Z" value={live?.z ?? object.z} suffix="m" disabled={locked} title={lockTip} onCommit={(v) => commit({ z: v })} />
          {!isStairs && (
            <NumberField label="Height" value={object.y} step={0.05} min={0} max={10} suffix="m" disabled={locked} title={lockTip}
              onCommit={(v) => commit({ y: v })} />
          )}
          <div className="insp-field">
            <span className="insp-field__label">Floor</span>
            <span className="insp-field__static">{floorName}</span>
          </div>
        </div>
      </Section>

      <Section title="Rotation">
        <div className="insp-rotation">
          <NumberField label="Angle" value={deg} step={5} digits={0} suffix="°" disabled={locked} title={lockTip}
            onCommit={(v) => commit({ rotationY: toRad(v) })} />
        </div>
        <div className="ui-segmented insp-quick" role="group" aria-label="Quick rotation">
          {[0, 90, 180, -90].map((d) => (
            <button key={d} aria-pressed={deg === d} disabled={locked} title={lockTip} onClick={() => commit({ rotationY: toRad(d) })}>
              {d < 0 ? d + 360 : d}°
            </button>
          ))}
        </div>
      </Section>

      {isStairs && (
        // v0.18.3: straight or L-shaped (metadata.stairShape; older builds draw every staircase straight)
        <Section title="Shape">
          <div className="ui-segmented insp-quick" role="group" aria-label="Stairs shape" data-stairs-shape={stairShape(object)}>
            {STAIR_SHAPES.map((shape) => (
              <button key={shape} type="button" aria-pressed={stairShape(object) === shape} data-stairs-shape-option={shape} disabled={locked}
                aria-label={STAIR_SHAPE_LABELS[shape]} title={STAIR_SHAPE_LABELS[shape]}
                onClick={() => {
                  if (stairShape(object) === shape) return;
                  const { stairShape: _old, ...rest } = object.metadata ?? {};
                  commit({ metadata: shape === 'straight' ? rest : { ...rest, stairShape: shape } });
                }}>
                {SHAPE_SHORT[shape]}
              </button>
            ))}
          </div>
          <p className="insp-note">{stairShape(object) === 'straight' ? '1.2 × 4 m, one flight' : '3.2 × 3.2 m, a landing halfway up'}</p>
        </Section>
      )}

      {isStairs ? (
        <Section title="Size">
          <p className="insp-note" data-stairs-size>{STAIRS_KEEP_SIZE}.</p>
          {/* a save from before v0.14.5 can hold another size: it is drawn and walked so, until this */}
          {((object.scaleX ?? 1) !== 1 || (object.scaleY ?? 1) !== 1 || (object.scaleZ ?? 1) !== 1) && (
            <div className="insp-row">
              <button className="ui-btn is-ghost insp-small" disabled={locked} title={lockTip} onClick={() => commit({ scaleX: 1, scaleY: 1, scaleZ: 1 })}>
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
              disabled={locked}
              title={lockTip ?? (keepProportions ? 'Sizes change together' : 'Each size changes on its own')}
              onClick={() => setKeepProportions((v) => !v)}
            >
              {keepProportions ? <Link2 {...ICON} /> : <Unlink2 {...ICON} />}
              Keep proportions
            </button>
            <button className="ui-btn is-ghost insp-small" disabled={locked} title={lockTip} onClick={() => commit({ scaleX: 1, scaleY: 1, scaleZ: 1 })}>
              Normal size
            </button>
          </div>
          {locked && <p className="insp-note" data-item-locked>Locked: unlock it (L) to move, turn or resize it.</p>}
        </Section>
      )}

      {isWorkstation(def) && <WorkstationSection object={object} onUpdate={onUpdate} />}

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

/** The floor chips' short names (v0.18.6: Room default first, each chip the floor's own photo and tint). */
const FLOOR_CHOICE_LABEL = { default: 'Room default', wood: 'Wood', carpet: 'Carpet', tile: 'Tiles', concrete: 'Concrete' };
const ASSETS = `${import.meta.env?.BASE_URL ?? '/'}assets/`;

/** A chip's look: the photo the floor is drawn with, multiplied by its tint (as in 3D). */
export function swatchStyle(kind) {
  const sw = floorSwatch(kind);
  return {
    backgroundColor: sw.tint ?? sw.flat,
    ...(sw.texture ? {
      backgroundImage: `url("${ASSETS}${sw.texture}")`, backgroundSize: '220%', backgroundPosition: 'center',
      ...(sw.tint ? { backgroundBlendMode: 'multiply' } : {}),
    } : {}),
  };
}
const SIDE = { north: 'North wall', south: 'South wall', east: 'East wall', west: 'West wall' };

const WALL_ORDER = ['north', 'east', 'south', 'west'];

/**
 * Glass walls (v0.18.1): each wall Solid or Glass (room.glassWalls), and all at once. A choice made here is the
 * editor's own: a new Meeting room's "first door makes its wall glass" (glassOnFirstDoor) no longer applies.
 */
function GlassWalls({ room, onUpdate }) {
  const glass = room.glassWalls ?? [];
  const set = (list) => onUpdate(room.id, { glassWalls: WALL_ORDER.filter((w) => list.includes(w)), glassOnFirstDoor: undefined });
  const all = glass.length === 4;
  return (
    <div className="insp-glass" data-glass-walls={glass.join(' ') || 'none'}>
      <div className="insp-glass__head">
        <span className="insp-field__label" id={`insp-glass-${room.id}`}>Solid or glass</span>
        <button type="button" className="ui-btn is-ghost insp-glass__all" data-glass-all={all ? 'solid' : 'glass'}
          onClick={() => set(all ? [] : WALL_ORDER)}>{all ? 'All solid' : 'All glass'}</button>
      </div>
      <div className="insp-glass__walls" role="group" aria-labelledby={`insp-glass-${room.id}`}>
        {WALL_ORDER.map((w) => {
          const on = glass.includes(w);
          return (
            <button key={w} type="button" className="insp-glass__wall" aria-pressed={on} data-glass-wall={w}
              aria-label={`${SIDE[w]}: ${on ? 'glass' : 'solid'}`} title={on ? 'Glass: click for a solid wall' : 'Solid: click for glass'}
              onClick={() => set(on ? glass.filter((x) => x !== w) : [...glass, w])}>
              <span>{SIDE[w].replace(' wall', '')}</span>
              <span className="insp-glass__state">{on ? 'Glass' : 'Solid'}</span>
            </button>
          );
        })}
      </div>
      {room.glassOnFirstDoor && (
        <p className="insp-room__note" data-glass-first-door>The wall that gets the first door turns glass.</p>
      )}
    </div>
  );
}

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

/**
 * A lift shaft's stops (v0.18.3): the floors its lift serves. Each is a shaft in the same place on that floor
 * (editor.setLiftStops adds or removes them, one undo step); the lift itself is never saved.
 */
function LiftStops({ stops, onChange }) {
  const on = stops.filter((s) => s.on).map((s) => s.id);
  return (
    <div className="insp-room__group" data-lift-stops={on.join(' ')}>
      <h3 className="insp-room__title" id="insp-lift-stops">Lift stops</h3>
      <div className="insp-glass__walls" role="group" aria-labelledby="insp-lift-stops">
        {stops.map((s) => (
          <button key={s.id} type="button" className="insp-glass__wall" aria-pressed={s.on} data-lift-stop={s.id}
            aria-label={`${s.name}: ${s.on ? 'the lift stops here' : 'no stop'}`}
            disabled={s.on && on.length === 1} title={s.on ? 'Click: no stop on this floor' : 'Click: the lift stops here'}
            onClick={() => onChange(s.on ? on.filter((id) => id !== s.id) : [...on, s.id])}>
            <span>{s.name}</span>
            <span className="insp-glass__state">{s.on ? 'Stops' : 'No stop'}</span>
          </button>
        ))}
      </div>
      <p className="insp-room__note">{on.length < 2
        ? 'Choose a second floor: a lift needs two stops.'
        : 'A shaft in the same place on each floor. Find and Take me there use the lift.'}</p>
    </div>
  );
}

function RoomBody({ room, departmentChoices: choices, liftStops, onLiftStops, onUpdate, onSetFloor, onSelectOpening, onAddOpening }) {
  const area = room.width * room.depth;
  const floor = floorChoiceOf(room);
  const defaultKind = floorKindOf({ type: room.type });
  const floorName = floor === 'default' ? `${FLOOR_NAMES[defaultKind] ?? 'Its own floor'} (room default)` : FLOOR_NAMES[floorKindOf(room)];
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

      {liftStops && onLiftStops && <LiftStops stops={liftStops} onChange={onLiftStops} />}

      <div className="insp-room__group">
        <h3 className="insp-room__title">Size</h3>
        <div className="insp-grid insp-grid--3">
          {/* v0.18.6: drafts until Enter / leaving the box (a half-typed 1 never makes a 2 m room), Esc cancels */}
          <NumberField label="Width" value={room.width} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} exact lazy suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { width: v })} />
          <NumberField label="Depth" value={room.depth} step={0.5} min={2} max={MAX_ROOM_SIZE} digits={1} exact lazy suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { depth: v })} />
          <NumberField label="Wall height" value={room.wallHeight ?? 3} step={0.1} min={MIN_WALL_HEIGHT} max={MAX_WALL_HEIGHT} digits={1} exact lazy suffix="m" disabled={locked} title={lockTip}
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
          {['default', ...FLOOR_FINISHES].map((choice) => {
            const kind = choice === 'default' ? defaultKind : floorKindOf({ floorFinish: choice });
            const title = choice === 'default' ? `Room default: ${FLOOR_NAMES[defaultKind] ?? 'its own floor'}` : FLOOR_NAMES[kind];
            return (
              <button key={choice} type="button" role="radio" className="insp-swatch" aria-checked={floor === choice}
                aria-label={FLOOR_CHOICE_LABEL[choice]} title={title} data-floor-choice={choice}
                onClick={() => onSetFloor(room.id, choice)}>
                <span className="insp-swatch__chip" style={swatchStyle(kind)} aria-hidden />
                <span className="insp-swatch__name">{choice === 'default' ? 'Default' : FLOOR_CHOICE_LABEL[choice]}</span>
              </button>
            );
          })}
        </div>
        <p className="insp-room__note" data-floor-name>{floorName}</p>
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title">Walls</h3>
        <div className="insp-grid">
          <NumberField label="Wall thickness" value={wallThicknessOf(room)} step={WALL_THICKNESS_STEP}
            min={MIN_WALL_THICKNESS} max={MAX_WALL_THICKNESS} digits={2} suffix="m" disabled={locked} title={lockTip}
            onCommit={(v) => onUpdate(room.id, { wallThickness: v })} />
        </div>
        <GlassWalls room={room} onUpdate={onUpdate} />
      </div>

      <div className="insp-room__group">
        <h3 className="insp-room__title">Doors & windows</h3>
        {openings.length > 0 ? (
          <ul className="insp-openings" role="list">
            {openings.map((o) => (
              <li key={`${o.kind}-${o.index}`}>
                <button type="button" className="insp-opening" title={`Select this ${o.kind}`}
                  onClick={() => onSelectOpening({ roomId: room.id, kind: o.kind, index: o.index })}>
                  <span className="insp-opening__kind">{openingTitle(o.kind, o)}</span>
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

/** "Door" / "Window" for the plain ones, else the type: "Glass door", "Tall window" (v0.18.1). */
const openingTitle = (kind, data) => (data?.style && styleOf(kind, data) === data.style
  ? styleName(kind, data) : kind === 'door' ? 'Door' : 'Window');

function OpeningBody({ opening, floorName, onResize, onSetStyle }) {
  const { kind, data, room, partnerRoom } = opening;
  const [problem, setProblem] = useState(null);
  const key = `${opening.roomId}:${kind}:${opening.index}`;
  useEffect(() => setProblem(null), [key]);
  const resize = (change) => setProblem(onResize(change));
  const style = styleOf(kind, data);
  const defaults = styleSize(kind, style, room.wallHeight ?? 3);
  const panel = kind === 'window' && style === 'panel';
  const isDefault = Math.abs(data.width - defaults.width) < 1e-6 && Math.abs(data.height - defaults.height) < 1e-6;
  return (
    <>
    {onSetStyle && (
      <Section title="Type">
        <label className="insp-field">
          <span className="insp-field__label">{kind === 'door' ? 'Door type' : 'Window type'}</span>
          <select className="ui-select" aria-label={kind === 'door' ? 'Door type' : 'Window type'} value={style}
            data-opening-style={style} onChange={(e) => setProblem(onSetStyle(e.target.value))}>
            {styleOptions(kind).map((o) => <option key={o.style} value={o.style}>{o.name}</option>)}
          </select>
        </label>
        {kind === 'door' && style === 'exit' && (
          <p className="insp-note" data-opening-swing={data.swing ?? 'in'}>
            Opens out of {data.swing === 'in' && partnerRoom ? partnerRoom.name : room.name}, with an EXIT sign above it.
          </p>
        )}
      </Section>
    )}
    <Section title="Size">
      <div className="insp-grid">
        <NumberField label="Width" value={data.width} step={0.1} digits={2} suffix="m"
          onCommit={(v) => resize({ width: v })} />
        {panel
          ? <NumberField label="Height" value={data.height} step={0.1} digits={2} suffix="m" disabled
              title="A glass panel reaches the top of its wall" onCommit={() => {}} />
          : <NumberField label="Height" value={data.height} step={0.1} digits={2} suffix="m"
              onCommit={(v) => resize({ height: v })} />}
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
    </>
  );
}

// ── Layers ──────────────────────────────────────────────────────────────

/**
 * Layers search (v0.15.5): every word of the query starts a word of the text (3+ letters: anywhere
 * in a word), case-insensitive. An empty query matches everything.
 * v0.18.5: a word with a dot, dash or slash inside ("0.2", "floor-1", "r&d") is matched as typed
 * against the text's own space-separated words (it was split in the text but not in the query, so
 * "Meeting Room 0.2" found nothing); punctuation at a word's ends, or alone ("&"), asks for nothing.
 */
const EDGE_PUNCT = /^[^a-z0-9]+|[^a-z0-9]+$/g;
export function matchesLayerQuery(text, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).map((w) => w.replace(EDGE_PUNCT, '')).filter(Boolean);
  if (!words.length) return true;
  const lower = String(text ?? '').toLowerCase();
  const own = new Set([
    ...lower.split(/[^a-z0-9]+/),
    ...lower.split(/\s+/).map((w) => w.replace(EDGE_PUNCT, '')),
  ].filter(Boolean));
  return words.every((w) => [...own].some((o) => o.startsWith(w) || (w.length >= 3 && o.includes(w))));
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

// ── v0.18.0: workstations ──────────────────────────────────────────────

const PARTITION_LABELS = [['none', 'None'], ['fabric', 'Fabric'], ['glass', 'Glass']];
const SIDE_LABELS = [['none', 'None'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']];

/** A workstation desk's own options (play/workstation.js): partition, side screens, drawers, screen. */
function WorkstationSection({ object, onUpdate }) {
  const def = ASSET_TYPES[object.assetType];
  const p = wsParams(object, def);
  const set = (changes) => onUpdate(object.id, wsPatch(object, changes));
  const group = groupOf(object);
  return (
    <Section title="Workstation">
      {group && (
        <p className="insp-note" data-ws-in-group>
          Part of a {prefabById(group.prefab)?.label ?? 'cluster'}. Click it without Alt to change the whole cluster.
        </p>
      )}
      <div className="ui-segmented insp-quick" role="group" aria-label="Partition" data-ws-partition={p.partition}>
        {PARTITION_LABELS.map(([k, label]) => (
          <button key={k} aria-pressed={p.partition === k} onClick={() => set({ partition: k })}>{label}</button>
        ))}
      </div>
      {p.partition !== 'none' && (
        <div className="insp-grid">
          <NumberField label="Partition height" value={p.partitionHeight} step={0.05} min={PARTITION_HEIGHT_MIN}
            max={PARTITION_HEIGHT_MAX} suffix="m" title="Above the desk top" onCommit={(v) => set({ partitionHeight: v })} />
          <label className="insp-field">
            <span className="insp-field__label">Side screens</span>
            <select className="ui-select" aria-label="Side screens" value={p.sides} onChange={(e) => set({ sides: e.target.value })}>
              {SIDE_LABELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="insp-row">
        <label className="insp-check"><input type="checkbox" checked={p.pedestal} onChange={(e) => set({ pedestal: e.target.checked })} /> Drawers</label>
        <label className="insp-check"><input type="checkbox" checked={p.screen} onChange={(e) => set({ screen: e.target.checked })} /> Monitor and keyboard</label>
      </div>
    </Section>
  );
}

/**
 * A selected cluster (a saved group, play/prefab.js): its options for every desk at once, its seats
 * (Seat 1…N, each with "Who sits here" inside AHDUS; hovering a row outlines that desk) and Ungroup.
 */
function PrefabBody({ cluster, onChange, onUngroup, seatPanelFor, onHoverSeat, onPickSeat }) {
  const { prefab, params, seats } = cluster;
  const roomy = prefab.layout === 'manager' || prefab.layout === 'cabin';
  return (
    <>
      <Section title="Desks">
        <div className="insp-grid">
          <NumberField lazy label="Desk width" value={params.deskWidth} step={0.1} min={DESK_WIDTH_MIN} max={DESK_WIDTH_MAX}
            suffix="m" onCommit={(v) => onChange({ deskWidth: v })} />
          <NumberField lazy label="Desk depth" value={params.deskDepth} step={0.05} min={DESK_DEPTH_MIN} max={DESK_DEPTH_MAX}
            suffix="m" onCommit={(v) => onChange({ deskDepth: v })} />
        </div>
        {!roomy && (
          <>
            <div className="ui-segmented insp-quick" role="group" aria-label="Partition" data-prefab-partition={params.partition}>
              {PARTITION_LABELS.map(([k, label]) => (
                <button key={k} aria-pressed={params.partition === k} onClick={() => onChange({ partition: k })}>{label}</button>
              ))}
            </div>
            {params.partition !== 'none' && (
              <div className="insp-grid">
                <NumberField lazy label="Partition height" value={params.partitionHeight} step={0.05} min={PARTITION_HEIGHT_MIN}
                  max={PARTITION_HEIGHT_MAX} suffix="m" title="Above the desk tops" onCommit={(v) => onChange({ partitionHeight: v })} />
              </div>
            )}
          </>
        )}
      </Section>
      <Section title="Seats">
        <ul className="insp-seats" role="list" aria-label="Seats" data-seats={seats.length}>
          {seats.map((s) => {
            const panel = seatPanelFor?.(s.desk.id) ?? null;
            return (
              <li key={s.desk.id} className="insp-seat" data-seat={s.n} data-desk-id={s.desk.id}
                onMouseEnter={() => onHoverSeat?.(s)} onMouseLeave={() => onHoverSeat?.(null)}
                onFocus={() => onHoverSeat?.(s)} onBlur={() => onHoverSeat?.(null)}>
                <div className="insp-seat__head">
                  <span className="insp-seat__name">Seat {s.n}</span>
                  <button className="ui-btn is-ghost insp-small" onClick={() => onPickSeat?.(s)} title="Select only this desk (Alt+click)">
                    Select desk
                  </button>
                </div>
                {panel && <SeatSection key={s.desk.id} {...panel} />}
              </li>
            );
          })}
        </ul>
        {!seatPanelFor && <p className="insp-note">People are given their desks in AHDUS.</p>}
      </Section>
      <Section title="Group">
        <p className="insp-note">A click selects the whole {prefab.label.toLowerCase()}; Alt+click one desk or chair.</p>
        <div className="insp-row">
          <button className="ui-btn" data-ungroup onClick={onUngroup} title="Make them separate items (one undo step)">
            <Ungroup {...ICON} /> Ungroup
          </button>
        </div>
      </Section>
    </>
  );
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
  liftStops = null,     // v0.18.3: a lift shaft's floors [{ id, name, on }]
  onLiftStops = null,   // (floorIds) => void
  stairWarnings = [],   // a staircase: why it can't be used as it stands (stairFit's texts)
  onFixStairs = null,   // v0.17.4: move it to the nearest spot where it works (null: none, or nothing wrong)
  opening,              // { roomId, kind, index, room, data, partnerRoom } (a selected door/window)
  onResizeOpening,      // (change) => problem text or null
  onSetOpeningStyle,    // (style) => problem text or null (v0.18.1: the door / window type)
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
  cluster = null,       // v0.18.0: a selected saved group: { groupId, prefab, params, seats }
  onClusterChange,      // (params) => void: rebuilt with the new options (one undo step)
  onUngroup,            // () => void
  seatPanelFor = null,  // (deskId) => SeatSection's props (AHDUS), else null
  onHoverSeat,          // (seat | null) => void: the desk outlined in 3D
  onPickSeat,           // (seat) => void: select just that desk
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
      const kind = openingTitle(opening.kind, opening.data);
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
              <h2 className="inspector__title">{openingTitle(opening.kind, opening.data)}</h2>
              <span className="inspector__type">
                {opening.data.width.toFixed(1)} × {opening.data.height.toFixed(1)} m · {opening.room.name}
              </span>
            </>
          )}
          {mode === 'group' && (
            <>
              <h2 className="inspector__title" data-group-count={group.length} data-cluster={cluster ? cluster.prefab.id : undefined}>
                {cluster ? cluster.prefab.label : `${group.length} items selected`}
              </h2>
              <span className="inspector__type">{cluster ? `${cluster.seats.length} seats · ${group.length} items · ` : ''}On {floorName}</span>
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
          <ObjectBody object={object} floorName={floorName} onUpdate={onUpdateObject} stairWarnings={stairWarnings} onFixStairs={onFixStairs}
            wallMount={wallMount} onMountOnWall={onMountOnWall}
            hookPoints={hookPoints} positions={positions} onSetPositionRef={onSetPositionRef} />
        )}
        {mode === 'room' && (
          <RoomBody room={room} departmentChoices={departmentChoices} liftStops={liftStops} onLiftStops={onLiftStops} onUpdate={onUpdateRoom} onSetFloor={onSetFloorFinish}
            onSelectOpening={onSelectOpening} onAddOpening={onAddOpening} />
        )}
        {mode === 'opening' && <OpeningBody opening={opening} floorName={floorName} onResize={onResizeOpening} onSetStyle={onSetOpeningStyle} />}
        {mode === 'layers' && (
          <LayersBody rooms={rooms} objects={objects} floors={floors} routes={routes} onPick={onPickLayer}
            hidden={hiddenLayers} hiddenNote={hiddenNote} onToggleHidden={onToggleHidden} onShowAll={onShowAllHidden}
            onToggleRoomLock={onToggleRoomLock} onToggleLock={onToggleLock} />
        )}
        {mode === 'group' && cluster && (
          <PrefabBody cluster={cluster} onChange={onClusterChange} onUngroup={onUngroup}
            seatPanelFor={seatPanelFor} onHoverSeat={onHoverSeat} onPickSeat={onPickSeat} />
        )}
        {mode === 'group' && !cluster && <GroupBody items={group} />}
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
