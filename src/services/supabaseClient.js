/**
 * supabaseClient.js
 *
 * Real Supabase client initialization using environment variables.
 * Normalizes URL and handles auth persistence.
 */

import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env?.VITE_SUPABASE_URL || '';
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

// Normalize URL: remove any trailing /rest/v1/ if present
const supabaseUrl = rawUrl ? rawUrl.replace(/\/rest\/v1\/?$/, '') : '';

export const isSupabaseConfigured = Boolean(supabaseUrl && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
