// =============================================================================
// SMART IV MONITORING SYSTEM - AUTH STORE (Zustand)
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Holds the session and the profile row, and derives `role` and `wardId` from
// that row rather than from anything the user typed. There is no role selector
// anywhere in this app, because a role is a fact about the account, not a
// choice made at login.
//
// WHY THE PROFILE ROW IS THE SOURCE OF TRUTH
// A JWT can be up to an hour old and does not carry the role. The database does.
// So the store re-reads the profile on sign-in, on token refresh and on tab
// focus, and if `is_active` is false it tears the session down immediately. A
// deactivated account keeps its JWT but loses the app, because RLS would deny
// every query anyway.
//
// WHAT THIS IS NOT
// Nothing here is a security control. The store decides what to SHOW; Postgres
// decides what is READABLE. If the store is bypassed, RLS still refuses.
//
// DEMO MODE
// When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent the store runs
// against in-memory personas so the interface can be reviewed without a
// database. It simulates the SIGN-IN FLOW ONLY. It does not emulate RLS, so a
// demo persona cannot demonstrate that data access is actually restricted - only
// that the UI is gated. Never enable it anywhere near real patient data.
// =============================================================================

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { isDemoMode, supabase } from '../lib/supabase';
import type { Role } from '../lib/permissions';
import type { Profile } from '../types/database';

export type AuthStatus = 'initialising' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  wardId: string | null;

  /** Last sign-in or profile-load failure, for display on the login screen. */
  error: string | null;
  /** Set when a session ended because the account was deactivated. */
  notice: string | null;

  initialise: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setDemoPersona: (userId: string) => void;
  clearError: () => void;
}

// -----------------------------------------------------------------------------
// Demo personas (DEMO MODE ONLY - never used when Supabase is configured)
// -----------------------------------------------------------------------------

