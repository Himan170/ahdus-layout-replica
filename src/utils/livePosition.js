/**
 * utils/livePosition.js
 *
 * Where the item being dragged is RIGHT NOW (v0.15.2): Studio's drag and the move arrows
 * write the layout once, when the mouse is let go (one undo step), so the Inspector's X / Z
 * stood still during a drag. They tell this tiny store instead, and the Inspector shows it.
 * Not saved, not in undo: it is cleared when the drag ends.
 */

let value = null; // { id, x, z } | null
const listeners = new Set();
const tell = () => listeners.forEach((fn) => fn());
const r2 = (v) => Math.round(v * 100) / 100;

export const livePosition = {
  /** The dragged item is at (x, z) now. Only a change of a centimetre or more is passed on. */
  set(id, x, z) {
    const next = { id, x: r2(x), z: r2(z) };
    if (value && value.id === next.id && value.x === next.x && value.z === next.z) return;
    value = next;
    tell();
  },
  /** The drag ended (or was cancelled). */
  clear() {
    if (!value) return;
    value = null;
    tell();
  },
  get: () => value,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
