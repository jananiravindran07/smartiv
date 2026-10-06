import { and, desc, eq, gt } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { deviceBeds, devices, readings } from '../db/schema.js';
import { calculateSeverity, SEVERITY_RANK, smoothFlowRate, type BedSeverity } from '../domain/calculations.js';
import { getBedSnapshot, openAlert, readRules } from './beds.js';
import type { LiveEvents } from './events.js';

/** One load cell's measurement, exactly as the unit reports it. */
export interface DeviceReading {
  channel?: number;
  bed: number;
  bag_ml: number;
  volume_ml: number;
  flow_ml_h: number;
}

export class ReadingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Resolves the unit that owns a channel and confirms it is mapped to the bed
 * the reading claims, so a copied device key cannot write to another unit's bed.
 */
export function resolveDeviceForBed(db: AppDatabase, deviceId: string, bed: number) {
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).limit(1).all()[0];
  if (!device) throw new ReadingError('This device is not registered.', 401);
  if (!device.active) throw new ReadingError('This device is disabled.', 403);
  const link = db
    .select({ bedId: deviceBeds.bedId, channel: deviceBeds.channel })
    .from(deviceBeds)
    .where(and(eq(deviceBeds.deviceId, deviceId), eq(deviceBeds.bedId, bed)))
    .limit(1)
    .all()[0];
  if (!link) {
    throw new ReadingError('This device is not wired to that bed.', 403);
  }
  return { device, channel: link.channel };
}

export function resolveDeviceForChannel(db: AppDatabase, deviceId: string, channel: number) {
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).limit(1).all()[0];
  if (!device) throw new ReadingError('This device is not registered.', 401);
  if (!device.active) throw new ReadingError('This device is disabled.', 403);
  const link = db
    .select({ bedId: deviceBeds.bedId })
    .from(deviceBeds)
    .where(and(eq(deviceBeds.deviceId, deviceId), eq(deviceBeds.channel, channel)))
    .limit(1)
    .all()[0];
  if (!link) throw new ReadingError('This device has no load cell on that channel.', 403);
  return { device, bed: link.bedId };
}

/**
 * Stores one reading, smooths the flow rate with a moving average, opens a new
 * alert when the bed gets worse, and pushes the result to connected browsers.
 *
 * Smoothing rule: a stopped flow snaps straight to 0 instead of decaying through
 * the window, otherwise a drip that has stopped would still report hours left.
 */
export function ingestReading(
  db: AppDatabase,
  events: LiveEvents,
  deviceId: string,
  input: DeviceReading,
  recordedAt = Date.now(),
) {
  const bedLink = resolveDeviceForBed(db, deviceId, input.bed);
  const channel = input.channel ?? bedLink.channel;
  if (channel !== bedLink.channel) {
    throw new ReadingError(`Bed ${input.bed} is wired to channel ${bedLink.channel}, not ${channel}.`, 403);
  }
  if (input.volume_ml > input.bag_ml) throw new ReadingError('volume_ml cannot be greater than bag_ml.', 400);

  const rules = readRules(db);
  const previousSeverity = getBedSnapshot(db, input.bed, recordedAt)?.severity ?? 'normal';
  const previousFlow = db
    .select({ flowMlH: readings.flowMlH })
    .from(readings)
    .where(and(eq(readings.bedId, input.bed), eq(readings.channel, channel)))
    .orderBy(desc(readings.recordedAt), desc(readings.id))
    .limit(4)
    .all()
    .map((row) => row.flowMlH);
  const smoothedFlowMlH = smoothFlowRate(previousFlow, input.flow_ml_h);

  db.insert(readings)
    .values({
      bedId: input.bed,
      channel,
      bagMl: input.bag_ml,
      volumeMl: input.volume_ml,
      flowMlH: input.flow_ml_h,
      smoothedFlowMlH,
      recordedAt,
    })
    .run();
  db.update(devices).set({ lastReadingAt: recordedAt }).where(eq(devices.id, deviceId)).run();

  const severity = calculateSeverity(
    { bagMl: input.bag_ml, volumeMl: input.volume_ml, flowMlH: input.flow_ml_h, smoothedFlowMlH },
    rules,
  );
  const worsened = SEVERITY_RANK[severity] > SEVERITY_RANK[previousSeverity];
  if (worsened && severity !== 'normal') openAlert(db, input.bed, severity);

  const snapshot = getBedSnapshot(db, input.bed, recordedAt);
  if (snapshot) {
    events.publishBedUpdate(input.bed, snapshot);
    if (worsened && severity === 'critical') events.publishCritical(input.bed, snapshot);
  }

  pruneReadings(db, input.bed);
  return snapshot;
}

/** Keeps a short rolling history per bed so smoothing and charts stay bounded. */
function pruneReadings(db: AppDatabase, bedId: number, keep = 300) {
  const stale = db
    .select({ id: readings.id })
    .from(readings)
    .where(eq(readings.bedId, bedId))
    .orderBy(desc(readings.recordedAt), desc(readings.id))
    .all()
    .slice(keep);
  for (const row of stale) db.delete(readings).where(eq(readings.id, row.id)).run();
}

export function readingsSince(db: AppDatabase, bedId: number, since: number) {
  return db.select().from(readings).where(and(eq(readings.bedId, bedId), gt(readings.recordedAt, since))).all();
}

export type { BedSeverity };
