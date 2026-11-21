/**
 * utils/liveEdge.js (v0.18.7, Astra audit 3c)
 *
 * Studio's 2D view: the room edge being dragged RIGHT NOW (its new outline and length, for the label at that edge)
 * and the edge whose length is being typed. plannerTools writes it, ui/RoomEdgeHandles.jsx draws it. Not saved,
 * not in undo (the room changes once, when the mouse is let go or Enter is pressed).
 */

let state = { drag: null, typing: null }; // drag: { roomId, side, rect, length, problem } · typing: { roomId, side }
const listeners = new Set();
const tell = () => listeners.forEach((fn) => fn());
const set = (patch) => { state = { ...state, ...patch }; tell(); };

export const liveEdge = {
  /** An edge is being dragged: where it is now. */
  setDrag(next) {
    const d = state.drag;
    if (d && next && d.roomId === next.roomId && d.side === next.side && d.length === next.length && d.problem === next.problem
      && d.rect.x === next.rect.x && d.rect.z === next.rect.z) return;
    set({ drag: next });
  },
  clearDrag() { if (state.drag) set({ drag: null }); },
  /** A click on an edge handle: type its length. */
  openTyping(roomId, side) { set({ typing: { roomId, side } }); },
  closeTyping() { if (state.typing) set({ typing: null }); },
  get: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
