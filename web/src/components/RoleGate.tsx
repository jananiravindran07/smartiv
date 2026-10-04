// =============================================================================
// SMART IV MONITORING SYSTEM - ROLE GATING COMPONENTS
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// <RoleGate allow={[...]}>, the route guard, and the "No access" screen.
//
// READ THIS BEFORE TRUSTING ANY OF IT
// Every component in this file hides UI. None of it authorises anything. The
// boundary is Row Level Security in Postgres: if a nurse bypasses this gate and
// calls the API directly, RLS returns zero rows and the writes are refused. The
// gate exists so users are not shown controls that would fail on them, and so a
// role change is visible in the interface immediately.
// =============================================================================

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ROLE_LABEL, can, homeFor, type Capability, type Role } from '../lib/permissions';

// -----------------------------------------------------------------------------
// <RoleGate allow={[...]}>
// -----------------------------------------------------------------------------
// Conditionally renders children. Use it for fragments of a page: an action
// button, a column, a panel.
//
//   <RoleGate allow={['WARD_SISTER', 'ADMIN']}>
//     <button>Start IV session</button>
//   </RoleGate>
//
// With no `allow` and no `capability`, it simply renders its children, so it is
// safe to wrap anything.
// -----------------------------------------------------------------------------

interface RoleGateProps {
  /** Roles permitted to see the children. */
  allow?: readonly Role[];
  /** Or a capability flag from lib/permissions. */
  capability?: Capability;
  children: ReactNode;
  /** Rendered instead of the children when access is denied. Defaults to nothing. */
  fallback?: ReactNode;
  /** Rendered when the role is still unknown. Defaults to nothing. */
  loading?: ReactNode;
}

export function RoleGate({ allow, capability, children, fallback = null, loading = null }: RoleGateProps) {
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.status);

  if (status === 'initialising') return <>{loading}</>;

  if (!role) return <>{fallback}</>;

  const permitted = allow ? allow.includes(role) : capability ? can(role, capability) : true;

  return <>{permitted ? children : fallback}</>;
}

// -----------------------------------------------------------------------------
// No access screen
// -----------------------------------------------------------------------------

export function NoAccess({ required, actual }: { required?: readonly Role[]; actual?: Role | null }) {
  const storeRole = useAuthStore((s) => s.role);
  const signOut = useAuthStore((s) => s.signOut);
  const profile = useAuthStore((s) => s.profile);

  // Prefer the live store value; fall back to what the guard passed in.
  const role = storeRole ?? actual ?? null;
  const needed = required?.map((r) => ROLE_LABEL[r]).join(' or ') ?? 'a different role';

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-950/60 border border-red-800/70 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-red-400" />
        </div>

        <h1 className="mt-5 text-xl font-bold text-white">No access</h1>

        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          This area requires <span className="text-slate-200 font-medium">{needed}</span>.
          {role && (
            <>
              {' '}You are signed in as{' '}
              <span className="text-slate-200 font-medium">{ROLE_LABEL[role]}</span>
              {profile?.full_name ? ` (${profile.full_name})` : ''}.
            </>
          )}
        </p>

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          Access is enforced by the database as well as by this screen. If you believe you
          should have access, ask an administrator to review your role or ward assignment.
        </p>

        <button
          onClick={() => void signOut()}
          className="mt-6 inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// <RequireRole allow={[...]}>
// -----------------------------------------------------------------------------
// The route guard. Wrap a route element with it.
//
// Handles the three states a route has to distinguish:
//   - still resolving the session  -> a placeholder, never a flash of login
//   - nobody signed in             -> redirect to /login, remembering where
//   - signed in, wrong role        -> the "No access" screen
//
// Note what it does NOT do: it does not render the children and hide them with
// CSS. An unauthorised route is never mounted at all.
// -----------------------------------------------------------------------------

interface RequireRoleProps {
  allow: readonly Role[];
  children: ReactNode;
}

function AuthPlaceholder({ label }: { label: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
        <p className="mt-3 text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.role);
  const location = useLocation();

  if (status === 'initialising') {
    return <AuthPlaceholder label="Restoring your session" />;
  }

  if (status === 'anonymous' || !role) {
    // `state.from` lets the login page send the user back where they were
    // heading, provided they are allowed to go there in the first place.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allow.includes(role)) {
    return <NoAccess required={allow} actual={role} />;
  }

  return <>{children}</>;
}

/**
 * Sends each role to its own landing page after sign-in:
 * NURSE -> My Patients, WARD_SISTER -> Ward Overview, ADMIN -> Admin Console.
 */
export function RoleLanding() {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.role);

  if (status === 'initialising') {
    return <AuthPlaceholder label="Restoring your session" />;
  }

  if (status === 'anonymous' || !role) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={homeFor(role)} replace />;
}
