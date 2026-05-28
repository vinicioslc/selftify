import type { ApiContext, SearchResults, ServerController } from "../controller";
import { Song, ServerType } from "../../types/domain-types";
import { useLocalLibraryStore } from "../../stores/local-library.store";

export function createLocalController(ctx: ApiContext): ServerController {
  async function getEntry(id: string) {
    return useLocalLibraryStore
      .getState()
      .entries.find((e) => e.id === id);
  }

  function toSong(entry: any): Song {
    return {
      id: entry.id,
      serverId: ctx.serverId,
      serverType: ServerType.LOCAL,
      name: entry.name,
      artistName: entry.artistName || "Unknown Artist",
      artistId: undefined,
      albumName: entry.albumName || undefined,
      albumId: undefined,
      duration: entry.duration || null,
      imageUrl: entry.imageUrl || null,
      path: entry.path,
      genres: [],
    };
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local Files" }),

    search: async (query, limit = 20) => {
      const { entries } = useLocalLibraryStore.getState();
      const q = query.toLowerCase();
      const results = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.artistName.toLowerCase().includes(q) ||
          (e.albumName && e.albumName.toLowerCase().includes(q))
      );
      return {
        songs: results.slice(0, limit).map(toSong),
        albums: [],
        albumArtists: [],
      } as SearchResults;
    },

    getAlbumDetail: async () => null,
    getAlbumList: async () => [],

    getAlbumArtistDetail: async () => null,
    getAlbumArtistList: async () => [],

    getSongList: async (offset = 0, limit = 20) => {
      const { entries } = useLocalLibraryStore.getState();
      return entries.slice(offset, offset + limit).map(toSong);
    },

    getSongDetail: async (id) => {
      const entry = await getEntry(id);
      return entry ? toSong(entry) : null;
    },

    getPlaylistList: async () => [],
    getPlaylistDetail: async () => null,

    getStreamUrl: async (songId) => {
      const entry = await getEntry(songId);
      if (!entry?.path) return null;
      try {
        const fsPlugin = await import("@tauri-apps/plugin-fs");
        const data = await fsPlugin.readFile(entry.path);
        const blob = new Blob([data.buffer as ArrayBuffer]);
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    },

    getImageUrl: async () => null,
  };
}
