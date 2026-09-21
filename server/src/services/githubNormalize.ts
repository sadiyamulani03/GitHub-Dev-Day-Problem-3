/**
 * Normalisation of raw GitHub release data into the shape our application uses.
 *
 * We only keep the fields we actually need and we validate that the required
 * ones are present. If GitHub returns something unexpected we return `null`
 * for that release so it is silently dropped rather than crashing the pipeline.
 */
export interface RawGithubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author?: {
    login: string;
    id: number;
  };
  assets?: Array<{
    id: number;
    name: string;
    browser_download_url: string;
  }>;
  body: string | null;
}

export interface GithubReleaseSummary {
  id: number;
  tag: string;
  name: string | null;
  url: string;
  repository: string;
  publishedAt: string;
  isDraft: boolean;
  isPrerelease: boolean;
}

/**
 * Convert a raw GitHub release into our internal summary type.
 * Returns `null` if required fields are missing or malformed.
 */
export function normalizeGithubRelease(
  raw: RawGithubRelease,
  repository: string,
): GithubReleaseSummary | null {
  // GitHub release IDs are globally unique integers.
  const id = typeof raw.id === 'number' && Number.isFinite(raw.id) ? raw.id : null;
  if (id === null) return null;

  const tag = typeof raw.tag_name === 'string' && raw.tag_name.length > 0 ? raw.tag_name : null;
  if (tag === null) return null;

  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null;

  const url = typeof raw.html_url === 'string' && raw.html_url.length > 0 ? raw.html_url : null;
  if (url === null) return null;

  const publishedAt =
    typeof raw.published_at === 'string' && raw.published_at.length > 0
      ? raw.published_at
      : typeof raw.created_at === 'string' && raw.created_at.length > 0
        ? raw.created_at
        : null;
  if (publishedAt === null) return null;

  const isDraft = raw.draft === true;
  const isPrerelease = raw.prerelease === true;

  return {
    id,
    tag,
    name,
    url,
    repository: repository.toLowerCase(),
    publishedAt,
    isDraft,
    isPrerelease,
  };
}