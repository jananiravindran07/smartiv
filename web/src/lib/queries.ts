// =============================================================================
// SMART IV MONITORING SYSTEM - DATA ACCESS
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Every read in the app is an ordinary PostgREST query using the signed-in user's
// anon-key client. There is no "admin client" and no way to ask for another
// ward's rows: RLS decides what comes back.
//
// The practical consequence, and the reason this file is so plain: a nurse
// cannot widen these queries. Filtering by ward in the UI is a nicety, but the
// query for a patient in another ward returns nothing at all, because the
// patients SELECT policy calls can_access_patient() and that returns false.
//
// Writes are equally narrow. There is deliberately no function here that
// updates an alert or a reading: acknowledgement goes through the
// acknowledge_alert RPC and telemetry only ever arrives from the ingest Edge
// Function.
// =============================================================================

import { isDemoMode, supabase } from './supabase';
import { useAuthStore, DEMO_PERSONAS } from '../stores/authStore';
import {
  INITIAL_ALERTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_DEVICES,
  INITIAL_PATIENTS,
  INITIAL_PROFILES,
  INITIAL_WARDS,
} from './mockData';
import type { Alert, Device, MonitoringParameters, Patient, Profile, Ward } from '../types/database';

// Demo fixtures are deliberately in-memory only. They exercise the UI's role
// filtering but do not emulate database RLS or write to Supabase.
const DEMO_ASSIGNMENTS: Record<string, string[]> = {
  // Clara has three explicit assignments; Sarah Jenkins stays visible to the
  // ward sister and admin, which makes the role boundary easy to demonstrate.
  'demo-nurse-clara': [
    'p0000000-0000-0000-0000-000000000001',
    'p0000000-0000-0000-0000-000000000002',
    'p0000000-0000-0000-0000-000000000004',
  ],
};
const DEMO_PARAMETERS: MonitoringParameters[] = [
  { id: 'param-demo-ward-a', ward_id: 'a0000000-0000-0000-0000-000000000001', name: 'General ward fluid monitoring', low_threshold_ml: 150, critical_threshold_ml: 50, empty_threshold_ml: 5, flow_stop_threshold_ml_hr: 5, flow_stop_window_minutes: 3, alert_cooldown_minutes: 10, is_active: true, updated_by: 'demo-admin-watson', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'param-demo-default', ward_id: null, name: 'Hospital default', low_threshold_ml: 100, critical_threshold_ml: 30, empty_threshold_ml: 5, flow_stop_threshold_ml_hr: 5, flow_stop_window_minutes: 3, alert_cooldown_minutes: 10, is_active: true, updated_by: 'demo-admin-watson', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

function demoActor() { return useAuthStore.getState(); }
function demoPatientIds(): Set<string> {
  const { role, profile } = demoActor();
  if (role === 'ADMIN') return new Set(INITIAL_PATIENTS.map((patient) => patient.id));
  if (role === 'WARD_SISTER') return new Set(INITIAL_PATIENTS.filter((patient) => patient.ward_id === profile?.ward_id).map((patient) => patient.id));
  if (role === 'NURSE') return new Set(DEMO_ASSIGNMENTS[profile?.id ?? ''] ?? []);
  return new Set();
}
function demoProfileId(id: string): string {
  const profile = INITIAL_PROFILES.find((item) => item.id === id);
  return DEMO_PERSONAS.find((persona) => persona.role === profile?.role)?.id ?? id;
}
const demoAudit: Record<string, unknown>[] = INITIAL_AUDIT_LOGS.map((row) => ({ ...row, user_id: row.user_id ? demoProfileId(row.user_id) : null }));
const demoAlertHistory: Record<string, unknown>[] = INITIAL_ALERTS.filter((alert) => alert.status !== 'OPEN').map((alert) => ({
  alert_id: alert.id, patient_id: alert.patient_id, ward_id: alert.ward_id,
  acknowledged_by: alert.acknowledged_by_user_id ? demoProfileId(alert.acknowledged_by_user_id) : null,
  acknowledged_at: alert.acknowledged_at, triggered_at: alert.triggered_at,
  acknowledged_by_name: DEMO_PERSONAS.find((persona) => persona.id === demoProfileId(alert.acknowledged_by_user_id ?? ''))?.full_name ?? 'Care team',
}));

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export async function fetchWards(): Promise<Ward[]> {
  if (isDemoMode) {
    const { role, profile } = demoActor();
    return role === 'ADMIN' ? INITIAL_WARDS : INITIAL_WARDS.filter((ward) => ward.id === profile?.ward_id);
  }
  const { data, error } = await supabase.from('wards').select('*').order('name');
  if (error) throw error;
  return data as Ward[];
}

/**
 * Patients visible to the caller.
 *
 * No ward filter is applied on purpose. For a nurse this returns only her
 * assigned patients; for a ward sister only her ward; for an admin, everything.
 * The narrower the UI filter, the more obvious it is that the database is doing
 * the work.
 */
export async function fetchPatients(): Promise<Patient[]> {
  if (isDemoMode) {
    const visibleIds = demoPatientIds();
    return INITIAL_PATIENTS.filter((patient) => visibleIds.has(patient.id));
  }
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('full_name');
  if (error) throw error;
  return data as Patient[];
}

export async function fetchAlerts(limit = 50): Promise<Alert[]> {
  if (isDemoMode) {
    const visibleIds = demoPatientIds();
    return INITIAL_ALERTS.filter((alert) => visibleIds.has(alert.patient_id))
      .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at)).slice(0, limit);
  }
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('triggered_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Alert[];
}

/** Alert plus its acknowledgement trail. ADMIN and the ward's WARD_SISTER only. */
export async function fetchAlertHistory(limit = 100) {
  if (isDemoMode) {
    const { role, profile } = demoActor();
    if (role !== 'ADMIN' && role !== 'WARD_SISTER') return [];
    return demoAlertHistory.filter((row) => role === 'ADMIN' || row.ward_id === profile?.ward_id).slice(0, limit);
  }
  const { data, error } = await supabase
    .from('alert_history')
    .select('*')
    .order('triggered_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Record<string, unknown>[];
}

/** Nurses see only themselves; a ward sister sees her ward's nurses; admin sees all. */
export async function fetchStaff(): Promise<Profile[]> {
  if (isDemoMode) {
    const { role, profile } = demoActor();
    if (role === 'NURSE') return profile ? [profile] : [];
    const visible = role === 'ADMIN'
      ? INITIAL_PROFILES
      : INITIAL_PROFILES.filter((item) => item.ward_id === profile?.ward_id && item.role === 'NURSE');
    return visible.map((item) => ({ ...item, id: demoProfileId(item.id) }));
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, ward_id, is_active, badge_number')
    .order('full_name');
  if (error) throw error;
  return data as Profile[];
}

/** ADMIN sees every device; a ward sister sees her own ward; a nurse sees none. */
export async function fetchDevices(): Promise<Device[]> {
  if (isDemoMode) {
    const { role, profile } = demoActor();
    if (role === 'NURSE') return [];
    return INITIAL_DEVICES.filter((device) => role === 'ADMIN' || device.ward_id === profile?.ward_id);
  }
  const { data, error } = await supabase.from('devices').select('*').order('device_identifier');
  if (error) throw error;
  return data as Device[];
}

/** ADMIN only. A nurse or ward sister gets an empty list, not an error page. */
export async function fetchMonitoringParameters(): Promise<MonitoringParameters[]> {
  if (isDemoMode) return demoActor().role === 'ADMIN' ? DEMO_PARAMETERS : [];
  const { data, error } = await supabase
    .from('monitoring_parameters')
    .select('*')
    .order('name');
  if (error) throw error;
  return data as MonitoringParameters[];
}

/** ADMIN only. Filters are pushed into the query so paging stays cheap. */
export async function fetchAuditLogs(filters?: {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  if (isDemoMode) {
    if (demoActor().role !== 'ADMIN') return [];
    return demoAudit.filter((row) => {
      const createdAt = String(row.created_at ?? '');
      return (!filters?.userId || row.user_id === filters.userId)
        && (!filters?.action || row.action === filters.action)
        && (!filters?.from || createdAt >= filters.from)
        && (!filters?.to || createdAt <= filters.to);
    }).slice(0, filters?.limit ?? 200);
  }

  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 200);

  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.action) query = query.eq('action', filters.action);
  if (filters?.from) query = query.gte('created_at', filters.from);
  if (filters?.to) query = query.lte('created_at', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return data as Record<string, unknown>[];
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

/**
 * Acknowledge an alert.
 *
 * This is the ONLY alert mutation in the app. There is no update-the-row path
 * and no delete path, because the alert table is immutable by design: the RPC
 * appends an alert_acknowledgements row, sets alerts.status, writes the audit
 * row and leaves the original alert in place.
 */
export async function acknowledgeAlert(alertId: string, notes?: string) {
  if (isDemoMode) {
    const actor = demoActor();
    const alert = INITIAL_ALERTS.find((item) => item.id === alertId);
    if (!actor.profile || !alert || !demoPatientIds().has(alert.patient_id)) throw new Error('This demo account cannot acknowledge that alert.');
    if (alert.status !== 'OPEN') return { success: true, acknowledged_by: actor.profile.id, acknowledged_at: alert.acknowledged_at ?? new Date().toISOString() };
    const acknowledgedAt = new Date().toISOString();
    alert.is_acknowledged = true;
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledged_at = acknowledgedAt;
    alert.acknowledged_by_user_id = actor.profile.id;
    alert.resolution_notes = notes?.trim() || null;
    demoAlertHistory.unshift({ alert_id: alert.id, patient_id: alert.patient_id, ward_id: alert.ward_id, acknowledged_by: actor.profile.id, acknowledged_by_name: actor.profile.full_name, acknowledged_at: acknowledgedAt, triggered_at: alert.triggered_at });
    demoAudit.unshift({ id: `log-demo-${Date.now()}`, user_id: actor.profile.id, action: 'ALERT_ACKNOWLEDGED', entity_type: 'ALERT', entity_id: alert.id, metadata: { patient_id: alert.patient_id }, created_at: acknowledgedAt });
    return { success: true, acknowledged_by: actor.profile.id, acknowledged_at: acknowledgedAt };
  }
  const { data, error } = await supabase.rpc('acknowledge_alert', {
    p_alert_id: alertId,
    p_notes: notes?.trim() ? notes.trim() : null,
  });
  if (error) throw error;
  return data as { success: boolean; acknowledged_by: string; acknowledged_at: string };
}

/** ADMIN only, audited, and the single writer for role / ward / active status. */
export async function manageUser(params: {
  userId: string;
  role?: string | null;
  fullName?: string | null;
  wardId?: string | null;
  isActive?: boolean | null;
}) {
  if (isDemoMode) {
    if (demoActor().role !== 'ADMIN') throw new Error('Administrator access is required in demo mode.');
    const user = INITIAL_PROFILES.find((item) => demoProfileId(item.id) === params.userId || item.id === params.userId);
    if (!user) throw new Error('Demo user was not found.');
    if (params.role !== undefined && params.role !== null) user.role = params.role as Profile['role'];
    if (params.fullName !== undefined && params.fullName !== null) user.full_name = params.fullName;
    if (params.wardId !== undefined) user.ward_id = params.wardId;
    if (params.isActive !== undefined && params.isActive !== null) user.is_active = params.isActive;
    return { success: true, action: 'USER_UPDATED' };
  }
  const { data, error } = await supabase.rpc('admin_manage_user', {
    p_user_id: params.userId,
    p_role: params.role ?? null,
    p_full_name: params.fullName ?? null,
    p_ward_id: params.wardId ?? null,
    p_is_active: params.isActive ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; action: string };
}

/** ADMIN only. Deactivates and revokes the user's live nurse assignments. */
export async function deactivateUser(userId: string) {
  if (isDemoMode) {
    if (demoActor().role !== 'ADMIN') throw new Error('Administrator access is required in demo mode.');
    const user = INITIAL_PROFILES.find((item) => demoProfileId(item.id) === userId || item.id === userId);
    if (!user) throw new Error('Demo user was not found.');
    user.is_active = false;
    return { success: true, assignments_revoked: DEMO_ASSIGNMENTS[userId]?.length ?? 0 };
  }
  const { data, error } = await supabase.rpc('admin_deactivate_user', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as { success: boolean; assignments_revoked: number };
}

export async function updateFullName(fullName: string) {
  if (isDemoMode) {
    const actor = demoActor();
    if (!actor.profile) throw new Error('Sign in before updating your profile.');
    actor.profile.full_name = fullName;
    const persona = DEMO_PERSONAS.find((item) => item.id === actor.profile?.id);
    if (persona) persona.full_name = fullName;
    return;
  }
  // Cosmetic self-service only. role, ward_id and is_active are not writable
  // from the client at all: the column grant and the guard trigger both refuse.
  const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', (await currentUserId()) ?? '');
  if (error) throw error;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
