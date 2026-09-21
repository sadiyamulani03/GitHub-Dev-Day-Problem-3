/**
 * Test utilities: spin up the REAL Express app against a temporary in-memory
 * SQLite database and an injectable mock fetch for GitHub API traffic.
 */
import { openDatabase, type Db } from '@db';
import { loadConfig, type AppConfig } from '@config';
import { createContext } from '@container';
import { createApp } from '@app';
import type { Express } from 'express';
import { runMigrations } from '@db/migrate';

export const TEST_TOKEN = 'test_github_token_server_side_only';
export const SESSION_COOKIE = 'rr_session';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockFetchState {
  requests: CapturedRequest[];
  responses: Array<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }>;
  defaultStatus: number;
  defaultBody: unknown;
}

export class MockFetch {
  state: MockFetchState = { requests: [], responses: [], defaultStatus: 200, defaultBody: [] };

  capture(method: string, url: string, headers: Record<string, string>, body: unknown): void {
    this.state.requests.push({ url, method, headers, body });
  }

  /** Set a canned response to return on the next call (FIFO). */
  nextResponse(status: number, body: unknown, headers?: Record<string, string>): void {
    this.state.responses.push({ status, headers: headers ?? {}, body });
  }

  /** Clear all canned responses and request captures. */
  reset(): void {
    this.state = { requests: [], responses: [], defaultStatus: 200, defaultBody: [] };
  }

  createFetch(): typeof fetch {
    const self = this;
    return async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [k, v] of new Headers(init.headers).entries()) {
          headers[k] = v;
        }
      }
      const body = init?.body;
      self.capture(method, url, headers, body);

      // Return canned response if available (FIFO)
      const canned = self.state.responses.shift();
      if (canned !== undefined) {
        return new Response(JSON.stringify(canned.body), {
          status: canned.status,
          headers: { 'Content-Type': 'application/json', ...canned.headers },
        });
      }

      // Default: return empty array
      return new Response(JSON.stringify(self.state.defaultBody), {
        status: self.state.defaultStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }
}

export interface TestHarness {
  app: Express;
  db: Db;
  baseUrl: string;
  mockFetch: MockFetch;
  cookies: Record<string, string>;
  request: (method: string, path: string, body?: unknown, opts?: { cookies?: boolean; raw?: boolean }) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }>;
  registerUser: (email: string, password: string, displayName?: string) => Promise<void>;
  loginUser: (email: string, password: string) => Promise<void>;
  logoutUser: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  const mockFetch = new MockFetch();

  const config: AppConfig = {
    ...loadConfig({
      NODE_ENV: 'test',
      DATABASE_FILE: ':memory:',
      GITHUB_TOKEN: TEST_TOKEN,
      GITHUB_API_BASE_URL: 'https://api.github.com',
      GITHUB_MAX_PAGES: 20,
    }),
    githubToken: TEST_TOKEN,
    githubApiBaseUrl: 'https://api.github.com',
    databaseFile: ':memory:',
    fetchImpl: mockFetch.createFetch(),
  };

  const db = openDatabase(config.databaseFile);
  runMigrations(db, config.migrationsDir);

  const context = createContext(config, db);
  const app = createApp(context);

  const cookies: Record<string, string> = {};

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      resolve(s);
    });
  });
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const parseCookies = (headerValue: string | null): void => {
    if (headerValue === null) return;
    const m = /rr_session=([^;]+)/.exec(headerValue);
    if (m) {
      if (headerValue.includes('Max-Age=0')) {
        delete cookies[SESSION_COOKIE];
      } else {
        cookies[SESSION_COOKIE] = decodeURIComponent(m[1]!);
      }
    }
  };

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    opts: { cookies?: boolean; raw?: boolean } = {},
  ): Promise<{ status: number; headers: Record<string, string>; body: unknown }> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.cookies !== false && cookies[SESSION_COOKIE]) {
      headers.Cookie = `${SESSION_COOKIE}=${cookies[SESSION_COOKIE]}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const respHeaders: Record<string, string> = {};
    for (const [k, v] of response.headers.entries()) {
      respHeaders[k] = v;
    }

    // Capture Set-Cookie for session continuity
    const setCookie = response.headers.get('set-cookie');
    parseCookies(setCookie);

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return {
      status: response.status,
      headers: respHeaders,
      body: parsed,
    };
  };

  const registerUser = async (email: string, password: string, displayName?: string): Promise<void> => {
    const res = await request('POST', '/api/auth/register', { email, password, displayName });
    if (res.status !== 201) {
      throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  };

  const loginUser = async (email: string, password: string): Promise<void> => {
    const res = await request('POST', '/api/auth/login', { email, password });
    if (res.status !== 200) {
      throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  };

  const logoutUser = async (): Promise<void> => {
    await request('POST', '/api/auth/logout');
  };

  return {
    app,
    db,
    baseUrl,
    mockFetch,
    cookies,
    request,
    registerUser,
    loginUser,
    logoutUser,
    close: async () => {
      db.close();
      server.close();
    },
  };
}

export function extractEngineer(body: unknown): { id: string; email: string; displayName: string } {
  return (body as { engineer: { id: string; email: string; displayName: string } }).engineer;
}

export function extractWatch(body: unknown): { id: number; owner: string; repo: string; repository: string } {
  return (body as { watch: { id: number; owner: string; repo: string; repository: string } }).watch;
}

export function extractWatches(body: unknown): {
  watches: Array<{ id: number; owner: string; repo: string; repository: string }>;
  count: number;
} {
  return body as ReturnType<typeof extractWatches>;
}

export function extractNotifications(body: unknown): {
  notifications: Array<{
    id: number;
    releaseId: number;
    releaseTag: string;
    releaseName: string | null;
    releaseUrl: string;
    repository: string;
  }>;
  count: number;
} {
  return body as ReturnType<typeof extractNotifications>;
}

export function extractReleaseCheckResult(body: unknown): {
  watchesChecked: number;
  releasesFetched: number;
  notificationsCreated: number;
  notificationsSkipped: number;
  errors: Array<{ watchId: number; repository: string; error: string }>;
} {
  return body as ReturnType<typeof extractReleaseCheckResult>;
}