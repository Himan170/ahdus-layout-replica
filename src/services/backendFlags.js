/**
 * backendFlags.js
 *
 * The off-by-default switches for where layouts are saved (VITE_LAYOUT_BACKEND):
 *   empty     localStorage only (the default; no network calls)
 *   supabase  PROTOTYPE: the browser talks to Supabase (layout saving in apiService.js,
 *             photo reconstruction in reconstructionService.js), only with the URL and key too
 *   ahdus     Workplace Studio inside AHDUS: the site's draft through the AHDUS API (ahdusBackend.js)
 * Read at call time (tests use vi.stubEnv).
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

export function isSupabaseBackendOn() {
  return import.meta.env?.VITE_LAYOUT_BACKEND === 'supabase' && isSupabaseConfigured && !!supabase;
}

export function isAhdusBackendOn() {
  return import.meta.env?.VITE_LAYOUT_BACKEND === 'ahdus';
}
