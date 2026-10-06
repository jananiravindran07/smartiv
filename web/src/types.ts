export type Role = 'nurse' | 'admin';
export type BedSeverity = 'critical' | 'attention' | 'normal';
export type ViewId = 'dash' | 'staff' | 'rules' | 'devices' | 'log';

export interface SessionUser {
  id: string;
  staffId: string;
  name: string;
  role: Role;
}

/** One bed and its single IV bag, as the dashboard card needs it. */
export interface Bed {
  bedNumber: number;
  patientInitials: string;
  patientAge: number;
  unit: string | null;
  channel: number | null;
  fluidName: string;
  bagMl: number;
  reportedBagMl: number | null;
  volumeMl: number | null;
  flowMlH: number | null;
  smoothedFlowMlH: number | null;
  percentLeft: number | null;
  minutesLeft: number | null;
  endTime: number | null;
  severity: BedSeverity;
  offline: boolean;
  hasDevice: boolean;
  lastReadingAt: number | null;
  assignedNurseId: string | null;
  assignedNurse: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: number | null;
}

export interface AlertRules {
  criticalMinutes: number;
  criticalPercent: number;
  attentionMinutes: number;
  attentionPercent: number;
}

export interface StaffMember {
  id: string;
  staffId: string;
  name: string;
  role: Role;
  active: boolean;
  bedIds: number[];
}

export interface DeviceChannel {
  channel: number;
  bedId: number;
  fluidName: string | null;
  bagMl: number | null;
}

export interface Device {
  id: string;
  unit: string;
  active: boolean;
  lastReadingAt: number | null;
  createdAt: number;
  channels: DeviceChannel[];
}

export interface DevicesResponse {
  devices: Device[];
  source: 'simulated' | 'arduino';
  offlineAfterMs: number;
}

export interface ActivityEntry {
  id: number;
  actor: string;
  staffId: string;
  action: string;
  bedId: number | null;
  details: string;
  createdAt: number;
}

export interface MetaResponse {
  simulate: boolean;
  speeds: number[];
  source: 'simulated' | 'arduino';
}

export const BED_ACTIONS = ['acknowledge', 'bag-replaced', 'flow-restored'] as const;
export type BedAction = (typeof BED_ACTIONS)[number];
