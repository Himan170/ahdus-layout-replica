import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as clientModule from '../supabaseClient';
import {
  createVersion,
  listVersions,
  restoreVersion,
  saveNow,
  deleteLayout,
  _setRevisionForTesting,
  _resetSaveCountForTesting,
  _getSaveCountSinceVersion,
} from '../apiService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';
const LAYOUT_UUID = '22222222-2222-4222-8222-222222222222';

describe('Task R4: Version History & Restore API', () => {
  let mockSupabase;
  let mockTable;
  let editor;

  beforeEach(() => {
    useWorkspaceStore.getState().resetWorkspace();
    useWorkspaceStore.getState().setTenant(COMPANY_UUID, LAYOUT_UUID, 'HQ Test', 1);
    _setRevisionForTesting(1);
    _resetSaveCountForTesting();
    editor = createEditorHistory();

    // Fake localStorage
    const storageMap = new Map();
    globalThis.localStorage = {
      getItem: (k) => storageMap.get(k) ?? null,
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
      clear: () => storageMap.clear(),
      key: (i) => Array.from(storageMap.keys())[i] ?? null,
      get length() { return storageMap.size; },
    };

    mockTable = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabase = {
      from: vi.fn(() => mockTable),
    };

    vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(mockSupabase);
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
  });

  it('createVersion creates a snapshot, saves to Supabase and caches in localStorage', async () => {
    // Add a room to the workplace
    editor.addRoom({ type: 'OFFICE', name: 'Executive Suite', x: 0, z: 0, width: 6, depth: 5 });

    mockTable.select.mockResolvedValueOnce({
      data: [{
        id: 'ver-uuid-1',
        layout_id: LAYOUT_UUID,
        company_id: COMPANY_UUID,
        name: 'Initial Plan',
        version: 1,
        revision: 1,
        created_at: '2026-10-25T11:00:00Z',
      }],
      error: null,
    });

    const res = await createVersion('Initial Plan');
    expect(res.ok).toBe(true);
    expect(res.version.name).toBe('Initial Plan');
    expect(res.version.version).toBe(1);

    // Verify Supabase insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('layout_versions');
    expect(mockTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        layout_id: LAYOUT_UUID,
        company_id: COMPANY_UUID,
        name: 'Initial Plan',
        version: 1,
      })
    );

    // Verify localStorage cache
    const cached = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`));
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe('Initial Plan');
    expect(cached[0].version).toBe(1);
    expect(cached[0].snapshot.rooms.some((r) => r.name === 'Executive Suite')).toBe(true);
  });

  it('createVersion increments version number sequentially', async () => {
    mockTable.maybeSingle.mockResolvedValue({ data: null, error: null });

    const res1 = await createVersion('First Cut');
    expect(res1.version.version).toBe(1);

    const res2 = await createVersion('Second Revision');
    expect(res2.version.version).toBe(2);

    const cached = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`));
    expect(cached).toHaveLength(2);
    expect(cached[0].version).toBe(2);
    expect(cached[1].version).toBe(1);
  });

  it('listVersions fetches from Supabase and falls back to local storage', async () => {
    mockTable.order.mockResolvedValueOnce({
      data: [
        {
          id: 'ver-2',
          layout_id: LAYOUT_UUID,
          company_id: COMPANY_UUID,
          name: 'v2 remote',
          version: 2,
          created_at: '2026-10-25T11:20:00Z',
        },
      ],
      error: null,
    });

    const list = await listVersions(COMPANY_UUID, LAYOUT_UUID);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('v2 remote');

    // LocalStorage was updated
    const cached = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`));
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe('v2 remote');

    // Supabase failure falls back to cached
    mockTable.order.mockRejectedValueOnce(new Error('Network offline'));
    const listFallback = await listVersions(COMPANY_UUID, LAYOUT_UUID);
    expect(listFallback).toHaveLength(1);
    expect(listFallback[0].name).toBe('v2 remote');
  });

  it('restoreVersion restores old layout snapshot through editorHistory with undo intact', async () => {
    // 1. Initial room
    editor.addRoom({ type: 'OFFICE', name: 'Room V1', x: 0, z: 0, width: 4, depth: 4 });
    const snap1 = useWorkspaceStore.getState().exportWorkspace();

    // Store version 1 in local cache
    localStorage.setItem(
      `dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`,
      JSON.stringify([
        {
          id: 'ver-uuid-1',
          layout_id: LAYOUT_UUID,
          company_id: COMPANY_UUID,
          name: 'Snapshot 1',
          version: 1,
          snapshot: snap1,
        },
      ])
    );

    // 2. Modify workplace (add second room and desk)
    editor.addRoom({ type: 'MEETING', name: 'Room V2', x: 10, z: 0, width: 6, depth: 4 });
    editor.addObject({ assetType: 'DESK_STANDARD', x: 2, z: 2 });
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(2);
    expect(Object.keys(useWorkspaceStore.getState().objects)).toHaveLength(1);

    // 3. Restore Snapshot 1
    const res = await restoreVersion(COMPANY_UUID, LAYOUT_UUID, 1, editor);
    expect(res.ok).toBe(true);

    // Workplace now has 1 room and 0 objects from snapshot 1
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(1);
    expect(Object.values(useWorkspaceStore.getState().rooms)[0].name).toBe('Room V1');
    expect(Object.keys(useWorkspaceStore.getState().objects)).toHaveLength(0);
    expect(useWorkspaceStore.getState().isDirty).toBe(true);

    // 4. Ctrl+Z / Undo restores back to 2 rooms and desk
    editor.undo();
    expect(Object.keys(useWorkspaceStore.getState().rooms)).toHaveLength(2);
    expect(Object.keys(useWorkspaceStore.getState().objects)).toHaveLength(1);

    // 5. Another Undo undoes desk addition
    editor.undo();
    expect(Object.keys(useWorkspaceStore.getState().objects)).toHaveLength(0);
  });

  it('automatically triggers auto-save version checkpoint every 5 saves', async () => {
    // Mock saveNow's Supabase CAS call to succeed
    mockTable.update = vi.fn().mockReturnThis();
    mockTable.select = vi.fn().mockReturnValue(mockTable);
    mockTable.select.mockResolvedValue({
      data: [{ id: LAYOUT_UUID, revision: 2, updated_at: '2026-10-25T11:00:00Z' }],
      error: null,
    });
    mockTable.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    expect(_getSaveCountSinceVersion()).toBe(0);

    for (let i = 1; i <= 4; i++) {
      useWorkspaceStore.setState({ isDirty: true });
      await saveNow();
      expect(_getSaveCountSinceVersion()).toBe(i);
    }

    // 5th save triggers auto-checkpoint and resets counter
    useWorkspaceStore.setState({ isDirty: true });
    await saveNow();
    expect(_getSaveCountSinceVersion()).toBe(0);

    // Check version list contains auto-checkpoint
    const cached = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`));
    expect(cached).toBeDefined();
    expect(cached.some((v) => v.name === 'Auto-save checkpoint')).toBe(true);
  });

  it('deleteLayout purges versions cache from localStorage', async () => {
    localStorage.setItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`, JSON.stringify([{ id: 'v1' }]));
    mockTable.delete = vi.fn().mockReturnThis();

    await deleteLayout(COMPANY_UUID, LAYOUT_UUID);
    expect(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}_versions`)).toBeNull();
  });
});
