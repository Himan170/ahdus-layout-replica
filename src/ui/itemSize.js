/**
 * ui/itemSize.js: PURE (v0.15.1). An item's size in metres for the Inspector: the catalogue
 * size × its scale. What is saved stays the scale (scaleX / Y / Z); only the display and the
 * input are metres (the library already says "1.6 × 0.8 m").
 */

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

const AXES = { width: ['scaleX', 'defaultWidth'], height: ['scaleY', 'defaultHeight'], depth: ['scaleZ', 'defaultDepth'] };

/** The catalogue size of a type (m), 1 where the catalogue has none. */
export function baseSize(def) {
  return {
    width: def?.defaultWidth > 0 ? def.defaultWidth : 1,
    height: def?.defaultHeight > 0 ? def.defaultHeight : 1,
    depth: def?.defaultDepth > 0 ? def.defaultDepth : 1,
  };
}

/** The item's size in metres: { width, height, depth }. */
export function itemSize(object, def) {
  const base = baseSize(def);
  const out = {};
  for (const [axis, [key]] of Object.entries(AXES)) out[axis] = base[axis] * (object?.[key] ?? 1);
  return out;
}

/** The smallest and largest size of one side (m), from the scale limits. */
export function sizeLimits(def, axis) {
  const base = baseSize(def)[axis];
  return { min: +(base * MIN_SCALE).toFixed(2), max: +(base * MAX_SCALE).toFixed(2) };
}

/**
 * The scale patch for a side typed in metres. Keep proportions: every side
 * grows by the same factor (no side past the scale limits).
 * @param {object} object  the item (scaleX / Y / Z)
 * @param {object} def     its catalogue entry
 * @param {'width'|'height'|'depth'} axis
 * @param {number} metres
 * @param {boolean} [keepProportions]
 * @returns {object|null}  { scaleX?, scaleY?, scaleZ? }, or null for a size that is not a number > 0
 */
export function scaleForSize(object, def, axis, metres, keepProportions = false) {
  if (!(metres > 0) || !AXES[axis]) return null;
  const [key] = AXES[axis];
  const base = baseSize(def)[axis];
  const clamp = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const wanted = clamp(metres / base);
  const r3 = (v) => +v.toFixed(3);
  if (!keepProportions) return { [key]: r3(wanted) };
  const old = object?.[key] || 1;
  let f = wanted / old;
  // no side past the limits: the factor stops where the first side does
  for (const [k] of Object.values(AXES)) {
    const s = object?.[k] ?? 1;
    if (s * f > MAX_SCALE) f = MAX_SCALE / s;
    if (s * f < MIN_SCALE) f = MIN_SCALE / s;
  }
  return {
    scaleX: r3((object?.scaleX ?? 1) * f),
    scaleY: r3((object?.scaleY ?? 1) * f),
    scaleZ: r3((object?.scaleZ ?? 1) * f),
  };
}
