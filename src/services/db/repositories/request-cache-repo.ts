import { query, exec } from "../database";

export const REQUEST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export interface CachedResponse {
  cacheKey: string;
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  contentType: string;
  createdAt: number;
  expiresAt: number;
}

interface RequestCacheRow {
  cache_key: string;
  url: string;
  method: string;
  status: number;
  headers: string | null;
  body: Uint8Array | null;
  content_type: string | null;
  created_at: number;
  expires_at: number;
}

function rowToCachedResponse(row: RequestCacheRow): CachedResponse {
  return {
    cacheKey: row.cache_key,
    url: row.url,
    method: row.method,
    status: row.status,
    headers: row.headers ? JSON.parse(row.headers) : {},
    body: row.body || new Uint8Array(),
    contentType: row.content_type || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Retrieve a cached response. Returns null if the entry doesn't exist
 * or has expired (expired entries are deleted automatically).
 */
export function getCachedRequest(cacheKey: string): CachedResponse | null {
  const rows = query<RequestCacheRow>(
    "SELECT * FROM request_cache WHERE cache_key = ?",
    [cacheKey],
  );
  if (!rows.length) return null;

  const row = rows[0];
  if (Date.now() >= row.expires_at) {
    exec("DELETE FROM request_cache WHERE cache_key = ?", [cacheKey]);
    return null;
  }

  return rowToCachedResponse(row);
}

/**
 * Store a response in the cache with the standard TTL (30 min).
 * Only 2xx responses should be cached — callers MUST check before calling.
 */
export function setCachedRequest(
  cacheKey: string,
  url: string,
  method: string,
  status: number,
  headers: Record<string, string>,
  body: Uint8Array,
): void {
  const created_at = Date.now();
  const expires_at = created_at + REQUEST_CACHE_TTL;
  const contentType = headers["content-type"] || headers["Content-Type"] || "";

  exec(
    `INSERT OR REPLACE INTO request_cache
     (cache_key, url, method, status, headers, body, content_type, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cacheKey,
      url,
      method,
      status,
      JSON.stringify(headers),
      body,
      contentType,
      created_at,
      expires_at,
    ],
  );
}

/** Delete a single cache entry by key. */
export function deleteCachedRequest(cacheKey: string): void {
  exec("DELETE FROM request_cache WHERE cache_key = ?", [cacheKey]);
}

/** Clear all entries from the request cache. */
export function clearRequestCache(): void {
  exec("DELETE FROM request_cache");
}

/** Remove all expired entries from the request cache. */
export function pruneExpiredRequestCache(): void {
  exec("DELETE FROM request_cache WHERE expires_at < ?", [Date.now()]);
}
