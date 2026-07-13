/**
 * backend-state.ts
 *
 * Client for the Selftify backend's state endpoints. This replaces the
 * renderer-side `services/db` + `services/sqlite-db` modules: the backend is
 * now the single owner of all cross-origin state (mbz↔yt mappings, ranking
 * log, search/query caches, online-search config). The frontend calls these
 * dedicated routes and never touches sql.js directly.
 *
 * See specs/migration-client-server.md (Phases 1-5).
 */
import { API_BASE } from "./base";
import { useBackendStore } from "../stores/backend.store";
import type { Song, Album, AlbumArtist } from "../types/domain-types";
import type { SearchResults as ControllerSearchResults } from "./controller";

export interface MbzYtMapping {
  mbzRecordingId: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumImageUrl?: string | null;
  selectedVideoId?: string | null;
  selectedType?: "auto" | "manual" | "custom";
  selectedSource?: "local" | "youtube";
  localSongId?: string;
  customVideoId?: string;
  customVideoUrl?: string;
  candidates: CandidateData[];
  createdAt: number;
  updatedAt: number;
}

export interface CandidateData {
  videoId: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnailUrl?: string | null;
  score: number;
  titleMatch: boolean;
  artistMatch: boolean;
  albumMatch: boolean;
  artistOnChannel: boolean;
  channelExactMatch: boolean;
  isCover: boolean;
  exactDuration: boolean;
  closestDuration: boolean;
  keywordScore: number;
  diff: number;
  source: "ranking" | "custom";
}

export interface RankingLogEntry {
  id: string;
  query: string;
  winnerId: string;
  winnerTitle: string;
  winnerUploader: string;
  score: number;
  scores: string;
  candidates: number;
  createdAt: number;
}

export type SearchResults = ControllerSearchResults;

export interface CacheEntry {
  key: string;
  provider: string;
  query: string;
  songs: Song[];
  albums: Album[];
  albumArtists: AlbumArtist[];
  createdAt: number;
}

export type QueryPlatform = "musicbrainz" | "youtube";

function baseUrl(): string {
  const bc = useBackendStore.getState().config;
  if (bc && bc.type === "selftify") return bc.url;
  return API_BASE;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl()}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function send(method: string, path: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- MusicBrainz <-> YouTube mappings ----

export async function getMbzYtMapping(mbzRecordingId: string): Promise<MbzYtMapping | null> {
  const data = await getJson<{ mapping: MbzYtMapping | null }>(
    `/api/mbz/mapping?recordingId=${encodeURIComponent(mbzRecordingId)}`,
  );
  return data?.mapping ?? null;
}

export async function setMbzYtMapping(mapping: MbzYtMapping): Promise<void> {
  await send("PUT", "/api/mbz/mapping", mapping);
}

export async function deleteMbzYtMapping(mbzRecordingId: string): Promise<void> {
  await send("DELETE", `/api/mbz/mapping?recordingId=${encodeURIComponent(mbzRecordingId)}`);
}

export async function getAllMbzYtMappings(): Promise<MbzYtMapping[]> {
  const data = await getJson<{ mappings: MbzYtMapping[] }>(`/api/mbz/mapping/all`);
  return data?.mappings ?? [];
}

export async function clearAllMbzYtMappings(): Promise<void> {
  await send("DELETE", "/api/mbz/mapping/all");
}

// Kept for drop-in compatibility with existing call sites.
export async function getSavedMbzYtMapping(mbzRecordingId: string): Promise<MbzYtMapping | null> {
  return getMbzYtMapping(mbzRecordingId);
}
export async function setSavedMbzYtMapping(mapping: MbzYtMapping): Promise<void> {
  return setMbzYtMapping(mapping);
}
export async function deleteSavedMbzYtMapping(mbzRecordingId: string): Promise<void> {
  return deleteMbzYtMapping(mbzRecordingId);
}
export async function getAllSavedMbzYtMappings(): Promise<MbzYtMapping[]> {
  return getAllMbzYtMappings();
}
export async function clearAllSavedMbzYtMappings(): Promise<void> {
  return clearAllMbzYtMappings();
}

// ---- Ranking log ----

export async function recordRanking(
  entry: Omit<RankingLogEntry, "createdAt" | "id">,
): Promise<void> {
  await send("POST", "/api/ranking/log", entry);
}

export async function getRecentRankings(limit = 50): Promise<RankingLogEntry[]> {
  const data = await getJson<{ entries: RankingLogEntry[] }>(
    `/api/ranking/log?limit=${limit}`,
  );
  return data?.entries ?? [];
}

export async function clearRankingLog(): Promise<void> {
  await send("DELETE", "/api/ranking/log");
}

// ---- Search cache ----

export async function getSearchCache(
  provider: string,
  query: string,
): Promise<SearchResults | null> {
  const data = await getJson<{ results: SearchResults | null }>(
    `/api/cache/search?provider=${encodeURIComponent(provider)}&query=${encodeURIComponent(query)}`,
  );
  return data?.results ?? null;
}

export async function setSearchCache(
  provider: string,
  query: string,
  results: SearchResults,
): Promise<void> {
  await send("PUT", "/api/cache/search", { provider, query, results });
}

export async function deleteSearchCache(key?: string): Promise<void> {
  const qs = key ? `?key=${encodeURIComponent(key)}` : "";
  await send("DELETE", `/api/cache/search${qs}`);
}

export async function getAllSearchCacheEntries(): Promise<CacheEntry[]> {
  const data = await getJson<{ entries: CacheEntry[] }>(`/api/cache/search/all`);
  return data?.entries ?? [];
}

export async function clearSearchCache(provider?: string): Promise<void> {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  await send("DELETE", `/api/cache/search${qs}`);
}

export async function pruneExpiredCache(_ttlMs?: number): Promise<void> {
  // Server enforces TTL on read; nothing to prune client-side.
}

// ---- Query cache (MusicBrainz / YouTube) ----

export async function hashQuery(query: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(query);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedQuery(
  platform: QueryPlatform,
  query: string,
): Promise<{ results: unknown } | null> {
  const data = await getJson<{ result: { results: unknown } | null }>(
    `/api/cache/query?platform=${platform}&query=${encodeURIComponent(query)}`,
  );
  return data?.result ?? null;
}

export async function setCachedQuery(
  platform: QueryPlatform,
  query: string,
  results: unknown,
  originId: string,
  raw?: Record<string, unknown>,
): Promise<void> {
  await send("PUT", "/api/cache/query", { platform, query, results, originId, raw });
}
