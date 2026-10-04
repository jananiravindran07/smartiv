// =============================================================================
// SMART IV MONITORING SYSTEM - SUPABASE CLIENT (BROWSER)
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// SECURITY
// This file reads ONLY the public anon key. The service-role key is never
// imported, bundled or referenced anywhere in web/, and it bypasses RLS
// entirely, so it must exist only as an Edge Function secret.
//
// Everything this client can do is therefore still subject to the RLS policies:
// hiding a button does not widen what the anon key can read.
// =============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when real credentials are present.
 *
 * When they are not, the app runs in DEMO MODE: the UI, the routing and the
 * role gating all work against an in-memory persona so the interface can be
 * reviewed without a database. Demo mode is not a security control and it does
 * not emulate RLS - see authStore.ts for exactly what it does and does not do.
 */
export const isSupabaseConfigured =
  Boolean(url && anonKey) &&
  !String(url).includes('your-') &&
  !String(anonKey).includes('your-');

export const isDemoMode = !isSupabaseConfigured;

export const supabase: SupabaseClient = createClient(
  url ?? 'http://127.0.0.1:54321',
  anonKey ?? 'demo-mode-no-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No magic-link or OAuth callback handling: sign-up is disabled and the
      // only credential flow is email + password.
      detectSessionInUrl: false,
      storageKey: 'smartiv.auth.session',
    },
  },
);
