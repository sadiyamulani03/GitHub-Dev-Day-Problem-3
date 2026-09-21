/**
 * Notification data access.
 *
 * =============================================================================
 * TEST 4 - IDEMPOTENT RELEASE NOTIFICATIONS
 * TEST 6 - PARAMETERIZED SQL
 * =============================================================================
 *
 * Idempotency
 * -----------
 * The uniqueness lives in the SCHEMA, not in application logic:
 *
 *   server/src/migrations/001_init.sql
 *     CONSTRAINT uq_notifications_engineer_release UNIQUE (engineer_id, release_id)
 *
 * `insertIfNew()` uses INSERT OR IGNORE so that:
 *   - If the (engineer_id, release_id) pair doesn't exist, it's inserted.
 *   - If it already exists, SQLite silently ignores the insert (no error).
 *
 * This makes the release-check job safely idempotent: running it multiple times
 * for the same releases will never create duplicate notifications.
 * There is no "SELECT then INSERT" race: the database handles it atomically.
 *
 * Ownership
 * ---------
 * Every read is scoped by `engineer_id = ?`, where the id comes from the
 * server-side session.
 *
 * Parameterization
 * ----------------
 * All statements are static SQL strings with `?` placeholders.
 */
import type { Db } from './index';
import { toNumber } from './index';

export interface NotificationRow {
  id: number;
  engineer_id: string;
  release_id: number;
  release_tag: string;
  release_name: string | null;
  release_url: string;
  repository: string;
  created_at: string;
}

export interface PublicNotification {
  id: number;
  releaseId: number;
  releaseTag: string;
  releaseName: string | null;
  releaseUrl: string;
  repository: string;
  createdAt: string;
}

export function toPublicNotification(row: NotificationRow): PublicNotification {
  return {
    id: row.id,
    releaseId: row.release_id,
    releaseTag: row.release_tag,
    releaseName: row.release_name,
    releaseUrl: row.release_url,
    repository: row.repository,
    createdAt: row.created_at,
  };
}

export interface NewNotification {
  engineerId: string;
  releaseId: number;
  releaseTag: string;
  releaseName: string | null;
  releaseUrl: string;
  repository: string;
}

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  /**
   * All notifications belonging to ONE engineer.
   */
  listForEngineer(engineerId: string): NotificationRow[] {
    return this.db
      .prepare(
        `SELECT id, engineer_id, release_id, release_tag, release_name, release_url, repository, created_at
           FROM notifications
          WHERE engineer_id = ?
          ORDER BY created_at DESC, id DESC`,
      )
      .all(engineerId) as unknown as NotificationRow[];
  }

  /**
   * Insert a notification if it doesn't already exist for this engineer + release.
   * Uses INSERT OR IGNORE to be idempotent and race-free.
   * Returns the notification row if inserted, null if it already existed.
   */
  insertIfNew(notification: NewNotification): NotificationRow | null {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (engineer_id, release_id, release_tag, release_name, release_url, repository, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        notification.engineerId,
        notification.releaseId,
        notification.releaseTag,
        notification.releaseName,
        notification.releaseUrl,
        notification.repository,
        new Date().toISOString(),
      );

    if (toNumber(result.changes) === 0) {
      // Already existed - fetch the existing row
      const existing = this.db
        .prepare(
          `SELECT id, engineer_id, release_id, release_tag, release_name, release_url, repository, created_at
             FROM notifications
            WHERE engineer_id = ? AND release_id = ?`,
        )
        .get(notification.engineerId, notification.releaseId) as NotificationRow | undefined;
      return existing ?? null;
    }

    // Successfully inserted - read back
    const row = this.db
      .prepare(
        `SELECT id, engineer_id, release_id, release_tag, release_name, release_url, repository, created_at
           FROM notifications
          WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid)) as NotificationRow | undefined;
    return row ?? null;
  }

  countForEngineer(engineerId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM notifications WHERE engineer_id = ?')
      .get(engineerId) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}