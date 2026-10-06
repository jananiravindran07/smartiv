import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { beds } from '../db/schema.js';
import { getBedSnapshot } from './beds.js';
import type { LiveEvents } from './events.js';

/**
 * A unit that stops reporting must surface as an "Offline" state on its card
 * instead of silently freezing at its last reading, so the dashboard keeps
 * showing stale volume.
 */
export class OfflineMonitor {
  private timer: NodeJS.Timeout | undefined;
  private readonly offlineSince = new Map<number, boolean>();

  constructor(
    private readonly db: AppDatabase,
    private readonly events: LiveEvents,
    private readonly offlineAfterMs = 10_000,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.min(1000, this.offlineAfterMs));
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick() {
    const now = Date.now();
    for (const bed of this.db.select({ id: beds.id }).from(beds).where(eq(beds.active, true)).all()) {
      const snapshot = getBedSnapshot(this.db, bed.id, now);
      if (!snapshot) continue;
      const previous = this.offlineSince.get(bed.id);
      this.offlineSince.set(bed.id, snapshot.offline);
      if (previous !== undefined && previous !== snapshot.offline) {
        this.events.publishBedUpdate(bed.id, snapshot);
      }
    }
  }
}
