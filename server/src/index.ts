/**
 * Application entry point.
 */
import { loadConfig, resolveDatabaseFile } from './config';
import { openDatabase } from './db';
import { runMigrations } from './db/migrate';
import { createContext } from './container';
import { createApp } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const dbFile = resolveDatabaseFile(config);

  console.log(`[startup] Opening database: ${dbFile}`);
  const db = openDatabase(dbFile);

  console.log('[startup] Running migrations...');
  runMigrations(db, config.migrationsDir);

  const context = createContext(config, db);
  const app = createApp(context);

  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`[startup] Server listening on http://127.0.0.1:${config.port}`);
    if (config.githubToken) {
      console.log('[startup] GitHub token configured - API calls will be authenticated');
    } else {
      console.warn('[startup] WARNING: GITHUB_TOKEN not set - GitHub API calls will fail');
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] Received ${signal}, shutting down...`);
    server.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[startup] Failed to start:', error);
  process.exit(1);
});