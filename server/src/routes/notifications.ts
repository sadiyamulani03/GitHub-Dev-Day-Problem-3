/**
 * Notification routes - scoped to `req.engineer.id`.
 *
 *   GET /api/notifications       -> the caller's own notifications only
 *
 * =============================================================================
 * TEST 4 - IDEMPOTENT RELEASE NOTIFICATIONS
 * TEST 6 - PARAMETERIZED SQL
 * =============================================================================
 */
import { Router } from 'express';
import type { AppContext } from '../container';
import { createAuthMiddleware } from '../middleware/auth';
import {
  toPublicNotification,
  type NotificationRow,
} from '../db/notificationRepository';

export function createNotificationsRouter(context: AppContext): Router {
  const router = Router();
  const { config, notifications } = context;
  const { requireAuth } = createAuthMiddleware(context.authService, config.cookieName);

  // Every route below requires a server-resolved identity.
  router.use(requireAuth);

  /** GET /api/notifications - only the authenticated engineer's notifications. */
  router.get('/', (req, res) => {
    const engineerId = req.engineer?.id ?? '';
    const rows = notifications.listForEngineer(engineerId);
    res.json({
      notifications: rows.map(toPublicNotification),
      count: rows.length,
    });
  });

  return router;
}