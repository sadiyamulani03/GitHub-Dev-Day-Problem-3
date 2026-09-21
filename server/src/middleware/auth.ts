/**
 * Authentication middleware.
 *
 * =============================================================================
 * TEST 5 - PER-ENGINEER AUTHORIZATION
 * =============================================================================
 * This is the ONLY place `req.engineer` is ever assigned, and it is derived purely
 * from the httpOnly session cookie resolved against the `sessions` table:
 *
 *     cookie token -> sha256(token) -> sessions row -> engineers row -> req.engineer.id
 *
 * Nothing in a request body, query string, path or header can claim an
 * identity. Route handlers use `req.engineer.id` for every watch/notification query
 * (`WHERE engineer_id = ?`), which makes one engineer's data
 * invisible and immutable to every other engineer.
 */
import type { Request, RequestHandler } from 'express';
import { unauthenticated } from '../errors';
import { readCookie } from '../services/cookies';
import { AuthService, Engineer } from '../services/authService';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      engineer?: Engineer;
    }
  }
}

export function createAuthMiddleware(
  authService: AuthService,
  cookieName: string,
): {
  attachEngineer: RequestHandler;
  requireAuth: RequestHandler;
  resolveEngineer: (req: Request) => ReturnType<AuthService['resolveSession']>;
  readSessionToken: (req: Request) => string | null;
} {
  const readSessionToken = (req: Request): string | null => readCookie(req.headers.cookie, cookieName);

  const resolveEngineer = (req: Request) => authService.resolveSession(readSessionToken(req));

  /** Populates req.engineer when a valid session exists; never rejects. */
  const attachEngineer: RequestHandler = (req, _res, next) => {
    const engineer = resolveEngineer(req);
    if (engineer !== null) req.engineer = engineer;
    next();
  };

  /** Rejects anonymous requests with 401. */
  const requireAuth: RequestHandler = (req, _res, next) => {
    const engineer = resolveEngineer(req);
    if (engineer === null) {
      next(unauthenticated('Sign in to continue.'));
      return;
    }
    req.engineer = engineer;
    next();
  };

  return { attachEngineer, requireAuth, resolveEngineer, readSessionToken };
}