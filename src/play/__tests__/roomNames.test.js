// v0.17.2: a room's type shown only when it differs from its name (play/roomNames.js).
import { describe, it, expect } from 'vitest';
import { typeRepeatsName, roomTypeShown } from '../roomNames';

describe('typeRepeatsName', () => {
  it('repeats', () => {
    for (const [name, type] of [
      ['Corridor', 'Corridor'], ['Stairs', 'Staircase'], ['Main Corridor', 'Corridor'], ['Meeting Room 2', 'Meeting room'],
      ['Server Room', 'Server room'], ['Lobby & Reception', 'Reception'], ["Dhruv's office", 'Office'],
      ['Offices', 'Office'], ['Washroom', 'Washroom'], ['Corridor', ''], ['Hall', 'Room'],
    ]) expect(typeRepeatsName(name, type), `${name} · ${type}`).toBe(true);
  });

  it('says something new', () => {
    for (const [name, type] of [
      ['Washroom', 'Restroom'], ['Board Room', 'Meeting room'], ['Kitchen', 'Pantry'], ['Sales', 'Office'],
      ['Server', 'Server room · Lab'], ['Lab', 'Laboratory 2'],
    ]) expect(typeRepeatsName(name, type), `${name} · ${type}`).toBe(false);
  });

  it('roomTypeShown: the label, or empty', () => {
    expect(roomTypeShown('Stairs', 'Staircase')).toBe('');
    expect(roomTypeShown('Sales', 'Office')).toBe('Office');
    expect(roomTypeShown('Sales', undefined)).toBe('');
  });
});
