// The browser-side Supabase path is a PROTOTYPE: without VITE_LAYOUT_BACKEND=supabase
// apiService makes no network calls at all, even with a Supabase URL and key set
// (and an AHDUS login token: the AHDUS backend is VITE_LAYOUT_BACKEND=ahdus only).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as clientModule from '../supabaseClient';
import {
  createWorkspace,
  loadWorkspace,
  saveNow,
  renameLayout,
  listLayouts,
  exportLayout,
  importLayout,
  saveAsCopy,
  deleteLayout,
  createVersion,
  listVersions,
  restoreVersion,
  _persistQueueItem,
  publishLayout,
} from '../apiService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createEditorHistory } from '../../store/editorHistory';

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';

describe('apiService without VITE_LAYOUT_BACKEND=supabase', () => {
  let mockSupabase;
  let fetchSpy;

  beforeEach(() => {
    const map = new Map();
    globalThis.localStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
    useWorkspaceStore.getState().resetWorkspace();
    // A Supabase URL + key are configured, but the flag is not set
    vi.stubEnv('VITE_LAYOUT_BACKEND', '');
    localStorage.setItem('authToken', 'token-abc');
    const table = new Proxy({}, { get: () => vi.fn(() => table) });
    mockSupabase = { from: vi.fn(() => table), channel: vi.fn(), removeChannel: vi.fn() };
    vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(mockSupabase);
    vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
    fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('makes zero network calls for every layout and version operation', async () => {
    const layoutId = await createWorkspace(COMPANY_UUID, 'HQ');
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', name: 'Office', x: 0, z: 0, width: 4, depth: 4 });
    expect((await saveNow()).ok).toBe(true);
    await renameLayout('HQ North');
    expect(await loadWorkspace(COMPANY_UUID, layoutId)).toBe(true);
    expect((await listLayouts(COMPANY_UUID)).map((l) => l.name)).toContain('HQ North');
    const file = await exportLayout(COMPANY_UUID, layoutId);
    await importLayout(COMPANY_UUID, file.text);
    const version = await createVersion('Before');
    expect(version.ok).toBe(true);
    expect(await listVersions(COMPANY_UUID, layoutId)).toHaveLength(1);
    expect((await restoreVersion(COMPANY_UUID, layoutId, version.version.id, editor)).ok).toBe(true);
    await _persistQueueItem({ companyId: COMPANY_UUID, layoutId, payload: useWorkspaceStore.getState().exportWorkspace(), baseRevision: 99 });
    await saveAsCopy();
    expect((await publishLayout()).ok).toBe(false); // AHDUS only
    await deleteLayout(COMPANY_UUID, layoutId);

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.channel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('restoring a version keeps the layout name (it is not part of undo)', async () => {
    const layoutId = await createWorkspace(COMPANY_UUID, 'Current name');
    const editor = createEditorHistory();
    const version = await createVersion('Old', {
      payload: { ...useWorkspaceStore.getState().exportWorkspace(), layoutName: 'Old name' },
    });
    expect((await restoreVersion(COMPANY_UUID, layoutId, version.version.id, editor)).ok).toBe(true);
    expect(useWorkspaceStore.getState().layoutName).toBe('Current name');
    editor.undo();
    expect(useWorkspaceStore.getState().layoutName).toBe('Current name');
  });

  it('restoreVersion needs an editor (so the restore is undoable)', async () => {
    const layoutId = await createWorkspace(COMPANY_UUID, 'HQ');
    const version = await createVersion('V');
    expect(await restoreVersion(COMPANY_UUID, layoutId, version.version.id)).toEqual({ ok: false, error: 'Nothing to restore into' });
  });
});
