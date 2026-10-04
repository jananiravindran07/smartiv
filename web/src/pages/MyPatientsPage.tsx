// =============================================================================
// SMART IV MONITORING SYSTEM - "MY PATIENTS"  (NURSE landing page)
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// What a nurse sees. The list is not filtered by ward in this file, because it
// does not need to be: the patients SELECT policy calls can_access_patient(),
// which for a NURSE is true only for patients she has a live row in
// nurse_assignments, in her own ward. Ask for anyone else and the row simply
// does not come back.
//
// She can acknowledge an alert on these patients, and only through the
// acknowledge_alert RPC. She has no session controls, no patient editing, no
// devices, no thresholds and no audit trail.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, UsersRound, BellRing } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { acknowledgeAlert, fetchAlerts, fetchPatients } from '../lib/queries';
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
  RlsEmptyNote,
  StatTile,
} from '../components/ui';
import type { Alert, Patient } from '../types/database';

export function MyPatientsPage() {
  const profile = useAuthStore((s) => s.profile);
  const wardId = useAuthStore((s) => s.wardId);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAlert, setBusyAlert] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a] = await Promise.all([fetchPatients(), fetchAlerts()]);
      setPatients(p);
      setAlerts(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your patients.');
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
      await acknowledgeAlert(alert.id, 'Acknowledged from the nurse station.');
      await load();
    } catch (err) {
      // The RPC refuses anything outside the nurse's assignments, so a failure
      // here is the access control working. Show it rather than swallowing it.
      setError(err instanceof Error ? err.message : 'Could not acknowledge the alert.');
    } finally {
      setBusyAlert(null);
    }
  };

  const open = alerts.filter((a) => a.status === 'OPEN');
  const acknowledged = alerts.filter((a) => a.status !== 'OPEN');
  const nameOf = (id: string) => patients.find((p) => p.id === id)?.full_name ?? '—';

  if (loading) return <Loading label="Loading your assigned patients" />;

  return (
    <>
      <PageHeader
        title="My Patients"
        subtitle={`Assignments for ${profile?.full_name ?? ''} · ward ${
          wardId ? wardId.slice(0, 8) : '—'
        }`}
      />

      <section className="dashboard-hero">
        <div className="hero-copy"><span className="hero-kicker">YOUR CARE OVERVIEW</span><h2>Good morning, {profile?.full_name?.split(' ')[0] ?? 'team'}.</h2><p>Your assigned patients and their latest alert activity, together in one place.</p><div className="hero-inline"><span><UsersRound size={15}/> {patients.length} assigned</span><span><BellRing size={15}/> {open.length} open alerts</span></div></div>
        <div className="hero-number"><span>OPEN ALERTS</span><strong>{open.length}</strong><small>{open.length ? 'Needs your attention' : 'No open alerts'}</small><div className="hero-wave" aria-hidden="true"><svg viewBox="0 0 260 78" preserveAspectRatio="none"><path d="M0 54 C32 51 39 20 71 29 S111 69 139 48 S182 20 202 36 S234 57 260 14"/></svg></div></div>
      </section>

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Assigned patients" value={patients.length} />
        <StatTile label="Open alerts" value={open.length} tone={open.length ? 'text-red-400' : 'text-white'} />
        <StatTile label="Acknowledged" value={acknowledged.length} tone="text-emerald-400" />
        <StatTile label="Ward" value={wardId ? wardId.slice(0, 8) : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Assigned patients">
          {patients.length === 0 ? (
            <>
              <EmptyState
                message="No patients assigned to you"
                hint="A ward sister allocates nurses to patients. Until then this list stays empty — that is the assignment table doing its job, not a failed query."
              />
              <RlsEmptyNote>
                You are seeing exactly the patients with a live row in <code>nurse_assignments</code>.
                Patients in your ward that you are not assigned to are not returned by the database
                at all, and neither are patients in any other ward.
              </RlsEmptyNote>
            </>
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

        <Card title="Alerts for your patients">
          {alerts.length === 0 ? (
            <EmptyState message="No alerts on your assigned patients" />
          ) : (
            <DataTable columns={['Patient', 'Alert', 'Severity', 'Status', '']}>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 text-slate-300">{nameOf(a.patient_id)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{a.alert_type}</td>
                  <td className="px-4 py-2.5"><Badge value={a.severity} /></td>
                  <td className="px-4 py-2.5"><Badge value={a.status} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {/* A nurse may acknowledge. She may not edit or delete. */}
                    {a.status === 'OPEN' ? (
                      <RoleGate allow={['NURSE', 'WARD_SISTER', 'ADMIN']} capability="acknowledgeAlerts">
                        <GhostButton onClick={() => void handleAcknowledge(a)} disabled={busyAlert === a.id}>
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {busyAlert === a.id ? 'Working' : 'Acknowledge'}
                          </span>
                        </GhostButton>
                      </RoleGate>
                    ) : (
                      <span className="text-[10px] text-slate-600">
                        {new Date(a.acknowledged_at ?? a.triggered_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-slate-600 leading-relaxed">
        Acknowledgement goes through the <code className="text-slate-500">acknowledge_alert</code>{' '}
        RPC, which verifies your assignment, appends an acknowledgement record, sets the alert
        status and writes an audit entry in one transaction. Alerts are never edited or deleted.
      </p>
    </>
  );
}
