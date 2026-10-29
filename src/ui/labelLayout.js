/**
 * ui/labelLayout.js
 *
 * PURE: which labels over the canvas get drawn, so they never overlap. Labels
 * come in priority order (the selected room, then bigger rooms); a label that
 * would overlap one already placed is left out.
 */

/** Pixels kept free between two labels. */
export const LABEL_GAP = 4;

/**
 * @param {Array<{ x: number, y: number, w: number, h: number, visible?: boolean }>} labels
 *        centre (x, y) and size in CSS px, in priority order
 * @param {Array<object>} [placed]  scratch array for the placed boxes (reused per frame)
 * @returns {boolean[]} for each label: drawn or not
 */
export function fitLabels(labels, gap = LABEL_GAP, placed = []) {
  placed.length = 0;
  return labels.map(({ x, y, w, h, visible = true }) => {
    if (!visible) return false;
    const box = { l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 };
    const clash = placed.some((o) => box.l < o.r + gap && box.r > o.l - gap && box.t < o.b + gap && box.b > o.t - gap);
    if (clash) return false;
    placed.push(box);
    return true;
  });
}
