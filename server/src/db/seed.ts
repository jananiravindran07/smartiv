import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { openDatabase } from './index.js';
import { alertRules, bedAssignments, alerts, acknowledgements, activityLog, beds, deviceBeds, devices, readings, users } from './schema.js';
import { hashDeviceKey, newDeviceKey } from '../security/device-keys.js';

/** `npm run db:seed -- --reset` clears live telemetry first, so a demo ward
 *  starts from the seeded volumes instead of what the simulator left behind. */
const reset = process.argv.includes('--reset');

/**
 * SEED_DEMO_PASSWORD lets a ward set one shared demo password. When it is not
 * set the script generates a strong one and prints it once, so no password is
 * ever committed to the repository.
 */
const provided = process.env.SEED_DEMO_PASSWORD;
if (provided !== undefined && provided.length < 12) {
  throw new Error('SEED_DEMO_PASSWORD must be at least 12 characters.');
}
const demoPassword = provided ?? randomBytes(9).toString('base64url');
const generatedPassword = provided === undefined;

const { sqlite, db } = openDatabase();
try {
  const now = Date.now();

  if (reset) {
    // Order matters: children before parents.
    db.delete(activityLog).run();
    db.delete(acknowledgements).run();
    db.delete(alerts).run();
    db.delete(readings).run();
  }

  const userSeeds = [
    { id: 'nurse-anitha', staffId: 'N-2041', name: 'Anitha S.', role: 'nurse' as const, beds: [1, 2] },
    { id: 'nurse-karthik', staffId: 'N-2042', name: 'Karthik M.', role: 'nurse' as const, beds: [3, 4, 5, 6] },
    { id: 'nurse-divya', staffId: 'N-2043', name: 'Divya R.', role: 'nurse' as const, beds: [7, 8, 9, 10] },
    { id: 'admin-ward', staffId: 'A-1001', name: 'Ward Admin', role: 'admin' as const, beds: [] as number[] },
  ];

  const passwordHash = await hash(demoPassword, 12);
  for (const { beds: _beds, ...user } of userSeeds) {
    db.insert(users)
      .values({ ...user, passwordHash, active: true, createdAt: now })
      .onConflictDoUpdate({
        target: users.staffId,
        set: { name: user.name, role: user.role, passwordHash, active: true },
      })
      .run();
  }

  // The prototype's 12-bed ward. Beds 1 and 2 hang on the single real unit;
  // beds 3-12 exist so an admin can review other beds with demo values.
  // Bags are 100 mL, which is what the hardware actually carries, so the
  // seeded flow rates and volumes are realistic for a real infusion.
  const bedSeeds = [
    [1, 'R.K.', 54, '0.9% Normal Saline', 100, 28, 120],
    [2, 'S.M.', 37, "Ringer's Lactate", 100, 76, 100],
    [3, 'P.V.', 62, 'Dextrose Normal Saline', 100, 80, 125],
    [4, 'A.L.', 29, '0.9% Normal Saline', 100, 64, 125],
    [5, 'T.N.', 71, "Ringer's Lactate", 100, 12, 100],
    [6, 'M.D.', 45, '5% Dextrose', 100, 88, 80],
    [7, 'K.S.', 58, 'Ceftriaxone in NS', 100, 22, 100],
    [8, 'V.P.', 66, '0.9% Normal Saline', 100, 82, 125],
    [9, 'J.R.', 33, 'Dextrose Normal Saline', 100, 60, 60],
    [10, 'H.A.', 49, "Ringer's Lactate", 100, 96, 150],
    [11, 'D.B.', 52, '0.9% Normal Saline', 100, 60, 100],
    [12, 'G.T.', 40, '0.9% Normal Saline', 100, 100, 100],
  ] as const;

  for (const [id, patientInitials, patientAge, fluidName, bagMl] of bedSeeds) {
    db.insert(beds)
      .values({ id, patientInitials, patientAge, fluidName, bagMl, active: true })
      .onConflictDoUpdate({ target: beds.id, set: { patientInitials, patientAge, fluidName, bagMl, active: true } })
      .run();
  }

  db.delete(bedAssignments).run();
  const adminId = 'admin-ward';
  for (const nurse of userSeeds.filter((user) => user.role === 'nurse')) {
    for (const bedId of nurse.beds) {
      db.insert(bedAssignments).values({ bedId, nurseId: nurse.id, assignedAt: now, assignedBy: adminId }).run();
    }
  }

  /* ---------------------------------------------------------------- *
   * One ESP32 unit carries two load cells, so it covers two beds:
   * channel 1 -> bed 1, channel 2 -> bed 2. Registering more units
   * follows the same shape via `npm run device:register`.
   * ---------------------------------------------------------------- */
  const provisioned: string[] = [];
  const unitId = 'unit-01';
  const [existingUnit] = db.select().from(devices).where(eq(devices.unit, 'IVU-01')).limit(1).all();
  const deviceId = existingUnit?.id ?? unitId;

  if (!existingUnit) {
    const apiKey = newDeviceKey();
    db.insert(devices)
      .values({ id: deviceId, unit: 'IVU-01', keyHash: await hashDeviceKey(apiKey), active: true, lastReadingAt: now, createdAt: now })
      .run();
    provisioned.push(`IVU-01  beds=1,2  key=${apiKey}`);
  } else {
    db.update(devices).set({ active: true, lastReadingAt: now }).where(eq(devices.id, deviceId)).run();
  }

  db.delete(deviceBeds).where(eq(deviceBeds.deviceId, deviceId)).run();
  db.insert(deviceBeds).values({ deviceId, bedId: 1, channel: 1 }).run();
  db.insert(deviceBeds).values({ deviceId, bedId: 2, channel: 2 }).run();

  // Give every bed an opening reading so the dashboard is populated before the
  // first hardware frame arrives. Bed 12 mirrors the prototype's stopped drip.
  for (const [index, [bedId, , , , bagMl, volumeMl, nominalFlow]] of bedSeeds.entries()) {
    if (db.select().from(readings).where(eq(readings.bedId, bedId)).limit(1).all().length > 0) continue;
    const stopped = bedId === 12;
    db.insert(readings)
      .values({
        bedId,
        channel: bedId <= 2 ? bedId : 1,
        bagMl,
        volumeMl,
        flowMlH: stopped ? 0 : nominalFlow,
        smoothedFlowMlH: stopped ? 0 : nominalFlow,
        recordedAt: now - (bedSeeds.length - index) * 1000,
      })
      .run();
  }

  db.insert(alertRules)
    .values({ id: 1, criticalMinutes: 15, criticalPercent: 10, attentionMinutes: 45, attentionPercent: 25, updatedBy: adminId, updatedAt: now })
    .onConflictDoNothing()
    .run();

  console.info('Seeded 4 users, 12 beds, 1 unit (2 bags), assignments and alert rules.');
  console.info('');
  console.info('  Staff ID  Name          Role    Beds');
  for (const nurse of userSeeds) {
    const scope = nurse.role === 'admin' ? 'all 12' : nurse.beds.join(', ') || 'none';
    console.info(`  ${nurse.staffId.padEnd(9)} ${nurse.name.padEnd(12)} ${nurse.role.padEnd(6)} ${scope}`);
  }
  console.info('');
  if (generatedPassword) {
    console.info(`  Demo password (generated, shown once): ${demoPassword}`);
  } else {
    console.info(`  Demo password: taken from SEED_DEMO_PASSWORD`);
  }
  if (provisioned.length) {
    console.info('');
    console.info('  Device keys, shown once and never stored in plain text:');
    for (const entry of provisioned) console.info(`    ${entry}`);
  }
} finally {
  sqlite.close();
}
