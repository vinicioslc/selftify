export enum LyricSource {
  LRCLIB = "lrclib.net",
  NETEASE = "NetEase",
}

export type SynchronizedLyricsArray = Array<[number, string]>;

export type LyricsResponse = string | SynchronizedLyricsArray;

export type LyricSearchQuery = {
  album?: string;
  artist?: string;
  duration?: number;
  name?: string;
};

export type LyricSearchResult = {
  artist: string;
  id: string;
  isSync: boolean | null;
  name: string;
  score?: number;
  source: LyricSource;
};

export type LyricGetQuery = {
  remoteSongId: string;
  remoteSource: LyricSource;
};

export type LyricOverride = {
  artist: string;
  id: string;
  name: string;
  remote: boolean;
  source: string;
};

export type FullLyricsMetadata = {
  artist: string;
  lyrics: LyricsResponse;
  name: string;
  offsetMs?: number;
  remote: boolean;
  source: string;
};

export type LyricsQueryResult = {
  local: FullLyricsMetadata | null;
  overrideData: LyricsResponse | null;
  overrideSelection: LyricOverride | null;
  remoteAuto: FullLyricsMetadata | null;
  selected: FullLyricsMetadata | null;
  selectedOffsetMs: number;
  selectedSynced: boolean;
  suppressRemoteAuto: boolean;
};
