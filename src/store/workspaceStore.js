/**
 * workspaceStore.js
 *
 * Unified Zustand store that replaces the hand-rolled roomStore and objectStore
 * singletons. Holds all workspace data (rooms, objects, UI state, tenant info)
 * in a single reactive tree with fine-grained selectors.
 *
 * Phase 4 — Multi-Tenant & Data Sync
 * Phase 5 — Multi-Floor Support
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { subscribeWithSelector } from 'zustand/middleware';
import { ROOM_TYPES } from '../utils/roomStore';
import { OBJECT_CATEGORIES } from '../utils/assetCatalog';
import { normaliseLayout } from './layoutData';
import { STOREY_HEIGHT, wallSpace, floorsInOrder, isGroundFloor } from '../play/building';
import { WALL_THICKNESS } from '../play/geometry';

/** A record as saved: without UI state. */
const withoutSelection = ({ isSelected: _s, ...rest }) => rest;

// ─── IDs ───
// New rooms and objects get random UUIDs (room_<uuid>, obj_<uuid>), so two tabs,
// two people or the database never make the same one. IDs from saves (room_3,
// obj_12) are kept as they are: anchor IDs other modules stored derive from them.
const roomId   = () => `room_${uuidv4()}`;
const objectId = () => `obj_${uuidv4()}`;

/** Reuse a caller-supplied ID (loading; undo/redo restore an object under its old ID). */
function claimRoomId(id)   { return id ? String(id) : roomId(); }
function claimObjectId(id) { return id ? String(id) : objectId(); }

