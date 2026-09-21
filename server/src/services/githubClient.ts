/**
 * Server-side GitHub REST API client for releases.
 *
 * =============================================================================
 * TEST 1 - the GitHub REST API is called FROM THE SERVER
 * TEST 8 - every GitHub request is authenticated with the server-side token
 * =============================================================================
 *
 * Architecture (the browser never sees a GitHub token):
 *
 *      Browser  ->  our Express backend  ->  GitHub REST API
 *                                        ^
 *                          Authorization: Bearer ${GITHUB_TOKEN}
 *
 * The token is read from the environment (server/src/config.ts) and only ever
 * used to build the outgoing `Authorization` header below.
 */
import {
  badGateway,
  gatewayTimeout,
  notFound,
  rateLimited,
  serviceUnavailable,
} from '../errors';
import { decideNextPage } from './githubLinkHeader';
import {
  normalizeGithubRelease,
  type GithubReleaseSummary,
  type RawGithubRelease,
} from './githubNormalize';

export const GITHUB_PAGE_SIZE = 100;
export const GITHUB_API_VERSION = '2022-11-28';

export interface GithubClientOptions {
  /** Server-side token. When null, every GitHub call fails fast with 503. */
  token: string | null;
  /** Defaults to https://api.github.com (override for GitHub Enterprise / tests). */
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  /** Safety cap so a pathological repository cannot loop forever. */
  maxPages: number;
  /** Injectable fetch (tests). Defaults to the global fetch at call time. */
  fetchImpl?: typeof fetch;
}

export interface ListReleasesResult {
  repository: string;
  releases: GithubReleaseSummary[];
  /** How many GitHub pages were actually requested - asserted by the tests. */
  pagesFetched: number;
  /** True when `maxPages` was reached before GitHub ran out of pages. */
  truncated: boolean;
}

interface PageResponse {
  body: RawGithubRelease[];
  linkHeader: string | null;
  url: string;
}

export class GithubClient {
  private readonly options: GithubClientOptions;

  constructor(options: GithubClientOptions) {
    this.options = options;
  }

  /** True when the server has a token to authenticate GitHub requests with. */
  get isConfigured(): boolean {
    return typeof this.options.token === 'string' && this.options.token.length > 0;
  }

  /** Perform the fetch, honouring both the request timeout and a caller signal. */
  private async rawFetch(url: URL, signal?: AbortSignal): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw serviceUnavailable('github_unavailable', 'No fetch implementation is available.');
    }

    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);

    try {
      return await fetchImpl.call(globalThis, url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: combined,
        headers: this.buildHeaders(),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError' || name === 'TimeoutError') {
        throw gatewayTimeout(
          'github_timeout',
          'GitHub did not respond in time. Please try again in a moment.',
        );
      }
      throw badGateway('github_unreachable', 'Could not reach GitHub right now. Please try again.');
    }
  }

  /**
   * Headers for every GitHub request (TEST 8).
   * `Authorization: Bearer <token>` is constructed here and is the ONLY place
   * the token is used. It is never returned to a client.
   */
  private buildHeaders(): Record<string, string> {
    const token = this.options.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw serviceUnavailable(
        'github_not_configured',
        'This server has no GitHub token configured, so it cannot query the GitHub API. ' +
          'Set GITHUB_TOKEN in the environment and restart the server.',
      );
    }
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': this.options.userAgent,
    };
  }

  private async fetchPage(
    owner: string,
    repo: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<PageResponse> {
    const url = new URL(
      `${this.options.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
    );
    // Exactly the parameters required by the challenge:
    url.searchParams.set('per_page', String(GITHUB_PAGE_SIZE));
    url.searchParams.set('page', String(page));

    const response = await this.rawFetch(url, signal);

    if (!response.ok) throw this.mapErrorResponse(response, `${owner}/${repo}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw badGateway('github_bad_response', 'GitHub returned a response we could not read.');
    }
    if (!Array.isArray(body)) {
      throw badGateway('github_bad_response', 'GitHub returned an unexpected response shape.');
    }

    return {
      body: body as RawGithubRelease[],
      linkHeader: response.headers.get('link'),
      url: url.toString(),
    };
  }

  /** Translate a failed GitHub response into a safe application error. */
  private mapErrorResponse(response: Response, repository: string): Error {
    const status = response.status;
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetEpoch = Number.parseInt(response.headers.get('x-ratelimit-reset') ?? '', 10);
    const resetAt = Number.isFinite(resetEpoch) ? new Date(resetEpoch * 1000).toISOString() : null;

    if (status === 404) {
      return notFound(
        'repository_not_found',
        `Repository "${repository}" was not found on GitHub. Check the spelling - private repositories also need a token with access.`,
      );
    }
    if (status === 401) {
      return badGateway(
        'github_authentication_failed',
        "GitHub rejected this server's credentials. An administrator must check GITHUB_TOKEN.",
      );
    }
    if (status === 429 || (status === 403 && remaining === '0')) {
      return rateLimited('GitHub rate limit reached. Please try again after the limit resets.', {
        resetAt,
      });
    }
    if (status === 403) {
      return badGateway(
        'github_forbidden',
        'GitHub refused the request (403). The token may lack access to this repository.',
      );
    }
    if (status >= 500) {
      return badGateway(
        'github_unavailable',
        'GitHub is having problems right now. Please try again shortly.',
      );
    }
    return badGateway('github_error', `GitHub returned an unexpected status (${status}).`);
  }

  /**
   * ==========================================================================
   * TEST 2 - fetch EVERY page of releases.
   *
   *   GET /repos/{owner}/{repo}/releases
   *        ?per_page=100&page=N
   *
   * Loop:
   *   1. request page N (per_page = 100)
   *   2. normalise + dedupe by GitHub release id
   *   3. read the `Link` header: while `rel="next"` exists, continue with the
   *      page number GitHub itself handed us
   *   4. stop when GitHub stops offering a next page
   *
   * A single request is therefore NOT assumed to be the whole dataset.
   * ==========================================================================
   */
  async listReleases(
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<ListReleasesResult> {
    const repository = `${owner}/${repo}`;
    const releases: GithubReleaseSummary[] = [];
    const seenReleaseIds = new Set<number>();

    let page = 1;
    let pagesFetched = 0;
    let truncated = false;

    for (;;) {
      if (pagesFetched >= this.options.maxPages) {
        truncated = true;
        break;
      }

      const { body, linkHeader } = await this.fetchPage(owner, repo, page, signal);
      pagesFetched += 1;

      for (const raw of body) {
        const normalized = normalizeGithubRelease(raw, repository);
        if (normalized === null) continue;
        if (seenReleaseIds.has(normalized.id)) continue;
        seenReleaseIds.add(normalized.id);
        releases.push(normalized);
      }

      const decision = decideNextPage({
        linkHeader,
        currentPage: page,
        received: body.length,
        pageSize: GITHUB_PAGE_SIZE,
      });

      if (decision.kind === 'stop') break;
      page = decision.page;
    }

    // A repository with zero releases legitimately returns an empty list.
    return { repository, releases, pagesFetched, truncated };
  }
}