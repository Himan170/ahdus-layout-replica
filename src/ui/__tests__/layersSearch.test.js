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

  it('the group card counts items by kind, most first', () => {
    expect(groupSummary([
      { assetType: 'CHAIR_OFFICE' }, { assetType: 'DESK_STANDARD' }, { assetType: 'CHAIR_OFFICE' },
    ])).toEqual([['Office Chair', 2], ['Standard Desk', 1]]);
  });
});
