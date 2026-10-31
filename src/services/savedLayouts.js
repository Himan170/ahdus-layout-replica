/**
 * savedLayouts.js
 *
 * Where apiService keeps a layout in this browser (localStorage), and reading one back.
 * Kept apart from apiService so <LayoutViewer /> and the embed can read a saved layout
 * without bundling the rest of saving (the Supabase client, the sync queue, the app's store):
 * a viewer never saves.
 */

export const STORAGE_PREFIX = 'dwtwin_';

/** localStorage key of a layout's data. */
export function storageKey(companyId, layoutId) {
  return `${STORAGE_PREFIX}${companyId}_${layoutId}`;
}

/**
 * A layout saved in this browser, as stored (a save, v1), or null if there is none.
 * Throws if the stored data is not JSON.
 */
export function readSavedLayout(companyId, layoutId) {
  const raw = localStorage.getItem(storageKey(companyId, layoutId));
  return raw === null ? null : JSON.parse(raw);
}
