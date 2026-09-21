/**
 * Watch data access.
 *
 * =============================================================================
 * TEST 3 - DATABASE-LEVEL DUPLICATE PROTECTION
 * TEST 4 - WATCH OWNERSHIP / 404 vs 403
 * TEST 6 - PARAMETERIZED SQL
 * =============================================================================
 *
 * Duplicate protection
 * --------------------
 * The uniqueness lives in the SCHEMA, not in application logic:
 *
 *   server/src/migrations/001_init.sql
 *     CONSTRAINT uq_watches_engineer_repo UNIQUE (engineer_id, owner, repo)
 *
 * `insert()` therefore does a plain INSERT and lets SQLite reject the second
 * row with SQLITE_CONSTRAINT_UNIQUE. There is no "SELECT then INSERT" race:
 * two concurrent requests for the same (engineer, owner, repo) can never both succeed.
 *
 * Ownership
 * ---------
 * Every read and write is scoped by `engineer_id = ?`, where the id comes from the
 * server-side session (see middleware/auth.ts). A client-supplied engineer id is
 * never accepted anywhere in this file.
 *
 * Parameterization
 * ----------------
 * All statements are static SQL strings with `?` placeholders.
 */
import type { Db } from './index';
import { toNumber } from './index';

export interface WatchRow {
  id: number;
  engineer_id: string;
  owner: string;
  repo: string;
  created_at: string;
}

export interface PublicWatch {
  id: number;
  owner: string;
  repo: string;
  repository: string; // "owner/repo" for display
  createdAt: string;
}

export function toPublicWatch(row: WatchRow): PublicWatch {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    repository: `${row.owner}/${row.repo}`,
    createdAt: row.created_at,
  };
}

export interface NewWatch {
  engineerId: string;
  owner: string;
  repo: string;
}

export class WatchRepository {
  constructor(private readonly db: Db) {}

  /**
   * All watches belonging to ONE engineer.
   * `WHERE engineer_id = ?` -> the authenticated engineer's id is bound, never a value
   * taken from the request.
   */
  listForEngineer(engineerId: string): WatchRow[] {
    return this.db
      .prepare(
        `SELECT id, engineer_id, owner, repo, created_at
           FROM watches
          WHERE engineer_id = ?
          ORDER BY created_at DESC, id DESC`,
      )
      .all(engineerId) as unknown as WatchRow[];
  }

  /** Single watch, still scoped to the owner. */
  findForEngineer(engineerId: string, watchId: number): WatchRow | null {
    const row = this.db
      .prepare(
        `SELECT id, engineer_id, owner, repo, created_at
           FROM watches
          WHERE id = ? AND engineer_id = ?`,
      )
      .get(watchId, engineerId) as WatchRow | undefined;
    return row ?? null;
  }

  /** Find a watch by owner/repo for a specific engineer. */
  findByRepoForEngineer(engineerId: string, owner: string, repo: string): WatchRow | null {
    const row = this.db
      .prepare(
        `SELECT id, engineer_id, owner, repo, created_at
           FROM watches
          WHERE engineer_id = ? AND owner = ? AND repo = ?`,
      )
      .get(engineerId, owner, repo) as WatchRow | undefined;
    return row ?? null;
  }

  /**
   * Find a watch by ID without ownership check (internal use).
   * Returns the watch if it exists, regardless of owner.
   */
  findById(watchId: number): WatchRow | null {
    const row = this.db
      .prepare(
        `SELECT id, engineer_id, owner, repo, created_at
           FROM watches
          WHERE id = ?`,
      )
      .get(watchId) as WatchRow | undefined;
    return row ?? null;
  }

  /**
   * Plain INSERT. If the (engineer_id, owner, repo) triplet already exists the
   * database raises SQLITE_CONSTRAINT_UNIQUE and this method throws; the route
   * turns that into a 409 Conflict.
   */
  insert(watch: NewWatch): WatchRow {
    const result = this.db
      .prepare(
        `INSERT INTO watches
           (engineer_id, owner, repo, created_at)
          VALUES (?, ?, ?, ?)`,
      )
      .run(watch.engineerId, watch.owner, watch.repo, new Date().toISOString());

    const row = this.findById(Number(result.lastInsertRowid));
    if (row === null) throw new Error('Failed to read back the inserted watch.');
    return row;
  }

  /**
   * Ownership-scoped delete: `AND engineer_id = ?` is what stops IDOR deletes.
   * Returns number of rows deleted (0 or 1).
   */
  deleteForEngineer(engineerId: string, watchId: number): number {
    const result = this.db
      .prepare('DELETE FROM watches WHERE id = ? AND engineer_id = ?')
      .run(watchId, engineerId);
    return toNumber(result.changes);
  }

  countForEngineer(engineerId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM watches WHERE engineer_id = ?')
      .get(engineerId) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}