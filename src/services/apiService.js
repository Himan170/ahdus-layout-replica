/**
 * apiService.js
 *
 * Handles saving and loading workspace layouts. Uses localStorage as a
 * mock backend for now — the API surface is designed so switching to
 * a real REST/GraphQL backend (PostgreSQL) requires only swapping the
 * storage calls, not the store wiring.
 *
 * Saving:
 *  - Auto-save, debounced (SAVE_DELAY after the last change), whenever the
 *    layout changes: rooms, objects, floors, anchor data. Every editorHistory
 *    command (and its undo/redo) changes one of these.
 *  - Saved at once when leaving the editor (saveNow), switching Studio ↔ Preview,
 *    and when the tab is closed or hidden (beforeunload / pagehide / visibilitychange).
 *  - A failed save keeps isDirty and puts the reason in store.saveError
 *    (the header shows "Not saved"); the next change retries.
 *
 * Several tabs on one layout (one browser = one localStorage):
 *  - Every save stores a `revision` (1, 2, 3…). A tab remembers the revision it
 *    loaded or last saved; before writing it re-reads the stored one. If another
 *    tab saved since, it does NOT overwrite: store.saveConflict is set and the
 *    editor shows "This layout was changed in another tab" (Reload / Save mine
 *    as a copy). The `storage` event shows the same message as soon as the other
 *    tab saves. Supabase will need the same check (a revision column).
 *  - Open editors say hello on a BroadcastChannel, so a tab knows when the same
 *    layout is open elsewhere (store.openElsewhere: "Also open in another tab").
 *
 * localStorage is per ORIGIN (host + port): layouts saved on localhost:3000 are
 * not visible on localhost:3001. vite.config.js sets strictPort for this reason.
 *
 * Keys: dwtwin_<companyId>_<layoutId>          = layout data,
 *       dwtwin_<companyId>_<layoutId>_versions = its version history (newest first),
 *       dwtwin_<companyId>_layouts             = index of the company's layouts.
 *
 * Version history (R4): named versions ("Save" in the header's Version history)
 * and auto checkpoints (at most one per AUTO_VERSION_EVERY of editing). At most
 * MAX_AUTO_VERSIONS + MAX_NAMED_VERSIONS per layout, the oldest dropped first.
 * Versions never block saving the layout: when storage is full, old auto
 * checkpoints are dropped to make room, and a version that fails is skipped.
 *
 * Supabase (R2) is a PROTOTYPE: OFF unless VITE_LAYOUT_BACKEND=supabase (and the
 * URL / key) are set; without the flag nothing here touches the network.
 * Production saving goes through the platform API, which takes the tenant from
 * the server session, never from a company_id sent by the browser.
 */

import { useWorkspaceStore } from '../store/workspaceStore';
import { layoutSummary, normaliseLayout } from '../store/layoutData';
import { v4 as uuidv4 } from 'uuid';
import {
  enqueueSync,
  isOnline,
  startSyncListener,
  stopSyncListener,
  dequeueLayoutSync,
} from './syncQueue';
import { supabase, isSupabaseConfigured } from './supabaseClient';

// ─── Config ───
const SAVE_DELAY     = 1000;  // ms — debounce trailing edge
const STORAGE_PREFIX = 'dwtwin_';
const CHANGED_ELSEWHERE = 'This layout was changed in another tab';
/** Browsers give a site about 5 MB of localStorage, for ALL its layouts together. */
const STORAGE_QUOTA = 5_000_000;
const NEARLY_FULL = 0.8;
/** Exported layout files (<name>.ahdus.json). */
export const LAYOUT_FILE_FORMAT = 'ahdus-layout';
const NO_SPACE = 'The browser has no space left for this layout. Export your layouts and delete old ones';
const NOT_A_LAYOUT = 'This file is not an AHDUS layout';
/** Version history limits, per layout. */
export const AUTO_VERSION_EVERY = 10 * 60 * 1000; // ms of editing between auto checkpoints
export const MAX_AUTO_VERSIONS  = 20;
export const MAX_NAMED_VERSIONS = 30;
const AUTO_VERSION_NAME = 'Auto-save checkpoint';
const NO_SPACE_FOR_VERSION = 'No space left for another version';

/**
 * PROTOTYPE: the browser talks to Supabase only with VITE_LAYOUT_BACKEND=supabase
 * as well as the URL and key. Read at call time (tests use vi.stubEnv).
 */
function _supabaseOn() {
  return import.meta.env?.VITE_LAYOUT_BACKEND === 'supabase' && isSupabaseConfigured && !!supabase;
}

function isQuotaError(err) {
  return err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

// ─── Internal helpers ───

function storageKey(companyId, layoutId) {
  return `${STORAGE_PREFIX}${companyId}_${layoutId}`;
}

function listKey(companyId) {
  return `${STORAGE_PREFIX}${companyId}_layouts`;
}

function versionsKey(companyId, layoutId) {
  return `${STORAGE_PREFIX}${companyId}_${layoutId}_versions`;
}

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return JSON.parse(raw);
}

// ─── Mock backend (localStorage) & Local Cache ───

