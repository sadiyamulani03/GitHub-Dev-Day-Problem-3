/**
 * Express application factory.
 */
import express from 'express';
import type { AppContext } from './container';
import { toHttpError } from './errors';
import { createAuthRouter } from './routes/auth';
import { createWatchesRouter } from './routes/watches';
import { createNotificationsRouter } from './routes/notifications';
import { createReleaseCheckRouter } from './routes/releaseCheck';

export function createApp(context: AppContext): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  // API routes
  app.use('/api/auth', createAuthRouter(context));
  app.use('/api/watches', createWatchesRouter(context));
  app.use('/api/notifications', createNotificationsRouter(context));
  app.use('/api/release-check', createReleaseCheckRouter(context));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Centralized error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const httpError = toHttpError(err);
    res.status(httpError.status).json({
      status: httpError.status,
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details === undefined ? {} : { details: httpError.details }),
    });
  });

  // 404 for unmatched API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({
        status: 404,
        code: 'not_found',
        message: 'API endpoint not found.',
      });
    } else {
      next();
    }
  });

  return app;
}