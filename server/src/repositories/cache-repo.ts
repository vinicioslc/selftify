import { getDb } from "../db/connection";

export interface SearchResults {
  songs: unknown[];
  albums: unknown[];
  albumArtists: unknown[];
}

export interface CacheEntry {
  key: string;
  provider: string;
  query: string;
  songs: unknown[];
  albums: unknown[];
  albumArtists: unknown[];
  createdAt: number;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function searchKey(provider: string, query: string): string {
  return `${provider}:${normalizeQuery(query)}`;
}

interface SearchCacheRow {
  key: string;
  provider: string;
  query: string;
  results: string;
  created_at: number;
}

function rowToEntry(row: SearchCacheRow): CacheEntry {
  const parsed = JSON.parse(row.results) as SearchResults;
  return {
    key: row.key,
    provider: row.provider,
    query: row.query,
    songs: parsed.songs,
    albums: parsed.albums,
    albumArtists: parsed.albumArtists,
    createdAt: row.created_at,
  };
}

export function getSearchCache(provider: string, query: string): SearchResults | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM search_cache WHERE key = ?")
    .get(searchKey(provider, query)) as SearchCacheRow | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.results) as SearchResults;
  } catch {
    return null;
  }
}

export function setSearchCache(provider: string, query: string, results: SearchResults): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO search_cache (key, provider, query, results, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(searchKey(provider, query), provider, query, JSON.stringify(results), Date.now());
}

export function deleteSearchCache(key: string): void {
  getDb().prepare("DELETE FROM search_cache WHERE key = ?").run(key);
}

export function clearSearchCache(provider?: string): void {
  const db = getDb();
  if (provider) {
    db.prepare("DELETE FROM search_cache WHERE provider = ?").run(provider);
  } else {
    db.prepare("DELETE FROM search_cache").run();
  }
}

export function getAllSearchCacheEntries(): CacheEntry[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM search_cache ORDER BY created_at DESC").all() as SearchCacheRow[]).map(
    rowToEntry,
  );
}

export function pruneExpiredSearchCache(ttlMs: number): void {
  const db = getDb();
  db.prepare("DELETE FROM search_cache WHERE created_at < ?").run(Date.now() - ttlMs);
}

// ---- Query cache (MusicBrainz / YouTube HTTP response cache) ----

export type QueryPlatform = "musicbrainz" | "youtube";

export interface QueryCacheResult {
  queryHash: string;
  platform: QueryPlatform;
  originId: string;
  timestamp: number;
  ttl: number;
  results: unknown;
  raw?: unknown;
}

function queryCacheId(platform: QueryPlatform, queryHash: string): string {
  return `${platform}:${queryHash}`;
}

interface QueryCacheRow {
  id: string;
  platform: string;
  query_hash: string;
  timestamp: number;
  ttl: number;
  results: string;
  origin_id: string | null;
  raw: string | null;
}

export function getCachedQuery(platform: QueryPlatform, queryHash: string): QueryCacheResult | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM query_cache WHERE id = ?")
    .get(queryCacheId(platform, queryHash)) as QueryCacheRow | undefined;
  if (!row) return null;
  if (Date.now() - row.timestamp >= row.ttl) {
    db.prepare("DELETE FROM query_cache WHERE id = ?").run(row.id);
    return null;
  }
  return {
    queryHash: row.query_hash,
    platform: row.platform as QueryPlatform,
    originId: row.origin_id || "",
    timestamp: row.timestamp,
    ttl: row.ttl,
    results: JSON.parse(row.results),
    raw: row.raw ? JSON.parse(row.raw) : undefined,
  };
}

export function setCachedQuery(
  platform: QueryPlatform,
  queryHash: string,
  results: unknown,
  originId: string,
  raw?: Record<string, unknown>,
): void {
  const db = getDb();
  const ttl = platform === "musicbrainz" ? 604800000 : 3600000;
  db.prepare(
    `INSERT OR REPLACE INTO query_cache (id, platform, query_hash, timestamp, ttl, results, origin_id, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    queryCacheId(platform, queryHash),
    platform,
    queryHash,
    Date.now(),
    ttl,
    JSON.stringify(results),
    originId || null,
    raw ? JSON.stringify(raw) : null,
  );
}

export function clearQueryCache(platform?: QueryPlatform): void {
  const db = getDb();
  if (platform) {
    db.prepare("DELETE FROM query_cache WHERE platform = ?").run(platform);
  } else {
    db.prepare("DELETE FROM query_cache").run();
  }
}