function newLayoutId(companyId = null) {
  let id;
  do {
    id = `layout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  } while (companyId && localStorage.getItem(storageKey(companyId, id)) !== null);
  return id;
}

/** The revision of a saved layout (0 for saves from before revisions), or null if there is none. */
function _storedRevision(companyId, layoutId) {
  const raw = localStorage.getItem(storageKey(companyId, layoutId));
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw)?.revision;
    return Number.isFinite(r) ? r : 0;
  } catch {
    return 0;
  }
}

/**
 * Write a layout and its entry in the company's index in localStorage.
 * Acts as an offline cache and synchronous fallback.
 */
function _persistToBackend(companyId, layoutId, payload, revision) {
  const savedAt = new Date().toISOString();
  _setItemMakingRoom(storageKey(companyId, layoutId), JSON.stringify({ ...payload, revision, savedAt }));

  let index;
  try { index = readJson(listKey(companyId), []); } catch { index = []; }
  if (!Array.isArray(index)) index = [];
  const entry = { id: layoutId, name: payload.layoutName, updatedAt: savedAt };
  const i = index.findIndex((l) => l.id === layoutId);
  if (i >= 0) index[i] = entry; else index.push(entry);
  _setItemMakingRoom(listKey(companyId), JSON.stringify(index));
  return { ok: true, savedAt };
}

/**
 * localStorage.setItem; if storage is full, drop old auto checkpoints (any
 * layout's, oldest first) until it fits. Throws the quota error if none are left.
 */
function _setItemMakingRoom(key, value) {
  for (;;) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (err) {
      if (!isQuotaError(err) || !_dropOldestAutoVersion(key)) throw err;
    }
  }
}

function _loadFromBackend(companyId, layoutId) {
  return readJson(storageKey(companyId, layoutId), null);
}

function isUuid(str) {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ─── Real Supabase Backend Integration (Task R2) ───

/**
 * Persists a layout to Supabase with server-side Compare-And-Set (CAS) revision check.
 * Updates the row only if revision matches baseRevision, preventing concurrent overwrite.
 */
async function _persistToSupabase(companyId, layoutId, payload, baseRevision) {
  if (!_supabaseOn() || !isUuid(companyId) || !isUuid(layoutId)) {
    return { ok: false, error: 'Supabase client is not configured or IDs are not UUIDs' };
  }
  const savedAt = new Date().toISOString();
  const nextRevision = (Number.isFinite(baseRevision) ? baseRevision : 0) + 1;

  // 1. Attempt atomic Compare-And-Set UPDATE where revision matches baseRevision
  const { data: updated, error: updateError } = await supabase
    .from('workspace_layouts')
    .update({
      name: payload.layoutName || 'Untitled Layout',
      metadata: payload,
      revision: nextRevision,
      updated_at: savedAt,
    })
    .eq('id', layoutId)
    .eq('company_id', companyId)
    .eq('revision', baseRevision)
    .select('id, revision, updated_at');

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  if (updated && updated.length > 0) {
    return { ok: true, revision: updated[0].revision, savedAt };
  }

  // 2. If 0 rows updated, verify if layout already exists with a different revision
  const { data: existing, error: checkError } = await supabase
    .from('workspace_layouts')
    .select('id, revision')
    .eq('id', layoutId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (checkError) {
    return { ok: false, error: checkError.message };
  }

  if (existing) {
    // Conflict! Server has a different (typically higher) revision
    return { ok: false, conflict: true, error: CHANGED_ELSEWHERE, serverRevision: existing.revision };
  }

  // 3. Row does not exist yet: insert initial layout row with revision = 1
  const { data: inserted, error: insertError } = await supabase
    .from('workspace_layouts')
    .insert({
      id: layoutId,
      company_id: companyId,
      name: payload.layoutName || 'Untitled Layout',
      revision: 1,
      version: payload.layoutVersion || 1,
      metadata: payload,
      created_at: savedAt,
      updated_at: savedAt,
    })
    .select('id, revision, updated_at');

  if (insertError) {
    if (insertError.code === '23505') { // unique violation
      return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
    }
    return { ok: false, error: insertError.message };
  }

  return { ok: true, revision: 1, savedAt };
}

/**
 * Load a layout from Supabase workspace_layouts table.
 */
async function _loadFromSupabase(companyId, layoutId) {
  if (!_supabaseOn() || !isUuid(companyId) || !isUuid(layoutId)) return null;
  const { data, error } = await supabase
    .from('workspace_layouts')
    .select('id, name, revision, version, metadata, updated_at')
    .eq('id', layoutId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error || !data) return null;
  const payload = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  return {
    ...payload,
    layoutName: data.name || payload.layoutName || 'Untitled Layout',
    layoutVersion: data.version || payload.layoutVersion || 1,
    revision: data.revision,
    savedAt: data.updated_at,
  };
}

/**
 * List layouts for a company from Supabase.
 */
async function _listFromSupabase(companyId) {
  if (!_supabaseOn() || !isUuid(companyId)) return null;
  const { data, error } = await supabase
    .from('workspace_layouts')
    .select('id, name, revision, version, metadata, updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  if (error || !data) return null;
  return data.map((row) => {
    const payload = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return layoutSummary(row.id, {
      ...payload,
      layoutName: row.name || payload.layoutName,
      layoutVersion: row.version || payload.layoutVersion,
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  });
}

/**
 * Delete a layout from Supabase.
 */
async function _deleteFromSupabase(companyId, layoutId) {
  if (!_supabaseOn() || !isUuid(companyId) || !isUuid(layoutId)) return;
  await supabase
    .from('workspace_layouts')
    .delete()
    .eq('id', layoutId)
    .eq('company_id', companyId);
}

// ─── Realtime Subscription (Multi-tab & Multi-client) ───

let _realtimeChannel = null;

export function _subscribeRealtime(companyId, layoutId) {
  if (!_supabaseOn() || !layoutId || typeof supabase.channel !== 'function') return;
  if (_realtimeChannel) {
    try { supabase.removeChannel(_realtimeChannel); } catch { /* ignore */ }
    _realtimeChannel = null;
  }
  try {
    _realtimeChannel = supabase
      .channel(`layout-${layoutId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workspace_layouts',
          filter: `id=eq.${layoutId}`,
        },
        (payload) => {
          const nextRev = payload.new?.revision;
          if (Number.isFinite(nextRev) && nextRev > _revision) {
            _conflict();
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('[apiService] failed to subscribe to Supabase realtime:', err);
  }
}

export function _unsubscribeRealtime() {
  if (_realtimeChannel && supabase && typeof supabase.removeChannel === 'function') {
    try { supabase.removeChannel(_realtimeChannel); } catch { /* ignore */ }
    _realtimeChannel = null;
  }
}

// ─── Saving ───

let _debounceTimer = null;
/** Revision of the open layout as this tab loaded or last saved it. */
let _revision = 0;

export function _setRevisionForTesting(r = 0) {
  _revision = r;
}

export function _getRevision() {
  return _revision;
}

function _conflict() {
  useWorkspaceStore.getState().markSaveConflict(CHANGED_ELSEWHERE);
  return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
}

/**
 * Persist an item from the offline sync queue.
 * Checks for conflict before applying to storage.
 */
export async function _persistQueueItem(item) {
  // Check local stored revision first
  const stored = _storedRevision(item.companyId, item.layoutId);
  if (stored !== null && stored > item.baseRevision) {
    return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
  }

  // If Supabase is configured with UUIDs, perform server-side CAS check
  if (_supabaseOn() && isOnline() && isUuid(item.companyId) && isUuid(item.layoutId)) {
    const res = await _persistToSupabase(item.companyId, item.layoutId, item.payload, item.baseRevision);
    if (res.conflict) {
      return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
    }
    if (res.ok) {
      const revision = res.revision;
      _persistToBackend(item.companyId, item.layoutId, item.payload, revision);
      const state = useWorkspaceStore.getState();
      if (state.companyId === item.companyId && state.layoutId === item.layoutId) {
        _revision = revision;
        state.markSaved();
        state.setStorageNearlyFull?.(storageUse().nearlyFull);
      }
      return { ok: true, revision };
    }
    throw new Error(res.error || 'Failed to sync to Supabase');
  }

  // Fallback to local storage
  const revision = Math.max(item.baseRevision, stored ?? 0) + 1;
  _persistToBackend(item.companyId, item.layoutId, item.payload, revision);
  const state = useWorkspaceStore.getState();
  if (state.companyId === item.companyId && state.layoutId === item.layoutId) {
    _revision = revision;
    state.markSaved();
    state.setStorageNearlyFull?.(storageUse().nearlyFull);
  }
  return { ok: true, revision };
}

/**
 * Save the open layout now if it has unsaved changes (or always, with force).
 * Uses server-side Compare-And-Set revision check when Supabase is connected,
 * falling back to localStorage offline cache.
 * @returns {{ ok: boolean, skipped?: boolean, conflict?: boolean, error?: string, queued?: boolean }}
 */
function _saveSync({ force = false } = {}) {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  const state = useWorkspaceStore.getState();
  if (!state.companyId || !state.layoutId) return { ok: true, skipped: true }; // nowhere to save
  if (state.saveConflict) return _conflict();                                  // wait for Reload / Save a copy
  if (!state.isDirty && !force) return { ok: true, skipped: true };            // nothing changed

  const payload = state.exportWorkspace();

  if (!isOnline()) {
    // R7: Offline mode — queue the save and update local cache so it syncs when back online
    enqueueSync({
      companyId: state.companyId,
      layoutId: state.layoutId,
      payload,
      baseRevision: _revision,
    });
    try {
      _persistToBackend(state.companyId, state.layoutId, payload, _revision);
    } catch (err) {
      console.warn('[apiService] offline cache write failed (the save is still queued):', err);
    }
    useWorkspaceStore.getState().setSyncStatus?.('offline');
    useWorkspaceStore.getState().markSaveFailed?.('Offline (changes queued)');
    return { ok: true, queued: true };
  }

  try {
    const stored = _storedRevision(state.companyId, state.layoutId);
    if (stored !== null && stored > _revision) return _conflict();
    const revision = Math.max(_revision, stored ?? 0) + 1;
    _persistToBackend(state.companyId, state.layoutId, payload, revision);
    _revision = revision;
    useWorkspaceStore.getState().markSaved();
    useWorkspaceStore.getState().setStorageNearlyFull(storageUse().nearlyFull);
    _post('open');

    // Asynchronously push to Supabase with CAS revision check if configured with UUIDs
    if (_supabaseOn() && isUuid(state.companyId) && isUuid(state.layoutId)) {
      _persistToSupabase(state.companyId, state.layoutId, payload, _revision - 1).then((res) => {
        if (res.conflict) {
          _conflict();
        } else if (res.ok && res.revision) {
          _revision = res.revision;
          _persistToBackend(state.companyId, state.layoutId, payload, _revision);
        }
      }).catch((err) => {
        console.warn('[apiService] background Supabase CAS sync failed:', err);
      });
    }

    // R4: an auto checkpoint after every AUTO_VERSION_EVERY of editing (after the save: it never blocks it)
    try {
      _maybeAutoVersion(state.companyId, state.layoutId, payload);
    } catch (err) {
      console.warn('[apiService] auto-save version checkpoint failed:', err);
    }

    return { ok: true };
  } catch (err) {
    const error = isQuotaError(err) ? NO_SPACE : (err?.message || 'Could not save');
    console.error('[apiService] save failed:', err);
    if (!isQuotaError(err)) {
      // Network or unexpected failure: queue for retry
      enqueueSync({
        companyId: state.companyId,
        layoutId: state.layoutId,
        payload,
        baseRevision: _revision,
      });
      useWorkspaceStore.getState().setSyncStatus?.('offline');
    }
    useWorkspaceStore.getState().markSaveFailed(error);
    return { ok: false, error };
  }
}

function _scheduleSave() {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _saveSync();
  }, SAVE_DELAY);
}

