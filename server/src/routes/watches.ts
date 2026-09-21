/**
 * Watch routes - every one of them is scoped to `req.engineer.id`.
 *
 *   GET    /api/watches       -> the caller's own watches only
 *   POST   /api/watches       -> 201 Created | 409 Conflict on duplicate
 *   DELETE /api/watches/:id   -> 204 No Content | 404 when not owned
 *
 * =============================================================================
 * TEST 3 - DATABASE-LEVEL DUPLICATE PROTECTION
 * TEST 4 - WATCH OWNERSHIP / 404 vs 403
 * TEST 6 - PARAMETERIZED SQL
 * =============================================================================
 */
import { Router } from 'express';
import type { AppContext } from '../container';
import { badRequest, conflict, isUniqueConstraintError, notFound, forbidden } from '../errors';
import { createAuthMiddleware } from '../middleware/auth';
import {
  toPublicWatch,
  type WatchRow,
} from '../db/watchRepository';
import { parseRepositoryInput } from '../services/repoInput';

export function createWatchesRouter(context: AppContext): Router {
  const router = Router();
  const { config, watches } = context;
  const { requireAuth } = createAuthMiddleware(context.authService, config.cookieName);

  // Every route below requires a server-resolved identity.
  router.use(requireAuth);

  /** GET /api/watches - only the authenticated engineer's watches. */
  router.get('/', (req, res) => {
    const engineerId = req.engineer?.id ?? '';
    const rows = watches.listForEngineer(engineerId);
    res.json({
      watches: rows.map(toPublicWatch),
      count: rows.length,
    });
  });

  /**
   * POST /api/watches  { repository: "owner/repo" }
   */
  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const repositoryInput = typeof body.repository === 'string' ? body.repository : '';

    if (!repositoryInput) {
      throw badRequest('missing_fields', 'Repository is required (format: "owner/repo").');
    }

    const repository = parseRepositoryInput(repositoryInput);
    const engineerId = req.engineer?.id ?? '';

    let created: WatchRow;
    try {
      created = watches.insert({
        engineerId,
        owner: repository.owner,
        repo: repository.repo,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // The DATABASE refused the duplicate (uq_watches_engineer_repo).
        const existing = watches.findByRepoForEngineer(engineerId, repository.owner, repository.repo);
        throw conflict(
          'duplicate_watch',
          'You are already watching this repository.',
          existing === null ? undefined : { watch: toPublicWatch(existing) },
        );
      }
      throw error;
    }

    res.status(201).json({ watch: toPublicWatch(created) });
  });

  /**
   * DELETE /api/watches/:id
   *
   * Ownership verification with 404 vs 403 distinction:
   * - Watch does not exist at all -> 404
   * - Watch exists but belongs to another engineer -> 403
   * - Watch belongs to authenticated engineer -> allow deletion
   */
  router.delete('/:id', (req, res) => {
    const watchId = parsePositiveInteger(req.params.id, 'Watch id');
    if (watchId < 1) throw badRequest('invalid_input', 'Watch id must be a positive number.');

    const engineerId = req.engineer?.id ?? '';

    // First check if the watch exists at all (without ownership check)
    const watch = watches.findById(watchId);
    if (!watch) {
      throw notFound('watch_not_found', 'That watch does not exist.');
    }

    // Check ownership
    if (watch.engineer_id !== engineerId) {
      throw forbidden('watch_forbidden', 'You do not have permission to delete this watch.');
    }

    // Delete with ownership check
    const deleted = watches.deleteForEngineer(engineerId, watchId);
    if (deleted === 0) {
      // Should not happen since we checked ownership, but safety net
      throw notFound('watch_not_found', 'That watch does not exist in your list.');
    }

    res.status(204).end();
  });

  return router;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'string') throw badRequest('invalid_input', `${fieldName} must be a string.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw badRequest('invalid_input', `${fieldName} must be a positive integer.`);
  }
  return parsed;
}