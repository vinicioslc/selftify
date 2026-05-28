import { ServerType, Song, Album, AlbumArtist, Playlist } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";

export type ApiContext = {
  serverId: string;
  serverType: ServerType;
  baseUrl?: string;
  credential?: string;
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
  getAlbumList(offset?: number, limit?: number): Promise<Album[]>;
  getAlbumArtistDetail(id: string): Promise<AlbumArtist | null>;
  getAlbumArtistList(offset?: number, limit?: number): Promise<AlbumArtist[]>;
  getSongList(offset?: number, limit?: number): Promise<Song[]>;
  getSongDetail(id: string): Promise<Song | null>;
  getPlaylistList(offset?: number, limit?: number): Promise<Playlist[]>;
  getPlaylistDetail(id: string): Promise<Playlist | null>;
  getStreamUrl(songId: string): Promise<string | null>;
  getImageUrl(songId: string): Promise<string | null>;
}

function getContext(): ApiContext {
  const { currentServer } = useAuthStore.getState();
  if (!currentServer) throw new Error("No server selected");
  return {
    serverId: currentServer.id,
    serverType: currentServer.type,
    baseUrl: currentServer.url,
    credential: currentServer.credential,
  };
}

export async function getController(): Promise<ServerController> {
  const ctx = getContext();
  switch (ctx.serverType) {
    case ServerType.JELLYFIN:
      return (await import("./jellyfin/jellyfin-controller")).createJellyfinController(ctx);
    case ServerType.NAVIDROME:
    case ServerType.SUBISONIC:
      return (await import("./navidrome/navidrome-controller")).createNavidromeController(ctx);
    case ServerType.YOUTUBE_MUSIC:
      return (await import("./youtube/youtube-controller")).createYouTubeController(ctx);
    case ServerType.LOCAL:
      return (await import("./local/local-controller")).createLocalController(ctx);
    default:
      throw new Error(`Unknown server type: ${ctx.serverType}`);
  }
}
