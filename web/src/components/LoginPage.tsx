// =============================================================================
// SMART IV MONITORING SYSTEM - LOGIN
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Email and password. Nothing else.
//
// The previous version of this screen had a three-way role picker and a
// "quick persona switcher" that swapped the current user without a password.
// Both are gone. A role is a property of the account, stored in profiles.role
// and read back from the database after sign-in; there is nothing to pick here,
// and picking would have been a privilege-escalation UI.
//
// Where the user lands afterwards is decided by that stored role:
//   NURSE       -> /my-patients
//   WARD_SISTER -> /ward
//   ADMIN       -> /admin
// =============================================================================

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Lock, Mail, LogIn, AlertCircle, Info } from 'lucide-react';
import { useAuthStore, DEMO_PERSONAS } from '../stores/authStore';
import { isDemoMode } from '../lib/supabase';
import { homeFor, ROLE_LABEL } from '../lib/permissions';

export function LoginPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);
  const setDemoPersona = useAuthStore((s) => s.setDemoPersona);
  const error = useAuthStore((s) => s.error);
  const notice = useAuthStore((s) => s.notice);
  const clearError = useAuthStore((s) => s.clearError);
  const role = useAuthStore((s) => s.role);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight to the landing page for the role.
  useEffect(() => {
    if (role) navigate(homeFor(role), { replace: true });
  }, [role, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    clearError();

    const ok = await signIn(email, password);

    setBusy(false);

    if (ok) {
      // The store now holds the profile, so homeFor() resolves from the
      // database's idea of the role rather than from anything typed here.
      const current = useAuthStore.getState().role;
      navigate(homeFor(current), { replace: true });
    }
  };

  const handleDemoPersona = (userId: string) => {
    setDemoPersona(userId);
    const persona = DEMO_PERSONAS.find((p) => p.id === userId);
    if (persona) navigate(homeFor(persona.role), { replace: true });
  };

  return (
    <div className="login-canvas">
      <div className="login-frame">
        <section className="login-story">
          <a className="brand-lockup login-brand" href="/login"><span className="brand-mark"><Activity size={20} /></span><span><strong>SmartIV</strong><small>Care, in real time</small></span></a>
          <div className="story-content"><span className="story-kicker">A clearer picture of care</span><h1>Good care starts with being <em>in the know.</em></h1><p>One calm place to follow patient assignments, review alerts, and stay connected to your ward.</p>
            <div className="story-visual" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="visual-center"><Activity size={36}/></div><span className="visual-spark spark-one"/><span className="visual-spark spark-two"/><span className="visual-leaf"/></div>
          </div>
          <p className="story-foot">Supporting thoughtful, timely care.</p>
        </section>
        <section className="login-form-panel">
          <div className="login-form-inner">
            <div className="form-kicker"><span className="form-kicker-icon"><Lock size={15}/></span> STAFF PORTAL</div>
            <h2>Welcome back</h2><p className="form-intro">Sign in with your hospital account to continue.</p>
        <div className="login-form-card">

          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-red-950/70 border border-red-800/80 text-red-300 text-xs rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {!error && notice && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-slate-800/70 border border-slate-700 text-slate-300 text-xs rounded-lg">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Work email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hospital.local"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold text-sm shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {busy ? 'Signing in' : 'Sign in'}
              {!busy && <LogIn className="w-4 h-4" />}
            </button>
          </form>

          <p className="mt-5 text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-4">
            There is no self-service sign-up and no role choice at login. Accounts are created by
            an administrator, and your role and ward are read from your profile after you sign in.
          </p>
        </div>

        {/* ------------------------------------------------------------------
            DEMO MODE ONLY.

            This exists so the interface can be reviewed without a database. It
            replaces the sign-in flow only: it proves that routing, the sidebar
            and the role gates respond to a role, and it proves NOTHING about
            data access, which is RLS's job. It is unreachable as soon as
            VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
        ------------------------------------------------------------------ */}
        {isDemoMode && (
          <div className="mt-4 bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
            <p className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">
              Demo mode — no database configured
            </p>
            <p className="mt-1.5 text-[11px] text-amber-200/70 leading-relaxed">
              Simulates sign-in only. It does not emulate RLS, so it cannot demonstrate that data
              is actually restricted.
            </p>
            <div className="mt-3 space-y-1.5">
              {DEMO_PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleDemoPersona(p.id)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-slate-200">{p.full_name}</div>
                  <div className="text-[11px] text-slate-400">
                    {ROLE_LABEL[p.role]}
                    {p.ward_id ? ' · Ward GEN-A' : ' · All wards'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="login-disclaimer">Academic prototype · Not a certified medical device</p>
          </div>
        </section>
      </div>
    </div>
  );
}