// ─── Public API ───

/**
 * Load a workspace layout from the backend. Old saves are filled in with
 * defaults (store/layoutData.js). Throws if the saved data is unreadable.
 * @param {string} companyId
 * @param {string} layoutId
 * @returns {Promise<boolean>} true if layout was found and loaded
 */
export async function loadWorkspace(companyId, layoutId) {
  let data = null;

  if (_supabaseOn() && isOnline()) {
    try {
      data = await _loadFromSupabase(companyId, layoutId);
      if (data) {
        // Cache loaded data into localStorage for offline use
        _persistToBackend(companyId, layoutId, data, data.revision || 0);
      }
    } catch (err) {
      console.warn('[apiService] Supabase load error, falling back to cache:', err);
    }
  }

  if (!data) {
    data = _loadFromBackend(companyId, layoutId);
  }
  if (!data) return false;

  const store = useWorkspaceStore.getState();
  store.loadWorkspace(data);
  const summary = layoutSummary(layoutId, data);
  store.setTenant(companyId, layoutId, summary.name, data.layoutVersion ?? 1);
  _revision = Number.isFinite(data.revision) ? data.revision : 0;
  store.setStorageNearlyFull(storageUse().nearlyFull);
  _subscribeRealtime(companyId, layoutId);
  return true;
}

