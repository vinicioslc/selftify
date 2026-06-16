import type { SqliteDbQueryCache, SqliteDbSearchResultItem } from "./sqlite-db-types";
import { initDatabase, isReady } from "../db/database";
import * as queryCacheRepo from "../db/repositories/query-cache-repo";

export const TTL_MUSICBRAINZ = 604800000;
export const TTL_YOUTUBE = 3600000;

export type QueryPlatform = "musicbrainz" | "youtube";

export async function hashQuery(query: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(query);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedQuery(
  libraryRoot: string,
  platform: QueryPlatform,
  query: string,
): Promise<SqliteDbQueryCache | null> {
  const ready = isReady();
  if (!ready) await initDatabase(libraryRoot).catch(() => {});
  if (!isReady()) return null;
  try {
    const queryHash = await hashQuery(query);
    return queryCacheRepo.getCachedQuery(libraryRoot, platform, queryHash);
  } catch {
    return null;
  }
}

export async function setCachedQuery(
  libraryRoot: string,
  platform: QueryPlatform,
  query: string,
  results: { songs: SqliteDbSearchResultItem[]; albums: SqliteDbSearchResultItem[]; albumArtists: SqliteDbSearchResultItem[] },
  originId: string,
  raw?: Record<string, unknown>,
): Promise<void> {
  const ready = isReady();
  if (!ready) await initDatabase(libraryRoot).catch(() => {});
  if (!isReady()) return;
  try {
    const queryHash = await hashQuery(query);
    queryCacheRepo.setCachedQuery(libraryRoot, platform, queryHash, results, originId, raw);
  } catch (err) {
    console.error("[sqlite-db-query] set error:", err);
  }
}
