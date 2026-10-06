import { hash } from 'bcryptjs';
import express from 'express';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from '../src/app.js';
import { openDatabase, type AppDatabase } from '../src/db/index.js';
import { alertRules, bedAssignments, beds, deviceBeds, devices, users } from '../src/db/schema.js';
import { LiveEvents } from '../src/services/events.js';
import { Simulator } from '../src/services/simulator.js';
import { newDeviceKey, hashDeviceKey } from '../src/security/device-keys.js';
import type { ServerConfig } from '../src/config.js';

export const TEST_JWT_SECRET = 'test_secret_that_is_long_enough_for_hs256_signing';

export const TEST_PASSWORD = 'ward-test-password';

export interface TestHarness {
  app: express.Express;
  db: AppDatabase;
  events: LiveEvents;
  simulator: Simulator;
  deviceKeys: Record<string, string>;
  close(): void;
}

export const testConfig: ServerConfig = {
  port: 0,
  databasePath: ':memory:',
  jwtSecret: TEST_JWT_SECRET,
  simulate: true,
  secureCookie: false,
  nodeEnv: 'test',
  webDist: null,
  loginWindowMs: 60_000,
  // High enough that the limiter never interferes with unrelated tests.
  loginAttempts: 1000,
  offlineAfterMs: 10_000,
  readingHistoryLimit: 300,
};

/**
 * Builds a throwaway in-memory database with the real migrations applied, so
 * tests exercise the same schema and queries as production.
 */
export async function createHarness(overrides: Partial<ServerConfig> = {}): Promise<TestHarness> {
  const config: ServerConfig = { ...testConfig, ...overrides };
  const { sqlite, db } = openDatabase(':memory:');
  migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  const now = Date.now();
  const passwordHash = await hash(TEST_PASSWORD, 4);

  const staff = [
    { id: 'nurse-a', staffId: 'N-2041', name: 'Anitha S.', role: 'nurse' as const, beds: [1, 2] },
    { id: 'nurse-b', staffId: 'N-2042', name: 'Karthik M.', role: 'nurse' as const, beds: [3] },
    { id: 'admin-a', staffId: 'A-1001', name: 'Ward Admin', role: 'admin' as const, beds: [] as number[] },
  ];
  for (const member of staff) {
    db.insert(users).values({ id: member.id, staffId: member.staffId, name: member.name, role: member.role, passwordHash, active: true, createdAt: now }).run();
  }

  for (const [id, fluidName, bagMl] of [
    [1, '0.9% Normal Saline', 500],
    [2, "Ringer's Lactate", 500],
    [3, '5% Dextrose', 1000],
    [4, '0.9% Normal Saline', 500],
  ] as const) {
    db.insert(beds).values({ id, patientInitials: 'R.K.', patientAge: 54, fluidName, bagMl, active: true }).run();
  }

  // Must follow the bed insert: bed_assignments.bed_id is a foreign key.
  for (const member of staff) {
    for (const bedId of member.beds) {
      db.insert(bedAssignments).values({ bedId, nurseId: member.id, assignedAt: now, assignedBy: 'admin-a' }).run();
    }
  }

  db.insert(alertRules)
    .values({ id: 1, criticalMinutes: 15, criticalPercent: 10, attentionMinutes: 45, attentionPercent: 25, updatedBy: 'admin-a', updatedAt: now })
    .run();

  // One unit with two load cells: channel 1 -> bed 1, channel 2 -> bed 2.
  const deviceKeys: Record<string, string> = {};
  const registerUnit = async (id: string, unit: string, bedIds: number[]) => {
    const key = newDeviceKey();
    deviceKeys[unit] = key;
    db.insert(devices).values({ id, unit, keyHash: await hashDeviceKey(key), active: true, lastReadingAt: null, createdAt: now }).run();
    bedIds.forEach((bedId, index) => {
      db.insert(deviceBeds).values({ deviceId: id, bedId, channel: index + 1 }).run();
    });
    return id;
  };
  await registerUnit('unit-01', 'IVU-01', [1, 2]);

  const events = new LiveEvents();
  const simulator = new Simulator(db, events);
  const app = createApp({ db, config, events, simulator });

  return {
    app,
    db,
    events,
    simulator,
    deviceKeys,
    close() {
      simulator.stop();
      events.closeAll();
      sqlite.close();
    },
  };
}

/** Extracts the session cookie so tests can assert on httpOnly behaviour. */
export function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const entry = raw.find((value) => value.startsWith('smartiv_session='));
  if (!entry) throw new Error('No session cookie was set.');
  return entry;
}

export function cookieHeader(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}
