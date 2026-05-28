import type { ApiContext, SearchResults, ServerController } from "../controller";
import { Song, ServerType } from "../../types/domain-types";
import { getAllSongs, searchSongs, getSongById } from "../../services/local-database";

export function createLocalController(ctx: ApiContext): ServerController {
  function toSong(row: any): Song {
    return {
      id: row.id,
      serverId: ctx.serverId,
      serverType: ServerType.LOCAL,
      name: row.name,
      artistName: row.artist_name || "Unknown Artist",
      artistId: undefined,
      albumName: row.album_name || undefined,
      albumId: undefined,
      albumArtistName: row.album_artist || undefined,
      trackNumber: row.track_number || undefined,
      discNumber: row.disc_number || undefined,
      duration: row.duration || null,
      imageUrl: null,
      path: row.path,
      genres: row.genre ? [row.genre] : [],
      releaseYear: row.year || undefined,
    };
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local Files" }),

    search: async (query, limit = 50) => {
      const results = await searchSongs(query, limit);
      return {
        songs: results.map(toSong),
        albums: [],
        albumArtists: [],
      } as SearchResults;
    },

    getAlbumDetail: async () => null,
    getAlbumList: async () => [],

    getAlbumArtistDetail: async () => null,
    getAlbumArtistList: async () => [],

    getSongList: async (offset = 0, limit = 100) => {
      const all = await getAllSongs();
      return all.slice(offset, offset + limit).map(toSong);
    },

    getSongDetail: async (id) => {
      const row = await getSongById(id);
      return row ? toSong(row) : null;
    },

    getPlaylistList: async () => [],
    getPlaylistDetail: async () => null,

    getStreamUrl: async (songId) => {
      const row = await getSongById(songId);
      if (!row?.path) return null;
      try {
        const fsPlugin = await import("@tauri-apps/plugin-fs");
        const data = await fsPlugin.readFile(row.path);
        const blob = new Blob([data.buffer as ArrayBuffer]);
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    },

    getImageUrl: async () => null,
  };
}
