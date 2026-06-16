import { query, exec } from "../database";
import type { SqliteDbQueryCache, SqliteDbSearchResultItem } from "../../sqlite-db/sqlite-db-types";

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

export type QueryPlatform = "musicbrainz" | "youtube";

export function getCachedQuery(libraryRoot: string, platform: QueryPlatform, queryHash: string): SqliteDbQueryCache | null {
  const id = `${libraryRoot}:${platform}:${queryHash}`;
  const rows = query<QueryCacheRow>("SELECT * FROM query_cache WHERE id = ?", [id]);
  if (!rows.length) return null;
  const r = rows[0];
  if (Date.now() - r.timestamp >= r.ttl) {
    exec("DELETE FROM query_cache WHERE id = ?", [id]);
    return null;
  }
  return {
    query: "",
    queryHash: r.query_hash,
    platform: r.platform as QueryPlatform,
    originId: r.origin_id || "",
    timestamp: r.timestamp,
    ttl: r.ttl,
    results: JSON.parse(r.results),
    raw: r.raw ? JSON.parse(r.raw) : undefined,
  };
}

export function setCachedQuery(
  libraryRoot: string,
  platform: QueryPlatform,
  queryHash: string,
  results: { songs: SqliteDbSearchResultItem[]; albums: SqliteDbSearchResultItem[]; albumArtists: SqliteDbSearchResultItem[] },
  originId: string,
  raw?: Record<string, unknown>,
): void {
  const ttl = platform === "musicbrainz" ? 604800000 : 3600000;
  const id = `${libraryRoot}:${platform}:${queryHash}`;
  exec(
    `INSERT OR REPLACE INTO query_cache (id, platform, query_hash, timestamp, ttl, results, origin_id, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, platform, queryHash, Date.now(), ttl, JSON.stringify(results), originId, raw ? JSON.stringify(raw) : null],
  );
}

export function clearQueryCache(platform?: QueryPlatform): void {
  if (platform) {
    exec("DELETE FROM query_cache WHERE platform = ?", [platform]);
  } else {
    exec("DELETE FROM query_cache");
  }
}
