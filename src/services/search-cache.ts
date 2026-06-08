import Dexie, { type EntityTable } from "dexie";
import type { Song, Album, AlbumArtist } from "../types/domain-types";
import type { SearchResults } from "../api/controller";

export type CacheEntry = {
  key: string;
  provider: string;
  query: string;
  songs: string;
  albums: string;
  albumArtists: string;
  createdAt: number;
};

export type SelectionType = "auto" | "manual" | "custom";

export type StreamSourceCandidate = {
  type: "local";
  song: Song;
  filePath: string;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  fileExtension?: string;
};

export type CandidateData = {
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
  exactDuration: boolean;
  closestDuration: boolean;
  keywordScore: number;
  diff: number;
  source: "ranking" | "custom";
};

export type MbzYtMapping = {
  mbzRecordingId: string;
  // Song metadata (denormalized for display)
  songName: string;
  artistName: string;
  albumName?: string;
  albumImageUrl?: string | null;
  // Current selection
  selectedVideoId: string;
  selectedType: SelectionType;
  // All candidates from last ranking
  candidates: string;  // JSON.stringify(CandidateData[])
  // Custom URL (if selectedType === "custom")
  customVideoId?: string;
  customVideoUrl?: string;
  // Local source preference (unified-stream-resolution)
  selectedSource?: "local" | "youtube";
  localSongId?: string;
  // Timestamps
  createdAt: number;
  updatedAt: number;
};

export type RankingLogEntry = {
  id?: number;
  query: string;
  winnerId: string;
  winnerTitle: string;
  winnerUploader: string;
  score: number;
  scores: string;
  candidates: number;
  createdAt: number;
};

class CacheDb extends Dexie {
  search_cache!: EntityTable<CacheEntry, "key">;
  mbz_yt_mapping!: EntityTable<MbzYtMapping, "mbzRecordingId">;
  ranking_log!: EntityTable<RankingLogEntry, "id">;

  constructor() {
    super("selftify-cache");
    this.version(1).stores({
      search_cache: "key, provider, createdAt",
      mbz_yt_mapping: "mbzRecordingId, lastUsedAt",
      ranking_log: "++id, createdAt",
    });
  }
}

const cacheDb = new CacheDb();

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(provider: string, query: string): string {
  return `${provider}:${normalizeQuery(query)}`;
}

export async function getSearchCache(provider: string, query: string): Promise<SearchResults | null> {
  const row = await cacheDb.search_cache.get(cacheKey(provider, query));
  if (!row) return null;
  return {
    songs: JSON.parse(row.songs) as Song[],
    albums: JSON.parse(row.albums) as Album[],
    albumArtists: JSON.parse(row.albumArtists) as AlbumArtist[],
  };
}

export async function setSearchCache(provider: string, query: string, results: SearchResults): Promise<void> {
  await cacheDb.search_cache.put({
    key: cacheKey(provider, query),
    provider,
    query: normalizeQuery(query),
    songs: JSON.stringify(results.songs),
    albums: JSON.stringify(results.albums),
    albumArtists: JSON.stringify(results.albumArtists),
    createdAt: Date.now(),
  });
}

export async function clearSearchCache(provider?: string): Promise<void> {
  if (provider) {
    await cacheDb.search_cache.where("provider").equals(provider).delete();
  } else {
    await cacheDb.search_cache.clear();
  }
}

export async function deleteSearchCache(key: string): Promise<void> {
  await cacheDb.search_cache.delete(key);
}

export async function getAllSearchCacheEntries(): Promise<CacheEntry[]> {
  return cacheDb.search_cache.toArray();
}

export async function getMbzYtMapping(mbzRecordingId: string): Promise<MbzYtMapping | null> {
  return (await cacheDb.mbz_yt_mapping.get(mbzRecordingId)) || null;
}

export async function setMbzYtMapping(mapping: MbzYtMapping): Promise<void> {
  await cacheDb.mbz_yt_mapping.put(mapping);
}

export async function deleteMbzYtMapping(mbzRecordingId: string): Promise<void> {
  await cacheDb.mbz_yt_mapping.delete(mbzRecordingId);
}

export async function getAllMbzYtMappings(): Promise<MbzYtMapping[]> {
  return cacheDb.mbz_yt_mapping.toArray();
}

export async function recordRanking(entry: Omit<RankingLogEntry, "id">): Promise<void> {
  await cacheDb.ranking_log.add(entry as RankingLogEntry);
}

export async function getRecentRankings(limit = 50): Promise<RankingLogEntry[]> {
  return cacheDb.ranking_log
    .orderBy("createdAt")
    .reverse()
    .limit(limit)
    .toArray();
}

export async function clearRankingLog(): Promise<void> {
  await cacheDb.ranking_log.clear();
}

export async function clearAllMbzYtMappings(): Promise<void> {
  await cacheDb.mbz_yt_mapping.clear();
}

export async function pruneExpiredCache(ttlMs: number): Promise<void> {
  const cutoff = Date.now() - ttlMs;
  await cacheDb.search_cache.where("createdAt").below(cutoff).delete();
}
