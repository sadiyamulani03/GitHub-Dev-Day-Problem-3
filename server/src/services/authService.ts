/**
 * Authentication service: register, login, session management.
 *
 * All identity flows are server-side. The client only ever sees an opaque
 * session token in an httpOnly cookie.
 */
import crypto from 'node:crypto';
import type { Db } from '../db';
import { hashPassword, verifyPassword } from './passwords';
import { badRequest, conflict } from '../errors';

export interface Engineer {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionRow {
  token_hash: string;
  engineer_id: string;
  created_at: string;
  expires_at: string;
}

export interface AuthService {
  register(email: string, password: string, displayName: string): Promise<Engineer>;
  login(email: string, password: string): Promise<string>; // returns raw session token
  resolveSession(token: string | null): Engineer | null;
  logout(token: string | null): Promise<void>;
}

export function createAuthService(db: Db, sessionTtlHours: number): AuthService {
  function generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  const ttlMs = sessionTtlHours * 60 * 60 * 1000;

  return {
    async register(email: string, password: string, displayName: string): Promise<Engineer> {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.includes('@')) {
        throw badRequest('invalid_email', 'Invalid email address.');
      }
      if (password.length < 8) {
        throw badRequest('password_too_short', 'Password must be at least 8 characters.');
      }
      if (!displayName || displayName.trim().length === 0) {
        throw badRequest('display_name_required', 'Display name is required.');
      }

      const passwordHash = await hashPassword(password);
      const engineerId = generateId();
      const now = new Date().toISOString();

      try {
        db.prepare(
          `INSERT INTO engineers (id, email, display_name, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(engineerId, normalizedEmail, displayName.trim(), passwordHash, now);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'errcode' in error &&
          (error.errcode === 2067 || error.errcode === 1555 || error.errcode === 19)
        ) {
          throw conflict('email_exists', 'An account with this email already exists.');
        }
        throw error;
      }

      return { id: engineerId, email: normalizedEmail, displayName: displayName.trim() };
    },

    async login(email: string, password: string): Promise<string> {
      const normalizedEmail = email.trim().toLowerCase();
      const row = db
        .prepare('SELECT id, email, display_name, password_hash FROM engineers WHERE email = ?')
        .get(normalizedEmail) as { id: string; email: string; display_name: string; password_hash: string } | undefined;

      if (!row) {
        throw badRequest('invalid_credentials', 'Invalid email or password.');
      }

      const valid = await verifyPassword(password, row.password_hash);
      if (!valid) {
        throw badRequest('invalid_credentials', 'Invalid email or password.');
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      db.prepare(
        `INSERT INTO sessions (token_hash, engineer_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      ).run(tokenHash, row.id, createdAt, expiresAt);

      return rawToken;
    },

    resolveSession(token: string | null): Engineer | null {
      if (!token) return null;
      const tokenHash = hashToken(token);
      const row = db
        .prepare(
          `SELECT s.token_hash, s.engineer_id, s.expires_at, e.id, e.email, e.display_name
             FROM sessions s
             JOIN engineers e ON e.id = s.engineer_id
            WHERE s.token_hash = ?`,
        )
        .get(tokenHash) as SessionRow & { id: string; email: string; display_name: string } | undefined;

      if (!row) return null;
      if (new Date(row.expires_at) <= new Date()) {
        // Expired - clean up
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
        return null;
      }
      return { id: row.id, email: row.email, displayName: row.display_name };
    },

    async logout(token: string | null): Promise<void> {
      if (!token) return;
      const tokenHash = hashToken(token);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
  };
}