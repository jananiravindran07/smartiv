// =============================================================================
// SMART IV MONITORING SYSTEM - ROUTING
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Every clinical route is wrapped in <RequireRole allow={[...]}>.
//
// Three things are worth pointing out:
//
//  1. The guard returns <Navigate> or <NoAccess/>. It does not mount the page
//     and hide it with CSS, so an unauthorised component never runs and never
//     fires its queries.
//
//  2. The sidebar and the tabs are generated from the same capability table in
//     lib/permissions.ts, so a hidden link and a blocked route can never drift.
//
//  3. NONE of this is authorisation. It is presentation. The database refuses
//     these reads regardless of what the browser does. See migrations
//     00100-00600.
//
// Role landing routes, per the brief:
//   NURSE -> /my-patients      WARD_SISTER -> /ward      ADMIN -> /admin
// =============================================================================

import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { AppShell } from './components/AppShell';
import { LoginPage } from './components/LoginPage';
import { NoAccess, RequireRole, RoleGate, RoleLanding } from './components/RoleGate';
import { MyPatientsPage } from './pages/MyPatientsPage';
import { WardOverviewPage } from './pages/WardOverviewPage';
import { AdminConsolePage } from './pages/AdminConsolePage';

function AppRoutes() {
  const initialise = useAuthStore((s) => s.initialise);

  // Restore the session once at startup, and re-check when the tab regains
  // focus so a deactivation or role change is picked up without a reload.
  useEffect(() => {
    void initialise();

    const onFocus = () => void useAuthStore.getState().refreshProfile();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [initialise]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Signed out: everything leads back to the login page. */}
      <Route element={<RoleLanding />} path="/" />

      <Route element={<AppShell />}>
        {/* ------------------------------------------------------- NURSE */}
        <Route
          path="/my-patients"
          element={
            <RequireRole allow={['NURSE']}>
              <MyPatientsPage />
            </RequireRole>
          }
        />

        {/* -------------------------------------------------- WARD_SISTER */}
        <Route
          path="/ward"
          element={
            <RequireRole allow={['WARD_SISTER']}>
              <WardOverviewPage />
            </RequireRole>
          }
        />

        {/* --------------------------------------------------------- ADMIN */}
        <Route
          path="/admin"
          element={
            <RequireRole allow={['ADMIN']}>
              <AdminConsolePage tab="users" />
            </RequireRole>
          }
        />
        {(['wards', 'devices', 'parameters', 'audit'] as const).map((t) => (
          <Route
            key={t}
            path={`/admin/${t}`}
            element={
              <RequireRole allow={['ADMIN']}>
                <AdminConsolePage tab={t} />
              </RequireRole>
            }
          />
        ))}
      </Route>

      {/* Anything else, signed in or not. The landing route decides where. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;

// Re-exported so the shell and pages can import from one place.
export { RoleGate, NoAccess, RequireRole };
export { useAuthStore };
