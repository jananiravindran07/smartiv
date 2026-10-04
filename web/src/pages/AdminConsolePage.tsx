// =============================================================================
// SMART IV MONITORING SYSTEM - "ADMIN CONSOLE"  (ADMIN landing page)
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Five pages behind /admin, all of them ADMIN-only by route guard as well as by
// the profiles, wards, devices, monitoring_parameters and audit_logs policies.
//
// Note what is NOT here: there is no edit control for a reading, an alert, an
// acknowledgement or an audit row, for an administrator or anyone else. Those
// tables are immutable by trigger and by privilege. Administration covers
// identity and configuration, not clinical history.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import {
  deactivateUser,
  fetchAuditLogs,
  fetchDevices,
  fetchMonitoringParameters,
  fetchStaff,
  fetchWards,
  manageUser,
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
import { ROLE_LABEL, type Role } from '../lib/permissions';
import type { Device, MonitoringParameters, Profile, Ward } from '../types/database';

type Tab = 'users' | 'wards' | 'devices' | 'parameters' | 'audit';

const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'wards', label: 'Wards' },
  { id: 'devices', label: 'Devices' },
  { id: 'parameters', label: 'Monitoring Parameters' },
  { id: 'audit', label: 'Audit Log' },
];

export function AdminConsolePage({ tab }: { tab: Tab }) {
  const me = useAuthStore((s) => s.profile);

  const [wards, setWards] = useState<Ward[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [parameters, setParameters] = useState<MonitoringParameters[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [auditFilter, setAuditFilter] = useState({ userId: '', action: '', from: '', to: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, s, d, p, a] = await Promise.all([
        fetchWards(),
        fetchStaff(),
        fetchDevices(),
        fetchMonitoringParameters(),
        fetchAuditLogs({
          userId: auditFilter.userId || undefined,
          action: auditFilter.action || undefined,
          from: auditFilter.from ? new Date(auditFilter.from).toISOString() : undefined,
          to: auditFilter.to ? new Date(`${auditFilter.to}T23:59:59`).toISOString() : undefined,
        }),
      ]);
      setWards(w);
      setStaff(s);
      setDevices(d);
      setParameters(p);
      setAudit(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the admin console.');
    } finally {
      setLoading(false);
    }
  }, [auditFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action was refused.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading label="Loading admin console" />;

  const activeAdmins = staff.filter((s) => s.role === 'ADMIN' && s.is_active).length;
  const activeDevices = devices.filter((d) => d.is_active).length;

  return (
    <>
      <PageHeader
        title="Admin Console"
        subtitle={`Signed in as ${me?.full_name ?? ''} · hospital-wide`}
        actions={
          <RoleGate allow={['ADMIN']} capability="manageUsers">
            <PrimaryButton>
              <span className="inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Create user
              </span>
            </PrimaryButton>
          </RoleGate>
        }
      />

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      {/* Tabs mirror the sidebar. Both come from the same capability list. */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`/admin/${t.id === 'users' ? '' : t.id}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 border border-slate-700/60'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Accounts" value={staff.length} />
        <StatTile label="Active admins" value={activeAdmins} tone="text-amber-400" />
        <StatTile label="Wards" value={wards.length} />
        <StatTile label="Active devices" value={activeDevices} tone="text-emerald-400" />
      </div>

      {/* ---------------------------------------------------------------- USERS */}
      {tab === 'users' && (
        <Card title="Users">
          {staff.length === 0 ? (
            <EmptyState message="No accounts" />
          ) : (
            <DataTable columns={['Name', 'Email', 'Role', 'Ward', 'Status', 'Actions']}>
              {staff.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">
                    {u.full_name}
                    {u.id === me?.id && (
                      <span className="ml-1.5 text-[10px] text-slate-500">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      disabled={busy === u.id || u.id === me?.id}
                      onChange={(e) =>
                        void run(u.id, () =>
                          manageUser({ userId: u.id, role: e.target.value as Role }),
                        )
                      }
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {(['NURSE', 'WARD_SISTER', 'ADMIN'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">
                    {u.ward_id ? u.ward_id.slice(0, 8) : 'all wards'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={u.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {/* Deactivating yourself is refused server-side, so the button
                        is hidden rather than offering an action that must fail. */}
                    {u.id !== me?.id && (
                      <RoleGate allow={['ADMIN']} capability="manageUsers">
                        {u.is_active ? (
                          <GhostButton
                            onClick={() => void run(u.id, () => deactivateUser(u.id))}
                            disabled={busy === u.id}
                          >
                            <span className="inline-flex items-center gap-1">
                              <Ban className="w-3.5 h-3.5" />
                              {busy === u.id ? 'Working' : 'Deactivate'}
                            </span>
                          </GhostButton>
                        ) : (
                          <GhostButton
                            onClick={() => void run(u.id, () => manageUser({ userId: u.id, isActive: true }))}
                            disabled={busy === u.id}
                          >
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Reactivate
                            </span>
                          </GhostButton>
                        )}
                      </RoleGate>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <RlsEmptyNote>
            Role and ward changes go through the <code>admin_manage_user</code> RPC, which refuses
            self-targeting, refuses to remove the last active admin, and writes an audit row for
            every change. The same protection exists at the column level, so even a hand-written
            <code> UPDATE profiles SET role='ADMIN' </code> is refused.
          </RlsEmptyNote>
        </Card>
      )}

      {/* ---------------------------------------------------------------- WARDS */}
      {tab === 'wards' && (
        <Card title="Wards">
          {wards.length === 0 ? (
            <EmptyState message="No wards" />
          ) : (
            <DataTable columns={['Name', 'Code', 'Floor', 'Capacity']}>
              {wards.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">{w.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono">{w.code}</td>
                  <td className="px-4 py-2.5 text-slate-400">{w.floor}</td>
                  <td className="px-4 py-2.5 text-slate-400">{w.capacity}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}

      {/* -------------------------------------------------------------- DEVICES */}
      {tab === 'devices' && (
        <Card title="Devices">
          {devices.length === 0 ? (
            <EmptyState message="No devices" />
          ) : (
            <DataTable columns={['Identifier', 'Name', 'Ward', 'Battery', 'Last seen', 'Status']}>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5 text-slate-200 font-mono">{d.device_identifier}</td>
                  <td className="px-4 py-2.5 text-slate-300">{d.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">
                    {d.ward_id ? d.ward_id.slice(0, 8) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{d.battery_level ?? '—'}%</td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge value={d.is_active ? 'ACTIVE' : 'ABORTED'}>
                      {d.is_active ? 'Active' : 'Disabled'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------- PARAMETERS */}
      {tab === 'parameters' && (
        <Card title="Monitoring parameters">
          {parameters.length === 0 ? (
            <EmptyState
              message="No monitoring parameters"
              hint="Administrators only. Nurses and ward sisters receive zero rows from this table."
            />
          ) : (
            <DataTable columns={['Name', 'Scope', 'Low', 'Critical', 'Empty', 'Cooldown']}>
              {parameters.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">
                    {p.ward_id ? p.ward_id.slice(0, 8) : 'hospital-wide'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{p.low_threshold_ml} mL</td>
                  <td className="px-4 py-2.5 text-slate-400">{p.critical_threshold_ml} mL</td>
                  <td className="px-4 py-2.5 text-slate-400">{p.empty_threshold_ml} mL</td>
                  <td className="px-4 py-2.5 text-slate-400">{p.alert_cooldown_minutes} min</td>
                </tr>
              ))}
            </DataTable>
          )}
          <RlsEmptyNote>
            Every change here writes a <code>THRESHOLD_CHANGED</code> audit row. Existing sessions
            keep the threshold snapshot they started with, so historical readings are never
            reinterpreted.
          </RlsEmptyNote>
        </Card>
      )}

      {/* ---------------------------------------------------------------- AUDIT */}
      {tab === 'audit' && (
        <Card title="Audit log">
          {/* Filters, as required: by user, by action, by date range. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-4 border-b border-slate-800">
            <select
              value={auditFilter.userId}
              onChange={(e) => setAuditFilter((f) => ({ ...f, userId: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200"
            >
              <option value="">All users</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>

            <select
              value={auditFilter.action}
              onChange={(e) => setAuditFilter((f) => ({ ...f, action: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200"
            >
              <option value="">All actions</option>
              {[
                'LOGIN', 'LOGOUT', 'SESSION_EXPIRED',
                'ALERT_ACKNOWLEDGED', 'PATIENT_CREATED', 'PATIENT_UPDATED',
                'SESSION_STARTED', 'SESSION_ENDED', 'SESSION_UPDATED',
                'DEVICE_CHANGED', 'THRESHOLD_CHANGED', 'THRESHOLD_CREATED',
                'ROLE_CHANGED', 'WARD_CHANGED', 'USER_CREATED', 'USER_DEACTIVATED',
                'NURSE_ASSIGNED', 'BOOTSTRAP_ADMIN_CREATED',
              ].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={auditFilter.from}
              onChange={(e) => setAuditFilter((f) => ({ ...f, from: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200"
            />
            <input
              type="date"
              value={auditFilter.to}
              onChange={(e) => setAuditFilter((f) => ({ ...f, to: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200"
            />
          </div>

          {audit.length === 0 ? (
            <>
              <EmptyState message="No audit entries match" />
              <RlsEmptyNote>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  Administrators only. Nurses and ward sisters receive zero rows from
                  <code> audit_logs</code>, and no client role can insert, update or delete a row.
                </span>
              </RlsEmptyNote>
            </>
          ) : (
            <DataTable columns={['When', 'Actor', 'Action', 'Entity', 'Id']}>
              {audit.map((row) => (
                <tr key={String(row.id)}>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                    {new Date(String(row.created_at)).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">
                    {staff.find((u) => u.id === row.user_id)?.full_name ?? 'system'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      {String(row.action).startsWith('ALERT') && (
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                      )}
                      {String(row.action).startsWith('SESSION') && (
                        <Activity className="w-3 h-3 text-cyan-400" />
                      )}
                      <span className="font-mono text-[11px]">{String(row.action)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{String(row.entity_type)}</td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono text-[10px]">
                    {row.entity_id ? String(row.entity_id).slice(0, 8) : '—'}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </>
  );
}
