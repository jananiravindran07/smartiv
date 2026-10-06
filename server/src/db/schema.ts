import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Two roles only: a nurse sees the beds assigned to them, an admin sees the
 * whole ward and owns staff, devices, alert rules and the activity log.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  staffId: text('staff_id').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['nurse', 'admin'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const beds = sqliteTable('beds', {
  id: integer('id').primaryKey(),
  patientInitials: text('patient_initials').notNull(),
  patientAge: integer('patient_age').notNull(),
  fluidName: text('fluid_name').notNull(),
  bagMl: real('bag_ml').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

/**
 * One Arduino/ESP32 unit carries two load cells, so a unit covers two beds:
 * channel 1 drives the bag on the first bed, channel 2 the bag on the second.
 * A bed belongs to exactly one channel of exactly one unit.
 */
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  unit: text('unit').notNull().unique(),
  keyHash: text('key_hash').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastReadingAt: integer('last_reading_at'),
  createdAt: integer('created_at').notNull(),
});

export const deviceBeds = sqliteTable(
  'device_beds',
  {
    deviceId: text('device_id').notNull().references(() => devices.id),
    bedId: integer('bed_id').notNull().references(() => beds.id),
    channel: integer('channel').notNull(),
  },
  (table) => ({
    primary: primaryKey({ columns: [table.deviceId, table.channel] }),
    oneUnitPerBed: uniqueIndex('device_beds_bed_unique').on(table.bedId),
    unitChannelUnique: uniqueIndex('device_beds_unit_channel_unique').on(table.deviceId, table.channel),
    channelRange: check('device_beds_channel_range', sql`${table.channel} between 1 and 8`),
  }),
);

export const bedAssignments = sqliteTable(
  'bed_assignments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bedId: integer('bed_id').notNull().references(() => beds.id),
    nurseId: text('nurse_id').notNull().references(() => users.id),
    assignedAt: integer('assigned_at').notNull(),
    assignedBy: text('assigned_by').notNull().references(() => users.id),
  },
  (table) => ({ oneNursePerBed: uniqueIndex('bed_assignments_bed_unique').on(table.bedId) }),
);

/**
 * Latest reading plus a short rolling history. `channel` records which load
 * cell produced it so a unit's two bags stay distinguishable in the history.
 */
export const readings = sqliteTable(
  'readings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bedId: integer('bed_id').notNull().references(() => beds.id),
    channel: integer('channel').notNull(),
    bagMl: real('bag_ml').notNull(),
    volumeMl: real('volume_ml').notNull(),
    flowMlH: real('flow_ml_h').notNull(),
    smoothedFlowMlH: real('smoothed_flow_ml_h').notNull(),
    recordedAt: integer('recorded_at').notNull(),
  },
  (table) => ({ byBed: index('readings_bed_recorded_idx').on(table.bedId, table.recordedAt) }),
);

export const alerts = sqliteTable(
  'alerts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bedId: integer('bed_id').notNull().references(() => beds.id),
    severity: text('severity', { enum: ['attention', 'critical'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    acknowledgedAt: integer('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by').references(() => users.id),
  },
  (table) => ({ byBed: index('alerts_bed_created_idx').on(table.bedId, table.createdAt) }),
);

export const acknowledgements = sqliteTable('acknowledgements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bedId: integer('bed_id').notNull().references(() => beds.id),
  alertId: integer('alert_id').references(() => alerts.id),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action', { enum: ['alert_acknowledged', 'bag_replaced', 'flow_restored'] }).notNull(),
  createdAt: integer('created_at').notNull(),
});

/** A single row: id 1 holds the live thresholds for the whole ward. */
export const alertRules = sqliteTable('alert_rules', {
  id: integer('id').primaryKey(),
  criticalMinutes: integer('critical_minutes').notNull(),
  criticalPercent: integer('critical_percent').notNull(),
  attentionMinutes: integer('attention_minutes').notNull(),
  attentionPercent: integer('attention_percent').notNull(),
  updatedBy: text('updated_by').notNull().references(() => users.id),
  updatedAt: integer('updated_at').notNull(),
});

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: text('actor_id').notNull().references(() => users.id),
    action: text('action').notNull(),
    bedId: integer('bed_id').references(() => beds.id),
    details: text('details').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({ newestFirst: index('activity_log_created_idx').on(table.createdAt) }),
);

export type User = typeof users.$inferSelect;
export type Bed = typeof beds.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type DeviceBed = typeof deviceBeds.$inferSelect;
export type Reading = typeof readings.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Role = User['role'];
