import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";
import type { Song, Album, AlbumArtist } from "../../types/domain-types";
import type { SearchResults } from "../../api/controller";
import { initDatabase, isReady } from "../db/database";
import * as searchCacheRepo from "../db/repositories/search-cache-repo";
import type { CacheEntry } from "../db/repositories/search-cache-repo";

const LS_PREFIX = "selftify:search-cache:";
const LS_TTL = 7 * 24 * 60 * 60 * 1000;

function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
}

async function ensureDb(): Promise<boolean> {
  if (isReady()) return true;
  const root = getLibraryRoot();
  if (!root) return false;
  try {
    await initDatabase(root);
    return isReady();
  } catch {
    return false;
  }
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(provider: string, query: string): string {
  return `${provider}:${normalizeQuery(query)}`;
}

function lsKey(provider: string, query: string): string {
  return `${LS_PREFIX}${provider}:${normalizeQuery(query)}`;
}

function readLsCache(provider: string, query: string): SearchResults | null {
  try {
    const raw = localStorage.getItem(lsKey(provider, query));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { createdAt: number; data: SearchResults };
    if (Date.now() - entry.createdAt > LS_TTL) {
      localStorage.removeItem(lsKey(provider, query));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeLsCache(provider: string, query: string, data: SearchResults): void {
  try {
    const entry = { createdAt: Date.now(), data };
    localStorage.setItem(lsKey(provider, query), JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable
  }
}

function clearLsCache(provider?: string): void {
  try {
    const prefix = provider ? `${LS_PREFIX}${provider}:` : LS_PREFIX;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // best effort
  }
}

export async function getSearchCache(provider: string, query: string): Promise<SearchResults | null> {
  // 1. Try SQLite (requires LOCAL origin)
  const ready = await ensureDb();
  if (ready) {
    try {
      const result = searchCacheRepo.getSearchCache(provider, query);
      if (result) return result;
    } catch {
      // fall through
    }
  }

  // 2. Fallback: localStorage (works with any origin type)
  return readLsCache(provider, query);
}

export async function setSearchCache(provider: string, query: string, results: SearchResults): Promise<void> {
  // 1. Try SQLite (requires LOCAL origin)
  const ready = await ensureDb();
  if (ready) {
    try {
      searchCacheRepo.setSearchCache(provider, query, results);
      return;
    } catch (err) {
      console.warn("[sqlite-db-search-store] SQLite write failed:", err);
    }
  }

  // 2. Fallback: localStorage (works with any origin type)
  writeLsCache(provider, query, results);
}

export async function clearSearchCache(provider?: string): Promise<void> {
  // 1. Clear SQLite cache
  const ready = await ensureDb();
  if (ready) {
    try {
      searchCacheRepo.clearSearchCache(provider);
    } catch {
      // fall through
    }
  }

  // 2. Clear localStorage cache
  clearLsCache(provider);
}

export async function deleteSearchCache(key: string): Promise<void> {
  const ready = await ensureDb();
  if (ready) {
    try {
      searchCacheRepo.deleteSearchCache(key);
    } catch {
      // fall through
    }
  }
}

export async function getAllSearchCacheEntries(): Promise<CacheEntry[]> {
  const ready = await ensureDb();
  if (!ready) return [];
  try {
    return searchCacheRepo.getAllSearchCacheEntries();
  } catch {
    return [];
  }
}

export async function pruneExpiredCache(ttlMs: number): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  try {
    searchCacheRepo.pruneExpiredCache(ttlMs);
  } catch (err) {
    console.error("[sqlite-db-search-store] prune error:", err);
  }
}

export async function clearAllSearchCaches(libraryRoot: string): Promise<void> {
  const ready = isReady();
  if (!ready) await initDatabase(libraryRoot).catch(() => {});
  try {
    searchCacheRepo.clearSearchCache();
  } catch {
    // best effort
  }
}

export type { CacheEntry } from "../db/repositories/search-cache-repo";
