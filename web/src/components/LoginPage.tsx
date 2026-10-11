import { useState } from 'react';
import { IvBag } from './IvBag';
import { Logo } from './Icons';
import { TextShimmerWave } from './core/TextShimmerWave';
import { AnimatedBackground } from './core/AnimatedBackground';
import type { Role } from '../types';

interface LoginPageProps {
  onLogin: (staffId: string, password: string, role: Role) => Promise<void>;
}

/** Capability lists from the prototype, shown per selected role. */
const CAN: Record<Role, Array<[boolean, string]>> = {
  nurse: [
    [true, 'See the beds assigned to you, live'],
    [true, 'Acknowledge alarms'],
    [true, 'Record a bag change or restored flow'],
    [false, 'Change alert rules or bed assignments'],
    [false, 'Manage devices or read the activity log'],
  ],
  admin: [
    [true, 'See every bed in the ward'],
    [true, 'Everything a nurse can do'],
    [true, 'Assign beds to nurses'],
    [true, 'Set alert rules'],
    [true, 'Manage devices and read the activity log'],
  ],
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [role, setRole] = useState<Role>('nurse');
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!staffId.trim() || !password) {
      setError('Enter your staff ID and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onLogin(staffId.trim(), password, role);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="brand-panel" aria-label="SmartIV">
        <AnimatedBackground className="login-bg">
          <div className="lockup">
            <Logo />
            <div className="wordmark">
              <b>SMARTIV</b>
              <small>Infusion monitor</small>
            </div>
          </div>
          <div className="hero-bag">
            <div>
              <IvBag percent={62} id="hero" />
            </div>
            <div className="hero-copy">
              <h1>Know which bag ends first.</h1>
              <p>Live volume, flow rate and end time for every IV in the ward, with the most urgent beds always on top.</p>
            </div>
          </div>
          <p className="fine">Live readings arrive from the ward units over Wi-Fi.</p>
        </AnimatedBackground>
      </section>

      <section className="signin">
        <form className="signin-card" onSubmit={submit} noValidate>
          <div>
            <h2>Sign in</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              Choose your role, then enter your staff ID.
            </p>
          </div>

          <div className="seg" role="group" aria-label="Role">
            <button type="button" aria-pressed={role === 'nurse'} onClick={() => setRole('nurse')}>
              Nurse
            </button>
            <button type="button" aria-pressed={role === 'admin'} onClick={() => setRole('admin')}>
              Admin
            </button>
          </div>

          <div className="field">
            <label htmlFor="staff-id">Staff ID</label>
            <input
              id="staff-id"
              autoComplete="username"
              autoCapitalize="characters"
              placeholder={role === 'admin' ? 'A-1001' : 'N-2041'}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}

          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <TextShimmerWave duration={1.2}>Signing in…</TextShimmerWave> : 'Sign in'}
          </button>

          <div className="can">
            <h3>{role === 'admin' ? 'Admin can' : 'Nurse can'}</h3>
            <ul>
              {CAN[role].map(([allowed, text]) => (
                <li key={text} className={allowed ? 'yes' : 'no'}>
                  <span className="mk">{allowed ? '✓' : '✕'}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </form>
      </section>
    </div>
  );
}
