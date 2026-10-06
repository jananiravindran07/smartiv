import 'dotenv/config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from './index.js';

const { sqlite, db } = openDatabase();
try {
  migrate(db, { migrationsFolder: './drizzle' });
  console.info('SmartIV database migrations are up to date.');
} finally {
  sqlite.close();
}
