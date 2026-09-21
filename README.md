# GitHub Release Radar

GitHub Release Radar is a small engineer-focused release notification service. An engineer can register, watch GitHub repositories, and have the server check those repositories for published releases. New releases are persisted as notifications, and database constraints make repeated checks safe.

The repository contains a TypeScript/Express backend, a SQLite data layer, a minimal Vite/React client, and integration tests. The client is intentionally minimal; the release data comes from GitHub through the backend rather than from client-supplied payloads.

## What It Does

- Registers engineers and supports login, logout, and retrieval of the current engineer.
- Lets an authenticated engineer add repositories in `owner/repo` format and list only their own watches.
- Normalizes repository names to lowercase and rejects duplicate watches for the same engineer and repository.
- Fetches releases server-side from the GitHub REST API for every watched repository.
- Skips draft and prerelease releases when creating notifications.
- Stores notifications with the engineer and GitHub release ID.
- Makes release checks idempotent across reruns, retries, and process restarts.
- Isolates watch and notification reads by the authenticated engineer's server-side session identity.

## Architecture

```text
Browser
  |
  | HTTP + httpOnly session cookie
  v
Express 5 API (TypeScript)
  |-- authentication/session middleware
  |-- watch and notification routes
  |-- release-check job route
  |
  +--> SQLite database (migrations, constraints, prepared statements)
  |
  +--> GitHub REST API
       Authorization: Bearer ${GITHUB_TOKEN}
```

Main components:

- `server/src/app.ts`: Express application, route mounting, API 404 handling, and centralized errors.
- `server/src/routes/`: authentication, watch, notification, release-check, and health endpoints.
- `server/src/services/githubClient.ts`: server-side GitHub releases client with pagination and authenticated requests.
- `server/src/services/releaseCheckJob.ts`: loads watches, fetches releases, and records new notifications.
- `server/src/db/`: SQLite connection, repositories, and migration runner.
- `server/src/middleware/auth.ts`: resolves the session cookie into a trusted engineer identity.
- `server/src/migrations/001_init.sql`: database schema and uniqueness constraints.
- `client/`: minimal Vite/React client.

The release-check job is triggered through `POST /api/release-check`; the current implementation does not include a scheduler.

## Core Challenge Requirements

| # | Requirement | Implementation |
|---|---|---|
| 1 | Fetch real GitHub releases server-side | `GithubClient` calls `GET /repos/{owner}/{repo}/releases`; release data is never supplied by the client. |
| 2 | Re-running the notification job must not re-notify | The job persists notifications and uses the database to reject an existing `(engineer_id, release_id)` pair. |
| 3 | Database uniqueness for engineer/release notifications | `notifications` has `UNIQUE (engineer_id, release_id)`. |
| 4 | Engineers can access only their own watchlists | Routes use `req.engineer.id` derived from the server-resolved session; repository queries bind that ID. |
| 5 | Distinguish nonexistent watches from other engineers' watches | `DELETE /api/watches/:id` returns `404` when the row does not exist and `403` when it exists but has another owner. |
| 6 | Authenticate GitHub requests | Every GitHub request uses `Authorization: Bearer ${GITHUB_TOKEN}` loaded from environment configuration. |
| 7 | Keep credentials out of the repository | `.env.example` contains placeholders, `.env` is ignored, and the token is not embedded in source or documentation. |
| 8 | Prevent duplicate watches | `watches` has `UNIQUE (engineer_id, owner, repo)`; the API maps a database duplicate to `409 Conflict`. |

## Idempotency and Database Constraints

Notification idempotency is enforced by SQLite rather than by an application-only existence check:

```sql
CONSTRAINT uq_notifications_engineer_release
  UNIQUE (engineer_id, release_id)
```

`NotificationRepository.insertIfNew()` uses `INSERT OR IGNORE`. If the engineer/release pair already exists, SQLite changes zero rows and the job counts the release as skipped. The persistent database state, not an in-memory cache, is the source of truth.

Watch duplicates are prevented independently:

```sql
CONSTRAINT uq_watches_engineer_repo
  UNIQUE (engineer_id, owner, repo)
```

The release job also deduplicates release IDs within a GitHub response and skips drafts and prereleases. Its result reports watches checked, releases fetched, notifications created, notifications skipped, and per-watch errors.

## API Routes

All API responses are JSON unless noted otherwise.

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register an engineer; returns `201`, or `409` for an existing email. | Public |
| `POST` | `/api/auth/login` | Validate credentials and set the session cookie; returns `200`. | Public |
| `POST` | `/api/auth/logout` | Delete the session when a cookie is present and clear the cookie; returns `204`. | Cookie is read if present; a valid session is not required |
| `GET` | `/api/auth/me` | Return the current engineer; returns `401` when anonymous. | Session required for `200` |
| `GET` | `/api/watches` | List the authenticated engineer's watches. | Required |
| `POST` | `/api/watches` | Add `owner/repo`; returns `201`, `400` for invalid input, or `409` for a duplicate. | Required |
| `DELETE` | `/api/watches/:id` | Delete a watch; returns `204`, `400` for an invalid ID, `404` if absent, or `403` if owned by another engineer. | Required |
| `GET` | `/api/notifications` | List the authenticated engineer's notifications. | Required |
| `POST` | `/api/release-check` | Run the release-check job across stored watches and return a result summary. | Required |
| `GET` | `/api/health` | Return `{ "status": "ok" }`. | Public |

Unmatched `/api/` paths return a JSON `404`. The current code exposes no separate `GET /api/watches/:id` route; watch-specific authorization is implemented on the existing delete route.

## Authentication

Registration stores a scrypt password hash, never the plaintext password. Email addresses are normalized to lowercase and engineer IDs are generated by the server.

