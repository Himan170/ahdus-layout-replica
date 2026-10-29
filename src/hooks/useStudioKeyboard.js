/**
 * useStudioKeyboard.js
 *
 * Workplace Studio's keyboard shortcuts, moved as one piece out of WorkplaceEditor.jsx:
 * the keydown listener (Tab, Esc, 1–6, Delete, arrow keys, W / E / R, L, Ctrl+Z / Y / D;
 * in Preview only undo / redo) and the wheel listener (height of the placement ghost).
 *
 * WorkplaceEditor passes the refs, setters and callbacks in under the same names and
 * calls it where the effect was: effects run in declaration order.
 */

import { useEffect } from 'react';

import { useWorkspaceStore } from '../store/workspaceStore';
import { STUDIO_TOOLS } from '../ui/tools';

export function useStudioKeyboard({
  editor, handleCancelPlacement, handleSetGizmoMode, handleEnterPlay, handleSetPlannerTool,
  handleDeleteOpening, showStudioMessage, isPlayingRef, plannerToolsRef, measureModeRef, measureStartRef,
  placementManagerRef, snapRef, setMeasureMode, setMeasureStart, setMeasurePreview, setLayersOpen,
  setOpenTray, setAnnounceText,
}) {
  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const store = useWorkspaceStore.getState();

      // In Play mode only undo/redo is handled here (the play controller does the rest)
      if (isPlayingRef.current) {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
          e.preventDefault();
          if (k === 'y' || e.shiftKey) editor.redo();
          else editor.undo();
        }
        return;
      }

      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          handleEnterPlay();
          break;

        case 'Escape': {
          // Cancel placement or a drag, then leave the build tool, then deselect
          const tools = plannerToolsRef.current;
          if (measureModeRef.current) {
            measureModeRef.current = false;
            measureStartRef.current = null;
            setMeasureMode(false);
            setMeasureStart(null);
            setMeasurePreview(null);
          } else if (placementManagerRef.current?.isActive()) {
            handleCancelPlacement();
          } else if (tools?.isDragging()) {
            tools.cancel();
          } else if (tools && tools.getTool().kind !== 'select') {
            handleSetPlannerTool({ kind: 'select' });
          } else {
            store.selectObject(null);
            store.selectRoom(null);
            setLayersOpen(false);
          }
          break;
        }

        case '1': case '2': case '3': case '4': case '5': case '6': {
          // Build panel tiles: 1 = Select, 2–6 open a tile's options
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          const tile = STUDIO_TOOLS[Number(e.key) - 1];
          if (tile.id === 'select') {
            setOpenTray(null);
            handleSetPlannerTool({ kind: 'select' });
          } else {
            setOpenTray((cur) => (cur === tile.id ? null : tile.id));
          }
          break;
        }

        case 'Delete':
        case 'Backspace':
          // Delete selected object
          if (store.selectedOpening) {
            handleDeleteOpening();
          } else if (store.selectedObjectId) {
            const obj = store.objects[store.selectedObjectId];
            if (obj && !obj.isLocked) {
              editor.deleteObject(store.selectedObjectId);
            }
          } else if (store.selectedRoomId) {
            editor.deleteRoom(store.selectedRoomId);
          }
          break;

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Accessibility (Task S3): Arrow keys move the selected object on the grid
          if (!store.selectedObjectId) break;
          const obj = store.objects[store.selectedObjectId];
          if (!obj) break;
          e.preventDefault();
          e.stopPropagation();

          if (obj.isLocked) {
            showStudioMessage('Item is locked and cannot be moved', true);
            setAnnounceText('Item is locked and cannot be moved');
            break;
          }

          const baseStep = snapRef.current?.enabled && snapRef.current?.step > 0 ? snapRef.current.step : 0.25;
          const step = e.shiftKey ? 1.0 : e.altKey ? 0.05 : baseStep;

          let dx = 0;
          let dz = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;
          if (e.key === 'ArrowUp') dz = -step;
          if (e.key === 'ArrowDown') dz = step;

          const newX = Math.round(((Number(obj.x) || 0) + dx) * 1000) / 1000;
          const newZ = Math.round(((Number(obj.z) || 0) + dz) * 1000) / 1000;

          editor.updateObject(
            store.selectedObjectId,
            { x: newX, z: newZ },
            { label: 'Move item (keyboard)' }
          );
          setAnnounceText(`Moved ${obj.label || obj.assetType} to X ${newX}, Z ${newZ}`);
          break;
        }

        case 'w':
        case 'W':
          handleSetGizmoMode('position');
          break;

        case 'e':
        case 'E':
          handleSetGizmoMode('rotation');
          break;

        case 'r':
        case 'R':
          // During placement: rotate preview 45°. Otherwise: scale gizmo.
          if (placementManagerRef.current?.isActive()) {
            placementManagerRef.current.rotatePreview();
          } else {
            handleSetGizmoMode('scale');
          }
          break;

        case 'l':
        case 'L':
          // Toggle lock on selected object
          if (store.selectedObjectId) {
            editor.toggleLock(store.selectedObjectId);
          }
          break;

        case 'z':
        case 'Z':
          // Ctrl+Z = Undo, Ctrl+Shift+Z = Redo
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) editor.redo();
            else editor.undo();
          }
          break;

        case 'y':
        case 'Y':
          // Ctrl+Y = Redo
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            editor.redo();
          }
          break;

        case 'd':
        case 'D':
          // Ctrl+D = Duplicate selected object
          if ((e.ctrlKey || e.metaKey) && store.selectedObjectId) {
            e.preventDefault();
            editor.duplicateObject(store.selectedObjectId);
          }
          break;

        default:
          break;
      }
    };

    // Scroll wheel: adjust height of ghost during placement
    const handleWheel = (e) => {
      if (isPlayingRef.current) return;
      const mgr = placementManagerRef.current;
      if (mgr?.isActive()) {
        e.preventDefault();
        mgr.adjustHeight(e.deltaY > 0 ? -1 : 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs and state setters passed in are stable
  }, [editor, handleCancelPlacement, handleSetGizmoMode, handleEnterPlay, handleSetPlannerTool, handleDeleteOpening, showStudioMessage]);
}
