/**
 * CLI entry point for `npm run db:migrate`.
 */
import { loadConfig, resolveDatabaseFile } from '../config';
import { openDatabase } from './index';
import { runMigrations } from './migrate';

const config = loadConfig();
const dbFile = resolveDatabaseFile(config);

console.log(`[migrate] Opening database: ${dbFile}`);
const db = openDatabase(dbFile);

console.log('[migrate] Running migrations...');
runMigrations(db, config.migrationsDir);

console.log('[migrate] Done.');
db.close();