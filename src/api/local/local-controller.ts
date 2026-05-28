import type { ApiContext, SearchResults, ServerController } from "../controller";
import { Song, Album, AlbumArtist, ServerType } from "../../types/domain-types";

export function createLocalController(ctx: ApiContext): ServerController {
  async function scanFolder(): Promise<Song[]> {
    const songs: Song[] = [];
    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const musicPath = ctx.baseUrl || "";
      if (!musicPath) return songs;

      const entries = await fsPlugin.readDir(musicPath);
      const audioExtensions = new Set([".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma"]);

      function processEntries(entries: any[], parentPath: string) {
        for (const entry of entries) {
          if (entry.children) {
            processEntries(entry.children, `${parentPath}/${entry.name}`);
          } else if (entry.name) {
            const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
            if (audioExtensions.has(ext)) {
              songs.push({
                id: entry.name,
                serverId: ctx.serverId,
                serverType: ServerType.LOCAL,
                name: entry.name.replace(/\.[^/.]+$/, ""),
                artistName: "Unknown Artist",
                duration: null,
                imageUrl: null,
                path: `${parentPath}/${entry.name}`,
              });
            }
          }
        }
      }
      processEntries(entries, musicPath);
    } catch (err) {
      console.warn("Local scan error (expected on web):", err);
    }
    return songs;
  }

  // In-memory cache for scanned songs
  let cachedSongs: Song[] = [];
  let scanned = false;

  async function ensureScanned() {
    if (!scanned) {
      cachedSongs = await scanFolder();
      scanned = true;
    }
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local User" }),
    search: async (query, limit = 20) => {
      await ensureScanned();
      const q = query.toLowerCase();
      const results = cachedSongs.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.artistName.toLowerCase().includes(q)
      );
      return {
        songs: results.slice(0, limit),
        albums: [],
        albumArtists: [],
      } as SearchResults;
    },
    getAlbumDetail: async () => null,
    getAlbumList: async () => [],
    getAlbumArtistDetail: async () => null,
    getAlbumArtistList: async () => [],
    getSongList: async (offset = 0, limit = 20) => {
      await ensureScanned();
      return cachedSongs.slice(offset, offset + limit);
    },
    getSongDetail: async (id) => {
      await ensureScanned();
      return cachedSongs.find((s) => s.id === id) || null;
    },
    getPlaylistList: async () => [],
    getPlaylistDetail: async () => null,
    getStreamUrl: async (songId) => {
      await ensureScanned();
      const song = cachedSongs.find((s) => s.id === songId);
      if (song?.path) {
        try {
          const fsPlugin = await import("@tauri-apps/plugin-fs");
          const data = await fsPlugin.readFile(song.path);
          const blob = new Blob([data.buffer as ArrayBuffer]);
          return URL.createObjectURL(blob);
        } catch {
          return null;
        }
      }
      return null;
    },
    getImageUrl: async () => null,
  };
}
