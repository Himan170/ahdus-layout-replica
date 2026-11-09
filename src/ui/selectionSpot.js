/**
 * ui/selectionSpot.js: PURE (v0.15.1). Where the floating selection bar goes:
 * above the selected item's top edge on screen, clear of it, and stepped up past
 * any room label it would cover; below the item only when there is no room above.
 * All rectangles in the canvas card's pixels: { left, top, right, bottom }.
 */

export const SPOT_GAP = 18;   // px between the item's top edge and the bar
const LABEL_PAD = 4;          // px kept clear around a room label

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * @param {object} p
 * @param {{left, top, right, bottom}} p.box   the item on screen
 * @param {number} p.w, p.h                    the bar's size
 * @param {number} p.cw, p.ch                  the card's size
 * @param {number} [p.minTop]                  px it keeps clear at the top
 * @param {{left, top, right, bottom}[]} [p.avoid]  room labels on screen
 * @returns {{ x: number, y: number, below: boolean }}
 */
export function selectionSpot({ box, w, h, cw, ch, minTop = 8, avoid = [] }) {
  const x = Math.max(8, Math.min(cw - w - 8, (box.left + box.right) / 2 - w / 2));
  const rectAt = (y) => ({ left: x, top: y, right: x + w, bottom: y + h });
  const padded = avoid.map((r) => ({
    left: r.left - LABEL_PAD, top: r.top - LABEL_PAD, right: r.right + LABEL_PAD, bottom: r.bottom + LABEL_PAD,
  }));
  // above: start just over the item, step up past each label in the way
  let y = box.top - SPOT_GAP - h;
  for (let guard = 0; guard < 20; guard++) {
    const hit = padded.find((r) => overlaps(rectAt(y), r));
    if (!hit) break;
    y = hit.top - h;
  }
  if (y >= minTop) return { x, y, below: false };
  // no room above: below the item, clear of it (labels may be covered there)
  const below = Math.min(box.bottom + SPOT_GAP, ch - h - 8);
  return { x, y: Math.max(minTop, below), below: true };
}
