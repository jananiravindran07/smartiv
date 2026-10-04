// =============================================================================
// SMART IV MONITORING SYSTEM - UI PERMISSION MATRIX
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// IMPORTANT: this file is CONVENIENCE ONLY.
//
// Every check here hides a button, a tab or a route. None of it is a security
// control. The real boundary is Row Level Security in Postgres (migrations
// 00100-00600). If this file and the RLS policies ever disagree, RLS wins and
// the request comes back empty or refused.
//
// The matrix below is a transcription of the permission matrix in the brief and
// of the policies in 20260101000400_rbac_policies_replace.sql. Keeping the two in
// the same shape is deliberate: a reviewer can diff them by eye.
// =============================================================================

export type Role = 'NURSE' | 'WARD_SISTER' | 'ADMIN';

export const ALL_ROLES: Role[] = ['NURSE', 'WARD_SISTER', 'ADMIN'];

export const ROLE_LABEL: Record<Role, string> = {
  NURSE: 'Nurse',
  WARD_SISTER: 'Ward Sister',
  ADMIN: 'Administrator',
};

/** Where a freshly signed-in user lands. */
export const ROLE_HOME: Record<Role, string> = {
  NURSE: '/my-patients',
  WARD_SISTER: '/ward',
  ADMIN: '/admin',
};

/**
 * Capability flags consumed by <RoleGate allow={...}> and by the nav builder.
 *
 * Written as an array of roles per capability rather than booleans per role so
 * that adding a capability cannot accidentally default to "allowed".
 */
export const CAN = {
  /** Pick a ward other than your own. ADMIN only; others are pinned to their ward. */
  switchWard: ['ADMIN'],

  /** Start / pause / end an IV session. */
  manageSessions: ['WARD_SISTER', 'ADMIN'],
  /** Create or edit a patient record. */
  managePatients: ['WARD_SISTER', 'ADMIN'],
  /** Allocate nurses to patients. */
  assignNurses: ['WARD_SISTER', 'ADMIN'],

  /** Acknowledge an alert. Always via the acknowledge_alert RPC, never a direct write. */
  acknowledgeAlerts: ['NURSE', 'WARD_SISTER', 'ADMIN'],

  /** See pole units in the ward. Nurses see no device rows at all. */
  viewDevices: ['WARD_SISTER', 'ADMIN'],
  /** Change device configuration, calibration or secrets. */
  manageDevices: ['ADMIN'],

  manageWards: ['ADMIN'],
  manageUsers: ['ADMIN'],
  viewThresholds: ['ADMIN'],
  viewAuditLog: ['ADMIN'],

  /** Analytics restricted to one ward. */
  wardAnalytics: ['WARD_SISTER', 'ADMIN'],
  /** Analytics spanning the whole hospital. */
  crossWardAnalytics: ['ADMIN'],

  /** Inject fake telemetry. Writes clinical data, so ADMIN only. */
  runSimulation: ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAN;

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return (CAN[capability] as readonly Role[]).includes(role);
}

export function canAny(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

// -----------------------------------------------------------------------------
// Navigation
// -----------------------------------------------------------------------------

export interface NavItem {
  to: string;
  label: string;
  capability?: Capability;
  allow?: readonly Role[];
  end?: boolean;
}

/**
 * The sidebar is built from this list filtered by role, so a nurse cannot even
 * see the link to the audit log. Again: hiding a link is not access control.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/my-patients', label: 'My Patients', allow: ['NURSE'] },
  { to: '/ward', label: 'Ward Overview', allow: ['WARD_SISTER'] },
  { to: '/admin', label: 'Admin Console', allow: ['ADMIN'], end: true },
  { to: '/admin/users', label: 'Users', allow: ['ADMIN'] },
  { to: '/admin/wards', label: 'Wards', allow: ['ADMIN'] },
  { to: '/admin/devices', label: 'Devices', allow: ['ADMIN'] },
  { to: '/admin/parameters', label: 'Monitoring Parameters', allow: ['ADMIN'] },
  { to: '/admin/audit', label: 'Audit Log', allow: ['ADMIN'] },
];

export function navFor(role: Role | null | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => {
    if (item.allow) return item.allow.includes(role);
    if (item.capability) return can(role, item.capability);
    return false;
  });
}

/** The single landing route for a role, used by the post-login redirect. */
export function homeFor(role: Role | null | undefined): string {
  if (!role) return '/login';
  return ROLE_HOME[role];
}