/**
 * A saved layout as it is stored (a save: v1), without opening it in the app's
 * store. For <LayoutViewer companyId layoutId />, which keeps its own copy.
 * Synchronous read from local cache.
 * @returns {object|null} null if there is no such layout
 */
export function readSavedLayout(companyId, layoutId) {
  return _loadFromBackend(companyId, layoutId);
}

/**
 * "Reload": throw away this tab's unsaved changes and load what the other tab
 * saved. The caller clears its undo history (it describes the old state).
 * @returns {Promise<boolean>} false if the layout is gone
 */
export async function reloadLayout() {
  const { companyId, layoutId } = useWorkspaceStore.getState();
  if (!companyId || !layoutId) return false;
  dequeueLayoutSync(companyId, layoutId);
  return loadWorkspace(companyId, layoutId);
}

/**
 * "Save mine as a copy": keep this tab's version as a new layout, "<name> (copy)",
 * and go on editing that one. The other tab's save stays as it is.
 * @returns {Promise<{ ok: boolean, layoutId?: string, error?: string }>}
 */
export async function saveAsCopy() {
  const store = useWorkspaceStore.getState();
  if (!store.companyId) return { ok: false, error: 'This layout has no place to save to' };
  dequeueLayoutSync(store.companyId, store.layoutId);
  const layoutId = newLayoutId();
  const name = `${store.layoutName} (copy)`;
  try {
    store.setTenant(store.companyId, layoutId, name, store.layoutVersion);
    const payload = useWorkspaceStore.getState().exportWorkspace();
    if (_supabaseOn() && isOnline()) {
      await _persistToSupabase(store.companyId, layoutId, payload, 0);
    }
    _persistToBackend(store.companyId, layoutId, payload, 1);
  } catch (err) {
    useWorkspaceStore.getState().markSaveFailed(err?.name === 'QuotaExceededError' ? NO_SPACE : (err?.message || 'Could not save'));
    return { ok: false, error: useWorkspaceStore.getState().saveError };
  }
  _revision = 1;
  useWorkspaceStore.setState({ saveConflict: false });
  useWorkspaceStore.getState().markSaved();
  _announce();
  return { ok: true, layoutId };
}

/**
 * Create a new empty workspace layout.
 * @param {string} companyId
 * @param {string} name
 * @returns {Promise<string>} the new layout ID
 */