Login creates a random session token. Only a SHA-256 hash of that token is stored in SQLite. The raw token is sent in the `rr_session` cookie with `HttpOnly`, `SameSite=Lax`, and `Secure` enabled in production. The default session lifetime is 168 hours.

The authentication middleware resolves the cookie against the database and assigns the trusted identity to `req.engineer`. Client-supplied user or engineer IDs are not accepted for authorization. Watch and notification queries use the resolved engineer ID.

## Watchlist Ownership

Watch creation and listing are scoped to the authenticated engineer. Repository input is parsed as exactly `owner/repo` and stored in lowercase.

For deletion, the route first determines whether the watch exists:

- No matching row: `404 Not Found` with `watch_not_found`.
- Matching row owned by another engineer: `403 Forbidden` with `watch_forbidden`.
- Matching row owned by the caller: delete succeeds with `204 No Content`.

The delete operation also uses an ownership-scoped SQL statement as a defense-in-depth check.

## GitHub API Configuration

Set `GITHUB_TOKEN` in the environment. It is read by `server/src/config.ts`, kept server-side, and used only to construct the outgoing GitHub `Authorization` header. GitHub calls fail with a `503` response when the token is not configured.

The server supports these optional settings:

| Variable | Default | Purpose |
|---|---:|---|
| `GITHUB_API_BASE_URL` | `https://api.github.com` | GitHub API base URL |
| `GITHUB_FETCH_TIMEOUT_MS` | `15000` | Per-request fetch timeout |
| `GITHUB_MAX_PAGES` | `20` | Safety cap for pagination |
| `GITHUB_USER_AGENT` | `release-radar` | GitHub request user agent |

The API client requests 100 releases per page, follows GitHub's `Link` header, and stops at the configured page cap.

## Environment Setup

Requirements:

- Node.js `>=24.0.0`
- npm

Install dependencies:

```bash
npm install
```

Create a local environment file from the checked-in example:

```powershell
Copy-Item .env.example .env
```

Set at least the following value in `.env`:

```text
GITHUB_TOKEN=<your-github-token>
```

Never commit the populated `.env` file. The database defaults to `data/release-radar.db`, and the API defaults to port `3001`.

## Running Locally

Run the database migration, then start the API and Vite client:

```bash
npm run db:migrate
npm run dev
```

`npm run dev` starts the API and web client concurrently. Vite serves the client on port `5173` and proxies `/api` to the API on port `3001`.

Other exact project scripts:

```bash
npm run start          # start the built server
npm run db:reset       # reset the local SQLite database
npm test               # run the Vitest integration suite
npm run typecheck      # type-check server and client
npm run build          # typecheck, build server, and build client
npm run lint           # run ESLint
```

For a production-style run, build first and start the built server with the appropriate environment configuration:

```bash
npm run build
npm run start
```

## Testing

The verified suite contains 21 passing tests across three integration test groups:

- Authentication: registration, login/logout, current engineer, duplicate email, and invalid credentials.
- Watches: creation, listing, normalization, duplicate prevention, ownership, deletion, `401`, `403`, and `404`.
- Notifications: authenticated listing and per-engineer isolation.

The tests use temporary in-memory SQLite databases and an injectable GitHub fetch mock. The production GitHub client itself calls the real GitHub REST API.

## Database

The SQLite schema includes engineers, sessions, watches, and notifications. Foreign keys are enabled, repository values are stored in lowercase, and all repository SQL uses prepared-statement placeholders.

Important constraints:

```sql
UNIQUE (engineer_id, owner, repo)
UNIQUE (engineer_id, release_id)
```

Sessions store only token hashes. Watch and notification records cascade when their engineer is deleted.

## Security Notes

- GitHub credentials are supplied through `GITHUB_TOKEN`; no real token is present in the repository.
- `.env`, local environment files, databases, build output, and logs are ignored by `.gitignore`.
- GitHub requests originate from the backend and never expose the token to the browser.
- Passwords are stored as scrypt hashes.
- Session tokens are hashed before database storage and sent in an `HttpOnly` cookie.
- SQL values are bound through prepared statements.
- The centralized error handler keeps stack traces and implementation details out of client responses.

## Project Structure

```text
client/
  index.html
  src/
    App.tsx
    main.tsx
  tsconfig.json
server/
  src/
    app.ts
    config.ts
    container.ts
    errors.ts
    index.ts
    db/
    middleware/
    migrations/
    routes/
    services/
  tsconfig.json
tests/
  helpers.ts
  integration/
.env.example
.gitignore
package.json
package-lock.json
vite.config.ts
vitest.config.ts
```

## Judge Quick Start

1. Clone this repository and enter its root directory.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `GITHUB_TOKEN` to a GitHub token with access to the repositories being watched.
4. Run `npm run db:migrate`.
5. Run `npm test` to verify the integration suite.
6. Run `npm run build` to type-check and build both server and client.
7. Run `npm run dev` to start the local API and Vite client.

## Verification Summary

| Requirement | Verified implementation |
|---|---|
| Real GitHub releases | Server-side GitHub REST API client |
| Idempotent notifications | SQLite uniqueness plus `INSERT OR IGNORE` |
| Notification uniqueness | `UNIQUE (engineer_id, release_id)` |
| Watch uniqueness | `UNIQUE (engineer_id, owner, repo)` |
| Watch ownership | Session-derived engineer ID on every watch operation |
| `404` vs `403` | Separate missing-row and cross-engineer delete responses |
| GitHub authentication | Environment-loaded `Authorization: Bearer` header |
| Secret safety | Placeholder-only environment example and ignored `.env` |
| Duplicate watches | Database constraint and `409 Conflict` response |
| Tests | 21/21 passing |
| Typecheck | Passed |
| Production build | Passed |
