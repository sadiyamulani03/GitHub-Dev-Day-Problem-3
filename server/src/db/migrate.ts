/**
 * Migration runner.
 *
 * Reads the migration file and executes it. SQLite's exec() supports multiple
 * statements separated by semicolons. We strip comments first to avoid issues.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, withTransaction } from './index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'server', 'src', 'migrations');

export function runMigrations(db: Db, migrationsDir: string | null): void {
  const dir = migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const file = path.join(dir, '001_init.sql');

  if (!fs.existsSync(file)) {
    throw new Error(`Migration file not found: ${file}`);
  }

  let sql = fs.readFileSync(file, 'utf8');

  // Strip SQL comments (lines starting with --) to avoid issues with semicolons in comments
  sql = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  // SQLite's exec() can handle multiple statements separated by semicolons
  withTransaction(db, () => {
    db.exec(sql);
  });
}