/**
 * CLI entry point for `npm run db:reset`.
 * Deletes the database file (if not :memory:) and re-runs migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveDatabaseFile } from '../config';
import { openDatabase } from './index';
import { runMigrations } from './migrate';

const config = loadConfig();
const dbFile = resolveDatabaseFile(config);

if (dbFile !== ':memory:') {
  if (fs.existsSync(dbFile)) {
    console.log(`[reset] Removing existing database: ${dbFile}`);
    fs.unlinkSync(dbFile);
  }
  // Also remove WAL/SHM files if they exist
  for (const suffix of ['-wal', '-shm']) {
    const extra = `${dbFile}${suffix}`;
    if (fs.existsSync(extra)) fs.unlinkSync(extra);
  }
}

console.log(`[reset] Opening database: ${dbFile}`);
const db = openDatabase(dbFile);

console.log('[reset] Running migrations...');
runMigrations(db, config.migrationsDir);

console.log('[reset] Done.');
db.close();