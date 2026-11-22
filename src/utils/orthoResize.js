/**
 * utils/orthoResize.js (v0.18.9)
 *
 * PURE: the 2D (orthographic) view when its canvas changes size (an Inspector opening or closing, a window
 * resized). The picture keeps its scale (metres per pixel) and its left and top edges: what was under a pixel
 * stays under it, the canvas just shows more or less on the right and at the bottom. Before, the view kept its
 * middle and its height, so opening the Inspector by pressing on an item slid the whole floor several metres
 * under the mouse, and a drag started that way jumped (private-docs/V0.18.9_PLAN.md, item 1).
 * Tested in utils/__tests__/orthoResize.test.js.
 */

/**
 * The ortho bounds and the shift of the view's middle (in view space: x right, y up, metres) that keep the scale
 * and the left / top edges when the canvas goes from w0 × h0 to w1 × h1 pixels. Bounds stay symmetric (half
 * width, half height), as the rest of Studio expects (zoom, pan, fit).
 * @param {{ orthoLeft: number, orthoRight: number, orthoTop: number, orthoBottom: number }} ortho  now
 * @param {number} w0 @param {number} h0  the canvas before (pixels)
 * @param {number} w1 @param {number} h1  the canvas now (pixels)
 * @returns {{ halfW: number, halfH: number, shiftX: number, shiftY: number } | null}  null: nothing to keep
 */
export function keepOrthoView(ortho, w0, h0, w1, h1) {
  const width = (ortho?.orthoRight ?? 0) - (ortho?.orthoLeft ?? 0);
  const height = (ortho?.orthoTop ?? 0) - (ortho?.orthoBottom ?? 0);
  if (!(w0 > 0 && h0 > 0 && w1 > 0 && h1 > 0) || !(width > 0) || !(height > 0)) return null;
  // metres per pixel: the vertical one is the scale (the old code kept orthoTop, so both are equal)
  const scale = height / h0;
  const halfW0 = width / 2;
  const halfH0 = height / 2;
  const halfW = (w1 * scale) / 2;
  const halfH = (h1 * scale) / 2;
  return {
    halfW,
    halfH,
    shiftX: halfW - halfW0, // the left edge stays: the middle moves by the change of half the width
    shiftY: halfH0 - halfH, // the top edge stays
  };
}
