import { describe, it, expect } from 'vitest';
import { matchesLayerQuery, groupSummary } from '../Inspector';

describe('Layers search (v0.15.5)', () => {
  it('every word must start a word of the name, type or room', () => {
    expect(matchesLayerQuery('Standard Desk Open Workspace', 'desk')).toBe(true);
    expect(matchesLayerQuery('Standard Desk Open Workspace', 'desk open')).toBe(true);
    expect(matchesLayerQuery('Standard Desk Open Workspace', 'desk storage')).toBe(false);
    expect(matchesLayerQuery('Office Chair Reception', 'CH')).toBe(true);
  });

  it('3+ letters also match inside a word; an empty query matches everything', () => {
    expect(matchesLayerQuery('Whiteboard', 'board')).toBe(true);
    expect(matchesLayerQuery('Whiteboard', 'bo')).toBe(false);
    expect(matchesLayerQuery('Anything', '   ')).toBe(true);
    expect(matchesLayerQuery(undefined, 'x')).toBe(false);
  });

  it('v0.18.5: names with a dot, a dash or a slash are found as typed', () => {
    const room = 'Meeting Room 0.2 Meeting Room';
    expect(matchesLayerQuery(room, 'Meeting Room 0.2')).toBe(true);
    expect(matchesLayerQuery(room, '0.2')).toBe(true);
    expect(matchesLayerQuery(room, '0.1')).toBe(false);
    expect(matchesLayerQuery('Meeting Room 0.1 Meeting Room', 'Meeting Room 0.2')).toBe(false);
    expect(matchesLayerQuery('Floor-1 Kitchen', 'floor-1')).toBe(true);
    expect(matchesLayerQuery('R&D / QA Lab', 'r&d')).toBe(true);
    expect(matchesLayerQuery('Data & AI Office', 'data & ai')).toBe(true); // a lone "&" asks for nothing
    expect(matchesLayerQuery('Sales', 'sales.')).toBe(true); // a trailing dot too
  });

  it('the group card counts items by kind, most first', () => {
    expect(groupSummary([
      { assetType: 'CHAIR_OFFICE' }, { assetType: 'DESK_STANDARD' }, { assetType: 'CHAIR_OFFICE' },
    ])).toEqual([['Office Chair', 2], ['Standard Desk', 1]]);
  });
});
