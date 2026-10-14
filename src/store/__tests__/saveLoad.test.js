import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import { createEditorHistory } from '../editorHistory';
import { normaliseLayout, layoutSummary } from '../layoutData';
import {
  createWorkspace, loadWorkspace, saveNow, listLayouts, deleteLayout, renameLayout,
  startAutoSave, stopAutoSave, reloadLayout, saveAsCopy,
} from '../../services/apiService';

// ── A browser-like localStorage for Node ──
function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

const S = () => useWorkspaceStore.getState();
const COMPANY = 'company_test';

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  S().resetWorkspace();
});
afterEach(() => {
  stopAutoSave();
  vi.useRealTimers();
});

/** Build a 2-storey layout with every kind of data, through editorHistory. */
function buildLayout(editor) {
  editor.addRoom({ type: 'OFFICE', name: 'Ground Office', x: 0, z: 0, width: 8, depth: 6, floor: 0 });
  const ground = Object.values(S().rooms)[0].id;
  editor.addOpenings([
    { roomId: ground, kind: 'door', wall: 'south', offset: -1, width: 1.0, height: 2.1 },
    { roomId: ground, kind: 'window', wall: 'east', offset: 0, width: 1.4, height: 1.2, sill: 0.9 },
  ]);
  editor.addObject({ assetType: 'STAIRCASE', x: 2.5, z: 0, floor: 0, roomId: ground });
  editor.addObject({ assetType: 'DESK_STANDARD', x: -2, z: 1, rotationY: 1.2, floor: 0, roomId: ground, label: 'Rahul' });
  editor.addFloor();
  editor.addRoom({ type: 'MEETING', name: 'Upstairs', x: 0, z: 0, width: 8, depth: 6, floor: 1 });
  const desk = Object.values(S().objects).find((o) => o.assetType === 'DESK_STANDARD');
  editor.setAnchorData(`anchor-${desk.id}`, { positionRef: 'POS-42' });
}

/** What must survive a save: layout data without UI state. */
function layoutOf(state) {
  const strip = ({ isSelected: _s, ...rest }) => rest;
  return {
    floors: state.floors,
    rooms: Object.values(state.rooms).map(strip),
    objects: Object.values(state.objects).map(strip),
    anchorData: state.anchorData,
  };
}

