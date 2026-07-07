import type { ApiContext, SearchResults, ServerController } from "../controller";
import type { Song, Album, AlbumArtist, Playlist } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";
import { getAllPlaylists, getPlaylistById } from "../../services/playlist-service";
import { sqliteDbTrackToSong, sqliteDbAlbumMetaToAlbum, sqliteDbArtistMetaToAlbumArtist } from "../../services/sqlite-db/sqlite-db-resolver";
import { resolveSqliteDbImageObjectUrl } from "../../services/sqlite-db/sqlite-db-image";
import * as albumRepo from "../../services/db/repositories/album-repo";
import * as artistRepo from "../../services/db/repositories/artist-repo";
import { getLibraryRoot, ensureDb } from "../../services/db/ensure-db";
import type { SqliteDbAlbumMeta, SqliteDbArtistMeta } from "../../services/sqlite-db/sqlite-db-types";
import { joinPaths, fileNameFromPath } from "../../lib/path-utils";

export function createLocalController(ctx: ApiContext): ServerController {
  async function loadAllAlbumMetas(): Promise<{ meta: SqliteDbAlbumMeta; artistDir: string }[]> {
    const ready = await ensureDb();
    if (!ready) return [];
    return albumRepo.getAllAlbums();
  }

  async function loadAllArtistMetas(): Promise<SqliteDbArtistMeta[]> {
    const ready = await ensureDb();
    if (!ready) return [];
    return artistRepo.getAllArtists();
  }

  function findArtistDir(_root: string, artistName: string): Promise<string | null> {
    const artist = artistRepo.findArtistByName(artistName);
    return Promise.resolve(artist ? artist.name : null);
  }

  async function resolveImageUrl(
    artistName: string,
    albumName: string | null | undefined,
  ): Promise<string | null> {
    const root = getLibraryRoot();
    if (!root) return null;

    if (albumName) {
      const albumMeta = albumRepo.findAlbumByName(artistName, albumName);
      if (albumMeta?.images?.[0]?.url) {
        return resolveSqliteDbImageObjectUrl(root, albumMeta.images[0].url);
      }
    }

    const artistMeta = artistRepo.findArtistByName(artistName);
    if (artistMeta?.images?.[0]?.url) {
      return resolveSqliteDbImageObjectUrl(root, artistMeta.images[0].url);
    }

    return null;
  }

  async function populateSongImages(songs: Song[]): Promise<Song[]> {
    return Promise.all(
      songs.map(async (song) => ({
        ...song,
        imageUrl: await resolveImageUrl(song.artistName, song.albumName),
      })),
    );
  }

  async function findFirstAlbumImage(artistName: string): Promise<string | null> {
    const root = getLibraryRoot();
    if (!root) return null;
    const albums = albumRepo.getAlbumsByArtist(artistName);
    for (const album of albums) {
      if (album.images?.[0]?.url) {
        const url = await resolveSqliteDbImageObjectUrl(root, album.images[0].url);
        if (url) return url;
      }
    }
    return null;
  }

  async function findArtistImage(artistName: string): Promise<string | null> {
    const root = getLibraryRoot();
    if (!root) return null;
    const artistMeta = artistRepo.findArtistByName(artistName);
    if (artistMeta?.images?.[0]?.url) {
      return resolveSqliteDbImageObjectUrl(root, artistMeta.images[0].url);
    }
    return findFirstAlbumImage(artistName);
  }

  async function populateArtistImages(artists: AlbumArtist[]): Promise<AlbumArtist[]> {
    return Promise.all(
      artists.map(async (artist) => {
        if (artist.imageUrl) return artist;
        const url = await findArtistImage(artist.name);
        return { ...artist, imageUrl: url };
      }),
    );
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local Files" }),

    search: async (query, limit = 50) => {
      const albums = await loadAllAlbumMetas();
      const songs: Song[] = [];
      const lowerQuery = query.toLowerCase();
      for (const { meta, artistDir } of albums) {
        for (const track of meta.tracks) {
          if (track.name.toLowerCase().includes(lowerQuery) ||
              track.artistName.toLowerCase().includes(lowerQuery) ||
              (track.albumName && track.albumName.toLowerCase().includes(lowerQuery))) {
            songs.push(sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta));
          }
          if (songs.length >= limit) break;
        }
        if (songs.length >= limit) break;
      }
      const withImages = await populateSongImages(songs);
      return { songs: withImages, albums: [], albumArtists: [] } as SearchResults;
    },

    getAlbumDetail: async (id: string) => {
      const albums = await loadAllAlbumMetas();
      for (const { meta, artistDir } of albums) {
        const expected = `local-album-${meta.artistName.toLowerCase().replace(/\s+/g, "-")}-${meta.name.toLowerCase().replace(/\s+/g, "-")}`;
        if (expected === id) {
          const imageUrl = await resolveImageUrl(meta.artistName, meta.name);
          return sqliteDbAlbumMetaToAlbum(meta, ctx.originId, OriginType.LOCAL, imageUrl);
        }
      }
      return null;
    },

    getAlbumDetailByName: async (albumArtist: string, albumName: string) => {
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        if (meta.artistName.toLowerCase() === albumArtist.toLowerCase() &&
            meta.name.toLowerCase() === albumName.toLowerCase()) {
          const imageUrl = await resolveImageUrl(meta.artistName, meta.name);
          return sqliteDbAlbumMetaToAlbum(meta, ctx.originId, OriginType.LOCAL, imageUrl);
        }
      }
      return null;
    },

    getAlbumList: async (_offset = 0, limit = 100) => {
      const albums = await loadAllAlbumMetas();
      const sliced = albums.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async ({ meta }) => {
          const imageUrl = await resolveImageUrl(meta.artistName, meta.name);
          return sqliteDbAlbumMetaToAlbum(meta, ctx.originId, OriginType.LOCAL, imageUrl);
        }),
      );
    },

    getAlbumArtistDetail: async (id: string) => {
      const artists = await loadAllArtistMetas();
      for (const meta of artists) {
        const expected = `local-artist-${meta.name.toLowerCase().replace(/\s+/g, "-")}`;
        if (expected === id) {
          const imageUrl = await findArtistImage(meta.name);
          return sqliteDbArtistMetaToAlbumArtist(meta, ctx.originId, OriginType.LOCAL, imageUrl);
        }
      }
      return null;
    },

    getAlbumArtistList: async (_offset = 0, limit = 100) => {
      const artists = await loadAllArtistMetas();
      const sliced = artists.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async (meta) => {
          const imageUrl = await findArtistImage(meta.name);
          return sqliteDbArtistMetaToAlbumArtist(meta, ctx.originId, OriginType.LOCAL, imageUrl);
        }),
      );
    },

    getSongList: async (offset = 0, limit = 100) => {
      const albums = await loadAllAlbumMetas();
      const songs: Song[] = [];
      for (const { meta } of albums) {
        for (const track of meta.tracks) {
          songs.push(sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta));
        }
      }
      const sliced = songs.slice(offset, offset + limit);
      return populateSongImages(sliced);
    },

    getSongDetail: async (id) => {
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        for (const track of meta.tracks) {
          const song = sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta);
          if (song.id === id) {
            song.imageUrl = await resolveImageUrl(song.artistName, song.albumName);
            return song;
          }
        }
      }
      return null;
    },

    getPlaylistList: async (offset?: number, limit?: number) => {
      const playlists = await getAllPlaylists();
      const sliced = playlists.slice(offset || 0, limit ? (offset || 0) + limit : undefined);
      return sliced.map((p) => ({
        ...p,
        originType: OriginType.LOCAL,
        imageUrl: null,
      }));
    },

    getPlaylistDetail: async (id: string) => {
      const playlist = await getPlaylistById(id);
      if (!playlist) return null;
      return {
        ...playlist,
        originType: OriginType.LOCAL,
        imageUrl: null,
      };
    },

    getStreamUrl: async (songId) => {
      // Try local file path first
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        for (const track of meta.tracks) {
          if (!track.path) continue;
          const idWithAlbum = `${ctx.originId}:${meta.name}:${track.path}`;
          const shortId = `${ctx.originId}:${fileNameFromPath(track.path).replace(/\.[^.]+$/, "") || track.path}`;
          if (songId !== idWithAlbum && songId !== shortId) continue;
          try {
            const { getPlatformService } = await import("../../services/platform/factory");
            const p = await getPlatformService();
            const root = getLibraryRoot();
            if (!root) return null;
            let relPath: string;
            if (track.path.includes("/")) {
              relPath = track.path;
            } else {
              relPath = joinPaths(meta.artistName, meta.name, track.path);
            }
            let data = await p.readFile(joinPaths(root, relPath));
            if (data) return URL.createObjectURL(new Blob([data.buffer as ArrayBuffer]));
            if (!data && track.path.includes("/")) {
              const parts = track.path.split("/");
              const fileName = parts.pop()!;
              const artistName = parts[0];
              console.debug(`[Selftify] getStreamUrl: stored path failed, trying fallbacks for ${fileName}`);
              if (meta.releaseYear) {
                const yearSuffixed = joinPaths(artistName, `${meta.name} (${meta.releaseYear})`, fileName);
                data = await p.readFile(joinPaths(root, yearSuffixed));
              }
              if (!data) {
                const fallbackRel = joinPaths(meta.artistName, meta.name, fileName);
                data = await p.readFile(joinPaths(root, fallbackRel));
              }
              if (!data) {
                try {
                  const entries = await p.readDirectory(joinPaths(root, artistName));
                  for (const entry of entries) {
                    if (entry.isDirectory && entry.name.startsWith(meta.name)) {
                      const candidate = joinPaths(root, artistName, entry.name, fileName);
                      data = await p.readFile(candidate);
                      if (data) break;
                    }
                  }
                } catch (err) {
                  console.debug(`[Selftify] getStreamUrl: directory scan failed:`, err);
                }
              }
            }
            if (!data) {
              console.debug(`[Selftify] getStreamUrl: ALL FALLBACKS FAILED for songId=${songId}`);
              return null;
            }
            const blob = new Blob([data.buffer as ArrayBuffer]);
            return URL.createObjectURL(blob);
          } catch {
            return null;
          }
        }
      }

      // Not a local file — try YouTube resolution
      try {
        const { usePlayerStore } = await import("../../stores/player.store");
        const currentTrack = usePlayerStore.getState().currentTrack;
        if (currentTrack?.id === songId && currentTrack.youtubeVideoId) {
          const { getStreamUrl } = await import("../../services/youtube-download-service");
          return getStreamUrl(currentTrack);
        }
      } catch (err) {
        console.debug("[local-controller] YouTube stream resolution failed:", err);
      }

      return null;
    },

    getImageUrl: async (songId: string) => {
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        for (const track of meta.tracks) {
          const song = sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta);
          if (song.id === songId) {
            return resolveImageUrl(song.artistName, song.albumName);
          }
        }
      }
      return null;
    },

    getAlbumSongs: async (albumArtist: string, album: string) => {
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        if (meta.artistName.toLowerCase() === albumArtist.toLowerCase() &&
            meta.name.toLowerCase() === album.toLowerCase()) {
          const songs = meta.tracks.map((track) => sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta));
          return populateSongImages(songs);
        }
      }
      return [];
    },

    getArtistSongs: async (artist: string) => {
      const albums = await loadAllAlbumMetas();
      const songs: Song[] = [];
      for (const { meta } of albums) {
        if (meta.artistName.toLowerCase() === artist.toLowerCase()) {
          for (const track of meta.tracks) {
            songs.push(sqliteDbTrackToSong(track, ctx.originId, OriginType.LOCAL, meta));
          }
        }
      }
      return populateSongImages(songs);
    },

    populateSongImages,
    populateArtistImages,
  };
}