export const DEMO_PERSONAS: Profile[] = [
  {
    id: 'demo-nurse-clara',
    full_name: 'Clara Oswald, RN',
    email: 'clara.oswald@smartiv.local',
    badge_number: 'NR-8492',
    role: 'NURSE',
    ward_id: 'a0000000-0000-0000-0000-000000000001',
    is_active: true,
    phone_number: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'demo-sister-martha',
    full_name: 'Martha Jones, BSN',
    email: 'martha.jones@smartiv.local',
    badge_number: 'SIS-4401',
    role: 'WARD_SISTER',
    ward_id: 'a0000000-0000-0000-0000-000000000001',
    is_active: true,
    phone_number: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'demo-admin-watson',
    full_name: 'John Watson',
    email: 'john.watson@smartiv.local',
    badge_number: 'ADM-001',
    role: 'ADMIN',
    ward_id: null,
    is_active: true,
    phone_number: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

function applyProfile(set: (partial: Partial<AuthState>) => void, profile: Profile | null) {
  set({
    profile,
    role: profile?.role ?? null,
    wardId: profile?.ward_id ?? null,
  });
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'initialising',
  session: null,
  profile: null,
  role: null,
  wardId: null,
  error: null,
  notice: null,

  clearError: () => set({ error: null }),

  /**
   * Pull the caller's profile row.
   *
   * A user can always read their own row: the profiles SELECT policy admits
   * `id = auth.uid()` for every role. If the row is missing or deactivated the
   * session is discarded rather than left in a half-working state.
   */
  refreshProfile: async () => {
    if (isDemoMode) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, ward_id, is_active, badge_number, phone_number, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      // Most likely RLS or a dropped connection. Do not silently keep a
      // half-authenticated UI around.
      await get().signOut();
      set({ error: 'Could not load your profile. Please sign in again.' });
      return;
    }

    if (!data) {
      await supabase.auth.signOut();
      set({
        status: 'anonymous',
        session: null,
        profile: null,
        role: null,
        wardId: null,
        error: 'This account has no profile and cannot be used. Ask an administrator.',
      });
      return;
    }

    const profile = data as Profile;

    if (!profile.is_active) {
      await supabase.auth.signOut();
      set({
        status: 'anonymous',
        session: null,
        profile: null,
        role: null,
        wardId: null,
        error: 'This account has been deactivated.',
      });
      return;
    }

    set({ status: 'authenticated', session: sessionData.session, error: null });
    applyProfile(set, profile);
  },

  /**
   * Called once at startup and re-run when the tab regains focus, so a
   * deactivation or a role change takes effect without waiting for a token
   * refresh.
   */
  initialise: async () => {
    if (isDemoMode) {
      set({ status: 'anonymous' });
      return;
    }

    try {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        set({ status: 'anonymous', session: null });
        applyProfile(set, null);
        return;
      }

      set({ status: 'authenticated', session: data.session });
      await get().refreshProfile();
    } catch {
      set({ status: 'anonymous' });
      applyProfile(set, null);
    }
  },

  signIn: async (email: string, password: string) => {
    set({ error: null, notice: null });

    if (isDemoMode) {
      // Demo mode: any of the three personas, chosen by name, no password check.
      const persona = DEMO_PERSONAS.find(
        (p) => (p.email ?? '').toLowerCase() === email.trim().toLowerCase(),
      );
      if (!persona) {
        set({ error: 'Demo mode: use clara.oswald@smartiv.local, martha.jones@smartiv.local or john.watson@smartiv.local.' });
        return false;
      }
      set({ status: 'authenticated' });
      applyProfile(set, persona);
      return true;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.session) {
      // Deliberately vague: never reveal whether an address exists.
      set({ error: 'Sign-in failed. Check your email and password.' });
      return false;
    }

    set({ status: 'authenticated', session: data.session });
    await get().refreshProfile();

    // refreshProfile clears the session when the account is unusable, so only
    // audit the login once we know the profile actually loaded.
    if (!get().profile) {
      set({ status: 'anonymous', session: null });
      return false;
    }

    // LOGIN is audited from the client because only the client knows when a
    // session actually begins. log_event() is restricted server-side to
    // LOGIN / LOGOUT / SESSION_EXPIRED and always attributes the row to the
    // caller, so this cannot be used to forge other audit entries.
    //
    // A PostgREST builder is thenable rather than a real Promise, so it is
    // awaited inside try/catch rather than chained with .catch(). A failed audit
    // call must never block a successful sign-in.
    try {
      await supabase.rpc('log_event', { p_action: 'LOGIN' });
    } catch {
      // Intentionally ignored.
    }

    return true;
  },

  signOut: async () => {
    if (!isDemoMode) {
      // Log the event BEFORE tearing the session down: afterwards the JWT is
      // gone and log_event() has no caller to attribute the row to.
      try {
        await supabase.rpc('log_event', { p_action: 'LOGOUT' });
      } catch {
        // Intentionally ignored.
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // Intentionally ignored: the local state is cleared regardless.
      }
    }

    // Everything goes. No profile, no role, no ward: there is no way for a
    // signed-out browser tab to still render an admin-only view.
    set({
      status: 'anonymous',
      session: null,
      profile: null,
      role: null,
      wardId: null,
      error: null,
      notice: 'You have been signed out.',
    });
  },

  setDemoPersona: (userId: string) => {
    if (!isDemoMode) return;
    const persona = DEMO_PERSONAS.find((p) => p.id === userId);
    if (!persona) return;
    set({ status: 'authenticated' });
    applyProfile(set, persona);
  },
}));

/**
 * Subscribe to auth events once, at module scope, so a token refresh or a
 * server-side sign-out updates the store wherever it happens.
 *
 * SIGNED_OUT covers both an explicit sign-out and a session that the server
 * rejected as expired, which is how an expired session is handled: the store
 * clears itself and the router falls back to /login.
 */
if (!isDemoMode) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      useAuthStore.setState({
        status: 'anonymous',
        session: null,
        profile: null,
        role: null,
        wardId: null,
        notice: 'Your session has ended. Please sign in again.',
      });
      return;
    }

    if (event === 'TOKEN_REFRESHED' && session) {
      useAuthStore.setState({ session });
    }

    if (event === 'USER_UPDATED') {
      void useAuthStore.getState().refreshProfile();
    }
  });
}
