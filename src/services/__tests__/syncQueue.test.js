/**
 * syncQueue.test.js
 *
 * Unit tests for Task R7: Offline queue, retry, and conflict detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  enqueueSync,
  getSyncQueue,
  clearSyncQueue,
  getPendingCount,
  dequeueLayoutSync,
  drainSyncQueue,
  startSyncListener,
  stopSyncListener,
  isOnline,
  SYNC_QUEUE_KEY,
  CONFLICT_OFFLINE_MESSAGE,
} from '../syncQueue';
import {
  createWorkspace,
  loadWorkspace,
  saveNow,
  reloadLayout,
  saveAsCopy,
  stopAutoSave,
  _persistQueueItem,
} from '../apiService';
import { createEditorHistory } from '../../store/editorHistory';

// Browser-like localStorage mock
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

function setOnline(status) {
  try {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: status,
      configurable: true,
      writable: true,
    });
  } catch {
    // fallback
  }
}

const S = () => useWorkspaceStore.getState();
const COMPANY = 'company_offline_test';

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  setOnline(true);
  globalThis.window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  S().resetWorkspace();
  clearSyncQueue();
});

afterEach(() => {
  stopAutoSave();
  stopSyncListener();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('syncQueue - offline queueing', () => {
  it('enqueues a layout snapshot into localStorage', () => {
    const payload = { layoutName: 'Office 1', rooms: [], objects: [] };
    const item = enqueueSync({
      companyId: COMPANY,
      layoutId: 'layout_1',
      payload,
      baseRevision: 1,
    });

    expect(item).toMatchObject({
      companyId: COMPANY,
      layoutId: 'layout_1',
      baseRevision: 1,
      payload,
    });
    expect(item.id).toMatch(/^sync_/);
    expect(getPendingCount()).toBe(1);
    expect(getPendingCount(COMPANY, 'layout_1')).toBe(1);
    expect(S().pendingSyncCount).toBe(1);

    const stored = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].layoutId).toBe('layout_1');
  });

  it('coalesces consecutive edits while offline, preserving baseRevision', () => {
    const payload1 = { layoutName: 'Draft 1', rooms: [{ id: 'room_1' }] };
    const payload2 = { layoutName: 'Draft 2', rooms: [{ id: 'room_1' }, { id: 'room_2' }] };

    enqueueSync({
      companyId: COMPANY,
      layoutId: 'layout_1',
      payload: payload1,
      baseRevision: 2,
    });

    enqueueSync({
      companyId: COMPANY,
      layoutId: 'layout_1',
      payload: payload2,
      baseRevision: 5, // even if passed differently, original baseRevision should be preserved
    });

    const queue = getSyncQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload).toEqual(payload2);
    expect(queue[0].baseRevision).toBe(2); // baseRevision preserved
  });

  it('dequeueLayoutSync clears queued items for a single layout', () => {
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_1', payload: {}, baseRevision: 1 });
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_2', payload: {}, baseRevision: 1 });
    expect(getPendingCount()).toBe(2);

    dequeueLayoutSync(COMPANY, 'layout_1');
    expect(getPendingCount()).toBe(1);
    expect(getSyncQueue()[0].layoutId).toBe('layout_2');
  });

  it('clearSyncQueue empties the queue completely', () => {
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_1', payload: {}, baseRevision: 1 });
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_2', payload: {}, baseRevision: 1 });
    clearSyncQueue();
    expect(getSyncQueue()).toEqual([]);
    expect(getPendingCount()).toBe(0);
    expect(S().pendingSyncCount).toBe(0);
  });
});

describe('syncQueue - draining & retry', () => {
  it('drains items sequentially when online', async () => {
    const persistFn = vi.fn().mockResolvedValue({ ok: true });
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_1', payload: { a: 1 }, baseRevision: 1 });
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_2', payload: { b: 2 }, baseRevision: 1 });

    const result = await drainSyncQueue(persistFn);
    expect(result).toEqual({ drained: 2, remaining: 0 });
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(getPendingCount()).toBe(0);
    expect(S().syncStatus).toBe('online');
  });

  it('does not drain when offline', async () => {
    setOnline(false);
    const persistFn = vi.fn();
    enqueueSync({ companyId: COMPANY, layoutId: 'layout_1', payload: {}, baseRevision: 1 });

    const result = await drainSyncQueue(persistFn);
    expect(result).toEqual({ drained: 0, remaining: 1 });
    expect(persistFn).not.toHaveBeenCalled();
    expect(getPendingCount()).toBe(1);
  });

  it('retries with exponential backoff on transient failure', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const persistFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Network timeout');
      return { ok: true };
    });

    enqueueSync({ companyId: COMPANY, layoutId: 'layout_1', payload: {}, baseRevision: 1 });

    // First attempt fails
    const initial = await drainSyncQueue(persistFn);
    expect(initial).toEqual({ drained: 0, remaining: 1 });
    expect(persistFn).toHaveBeenCalledTimes(1);

    // Fast-forward initial backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1100);

    // Second attempt succeeds
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(getPendingCount()).toBe(0);
  });
});

describe('syncQueue - conflict detection (Task R7)', () => {
  it('detects conflict when backend revision is newer than baseRevision and triggers TabNotice conflict', async () => {
    const layoutId = await createWorkspace(COMPANY, 'Conflict Layout');
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', name: 'Mine Initial', x: 0, z: 0, width: 4, depth: 4 });
    await saveNow(); // saved revision = 2

    // While this client was offline, another tab or user saved revision 3
    const key = `dwtwin_${COMPANY}_${layoutId}`;
    const raw = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...raw, revision: 3, layoutName: 'Theirs' }));

    // Our offline queue item was branched from revision 2
    enqueueSync({
      companyId: COMPANY,
      layoutId,
      payload: { ...raw, layoutName: 'Mine Offline' },
      baseRevision: 2,
    });

    const result = await drainSyncQueue(_persistQueueItem);
    expect(result.conflict).toBe(true);
    expect(result.remaining).toBe(1); // queue halted at the conflicting item
    expect(S().saveConflict).toBe(true);
    expect(S().saveError).toBe(CONFLICT_OFFLINE_MESSAGE);
    expect(S().syncStatus).toBe('conflict');

    // TabNotice conflict handling: Reload discards offline queue and reloads theirs
    await reloadLayout();
    expect(S().saveConflict).toBe(false);
    expect(S().layoutName).toBe('Theirs');
    expect(getPendingCount(COMPANY, layoutId)).toBe(0);
  });

  it('Save mine as a copy resolves the conflict by forking into a new layout', async () => {
    const layoutId = await createWorkspace(COMPANY, 'Fork Test');
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', name: 'Original', x: 0, z: 0, width: 4, depth: 4 });
    await saveNow();

    // Advance stored revision
    const key = `dwtwin_${COMPANY}_${layoutId}`;
    const raw = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...raw, revision: 4 }));

    enqueueSync({
      companyId: COMPANY,
      layoutId,
      payload: raw,
      baseRevision: 2,
    });

    await drainSyncQueue(_persistQueueItem);
    expect(S().saveConflict).toBe(true);

    // User chooses "Save mine as a copy"
    editor.addRoom({ type: 'OFFICE', name: 'Forked Room', x: 10, z: 0, width: 4, depth: 4 });
    const copyResult = await saveAsCopy();
    expect(copyResult.ok).toBe(true);
    expect(S().layoutName).toBe('Fork Test (copy)');
    expect(S().saveConflict).toBe(false);
    expect(getPendingCount(COMPANY, layoutId)).toBe(0);
  });
});

describe('apiService offline save integration', () => {
  it('automatically enqueues into syncQueue when navigator is offline', async () => {
    const layoutId = await createWorkspace(COMPANY, 'Offline Save');
    const editor = createEditorHistory();
    editor.addRoom({ type: 'OFFICE', name: 'Room Offline', x: 0, z: 0, width: 4, depth: 4 });

    // Simulate network going offline
    setOnline(false);

    const r = await saveNow();
    expect(r).toEqual({ ok: true, queued: true });
    expect(getPendingCount(COMPANY, layoutId)).toBe(1);
    expect(S().syncStatus).toBe('offline');

    // Simulate network coming back online
    setOnline(true);
    const drainResult = await drainSyncQueue(_persistQueueItem);
    expect(drainResult.drained).toBe(1);
    expect(getPendingCount(COMPANY, layoutId)).toBe(0);
    expect(S().syncStatus).toBe('online');
  });
});
