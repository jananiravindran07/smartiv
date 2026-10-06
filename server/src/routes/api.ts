import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../db/index.js';
import { activityLog, alertRules, alerts, bedAssignments, beds, deviceBeds, devices, users, acknowledgements } from '../db/schema.js';
import { SEVERITY_RANK } from '../domain/calculations.js';
import { currentUser, requireAdmin, requireAuth } from '../auth/middleware.js';
import {
  bedAssignmentCounts,
  canAccessBed,
  getBedSnapshot,
  listVisibleBeds,
  openAlert,
  readRules,
  recentReadings,
  visibleBedIds,
  writeActivity,
} from '../services/beds.js';
import type { LiveEvents } from '../services/events.js';
import { ingestReading, ReadingError, resolveDeviceForChannel } from '../services/readings.js';
import { SPEEDS, type Speed, type Simulator } from '../services/simulator.js';
import { verifyDeviceKey } from '../security/device-keys.js';

/** One load cell's payload, exactly as the ESP32 sketch sends it. */
const readingShape = {
  channel: z.number().int().min(1).max(8).optional(),
  bed: z.number().int().positive(),
  bag_ml: z.number().finite().positive().max(5000),
  volume_ml: z.number().finite().nonnegative().max(5000),
  flow_ml_h: z.number().finite().nonnegative().max(20_000),
};

const readingSchema = z.object(readingShape).strict();

/**
 * Both load cells in one request, which is how a unit reports its two bags.
 * `bed` may be omitted, in which case the server resolves it from `channel`.
 */
const batchSchema = z
  .object({
    bags: z.array(z.object({ ...readingShape, bed: readingShape.bed.optional() }).strict()).min(1).max(8),
  })
  .strict();

