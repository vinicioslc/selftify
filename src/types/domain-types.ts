export enum ServerType {
  JELLYFIN = "jellyfin",
  NAVIDROME = "navidrome",
  SUBISONIC = "subsonic",
  YOUTUBE_MUSIC = "youtubemusic",
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
  serverId: string;
  serverType: ServerType;
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
};

export type Album = {
  id: string;
  serverId: string;
  serverType: ServerType;
  name: string;
  albumArtistName: string;
  songCount?: number;
  duration?: number;
  imageUrl: string | null;
  releaseYear?: number;
  genres?: string[];
};

export type AlbumArtist = {
  id: string;
  serverId: string;
  serverType: ServerType;
  name: string;
  albumCount?: number;
  songCount?: number;
  imageUrl: string | null;
  biography?: string;
  genres?: string[];
};

export type Playlist = {
  id: string;
  serverId: string;
  serverType: ServerType;
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

export type ServerListItem = {
  id: string;
  name: string;
  type: ServerType;
  url?: string;
  credential?: string;
  musicBrainzToken?: string;
  musicBrainzSearchMode?: "mixed" | "musicbrainz" | "youtube";
  useMusicBrainz?: boolean;
};

export type PlayQueueAddOptions = {
  type: "now" | "next" | "last" | "shuffle";
  byStartIndex?: boolean;
  startIndex?: number;
};
