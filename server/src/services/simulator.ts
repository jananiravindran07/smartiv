import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { beds, deviceBeds, readings } from '../db/schema.js';
import { latestReading } from './beds.js';
import type { LiveEvents } from './events.js';
import { ingestReading } from './readings.js';

export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Stands in for the hardware behind SIMULATE=true. It emits exactly the same
 * payload shape as the ESP32 sketch and goes through the same ingestion path,
 * so switching to real units needs no front-end change: just set SIMULATE=false.
 */
export class Simulator {
  private timer: NodeJS.Timeout | undefined;
  private speed: Speed = 10;
  /** Beds the prototype leaves stopped, plus any bed a nurse has marked restored. */
  private readonly stopped = new Set<number>([12]);

  constructor(
    private readonly db: AppDatabase,
    private readonly events: LiveEvents,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000);
    this.step();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
  }

  getSpeed(): Speed {
    return this.speed;
  }

  /** "Flow restored" unblocks the simulator the same way a nurse reopens a clamp. */
  restoreFlow(bedId: number) {
    this.stopped.delete(bedId);
  }

  stopFlow(bedId: number) {
    this.stopped.add(bedId);
  }

  /** "Bag replaced" refills the bag, which is what a fresh load cell would read. */
  replaceBag(bedId: number) {
    const latest = latestReading(this.db, bedId);
    if (!latest) return;
    const deviceId = this.deviceFor(bedId);
    if (!deviceId) return;
    try {
      ingestReading(
        this.db,
        this.events,
        deviceId,
        { bed: bedId, bag_ml: latest.bagMl, volume_ml: latest.bagMl, flow_ml_h: latest.flowMlH },
        Date.now(),
      );
    } catch (error) {
      console.error('Simulator could not replace the bag:', error);
    }
  }

  private deviceFor(bedId: number): string | null {
    return (
      this.db
        .select({ deviceId: deviceBeds.deviceId })
        .from(deviceBeds)
        .where(eq(deviceBeds.bedId, bedId))
        .limit(1)
        .all()[0]?.deviceId ?? null
    );
  }

  /**
   * Advances every active bed by one tick. Volume drains at the reported flow
   * scaled by the demo speed, matching the prototype's 1x/10x/60x control.
   */
  private step() {
    const now = Date.now();
    for (const bed of this.db.select().from(beds).where(eq(beds.active, true)).all()) {
      const latest = latestReading(this.db, bed.id);
      if (!latest) continue;
      const deviceId = this.deviceFor(bed.id);
      if (!deviceId) continue;
      const stopped = this.stopped.has(bed.id) || latest.volumeMl <= 0;
      const flow = stopped ? 0 : Math.max(0, Math.round(latest.flowMlH + (Math.random() - 0.5) * 6));
      const volumeMl = Math.max(0, latest.volumeMl - (flow * this.speed) / 3600);
      try {
        ingestReading(
          this.db,
          this.events,
          deviceId,
          { bed: bed.id, channel: latest.channel, bag_ml: latest.bagMl, volume_ml: volumeMl, flow_ml_h: flow },
          now,
        );
      } catch (error) {
        console.error(`Simulator could not ingest bed ${bed.id}:`, error);
      }
    }
  }

  /** Number of readings currently stored, used by the admin Devices view. */
  readingCount(bedId: number) {
    return this.db.select({ id: readings.id }).from(readings).where(eq(readings.bedId, bedId)).all().length;
  }
}

export function latestDeviceReadingAt(db: AppDatabase, bedId: number) {
  return latestReading(db, bedId)?.recordedAt ?? null;
}
