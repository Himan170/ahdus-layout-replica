/**
 * play/roomEdges.js (v0.18.7, Astra audit 3c)
 *
 * PURE: resizing a room by one of its edges, the same in Plan view and in Studio's 2D view. A selected room
 * shows a handle in the middle of each edge; dragging one moves that edge only (the opposite wall stays where it
 * is), a click on one lets you type the length. Both go through geometry.stretchRoom (THE wall drag rule:
 * snapping of the moving edge, doors and windows kept in place, items kept inside, overlaps refused).
 */

import { stretchRoom } from './geometry';

export const EDGE_SIDES = ['north', 'east', 'south', 'west'];
/** How near (CSS px) the mouse must be to a handle to grab it. */
export const HANDLE_GRAB_PX = 12;

/** A millimetre: typed and dragged sizes are kept to it (6.65 stayed 6.6499999999999995). */
export const roundMm = (v) => Math.round(v * 1000) / 1000;

const isX = (side) => side === 'east' || side === 'west';

/** The middle of one edge of the room, world { x, z }. */
export function edgeMidpoint(room, side) {
  const w = Number(room.width) / 2;
  const d = Number(room.depth) / 2;
  if (side === 'east') return { x: room.x + w, z: room.z };
  if (side === 'west') return { x: room.x - w, z: room.z };
  if (side === 'north') return { x: room.x, z: room.z + d };
  return { x: room.x, z: room.z - d };
}

/** Where an edge of a rectangle { x, z, width, depth } is: its x (east / west) or z (north / south). */
export function edgeCoordinate(rect, side) {
  if (side === 'east') return rect.x + rect.width / 2;
  if (side === 'west') return rect.x - rect.width / 2;
  if (side === 'north') return rect.z + rect.depth / 2;
  return rect.z - rect.depth / 2;
}

/** The room's length that this edge changes: its width (east / west), its depth (north / south). */
export const edgeLength = (room, side) => Number(isX(side) ? room.width : room.depth);

/** Where the moving edge goes for a room `length` m long, the opposite edge staying put. */
export function edgeTargetFor(room, side, length) {
  const w = Number(room.width) / 2;
  const d = Number(room.depth) / 2;
  if (side === 'east') return room.x - w + length;
  if (side === 'west') return room.x + w - length;
  if (side === 'north') return room.z - d + length;
  return room.z + d - length;
}

/** A typed length: "6.4", "6,4", "6.4 m". null: not a length. */
export function parseLength(text) {
  const t = String(text ?? '').trim().replace(/\s*m$/i, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The axis coordinate a pointer at (x, z) drags this edge to; `step` (m) snaps it to Studio's grid. */
export function edgeTargetAt(side, point, { step = 0 } = {}) {
  const v = isX(side) ? point.x : point.z;
  return step > 0 ? Math.round(v / step) * step : v;
}

/**
 * The room with one edge moved to `target` (world x for east / west, z for north / south): stretchRoom's answer
 * (rect, patch, problem, overhang), kept to the millimetre, + `length` (the new width / depth) and `fixed` (the
 * opposite edge, unchanged).
 */
export function edgeResize(room, side, target, context = {}) {
  const result = stretchRoom(room, side, target, context);
  const rect = {
    x: roundMm(result.rect.x), z: roundMm(result.rect.z),
    width: roundMm(result.rect.width), depth: roundMm(result.rect.depth),
  };
  return {
    ...result,
    rect,
    patch: { ...result.patch, ...rect },
    length: isX(side) ? rect.width : rect.depth,
    side,
  };
}

/** The room typed `length` m long by moving this edge (the opposite one stays). */
export function edgeResizeTo(room, side, length, context = {}) {
  return edgeResize(room, side, edgeTargetFor(room, side, length), context);
}

/** The handle nearest to a screen point within `radius` px. `project(x, z)` → { x, y } (px). null: none. */
export function handleAt(room, screen, project, radius = HANDLE_GRAB_PX) {
  let best = null;
  for (const side of EDGE_SIDES) {
    const m = edgeMidpoint(room, side);
    const p = project(m.x, m.z);
    if (!p) continue;
    const d = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (d <= radius && (!best || d < best.d)) best = { side, d };
  }
  return best?.side ?? null;
}

/** "6.40 m" */
export const lengthText = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
