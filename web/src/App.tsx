import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginPage } from './components/LoginPage';
import { Dashboard } from './components/Dashboard';
import { StaffView } from './components/StaffView';
import { RulesView } from './components/RulesView';
import { DevicesView } from './components/DevicesView';
import { ActivityView } from './components/ActivityView';
import { BellIcon, Logo, ThemeIcon } from './components/Icons';
import { api, jsonBody } from './lib/api';
import { beep, unlockAlarm } from './lib/alarm';
import { fmtClock } from './lib/format';
import type {
  ActivityEntry,
  AlertRules,
  Bed,
  BedAction,
  DevicesResponse,
  Role,
  SessionUser,
  StaffMember,
  ViewId,
} from './types';

const TABS: Array<{ id: ViewId; label: string; adminOnly: boolean }> = [
  { id: 'dash', label: 'Dashboard', adminOnly: false },
  { id: 'staff', label: 'Staff & beds', adminOnly: true },
  { id: 'rules', label: 'Alert rules', adminOnly: true },
  { id: 'devices', label: 'Devices', adminOnly: true },
  { id: 'log', label: 'Activity', adminOnly: true },
];

const DEFAULT_RULES: AlertRules = { criticalMinutes: 15, criticalPercent: 10, attentionMinutes: 45, attentionPercent: 25 };

