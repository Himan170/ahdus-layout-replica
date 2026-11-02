/**
 * useLibraryDrop.js
 *
 * The AHDUS look's library tiles on the canvas (ui/LibraryPanel.jsx):
 *   - drag a tile (mouse or pen) onto the floor: a dashed footprint with its name and size
 *     follows the pointer (Shift keeps a room square); releasing it there places it; Esc,
 *     or releasing it off the canvas, cancels
 *   - click a tile: it is placed in the middle of the view
 *   - tap a tile (touch): it is picked, and the next tap on the floor places it
 * The existing code does the placing: a room goes through geometry.planRoomAt (snapping and
 * overlaps as when drawing one) and editor.addRoom; an item through the placement manager
 * (its ghost, table tops) and WorkplaceEditor's placeObject. Every placement is one undo step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Matrix } from '@babylonjs/core/Maths/math.vector';

import { useWorkspaceStore } from '../store/workspaceStore';
import { elevationOf, floorBelow } from '../play/building';
import { formatRoomSize } from '../play/geometry';
import { projectPoint } from '../ui/projection';
import { footprintAt, planRoomDrop } from '../ui/library';

const DRAG_SLOP = 6; // px the pointer travels before a press on a tile is a drag

const ROOM_HINT = 'Drop the room on the floor. Hold Shift to keep it square, Esc to cancel.';
const ITEM_HINT = 'Drop it on the floor or a table top. Esc cancels.';

function floorRooms(st) {
  return Object.values(st.rooms).filter((r) => r.floor === st.currentFloor);
}
function roomsBelow(st) {
  const below = floorBelow(st.floors, st.currentFloor);
  return below ? Object.values(st.rooms).filter((r) => r.floor === below.id) : null;
}

export function useLibraryDrop({
  sceneRef, cameraRef, canvasRef, placementManagerRef, editor, placeObject, snapRef,
  showStudioMessage, handleSetPlannerTool, handleStartPlacement,
}) {
  const [drag, setDrag] = useState(null); // { tile, footprint: { points, centre, valid } | null }
  const press = useRef(null);             // { tile } while a tile is dragged
  const suppressClick = useRef(false);    // the click after a drag is not a "place in the middle"
  const lastPointerType = useRef('mouse');

  /** Canvas pixels of a client point, or null when it is not over the canvas. */
  const canvasPoint = useCallback((clientX, clientY) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: clientX - r.left, y: clientY - r.top };
  }, [canvasRef]);

  /** The point on the floor being edited under canvas pixels (x, y). */
  const groundAt = useCallback(({ x, y }) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return null;
    const st = useWorkspaceStore.getState();
    const floorY = elevationOf(st.floors, st.currentFloor);
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-8) return null;
    const t = (floorY - ray.origin.y) / ray.direction.y;
    if (!Number.isFinite(t) || t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }, [sceneRef, cameraRef]);

  /** Where the tile would land at canvas pixels `at`: { rect, valid, problem } or null. */
  const planAt = useCallback((tile, at, square) => {
    const st = useWorkspaceStore.getState();
    const snap = snapRef.current;
    if (tile.kind === 'room') {
      const point = groundAt(at);
      if (!point) return null;
      const plan = planRoomDrop(tile, point, floorRooms(st), roomsBelow(st), { snapStep: snap.enabled ? snap.step : 0, square });
      return { rect: plan.rect, valid: !plan.blocker, problem: plan.blocker ? `Overlaps ${plan.blocker.name}` : null };
    }
    const mgr = placementManagerRef.current;
    if (!mgr) return null;
    if (!mgr.isActive()) mgr.startPlacement(tile.assetType);
    mgr.updatePointer(at.x, at.y);
    const ghost = mgr.getGhostPosition();
    if (!ghost) return null;
    return { rect: footprintAt(ghost, tile.width, tile.depth), valid: true, problem: null };
  }, [groundAt, placementManagerRef, snapRef]);

  /** The plan's corners and centre in canvas pixels (the dashed footprint). */
  const project = useCallback((plan) => {
    const scene = sceneRef.current;
    if (!scene || !plan) return null;
    const st = useWorkspaceStore.getState();
    const y = elevationOf(st.floors, st.currentFloor) + 0.02;
    const { x, z, width, depth } = plan.rect;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => projectPoint(scene, x + (sx * width) / 2, y, z + (sz * depth) / 2));
    if (corners.some((c) => !c.visible)) return null;
    const centre = projectPoint(scene, x, y, z);
    return { points: corners.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '), centre, valid: plan.valid, size: formatRoomSize(width, depth), problem: plan.problem };
  }, [sceneRef]);

  /** Put the tile down at canvas pixels `at`. @returns {boolean} placed */
  const commit = useCallback((tile, at, square) => {
    const st = useWorkspaceStore.getState();
    if (tile.kind === 'room') {
      const point = groundAt(at);
      if (!point) { showStudioMessage('Drop the room on the floor', true); return false; }
      const snap = snapRef.current;
      const plan = planRoomDrop(tile, point, floorRooms(st), roomsBelow(st), { snapStep: snap.enabled ? snap.step : 0, square });
      if (plan.blocker) { showStudioMessage(`Overlaps ${plan.blocker.name}. Drop it somewhere else.`, true); return false; }
      const before = new Set(Object.keys(st.rooms));
      editor.addRoom({ type: tile.roomType, ...plan.rect, floor: st.currentFloor });
      const added = Object.keys(useWorkspaceStore.getState().rooms).find((id) => !before.has(id));
      if (added) { st.selectObject(null); st.selectRoom(added); }
      showStudioMessage(`Built ${tile.label} room, ${formatRoomSize(plan.rect.width, plan.rect.depth)}. Ctrl+Z to undo.`);
      return true;
    }
    const mgr = placementManagerRef.current;
    if (!mgr) return false;
    planAt(tile, at, false);
    const result = mgr.confirmPlacement();
    st.setPlacementMode(null);
    if (!result) { mgr.cancelPlacement(); showStudioMessage('Drop it on a floor or a table top', true); return false; }
    placeObject(result);
    return true;
  }, [editor, groundAt, planAt, placeObject, placementManagerRef, showStudioMessage, snapRef]);

  const endDrag = useCallback((placed) => {
    const p = press.current;
    press.current = null;
    document.body.classList.remove('is-dragging-tile');
    if (p?.tile.kind !== 'room' && !placed) {
      placementManagerRef.current?.cancelPlacement();
      useWorkspaceStore.getState().setPlacementMode(null);
    }
    setDrag(null);
  }, [placementManagerRef]);

  // While a tile is dragged: follow it, drop or cancel it
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const p = press.current;
      if (!p) return;
      const at = canvasPoint(e.clientX, e.clientY);
      if (!at) {
        if (p.tile.kind !== 'room') placementManagerRef.current?.cancelPlacement();
        setDrag({ tile: p.tile, footprint: null });
        return;
      }
      setDrag({ tile: p.tile, footprint: project(planAt(p.tile, at, e.shiftKey)) });
    };
    const onUp = (e) => {
      const p = press.current;
      if (!p) return;
      const at = canvasPoint(e.clientX, e.clientY);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      endDrag(at ? commit(p.tile, at, e.shiftKey) : false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // Studio's Esc (deselect, leave the tool) waits
      e.preventDefault();
      endDrag(false);
      showStudioMessage('Cancelled');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [dragging, canvasPoint, project, planAt, commit, endDrag, placementManagerRef, showStudioMessage]);

  /** A press on a tile: a drag starts once it has moved DRAG_SLOP px (mouse and pen only). */
  const onTilePointerDown = useCallback((tile, e) => {
    lastPointerType.current = e.pointerType;
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_SLOP) return;
      stop();
      handleSetPlannerTool({ kind: 'select' });
      press.current = { tile };
      document.body.classList.add('is-dragging-tile');
      setDrag({ tile, footprint: null });
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  }, [handleSetPlannerTool]);

  /** A click (or Enter) on a tile: in the middle of the view. A tap: pick it, then tap the floor. */
  const onPlaceTile = useCallback((tile) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (lastPointerType.current === 'touch') {
      lastPointerType.current = 'mouse';
      if (tile.kind === 'room') {
        handleSetPlannerTool({ kind: 'room', roomType: tile.roomType, stamp: { width: tile.width, depth: tile.depth } });
      } else {
        handleStartPlacement(tile.assetType);
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    commit(tile, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, false);
  }, [canvasRef, commit, handleSetPlannerTool, handleStartPlacement]);

  const hint = drag ? (drag.footprint?.problem ?? (drag.tile.kind === 'room' ? ROOM_HINT : ITEM_HINT)) : null;

  return { drag, hint, hintBad: !!drag?.footprint?.problem, onTilePointerDown, onPlaceTile };
}
