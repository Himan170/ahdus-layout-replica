/**
 * play/openingStyles.js (v0.18.1, PURE)
 *
 * The kinds of doors and windows. Saved as a door / window record's optional `style` (missing = the default: a
 * wooden door, a standard window) and, for a door, `swing` ('out': it opens out of the room whose record it is;
 * missing = into it). A style this build doesn't know is drawn as the default (styleOf), never an error.
 * Older builds ignore both fields: an open doorway with a wooden frame / a standard window at the saved size.
 */

/** label = the library tile's name (e2e scripts pick "Door" / "Window" by it); min = the narrowest it can be. */
export const DOOR_STYLES = {
  wood: { label: 'Door', name: 'Wooden door', width: 1.0, height: 2.1, minWidth: 0.6, detail: 'Wooden, 1.0 m wide' },
  glass: { label: 'Glass door', name: 'Glass door', width: 1.0, height: 2.1, minWidth: 0.8, detail: 'Metal frame, 1.0 m' },
  'double-glass': { label: 'Double glass door', name: 'Double glass door', width: 1.8, height: 2.1, minWidth: 1.4, detail: 'Entrance, 1.8 m' },
  'sliding-glass': { label: 'Sliding glass door', name: 'Sliding glass door', width: 1.8, height: 2.1, minWidth: 1.2, detail: 'Slides open, 1.8 m' },
  exit: { label: 'Emergency exit', name: 'Emergency exit door', width: 1.0, height: 2.1, minWidth: 0.9, detail: 'Opens outward, EXIT sign' },
};

/** height 'wall': as high as the wall allows (its top less the 0.1 m every opening keeps). */
export const WINDOW_STYLES = {
  standard: { label: 'Window', name: 'Window', width: 1.4, height: 1.2, sill: 0.9, minWidth: 0.4, detail: '1.4 × 1.2 m' },
  tall: { label: 'Tall window', name: 'Tall window', width: 1.0, height: 2.2, sill: 0.3, minWidth: 0.4, detail: '1.0 × 2.2 m, low sill' },
  panel: { label: 'Glass panel', name: 'Full-height glass panel', width: 2.0, height: 'wall', sill: 0, minWidth: 0.6, detail: 'Floor to ceiling, 2.0 m' },
};

export const STYLES = { door: DOOR_STYLES, window: WINDOW_STYLES };
export const DEFAULT_STYLE = { door: 'wood', window: 'standard' };
/** Every opening keeps this much wall above it (geometry.OPENING_LIMITS topGap). */
const TOP_GAP = 0.1;
/** A tall window is at least this high on a low wall (else it is refused). */
const TALL_MIN = 1.2;

const round1 = (v) => Math.round(v * 10) / 10;

/** The style of a door / window record: a known one, else the default. */
export function styleOf(kind, record) {
  const s = record?.style;
  return s && STYLES[kind]?.[s] ? s : DEFAULT_STYLE[kind];
}

/** The style's entry (the default's for an unknown one). */
export function styleDef(kind, style) {
  return STYLES[kind]?.[style] ?? STYLES[kind]?.[DEFAULT_STYLE[kind]];
}

/** Glass in the door itself (glass, double, sliding): what you see through. */
export const isGlassDoor = (style) => style === 'glass' || style === 'double-glass' || style === 'sliding-glass';

/**
 * A new door / window of this style on a wall of this height: { width, height, sill }.
 * A panel reaches the top less 0.1 m; a tall window is lower on a low wall.
 */
export function styleSize(kind, style, wallHeight = 3) {
  const d = styleDef(kind, style);
  if (kind === 'door') return { width: d.width, height: d.height, sill: 0 };
  if (d.height === 'wall') return { width: d.width, height: round1(wallHeight - TOP_GAP - d.sill), sill: d.sill };
  if (style === 'tall') {
    return { width: d.width, height: Math.max(TALL_MIN, Math.min(d.height, round1(wallHeight - TOP_GAP - d.sill))), sill: d.sill };
  }
  return { width: d.width, height: d.height, sill: d.sill };
}

/**
 * The fields a record of this style carries (only what differs from the default): { style?, swing? }.
 * `own`: the record of the room it is placed or changed from (an exit opens OUT of that room); the
 * neighbour's record of the same door says 'in' (into the neighbour = out of that room).
 */
export function styleFields(kind, style, own = true) {
  const s = styleOf(kind, { style });
  const out = {};
  if (s !== DEFAULT_STYLE[kind]) out.style = s;
  if (kind === 'door' && s === 'exit') out.swing = own ? 'out' : 'in';
  return out;
}

/** The record with its style fields replaced (patches: keys set to undefined remove them when saved). */
export function withStyle(record, kind, style, own = true) {
  const { style: _s, swing: _w, ...rest } = record;
  return { ...rest, ...styleFields(kind, style, own) };
}

/** "Glass door", "Tall window", …: what the Inspector, hints and Walk through call it. */
export function styleName(kind, record) {
  return styleDef(kind, styleOf(kind, record)).name;
}

/** The library tiles / Walk through items, in order: [{ kind, style, label, name, detail }]. */
export function styleOptions(kind) {
  return Object.entries(STYLES[kind]).map(([style, d]) => ({ kind, style, label: d.label, name: d.name, detail: d.detail }));
}
