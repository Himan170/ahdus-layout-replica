/**
 * roomStore.js
 *
 * Manages the state of all rooms in the digital workplace.
 * Each room is a plain JS object describing its type, position, dimensions,
 * and connections. The store is a simple event-emitting class so both
 * React components and Babylon.js utilities can subscribe to changes.
 *
 * In Phase 4 this will be replaced/wrapped by Zustand, but for now a
 * lightweight custom store keeps dependencies minimal.
 */

// ─── Room type catalogue ───
export const ROOM_TYPES = {
  OFFICE:       { label: 'Office',          color: '#4a7dff', defaultW: 6, defaultD: 5 },
  MEETING:      { label: 'Meeting Room',    color: '#38b764', defaultW: 5, defaultD: 4 },
  RECEPTION:    { label: 'Reception',       color: '#f5a623', defaultW: 8, defaultD: 6 },
  CORRIDOR:     { label: 'Corridor',        color: '#8899aa', defaultW: 10, defaultD: 2 },
  PRODUCTION:   { label: 'Production Area', color: '#e05252', defaultW: 10, defaultD: 8 },
  STAIRCASE:    { label: 'Staircase',       color: '#9b59b6', defaultW: 3, defaultD: 3 },
  SERVER_ROOM:  { label: 'Server Room',     color: '#1abc9c', defaultW: 4, defaultD: 4 },
  RESTROOM:     { label: 'Restroom',        color: '#95a5a6', defaultW: 3, defaultD: 3 },
};

// ─── Unique ID generator ───
let _nextId = 1;
function generateId() {
  return `room_${_nextId++}`;
}

/**
 * Create a new room data object.
 *
 * @param {Object} opts
 * @param {string} opts.type  - key from ROOM_TYPES (e.g. 'OFFICE')
 * @param {string} [opts.name] - display name (auto-generated if omitted)
 * @param {number} opts.x     - center X position on the grid
 * @param {number} opts.z     - center Z position on the grid
 * @param {number} [opts.width]  - room width (X axis), defaults from type
 * @param {number} [opts.depth]  - room depth (Z axis), defaults from type
 * @param {number} [opts.wallHeight] - wall height (Y axis), default 3
 * @returns {Object} room data object
 */
export function createRoomData({
  type = 'OFFICE',
  name,
  x = 0,
  z = 0,
  width,
  depth,
  wallHeight = 3,
} = {}) {
  const typeDef = ROOM_TYPES[type] || ROOM_TYPES.OFFICE;
  const id = generateId();

  return {
    id,
    type,
    name: name || `${typeDef.label} ${_nextId - 1}`,
    x,
    z,
    width: width ?? typeDef.defaultW,
    depth: depth ?? typeDef.defaultD,
    wallHeight,
    doors: [],        // { wall: 'north'|'south'|'east'|'west', offset: number, width: 1.2 }
    color: typeDef.color,
    isSelected: false,
  };
}

// ─── Room Store ───
class RoomStore {
  constructor() {
    /** @type {Map<string, Object>} */
    this.rooms = new Map();
    /** @type {Set<Function>} */
    this._listeners = new Set();
    this._selectedId = null;
  }

  // ── Subscribe / Unsubscribe ──
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    const snapshot = this.getSnapshot();
    this._listeners.forEach((fn) => fn(snapshot));
  }

  // ── Read ──
  getSnapshot() {
    return {
      rooms: Array.from(this.rooms.values()),
      selectedId: this._selectedId,
    };
  }

  getRoom(id) {
    return this.rooms.get(id) ?? null;
  }

  getSelectedRoom() {
    return this._selectedId ? this.rooms.get(this._selectedId) ?? null : null;
  }

  /** Return all rooms as an array. */
  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  // ── Write ──

  /** Add a room and notify listeners. Returns the created room. */
  addRoom(opts) {
    const room = createRoomData(opts);
    this.rooms.set(room.id, room);
    this.selectRoom(room.id);
    this._notify();
    return room;
  }

  /** Update fields on an existing room. */
  updateRoom(id, patch) {
    const room = this.rooms.get(id);
    if (!room) return;
    Object.assign(room, patch);
    this._notify();
  }

  /** Remove a room by ID. */
  removeRoom(id) {
    this.rooms.delete(id);
    if (this._selectedId === id) this._selectedId = null;
    this._notify();
  }

  /** Select a room (deselects the previous one). */
  selectRoom(id) {
    // Deselect old
    if (this._selectedId && this.rooms.has(this._selectedId)) {
      this.rooms.get(this._selectedId).isSelected = false;
    }
    this._selectedId = id;
    if (id && this.rooms.has(id)) {
      this.rooms.get(id).isSelected = true;
    }
    this._notify();
  }

  /** Clear all rooms. */
  clear() {
    this.rooms.clear();
    this._selectedId = null;
    this._notify();
  }

  // ── Expansion helpers ──

  /**
   * Calculate where a new room should go when expanding in a direction
   * from the currently selected room.
   *
   * @param {'left'|'right'|'top'|'bottom'} direction
   * @param {string} newType - ROOM_TYPES key for the new room
   * @returns {{ x: number, z: number }} center position of the new room
   */
  getExpansionPosition(direction, newType = 'OFFICE') {
    const selected = this.getSelectedRoom();
    if (!selected) return { x: 0, z: 0 };

    const typeDef = ROOM_TYPES[newType] || ROOM_TYPES.OFFICE;
    const newW = typeDef.defaultW;
    const newD = typeDef.defaultD;
    const gap = 0.2; // small gap so walls don't z-fight

    switch (direction) {
      case 'right':
        return {
          x: selected.x + selected.width / 2 + newW / 2 + gap,
          z: selected.z,
        };
      case 'left':
        return {
          x: selected.x - selected.width / 2 - newW / 2 - gap,
          z: selected.z,
        };
      case 'top': // "top" = positive Z in our coordinate system
        return {
          x: selected.x,
          z: selected.z + selected.depth / 2 + newD / 2 + gap,
        };
      case 'bottom':
        return {
          x: selected.x,
          z: selected.z - selected.depth / 2 - newD / 2 - gap,
        };
      default:
        return { x: selected.x, z: selected.z };
    }
  }
}

// Singleton instance — shared across the app.
export const roomStore = new RoomStore();