interface Toast {
  text: string;
  kind: 'ok' | 'err';
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedsLoaded, setBedsLoaded] = useState(false);
  const [rules, setRules] = useState<AlertRules>(DEFAULT_RULES);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [view, setView] = useState<ViewId>('dash');
  const [now, setNow] = useState(() => Date.now());
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyBed, setBusyBed] = useState<number | null>(null);
  const lastSeverities = useRef<Map<number, string>>(new Map());

  const isAdmin = user?.role === 'admin';

  /* ---------------- session ---------------- */

  useEffect(() => {
    let cancelled = false;
    api<{ user: SessionUser }>('/auth/me')
      .then((response) => {
        if (!cancelled) setUser(response.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (staffId: string, password: string, role: Role) => {
    // The browser blocks audio until a gesture; sign-in is that gesture.
    unlockAlarm();
    const response = await api<{ user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: jsonBody({ staffId, password, expectedRole: role }),
    });
    setUser(response.user);
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setBeds([]);
    setView('dash');
    lastSeverities.current = new Map();
  }, []);

  /* ---------------- live bed stream ---------------- */

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    window.setTimeout(() => setToast((current) => (current === next ? null : current)), 3200);
  }, []);

  /**
   * Sounds the alarm when one of this user's beds crosses into critical. The
   * previous severity is tracked per bed, so a bed already acknowledged as
   * critical does not re-alarm on every incoming reading.
   */
  const applyBed = useCallback(
    (bed: Bed) => {
      setBeds((current) => {
        const index = current.findIndex((entry) => entry.bedNumber === bed.bedNumber);
        const next = index === -1 ? [...current, bed] : current.map((entry, at) => (at === index ? bed : entry));
        const previous = lastSeverities.current.get(bed.bedNumber);
        if (previous !== undefined && previous !== 'critical' && bed.severity === 'critical' && !bed.offline) {
          beep();
          showToast({ text: `Bed ${String(bed.bedNumber).padStart(2, '0')} is now critical`, kind: 'err' });
        }
        lastSeverities.current.set(bed.bedNumber, bed.severity);
        return next;
      });
    },
    [showToast],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let source: EventSource | null = null;

    api<{ beds: Bed[]; rules: AlertRules }>('/beds')
      .then((response) => {
        if (cancelled) return;
        setBeds(response.beds);
        setRules(response.rules);
        setBedsLoaded(true);
        lastSeverities.current = new Map(response.beds.map((bed) => [bed.bedNumber, bed.severity]));
      })
      .catch(() => {
        setBedsLoaded(true);
        showToast({ text: 'Could not load beds.', kind: 'err' });
      });

    if (isAdmin) {
      api<{ rules: AlertRules }>('/admin/rules').then((response) => setRules(response.rules)).catch(() => undefined);
    }

    source = new EventSource('/api/events', { withCredentials: true });
    source.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { beds: Bed[] };
      setBeds(data.beds);
      setBedsLoaded(true);
      lastSeverities.current = new Map(data.beds.map((bed) => [bed.bedNumber, bed.severity]));
    });
    // Both frames carry the whole bed under `bed`.
    source.addEventListener('bed', (event) => {
      applyBed(JSON.parse((event as MessageEvent<string>).data).bed as Bed);
    });
    source.addEventListener('critical', (event) => {
      applyBed(JSON.parse((event as MessageEvent<string>).data).bed as Bed);
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [user, isAdmin, applyBed, showToast]);

  // Drives the countdown, the clock and the relative "last reading" column.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ---------------- admin data ---------------- */

  const refreshAdmin = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [staffResponse, rulesResponse, devicesResponse, activityResponse] = await Promise.all([
        api<{ staff: StaffMember[] }>('/admin/staff'),
        api<{ rules: AlertRules }>('/admin/rules'),
        api<DevicesResponse>('/admin/devices'),
        api<{ activity: ActivityEntry[] }>('/admin/activity'),
      ]);
      setStaff(staffResponse.staff);
      setRules(rulesResponse.rules);
      setDevices(devicesResponse);
      setActivity(activityResponse.activity);
    } catch {
      showToast({ text: 'Admin information is unavailable.', kind: 'err' });
    }
  }, [isAdmin, showToast]);

  useEffect(() => {
    if (!isAdmin) return;
    if (view === 'dash') return;
    void refreshAdmin();
  }, [isAdmin, view, refreshAdmin]);

  /* ---------------- actions ---------------- */

  const runBedAction = useCallback(
    async (bedNumber: number, action: BedAction) => {
      setBusyBed(bedNumber);
      try {
        const response = await api<{ bed?: Bed; note?: string }>(`/beds/${bedNumber}/${action}`, { method: 'POST' });
        if (response?.bed) applyBed(response.bed);
        else {
          const bedsResponse = await api<{ beds: Bed[]; rules: AlertRules }>('/beds');
          setBeds(bedsResponse.beds);
        }
        showToast({ text: `Bed ${String(bedNumber).padStart(2, '0')}: ${ACTION_LABELS[action]}`, kind: 'ok' });
      } catch (error) {
        showToast({ text: error instanceof Error ? error.message : 'That action failed.', kind: 'err' });
      } finally {
        setBusyBed(null);
      }
    },
    [applyBed, showToast],
  );

  const assignBed = useCallback(
    async (bedId: number, nurseId: string | null) => {
      setBusyBed(bedId);
      try {
        await api(`/admin/assignments/${bedId}`, { method: 'PATCH', body: jsonBody({ nurseId }) });
        await refreshAdmin();
        showToast({ text: `Bed ${String(bedId).padStart(2, '0')} assignment updated`, kind: 'ok' });
      } catch (error) {
        showToast({ text: error instanceof Error ? error.message : 'Could not change that assignment.', kind: 'err' });
      } finally {
        setBusyBed(null);
      }
    },
    [refreshAdmin, showToast],
  );

  const saveRules = useCallback(
    async (next: AlertRules) => {
      try {
        const response = await api<{ rules: AlertRules }>('/admin/rules', { method: 'PATCH', body: jsonBody(next) });
        setRules(response.rules);
        const bedsResponse = await api<{ beds: Bed[]; rules: AlertRules }>('/beds');
        setBeds(bedsResponse.beds);
        setRules(bedsResponse.rules);
        showToast({ text: 'Alert rules saved.', kind: 'ok' });
      } catch (error) {
        showToast({ text: error instanceof Error ? error.message : 'Could not save the rules.', kind: 'err' });
      }
    },
    [showToast],
  );

  /* ---------------- theme ---------------- */

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = root.dataset.theme ?? (dark ? 'dark' : 'light');
    root.dataset.theme = current === 'dark' ? 'light' : 'dark';
  }, []);

  /* ---------------- derived ---------------- */

  const bedNumbers = useMemo(
    () => beds.map((bed) => bed.bedNumber).sort((a, b) => a - b),
    // The admin needs every bed in the ward, not only the ones with readings.
    // The beds list for an admin is already the full ward, so this is stable.
    [beds],
  );

  const rulePreview = useMemo(() => {
    const counts = { critical: 0, attention: 0, normal: 0 };
    for (const bed of beds) counts[bed.severity] += 1;
    return `With these rules right now: ${counts.critical} critical, ${counts.attention} attention, ${counts.normal} running.`;
  }, [beds]);

  if (booting) return null;
  if (!user) return <LoginPage onLogin={signIn} />;

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <div className="lockup">
            <Logo />
            <div className="wordmark">
              <b>SMARTIV</b>
              <small>Infusion monitor</small>
            </div>
          </div>

          <nav className="nav" aria-label="Sections" hidden={!isAdmin}>
            {visibleTabs
              .filter((tab) => tab.adminOnly)
              .map((tab) => (
                <button key={tab.id} type="button" aria-current={view === tab.id ? 'page' : undefined} onClick={() => setView(tab.id)}>
                  {tab.label}
                </button>
              ))}
          </nav>

          <div className="tools">
            <span className="clock">{fmtClock(now)}</span>
            <button
              className="ico-btn"
              type="button"
              aria-pressed={!muted}
              title={`Alarm sound ${muted ? 'off' : 'on'}`}
              aria-label={`Alarm sound ${muted ? 'off' : 'on'}`}
              onClick={() => {
                unlockAlarm();
                const next = !muted;
                setMuted(next);
                if (next) beep();
              }}
            >
              <BellIcon off={muted} />
            </button>
            <button className="ico-btn" type="button" aria-label="Switch theme" title="Switch theme" onClick={toggleTheme}>
              <ThemeIcon />
            </button>
            <div className="who">
              <b>{user.name}</b>
              <span>{isAdmin ? 'Admin' : 'Nurse'}</span>
            </div>
            <button className="btn" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="wrap page">
        {view === 'dash' && (
          <Dashboard
            beds={beds}
            rules={rules}
            now={now}
            title={isAdmin ? 'Ward overview' : 'My beds'}
            note={
              bedsLoaded
                ? isAdmin
                  ? `All ${beds.length} beds in the ward. Critical beds are pinned to the top.`
                  : `Showing the ${beds.length} bed${beds.length === 1 ? '' : 's'} assigned to you. Critical beds are pinned to the top. Ask an admin to change assignments.`
                : ''
            }
            onAction={(bedNumber, action) => void runBedAction(bedNumber, action)}
          />
        )}

        {view === 'staff' && isAdmin && (
          <StaffView staff={staff} bedNumbers={bedNumbers} onAssign={assignBed} busyBed={busyBed} />
        )}
        {view === 'rules' && isAdmin && <RulesView rules={rules} onSave={saveRules} preview={rulePreview} />}
        {view === 'devices' && isAdmin && <DevicesView data={devices} beds={beds} now={now} />}
        {view === 'log' && isAdmin && <ActivityView entries={activity} />}
      </main>

      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.text}</div>}
    </>
  );
}

const ACTION_LABELS: Record<BedAction, string> = {
  acknowledge: 'alarm acknowledged',
  'bag-replaced': 'bag marked as replaced',
  'flow-restored': 'flow marked as restored',
};
