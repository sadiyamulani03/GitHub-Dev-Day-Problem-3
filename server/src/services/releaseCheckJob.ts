/**
 * Release check job.
 *
 * This is the core background task that:
 * 1. Loads all watches from the database
 * 2. Fetches releases from GitHub for each watched repository
 * 3. Identifies new releases (not yet notified)
 * 4. Creates notification records (idempotent via DB constraint)
 * 5. Returns a summary of what was processed
 */
import type { Db } from '../db';
import { WatchRepository } from '../db/watchRepository';
import { NotificationRepository } from '../db/notificationRepository';
import { GithubClient, type ListReleasesResult } from './githubClient';
import { GithubReleaseSummary } from './githubNormalize';

export interface ReleaseCheckResult {
  watchesChecked: number;
  releasesFetched: number;
  notificationsCreated: number;
  notificationsSkipped: number;
  errors: Array<{ watchId: number; repository: string; error: string }>;
}

export interface WatchWithEngineer {
  id: number;
  engineerId: string;
  owner: string;
  repo: string;
}

export class ReleaseCheckJob {
  constructor(
    private readonly db: Db,
    private readonly github: GithubClient,
  ) {}

  private get watches(): WatchRepository {
    return new WatchRepository(this.db);
  }

  private get notifications(): NotificationRepository {
    return new NotificationRepository(this.db);
  }

  /**
   * Load all watches with their engineer IDs.
   */
  private loadAllWatches(): WatchWithEngineer[] {
    const rows = this.db
      .prepare(
        `SELECT id, engineer_id, owner, repo
           FROM watches
          ORDER BY engineer_id, owner, repo`,
      )
      .all() as Array<{ id: number; engineer_id: string; owner: string; repo: string }>;
    return rows.map((row) => ({
      id: row.id,
      engineerId: row.engineer_id,
      owner: row.owner,
      repo: row.repo,
    }));
  }

  /**
   * Fetch releases for a single watch (repository).
   */
  private async fetchReleasesForWatch(
    watch: WatchWithEngineer,
    signal?: AbortSignal,
  ): Promise<{ releases: GithubReleaseSummary[]; error?: string }> {
    try {
      const result: ListReleasesResult = await this.github.listReleases(watch.owner, watch.repo, signal);
      return { releases: result.releases };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { releases: [], error: message };
    }
  }

  /**
   * Process a single watch: fetch releases, create notifications for new ones.
   */
  private async processWatch(
    watch: WatchWithEngineer,
    signal?: AbortSignal,
  ): Promise<{ created: number; skipped: number; error?: string }> {
    const { releases, error } = await this.fetchReleasesForWatch(watch, signal);
    if (error) {
      return { created: 0, skipped: 0, error };
    }

    let created = 0;
    let skipped = 0;

    for (const release of releases) {
      // Skip drafts and prereleases - only notify on published releases
      if (release.isDraft || release.isPrerelease) {
        continue;
      }

      const inserted = this.notifications.insertIfNew({
        engineerId: watch.engineerId,
        releaseId: release.id,
        releaseTag: release.tag,
        releaseName: release.name,
        releaseUrl: release.url,
        repository: release.repository,
      });

      if (inserted) {
        created += 1;
      } else {
        skipped += 1;
      }
    }

    return { created, skipped };
  }

  /**
   * Run the full release check job.
   * This is designed to be idempotent - running it multiple times will not
   * create duplicate notifications thanks to the database UNIQUE constraint.
   */
  async run(signal?: AbortSignal): Promise<ReleaseCheckResult> {
    const watches = this.loadAllWatches();
    let totalReleasesFetched = 0;
    let totalNotificationsCreated = 0;
    let totalNotificationsSkipped = 0;
    const errors: ReleaseCheckResult['errors'] = [];

    for (const watch of watches) {
      if (signal?.aborted) break;

      const { created, skipped, error } = await this.processWatch(watch, signal);
      totalReleasesFetched += created + skipped; // only counts non-draft/non-prerelease
      totalNotificationsCreated += created;
      totalNotificationsSkipped += skipped;

      if (error) {
        errors.push({
          watchId: watch.id,
          repository: `${watch.owner}/${watch.repo}`,
          error,
        });
      }
    }

    return {
      watchesChecked: watches.length,
      releasesFetched: totalReleasesFetched,
      notificationsCreated: totalNotificationsCreated,
      notificationsSkipped: totalNotificationsSkipped,
      errors,
    };
  }
}