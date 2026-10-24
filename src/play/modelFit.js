/**
 * play/modelFit.js
 *
 * PURE maths for real models (utils/modelRegistry.js): where a loaded model
 * goes so that it fills the box of the item's primitive model. Sizes,
 * footprints, stacking on table tops and picking then behave as before.
 *
 * A box is { min: [x, y, z], max: [x, y, z] }. A fit is { scale, offset }:
 * a model point p goes to p * scale + offset (per axis).
 */

const EPS = 1e-6;

const size = (box) => box.max.map((v, i) => v - box.min[i]);

/**
 * The part of `box` given by fractions per axis, e.g. { x: [0, 0.5] } = its
 * left half. Axes not named keep the whole box.
 */
export function regionBox(box, region = {}) {
  const s = size(box);
  const min = [...box.min];
  const max = [...box.max];
  ['x', 'y', 'z'].forEach((axis, i) => {
    const r = region[axis];
    if (!r) return;
    min[i] = box.min[i] + s[i] * r[0];
    max[i] = box.min[i] + s[i] * r[1];
  });
  return { min, max };
}

/**
 * Scale and offset that put the model box `from` into the box `to`.
 * mode 'stretch': fill `to` exactly (each axis its own scale).
 * mode 'contain': keep the model's proportions, as big as fits, standing on
 *   the bottom of `to` and centred in x and z.
 * A flat axis (a rug, a screen seen edge-on: no size) takes the mean of the
 * other scales and sits at the bottom / centre.
 * @returns {{ scale: number[], offset: number[] }}
 */
export function fitTransform(from, to, mode = 'stretch') {
  const fs = size(from);
  const ts = size(to);
  const ratios = fs.map((v, i) => (v > EPS ? ts[i] / v : null));
  const known = ratios.filter((r) => r !== null);
  if (known.length === 0) return { scale: [1, 1, 1], offset: to.min.map((v, i) => v - from.min[i]) };
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const scale = mode === 'contain'
    ? [0, 1, 2].map(() => Math.min(...known))
    : ratios.map((r) => r ?? mean);
  const offset = [0, 1, 2].map((i) => {
    const placed = fs[i] * scale[i];
    if (i === 1) return to.min[1] - from.min[1] * scale[1]; // on the bottom
    if (mode === 'contain' || fs[i] <= EPS) return (to.min[i] + to.max[i]) / 2 - (from.min[i] * scale[i] + placed / 2);
    return to.min[i] - from.min[i] * scale[i];
  });
  return { scale, offset };
}

/** A box moved by a fit (where the model ends up). */
export function applyFit(box, { scale, offset }) {
  return {
    min: box.min.map((v, i) => v * scale[i] + offset[i]),
    max: box.max.map((v, i) => v * scale[i] + offset[i]),
  };
}