export async function createWorkspace(companyId, name = 'Untitled Layout', initialLayout = null) {
  const layoutId = newLayoutId(companyId);
  const store = useWorkspaceStore.getState();
  let normalized = null;
  if (initialLayout) {
    const template = JSON.parse(JSON.stringify(initialLayout));
    const roomIds = new Set();
    const objectIds = new Set();
    const rooms = Array.isArray(template.rooms) ? template.rooms : [];
    const objects = Array.isArray(template.objects) ? template.objects : [];
    for (const room of rooms) {
      if (typeof room?.id !== 'string' || roomIds.has(room.id)) {
        throw new Error('Template contains a missing or duplicate room ID');
      }
      roomIds.add(room.id);
    }
    for (const object of objects) {
      if (typeof object?.id !== 'string' || objectIds.has(object.id)) {
        throw new Error('Template contains a missing or duplicate object ID');
      }
      objectIds.add(object.id);
      if (object.roomId && !roomIds.has(object.roomId)) {
        throw new Error(`Template object "${object.id}" references a missing room`);
      }
    }
    normalized = normaliseLayout(template);
    const freshRoomIds = new Map(normalized.rooms.map((room) => [room.id, uuidv4()]));
    const freshObjectIds = new Map(normalized.objects.map((object) => [object.id, uuidv4()]));
    normalized.rooms = normalized.rooms.map((room) => ({
      ...room,
      id: freshRoomIds.get(room.id),
    }));
    normalized.objects = normalized.objects.map((object) => ({
      ...object,
      id: freshObjectIds.get(object.id),
      roomId: object.roomId ? freshRoomIds.get(object.roomId) : null,
    }));
    normalized.layoutName = name;
  }
  store.resetWorkspace();
  if (normalized) store.loadWorkspace(normalized);
  store.setTenant(companyId, layoutId, name, 1);
  const payload = store.exportWorkspace();

  if (_supabaseOn() && isOnline()) {
    try {
      await _persistToSupabase(companyId, layoutId, payload, 0);
    } catch (err) {
      console.warn('[apiService] Supabase initial create error:', err);
    }
  }
  // Write the empty layout now, so it is in the list even before the first change
  _persistToBackend(companyId, layoutId, payload, 1);
  _revision = 1;
  return layoutId;
}

/**
 * Save the workspace now (bypasses the debounce).
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function saveNow() {
  return _saveSync();
}

/**
 * Rename the open layout and save the new name straight away (also in the
 * company's layout list). Not an undoable layout change: the name is not part
 * of the layout's history.
 * @param {string} name
 */
export async function renameLayout(name) {
  const store = useWorkspaceStore.getState();
  if (!name || name === store.layoutName) return;
  store.setTenant(store.companyId, store.layoutId, name, store.layoutVersion);
  if (_supabaseOn() && isOnline()) {
    try {
      await supabase
        .from('workspace_layouts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', store.layoutId)
        .eq('company_id', store.companyId);
    } catch (err) {
      console.warn('[apiService] Supabase rename error:', err);
    }
  }
  return _saveSync({ force: true });
}

/**
 * The layouts of a company that really exist (have saved data), most recently
 * edited first. Also repairs the company's index: entries without data are
 * dropped, and saved layouts missing from it are added.
 * @param {string} companyId
 * @returns {Promise<Array<{ id, name, rooms, floors, updatedAt, broken? }>>}
 */
export async function listLayouts(companyId) {
  if (_supabaseOn() && isOnline()) {
    try {
      const remote = await _listFromSupabase(companyId);
      if (remote && Array.isArray(remote)) {
        try {
          localStorage.setItem(listKey(companyId), JSON.stringify(
            remote.map((l) => ({ id: l.id, name: l.name, updatedAt: l.updatedAt }))
          ));
        } catch { /* ignore */ }
        return remote;
      }
    } catch (err) {
      console.warn('[apiService] Supabase list error, falling back to cache:', err);
    }
  }

  let index;
  try { index = readJson(listKey(companyId), []); } catch { index = []; }
  if (!Array.isArray(index)) index = [];

  const prefix = `${STORAGE_PREFIX}${companyId}_layout_`;
  const ids = new Set(index.map((l) => l?.id).filter(Boolean));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) ids.add(key.slice(`${STORAGE_PREFIX}${companyId}_`.length));
  }

  const list = [];
  for (const id of ids) {
    const raw = localStorage.getItem(storageKey(companyId, id));
    if (raw === null) continue; // listed but never saved / deleted: not a layout
    try {
      list.push(layoutSummary(id, JSON.parse(raw)));
    } catch (err) {
      const name = index.find((l) => l.id === id)?.name ?? 'Unnamed layout';
      console.warn(`[apiService] layout ${id} can't be read:`, err);
      list.push({ id, name, rooms: 0, floors: 0, updatedAt: null, broken: true });
    }
  }
  list.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));

  try {
    localStorage.setItem(listKey(companyId), JSON.stringify(
      list.map((l) => ({ id: l.id, name: l.name, updatedAt: l.updatedAt }))));
  } catch { /* the list still works without the repaired index */ }

  return list;
}

// ─── Companies (dwtwin_companies: [{ id, name, createdAt }]) ───

const COMPANIES_KEY = `${STORAGE_PREFIX}companies`;

/** @returns {Array<{ id: string, name: string, createdAt?: string }>} */
export function listCompanies() {
  try {
    const list = readJson(COMPANIES_KEY, []);
    return Array.isArray(list) ? list.filter((c) => c && c.id) : [];
  } catch {
    return [];
  }
}

function writeCompanies(list) {
  localStorage.setItem(COMPANIES_KEY, JSON.stringify(list));
}