describe('save → load round trip', () => {
  it('keeps rooms, doors, windows, stairs, furniture, 2 floors and anchor data', async () => {
    const id = await createWorkspace(COMPANY, 'Head Office');
    const editor = createEditorHistory();
    buildLayout(editor);
    const before = layoutOf(S());
    expect(before.rooms).toHaveLength(2);
    expect(Object.keys(before.floors)).toHaveLength(2);

    expect(await saveNow()).toEqual({ ok: true });
    expect(S().isDirty).toBe(false);

    S().resetWorkspace();
    expect(await loadWorkspace(COMPANY, id)).toBe(true);
    const after = layoutOf(S());
    expect(after).toEqual(before);
    expect(S().layoutName).toBe('Head Office');
    expect(S().isDirty).toBe(false);

    // the saved copy has no selection state in it
    const raw = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_${id}`));
    expect(raw.rooms.every((r) => !('isSelected' in r))).toBe(true);
  });

  it('new ids after loading do not collide with loaded ones', async () => {
    const id = await createWorkspace(COMPANY, 'A');
    const editor = createEditorHistory();
    buildLayout(editor);
    await saveNow();
    S().resetWorkspace();
    await loadWorkspace(COMPANY, id);
    createEditorHistory().addRoom({ type: 'OFFICE', x: 20, z: 0, width: 4, depth: 4 });
    const ids = Object.keys(S().rooms);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('loading saves from older versions of the app', () => {
  // As written before floors, anchorData, door heights and Studio existed
  const OLD_SAVE = {
    companyId: COMPANY,
    layoutId: 'layout_old',
    layoutName: 'Old layout',
    layoutVersion: 1,
    rooms: [
      { id: 'room_3', type: 'OFFICE', name: 'Office 3', x: 0, z: 0, width: 6, depth: 4, isSelected: true,
        doors: [{ wall: 'north', offset: 0, width: 1.2 }] },              // no height, no floor
      { id: 'room_4', type: 'MEETING', name: 'Up', x: 0, z: 0, width: 5, depth: 4, floor: 2,
        windows: [{ wall: 'south' }] },                                   // floor 2 without a floors list
    ],
    objects: [
      { id: 'obj_7', assetType: 'CHAIR_OFFICE', x: 1, z: 1 },               // no floor, scale, rotation
    ],
  };

  it('fills in floors, floor heights, anchorData and opening sizes', () => {
    const n = normaliseLayout(OLD_SAVE);
    // floor 2 was 7 m up with nothing between: too tall for one storey, so it comes down to 3.5 m
    expect(n.floors[0]).toEqual({ id: 0, name: 'Ground Floor', height: 3.5 });
    expect(n.floors[2]).toEqual({ id: 2, name: 'Floor 2', height: 3.5 });
    expect(n.anchorData).toEqual({});
    // the old 3 m walls met the old 0.5 m slab; they still meet the 0.3 m one
    expect(n.rooms[0]).toMatchObject({ floor: 0, wallHeight: 3.2, windows: [] });
    expect(n.rooms[0].doors[0]).toEqual({ wall: 'north', offset: 0, width: 1.2, height: 2.1 });
    expect(n.rooms[0]).not.toHaveProperty('isSelected');
    expect(n.rooms[1].windows[0]).toEqual({ wall: 'south', offset: 0, width: 1.4, height: 1.2, sill: 0.9 });
    expect(n.objects[0]).toMatchObject({ floor: 0, y: 0, rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1, isLocked: false });
  });

  it('opens through the api, and a floor missing its elevation gets a height', async () => {
    localStorage.setItem(`dwtwin_${COMPANY}_layout_old`, JSON.stringify({
      ...OLD_SAVE, floors: { 0: { id: 0, name: 'Ground Floor' }, 1: { id: 1 } },
    }));
    expect(await loadWorkspace(COMPANY, 'layout_old')).toBe(true);
    expect(S().floors[1]).toEqual({ id: 1, name: 'Floor 1', height: 3.5 });
    expect(S().layoutName).toBe('Old layout');
    expect(Object.keys(S().rooms)).toEqual(['room_3', 'room_4']);
  });

  it('a save with only floor 1 (its ground floor was deleted) gets that floor as floor 0', () => {
    const saved = {
      floors: { 1: { id: 1, name: 'Floor 1', height: 4 }, 3: { id: 3, name: 'Roof deck', height: 3.5 } },
      rooms: [{ id: 'room_2', floor: 1, wallHeight: 3.7 }, { id: 'room_5', floor: 3, wallHeight: 3.2 }],
      objects: [{ id: 'obj_9', floor: 3, y: 0.75 }],
      anchorData: { 'anchor-obj_9': { label: 'Desk' } },
    };
    const n = normaliseLayout(saved);
    // no empty floor 0 under it (that lifted the building by a storey), order kept
    expect(n.floors).toEqual({
      0: { id: 0, name: 'Floor 1', height: 4 },
      2: { id: 2, name: 'Roof deck', height: 3.5 },
    });
    expect(n.rooms.map((r) => r.floor)).toEqual([0, 2]);
    expect(n.objects[0]).toMatchObject({ floor: 2, y: 0.75 });
    expect(n.anchorData).toEqual(saved.anchorData);         // anchor ids don't depend on floors
    expect(normaliseLayout(n)).toEqual(n);                    // loading it again changes nothing
  });

  it('survives junk: missing lists, maps instead of arrays, nulls', () => {
    expect(() => normaliseLayout(null)).not.toThrow();
    expect(normaliseLayout({}).rooms).toEqual([]);
    const n = normaliseLayout({ rooms: { a: { id: 'room_1', doors: null } }, objects: [null], floors: [{ id: 0 }], anchorData: [] });
    expect(n.rooms[0].doors).toEqual([]);
    expect(n.objects).toEqual([]);
    expect(n.anchorData).toEqual({});
    expect(n.layoutName).toBe('Untitled Layout');
  });
});

describe('the layout list', () => {
  it('shows the real name, room and floor counts, and only layouts that exist', async () => {
    const id = await createWorkspace(COMPANY, 'Head Office');
    buildLayout(createEditorHistory());
    await saveNow();
    // an index entry whose data is gone must not be listed
    const index = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_layouts`));
    localStorage.setItem(`dwtwin_${COMPANY}_layouts`, JSON.stringify([...index, { id: 'layout_ghost', name: 'Ghost' }]));

    const list = await listLayouts(COMPANY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: 'Head Office', rooms: 2, floors: 2 });
    expect(list[0].updatedAt).toBeTruthy();

    await deleteLayout(COMPANY, id);
    expect(await listLayouts(COMPANY)).toEqual([]);
  });

  it('renaming in the header updates the list', async () => {
    await createWorkspace(COMPANY, 'Untitled Layout');
    await renameLayout('Factory');
    expect((await listLayouts(COMPANY))[0].name).toBe('Factory');
  });

  it('layoutSummary of an old save', () => {
    expect(layoutSummary('x', { rooms: [{ id: 'room_1', floor: 0 }, { id: 'room_2', floor: 1 }] }))
      .toMatchObject({ name: 'Untitled Layout', rooms: 2, floors: 2 });
    // rooms only on floor 1: that floor is the ground floor, no empty one is added under it
    expect(layoutSummary('x', { rooms: [{ id: 'room_1', floor: 1 }] })).toMatchObject({ rooms: 1, floors: 1 });
  });
});

