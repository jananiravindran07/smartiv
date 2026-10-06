import { and, asc, desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import {
  activityLog,
  alertRules,
  alerts,
  bedAssignments,
  beds,
  deviceBeds,
  devices,
  readings,
  users,
  type User,
} from '../db/schema.js';
import {
  calculateBedMetrics,
  compareByMinutesLeft,
  DEFAULT_RULES,
  SEVERITY_RANK,
  type AlertRuleValues,
  type BedMetrics,
  type BedSeverity,
} from '../domain/calculations.js';

export const OFFLINE_AFTER_MS = 10_000;

/**
 * Everything one bed card renders. One ESP32 load cell drives one bag, so a
 * bed carries a single bag and these fields describe it directly.
 */
export interface BedSnapshot {
  bedNumber: number;
  patientInitials: string;
  patientAge: number;
  /** Unit and load cell feeding this bed, null for a bed with no hardware. */
  unit: string | null;
  channel: number | null;
  fluidName: string;
  bagMl: number;
  reportedBagMl: number | null;
  volumeMl: number | null;
  flowMlH: number | null;
  smoothedFlowMlH: number | null;
  percentLeft: number | null;
  /** Minutes until the bag empties, or null when the flow has stopped. */
  minutesLeft: number | null;
  endTime: number | null;
  /** Worst severity for the bed. */
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

export function readRules(db: AppDatabase): AlertRuleValues {
  const [row] = db.select().from(alertRules).where(eq(alertRules.id, 1)).limit(1).all();
  if (!row) return DEFAULT_RULES;
  return {
    criticalMinutes: row.criticalMinutes,
    criticalPercent: row.criticalPercent,
    attentionMinutes: row.attentionMinutes,
    attentionPercent: row.attentionPercent,
  };
}

/** Admins see every active bed, nurses only the beds assigned to them. */
export function visibleBedIds(db: AppDatabase, user: User): number[] {
  if (user.role === 'admin') {
    return db.select({ id: beds.id }).from(beds).where(eq(beds.active, true)).all().map((row) => row.id);
  }
  return db
    .select({ id: bedAssignments.bedId })
    .from(bedAssignments)
    .innerJoin(beds, eq(bedAssignments.bedId, beds.id))
    .where(and(eq(bedAssignments.nurseId, user.id), eq(beds.active, true)))
    .all()
    .map((row) => row.id);
}

export function canAccessBed(db: AppDatabase, user: User, bedId: number): boolean {
  if (!Number.isInteger(bedId) || bedId <= 0) return false;
  if (user.role === 'admin') {
    return db.select({ id: beds.id }).from(beds).where(and(eq(beds.id, bedId), eq(beds.active, true))).limit(1).all().length > 0;
  }
  return (
    db
      .select({ id: bedAssignments.id })
      .from(bedAssignments)
      .innerJoin(beds, eq(bedAssignments.bedId, beds.id))
      .where(and(eq(bedAssignments.nurseId, user.id), eq(bedAssignments.bedId, bedId), eq(beds.active, true)))
      .limit(1)
      .all().length > 0
  );
}

export function latestReading(db: AppDatabase, bedId: number) {
  return db
    .select()
    .from(readings)
    .where(eq(readings.bedId, bedId))
    .orderBy(desc(readings.recordedAt), desc(readings.id))
    .limit(1)
    .all()[0];
}

/**
 * Assembles everything one bed card needs. `now` is injectable so offline
 * detection and countdowns are deterministic under test.
 */
export function getBedSnapshot(db: AppDatabase, bedId: number, now = Date.now()): BedSnapshot | null {
  const bed = db.select().from(beds).where(and(eq(beds.id, bedId), eq(beds.active, true))).limit(1).all()[0];
  if (!bed) return null;

  const link = db
    .select({ unit: devices.unit, channel: deviceBeds.channel, active: devices.active, lastReadingAt: devices.lastReadingAt })
    .from(deviceBeds)
    .innerJoin(devices, eq(deviceBeds.deviceId, devices.id))
    .where(eq(deviceBeds.bedId, bedId))
    .limit(1)
    .all()[0];

  const assignment = db
    .select({ nurseId: users.id, nurseName: users.name })
    .from(bedAssignments)
    .innerJoin(users, eq(bedAssignments.nurseId, users.id))
    .where(eq(bedAssignments.bedId, bedId))
    .limit(1)
    .all()[0];

  const reading = latestReading(db, bedId);
  const rules = readRules(db);
  const offline = !link?.active || link.lastReadingAt === null || now - link.lastReadingAt > OFFLINE_AFTER_MS;

  let metrics: BedMetrics | null = null;
  let severity: BedSeverity = 'normal';
  if (reading) {
    metrics = calculateBedMetrics(
      {
        bagMl: reading.bagMl,
        volumeMl: reading.volumeMl,
        flowMlH: reading.flowMlH,
        smoothedFlowMlH: reading.smoothedFlowMlH,
      },
      rules,
      now,
    );
    severity = metrics.severity;
  }

  // An acknowledgement only silences the alert it was given for. When the bed
  // gets worse a new alert row appears, so the flag resets by construction.
  const openAlert = db
    .select({
      id: alerts.id,
      severity: alerts.severity,
      acknowledgedAt: alerts.acknowledgedAt,
      acknowledgedBy: alerts.acknowledgedBy,
    })
    .from(alerts)
    .where(eq(alerts.bedId, bedId))
    .orderBy(desc(alerts.createdAt), desc(alerts.id))
    .limit(1)
    .all()[0];

  const acknowledgedAlert =
    openAlert && severity !== 'normal' && openAlert.severity === severity && openAlert.acknowledgedAt !== null
      ? openAlert
      : null;
  const acknowledgedByName = acknowledgedAlert?.acknowledgedBy
    ? (db.select({ name: users.name }).from(users).where(eq(users.id, acknowledgedAlert.acknowledgedBy)).limit(1).all()[0]?.name ?? null)
    : null;

  return {
    bedNumber: bed.id,
    patientInitials: bed.patientInitials,
    patientAge: bed.patientAge,
    unit: link?.unit ?? null,
    channel: link?.channel ?? null,
    fluidName: bed.fluidName,
    bagMl: bed.bagMl,
    reportedBagMl: reading?.bagMl ?? null,
    volumeMl: reading?.volumeMl ?? null,
    flowMlH: reading?.flowMlH ?? null,
    smoothedFlowMlH: reading?.smoothedFlowMlH ?? null,
    percentLeft: metrics?.percentLeft ?? null,
    minutesLeft: metrics?.minutesLeft ?? null,
    endTime: metrics?.endTime ?? null,
    severity,
    offline,
    hasDevice: Boolean(link),
    lastReadingAt: link?.lastReadingAt ?? null,
    assignedNurseId: assignment?.nurseId ?? null,
    assignedNurse: assignment?.nurseName ?? null,
    acknowledged: acknowledgedAlert !== null,
    acknowledgedBy: acknowledgedAlert?.acknowledgedBy ?? null,
    acknowledgedByName,
    acknowledgedAt: acknowledgedAlert?.acknowledgedAt ?? null,
  };
}

/** Beds in dashboard order: Critical, Attention soon, then Running normally. */
export function listVisibleBeds(db: AppDatabase, user: User, now = Date.now()): BedSnapshot[] {
  return visibleBedIds(db, user)
    .map((id) => getBedSnapshot(db, id, now))
    .filter((bed): bed is BedSnapshot => bed !== null)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || compareByMinutesLeft(a, b));
}

export function writeActivity(db: AppDatabase, actorId: string, action: string, details: string, bedId: number | null = null) {
  db.insert(activityLog).values({ actorId, action, details, bedId, createdAt: Date.now() }).run();
}

/** Opens a fresh alert row, which resets any earlier acknowledgement. */
export function openAlert(db: AppDatabase, bedId: number, severity: Exclude<BedSeverity, 'normal'>) {
  return db.insert(alerts).values({ bedId, severity, createdAt: Date.now(), acknowledgedAt: null, acknowledgedBy: null }).run();
}

export function bedAssignmentCounts(db: AppDatabase): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of db.select({ nurseId: bedAssignments.nurseId, bedId: bedAssignments.bedId }).from(bedAssignments).all()) {
    const existing = grouped.get(row.nurseId);
    if (existing) existing.push(row.bedId);
    else grouped.set(row.nurseId, [row.bedId]);
  }
  return grouped;
}

export function recentReadings(db: AppDatabase, bedId: number, limit: number) {
  return db
    .select()
    .from(readings)
    .where(eq(readings.bedId, bedId))
    .orderBy(desc(readings.recordedAt), desc(readings.id))
    .limit(limit)
    .all()
    .reverse();
}

export function firstReading(db: AppDatabase, bedId: number) {
  return db.select().from(readings).where(eq(readings.bedId, bedId)).orderBy(asc(readings.recordedAt)).limit(1).all()[0];
}