/** Add a company. @returns {{ id, name, createdAt }} */
export function addCompany(name) {
  const company = {
    id: `company_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  writeCompanies([...listCompanies(), company]);
  return company;
}

export function renameCompany(companyId, name) {
  const next = name.trim();
  if (!next) return;
  writeCompanies(listCompanies().map((c) => (c.id === companyId ? { ...c, name: next } : c)));
}

/** Delete a company and ALL its layouts. */
export function deleteCompany(companyId) {
  const prefix = `${STORAGE_PREFIX}${companyId}_`;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
  writeCompanies(listCompanies().filter((c) => c.id !== companyId));
}

/** How many layouts a company has (its layout data, not just index entries). */
export function countLayouts(companyId) {
  const prefix = `${STORAGE_PREFIX}${companyId}_layout_`;
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) n++;
  return n;
}

// ─── Backup: export / import layout files ───

/** "HQ North.ahdus.json" (characters files can't have are replaced). */
export function layoutFileName(name) {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
  const safe = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim();
  return `${safe || 'Layout'}.ahdus.json`;
}

/**
 * A layout as a file to download (a backup, or to move it to another browser).
 * The open layout is saved first, so the file has its latest changes.
 * @returns {Promise<{ fileName: string, text: string }>}
 */
export async function exportLayout(companyId, layoutId) {
  const st = useWorkspaceStore.getState();
  let data;
  if (st.companyId === companyId && st.layoutId === layoutId) {
    await _saveSync();
    data = useWorkspaceStore.getState().exportWorkspace();
  } else {
    if (_supabaseOn() && isOnline()) {
      try {
        data = await _loadFromSupabase(companyId, layoutId);
      } catch { /* fallback to local */ }
    }
    if (!data) {
      data = _loadFromBackend(companyId, layoutId);
    }
  }
  if (!data) throw new Error('This layout no longer exists');
  const { companyId: _c, layoutId: _l, revision: _r, savedAt: _s, exportedAt: _e, ...layout } = data;
  const file = { format: LAYOUT_FILE_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), layout };
  return { fileName: layoutFileName(layout.layoutName), text: JSON.stringify(file, null, 2) };
}

/**
 * Add a layout from an exported file to a company's layouts (a new layout; the
 * file's rooms, items and their ids are kept, so other modules' links still
 * work). Old files are filled in like old saves (normaliseLayout).
 * @param {string} text  the file's contents
 * @returns {Promise<{ id: string, name: string }>}  throws with a short reason
 */
export async function importLayout(companyId, text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(NOT_A_LAYOUT); }
  const layout = parsed?.format === LAYOUT_FILE_FORMAT ? parsed.layout : parsed;
  const looksLikeLayout = layout && typeof layout === 'object' && !Array.isArray(layout) &&
    ['rooms', 'objects', 'floors'].some((k) => k in layout);
  if (!looksLikeLayout) throw new Error(NOT_A_LAYOUT);

  const n = normaliseLayout(layout);
  const layoutId = newLayoutId();
  const payload = {
    companyId, layoutId,
    layoutName: n.layoutName, layoutVersion: n.layoutVersion,
    floors: n.floors, rooms: n.rooms, objects: n.objects, anchorData: n.anchorData,
  };

  try {
    if (_supabaseOn() && isOnline()) {
      await _persistToSupabase(companyId, layoutId, payload, 0);
    }
    _persistToBackend(companyId, layoutId, payload, 1);
  } catch (err) {
    localStorage.removeItem(storageKey(companyId, layoutId));
    throw new Error(err?.name === 'QuotaExceededError' ? NO_SPACE : (err?.message || 'Could not import'), { cause: err });
  }
  return { id: layoutId, name: n.layoutName };
}

/**
 * How much of the browser's storage the app uses (all companies and layouts).
 * @returns {{ used: number, quota: number, nearlyFull: boolean }}  used / quota in characters (~bytes)
 */
export function storageUse() {
  let used = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      used += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
  } catch { /* storage blocked: report empty */ }
  return { used, quota: STORAGE_QUOTA, nearlyFull: used >= STORAGE_QUOTA * NEARLY_FULL };
}

/**
 * Delete a layout.
 * @param {string} companyId
 * @param {string} layoutId
 */
export async function deleteLayout(companyId, layoutId) {
  if (_supabaseOn() && isOnline()) {
    try {
      await _deleteFromSupabase(companyId, layoutId);
    } catch (err) {
      console.warn('[apiService] Supabase delete error:', err);
    }
  }
  localStorage.removeItem(storageKey(companyId, layoutId));
  localStorage.removeItem(versionsKey(companyId, layoutId));
  let index;
  try { index = readJson(listKey(companyId), []); } catch { index = []; }
  const filtered = (Array.isArray(index) ? index : []).filter((l) => l.id !== layoutId);
  localStorage.setItem(listKey(companyId), JSON.stringify(filtered));
}

// ─── Other tabs ───

const TAB_ID = Math.random().toString(36).slice(2, 10);
let _channel;                 // one BroadcastChannel for the page's lifetime (keeps messages in order)
const _otherTabs = new Set(); // ids of other tabs with this layout open

function _openKey() {
  const { companyId, layoutId } = useWorkspaceStore.getState();
  return companyId && layoutId ? storageKey(companyId, layoutId) : null;
}

function _getChannel() {
  if (_channel !== undefined) return _channel;
  _channel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
    ? new window.BroadcastChannel('ahdus-layouts') : null;
  if (_channel) _channel.onmessage = (e) => _onTabMessage(e.data);
  return _channel;
}

function _post(type) {
  _getChannel()?.postMessage({ type, tab: TAB_ID, key: _openKey() });
}

/** Tell other tabs which layout this editor has open (and forget who had the old one). */
function _announce() {
  if (!_unsubscribe) return; // only an open editor counts
  _otherTabs.clear();
  useWorkspaceStore.getState().setOpenElsewhere(false);
  _post('open');
}

function _onTabMessage(msg) {
  if (!msg || msg.tab === TAB_ID || !_unsubscribe) return;
  const mine = msg.key && msg.key === _openKey();
  if (mine && msg.type === 'open') { _otherTabs.add(msg.tab); _post('here'); }
  else if (mine && msg.type === 'here') _otherTabs.add(msg.tab);
  else _otherTabs.delete(msg.tab); // closed, or busy with another layout
  useWorkspaceStore.getState().setOpenElsewhere(_otherTabs.size > 0);
}

/** Another tab wrote localStorage: if it saved our layout, say so at once. */
function _onStorage(e) {
  if (!e.key || e.key !== _openKey() || e.newValue === null) return;
  let revision = 0;
  try { revision = JSON.parse(e.newValue)?.revision ?? 0; } catch { /* unreadable: treat as old */ }
  if (revision > _revision) _conflict();
}

// ─── Auto-save subscription ───

let _unsubscribe = null;

const _flush = () => { _saveSync(); };
const _onPageHide = () => { _saveSync(); _post('closed'); };
const _onVisibility = () => { if (document.visibilityState === 'hidden') _saveSync(); };

/**
 * Start auto-saving whenever the layout changes, and on closing the tab.
 * Call when the editor opens.
 */
export function startAutoSave() {
  if (_unsubscribe) return; // already running

  const stopSync = startSyncListener(_persistQueueItem);

  const unsubStore = useWorkspaceStore.subscribe(
    (s) => ({ rooms: s.rooms, objects: s.objects, floors: s.floors, anchorData: s.anchorData }),
    () => {
      // Only auto-save if we have a tenant context
      const s = useWorkspaceStore.getState();
      if (s.companyId && s.layoutId && s.isDirty) _scheduleSave();
    },
    {
      equalityFn: (a, b) => a.rooms === b.rooms && a.objects === b.objects &&
        a.floors === b.floors && a.anchorData === b.anchorData,
    }
  );
  window.addEventListener('beforeunload', _flush);
  window.addEventListener('pagehide', _onPageHide);
  window.addEventListener('storage', _onStorage);
  document.addEventListener('visibilitychange', _onVisibility);
  _unsubscribe = () => {
    unsubStore();
    stopSync?.();
    window.removeEventListener('beforeunload', _flush);
    window.removeEventListener('pagehide', _onPageHide);
    window.removeEventListener('storage', _onStorage);
    document.removeEventListener('visibilitychange', _onVisibility);
  };
  _announce();
}

/**
 * Stop auto-saving (when leaving the editor). Saves anything still pending.
 */
export function stopAutoSave() {
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
    stopSyncListener();
    _post('closed');
    _otherTabs.clear();
    useWorkspaceStore.getState().setOpenElsewhere(false);
  }
  _saveSync();
}

// ─── Version History (Task R4) ───

/** Versions from before `auto` was stored are recognised by their name. */
function isAutoVersion(v) {
  return v?.auto === true || (v?.auto === undefined && v?.name === AUTO_VERSION_NAME);
}

function _readVersions(companyId, layoutId) {
  try {
    const list = readJson(versionsKey(companyId, layoutId), []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Keep the newest MAX_AUTO_VERSIONS auto checkpoints and MAX_NAMED_VERSIONS named ones (list: newest first). */
export function capVersions(list) {
  let auto = 0;
  let named = 0;
  return list.filter((v) => (isAutoVersion(v) ? ++auto <= MAX_AUTO_VERSIONS : ++named <= MAX_NAMED_VERSIONS));
}

/**
 * Write a layout's version list (capped). If storage is full, its own oldest
 * auto checkpoints go first, then other layouts'. Never throws.
 * @returns {Array<object>|null} the list as written, or null if it did not fit
 */
function _writeVersions(companyId, layoutId, list) {
  const key = versionsKey(companyId, layoutId);
  const kept = capVersions(list);
  for (;;) {
    try {
      localStorage.setItem(key, JSON.stringify(kept));
      return kept;
    } catch (err) {
      if (!isQuotaError(err)) return null;
      let at = -1;
      kept.forEach((v, i) => { if (isAutoVersion(v)) at = i; }); // the last one is the oldest
      if (at >= 0) kept.splice(at, 1);
      else if (!_dropOldestAutoVersion(key)) return null;
    }
  }
}

/**
 * Drop the oldest auto checkpoint of any layout to free storage (not from
 * skipKey, the key being written: shrinking it would not help).
 * @returns {boolean} false if there was none to drop
 */
function _dropOldestAutoVersion(skipKey) {
  let oldest = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX) || !key.endsWith('_versions') || key === skipKey) continue;
    let list;
    try { list = JSON.parse(localStorage.getItem(key)); } catch { continue; }
    if (!Array.isArray(list)) continue;
    list.forEach((v, at) => {
      if (isAutoVersion(v) && (!oldest || String(v.created_at ?? '') < String(oldest.v.created_at ?? ''))) {
        oldest = { key, list, at, v };
      }
    });
  }
  if (!oldest) return false;
  oldest.list.splice(oldest.at, 1);
  try {
    localStorage.setItem(oldest.key, JSON.stringify(oldest.list)); // smaller than before: fits
  } catch {
    localStorage.removeItem(oldest.key);
  }
  return true;
}

/** Auto checkpoints: when this tab's editing of the open layout started (since its last checkpoint). */
let _autoVersionKey = null;
let _editingSince = 0;

/**
 * After a successful save: an auto checkpoint once AUTO_VERSION_EVERY of
 * editing has passed since the last one (auto-save runs about every second,
 * so this is time, not a count of saves). Never throws.
 */
function _maybeAutoVersion(companyId, layoutId, payload) {
  const key = versionsKey(companyId, layoutId);
  const now = Date.now();
  if (_autoVersionKey !== key) {
    _autoVersionKey = key;
    _editingSince = now;
    return;
  }
  if (now - _editingSince < AUTO_VERSION_EVERY) return;
  _editingSince = now;
  createVersion(AUTO_VERSION_NAME, { companyId, layoutId, payload, auto: true }).catch((err) => {
    console.warn('[apiService] auto-save version checkpoint failed:', err);
  });
}

export function _resetAutoVersionForTesting() {
  _autoVersionKey = null;
  _editingSince = 0;
}

/**
 * Create a new snapshot version of the layout.
 * Kept in localStorage (capped, see MAX_*_VERSIONS); also in Supabase's
 * layout_versions table when the prototype backend is on.
 * @param {string} [name] Human readable version name/note
 * @param {{ companyId?: string, layoutId?: string, payload?: object, auto?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, version?: object, error?: string }>}
 */
export async function createVersion(name = '', options = {}) {
  const state = useWorkspaceStore.getState();
  const companyId = options.companyId || state.companyId;
  const layoutId = options.layoutId || state.layoutId;

  if (!companyId || !layoutId) {
    return { ok: false, error: 'No workspace open' };
  }
  const payload = options.payload || state.exportWorkspace();
  const auto = options.auto === true;

  // Read existing versions from cache to determine next version number
  const existing = _readVersions(companyId, layoutId);
  const highestVersion = existing.length > 0
    ? Math.max(...existing.map((v) => Number(v.version) || 0))
    : 0;
  const nextVersion = highestVersion + 1;
  const versionName = name?.trim() || `Version ${nextVersion}`;
  const versionId = (isUuid(layoutId) && typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : newLayoutId();

  const versionRecord = {
    id: versionId,
    layout_id: layoutId,
    company_id: companyId,
    name: versionName,
    version: nextVersion,
    revision: _revision,
    auto,
    snapshot: payload,
    created_by: null,
    created_at: new Date().toISOString(),
  };

  // PROTOTYPE: also in Supabase, if it is on and the IDs are UUIDs
  if (_supabaseOn() && isOnline() && isUuid(companyId) && isUuid(layoutId)) {
    try {
      const insertPayload = {
        layout_id: layoutId,
        company_id: companyId,
        name: versionName,
        version: nextVersion,
        revision: Math.max(1, _revision),
        snapshot: payload,
        created_at: versionRecord.created_at,
      };
      const { data, error } = await supabase
        .from('layout_versions')
        .insert(insertPayload)
        .select();

      const created = Array.isArray(data) ? data[0] : data;
      if (!error && created?.id) {
        versionRecord.id = created.id;
      } else if (error) {
        console.warn('[apiService] Supabase layout_versions insert warning:', error);
      }
    } catch (err) {
      console.warn('[apiService] Supabase createVersion error:', err);
    }
  }

  const written = _writeVersions(companyId, layoutId, [versionRecord, ...existing]);
  const now = useWorkspaceStore.getState();
  if (now.companyId === companyId && now.layoutId === layoutId) {
    now.setStorageNearlyFull?.(storageUse().nearlyFull);
  }
  if (!written || !written.includes(versionRecord)) {
    return { ok: false, error: NO_SPACE_FOR_VERSION };
  }
  return { ok: true, version: versionRecord };
}

/**
 * List all snapshot versions for a layout, newest first.
 * From localStorage; from Supabase (and cached) when the prototype backend is on.
 * @param {string} companyId
 * @param {string} layoutId
 * @returns {Promise<Array<object>>}
 */
export async function listVersions(companyId, layoutId) {
  if (!companyId || !layoutId) return [];

  if (_supabaseOn() && isOnline() && isUuid(companyId) && isUuid(layoutId)) {
    try {
      const { data, error } = await supabase
        .from('layout_versions')
        .select('id, layout_id, company_id, name, version, revision, snapshot, created_by, created_at')
        .eq('company_id', companyId)
        .eq('layout_id', layoutId)
        .order('version', { ascending: false });

      if (!error && Array.isArray(data)) {
        _writeVersions(companyId, layoutId, data);
        return data;
      }
    } catch (err) {
      console.warn('[apiService] Supabase listVersions error, falling back to cache:', err);
    }
  }

  return _readVersions(companyId, layoutId);
}

/**
 * Restore a previous layout version through editorHistory (one undo step).
 * The layout name stays as it is: it is not part of the layout's history.
 * @param {string} companyId
 * @param {string} layoutId
 * @param {string|number} versionId Version UUID or version integer
 * @param {object} editor Editor history instance (from createEditorHistory)
 * @returns {Promise<{ ok: boolean, version?: object, error?: string }>}
 */
export async function restoreVersion(companyId, layoutId, versionId, editor) {
  if (!companyId || !layoutId) return { ok: false, error: 'No layout specified' };
  if (typeof editor?.restoreVersion !== 'function') return { ok: false, error: 'Nothing to restore into' };

  const versions = await listVersions(companyId, layoutId);
  const target = versions.find((v) => v.id === versionId || v.version === Number(versionId));
  if (!target || !target.snapshot) {
    return { ok: false, error: 'Version not found' };
  }

  const res = editor.restoreVersion(target.snapshot);
  if (res?.problem) return { ok: false, error: res.problem };
  return { ok: true, version: target };
}
