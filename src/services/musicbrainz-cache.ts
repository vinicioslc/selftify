import { db as selftifyDb } from "./local-database";
import type { MbzMetadataCache, MbzSearchCache } from "./local-database-types";

const SEARCH_TTL_MS = 5 * 60 * 1000;
const METADATA_LRU_MAX = 500;
const SEARCH_LRU_MAX = 200;

type LruEntry<T> = { data: T; ts: number };

const metadataLru = new Map<string, LruEntry<object>>();
const searchLru = new Map<string, LruEntry<object>>();

function lruSet<K, V>(map: Map<K, LruEntry<V>>, key: K, value: V, max: number) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { data: value, ts: Date.now() });
}

function lruGet<K, V>(map: Map<K, LruEntry<V>>, key: K): V | null {
  const entry = map.get(key);
  if (!entry) return null;
  entry.ts = Date.now();
  return entry.data;
}

export function hashSearchQuery(params: Record<string, unknown>): string {
  const sorted = Object.keys(params).sort().map((k) => `${k}:${JSON.stringify(params[k])}`).join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const chr = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return "q_" + Math.abs(hash).toString(36);
}

export async function getCachedMetadata<T extends object>(key: string): Promise<T | null> {
  const lru = lruGet(metadataLru, key);
  if (lru) return lru as T;

  try {
    const row = await selftifyDb.mbz_metadata_cache.get(key);
    if (row) {
      const data = JSON.parse(row.data) as T;
      lruSet(metadataLru, key, data, METADATA_LRU_MAX);
      return data;
    }
  } catch {}

  return null;
}

export async function setCachedMetadata(key: string, data: object): Promise<void> {
  lruSet(metadataLru, key, data, METADATA_LRU_MAX);

  try {
    await selftifyDb.mbz_metadata_cache.put({
      key,
      data: JSON.stringify(data),
      cached_at: Date.now(),
    });
  } catch {}
}

export async function getCachedSearch<T extends object>(queryHash: string): Promise<T | null> {
  const lru = lruGet(searchLru, queryHash);
  if (lru) return lru as T;

  try {
    const row = await selftifyDb.mbz_search_cache.get(queryHash);
    if (row && Date.now() < row.expires_at) {
      const data = JSON.parse(row.data) as T;
      lruSet(searchLru, queryHash, data, SEARCH_LRU_MAX);
      return data;
    }
    if (row) {
      await selftifyDb.mbz_search_cache.delete(queryHash);
    }
  } catch {}

  return null;
}

export async function setCachedSearch(queryHash: string, data: object): Promise<void> {
  lruSet(searchLru, queryHash, data, SEARCH_LRU_MAX);

  try {
    await selftifyDb.mbz_search_cache.put({
      key: queryHash,
      data: JSON.stringify(data),
      expires_at: Date.now() + SEARCH_TTL_MS,
    });
  } catch {}
}

export async function clearExpiredSearchCache(): Promise<void> {
  try {
    const expired = await selftifyDb.mbz_search_cache
      .where("expires_at")
      .below(Date.now())
      .toArray();
    for (const row of expired) {
      await selftifyDb.mbz_search_cache.delete(row.key);
    }
  } catch {}
}

export async function clearAllCaches(): Promise<void> {
  metadataLru.clear();
  searchLru.clear();
  try {
    await selftifyDb.mbz_metadata_cache.clear();
    await selftifyDb.mbz_search_cache.clear();
  } catch {}
}
