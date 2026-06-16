import type { Song } from "../../types/domain-types";

export type SqliteDbSchemaVersion = 1;

export interface SqliteDbImage {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
  format: "image/jpeg" | "image/png" | "image/webp";
}

export interface SqliteDbArtistMeta {
  $schema: "selftify-artist";
  version: SqliteDbSchemaVersion;
  name: string;
  sortName: string | null;
  mbzId: string | null;
  biography: string | null;
  genres: string[];
  country: string | null;
  type: string | null;
  disambiguation: string | null;
  images: SqliteDbImage[];
  updatedAt: number;
  enrichedAt: number | null;
}

export interface SqliteDbAlbumTrack {
  path: string;
  name: string;
  artistName: string;
  albumName: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number | null;
  genre: string | null;
  mbzRecordingId: string | null;
  mbzTrackId: string | null;
  youtubeCandidates?: YouTubeCandidate[];
}

export interface YouTubeCandidate {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnailUrl: string | null;
  score: number;
  titleMatch: boolean;
  artistMatch: boolean;
  albumMatch: boolean;
  artistOnChannel: boolean;
  exactDuration: boolean;
  closestDuration: boolean;
  keywordScore: number;
  source: "ranking" | "custom";
  selected: boolean;
  selectedAt: number | null;
}

export interface SqliteDbAlbumMeta {
  $schema: "selftify-album";
  version: SqliteDbSchemaVersion;
  name: string;
  artistName: string;
  albumArtist: string | null;
  releaseYear: number | null;
  mbzId: string | null;
  mbzReleaseGroupId: string | null;
  genres: string[];
  images: SqliteDbImage[];
  songCount: number;
  duration: number;
  tracks: SqliteDbAlbumTrack[];
  updatedAt: number;
  enrichedAt: number | null;
}

export interface SqliteDbSearchResultItem {
  id: string;
  name: string;
  artistName: string;
  albumName: string | null;
  imageUrl: string | null;
}

export interface SqliteDbQueryCache {
  query: string;
  queryHash: string;
  platform: "musicbrainz" | "youtube";
  originId: string;
  timestamp: number;
  ttl: number;
  results: {
    songs: SqliteDbSearchResultItem[];
    albums: SqliteDbSearchResultItem[];
    albumArtists: SqliteDbSearchResultItem[];
  };
  raw?: Record<string, unknown>;
}

export interface SqliteDbConfig {
  version: SqliteDbSchemaVersion;
  libraryName: string;
  createdAt: number;
  lastScanAt: number | null;
  scanStatus: "idle" | "scanning" | "done" | "error";
  songCount: number;
  artistCount: number;
  albumCount: number;
}

// ── Search Cache & Mapping Types ──

export type SelectionType = "auto" | "manual" | "custom";

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
  exactDuration: boolean;
  closestDuration: boolean;
  keywordScore: number;
  diff: number;
  source: "ranking" | "custom";
}

export interface SqliteDbMbzYtMapping {
  mbzRecordingId: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumImageUrl?: string | null;
  selectedVideoId?: string;
  selectedType?: SelectionType;
  candidates: CandidateData[];
  customVideoId?: string;
  customVideoUrl?: string;
  selectedSource?: "local" | "youtube";
  localSongId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SqliteDbRankingLogEntry {
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

export type StreamSourceCandidate = {
  type: "local";
  song: Song;
  filePath: string;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  fileExtension?: string;
};

// ── Directory Constants ──

export const NAME_ARTIST = ".selftify.json";
export const NAME_ALBUM = ".selftify.json";
export const NAME_ROOT = "config.json";
export const DIR_SELFTIFY = ".selftify";
export const DIR_QUERIES = "queries";
export const DIR_QUERIES_MB = "queries/musicbrainz";
export const DIR_QUERIES_YT = "queries/youtube";
export const DIR_IMAGES = "images";
export const DIR_IMAGES_ARTIST = "images/artist";
export const DIR_IMAGES_ALBUM = "images/album";
export const DIR_IMAGES_QUERY = "images/query";
export const DIR_MAPPINGS = "mappings";
export const DIR_RANKING_LOG = "ranking-log";
export const DIR_SEARCH_CACHE = "search-cache";
