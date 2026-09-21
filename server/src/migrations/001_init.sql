-- =============================================================================
-- Migration 001_init
-- Release Radar - initial schema
--
-- This file is the single source of truth for the database schema and is
-- applied by `npm run db:migrate` (see server/src/db/migrate.ts).
--
-- It is also the place where duplicates are prevented:
--   * watches     -> CONSTRAINT uq_watches_engineer_repo UNIQUE (engineer_id, owner, repo)
--   * notifications -> CONSTRAINT uq_notifications_engineer_release UNIQUE (engineer_id, release_id)
--     The DATABASE (not application code) refuses a second row for the same
--     engineer + GitHub release, so concurrent "check then insert" races cannot
--     create duplicates.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- engineers (application users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engineers (
  id            TEXT    PRIMARY KEY,               -- opaque random id (never a client-supplied value)
  email         TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,                  -- scrypt hash, never the plaintext password
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- login identity must be unique; email is stored lower-cased by the app
  CONSTRAINT uq_engineers_email UNIQUE (email)
);

-- ---------------------------------------------------------------------------
-- sessions
-- The raw session token only ever exists in the engineer's httpOnly cookie.
-- The database stores a SHA-256 hash of it, so a database leak cannot be
-- replayed as a valid session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  engineer_id    TEXT NOT NULL REFERENCES engineers (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_engineer_id ON sessions (engineer_id);

-- ---------------------------------------------------------------------------
-- watches
--
-- Identity strategy (documented decision):
--   A watch is identified by (engineer_id, owner, repo) where owner/repo is
--   the GitHub repository. GitHub treats owner/repo case-insensitively, so
--   the stored values are lower-cased to keep comparisons deterministic.
--   Therefore the natural identity of "this engineer watches this repo" is
--   (engineer_id, owner, repo), and THAT triplet carries the unique constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  engineer_id     TEXT    NOT NULL REFERENCES engineers (id) ON DELETE CASCADE,
  owner           TEXT    NOT NULL,   -- GitHub repository owner (lower-cased)
  repo            TEXT    NOT NULL,   -- GitHub repository name (lower-cased)
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- =========================================================================
  -- TEST 3 - DATABASE-LEVEL DUPLICATE PROTECTION
  -- The same engineer can never watch the same owner/repo twice.
  -- Enforced by the database engine itself (SQLite raises
  -- SQLITE_CONSTRAINT_UNIQUE / "UNIQUE constraint failed"), which is why the
  -- application never relies on a "SELECT ... then INSERT" check.
  -- =========================================================================
  CONSTRAINT uq_watches_engineer_repo UNIQUE (engineer_id, owner, repo)
);

-- Fast lookup path for "My Watches" (scoped to one engineer).
CREATE INDEX IF NOT EXISTS idx_watches_engineer_id ON watches (engineer_id);

-- ---------------------------------------------------------------------------
-- notifications
--
-- Idempotency strategy (documented decision):
--   A notification is identified by (engineer_id, release_id) where release_id
--   is GitHub's global release ID. This pair MUST be unique at the database
--   level to ensure that running the release-check job multiple times for the
--   same release never creates duplicate notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  engineer_id         TEXT    NOT NULL REFERENCES engineers (id) ON DELETE CASCADE,
  release_id          INTEGER NOT NULL,   -- GitHub's global release id
  release_tag         TEXT    NOT NULL,   -- release tag (e.g., "v1.0.0")
  release_name        TEXT,               -- release name (may be null)
  release_url         TEXT    NOT NULL,   -- canonical https://github.com/... html_url
  repository          TEXT    NOT NULL,   -- "owner/repo", lower-cased
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- =========================================================================
  -- TEST 4 - IDEMPOTENT RELEASE NOTIFICATIONS
  -- The same engineer can never be notified twice for the same GitHub release.
  -- Enforced by the database engine itself (SQLite raises
  -- SQLITE_CONSTRAINT_UNIQUE / "UNIQUE constraint failed"). The application
  -- uses INSERT OR IGNORE / ON CONFLICT DO NOTHING so that re-running the
  -- release-check job is safe and idempotent.
  -- =========================================================================
  CONSTRAINT uq_notifications_engineer_release UNIQUE (engineer_id, release_id)
);

-- Fast lookup path for "My Notifications" (scoped to one engineer).
CREATE INDEX IF NOT EXISTS idx_notifications_engineer_id ON notifications (engineer_id);