/**
 * Application context - wires all services together.
 */
import type { Db } from './db';
import type { AppConfig } from './config';
import { GithubClient } from './services/githubClient';
import { createAuthService, type AuthService } from './services/authService';
import { WatchRepository } from './db/watchRepository';
import { NotificationRepository } from './db/notificationRepository';

export interface AppContext {
  config: AppConfig;
  db: Db;
  github: GithubClient;
  authService: AuthService;
  watches: WatchRepository;
  notifications: NotificationRepository;
}

export function createContext(config: AppConfig, db: Db): AppContext {
  const github = new GithubClient({
    token: config.githubToken,
    baseUrl: config.githubApiBaseUrl,
    userAgent: config.githubUserAgent,
    timeoutMs: config.githubFetchTimeoutMs,
    maxPages: config.githubMaxPages,
  });

  const authService = createAuthService(db, config.sessionTtlHours);
  const watches = new WatchRepository(db);
  const notifications = new NotificationRepository(db);

  return {
    config,
    db,
    github,
    authService,
    watches,
    notifications,
  };
}