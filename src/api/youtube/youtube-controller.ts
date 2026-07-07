import type { ApiContext, SearchResults, ServerController } from "../controller";
import type { Song, Album, AlbumArtist, Playlist } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";

export function createYoutubeController(ctx: ApiContext): ServerController {
  return {
    authenticate: async () => ({ token: "youtube", username: "YouTube Music" }),

    search: async (_query, _limit = 50) => {
      return { songs: [], albums: [], albumArtists: [] } as SearchResults;
    },

    getAlbumDetail: async (_id: string) => null,

    getAlbumDetailByName: async (_albumArtist: string, _albumName: string) => null,

    getAlbumList: async (_offset = 0, _limit = 100) => [],

    getAlbumArtistDetail: async (_id: string) => null,

    getAlbumArtistList: async (_offset = 0, _limit = 100) => [],

    getSongList: async (_offset = 0, _limit = 100) => [],

    getSongDetail: async (_id: string) => null,

    getPlaylistList: async (_offset?: number, _limit?: number) => [],

    getPlaylistDetail: async (_id: string) => null,

    getStreamUrl: async () => null,

    getImageUrl: async () => null,

    getAlbumSongs: async (_albumArtist: string, _album: string) => [],

    getArtistSongs: async (_artist: string) => [],

    populateSongImages: async (songs: Song[]) => songs,

    populateArtistImages: async (artists: AlbumArtist[]) => artists,
  };
}