/** "Office 3": one more than the highest number already used after `label`. */
function nextName(label, records) {
  let max = 0;
  for (const r of records) {
    const name = r.name ?? '';
    if (!name.startsWith(`${label} `)) continue;
    const n = Number(name.slice(label.length + 1));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return `${label} ${max + 1}`;
}

// ─── Zustand Store ───
/**
 * A new, empty store. The app has one (useWorkspaceStore, below); each
 * LayoutEngine (engine/LayoutEngine.ts) keeps its own copy of a layout in
 * another, so a viewer and Workplace Studio can be open on one page.
 */
export const createWorkspaceStore = () => create(
  subscribeWithSelector((set, get) => ({
    // ━━ Tenant / Layout context ━━
    companyId:  null,
    layoutId:   null,
    layoutName: 'New Workspace',
    layoutVersion: 1,
    isDirty: false,                    // true if local changes haven't been saved
    saveError: null,                   // message of the last failed save (null = last save worked)
    saveConflict: false,               // another tab saved this layout after we loaded it: saving stops
    openElsewhere: false,              // this layout is also open in another tab
    storageNearlyFull: false,          // the browser's storage for layouts is almost used up

    // ━━ R7: Sync & Offline Status ━━
    syncStatus: 'online',              // 'online' | 'offline' | 'syncing' | 'conflict'
    pendingSyncCount: 0,               // number of queued saves waiting to sync

    // ━━ R8: Proposed Layout Staging (Photo Reconstruction) ━━
    proposedLayout: null,              // { proposalId, storagePath, layout, detectionStats, stagedAt }
    isReconstructing: false,           // true while photo is uploading / analyzing
    reconstructionError: null,         // message if photo reconstruction failed

    // ━━ Floors ━━ (Phase 5)
    // { [floorId]: { id, name, height } }. height = floor-to-floor; the
    // elevation is derived (building.elevationOf), never stored.
    floors: {
      0: { id: 0, name: 'Ground Floor', height: STOREY_HEIGHT },
    },
    currentFloor: 0,                   // which floor is currently being viewed/edited

    // ━━ Rooms ━━
    rooms: {},                         // { [roomId]: roomData }
    selectedRoomId: null,

    // ━━ Objects ━━
    objects: {},                       // { [objId]: objectData }
    selectedObjectId: null,

    // ━━ Selected door / window ━━ { roomId, kind: 'door'|'window', index } or null
    selectedOpening: null,

    // ━━ Anchor data ━━ (what other modules write onto hook points)
    // { [anchorId]: { positionRef?, label? } } — anchor POSITIONS are derived
    // from objects (see integration/anchorsFromStore.js), only this is saved.
    anchorData: {},

    // ━━ UI state ━━
    activePanel: 'rooms',              // 'rooms' | 'objects'
    gizmoMode: null,                   // 'position' | 'rotation' | 'scale' | null
    placementMode: null,               // assetType string or null
    is3D: true,

    // ──────────────────────────────────
    //  ROOM ACTIONS
    // ──────────────────────────────────

    /**
     * Add a new room. Returns the created room.
     * If opts.id is given it is reused, and every field in opts is kept
     * (undo of a delete passes the full old room back in).
     */
    addRoom: (opts) => {
      const typeDef = ROOM_TYPES[opts.type] || ROOM_TYPES.OFFICE;
      const id = claimRoomId(opts.id);
      const state = get();
      const floor = opts.floor ?? state.currentFloor;
      const room = {
        type:       'OFFICE',
        name:       opts.name ?? nextName(typeDef.label, Object.values(state.rooms)),
        floor,
        x:          0,
        z:          0,
        width:      typeDef.defaultW,
        depth:      typeDef.defaultD,
        wallHeight: wallSpace(state.floors, floor), // the walls fill the floor
        wallThickness: WALL_THICKNESS,
        doors:      [],
        windows:    [],
        color:      typeDef.color,
        ...opts,
        id,
        isSelected: false,
      };

      set((s) => {
        // Deselect previous
        const rooms = { ...s.rooms };
        if (s.selectedRoomId && rooms[s.selectedRoomId]) {
          rooms[s.selectedRoomId] = { ...rooms[s.selectedRoomId], isSelected: false };
        }
        rooms[id] = { ...room, isSelected: true };
        return { rooms, selectedRoomId: id, isDirty: true };
      });
      return get().rooms[id];
    },

    /** Update fields on an existing room. */
    updateRoom: (id, patch) => {
      set((s) => {
        if (!s.rooms[id]) return s;
        return {
          rooms: { ...s.rooms, [id]: { ...s.rooms[id], ...patch } },
          isDirty: true,
        };
      });
    },

    /** Remove a room by ID. */
    removeRoom: (id) => {
      set((s) => {
        const rooms = { ...s.rooms };
        delete rooms[id];
        return {
          rooms,
          selectedRoomId: s.selectedRoomId === id ? null : s.selectedRoomId,
          isDirty: true,
        };
      });
    },

    /** Select a room (deselects previous). */
    selectRoom: (id) => {
      set((s) => {
        const rooms = { ...s.rooms };
        // Deselect old
        if (s.selectedRoomId && rooms[s.selectedRoomId]) {
          rooms[s.selectedRoomId] = { ...rooms[s.selectedRoomId], isSelected: false };
        }
        // Select new
        if (id && rooms[id]) {
          rooms[id] = { ...rooms[id], isSelected: true };
        }
        return { rooms, selectedRoomId: id, selectedOpening: null };
      });
    },

    /**
     * Select a door or window ({ roomId, kind, index }), or null. Deselects
     * rooms and items: one thing is selected at a time.
     */
    selectOpening: (sel) => {
      get().selectRoom(null);
      get().selectObject(null);
      set({ selectedOpening: sel ? { roomId: sel.roomId, kind: sel.kind, index: sel.index } : null });
    },

    /** Clear all rooms. */
    clearRooms: () => {
      set({ rooms: {}, selectedRoomId: null, isDirty: true });
    },

    // ──────────────────────────────────
    //  OBJECT ACTIONS
    // ──────────────────────────────────

    /**
     * Add a new object. Returns the created object.
     * If opts.id is given it is reused, and every field in opts is kept
     * (label, department, ...) so undo can restore an object exactly.
     */
    addObject: (opts) => {
      const id = claimObjectId(opts.id);
      const state = get();
      const obj = {
        name:       opts.name ?? nextName(opts.assetType, Object.values(state.objects)),
        category:   OBJECT_CATEGORIES.FURNITURE,
        floor:      state.currentFloor,
        roomId:     null,
        x:          0,
        y:          0,
        z:          0,
        rotationX:  0,
        rotationY:  0,
        rotationZ:  0,
        scaleX:     1,
        scaleY:     1,
        scaleZ:     1,
        label:      '',
        department: '',
        isLocked:   false,
        metadata:   {},
        ...opts,
        id,
        isSelected: false,
      };

      set((s) => {
        // Deselect previous object
        const objects = { ...s.objects };
        if (s.selectedObjectId && objects[s.selectedObjectId]) {
          objects[s.selectedObjectId] = { ...objects[s.selectedObjectId], isSelected: false };
        }
        objects[id] = { ...obj, isSelected: true };
        return { objects, selectedObjectId: id, isDirty: true };
      });
      return get().objects[id];
    },

    /** Update fields on an existing object. */
    updateObject: (id, patch) => {
      set((s) => {
        if (!s.objects[id]) return s;
        return {
          objects: { ...s.objects, [id]: { ...s.objects[id], ...patch } },
          isDirty: true,
        };
      });
    },

    /** Remove an object by ID. */
    removeObject: (id) => {
      set((s) => {
        const objects = { ...s.objects };
        delete objects[id];
        return {
          objects,
          selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
          isDirty: true,
        };
      });
    },

    /** Select an object (deselects previous). */
    selectObject: (id) => {
      set((s) => {
        const objects = { ...s.objects };
        // Deselect old
        if (s.selectedObjectId && objects[s.selectedObjectId]) {
          objects[s.selectedObjectId] = { ...objects[s.selectedObjectId], isSelected: false };
        }
        // Select new
        if (id && objects[id]) {
          objects[id] = { ...objects[id], isSelected: true };
        }
        return { objects, selectedObjectId: id, selectedOpening: null };
      });
    },

    /** Toggle lock on an object. */
    toggleLock: (id) => {
      set((s) => {
        const obj = s.objects[id];
        if (!obj) return s;
        return {
          objects: { ...s.objects, [id]: { ...obj, isLocked: !obj.isLocked } },
          isDirty: true,
        };
      });
    },

    /** Get all objects assigned to a specific room. */
    getObjectsInRoom: (rmId) => {
      return Object.values(get().objects).filter((o) => o.roomId === rmId);
    },

    /** Clear all objects. */
    clearObjects: () => {
      set({ objects: {}, selectedObjectId: null, isDirty: true });
    },

    // ──────────────────────────────────
    //  UI ACTIONS
    // ──────────────────────────────────

    setActivePanel:  (panel)  => set({ activePanel: panel }),
    setGizmoMode:    (mode)   => set({ gizmoMode: mode }),
    setPlacementMode:(mode)   => set({ placementMode: mode }),
    setIs3D:         (flag)   => set({ is3D: flag }),

    // ──────────────────────────────────
    //  FLOOR ACTIONS (Phase 5)
    // ──────────────────────────────────

    /**
     * Add a new floor on top of the building. Returns its id.
     * @param {string} [name]
     * @param {number} [height] floor-to-floor height (default STOREY_HEIGHT)
     */
    addFloor: (name, height = STOREY_HEIGHT) => {
      const newId = Math.max(...Object.keys(get().floors).map(Number), -1) + 1;
      set((s) => ({
        floors: {
          ...s.floors,
          [newId]: { id: newId, name: name || `Floor ${newId}`, height },
        },
        isDirty: true,
      }));
      return newId;
    },

    /**
     * Set a floor's height (floor-to-floor). The floors above move with it
     * (their elevation is derived). Use editorHistory.setFloorHeight, which
     * also keeps the walls fitting.
     */
    setFloorHeight: (floorId, height) => {
      set((s) => {
        if (!s.floors[floorId]) return s;
        return { floors: { ...s.floors, [floorId]: { ...s.floors[floorId], height } }, isDirty: true };
      });
    },

    /**
     * Remove a floor and all rooms/objects on it. The ground floor (the lowest)
     * can't be removed: everything above would drop down a storey.
     */
    removeFloor: (floorId) => {
      set((s) => {
        if (!s.floors[floorId] || isGroundFloor(s.floors, floorId)) return s;

        const floors = { ...s.floors };
        delete floors[floorId];

        // Remove all rooms/objects on this floor
        const rooms = {};
        Object.values(s.rooms).forEach((r) => {
          if (r.floor !== floorId) rooms[r.id] = r;
        });

        const objects = {};
        Object.values(s.objects).forEach((o) => {
          if (o.floor !== floorId) objects[o.id] = o;
        });

        // If we deleted the current floor, switch to the ground floor
        const newCurrentFloor = s.currentFloor === floorId ? floorsInOrder(floors)[0].id : s.currentFloor;

        return {
          floors,
          rooms,
          objects,
          currentFloor: newCurrentFloor,
          selectedRoomId: null,
          selectedObjectId: null,
          isDirty: true,
        };
      });
    },

    /** Switch to a different floor. */
    selectFloor: (floorId) => {
      set({
        currentFloor: floorId,
        selectedRoomId: null,    // deselect when switching floors
        selectedObjectId: null,
        selectedOpening: null,
      });
    },

    /** Rename a floor. */
    renameFloor: (floorId, newName) => {
      set((s) => ({
        floors: {
          ...s.floors,
          [floorId]: { ...s.floors[floorId], name: newName },
        },
        isDirty: true,
      }));
    },

    // ──────────────────────────────────
    //  LAYOUT / TENANT ACTIONS
    // ──────────────────────────────────

    /** Set tenant context when loading a workspace. */
    setTenant: (companyId, layoutId, layoutName, version = 1) => {
      set({ companyId, layoutId, layoutName, layoutVersion: version });
    },

    /**
     * Load a full workspace snapshot (rooms + objects + floors). Saves from
     * older versions of the app are filled in with defaults (layoutData.js).
     */
    loadWorkspace: (data) => {
      const n = normaliseLayout(data);
      const roomMap = {};
      n.rooms.forEach((r) => { roomMap[r.id] = r; });
      const objMap = {};
      n.objects.forEach((o) => { objMap[o.id] = o; });

      set({
        floors: n.floors,
        currentFloor: 0,
        rooms: roomMap,
        objects: objMap,
        anchorData: n.anchorData,
        selectedRoomId: null,
        selectedObjectId: null,
        selectedOpening: null,
        isDirty: false,
        saveError: null,
        saveConflict: false,
      });
    },

    /** Export the current workspace as a serialisable snapshot. */
    exportWorkspace: () => {
      const s = get();
      return {
        companyId: s.companyId,
        layoutId: s.layoutId,
        layoutName: s.layoutName,
        layoutVersion: s.layoutVersion,
        floors: s.floors,
        rooms: Object.values(s.rooms).map(withoutSelection),
        objects: Object.values(s.objects).map(withoutSelection),
        anchorData: s.anchorData,
        exportedAt: new Date().toISOString(),
      };
    },

    /**
     * Set or clear data on one anchor. `patch` values of null/'' remove that key;
     * an anchor with nothing left is removed from anchorData.
     * Use editorHistory.setAnchorData (undoable) instead of calling this directly.
     */
    setAnchorData: (anchorId, patch) => {
      set((s) => {
        const next = { ...(s.anchorData[anchorId] ?? {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined || v === '') delete next[k];
          else next[k] = v;
        }
        const anchorData = { ...s.anchorData };
        if (Object.keys(next).length) anchorData[anchorId] = next;
        else delete anchorData[anchorId];
        return { anchorData, isDirty: true };
      });
    },

    /**
     * Replace floors/rooms/objects wholesale. Used by undo/redo of actions
     * that touch many records at once (e.g. deleting a floor, restoring a version).
     */
    replaceLayoutState: ({ floors, rooms, objects, currentFloor, anchorData }) => {
      set((st) => ({
        floors,
        rooms,
        objects,
        currentFloor: currentFloor ?? st.currentFloor,
        anchorData: anchorData ?? st.anchorData,
        selectedRoomId: null,
        selectedObjectId: null,
        selectedOpening: null,
        isDirty: true,
      }));
    },

    /** Mark workspace as saved (isDirty → false). */
    markSaved: () => set({ isDirty: false, saveError: null }),

    /** A save failed: keep isDirty so the next change retries, and say why. */
    markSaveFailed: (message) => set({ saveError: message || 'Could not save' }),

    /** Another tab saved this layout: our saves stop until the user reloads or saves a copy. */
    markSaveConflict: (message) => set({ saveConflict: true, saveError: message }),

    /** Whether this layout is also open in another tab (apiService watches the other tabs). */
    setOpenElsewhere: (flag) => set({ openElsewhere: !!flag }),

    /** Set after each save (apiService.storageUse): Studio asks to export and delete old layouts. */
    setStorageNearlyFull: (flag) => { if (get().storageNearlyFull !== !!flag) set({ storageNearlyFull: !!flag }); },

    /** R7: Sync status and pending offline queue count */
    setSyncStatus: (syncStatus) => set({ syncStatus }),
    setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),

    /** R8: Staging proposed layout from photo reconstruction */
    setProposedLayout: (proposedLayout) => set({
      proposedLayout,
      isReconstructing: false,
      reconstructionError: null,
    }),

    /** R8: Discard or clear proposed layout */
    clearProposedLayout: () => set({
      proposedLayout: null,
      reconstructionError: null,
    }),

    /** R8: Set reconstruction processing / error state */
    setReconstructing: (isReconstructing, error = null) => set({
      isReconstructing: !!isReconstructing,
      reconstructionError: error,
    }),

    /** Reset the entire store to initial state. */
    resetWorkspace: () => {
      set({
        companyId: null,
        layoutId: null,
        layoutName: 'New Workspace',
        layoutVersion: 1,
        isDirty: false,
        saveError: null,
        saveConflict: false,
        openElsewhere: false,
        syncStatus: 'online',
        pendingSyncCount: 0,
        proposedLayout: null,
        isReconstructing: false,
        reconstructionError: null,
        floors: { 0: { id: 0, name: 'Ground Floor', height: STOREY_HEIGHT } },
        currentFloor: 0,
        rooms: {},
        objects: {},
        anchorData: {},
        selectedRoomId: null,
        selectedObjectId: null,
        selectedOpening: null,
        activePanel: 'rooms',
        gizmoMode: null,
        placementMode: null,
        is3D: true,
      });
    },
  }))
);

/** The app's store: Workplace Studio and Preview edit the layout in it. */
export const useWorkspaceStore = createWorkspaceStore();

// ─── Convenience selectors ───

/** Array of all rooms. */
export const selectRooms       = (s) => Object.values(s.rooms);
/** Array of all objects. */
export const selectObjects     = (s) => Object.values(s.objects);
/** Currently selected room data or null. */
export const selectSelectedRoom   = (s) => s.selectedRoomId ? s.rooms[s.selectedRoomId] ?? null : null;
/** Currently selected object data or null. */
export const selectSelectedObject = (s) => s.selectedObjectId ? s.objects[s.selectedObjectId] ?? null : null;
/** Room count. */
export const selectRoomCount   = (s) => Object.keys(s.rooms).length;
/** Object count. */
export const selectObjectCount = (s) => Object.keys(s.objects).length;

// ─── Phase 5: Floor-aware selectors ───

/** Array of rooms on the current floor only. */
export const selectCurrentFloorRooms = (s) =>
  Object.values(s.rooms).filter((r) => r.floor === s.currentFloor);

/** Array of objects on the current floor only. */
export const selectCurrentFloorObjects = (s) =>
  Object.values(s.objects).filter((o) => o.floor === s.currentFloor);

/** Room count on current floor. */
export const selectCurrentFloorRoomCount = (s) =>
  Object.values(s.rooms).filter((r) => r.floor === s.currentFloor).length;

/** Object count on current floor. */
export const selectCurrentFloorObjectCount = (s) =>
  Object.values(s.objects).filter((o) => o.floor === s.currentFloor).length;

/** Array of all floors sorted by ID. */
export const selectFloorsSorted = (s) =>
  Object.values(s.floors).sort((a, b) => a.id - b.id);

