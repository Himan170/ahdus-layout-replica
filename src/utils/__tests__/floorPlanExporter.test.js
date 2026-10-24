// @vitest-environment jsdom
/**
 * utils/__tests__/floorPlanExporter.test.js
 *
 * Unit tests for the floor plan exporter.
 *
 * jsdom does not implement the Canvas 2D API (getContext returns null).
 * We provide a minimal mock via vi.spyOn so we can test the pure-data
 * logic (bounds, null-floor, floor isolation) without needing the full
 * browser painting stack.  The drawing tests simply verify that the
 * function does not throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderFloorPlanToCanvas } from '../floorPlanExporter';

// ── Canvas mock ───────────────────────────────────────────────────────────

/**
 * Minimal CanvasRenderingContext2D stand-in that tracks calls without
 * implementing actual drawing.  Every method is a no-op stub.
 */
function makeCtxMock() {
  const noop = () => {};
  const calls = { fills: [], texts: [], rotations: [], arcs: [] };
  return {
    calls,
    // State
    fillStyle:   '',
    strokeStyle: '',
    lineWidth:   1,
    font:        '',
    textAlign:   '',
    textBaseline:'',
    globalAlpha: 1,
    lineJoin:    '',
    // Methods used by the exporter
    fillRect(...rect) { calls.fills.push({ rect, fillStyle: this.fillStyle }); },
    strokeRect:  noop,
    clearRect:   noop,
    fillText(text) { calls.texts.push(text); },
    beginPath:   noop,
    moveTo:      noop,
    lineTo:      noop,
    arc(...args) { calls.arcs.push(args); },
    rect:        noop,
    closePath:   noop,
    fill:        noop,
    stroke:      noop,
    save:        noop,
    restore:     noop,
    translate:   noop,
    rotate(angle) { calls.rotations.push(angle); },
    clip:        noop,
  };
}

let ctxMock;

beforeEach(() => {
  ctxMock = makeCtxMock();
  // Patch every canvas created during the test to return our stub context
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxMock);
});

// ── Helpers ───────────────────────────────────────────────────────────────

const FLOOR_ID = 0;
const FLOORS   = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };

function makeRoom(overrides = {}) {
  return {
    id:         'room_1',
    floor:      FLOOR_ID,
    name:       'Office 1',
    type:       'OFFICE',
    x:          0,
    z:          0,
    width:      6,
    depth:      5,
    wallHeight: 3,
    color:      '#4a7dff',
    doors:      [],
    windows:    [],
    ...overrides,
  };
}

