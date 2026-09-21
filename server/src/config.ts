/**
 * Application configuration, loaded from environment variables.
 *
 * SECURITY: `githubToken` and the database file are server-side only. This
 * module is only ever imported by server code - nothing in `client/` reads
 * process.env at all (see tests/integration/security.test.ts).
 */
import path from 'node:path';

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  /** HTTP port. In production this single process also serves the built SPA. */
  port: number;
  /** SQLite database file path (relative paths resolve against the cwd). */
  databaseFile: string;
  /** Optional override for the folder containing the *.sql migrations. */
  migrationsDir: string | null;
  /** Session lifetime in hours. */
  sessionTtlHours: number;
  /** Cookie name holding the opaque session token. */
  cookieName: string;
  /** Server-side GitHub token. NEVER exposed to the browser. */
  githubToken: string | null;
  githubApiBaseUrl: string;
  githubFetchTimeoutMs: number;
  githubMaxPages: number;
  githubUserAgent: string;
  trustProxy: boolean;
  /** When true, the built SPA in client/dist is served (production mode). */
  serveClient: boolean;
  clientDistDir: string;
  /** Injectable fetch, used by the test-suite to intercept GitHub traffic. */
  fetchImpl?: typeof fetch;
}

export const SESSION_COOKIE_NAME = 'rr_session';

export const DEFAULT_MIGRATIONS_DIR = path.join('server', 'src', 'migrations');
export const DEFAULT_DATABASE_FILE = path.join('data', 'release-radar.db');

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `Invalid configuration: ${key} must be an integer between ${bounds.min} and ${bounds.max}.`,
    );
  }
  return parsed;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readString(env, key);
  if (raw === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawBase = readString(env, 'GITHUB_API_BASE_URL') ?? 'https://api.github.com';
  const base = rawBase.replace(/\/+$/, '');
  let parsedBase: URL;
  try {
    parsedBase = new URL(base);
  } catch {
    throw new Error('Invalid configuration: GITHUB_API_BASE_URL must be an absolute http(s) URL.');
  }
  if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
    throw new Error('Invalid configuration: GITHUB_API_BASE_URL must use http or https.');
  }

  const nodeEnv = readString(env, 'NODE_ENV') ?? 'development';

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: readInt(env, 'PORT', 3001, { min: 1, max: 65535 }),
    databaseFile: readString(env, 'DATABASE_FILE') ?? DEFAULT_DATABASE_FILE,
    migrationsDir: readString(env, 'MIGRATIONS_DIR'),
    sessionTtlHours: readInt(env, 'SESSION_TTL_HOURS', 24 * 7, { min: 1, max: 24 * 365 }),
    cookieName: SESSION_COOKIE_NAME,
    githubToken: readString(env, 'GITHUB_TOKEN'),
    githubApiBaseUrl: base,
    githubFetchTimeoutMs: readInt(env, 'GITHUB_FETCH_TIMEOUT_MS', 15_000, { min: 500, max: 120_000 }),
    githubMaxPages: readInt(env, 'GITHUB_MAX_PAGES', 20, { min: 1, max: 200 }),
    githubUserAgent: readString(env, 'GITHUB_USER_AGENT') ?? 'release-radar',
    trustProxy: readBool(env, 'TRUST_PROXY', false),
    serveClient: readBool(env, 'SERVE_CLIENT', nodeEnv === 'production'),
    clientDistDir: readString(env, 'CLIENT_DIST_DIR') ?? path.join('client', 'dist'),
  };
}

/** Absolute path of the database file. */
export function resolveDatabaseFile(config: AppConfig): string {
  return path.resolve(config.databaseFile);
}