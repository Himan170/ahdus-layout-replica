/**
 * useStudioKeyboard.js
 *
 * Workplace Studio's keyboard shortcuts, moved as one piece out of WorkplaceEditor.jsx:
 * the keydown listener (Tab, Esc, 1–6, Delete, arrow keys, W / R / S, L, Ctrl+Z / Y / D / S;
 * in Preview only undo / redo / save; the AHDUS look's camera keys through cameraKeyRef) and the wheel
 * listener (height of the placement ghost).
 *
 * WorkplaceEditor passes the refs, setters and callbacks in under the same names and
 * calls it where the effect was: effects run in declaration order.
 */

import { useEffect } from 'react';

import { useWorkspaceStore } from '../store/workspaceStore';
import { STUDIO_TOOLS } from '../ui/tools';
import { STAIRS_KEEP_SIZE } from '../play/building';
import { findRoomAt } from '../play/geometry';
import { saveNow } from '../services/apiService';
import { turnStep } from '../play/carry';
import { adjacentFloor } from '../floorplan/planFloors';
import { isTypingTarget } from '../ui/typing';

export function useStudioKeyboard({
  editor, handleCancelPlacement, handleToggleGizmo, handleTurnItem, handleTurnRoom, handleEnterPlay, handleSetPlannerTool,
  handleDeleteOpening, showStudioMessage, isPlayingRef, plannerToolsRef, measureModeRef, measureStartRef,
  placementManagerRef, snapRef, setMeasureMode, setMeasureStart, setMeasurePreview, setLayersOpen,
  setOpenTray, setAnnounceText,
  cameraKeyRef, // AHDUS look: (key) => true when it was a camera key (H, F, + / −, O, P, 7–9)
  groupActions = null, // v0.15.5: planner/groupActions.js (several items, copy / paste)
  pasteTarget = () => null, // () => { x, z } on the floor under the mouse, or null
}) {
  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+S saves now (also while typing, and in Preview), never the browser's "Save page as"
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNow().then((result) => {
          if (result?.ok === false) showStudioMessage(`Not saved: ${result.error ?? 'unknown error'}`, true);
          else showStudioMessage('Saved');
        }).catch((err) => showStudioMessage(`Not saved: ${err?.message ?? err}`, true));
        return;
      }
      // Typing is safe: in a text field, a dropdown or a search box no key changes the layout
      // (Ctrl+C / Ctrl+V copy text there as normal)
      if (isTypingTarget(e.target)) return;

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

      if (!e.ctrlKey && !e.metaKey && !e.altKey && cameraKeyRef?.current?.(e.key)) {
        e.preventDefault();
        return;
      }

      // v0.15.5: Ctrl+C copies the selected items, Ctrl+V pastes them at the mouse (else 0.5 m aside),
      // Ctrl+Shift+V at the same place (one floor's furniture onto another)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && groupActions) {
        const k = e.key.toLowerCase();
        if (k === 'c' && groupActions.selection().length) {
          e.preventDefault();
          groupActions.copy();
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          if (placementManagerRef.current?.isActive()) handleCancelPlacement();
          groupActions.paste(e.shiftKey ? { same: true } : { at: pasteTarget() });
          return;
        }
      }
      const group = !!groupActions?.isGroup();

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

        case 'PageUp':
        case 'PageDown': {
          // v0.15.5: floors in every Studio view (Plan keeps its zoom and place)
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          e.preventDefault();
          const floors = Object.values(store.floors);
          const next = adjacentFloor(floors, store.currentFloor, e.key === 'PageUp' ? 1 : -1);
          if (next == null) {
            showStudioMessage(e.key === 'PageUp' ? 'This is the top floor' : 'This is the ground floor');
          } else {
            store.selectFloor(next);
            const name = store.floors[next]?.name ?? 'Floor';
            showStudioMessage(name);
            setAnnounceText(name);
          }
          break;
        }

        case 'Delete':
        case 'Backspace':
          // Delete selected object
          if (group) {
            groupActions.remove();
          } else if (store.selectedOpening) {
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
          if (group) {
            e.preventDefault();
            const gStep = e.shiftKey ? 1.0 : e.altKey ? 0.05
              : snapRef.current?.enabled && snapRef.current?.step > 0 ? snapRef.current.step : 0.25;
            const gx = e.key === 'ArrowLeft' ? -gStep : e.key === 'ArrowRight' ? gStep : 0;
            const gz = e.key === 'ArrowUp' ? -gStep : e.key === 'ArrowDown' ? gStep : 0;
            if (groupActions.move(gx, gz, { label: 'Move items (keyboard)' })) {
              setAnnounceText(`Moved ${store.selectedObjectIds.length} items`);
            }
            break;
          }
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

          // with what it takes along (a desk: its chair and its monitor), one undo step
          const patch = { x: newX, z: newZ, roomId: findRoomAt(Object.values(store.rooms), newX, newZ, obj.floor ?? 0)?.id ?? null };
          if (!plannerToolsRef.current?.moveItem(store.selectedObjectId, patch, { label: 'Move item (keyboard)' })) {
            editor.updateObject(store.selectedObjectId, patch, { label: 'Move item (keyboard)' });
          }
          setAnnounceText(`Moved ${obj.label || obj.assetType} to X ${newX}, Z ${newZ}`);
          break;
        }

        case 'w':
        case 'W':
          // Move: show (or hide) the move arrows. Dragging an item moves it anyway.
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          if (store.selectedObjectId) handleToggleGizmo('position');
          break;

        case 'r':
        case 'R': {
          // v0.15.1, one way to turn (as in Walk through): R = 90°, Shift+R = 15°
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          if (placementManagerRef.current?.isActive()) {
            placementManagerRef.current.rotatePreview(turnStep(e.shiftKey));
          } else if (group) {
            groupActions.turn(e.shiftKey); // about the group's middle, one undo step
          } else if (store.selectedObjectId && !store.selectedOpening) {
            handleTurnItem(store.selectedObjectId, e.shiftKey);
          } else if (store.selectedRoomId && !store.selectedOpening) {
            // v0.15.2: a room turns with its furniture and the rooms inside it (as the selection bar's Rotate)
            if (e.shiftKey) showStudioMessage('Rooms turn in quarter turns: press R');
            else handleTurnRoom(store.selectedRoomId);
          }
          break;
        }

        case 's':
        case 'S':
          // Resize: show (or hide) the size handles (was R before v0.15.1)
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          if (!store.selectedObjectId) break;
          if (store.objects[store.selectedObjectId]?.assetType === 'STAIRCASE') showStudioMessage(STAIRS_KEEP_SIZE);
          else handleToggleGizmo('scale');
          break;

        case 'l':
        case 'L':
          // Toggle lock on selected object
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          if (group) {
            groupActions.toggleLock(); // all locked → unlock all, else lock all
          } else if (store.selectedObjectId) {
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
          if ((e.ctrlKey || e.metaKey) && group) {
            e.preventDefault();
            groupActions.duplicate();
          } else if ((e.ctrlKey || e.metaKey) && store.selectedObjectId) {
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
  }, [editor, handleCancelPlacement, handleToggleGizmo, handleTurnItem, handleTurnRoom, handleEnterPlay, handleSetPlannerTool, handleDeleteOpening, showStudioMessage, groupActions, pasteTarget]);
}
