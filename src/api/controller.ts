import { OriginType, Song, Album, AlbumArtist, Playlist } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";

export type ApiContext = {
  originId: string;
  originType: OriginType;
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
  const { currentOrigin } = useAuthStore.getState();
  if (!currentOrigin) throw new Error("No origin selected");
  return {
    originId: currentOrigin.id,
    originType: currentOrigin.type,
    baseUrl: currentOrigin.url,
    credential: currentOrigin.credential,
  };
}

export async function getController(): Promise<ServerController> {
  const ctx = getContext();
  switch (ctx.originType) {
    case OriginType.JELLYFIN:
      return (await import("./jellyfin/jellyfin-controller")).createJellyfinController(ctx);
    case OriginType.NAVIDROME:
    case OriginType.SUBISONIC:
      return (await import("./navidrome/navidrome-controller")).createNavidromeController(ctx);
    case OriginType.YOUTUBE_MUSIC:
      return (await import("./youtube/youtube-controller")).createYouTubeController(ctx);
    case OriginType.LOCAL:
      return (await import("./local/local-controller")).createLocalController(ctx);
    default:
      throw new Error(`Unknown origin type: ${ctx.originType}`);
  }
}