function makeRooms(arr) {
  const map = {};
  arr.forEach((r) => { map[r.id] = r; });
  return map;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('renderFloorPlanToCanvas', () => {
  it('returns null when no rooms exist on the floor', () => {
    const canvas = renderFloorPlanToCanvas({
      rooms: {},
      floors: FLOORS,
      floorId: FLOOR_ID,
      floorName: 'Ground Floor',
    });
    expect(canvas).toBeNull();
  });

  it('returns null when no rooms are on the requested floor', () => {
    const rooms = makeRooms([makeRoom({ floor: 1 })]);
    const canvas = renderFloorPlanToCanvas({
      rooms,
      floors: FLOORS,
      floorId: FLOOR_ID,
      floorName: 'Ground Floor',
    });
    expect(canvas).toBeNull();
  });

  it('returns an HTMLCanvasElement for a single room', () => {
    const rooms  = makeRooms([makeRoom()]);
    const canvas = renderFloorPlanToCanvas({
      rooms,
      floors:    FLOORS,
      floorId:   FLOOR_ID,
      floorName: 'Ground Floor',
    });
    expect(canvas).not.toBeNull();
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('canvas dimensions increase with a larger floor plan', () => {
    const small = makeRoom({ id: 'small', width: 3, depth: 3 });
    const large = makeRoom({ id: 'large', width: 20, depth: 15 });

    const c1 = renderFloorPlanToCanvas({ rooms: makeRooms([small]), floors: FLOORS, floorId: FLOOR_ID });
    const c2 = renderFloorPlanToCanvas({ rooms: makeRooms([large]), floors: FLOORS, floorId: FLOOR_ID });

    expect(c2.width).toBeGreaterThan(c1.width);
    expect(c2.height).toBeGreaterThan(c1.height);
  });

  it('handles a multi-room floor without throwing', () => {
    const rooms = makeRooms([
      makeRoom({ id: 'room_1', x: 0,  z: 0,  width: 6, depth: 5 }),
      makeRoom({ id: 'room_2', x: 8,  z: 0,  width: 4, depth: 4, name: 'Meeting Room 1', type: 'MEETING', color: '#38b764' }),
      makeRoom({ id: 'room_3', x: 0,  z: -6, width: 5, depth: 3, name: 'Corridor 1',    type: 'CORRIDOR', color: '#8899aa' }),
    ]);
    const canvas = renderFloorPlanToCanvas({
      rooms,
      floors:    FLOORS,
      floorId:   FLOOR_ID,
      floorName: 'Ground Floor',
    });
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBeGreaterThan(0);
  });

  it('renders rooms with doors without throwing', () => {
    const room = makeRoom({
      doors: [
        { wall: 'north', offset: 0, width: 1.0, height: 2.1 },
        { wall: 'east',  offset: 0, width: 0.9, height: 2.1 },
      ],
    });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('renders rooms with windows without throwing', () => {
    const room = makeRoom({
      windows: [
        { wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
        { wall: 'west',  offset: 0, width: 1.2, height: 1.0, sill: 0.9 },
      ],
    });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('handles rooms without a name gracefully', () => {
    const room = makeRoom({ name: '' });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('handles rooms with an unknown type', () => {
    const room = makeRoom({ type: 'UNKNOWN_TYPE', color: '#999999' });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('handles very small rooms (minimum size)', () => {
    const room = makeRoom({ width: 1.5, depth: 1.5 });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('handles a very large floor plan without crashing', () => {
    const rooms = makeRooms([
      makeRoom({ id: 'room_1', x: 0,  z: 0, width: 50, depth: 30 }),
      makeRoom({ id: 'room_2', x: 60, z: 0, width: 20, depth: 10, name: 'Wing B', color: '#38b764' }),
    ]);
    const canvas = renderFloorPlanToCanvas({
      rooms,
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
    // Maximum sane canvas dimension: 16384 px (Chrome limit)
    expect(canvas.width).toBeLessThan(16384);
    expect(canvas.height).toBeLessThan(16384);
  });

  it('only draws rooms from the requested floor', () => {
    const FLOORS2 = {
      0: FLOORS[0],
      1: { id: 1, name: 'Floor 1', height: 3.5 },
    };
    const rooms = makeRooms([
      makeRoom({ id: 'room_g', floor: 0, width: 6,  depth: 5  }),
      makeRoom({ id: 'room_1', floor: 1, width: 30, depth: 30 }), // much larger
    ]);

    const c0 = renderFloorPlanToCanvas({ rooms, floors: FLOORS2, floorId: 0 });
    const c1 = renderFloorPlanToCanvas({ rooms, floors: FLOORS2, floorId: 1 });

    expect(c0).not.toBeNull();
    expect(c1).not.toBeNull();
    // Floor 1 has a much bigger room → wider canvas
    expect(c1.width).toBeGreaterThan(c0.width);
  });

  it('renders all 8 room types without throwing', () => {
    const types = ['OFFICE','MEETING','RECEPTION','CORRIDOR','PRODUCTION','STAIRCASE','SERVER_ROOM','RESTROOM'];
    types.forEach((type, i) => {
      const room = makeRoom({ id: `room_${i}`, type, x: i * 8, z: 0 });
      const canvas = renderFloorPlanToCanvas({
        rooms:   makeRooms([room]),
        floors:  FLOORS,
        floorId: FLOOR_ID,
      });
      expect(canvas).not.toBeNull();
    });

  });

  it('renders doors on all four walls without throwing', () => {
    const room = makeRoom({
      doors: [
        { wall: 'north', offset: 0, width: 1.0, height: 2.1 },
        { wall: 'south', offset: 0, width: 1.0, height: 2.1 },
        { wall: 'east',  offset: 0, width: 1.0, height: 2.1 },
        { wall: 'west',  offset: 0, width: 1.0, height: 2.1 },
      ],
    });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('renders windows on all four walls without throwing', () => {
    const room = makeRoom({
      windows: [
        { wall: 'north', offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
        { wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
        { wall: 'east',  offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
        { wall: 'west',  offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
      ],
    });
    const canvas = renderFloorPlanToCanvas({
      rooms:   makeRooms([room]),
      floors:  FLOORS,
      floorId: FLOOR_ID,
    });
    expect(canvas).not.toBeNull();
  });

  it('preserves room fill colors and draws room labels and dimensions', () => {
    const rooms = makeRooms([
      makeRoom({ id: 'office', name: 'Office 1', color: '#4a7dff' }),
      makeRoom({ id: 'meeting', name: 'Meeting 1', type: 'MEETING', color: '#38b764', x: 8 }),
    ]);
    const canvas = renderFloorPlanToCanvas({
      rooms,
      floors: FLOORS,
      floorId: FLOOR_ID,
    });

    expect(ctxMock.calls.fills[1].fillStyle).toBe('rgba(137,171,255,0.8)');
    expect(ctxMock.calls.fills[2].fillStyle).toBe('rgba(126,208,154,0.8)');
    expect(ctxMock.calls.texts).toContain('Office 1');
    expect(ctxMock.calls.texts).toContain('Meeting 1');
    expect(ctxMock.calls.texts).toContain('6.0 × 5.0 m');
    expect(canvas).not.toBeNull();
  });

  it('keeps scaled large-plan geometry inside the canvas', () => {
    const room = makeRoom({ width: 200, depth: 120 });
    const canvas = renderFloorPlanToCanvas({
      rooms: makeRooms([room]),
      floors: FLOORS,
      floorId: FLOOR_ID,
    });
    const roomFill = ctxMock.calls.fills[1].rect;

    expect(canvas.width).toBeLessThanOrEqual(8192);
    expect(roomFill[0]).toBeGreaterThanOrEqual(0);
    expect(roomFill[1]).toBeGreaterThanOrEqual(0);
    expect(roomFill[0] + roomFill[2]).toBeLessThanOrEqual(canvas.width);
    expect(roomFill[1] + roomFill[3]).toBeLessThanOrEqual(canvas.height);
  });

  it('includes current-floor objects in the export bounds and drawing', () => {
    const object = {
      id: 'desk_1',
      assetType: 'DESK_STANDARD',
      floor: FLOOR_ID,
      x: 12,
      z: 0,
      rotationY: Math.PI / 4,
      scaleX: 1,
      scaleZ: 1,
    };
    const canvas = renderFloorPlanToCanvas({
      rooms: makeRooms([makeRoom()]),
      objects: { [object.id]: object },
      floors: FLOORS,
      floorId: FLOOR_ID,
    });

    expect(canvas.width).toBeGreaterThan(1200);
    expect(ctxMock.calls.rotations).toContain(Math.PI / 4);
  });
});
