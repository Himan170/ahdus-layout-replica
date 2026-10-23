/**
 * syncQueue.js
 *
 * Task R7: Offline queue, retry, and conflict detection.
 *
 * Provides a resilient offline sync engine for layout saves:
 * 1. Offline Queue: Persists pending save payloads in localStorage (dwtwin_sync_queue)
 *    so offline edits survive tab reloads and browser restarts. Multiple edits to the same
 *    layout while offline coalesce into the latest snapshot while retaining the original
 *    baseRevision for conflict detection.
 * 2. Automatic Retry & Backoff: Listens to browser 'online'/'offline' events and retries
 *    failed saves with exponential backoff (1s, 2s, 4s... up to max interval).
 * 3. Conflict Detection: When reconnecting, checks if the backend/stored revision moved
 *    ahead of baseRevision. If someone else (or another tab) saved changes while this client
 *    was offline, halts overwrite and triggers the existing TabNotice conflict UI
 *    ("This layout was changed while you were offline") offering Reload or Save mine as a copy.
 */

import { v4 as uuidv4 } from 'uuid';
import { useWorkspaceStore } from '../store/workspaceStore';

export const SYNC_QUEUE_KEY = 'dwtwin_sync_queue';
export const CONFLICT_OFFLINE_MESSAGE = 'This layout was changed while you were offline';

const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const MAX_RETRIES = 10;

let _retryTimer = null;
let _retryAttempt = 0;
let _isDraining = false;
let _listenersAttached = false;
let _customPersistFn = null;

/**
 * Check if the browser is currently online.
 * In Node or test environments where navigator is mock/undefined, defaults to true.
 */
export function isOnline() {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

/**
 * Read raw queue array from localStorage.
 * @returns {Array<object>}
 */
export function getSyncQueue() {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[syncQueue] failed to read sync queue from storage:', err);
    return [];
  }
}

/**
 * Save queue array to localStorage.
 * @param {Array<object>} queue
 */
