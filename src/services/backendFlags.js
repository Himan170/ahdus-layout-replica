/**
 * backendFlags.js
 *
 * The one off-by-default switch for everything the browser sends to Supabase:
 * layout saving (apiService.js) and photo reconstruction (reconstructionService.js).
 *
 * PROTOTYPE: the browser talks to Supabase only with VITE_LAYOUT_BACKEND=supabase
 * as well as the URL and key. Read at call time (tests use vi.stubEnv).
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

export function isSupabaseBackendOn() {
  return import.meta.env?.VITE_LAYOUT_BACKEND === 'supabase' && isSupabaseConfigured && !!supabase;
}
