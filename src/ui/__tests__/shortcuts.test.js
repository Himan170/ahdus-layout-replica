// One way to move and turn (v0.15.1): the Shortcuts list names the keys Studio uses.
import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, STUDIO_TOOLS } from '../tools';

const keysOf = (title) => SHORTCUT_GROUPS.find((g) => g.title === title).keys.map(([k, what]) => [k.join('+'), what]);

describe('Studio shortcuts', () => {
  it('R turns 90°, Shift+R 15°, S resizes, W shows the arrows, F focuses; E is gone', () => {
    const item = Object.fromEntries(keysOf('Selected item'));
    expect(item.R).toMatch(/Turn 90°/);
    expect(item['Shift+R']).toMatch(/Turn 15°/);
    expect(item.S).toMatch(/Resize/);
    expect(item.W).toMatch(/move arrows/);
    expect(item.F).toMatch(/Focus/);
    expect(item.E).toBeUndefined();
  });

  it('Ctrl+S saves (General)', () => {
    expect(Object.fromEntries(keysOf('General'))['Ctrl+S']).toMatch(/Save/);
  });

  it('v0.15.5: Page Up / Down, several items, copy and paste are listed', () => {
    const general = Object.fromEntries(keysOf('General'));
    expect(general['Page Up']).toMatch(/Floor above/);
    expect(general['Page Down']).toMatch(/Floor below/);
    const several = Object.fromEntries(keysOf('Several items'));
    expect(several['Shift+Click']).toMatch(/Add or remove/);
    expect(several['Shift+Drag']).toMatch(/box/);
    const paste = Object.fromEntries(keysOf('Copy and paste'));
    expect(Object.keys(paste)).toEqual(['Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+V']);
  });

  it('v0.15.6: L locks a room too, Alt+Drag moves with no snapping', () => {
    const item = Object.fromEntries(keysOf('Selected item'));
    expect(item.L).toMatch(/room/);
    expect(item['Alt+Drag']).toMatch(/no snapping/);
  });

  it('no key means two things in one group', () => {
    for (const g of SHORTCUT_GROUPS) {
      const keys = g.keys.map(([k]) => k.join('+'));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('the tool hints say how far R turns', () => {
    for (const t of STUDIO_TOOLS) if (/R turns/.test(t.hint ?? '')) expect(t.hint).toMatch(/R turns it 90°/);
  });
});
