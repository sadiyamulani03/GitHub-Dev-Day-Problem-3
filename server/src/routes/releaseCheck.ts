/**
 * Release check route - triggers the release check job manually.
 *
 *   POST /api/release-check  -> 200 OK with job result summary
 */
import { Router } from 'express';
import type { AppContext } from '../container';
import { createAuthMiddleware } from '../middleware/auth';
import { ReleaseCheckJob } from '../services/releaseCheckJob';

export function createReleaseCheckRouter(context: AppContext): Router {
  const router = Router();
  const { config, db, github } = context;
  const { requireAuth } = createAuthMiddleware(context.authService, config.cookieName);

  router.use(requireAuth);

  /** POST /api/release-check - run the release check job. */
  router.post('/', async (req, res) => {
    const job = new ReleaseCheckJob(db, github);
    const result = await job.run();
    res.json(result);
  });

  return router;
}