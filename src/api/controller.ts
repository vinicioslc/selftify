import { OriginType, Song, Album, AlbumArtist, Playlist } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";
import { useOnlineSearchStore } from "../stores/online-search.store";

export type ApiContext = {
  originId: string;
  originType: OriginType;
  credential?: string;
  downloadFolder?: string;
  folderPath?: string;
  /** @deprecated Use useOnlineSearchStore instead */
  enableOnlineSearch?: boolean;
  /** @deprecated Use useOnlineSearchStore instead */
  musicBrainzToken?: string;
  /** @deprecated Use useOnlineSearchStore instead */
  youtubeMusicHeaders?: string;
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

  const onlineSearch = useOnlineSearchStore.getState();

  return {
    originId: currentOrigin.id,
    originType: currentOrigin.type,
    credential: currentOrigin.folderPath,
    downloadFolder: onlineSearch.downloadFolder || currentOrigin.downloadFolder,
    folderPath: currentOrigin.folderPath,
    // Legacy fields for backward compat — new code reads from online-search store
    enableOnlineSearch: onlineSearch.enabled,
    musicBrainzToken: onlineSearch.musicBrainzToken,
    youtubeMusicHeaders: onlineSearch.youtubeMusicHeaders,
  };
}

// When a backend (Selftify/Subsonic server) is the source, there is no local
// origin in auth.store. Build a context that lets the Subsonic controller work
// without throwing "No origin selected".
function getBackendContext(): ApiContext {
  const { currentOrigin } = useAuthStore.getState();
  const onlineSearch = useOnlineSearchStore.getState();
  return {
    originId: currentOrigin?.id ?? "selftify-server",
    originType: currentOrigin?.type ?? OriginType.LOCAL,
    credential: currentOrigin?.folderPath,
    downloadFolder: onlineSearch.downloadFolder || currentOrigin?.downloadFolder,
    folderPath: currentOrigin?.folderPath,
    // Legacy fields for backward compat — new code reads from online-search store
    enableOnlineSearch: onlineSearch.enabled,
    musicBrainzToken: onlineSearch.musicBrainzToken,
    youtubeMusicHeaders: onlineSearch.youtubeMusicHeaders,
  };
}

export async function getController(): Promise<ServerController> {
  // When a backend (Selftify/Subsonic server) is configured, use Subsonic controller.
  // Check this BEFORE getContext() since a backend has no auth.store origin.
  const { useBackendStore } = await import("../stores/backend.store");
  const backendConfig = useBackendStore.getState().config;
  if (backendConfig) {
    const { createSubsonicController } = await import("./subsonic/subsonic-controller");
    return createSubsonicController(getBackendContext());
  }

  const ctx = getContext();
  if (ctx.originType === OriginType.YOUTUBE) {
    return (await import("./youtube/youtube-controller")).createYoutubeController(ctx);
  }
  return (await import("./local/local-controller")).createLocalController(ctx);
}
