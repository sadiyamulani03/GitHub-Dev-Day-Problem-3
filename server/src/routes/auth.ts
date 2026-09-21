/**
 * Authentication routes.
 *
 *   POST /api/auth/register  { email, password, displayName } -> 201 Created
 *   POST /api/auth/login     { email, password }             -> 200 OK (sets cookie)
 *   POST /api/auth/logout                                -> 204 No Content
 *   GET  /api/auth/me                                -> 200 OK (current engineer)
 */
import { Router } from 'express';
import type { AppContext } from '../container';
import { badRequest, conflict } from '../errors';
import { createAuthMiddleware } from '../middleware/auth';

export function createAuthRouter(context: AppContext): Router {
  const router = Router();
  const { authService, config } = context;
  const { requireAuth, attachEngineer } = createAuthMiddleware(authService, config.cookieName);

  // Register
  router.post('/register', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';

    if (!email || !password || !displayName) {
      throw badRequest('missing_fields', 'Email, password, and displayName are required.');
    }

    try {
      const engineer = await authService.register(email, password, displayName);
      const token = await authService.login(email, password);

      res.cookie(config.cookieName, token, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.sessionTtlHours * 60 * 60 * 1000,
        path: '/',
      });

      res.status(201).json({ engineer: { id: engineer.id, email: engineer.email, displayName: engineer.displayName } });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw conflict('email_exists', 'An account with this email already exists.');
      }
      throw error;
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      throw badRequest('missing_fields', 'Email and password are required.');
    }

    const token = await authService.login(email, password);

    res.cookie(config.cookieName, token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: config.sessionTtlHours * 60 * 60 * 1000,
      path: '/',
    });

    const engineer = authService.resolveSession(token);
    res.json({ engineer: { id: engineer!.id, email: engineer!.email, displayName: engineer!.displayName } });
  });

  // Logout
  router.post('/logout', async (req, res) => {
    const { readSessionToken } = createAuthMiddleware(authService, config.cookieName);
    const token = readSessionToken(req);
    await authService.logout(token);
    res.clearCookie(config.cookieName, { path: '/' });
    res.status(204).end();
  });

  // Current engineer (me)
  router.get('/me', attachEngineer, (req, res) => {
    if (!req.engineer) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ engineer: { id: req.engineer.id, email: req.engineer.email, displayName: req.engineer.displayName } });
  });

  return router;
}