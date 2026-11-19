// v0.18.1: door and window types: placing one, changing its type (both records of a shared door), the
// full-height glass panel following its wall, the library tiles and Walk through's catalog.
import { describe, it, expect } from 'vitest';
import {
  styleOf, styleSize, styleFields, styleOptions, styleName, DOOR_STYLES, WINDOW_STYLES,
} from '../openingStyles';
import {
  planOpening, planOpeningStyle, roomOpenings, openingData, resizeOpening, resetOpeningSize, panelTop,
} from '../geometry';
import { planWallHeight } from '../building';
import { STUDIO_TOOLS, activeTile, toolHint } from '../../ui/tools';
import { STRUCTURE_ITEMS, DEFAULT_HOTBAR, shortLabel, itemKey } from '../hotbarItems';
import { createEditorHistory } from '../../store/editorHistory';
import { useWorkspaceStore } from '../../store/workspaceStore';

const room = (id, x, extra = {}) => ({
  id, name: id, type: 'OFFICE', floor: 0, x, z: 0, width: 6, depth: 5, wallHeight: 3.2, wallThickness: 0.15,
  doors: [], windows: [], ...extra,
});

describe('the types', () => {
  it('unknown or missing = the default; only what differs is saved', () => {
    expect(styleOf('door', {})).toBe('wood');
    expect(styleOf('door', { style: 'revolving' })).toBe('wood');
    expect(styleOf('window', { style: 'panel' })).toBe('panel');
    expect(styleFields('door', 'wood')).toEqual({});
    expect(styleFields('door', 'glass')).toEqual({ style: 'glass' });
    expect(styleFields('door', 'exit')).toEqual({ style: 'exit', swing: 'out' });
    expect(styleFields('door', 'exit', false)).toEqual({ style: 'exit', swing: 'in' });
    expect(styleName('window', { style: 'tall' })).toBe('Tall window');
  });

  it('sizes: a panel reaches the top of its wall, a tall window fits a low wall', () => {
    expect(styleSize('window', 'panel', 3.2)).toEqual({ width: 2.0, height: 3.1, sill: 0 });
    expect(styleSize('window', 'tall', 3.2)).toEqual({ width: 1.0, height: 2.2, sill: 0.3 });
    expect(styleSize('window', 'tall', 2.4).height).toBe(2.0);
    expect(styleSize('door', 'double-glass')).toEqual({ width: 1.8, height: 2.1, sill: 0 });
    expect(Object.keys(DOOR_STYLES)).toHaveLength(5);
    expect(Object.keys(WINDOW_STYLES)).toHaveLength(3);
  });
});

describe('placing a door / window of a type', () => {
  it("a glass panel: the type's size, its style saved, from the floor", () => {
    const r = room('a', 0);
    const plan = planOpening([r], r, 'north', { x: 0, z: 2.5 }, 'window', 'panel');
    expect(plan.problem).toBeNull();
    expect(plan.list[0]).toMatchObject({ kind: 'window', width: 2.0, height: 3.1, sill: 0, style: 'panel' });
  });

  it('a plain door saves no style (as before v0.18.1)', () => {
    const r = room('a', 0);
    const plan = planOpening([r], r, 'south', { x: 0, z: -2.5 }, 'door');
    expect(plan.list[0]).toEqual({ roomId: 'a', kind: 'door', wall: 'south', offset: 0, width: 1.0, height: 2.1 });
  });

  it('an exit between two rooms opens out of the room it was placed from', () => {
    const a = room('a', 0);
    const b = room('b', 6);
    const plan = planOpening([a, b], a, 'east', { x: 3, z: 0 }, 'door', 'exit');
    expect(plan.list).toHaveLength(2);
    expect(plan.list.map((o) => [o.roomId, o.style, o.swing])).toEqual([['a', 'exit', 'out'], ['b', 'exit', 'in']]);
  });

  it('a double door too wide for a short wall says so', () => {
    const r = room('a', 0, { width: 1.8 });
    expect(planOpening([r], r, 'north', { x: 0, z: 2.5 }, 'door', 'double-glass').problem).toBeTruthy();
  });
});

describe('a glass panel follows its wall', () => {
  const r = room('a', 0, { windows: [{ wall: 'north', offset: 0, width: 2, height: 3.1, sill: 0, style: 'panel' }] });

  it('drawn floor to the top less 0.1 m, whatever height it saved', () => {
    const tall = { ...r, wallHeight: 4.2 };
    const o = roomOpenings(tall).find((x) => x.kind === 'window');
    expect([o.bottom, o.top]).toEqual([0, 4.1]);
    expect(openingData(tall, 'window', 0)).toMatchObject({ height: 4.1, sill: 0 });
    expect(panelTop(tall)).toBe(4.1);
  });

  it('lowering the walls is not blocked by it; its height is not resized on its own', () => {
    const floors = { 0: { id: 0, name: 'Ground Floor', height: 3.5 } };
    expect(planWallHeight(floors, [r], r, 2.6).problem).toBeNull();
    const res = resizeOpening([r], r, 'window', 0, { width: 2.4, height: 1.5 });
    expect(res.problem).toBeNull();
    expect(res.list[0].patch).toMatchObject({ width: 2.4, height: 3.1 });
  });
});

