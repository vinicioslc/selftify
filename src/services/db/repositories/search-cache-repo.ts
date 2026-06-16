import { query as dbQuery, exec } from "../database";
import type { Song, Album, AlbumArtist } from "../../../types/domain-types";

interface SearchCacheRow {
  key: string;
  provider: string;
  query: string;
  results: string;
  created_at: number;
}

export type SearchResults = {
  songs: Song[];
  albums: Album[];
  albumArtists: AlbumArtist[];
};

export interface CacheEntry {
  key: string;
  provider: string;
  query: string;
  songs: Song[];
  albums: Album[];
  albumArtists: AlbumArtist[];
  createdAt: number;
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
  const key = `${provider}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const rows = dbQuery<SearchCacheRow>("SELECT * FROM search_cache WHERE key = ?", [key]);
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].results) as SearchResults;
  } catch {
    return null;
  }
}

export function setSearchCache(provider: string, query: string, results: SearchResults): void {
  const key = `${provider}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  exec(
    `INSERT OR REPLACE INTO search_cache (key, provider, query, results, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [key, provider, query, JSON.stringify(results), Date.now()],
  );
}

export function deleteSearchCache(key: string): void {
  exec("DELETE FROM search_cache WHERE key = ?", [key]);
}

export function clearSearchCache(provider?: string): void {
  if (provider) {
    exec("DELETE FROM search_cache WHERE provider = ?", [provider]);
  } else {
    exec("DELETE FROM search_cache");
  }
}

export function getAllSearchCacheEntries(): CacheEntry[] {
  return dbQuery<SearchCacheRow>("SELECT * FROM search_cache ORDER BY created_at DESC").map(rowToEntry);
}

export function pruneExpiredCache(ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  exec("DELETE FROM search_cache WHERE created_at < ?", [cutoff]);
}