const ruleSchema = z
  .object({
    criticalMinutes: z.number().int().min(1).max(240),
    criticalPercent: z.number().int().min(1).max(100),
    attentionMinutes: z.number().int().min(1).max(240),
    attentionPercent: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((rules) => rules.attentionMinutes >= rules.criticalMinutes, {
    message: 'Attention time must be at least the critical time.',
    path: ['attentionMinutes'],
  })
  .refine((rules) => rules.attentionPercent >= rules.criticalPercent, {
    message: 'Attention percentage must be at least the critical percentage.',
    path: ['attentionPercent'],
  });

const assignmentSchema = z.object({ nurseId: z.string().min(1).nullable() }).strict();

export interface ApiRouteOptions {
  jwtSecret: string;
  secureCookie: boolean;
  events: LiveEvents;
  simulator: Simulator | null;
  simulate: boolean;
  offlineAfterMs: number;
}

function issueList(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** Constant-time lookup of the device that owns an X-Device-Key. */
async function authenticateDevice(db: AppDatabase, key: string) {
  for (const device of db.select().from(devices).where(eq(devices.active, true)).all()) {
    if (await verifyDeviceKey(key, device.keyHash)) return device;
  }
  return null;
}

export function apiRoutes(db: AppDatabase, options: ApiRouteOptions) {
  const api = Router();
  const auth = requireAuth(db, options.jwtSecret, options.secureCookie);

  api.get('/meta', (_request, response) =>
    response.json({ simulate: options.simulate, speeds: options.simulate ? SPEEDS : [], source: options.simulate ? 'simulated' : 'arduino' }),
  );

  /* ------------------------------------------------------------------ *
   * Device ingestion. Authenticated by X-Device-Key, never by a session.
   * ------------------------------------------------------------------ */
  api.post('/readings', async (request, response) => {
    const key = request.header('X-Device-Key');
    if (!key || key.length > 256) return response.status(401).json({ error: 'A valid X-Device-Key header is required.' });

    const device = await authenticateDevice(db, key);
    if (!device) return response.status(401).json({ error: 'Unknown or disabled device.' });

    const fail = (error: unknown) =>
      response.status(error instanceof ReadingError ? error.status : 400).json({
        error: error instanceof Error ? error.message : 'Reading could not be accepted.',
      });

    // A unit with two load cells posts both bags in one `bags` array.
    const batch = batchSchema.safeParse(request.body);
    if (batch.success) {
      const results: Array<{ bed: number; channel: number | null; severity: string | null }> = [];
      for (const entry of batch.data.bags) {
        try {
          const bed = entry.bed ?? (entry.channel ? resolveDeviceForChannel(db, device.id, entry.channel).bed : undefined);
          if (bed === undefined) throw new ReadingError('Each bag needs a bed number or a channel.', 400);
          const snapshot = ingestReading(db, options.events, device.id, { ...entry, bed });
          results.push({ bed, channel: snapshot?.channel ?? entry.channel ?? null, severity: snapshot?.severity ?? null });
        } catch (error) {
          return fail(error);
        }
      }
      return response.status(202).json({ accepted: true, results });
    }

    // The single-bag body, for a unit with one bag or a one-off manual test.
    const parsed = readingSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Invalid reading payload.',
        issues: [...issueList(batch.error), ...issueList(parsed.error)],
      });
    }
    try {
      const snapshot = ingestReading(db, options.events, device.id, parsed.data);
      return response.status(202).json({
        accepted: true,
        bed: snapshot?.bedNumber ?? parsed.data.bed,
        severity: snapshot?.severity ?? null,
      });
    } catch (error) {
      return fail(error);
    }
  });

  /* ------------------------------------------------------------------ *
   * Dashboard
   * ------------------------------------------------------------------ */
  api.get('/beds', auth, (_request, response) => {
    response.json({ beds: listVisibleBeds(db, currentUser(response), Date.now()) });
  });

  api.get('/beds/:bedId/history', auth, (request, response) => {
    const bedId = Number(request.params.bedId);
    const user = currentUser(response);
    // 404 rather than 403 so a nurse cannot probe for the existence of
    // another nurse's beds.
    if (!canAccessBed(db, user, bedId)) return response.status(404).json({ error: 'Bed not found.' });
    const requested = Number(request.query.limit ?? 120);
    const limit = Number.isInteger(requested) ? Math.max(1, Math.min(500, requested)) : 120;
    return response.json({ history: recentReadings(db, bedId, limit) });
  });

  api.post('/beds/:bedId/acknowledge', auth, (request, response) => {
    const bedId = Number(request.params.bedId);
    const user = currentUser(response);
    if (!canAccessBed(db, user, bedId)) return response.status(404).json({ error: 'Bed not found.' });

    const snapshot = getBedSnapshot(db, bedId);
    if (!snapshot) return response.status(404).json({ error: 'Bed not found.' });
    if (snapshot.severity === 'normal') return response.status(409).json({ error: 'There is no active alert to acknowledge.' });

    const at = Date.now();
    let open = db.select().from(alerts).where(eq(alerts.bedId, bedId)).orderBy(desc(alerts.createdAt), desc(alerts.id)).limit(1).all()[0];
    if (!open || open.severity !== snapshot.severity) {
      openAlert(db, bedId, snapshot.severity);
      open = db.select().from(alerts).where(eq(alerts.bedId, bedId)).orderBy(desc(alerts.createdAt), desc(alerts.id)).limit(1).all()[0];
    }
    if (!open) return response.status(500).json({ error: 'Could not record the acknowledgement.' });

    db.update(alerts).set({ acknowledgedAt: at, acknowledgedBy: user.id }).where(eq(alerts.id, open.id)).run();
    db.insert(acknowledgements).values({ bedId, alertId: open.id, userId: user.id, action: 'alert_acknowledged', createdAt: at }).run();
    writeActivity(db, user.id, 'alert_acknowledged', `Acknowledged ${snapshot.severity} alert`, bedId);

    const updated = getBedSnapshot(db, bedId, at);
    if (updated) options.events.publishBedUpdate(bedId, updated);
    return response.json({ acknowledged: true, bed: updated });
  });

  api.post('/beds/:bedId/bag-replaced', auth, (request, response) => {
    const bedId = Number(request.params.bedId);
    const user = currentUser(response);
    if (!canAccessBed(db, user, bedId)) return response.status(404).json({ error: 'Bed not found.' });
    const at = Date.now();
    db.insert(acknowledgements).values({ bedId, alertId: null, userId: user.id, action: 'bag_replaced', createdAt: at }).run();
    writeActivity(db, user.id, 'bag_replaced', 'Marked bag as replaced', bedId);

    if (options.simulator) {
      options.simulator.replaceBag(bedId);
      const simulated = getBedSnapshot(db, bedId, at);
      if (simulated) options.events.publishBedUpdate(bedId, simulated);
      return response.status(202).json({ recorded: true, note: 'The simulator refilled the bag.', bed: simulated });
    }
    // With real hardware the new level arrives from the load cell, so the
    // dashboard waits for the next reading rather than guessing the volume.
    const current = getBedSnapshot(db, bedId, at);
    if (current) options.events.publishBedUpdate(bedId, current);
    return response.status(202).json({ recorded: true, note: 'Waiting for the next device reading to confirm the new bag.', bed: current });
  });

  api.post('/beds/:bedId/flow-restored', auth, (request, response) => {
    const bedId = Number(request.params.bedId);
    const user = currentUser(response);
    if (!canAccessBed(db, user, bedId)) return response.status(404).json({ error: 'Bed not found.' });
    const at = Date.now();
    db.insert(acknowledgements).values({ bedId, alertId: null, userId: user.id, action: 'flow_restored', createdAt: at }).run();
    writeActivity(db, user.id, 'flow_restored', 'Marked flow as restored', bedId);

    if (options.simulator) options.simulator.restoreFlow(bedId);
    const current = getBedSnapshot(db, bedId, at);
    if (current) options.events.publishBedUpdate(bedId, current);
    return response.status(202).json({ recorded: true, note: options.simulator ? 'The simulator will report flow on its next reading.' : 'Waiting for the next device reading to confirm flow.', bed: current });
  });

  /** Live bed updates. Each client only receives beds it is allowed to see. */
  api.get('/events', auth, (request, response) => {
    const user = currentUser(response);
    const bedIds = visibleBedIds(db, user);

    response.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write(`retry: 3000\n\n`);
    response.write(`event: snapshot\ndata: ${JSON.stringify({ beds: listVisibleBeds(db, user) })}\n\n`);
    options.events.add(response, user, bedIds);

    // Keeps proxies from closing an idle stream during a long quiet stretch.
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
    request.on('close', () => clearInterval(heartbeat));
  });

  /* ------------------------------------------------------------------ *
   * Admin only. Every route below is behind requireAuth + requireAdmin, so a
   * nurse receives 403 even when calling the API directly.
   * ------------------------------------------------------------------ */
  const admin = Router();
  admin.use(auth, requireAdmin);

  admin.get('/staff', (_request, response) => {
    const counts = bedAssignmentCounts(db);
    const staff = db
      .select({ id: users.id, staffId: users.staffId, name: users.name, role: users.role, active: users.active })
      .from(users)
      .orderBy(users.role, users.name)
      .all()
      .map((member) => ({ ...member, bedIds: counts.get(member.id) ?? [] }));
    return response.json({ staff });
  });

  admin.patch('/assignments/:bedId', async (request, response) => {
    const bedId = Number(request.params.bedId);
    const parsed = assignmentSchema.safeParse(request.body);
    if (!canAccessBed(db, currentUser(response), bedId)) return response.status(404).json({ error: 'Bed not found.' });
    if (!parsed.success) return response.status(400).json({ error: 'Choose a nurse, or send null to unassign the bed.' });

    if (parsed.data.nurseId) {
      const nurse = db.select().from(users).where(eq(users.id, parsed.data.nurseId)).limit(1).all()[0];
      if (!nurse?.active || nurse.role !== 'nurse') return response.status(400).json({ error: 'Choose an active nurse.' });
    }

    const actor = currentUser(response);
    const assignedAt = Date.now();
    db.transaction((tx) => {
      tx.delete(bedAssignments).where(eq(bedAssignments.bedId, bedId)).run();
      if (parsed.data.nurseId) {
        tx.insert(bedAssignments).values({ bedId, nurseId: parsed.data.nurseId, assignedAt, assignedBy: actor.id }).run();
      }
    });
    writeActivity(
      db,
      actor.id,
      'bed_assigned',
      parsed.data.nurseId ? `Assigned Bed ${bedId}` : `Unassigned Bed ${bedId}`,
      bedId,
    );

    // Push the new bed set to every browser that nurse has open.
    for (const nurse of db.select().from(users).where(eq(users.role, 'nurse')).all()) {
      options.events.refreshAssignments(nurse.id, visibleBedIds(db, nurse));
      const snapshot = getBedSnapshot(db, bedId);
      if (snapshot) options.events.publishSnapshot(listVisibleBeds(db, nurse));
    }
    const updated = getBedSnapshot(db, bedId);
    return response.json({ bed: updated });
  });

  admin.get('/rules', (_request, response) => response.json({ rules: readRules(db) }));

  admin.patch('/rules', async (request, response) => {
    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid alert rules.', issues: issueList(parsed.error) });

    const actor = currentUser(response);
    const before = new Map(listVisibleBeds(db, actor).map((bed) => [bed.bedNumber, bed.severity]));
    db.update(alertRules)
      .set({ ...parsed.data, updatedBy: actor.id, updatedAt: Date.now() })
      .where(eq(alertRules.id, 1))
      .run();

    // Re-evaluate every bed so a rule change re-bands the dashboard immediately.
    for (const bedId of visibleBedIds(db, actor)) {
      const updated = getBedSnapshot(db, bedId);
      if (!updated) continue;
      const previous = before.get(bedId) ?? 'normal';
      if (SEVERITY_RANK[updated.severity] > SEVERITY_RANK[previous] && updated.severity !== 'normal') {
        openAlert(db, bedId, updated.severity);
      }
      options.events.publishBedUpdate(bedId, updated);
      if (updated.severity === 'critical' && SEVERITY_RANK[updated.severity] > SEVERITY_RANK[previous]) {
        options.events.publishCritical(bedId, updated);
      }
    }

    writeActivity(
      db,
      actor.id,
      'rules_changed',
      `Critical at ${parsed.data.criticalMinutes} min or ${parsed.data.criticalPercent}%, attention at ${parsed.data.attentionMinutes} min or ${parsed.data.attentionPercent}%`,
    );
    return response.json({ rules: readRules(db) });
  });

  admin.get('/devices', (_request, response) => {
    const links = db.select().from(deviceBeds).all();
    const rows = db
      .select({
        id: devices.id,
        unit: devices.unit,
        active: devices.active,
        lastReadingAt: devices.lastReadingAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .orderBy(devices.unit)
      .all()
      .map((device) => {
        const channels = links
          .filter((link) => link.deviceId === device.id)
          .map((link) => {
            const bed = db.select().from(beds).where(eq(beds.id, link.bedId)).limit(1).all()[0];
            return { channel: link.channel, bedId: link.bedId, fluidName: bed?.fluidName ?? null, bagMl: bed?.bagMl ?? null };
          })
          .sort((a, b) => a.channel - b.channel);
        return { ...device, channels };
      });
    return response.json({ devices: rows, source: options.simulate ? 'simulated' : 'arduino', offlineAfterMs: options.offlineAfterMs });
  });

  admin.get('/activity', (_request, response) => {
    const entries = db
      .select({
        id: activityLog.id,
        actor: users.name,
        staffId: users.staffId,
        action: activityLog.action,
        bedId: activityLog.bedId,
        details: activityLog.details,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .innerJoin(users, eq(activityLog.actorId, users.id))
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(500)
      .all();
    return response.json({ activity: entries });
  });

  admin.patch('/simulator/speed', (request, response) => {
    if (!options.simulator) return response.status(400).json({ error: 'The simulator is disabled. Set SIMULATE=true to enable it.' });
    const parsed = z.object({ speed: z.union([z.literal(1), z.literal(10), z.literal(60)]) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Speed must be 1, 10 or 60.' });
    options.simulator.setSpeed(parsed.data.speed as Speed);
    return response.json({ speed: parsed.data.speed });
  });

  api.use('/admin', admin);
  return api;
}
