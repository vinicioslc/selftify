export enum OriginType {
  LOCAL = "local",
  YOUTUBE = "youtube",
}

export enum PlayerStatus {
  PLAYING = "playing",
  PAUSED = "paused",
  STOPPED = "stopped",
}

export enum PlayerRepeat {
  NONE = "none",
  ALL = "all",
  ONE = "one",
}

export enum PlayerShuffle {
  NONE = "none",
  TRACK = "track",
  ALBUM = "album",
}

export enum LibraryItem {
  SONG = "song",
  ALBUM = "album",
  ALBUM_ARTIST = "albumArtist",
  ARTIST = "artist",
  PLAYLIST = "playlist",
  FOLDER = "folder",
  GENRE = "genre",
  RADIO = "radio",
}

export type Song = {
  id: string;
  originId: string;
  originType: OriginType;
  name: string;
  artistName: string;
  artistId?: string;
  albumArtistName?: string;
  albumName?: string;
  albumId?: string;
  albumArtistId?: string;
  trackNumber?: number;
  discNumber?: number;
  duration: number | null;
  bitrate?: number;
  imageUrl: string | null;
  path?: string;
  genres?: string[];
  releaseYear?: number;
  isVideo?: boolean;
  mbzRecordingId?: string;
  mbzTrackId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzAlbumId?: string;
  youtubeVideoId?: string;
  youtubeVideoTitle?: string;
  youtubeChannelName?: string;

  lyricsEmbedded?: string;
  lyricsPath?: string;
  lyricsCache?: string;
  lyricsCacheType?: "lrc" | "plain" | null;
};

export type Album = {
  id: string;
  originId: string;
  originType: OriginType;
  name: string;
  albumArtistName: string;
  songCount?: number;
  duration?: number;
  imageUrl: string | null;
  releaseYear?: number;
  genres?: string[];
  mbzId?: string;
  mbzReleaseGroupId?: string;
  mbzArtistId?: string;
};

export type AlbumArtist = {
  id: string;
  originId: string;
  originType: OriginType;
  name: string;
  albumCount?: number;
  songCount?: number;
  imageUrl: string | null;
  biography?: string;
  genres?: string[];
  mbz?: string;
};

export type Playlist = {
  id: string;
  originId: string;
  originType: OriginType;
  name: string;
  owner?: string;
  songCount?: number;
  duration?: number;
  imageUrl: string | null;
  public?: boolean;
  sourceUrl?: string;
  imported?: boolean;
  source?: string;
};

export type QueueSong = Song & {
  queueId: string;
  queueIndex: number;
};

export type Origin = {
  id: string;
  name: string;
  type: OriginType;
  folderPath?: string;
  downloadFolder?: string;
  enableOnlineSearch?: boolean;
  musicBrainzToken?: string;
  youtubeMusicHeaders?: string;
  organizeOnScan?: boolean;
  organizeDryRun?: boolean;
};

export type PlayQueueAddOptions = {
  type: "now" | "next" | "last" | "shuffle";
  byStartIndex?: boolean;
  startIndex?: number;
};

export type StreamSourceCandidate = {
  type: "local";
  song: Song;
  filePath: string;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  fileExtension?: string;
};

export enum DownloadStatus {
  PENDING = "pending",
  SEARCHING = "searching",
  DOWNLOADING_AUDIO = "downloading-audio",
  GETTING_COVER = "getting-cover",
  PROCESSING_COVER = "processing-cover",
  EMBEDDING_COVER = "embedding-cover",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export type DownloadTask = {
  id: string;
  song: Song;
  status: DownloadStatus;
  progress: number;
  stepLabel: string;
  error?: string;
  videoId?: string;
  audioPath?: string;
  coverPath?: string;
  createdAt: number;
  completedAt?: number;
};
