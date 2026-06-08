/**
 * In-memory search results cache.
 *
 * Avoids redundant requests within a session by caching results keyed by
 * `(provider, normalizedQuery)`. Also deduplicates in-flight requests so
 * clicking search twice for the same query only fires one network call.
 *
 * Providers used in this app:
 *   - "local"          — local file search
 *   - "musicbrainz"    — MusicBrainz recordings/albums/artists
 *   - "youtube"        — YouTube Pure song search
 */

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

// ── Types ──────────────────────────────────────────────────────────────────

type TimestampedEntry<T> = {
  data: T;
  timestamp: number;
};

// ── Storage ────────────────────────────────────────────────────────────────

/** Resolved results cache: provider:query → { data, timestamp } */
const resultsCache = new Map<string, TimestampedEntry<unknown>>();

/** In-flight request dedup: provider:query → Promise */
const pendingRequests = new Map<string, Promise<unknown>>();

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Compound key like `"musicbrainz:the beatles"` */
function cacheKey(provider: string, query: string): string {
  return `${provider}:${normalizeQuery(query)}`;
}

function isValid<T>(entry: TimestampedEntry<T> | undefined): entry is TimestampedEntry<T> {
  return !!entry && Date.now() - entry.timestamp < DEFAULT_TTL;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Return cached results for `(provider, query)`, or `null` if not cached or
 * the TTL has expired.
 */
export function getCachedResult<T>(provider: string, query: string): T | null {
  const key = cacheKey(provider, query);
  const entry = resultsCache.get(key) as TimestampedEntry<T> | undefined;
  if (!isValid(entry)) {
    if (resultsCache.has(key)) resultsCache.delete(key); // expired
    return null;
  }
  return entry.data;
}

/**
 * Store results in memory for `(provider, query)`.
 */
export function setCachedResult<T>(provider: string, query: string, data: T): void {
  const key = cacheKey(provider, query);
  resultsCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Return the in-flight promise for `(provider, query)`, or `null` if none.
 */
export function getPendingRequest<T>(provider: string, query: string): Promise<T> | null {
  const key = cacheKey(provider, query);
  return (pendingRequests.get(key) as Promise<T> | undefined) ?? null;
}

/**
 * Register a pending request for `(provider, query)`.
 * The pending slot is automatically cleaned up when the promise settles.
 */
export function setPendingRequest<T>(provider: string, query: string, promise: Promise<T>): void {
  const key = cacheKey(provider, query);
  pendingRequests.set(key, promise);
  promise.finally(() => {
    // Only clear if our promise is still the one stored (avoid clearing a
    // newer promise that was set after ours settled).
    if (pendingRequests.get(key) === promise) {
      pendingRequests.delete(key);
    }
  });
}

/**
 * Clear the memory cache. If `provider` is given, only entries for that
 * provider are removed.
 */
export function clearMemoryCache(provider?: string): void {
  if (provider) {
    const prefix = `${provider}:`;
    for (const key of resultsCache.keys()) {
      if (key.startsWith(prefix)) {
        resultsCache.delete(key);
      }
      if (pendingRequests.has(key) && key.startsWith(prefix)) {
        pendingRequests.delete(key);
      }
    }
  } else {
    resultsCache.clear();
    pendingRequests.clear();
  }
}
