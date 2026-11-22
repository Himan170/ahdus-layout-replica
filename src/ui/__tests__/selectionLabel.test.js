import { describe, it, expect } from 'vitest';
import { selectionLabel } from '../selectionLabel';
import { ASSET_TYPES } from '../../utils/assetCatalog';
import { ROOM_TYPES } from '../../utils/roomStore';

const C = { catalog: ASSET_TYPES, roomTypes: ROOM_TYPES };

describe('selectionLabel (v0.18.9): what the selection bar says first', () => {
  it('an item: its type; with a name of its own, the name and its type', () => {
    expect(selectionLabel({ object: { assetType: 'CHAIR_OFFICE' }, ...C })).toEqual({ name: 'Office Chair', type: null });
    expect(selectionLabel({ object: { assetType: 'CHAIR_OFFICE', label: '  Front   chair ' }, ...C })).toEqual({ name: 'Front chair', type: 'Office Chair' });
    expect(selectionLabel({ object: { assetType: 'CHAIR_OFFICE', label: 'office chair' }, ...C }).type).toBeNull();
    expect(selectionLabel({ object: { assetType: 'WALL_SEGMENT' }, ...C }).name).toBe('Wall');
    expect(selectionLabel({ object: { assetType: 'SOMETHING_NEW' }, ...C }).name).toBe('Item');
  });

  it('a room: its name and type', () => {
    expect(selectionLabel({ room: { name: 'Team office', type: 'OFFICE' }, ...C })).toEqual({ name: 'Team office', type: 'Office' });
    expect(selectionLabel({ room: { name: '', type: 'MEETING' }, ...C })).toEqual({ name: 'Meeting Room', type: null });
  });

  it('a long name is cut; text stays text', () => {
    const { name } = selectionLabel({ object: { assetType: 'DESK', label: `<b>${'x'.repeat(100)}</b>` }, ...C });
    expect(name.length).toBe(60);
    expect(name.startsWith('<b>')).toBe(true); // shown as text, never as HTML
    expect(selectionLabel({})).toEqual({ name: '', type: null });
  });
});
