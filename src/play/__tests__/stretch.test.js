import { describe, it, expect } from 'vitest';
import { stretchRoom, wallCoordinate, WALL_THICKNESS } from '../geometry';

// Office: x -3..3, z -2.5..2.5
const office = () => ({
  id: 'room_1', name: 'Office 1', floor: 0, x: 0, z: 0, width: 6, depth: 5,
  doors: [], windows: [],
});

describe('stretchRoom', () => {
  it('pushing the north wall out grows the room and keeps the south wall still', () => {
    const r = stretchRoom(office(), 'north', 4.5);
    expect(r.problem).toBeNull();
    expect(r.rect).toEqual({ x: 0, z: 1, width: 6, depth: 7 });
    expect(r.delta).toBeCloseTo(2);
    expect(r.rect.z - r.rect.depth / 2).toBeCloseTo(-2.5);
  });

  it('stretches a wall out to a 200 m hall, not further', () => {
    const big = stretchRoom(office(), 'east', 197);
    expect(big.problem).toBeNull();
    expect(big.rect.width).toBeCloseTo(200);
    expect(stretchRoom(office(), 'east', 198).problem).toBe('Too big (rooms are at most 200 m)');
  });

  it('pulling the east wall in shrinks the room (negative delta)', () => {
    const r = stretchRoom(office(), 'east', 1);
    expect(r.problem).toBeNull();
    expect(r.rect).toEqual({ x: -1, z: 0, width: 4, depth: 5 });
    expect(r.delta).toBeCloseTo(-2);
  });

  it('west and south walls move the right way', () => {
    expect(stretchRoom(office(), 'west', -5).rect).toEqual({ x: -1, z: 0, width: 8, depth: 5 });
    expect(stretchRoom(office(), 'south', -4).rect).toEqual({ x: 0, z: -0.75, width: 6, depth: 6.5 });
    expect(stretchRoom(office(), 'west', -5).delta).toBeCloseTo(2);
  });

  it('refuses to make a room smaller than 1.5 m', () => {
    expect(stretchRoom(office(), 'east', -2).problem).toMatch(/Too small/);
  });

  it('refuses to overlap another room', () => {
    const meeting = { id: 'room_2', name: 'Meeting 1', floor: 0, x: 8, z: 0, width: 4, depth: 5 };
    // meeting spans x 6..10; pushing east wall to 8 would overlap
    const r = stretchRoom(office(), 'east', 8, { rooms: [office(), meeting] });
    expect(r.problem).toBe('Would overlap Meeting 1');
  });

  it('resizes a nested room without snapping its wall to the enclosing room exterior', () => {
    const parent = { id: 'office', name: 'Office', floor: 0, x: 0, z: 0, width: 12, depth: 10 };
    const nested = { id: 'meeting', name: 'Meeting', floor: 0, x: 0, z: 0, width: 4, depth: 3 };
    const resized = stretchRoom(nested, 'east', 4, { rooms: [parent, nested] });
    expect(resized.problem).toBeNull();
    expect(resized.rect).toEqual({ x: 1, z: 0, width: 6, depth: 3 });
  });

  it('rejects a nested room resize that exceeds the enclosing room interior', () => {
    const parent = { id: 'office', name: 'Office', floor: 0, x: 0, z: 0, width: 12, depth: 10 };
    const nested = { id: 'meeting', name: 'Meeting', floor: 0, x: 0, z: 0, width: 4, depth: 3 };
    const resized = stretchRoom(nested, 'east', 6.5, { rooms: [parent, nested] });
    expect(resized.problem).toBe('Would overlap Office');
    expect(resized.rect.x).toBeCloseTo(2.25);
    expect(resized.rect.width).toBeCloseTo(8.5);
  });

  it('released near a neighbour, the wall lands exactly back-to-back', () => {
    const meeting = { id: 'room_2', name: 'Meeting 1', floor: 0, x: 8, z: 0, width: 4, depth: 5 };
    const r = stretchRoom(office(), 'east', 6, { rooms: [meeting] });
    expect(r.problem).toBeNull();
    expect(wallCoordinate({ ...office(), ...r.patch }, 'east')).toBeCloseTo(6 - WALL_THICKNESS);
  });

  it('rooms on other floors do not block', () => {
    const upstairs = { id: 'room_9', name: 'Up', floor: 1, x: 0, z: 6, width: 6, depth: 4 };
    expect(stretchRoom(office(), 'north', 6, { rooms: [upstairs] }).problem).toBeNull();
  });

  it('doors on the side walls stay in the same place in the world', () => {
    const room = { ...office(), doors: [{ wall: 'east', offset: -1, width: 1 }, { wall: 'north', offset: 2, width: 1 }] };
    const r = stretchRoom(room, 'north', 4.5); // centre moves from z=0 to z=1
    const east = r.patch.doors.find((d) => d.wall === 'east');
    const north = r.patch.doors.find((d) => d.wall === 'north');
    expect(r.rect.z + east.offset).toBeCloseTo(-1); // same world Z as before
    expect(north.offset).toBe(2);                     // rides along with the moved wall
  });

  it('cannot pull a wall through a door on a side wall', () => {
    const room = { ...office(), windows: [{ wall: 'north', offset: 2, width: 1.4 }] };
    expect(stretchRoom(room, 'east', 1.5).problem).toBe('The window on the north wall is in the way');
  });

  it('cannot pull a wall through furniture that belongs to the room', () => {
    const desk = { id: 'obj_1', roomId: 'room_1', x: 2.5, z: 0, label: 'Desk A' };
    const r = stretchRoom(office(), 'east', 1, { objects: [desk] });
    expect(r.problem).toBe('Desk A is in the way');
    // growing is fine even with furniture
    expect(stretchRoom(office(), 'east', 5, { objects: [desk] }).problem).toBeNull();
  });

  it('patch keeps everything updateRoom needs', () => {
    const r = stretchRoom({ ...office(), doors: [{ wall: 'south', offset: 0 }] }, 'east', 4);
    expect(Object.keys(r.patch).sort()).toEqual(['depth', 'doors', 'width', 'windows', 'x', 'z']);
  });
});
