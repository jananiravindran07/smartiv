import 'dotenv/config';
import { readConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createApp } from './app.js';
import { LiveEvents } from './services/events.js';
import { Simulator } from './services/simulator.js';
import { OfflineMonitor } from './services/offline-monitor.js';

const config = readConfig();
const { sqlite, db } = openDatabase(config.databasePath);
const events = new LiveEvents();
// SIMULATE=true stands in for the hardware so the app runs with no units attached.
const simulator = config.simulate ? new Simulator(db, events) : null;
const offlineMonitor = new OfflineMonitor(db, events, config.offlineAfterMs);
const app = createApp({ db, config, events, simulator });

const server = app.listen(config.port, () => {
  console.info(`SmartIV server on http://localhost:${config.port}`);
  console.info(`  data source : ${config.simulate ? 'simulator (SIMULATE=true)' : 'Arduino / ESP32 units'}`);
  console.info(`  database    : ${config.databasePath}`);
  console.info(`  offline after: ${config.offlineAfterMs / 1000}s without a reading`);
  if (!config.webDist) console.info('  front end   : run `npm run dev` in ../web (Vite on :5173)');
});

simulator?.start();
offlineMonitor.start();

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.info(`\n${signal} received, shutting down.`);
  simulator?.stop();
  offlineMonitor.stop();
  events.closeAll();
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
  // Do not hang forever if a stream refuses to drain.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
