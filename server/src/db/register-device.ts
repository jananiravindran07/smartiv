import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDatabase } from './index.js';
import { beds, deviceBeds, devices } from './schema.js';
import { hashDeviceKey, newDeviceKey } from '../security/device-keys.js';

/**
 * Registers one unit against the beds its load cells are wired to.
 *
 *   npm run device:register -- --unit=IVU-02 --beds=7,8
 *
 * Bed order is channel order: the first bed is channel 1, the second channel 2.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const unit = arg('unit')?.trim();
const bedsArg = arg('beds')
  ?.split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (!unit || !bedsArg?.length) {
  console.error('Usage: npm run device:register -- --unit=IVU-02 --beds=7,8');
  console.error('  --unit  unique unit label, e.g. IVU-02');
  console.error('  --beds  comma-separated bed numbers in load cell order');
  process.exit(1);
}
if (bedsArg.length > 8) {
  console.error('A unit supports at most 8 channels.');
  process.exit(1);
}

const { sqlite, db } = openDatabase();
try {
  for (const bedId of bedsArg) {
    const [bed] = db.select({ id: beds.id }).from(beds).where(eq(beds.id, bedId)).limit(1).all();
    if (!bed) throw new Error(`Bed ${bedId} does not exist. Add it to the beds table first.`);
    const taken = db.select().from(deviceBeds).where(eq(deviceBeds.bedId, bedId)).limit(1).all()[0];
    if (taken) throw new Error(`Bed ${bedId} is already wired to a unit.`);
  }

  if (db.select().from(devices).where(eq(devices.unit, unit)).limit(1).all().length) {
    throw new Error(`Unit ${unit} is already registered. Choose a different unit label.`);
  }

  const apiKey = newDeviceKey();
  const keyHash = await hashDeviceKey(apiKey);
  const deviceId = randomUUID();
  db.transaction((tx) => {
    tx.insert(devices)
      .values({ id: deviceId, unit, keyHash, active: true, lastReadingAt: null, createdAt: Date.now() })
      .run();
    bedsArg.forEach((bedId, index) => {
      tx.insert(deviceBeds).values({ deviceId, bedId, channel: index + 1 }).run();
    });
  });

  console.info(`Registered ${unit}.`);
  bedsArg.forEach((bedId, index) => console.info(`  channel ${index + 1} -> Bed ${pad(bedId)}`));
  console.info('');
  console.info('Device key, shown once and never stored in plain text:');
  console.info(`  ${apiKey}`);
  console.info('');
  console.info('Put it in the sketch\'s config header, in the sketch\'s own secrets file:');
  console.info('  #define SMARTIV_DEVICE_KEY "' + apiKey + '"');
  console.log('');
} finally {
  sqlite.close();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