export function saveSyncQueue(queue) {
  try {
    if (!queue || queue.length === 0) {
      localStorage.removeItem(SYNC_QUEUE_KEY);
    } else {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (err) {
    console.error('[syncQueue] failed to persist sync queue:', err);
  }
}

/**
 * Number of pending sync items in queue, optionally filtered by layout.
 * @param {string} [companyId]
 * @param {string} [layoutId]
 * @returns {number}
 */
export function getPendingCount(companyId, layoutId) {
  const queue = getSyncQueue();
  if (!companyId && !layoutId) return queue.length;
  return queue.filter((item) =>
    (!companyId || item.companyId === companyId) &&
    (!layoutId || item.layoutId === layoutId)
  ).length;
}

/**
 * Clear all items from the sync queue.
 */
export function clearSyncQueue() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _retryAttempt = 0;
  saveSyncQueue([]);
  useWorkspaceStore.getState().setPendingSyncCount?.(0);
}

/**
 * Remove queued save operations for a specific layout (e.g. after reload or fork).
 * @param {string} companyId
 * @param {string} layoutId
 */
export function dequeueLayoutSync(companyId, layoutId) {
  const queue = getSyncQueue().filter(
    (item) => !(item.companyId === companyId && item.layoutId === layoutId)
  );
  saveSyncQueue(queue);
  useWorkspaceStore.getState().setPendingSyncCount?.(queue.length);
}

/**
 * Enqueue a layout save for offline sync.
 * If an item for the same (companyId, layoutId) is already queued, coalesce:
 * update payload and timestamp while preserving the original baseRevision.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.layoutId
 * @param {object} params.payload
 * @param {number} params.baseRevision
 * @returns {object} the queued item
 */
export function enqueueSync({ companyId, layoutId, payload, baseRevision }) {
  if (!companyId || !layoutId || !payload) {
    throw new Error('companyId, layoutId, and payload are required to enqueue sync');
  }

  const queue = getSyncQueue();
  const existingIdx = queue.findIndex(
    (item) => item.companyId === companyId && item.layoutId === layoutId
  );

  let item;
  if (existingIdx >= 0) {
    item = {
      ...queue[existingIdx],
      payload,
      timestamp: Date.now(),
      // Retain original baseRevision from before offline mutations started
    };
    queue[existingIdx] = item;
  } else {
    item = {
      id: `sync_${Date.now()}_${uuidv4().slice(0, 8)}`,
      companyId,
      layoutId,
      payload,
      baseRevision: Number.isFinite(baseRevision) ? baseRevision : 0,
      timestamp: Date.now(),
      retries: 0,
    };
    queue.push(item);
  }

  saveSyncQueue(queue);
  useWorkspaceStore.getState().setPendingSyncCount?.(queue.length);
  return item;
}

/**
 * Drain the sync queue by executing persist calls sequentially.
 *
 * @param {Function} [persistFn] (item) => Promise<{ ok: boolean, conflict?: boolean, error?: string, revision?: number }>
 * @returns {Promise<{ drained: number, remaining: number, conflict?: boolean }>}
 */
export async function drainSyncQueue(persistFn = _customPersistFn) {
  if (_isDraining) {
    return { drained: 0, remaining: getPendingCount() };
  }

  const queue = getSyncQueue();
  if (queue.length === 0) {
    _retryAttempt = 0;
    useWorkspaceStore.getState().setPendingSyncCount?.(0);
    return { drained: 0, remaining: 0 };
  }

  if (!isOnline()) {
    return { drained: 0, remaining: queue.length };
  }

  if (!persistFn) {
    console.warn('[syncQueue] No persist function provided to drainSyncQueue');
    return { drained: 0, remaining: queue.length };
  }

  _isDraining = true;
  useWorkspaceStore.getState().setSyncStatus?.('syncing');

  let drainedCount = 0;
  const remainingQueue = [...queue];

  try {
    while (remainingQueue.length > 0) {
      if (!isOnline()) break;

      const item = remainingQueue[0];
      try {
        const result = await persistFn(item);

        if (result && result.conflict) {
          // Conflict detected! Backend revision moved ahead while offline
          console.warn('[syncQueue] Conflict detected during sync drain for layout:', item.layoutId);
          useWorkspaceStore.getState().markSaveConflict(CONFLICT_OFFLINE_MESSAGE);
          useWorkspaceStore.getState().setSyncStatus?.('conflict');
          // Leave item in queue or let user resolve via TabNotice Reload or Save as Copy
          saveSyncQueue(remainingQueue);
          useWorkspaceStore.getState().setPendingSyncCount?.(remainingQueue.length);
          return { drained: drainedCount, remaining: remainingQueue.length, conflict: true };
        }

        if (result && result.ok) {
          // Successfully persisted
          remainingQueue.shift();
          drainedCount++;
          saveSyncQueue(remainingQueue);
          useWorkspaceStore.getState().setPendingSyncCount?.(remainingQueue.length);
          _retryAttempt = 0;
        } else {
          // Failed to persist (network error or server reject)
          throw new Error(result?.error || 'Sync persistence failed');
        }
      } catch (err) {
        console.warn('[syncQueue] error persisting queued item:', err);
        item.retries = (item.retries || 0) + 1;
        saveSyncQueue(remainingQueue);
        scheduleRetry(persistFn);
        break;
      }
    }

    if (remainingQueue.length === 0) {
      useWorkspaceStore.getState().setSyncStatus?.('online');
      useWorkspaceStore.getState().markSaved?.();
    } else if (!isOnline()) {
      useWorkspaceStore.getState().setSyncStatus?.('offline');
    }

    return { drained: drainedCount, remaining: remainingQueue.length };
  } finally {
    _isDraining = false;
  }
}

/**
 * Schedule next retry using exponential backoff.
 */
function scheduleRetry(persistFn) {
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryAttempt++;

  if (_retryAttempt > MAX_RETRIES) {
    console.error(`[syncQueue] Max retries (${MAX_RETRIES}) reached. Sync paused until next connection event.`);
    return;
  }

  const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, _retryAttempt - 1), MAX_RETRY_DELAY);
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    drainSyncQueue(persistFn);
  }, delay);
}

/**
 * Attach browser event listeners for 'online' and 'offline' transitions.
 *
 * @param {Function} persistFn Default persist function to use during drain
 * @returns {Function} cleanup function to remove listeners
 */
export function startSyncListener(persistFn) {
  _customPersistFn = persistFn;

  if (typeof window === 'undefined' || !window.addEventListener) {
    return () => {};
  }

  if (_listenersAttached) {
    return stopSyncListener;
  }

  const handleOnline = () => {
    useWorkspaceStore.getState().setSyncStatus?.('online');
    drainSyncQueue(persistFn);
  };

  const handleOffline = () => {
    useWorkspaceStore.getState().setSyncStatus?.('offline');
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  _listenersAttached = true;

  // Initial check on startup
  if (isOnline()) {
    drainSyncQueue(persistFn);
  } else {
    useWorkspaceStore.getState().setSyncStatus?.('offline');
  }

  return stopSyncListener;
}

/**
 * Stop sync listener and clear timers.
 */
export function stopSyncListener() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _retryAttempt = 0;
  _listenersAttached = false;
  _customPersistFn = null;
}
