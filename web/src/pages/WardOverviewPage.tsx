// =============================================================================
// SMART IV MONITORING SYSTEM - "WARD OVERVIEW"  (WARD_SISTER landing page)
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// A ward sister sees her whole ward and nothing outside it. Every query below is
// unfiltered by ward on purpose: the iv_sessions / alerts / patients policies
// call can_access_patient(), which for a WARD_SISTER is true only for patients in
// her own ward. Another ward's rows never arrive, so there is nothing for the UI
// to accidentally leak.
//
// ASSUMPTION, flagged in the audit report: she may create and edit patients and
// start and end IV sessions in her ward, and allocate nurses to patients. She
// may NOT manage users, roles, wards, devices or thresholds, and she cannot read
// the audit log.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plus, PlayCircle, Users2, Activity } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import {
  acknowledgeAlert,
  fetchAlertHistory,
  fetchAlerts,
  fetchPatients,
  fetchStaff,
} from '../lib/queries';
import { RoleGate } from '../components/RoleGate';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorNote,
  GhostButton,
  Loading,
  PageHeader,
  PrimaryButton,
  RlsEmptyNote,
  StatTile,
} from '../components/ui';
import type { Alert, Patient, Profile } from '../types/database';

export function WardOverviewPage() {
  const profile = useAuthStore((s) => s.profile);
  const wardId = useAuthStore((s) => s.wardId);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAlert, setBusyAlert] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, h, s] = await Promise.all([
        fetchPatients(),
        fetchAlerts(),
        fetchAlertHistory(),
        fetchStaff(),
      ]);
      setPatients(p);
      setAlerts(a);
      setHistory(h);
      setStaff(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the ward.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAcknowledge = async (alert: Alert) => {
    setBusyAlert(alert.id);
    setError(null);
    try {
      await acknowledgeAlert(alert.id, 'Reviewed by ward sister.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge the alert.');
    } finally {
      setBusyAlert(null);
    }
  };

  const nurses = staff.filter((s) => s.role === 'NURSE');
  const open = alerts.filter((a) => a.status === 'OPEN');
  const nameOf = (id: string) => patients.find((p) => p.id === id)?.full_name ?? '—';

  if (loading) return <Loading label="Loading ward overview" />;

  return (
    <>
      <PageHeader
        title="Ward Overview"
        subtitle={`${profile?.full_name ?? ''} · ward ${wardId ? wardId.slice(0, 8) : '—'}`}
        actions={
          <>
            <RoleGate allow={['WARD_SISTER', 'ADMIN']} capability="managePatients">
              <GhostButton>
                <span className="inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> New patient
                </span>
              </GhostButton>
            </RoleGate>
            <RoleGate allow={['WARD_SISTER', 'ADMIN']} capability="manageSessions">
              <PrimaryButton>
                <span className="inline-flex items-center gap-1">
                  <PlayCircle className="w-3.5 h-3.5" /> Start IV session
                </span>
              </PrimaryButton>
            </RoleGate>
          </>
        }
      />

      <section className="dashboard-hero ward-hero">
        <div className="hero-copy"><span className="hero-kicker">WARD SNAPSHOT</span><h2>A clear view of today’s care.</h2><p>Review current patient, staffing and alert activity across your ward.</p><div className="hero-inline"><span><Users2 size={15}/> {patients.length} patients</span><span><Activity size={15}/> {nurses.length} nurses</span></div></div>
        <div className="hero-number"><span>OPEN ALERTS</span><strong>{open.length}</strong><small>{open.length ? 'Review and acknowledge' : 'Everything is up to date'}</small><div className="hero-wave" aria-hidden="true"><svg viewBox="0 0 260 78" preserveAspectRatio="none"><path d="M0 54 C32 51 39 20 71 29 S111 69 139 48 S182 20 202 36 S234 57 260 14"/></svg></div></div>
      </section>

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      {/* Ward-level analytics. canWardAnalytics is true here and false for a nurse,
          and the underlying rows are ward-scoped by RLS regardless. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Patients in ward" value={patients.length} />
        <StatTile label="Open alerts" value={open.length} tone={open.length ? 'text-red-400' : 'text-white'} />
        <StatTile label="Nurses on roster" value={nurses.length} />
        <StatTile label="Alert history rows" value={history.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Card title="Patients in your ward">
          {patients.length === 0 ? (
            <EmptyState message="No patients in your ward" />
          ) : (
            <DataTable columns={['Patient', 'MRN', 'Bed']}>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">{p.full_name}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono">{p.mrn}</td>
                  <td className="px-4 py-2.5 text-slate-400">{p.bed_number}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card title="Nurses in your ward">
          {nurses.length === 0 ? (
            <>
              <EmptyState
                message="No nurses visible"
                hint="The profiles policy shows a ward sister the nurses in her own ward, and nobody else."
              />
              <RlsEmptyNote>
                You can see nurses in {wardId ? wardId.slice(0, 8) : 'your ward'} only. Other wards'
                staff are not returned, and you cannot see the user list, change any role, or
                read the audit log.
              </RlsEmptyNote>
            </>
          ) : (
            <DataTable columns={['Name', 'Role', 'Status']}>
              {nurses.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Users2 className="w-3.5 h-3.5 text-slate-500" />
                      {n.full_name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><Badge value={n.role} /></td>
                  <td className="px-4 py-2.5">
                    <span className={n.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                      {n.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Alerts in your ward">
          {alerts.length === 0 ? (
            <EmptyState message="No alerts in your ward" />
          ) : (
            <DataTable columns={['Patient', 'Type', 'Severity', 'Status', '']}>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 text-slate-300">{nameOf(a.patient_id)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{a.alert_type}</td>
                  <td className="px-4 py-2.5"><Badge value={a.severity} /></td>
                  <td className="px-4 py-2.5"><Badge value={a.status} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {a.status === 'OPEN' && (
                      <RoleGate allow={['NURSE', 'WARD_SISTER', 'ADMIN']} capability="acknowledgeAlerts">
                        <GhostButton onClick={() => void handleAcknowledge(a)} disabled={busyAlert === a.id}>
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {busyAlert === a.id ? 'Working' : 'Acknowledge'}
                          </span>
                        </GhostButton>
                      </RoleGate>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card title="Alert history">
          {history.length === 0 ? (
            <EmptyState message="No alert history yet" hint="Rows appear once an alert is acknowledged." />
          ) : (
            <DataTable columns={['Patient', 'Acknowledged by', 'At']}>
              {history.slice(0, 25).map((h, i) => (
                <tr key={`${String(h.alert_id)}-${i}`}>
                  <td className="px-4 py-2.5 text-slate-300">{nameOf(String(h.patient_id))}</td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {String(h.acknowledged_by_name ?? '—')}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                    {h.acknowledged_at
                      ? new Date(String(h.acknowledged_at)).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
