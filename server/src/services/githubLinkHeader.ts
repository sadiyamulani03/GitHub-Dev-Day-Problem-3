/**
 * Parse GitHub's `Link` header to decide whether there is a next page and, if
 * so, what page number GitHub expects us to request.
 *
 * The header looks like:
 *   <https://api.github.com/repos/o/r/releases?page=2>; rel="next",
 *   <https://api.github.com/repos/o/r/releases?page=5>; rel="last"
 *
 * We only care about `rel="next"`. If it exists we extract its `page=` query
 * parameter and use that. If it does not exist we stop.
 */
export interface DecideNextPageInput {
  linkHeader: string | null;
  currentPage: number;
  received: number;
  pageSize: number;
}

export interface DecideNextPageStop {
  kind: 'stop';
}

export interface DecideNextPageContinue {
  kind: 'continue';
  page: number;
}

export type DecideNextPageResult = DecideNextPageStop | DecideNextPageContinue;

export function decideNextPage(input: DecideNextPageInput): DecideNextPageResult {
  const { linkHeader, currentPage, received, pageSize } = input;

  // If GitHub gave us fewer items than the page size, there cannot be a next page.
  if (received < pageSize) return { kind: 'stop' };

  if (!linkHeader) return { kind: 'stop' };

  // Parse the Link header: split on comma, then find the one with rel="next"
  const parts = linkHeader.split(',').map((p) => p.trim());
  for (const part of parts) {
    const match = /^<([^>]+)>;\s*rel="next"$/.exec(part);
    if (match) {
      const url = match[1];
      try {
        const parsed = new URL(url);
        const pageParam = parsed.searchParams.get('page');
        if (pageParam !== null) {
          const page = Number.parseInt(pageParam, 10);
          if (Number.isFinite(page) && page > currentPage) {
            return { kind: 'continue', page };
          }
        }
      } catch {
        // Malformed URL in Link header - fall through to stop.
      }
    }
  }

  return { kind: 'stop' };
}