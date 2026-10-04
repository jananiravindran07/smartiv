export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'NURSE' | 'WARD_SISTER' | 'ADMIN';

export type IVStatus = 
  | 'NORMAL' 
  | 'LOW' 
  | 'CRITICAL' 
  | 'EMPTY' 
  | 'FLOW_STOPPED' 
  | 'DEVICE_OFFLINE' 
  | 'SENSOR_ERROR';

export type AlertSeverity = 'LOW' | 'HIGH' | 'CRITICAL';

/** Lifecycle of an alert. Set to ACKNOWLEDGED by acknowledge_alert(); never deleted. */
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export type AcknowledgementStatus = 'ACKNOWLEDGED' | 'ESCALATED' | 'RESOLVED';

export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED';

export interface Ward {
  id: string;
  name: string;
  code: string;
  floor: number;
  capacity: number;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  badge_number: string | null;
  role: UserRole;
  ward_id: string | null;
  /** Deactivated accounts are refused by every RLS policy. See migration 00100. */
  is_active: boolean;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  ward_id: string;
  mrn: string;
  full_name: string;
  bed_number: string;
  date_of_birth: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  device_identifier: string;
  name: string;
  ward_id: string | null;
  secret_hash?: string;
  is_active: boolean;
  last_seen_at: string | null;
  hx711_calibration_factor: number;
  default_empty_bag_mass_g: number;
  default_fluid_density_g_ml: number;
  battery_level: number | null;
  wifi_rssi: number | null;
  created_at: string;
  updated_at: string;
}

export interface IVSession {
  id: string;
  patient_id: string;
  device_id: string;
  ward_id: string;
  medication_name: string;
  initial_volume_ml: number;
  target_flow_rate_ml_hr: number;
  low_threshold_ml: number;
  critical_threshold_ml: number;
  empty_threshold_ml: number;
  empty_bag_mass_g: number;
  fluid_density_g_ml: number;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
  started_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  // Joins
  patient?: Patient;
  device?: Device;
  ward?: Ward;
}

export interface IVTelemetry {
  id: number;
  session_id: string;
  device_id: string;
  raw_mass_g: number;
  calculated_volume_ml: number;
  current_flow_rate_ml_hr: number;
  status: IVStatus;
  battery_level: number | null;
  wifi_rssi: number | null;
  recorded_at: string;
}

export interface Alert {
  id: string;
  session_id: string;
  patient_id: string;
  ward_id: string;
  device_id: string;
  alert_type: IVStatus;
  severity: AlertSeverity;
  message: string;
  current_volume_ml: number | null;
  flow_rate_ml_hr: number | null;
  is_acknowledged: boolean;
  /** Authoritative lifecycle state. is_acknowledged is kept in sync by a trigger. */
  status: AlertStatus;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  resolution_notes: string | null;
  created_at: string;
  // Joins
  patient?: Patient;
  session?: IVSession;
  device?: Device;
  acknowledged_by?: Profile;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
  profile?: Profile;
}

/** ADMIN-only configuration. A NURSE or WARD_SISTER gets zero rows from RLS. */
export interface MonitoringParameters {
  id: string;
  /** NULL = hospital-wide default. A value overrides it for that ward. */
  ward_id: string | null;
  name: string;
  low_threshold_ml: number;
  critical_threshold_ml: number;
  empty_threshold_ml: number;
  flow_stop_threshold_ml_hr: number;
  flow_stop_window_minutes: number;
  alert_cooldown_minutes: number;
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
