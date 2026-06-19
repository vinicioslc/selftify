import { OriginType, Song, Album, AlbumArtist, Playlist } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";

export type ApiContext = {
  originId: string;
  originType: OriginType;
  credential?: string;
  enableOnlineSearch?: boolean;
  musicBrainzToken?: string;
  youtubeMusicHeaders?: string;
  downloadFolder?: string;
  folderPath?: string;
};

export type SearchResults = {
  songs: Song[];
  albums: Album[];
  albumArtists: AlbumArtist[];
};

export interface ServerController {
  authenticate(url: string, username: string, password: string): Promise<{ token: string; username: string }>;
  search(query: string, limit?: number): Promise<SearchResults>;
  getAlbumDetail(id: string): Promise<Album | null>;
  getAlbumDetailByName(albumArtist: string, albumName: string): Promise<Album | null>;
  getAlbumList(offset?: number, limit?: number): Promise<Album[]>;
  getAlbumArtistDetail(id: string): Promise<AlbumArtist | null>;
  getAlbumArtistList(offset?: number, limit?: number): Promise<AlbumArtist[]>;
  getSongList(offset?: number, limit?: number): Promise<Song[]>;
  getSongDetail(id: string): Promise<Song | null>;
  getPlaylistList(offset?: number, limit?: number): Promise<Playlist[]>;
  getPlaylistDetail(id: string): Promise<Playlist | null>;
  getStreamUrl(songId: string): Promise<string | null>;
  getImageUrl(songId: string): Promise<string | null>;
  getAlbumSongs(albumArtist: string, album: string): Promise<Song[]>;
  getArtistSongs(artist: string): Promise<Song[]>;
  populateSongImages(songs: Song[]): Promise<Song[]>;
  populateArtistImages(artists: AlbumArtist[]): Promise<AlbumArtist[]>;
}

function getContext(): ApiContext {
  const { currentOrigin } = useAuthStore.getState();
  if (!currentOrigin) throw new Error("No origin selected");
  return {
    originId: currentOrigin.id,
    originType: currentOrigin.type,
    credential: currentOrigin.folderPath,
    enableOnlineSearch: currentOrigin.enableOnlineSearch,
    musicBrainzToken: currentOrigin.musicBrainzToken,
    youtubeMusicHeaders: currentOrigin.youtubeMusicHeaders,
    downloadFolder: currentOrigin.downloadFolder,
    folderPath: currentOrigin.folderPath,
  };
}

export async function getController(): Promise<ServerController> {
  const ctx = getContext();
  return (await import("./local/local-controller")).createLocalController(ctx);
}
