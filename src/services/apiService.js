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
 * Keys: dwtwin_<companyId>_<layoutId> = layout data,
 *       dwtwin_<companyId>_layouts    = index of the company's layouts.
 */

import { useWorkspaceStore } from '../store/workspaceStore';
import { layoutSummary, normaliseLayout } from '../store/layoutData';
import {
  enqueueSync,
  isOnline,
  startSyncListener,
  stopSyncListener,
  dequeueLayoutSync,
} from './syncQueue';

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

// ─── Internal helpers ───

function storageKey(companyId, layoutId) {
  return `${STORAGE_PREFIX}${companyId}_${layoutId}`;
}

function listKey(companyId) {
  return `${STORAGE_PREFIX}${companyId}_layouts`;
}

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return JSON.parse(raw);
}

// ─── Mock backend (localStorage) ───

function newLayoutId() {
  return `layout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
 * Write a layout and its entry in the company's index. Synchronous, so it
 * also completes inside beforeunload. Replace with a real request later.
 * Throws if the browser refuses (e.g. storage full).
 */
function _persistToBackend(companyId, layoutId, payload, revision) {
  const savedAt = new Date().toISOString();
  localStorage.setItem(storageKey(companyId, layoutId), JSON.stringify({ ...payload, revision, savedAt }));

  let index;
  try { index = readJson(listKey(companyId), []); } catch { index = []; }
  if (!Array.isArray(index)) index = [];
  const entry = { id: layoutId, name: payload.layoutName, updatedAt: savedAt };
  const i = index.findIndex((l) => l.id === layoutId);
  if (i >= 0) index[i] = entry; else index.push(entry);
  localStorage.setItem(listKey(companyId), JSON.stringify(index));
  return { ok: true, savedAt };
}

function _loadFromBackend(companyId, layoutId) {
  return readJson(storageKey(companyId, layoutId), null);
}

// ─── Saving ───

let _debounceTimer = null;
/** Revision of the open layout as this tab loaded or last saved it. */
let _revision = 0;

function _conflict() {
  useWorkspaceStore.getState().markSaveConflict(CHANGED_ELSEWHERE);
  return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
}

/**
 * Persist an item from the offline sync queue.
 * Checks for conflict before applying to storage.
 */
export function _persistQueueItem(item) {
  const stored = _storedRevision(item.companyId, item.layoutId);
  if (stored !== null && stored > item.baseRevision) {
    return { ok: false, conflict: true, error: CHANGED_ELSEWHERE };
  }
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
 * Never overwrites a save another tab made after ours.
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

  if (!isOnline()) {
    // R7: Offline mode — queue the save so it syncs when back online
    enqueueSync({
      companyId: state.companyId,
      layoutId: state.layoutId,
      payload: state.exportWorkspace(),
      baseRevision: _revision,
    });
    useWorkspaceStore.getState().setSyncStatus?.('offline');
    useWorkspaceStore.getState().markSaveFailed?.('Offline (changes queued)');
    return { ok: true, queued: true };
  }

  try {
    const stored = _storedRevision(state.companyId, state.layoutId);
    if (stored !== null && stored > _revision) return _conflict();
    const revision = Math.max(_revision, stored ?? 0) + 1;
    _persistToBackend(state.companyId, state.layoutId, state.exportWorkspace(), revision);
    _revision = revision;
    useWorkspaceStore.getState().markSaved();
    useWorkspaceStore.getState().setStorageNearlyFull(storageUse().nearlyFull);
    return { ok: true };
  } catch (err) {
    const error = err?.name === 'QuotaExceededError' ? NO_SPACE : (err?.message || 'Could not save');
    console.error('[apiService] save failed:', err);
    if (err?.name !== 'QuotaExceededError') {
      // Network or unexpected failure: queue for retry
      enqueueSync({
        companyId: state.companyId,
        layoutId: state.layoutId,
        payload: state.exportWorkspace(),
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
  const data = _loadFromBackend(companyId, layoutId);
  if (!data) return false;

  const store = useWorkspaceStore.getState();
  store.loadWorkspace(data);
  const summary = layoutSummary(layoutId, data);
  store.setTenant(companyId, layoutId, summary.name, data.layoutVersion ?? 1);
  _revision = Number.isFinite(data.revision) ? data.revision : 0;
  store.setStorageNearlyFull(storageUse().nearlyFull);
  return true;
}

/**
 * A saved layout as it is stored (a save: v1), without opening it in the app's
 * store. For <LayoutViewer companyId layoutId />, which keeps its own copy.
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
    _persistToBackend(store.companyId, layoutId, useWorkspaceStore.getState().exportWorkspace(), 1);
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
export async function createWorkspace(companyId, name = 'Untitled Layout') {
  const layoutId = newLayoutId();
  const store = useWorkspaceStore.getState();
  store.resetWorkspace();
  store.setTenant(companyId, layoutId, name, 1);
  // Write the empty layout now, so it is in the list even before the first change
  _persistToBackend(companyId, layoutId, useWorkspaceStore.getState().exportWorkspace(), 1);
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
  _saveSync({ force: true });
}

/**
 * The layouts of a company that really exist (have saved data), most recently
 * edited first. Also repairs the company's index: entries without data are
 * dropped, and saved layouts missing from it are added.
 * @param {string} companyId
 * @returns {Promise<Array<{ id, name, rooms, floors, updatedAt, broken? }>>}
 */
export async function listLayouts(companyId) {
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
    _saveSync();
    data = useWorkspaceStore.getState().exportWorkspace();
  } else {
    data = _loadFromBackend(companyId, layoutId);
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
  try {
    _persistToBackend(companyId, layoutId, {
      companyId, layoutId,
      layoutName: n.layoutName, layoutVersion: n.layoutVersion,
      floors: n.floors, rooms: n.rooms, objects: n.objects, anchorData: n.anchorData,
    }, 1);
  } catch (err) {
    localStorage.removeItem(storageKey(companyId, layoutId));
    throw new Error(err?.name === 'QuotaExceededError' ? NO_SPACE : (err?.message || 'Could not import'));
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
  localStorage.removeItem(storageKey(companyId, layoutId));
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
