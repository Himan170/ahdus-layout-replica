import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as clientModule from '../supabaseClient';
import {
  loadWorkspace,
  saveNow,
  listLayouts,
  deleteLayout,
  saveAsCopy,
  createWorkspace,
  _persistQueueItem,
  _setRevisionForTesting,
} from '../apiService';
import { useWorkspaceStore } from '../../store/workspaceStore';

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';
const LAYOUT_UUID = '22222222-2222-4222-8222-222222222222';

describe('apiService - Task R2: Supabase backend integration & CAS revision check', () => {
  let mockSupabase;
  let mockTable;

  beforeEach(() => {
    // Reset Zustand store
    useWorkspaceStore.getState().resetWorkspace();
    _setRevisionForTesting(0);

    // Setup fake localStorage
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
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
    };

    mockSupabase = {
      from: vi.fn(() => mockTable),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(),
    };

    vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(mockSupabase);
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
    vi.stubEnv('VITE_LAYOUT_BACKEND', 'supabase'); // the prototype backend is off without it
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loadWorkspace loads layout from Supabase and caches into localStorage', async () => {
    const layoutPayload = {
      layoutName: 'HQ Supabase',
      layoutVersion: 1,
      floors: { '0': { id: 0, name: 'Ground Floor', height: 3.5 } },
      rooms: [{ id: 'room_1', name: 'Boardroom', x: 0, z: 0, width: 6, depth: 4, floor: 0, doors: [], windows: [] }],
      objects: [],
      anchorData: {},
    };

    mockTable.maybeSingle.mockResolvedValueOnce({
      data: {
        id: LAYOUT_UUID,
        name: 'HQ Supabase',
        revision: 3,
        version: 1,
        metadata: layoutPayload,
        updated_at: '2026-10-25T11:00:00Z',
      },
      error: null,
    });

    const loaded = await loadWorkspace(COMPANY_UUID, LAYOUT_UUID);
    expect(loaded).toBe(true);

    const state = useWorkspaceStore.getState();
    expect(state.layoutName).toBe('HQ Supabase');
    expect(Object.keys(state.rooms)).toHaveLength(1);
    expect(state.rooms.room_1.name).toBe('Boardroom');

    // LocalStorage cache was updated
    const cached = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}`));
    expect(cached).toBeDefined();
    expect(cached.revision).toBe(3);
    expect(cached.layoutName).toBe('HQ Supabase');
  });

  it('saveNow performs Compare-And-Set (CAS) update on revision in Supabase', async () => {
    _setRevisionForTesting(1);
    // Setup existing layout in store
    useWorkspaceStore.getState().setTenant(COMPANY_UUID, LAYOUT_UUID, 'HQ Test', 1);
    useWorkspaceStore.setState({ isDirty: true });

    // Mock successful CAS update on base revision
    mockTable.select.mockResolvedValueOnce({
      data: [{ id: LAYOUT_UUID, revision: 2, updated_at: '2026-10-25T11:05:00Z' }],
      error: null,
    });

    const res = await saveNow();
    expect(res).toEqual({ ok: true });

    // Verify update targeted matching baseRevision
    expect(mockTable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HQ Test',
        revision: 2,
        metadata: expect.any(Object),
      })
    );
    expect(mockTable.eq).toHaveBeenCalledWith('id', LAYOUT_UUID);
    expect(mockTable.eq).toHaveBeenCalledWith('company_id', COMPANY_UUID);
    expect(mockTable.eq).toHaveBeenCalledWith('revision', 1);

    expect(useWorkspaceStore.getState().isDirty).toBe(false);
  });

  it('detects server-side revision conflict and triggers markSaveConflict', async () => {
    _setRevisionForTesting(1);
    useWorkspaceStore.getState().setTenant(COMPANY_UUID, LAYOUT_UUID, 'Conflict Test', 1);
    useWorkspaceStore.setState({ isDirty: true });

    // Mock 0 rows updated (CAS condition revision = 1 failed)
    mockTable.select.mockResolvedValueOnce({ data: [], error: null });

    // Check existing returns server revision = 3 (ahead of our revision)
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: { id: LAYOUT_UUID, revision: 3 },
      error: null,
    });

    await saveNow();

    // Verify background CAS detected the conflict
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = useWorkspaceStore.getState();
    expect(state.saveConflict).toBe(true);
    expect(state.saveError).toBe('This layout was changed in another tab');
  });

  it('listLayouts fetches from Supabase and updates local index cache', async () => {
    mockTable.order.mockResolvedValueOnce({
      data: [
        {
          id: LAYOUT_UUID,
          name: 'Remote Layout',
          revision: 5,
          version: 1,
          metadata: { rooms: [{ id: 'r1' }], floors: { '0': {} } },
          updated_at: '2026-10-25T11:20:00Z',
        },
      ],
      error: null,
    });

    const list = await listLayouts(COMPANY_UUID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: LAYOUT_UUID,
      name: 'Remote Layout',
      rooms: 1,
      floors: 1,
    });

    // LocalStorage list index cached
    const cachedIndex = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_layouts`));
    expect(cachedIndex).toHaveLength(1);
    expect(cachedIndex[0].id).toBe(LAYOUT_UUID);
  });

  it('deleteLayout deletes row from Supabase and removes from localStorage', async () => {
    localStorage.setItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}`, JSON.stringify({ name: 'To Delete' }));
    localStorage.setItem(`dwtwin_${COMPANY_UUID}_layouts`, JSON.stringify([{ id: LAYOUT_UUID, name: 'To Delete' }]));

    mockTable.delete.mockReturnThis();

    await deleteLayout(COMPANY_UUID, LAYOUT_UUID);

    expect(mockTable.delete).toHaveBeenCalled();
    expect(mockTable.eq).toHaveBeenCalledWith('id', LAYOUT_UUID);
    expect(mockTable.eq).toHaveBeenCalledWith('company_id', COMPANY_UUID);

    // Removed from local cache
    expect(localStorage.getItem(`dwtwin_${COMPANY_UUID}_${LAYOUT_UUID}`)).toBeNull();
    const index = JSON.parse(localStorage.getItem(`dwtwin_${COMPANY_UUID}_layouts`));
    expect(index).toEqual([]);
  });

  it('saveAsCopy creates a new forked layout in Supabase and clears conflict', async () => {
    useWorkspaceStore.getState().setTenant(COMPANY_UUID, LAYOUT_UUID, 'Master Layout', 1);
    useWorkspaceStore.setState({ saveConflict: true, saveError: 'Changed elsewhere' });

    mockTable.insert.mockResolvedValueOnce({
      data: [{ id: 'new-uuid', revision: 1 }],
      error: null,
    });

    const res = await saveAsCopy();
    expect(res.ok).toBe(true);

    const state = useWorkspaceStore.getState();
    expect(state.saveConflict).toBe(false);
    expect(state.layoutName).toBe('Master Layout (copy)');
    expect(state.isDirty).toBe(false);
  });

  it('_persistQueueItem handles conflict reported by Supabase during sync drain', async () => {
    mockTable.select.mockResolvedValueOnce({ data: [], error: null }); // update 0 rows
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: { id: LAYOUT_UUID, revision: 4 }, // server moved ahead
      error: null,
    });

    const queueItem = {
      companyId: COMPANY_UUID,
      layoutId: LAYOUT_UUID,
      payload: { layoutName: 'Queued Edit' },
      baseRevision: 2,
    };

    const res = await _persistQueueItem(queueItem);
    expect(res.conflict).toBe(true);
    expect(res.ok).toBe(false);
  });
});
