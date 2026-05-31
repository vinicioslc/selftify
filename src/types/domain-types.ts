export enum OriginType {
  LOCAL = "local",
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
  imageUrl: string | null;
  path?: string;
  genres?: string[];
  releaseYear?: number;
  isVideo?: boolean;
  mbzRecordingId?: string;
  mbzTrackId?: string;
  mbzArtistId?: string;
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
};

export type PlayQueueAddOptions = {
  type: "now" | "next" | "last" | "shuffle";
  byStartIndex?: boolean;
  startIndex?: number;
};