describe('changing the type (planOpeningStyle)', () => {
  it('standard window → tall: its sill and height; the width becomes the new type\'s', () => {
    const r = room('a', 0, { windows: [{ wall: 'north', offset: 0, width: 1.4, height: 1.2, sill: 0.9 }] });
    const plan = planOpeningStyle([r], r, 'window', 0, 'tall');
    expect(plan.problem).toBeNull();
    expect(plan.list[0].record).toEqual({ wall: 'north', offset: 0, width: 1.0, height: 2.2, sill: 0.3, style: 'tall' });
  });

  it('a door the editor made wider keeps its width; back to wood removes style and swing', () => {
    const r = room('a', 0, { doors: [{ wall: 'south', offset: 0, width: 1.3, height: 2.1, style: 'exit', swing: 'out' }] });
    const plan = planOpeningStyle([r], r, 'door', 0, 'wood');
    expect(plan.list[0].record).toEqual({ wall: 'south', offset: 0, width: 1.3, height: 2.1 });
  });

  it('a shared door changes in both rooms; an exit opens out of the room it was changed from', () => {
    const a = room('a', 0, { doors: [{ wall: 'east', offset: 0, width: 1.0, height: 2.1 }] });
    const b = room('b', 6, { doors: [{ wall: 'west', offset: 0, width: 1.0, height: 2.1 }] });
    const fromB = planOpeningStyle([a, b], b, 'door', 0, 'exit');
    expect(fromB.list.map((o) => [o.roomId, o.record.swing])).toEqual([['b', 'out'], ['a', 'in']]);
    const glass = planOpeningStyle([a, b], a, 'door', 0, 'double-glass');
    expect(glass.list.map((o) => [o.roomId, o.record.width, o.record.style])).toEqual([['a', 1.8, 'double-glass'], ['b', 1.8, 'double-glass']]);
  });

  it("doesn't fit: says why, nothing changes", () => {
    const r = room('a', 0, { width: 1.6, doors: [{ wall: 'north', offset: 0, width: 1.0, height: 2.1 }] });
    const plan = planOpeningStyle([r], r, 'door', 0, 'double-glass');
    expect(plan.problem).toMatch(/Double glass door doesn't fit here/);
    expect(plan.list).toEqual([]);
  });

  it('Standard size = the type\'s size', () => {
    const r = room('a', 0, { doors: [{ wall: 'north', offset: 0, width: 1.4, height: 2.2, style: 'double-glass' }] });
    expect(resetOpeningSize([r], r, 'door', 0).list[0].patch).toMatchObject({ width: 1.8, height: 2.1 });
  });

  it('editor.setOpeningStyle: both records in one undo step', () => {
    const a = room('room_a', 0, { doors: [{ wall: 'east', offset: 0, width: 1.0, height: 2.1 }] });
    const b = room('room_b', 6, { doors: [{ wall: 'west', offset: 0, width: 1.0, height: 2.1 }] });
    useWorkspaceStore.setState({ rooms: { room_a: a, room_b: b }, objects: {} });
    const editor = createEditorHistory();
    const st = () => useWorkspaceStore.getState();
    editor.setOpeningStyle(planOpeningStyle([a, b], a, 'door', 0, 'glass').list);
    expect(st().rooms.room_a.doors[0].style).toBe('glass');
    expect(st().rooms.room_b.doors[0].style).toBe('glass');
    editor.undo();
    expect(st().rooms.room_a.doors[0]).not.toHaveProperty('style');
    expect(st().rooms.room_b.doors[0]).not.toHaveProperty('style');
  });
});

describe('the library and Walk through', () => {
  it('a tile per type; "Door" and "Window" are the plain ones (e2e picks them by name)', () => {
    const tiles = STUDIO_TOOLS.find((t) => t.id === 'doors').options;
    expect(tiles.map((t) => t.label)).toEqual([
      'Door', 'Glass door', 'Double glass door', 'Sliding glass door', 'Emergency exit', 'Window', 'Tall window', 'Glass panel',
    ]);
    expect(tiles.find((t) => t.label === 'Door').tool).toEqual({ kind: 'door' });
    expect(tiles.find((t) => t.label === 'Glass panel').tool).toEqual({ kind: 'window', style: 'panel' });
    expect(activeTile({ kind: 'window', style: 'panel' })).toEqual({ id: 'doors', choice: 'Glass panel', option: 'window-panel' });
    expect(activeTile({ kind: 'door' }).option).toBe('door');
    expect(toolHint({ kind: 'door', style: 'exit' })).toBe('Click a wall to add an emergency exit');
    expect(toolHint({ kind: 'window' })).toBe('Click a wall to add a window');
  });

  it('the catalog has every type, the hotbar keeps the plain door and window', () => {
    const doors = STRUCTURE_ITEMS.filter((i) => i.kind === 'door');
    expect(doors.map((d) => d.style ?? 'wood')).toEqual(Object.keys(DOOR_STYLES));
    expect(DEFAULT_HOTBAR[3]).toMatchObject({ kind: 'door' });
    expect(DEFAULT_HOTBAR[3].style).toBeUndefined();
    expect(new Set(STRUCTURE_ITEMS.map(itemKey)).size).toBe(STRUCTURE_ITEMS.length);
    for (const i of STRUCTURE_ITEMS) expect(shortLabel(i).length).toBeLessThanOrEqual(10);
    expect(styleOptions('window').map((o) => o.style)).toEqual(['standard', 'tall', 'panel']);
  });
});
