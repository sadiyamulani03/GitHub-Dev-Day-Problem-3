/**
 * SQLite connection handling.
 *
 * Driver: `node:sqlite` (Node's built-in SQLite). Deliberate decision:
 *   * no native/C++ dependency, so `npm install` works without a compiler,
 *     Python or build tools - the whole dependency tree is pure JavaScript;
 *   * it exposes real prepared statements, so every value is bound with a `?`
 *     placeholder and never spliced into the SQL text (TEST 6);
 *   * it raises SQLite's own constraint errors, which is how duplicate
 *     watches are rejected by the DATABASE (TEST 3).
 *
 * Requires Node >= 24 (where node:sqlite is available without a flag).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Db = DatabaseSync;

/** Any value that may be bound to a `?` placeholder. */
export type SqlValue = SQLInputValue;

export interface OpenDatabaseOptions {
  /** Read-only connection (unused today, kept for completeness). */
  readonly?: boolean;
}

export function assertSqliteAvailable(): void {
  if (typeof DatabaseSync !== 'function') {
    throw new Error(
      'This project uses Node\'s built-in SQLite driver (node:sqlite), which needs Node 24 or newer. ' +
        `Current version: ${process.version}.`,
    );
  }
}

export function openDatabase(file: string, options: OpenDatabaseOptions = {}): Db {
  assertSqliteAvailable();

  const isMemory = file === ':memory:';
  if (!isMemory) {
    const absolute = path.resolve(file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }

  const db = new DatabaseSync(file, { readOnly: options.readonly === true });

  // Referential integrity: engineers -> watches / notifications cascades are enforced.
  db.exec('PRAGMA foreign_keys = ON');
  // Wait (instead of failing immediately) if another connection holds a write lock.
  db.exec('PRAGMA busy_timeout = 5000');
  if (!isMemory) {
    // WAL gives safe concurrent readers/writers for a small app.
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

/**
 * Run `work` inside a single SQLite transaction. `node:sqlite` has no
 * transaction helper, so BEGIN/COMMIT/ROLLBACK are issued explicitly - that is
 * what makes the migration runner atomic.
 */
export function withTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The original error is the interesting one.
    }
    throw error;
  }
}

/** SQLite exposes `changes` as number|bigint depending on the driver mode. */
export function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

/* -----------------------------------------------------------------------------
 * The ONLY three ways this application talks to the database.
 *
 * =============================================================================
 * TEST 6 - PARAMETERIZED DATABASE QUERIES
 * =============================================================================
 * Every SQL string in server/src/db/*Repository.ts is a static literal that
 * contains `?` placeholders, and every value is passed as an argument to one of
 * the helpers below. The driver binds those values itself, so a value can never
 * alter the structure of the statement:
 *
 *   queryOne<WatchRow>(db, 'SELECT * FROM watches WHERE id = ?', watchId)   <-- safe
 *   db.prepare(`SELECT * FROM watches WHERE id = '${watchId}'`)            <-- never
 *
 * `tests/integration/security.test.ts` additionally scans the source tree and
 * fails if any SQL keyword is ever concatenated or interpolated.
 * -------------------------------------------------------------------------- */

export function queryAll<Row extends object>(db: Db, sql: string, ...params: SqlValue[]): Row[] {
  return db.prepare(sql).all(...params) as unknown as Row[];
}

export function queryOne<Row extends object>(
  db: Db,
  sql: string,
  ...params: SqlValue[]
): Row | null {
  const row = db.prepare(sql).get(...params) as unknown as Row | undefined;
  return row ?? null;
}

export interface StatementOutcome {
  changes: number;
  lastInsertRowid: number;
}

export function execute(db: Db, sql: string, ...params: SqlValue[]): StatementOutcome {
  const result = db.prepare(sql).run(...params);
  return {
    changes: toNumber(result.changes),
    lastInsertRowid: toNumber(result.lastInsertRowid),
  };
}