import { describe, it, expect } from 'vitest';
import {
  WALL_THICKNESS, wallThicknessOf, planWallThickness, roomContainedBy, roomWallSegments, roomWalls,
  snapRoomRect, partnerWall, roomsToRebuild, sharedWallThickness,
} from '../geometry';
import { copyRoomsUp } from '../building';
import { normaliseLayout } from '../../store/layoutData';

// Office: x -3..3, z -2.5..2.5
const office = (extra = {}) => ({
  id: 'room_1', name: 'Office', floor: 0, x: 0, z: 0, width: 6, depth: 5, wallHeight: 3.2, doors: [], windows: [], ...extra,
});

describe('wall thickness per room', () => {
  it('rooms without one (old saves, drawn rectangles) have 0.15 m walls; out-of-range values too', () => {
    expect(wallThicknessOf({})).toBe(WALL_THICKNESS);
    expect(wallThicknessOf({ wallThickness: 0.3 })).toBe(0.3);
    expect(wallThicknessOf({ wallThickness: 2 })).toBe(WALL_THICKNESS);
    expect(wallThicknessOf({ wallThickness: 'thick' })).toBe(WALL_THICKNESS);
  });

  it('the walls are as thick as the room says, centred on its edge (corners closed)', () => {
    const walls = roomWalls(office({ wallThickness: 0.4 }));
    expect(walls.find((w) => w.name === 'north').length).toBeCloseTo(6.4);
    expect(walls.find((w) => w.name === 'east').length).toBeCloseTo(4.6);
  });

  it('old saves get 0.15 m when they load; a saved thickness is kept', () => {
    const n = normaliseLayout({ rooms: [{ id: 'a', x: 0, z: 0, width: 4, depth: 4 }, { id: 'b', wallThickness: 0.3 }] });
    expect(n.rooms.map((r) => r.wallThickness)).toEqual([0.15, 0.3]);
  });

  it('copying rooms to a new floor keeps their thickness', () => {
    expect(copyRoomsUp([office({ wallThickness: 0.45 })], 0, 1)[0].wallThickness).toBe(0.45);
    expect(copyRoomsUp([office()], 0, 1)[0].wallThickness).toBe(WALL_THICKNESS);
  });
});

describe('shared walls with different thicknesses', () => {
  const west = office({ id: 'a', wallThickness: 0.15 });
  const east = (gap, t) => office({ id: 'b', name: 'Store', x: 6 + gap, wallThickness: t }); // west edge at 3 + gap

  it('the shared wall is as thick as the thicker of the two, centred between them', () => {
    expect(sharedWallThickness(west, east(0.3, 0.3))).toBe(0.3);
    const [seg] = roomWallSegments(west, 'east', [west, east(0.3, 0.3)]).filter((s) => s.shared);
    expect(seg.thickness).toBeCloseTo(0.3);
    expect(seg.worldValue).toBeCloseTo(3.15);
  });

  it('making one room thicker keeps the wall shared (and a door through it on both rooms)', () => {
    const thicker = east(0.15, 0.5); // still 0.15 apart
    expect(roomWallSegments(west, 'east', [west, thicker]).filter((s) => s.shared)[0].thickness).toBeCloseTo(0.5);
    expect(partnerWall([west, thicker], west, 'east', { x: 3, z: 0 }, 1)?.room.id).toBe('b');
  });

  it('drawing next to a room snaps back to back at the thicker wall', () => {
    const rect = snapRoomRect({ x: 6.2, z: 0, width: 6, depth: 5, floor: 0, wallThickness: 0.4 }, [west]);
    expect(rect.x - rect.width / 2).toBeCloseTo(3.4);
    const thin = snapRoomRect({ x: 6.2, z: 0, width: 6, depth: 5, floor: 0 }, [west]);
    expect(thin.x - thin.width / 2).toBeCloseTo(3.15); // today's 0.15 m
  });

  it('a thickness change rebuilds the room and its neighbours', () => {
    const before = [west, east(0.15, 0.15)];
    const after = [office({ id: 'a', wallThickness: 0.3 }), east(0.15, 0.15)];
    expect([...roomsToRebuild(before, after)].sort()).toEqual(['a', 'b']);
  });
});

describe('nested rooms with different thicknesses', () => {
  const hall = office({ id: 'hall', name: 'Hall', width: 20, depth: 20 });
  const booth = (x, t) => ({ id: 'booth', name: 'Booth', floor: 0, x, z: 0, width: 4, depth: 4, wallThickness: t });

  it('an inner room keeps half of each wall clear of the outer wall', () => {
    // hall east wall at 10, booth east edge at x + 2
    expect(roomContainedBy(hall, booth(7.85, 0.15))).toBe(true);           // 0.15 clear: (0.15 + 0.15) / 2
    expect(roomContainedBy({ ...hall, wallThickness: 0.5 }, booth(7.85, 0.15))).toBe(false); // needs 0.325
    expect(roomContainedBy({ ...hall, wallThickness: 0.5 }, booth(7.6, 0.15))).toBe(true);
    expect(roomContainedBy({ ...hall, wallThickness: 0.6 }, booth(8, 0.15))).toBe(true);     // standing on the wall
  });

  it("standing on the outer wall: that stretch is built as thick as the outer room's walls", () => {
    const outer = { ...hall, wallThickness: 0.5 };
    const inner = booth(8, 0.15);
    const own = roomWallSegments(inner, 'east', [outer, inner]);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((s) => s.sameSide && Math.abs(s.thickness - 0.5) < 1e-9)).toBe(true);
    // its north wall stops at the outer wall's inside face (10 - 0.25)
    const north = roomWallSegments(inner, 'north', [outer, inner]);
    expect(Math.max(...north.map((s) => s.u1)) + inner.x).toBeCloseTo(9.75);
  });

  it('planWallThickness: limits, rooms inside, the room it stands in', () => {
    expect(planWallThickness(hall, 0.05, [hall]).problem).toBe('Walls are 0.10 to 0.60 m thick');
    expect(planWallThickness(hall, 0.7, [hall]).problem).toBe('Walls are 0.10 to 0.60 m thick');
    expect(planWallThickness(hall, 0.333, [hall])).toEqual({ problem: null, thickness: 0.33 });
    const b = booth(7.85, 0.15);
    expect(planWallThickness(hall, 0.5, [hall, b]).problem).toBe('Too thick: it would run into Booth');
    expect(planWallThickness(b, 0.5, [hall, b]).problem).toBe('Too thick: it would run into Hall');
    expect(planWallThickness(b, 0.1, [hall, b]).problem).toBeNull();
  });

  it('planWallThickness: an item of the room that would end up in the wall is in the way (only when thicker)', () => {
    const desk = { id: 'obj_1', roomId: 'room_1', label: 'Desk', x: 2.75, z: 0 }; // 0.25 m from the east edge
    expect(planWallThickness(office(), 0.3, [office()], [desk]).problem).toBeNull();
    expect(planWallThickness(office(), 0.5, [office()], [desk]).problem).toBe('Desk is in the way');
    const thick = office({ wallThickness: 0.6 });
    expect(planWallThickness(thick, 0.5, [thick], [desk]).problem).toBeNull();
  });
});