describe('auto-save', () => {
  it('saves ~1 s after a change through editorHistory, including floors and anchor data', async () => {
    vi.useFakeTimers();
    const id = await createWorkspace(COMPANY, 'Auto');
    startAutoSave();
    const editor = createEditorHistory();
    const saved = () => JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_${id}`));

    editor.addFloor();
    expect(S().isDirty).toBe(true);
    vi.advanceTimersByTime(900);
    expect(Object.keys(saved().floors)).toHaveLength(1);   // not yet: debounced
    vi.advanceTimersByTime(200);
    expect(Object.keys(saved().floors)).toHaveLength(2);
    expect(S().isDirty).toBe(false);

    editor.setAnchorData('anchor-x', { label: 'Front desk' });
    vi.advanceTimersByTime(1100);
    expect(saved().anchorData).toEqual({ 'anchor-x': { label: 'Front desk' } });

    editor.undo();                                          // undo is a change too
    vi.advanceTimersByTime(1100);
    expect(saved().anchorData).toEqual({});
  });

  it('a failed save says why and keeps the changes marked unsaved', async () => {
    await createWorkspace(COMPANY, 'Full');
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4 });
    const err = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    localStorage.setItem = () => { throw err; };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await saveNow();
    expect(r.ok).toBe(false);
    expect(S().saveError).toBe('The browser has no space left for this layout');
    expect(S().isDirty).toBe(true);
  });

  it('never overwrites a newer save from another tab; Reload or Save mine as a copy', async () => {
    const id = await createWorkspace(COMPANY, 'Shared');
    const key = `dwtwin_${COMPANY}_${id}`;
    const saved = () => JSON.parse(localStorage.getItem(key));
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', name: 'Mine', x: 0, z: 0, width: 4, depth: 4 });
    expect(await saveNow()).toEqual({ ok: true });
    expect(saved().revision).toBe(2);

    // another tab saves its own version (it loaded revision 2 too)
    const theirs = { ...saved(), rooms: [{ ...saved().rooms[0], id: 'room_99', name: 'Theirs' }], revision: 3 };
    localStorage.setItem(key, JSON.stringify(theirs));

    editor.addRoom({ type: 'OFFICE', name: 'Mine 2', x: 8, z: 0, width: 4, depth: 4 });
    const r = await saveNow();
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect(saved().rooms.map((x) => x.name)).toEqual(['Theirs']);     // their work is still there
    expect(S()).toMatchObject({ saveConflict: true, saveError: 'This layout was changed in another tab', isDirty: true });

    // Save mine as a copy: a new layout with my rooms; theirs untouched
    const copy = await saveAsCopy();
    expect(copy.ok).toBe(true);
    const mine = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_${copy.layoutId}`));
    expect(mine.layoutName).toBe('Shared (copy)');
    expect(mine.rooms.map((x) => x.name)).toEqual(['Mine', 'Mine 2']);
    expect(saved().rooms.map((x) => x.name)).toEqual(['Theirs']);
    expect(S()).toMatchObject({ layoutId: copy.layoutId, saveConflict: false, isDirty: false });
    expect((await listLayouts(COMPANY)).map((l) => l.name).sort()).toEqual(['Shared', 'Shared (copy)']);

    // back on the shared one: another tab saves again → Reload loads theirs
    await loadWorkspace(COMPANY, id);
    localStorage.setItem(key, JSON.stringify({ ...theirs, revision: 4 }));
    editor.addRoom({ type: 'OFFICE', name: 'Lost', x: 0, z: 9, width: 4, depth: 4 });
    expect((await saveNow()).conflict).toBe(true);
    expect(await reloadLayout()).toBe(true);
    expect(Object.values(S().rooms).map((x) => x.name)).toEqual(['Theirs']);
    expect(S()).toMatchObject({ saveConflict: false, saveError: null, isDirty: false });
    editor.addRoom({ type: 'OFFICE', name: 'After reload', x: 0, z: 9, width: 4, depth: 4 });
    expect(await saveNow()).toEqual({ ok: true });
    expect(saved().revision).toBe(5);
  });

  it('saves from before revisions still save (revision 0 → 1)', async () => {
    localStorage.setItem(`dwtwin_${COMPANY}_layout_norev`, JSON.stringify({ layoutName: 'Old', rooms: [] }));
    await loadWorkspace(COMPANY, 'layout_norev');
    createEditorHistory().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4 });
    expect(await saveNow()).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_layout_norev`)).revision).toBe(1);
  });

  it('stopping auto-save (leaving the editor) saves what is pending', async () => {
    const id = await createWorkspace(COMPANY, 'Leave');
    startAutoSave();
    createEditorHistory().addRoom({ type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4 });
    stopAutoSave();
    expect(JSON.parse(localStorage.getItem(`dwtwin_${COMPANY}_${id}`)).rooms).toHaveLength(1);
  });
});
