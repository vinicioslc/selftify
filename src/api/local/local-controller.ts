import type { ApiContext, SearchResults, ServerController } from "../controller";
import type { Song, Album, AlbumArtist, Playlist } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";
import { getAllPlaylists, getPlaylistById } from "../../services/playlist-service";
import { sqliteDbTrackToSong, sqliteDbAlbumMetaToAlbum, sqliteDbArtistMetaToAlbumArtist } from "../../services/sqlite-db/sqlite-db-resolver";
import { resolveSqliteDbImageObjectUrl } from "../../services/sqlite-db/sqlite-db-image";
import { initDatabase, isReady } from "../../services/db/database";
import * as albumRepo from "../../services/db/repositories/album-repo";
import * as artistRepo from "../../services/db/repositories/artist-repo";
import { useAuthStore } from "../../stores/auth.store";
import type { SqliteDbAlbumMeta, SqliteDbArtistMeta } from "../../services/sqlite-db/sqlite-db-types";

function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
}

async function ensureDb(): Promise<boolean> {
  if (isReady()) return true;
  const root = getLibraryRoot();
  if (!root) return false;
  try {
    await initDatabase(root);
    return isReady();
  } catch {
    return false;
  }
}

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

  async function findArtistImage(artistName: string): Promise<string | null> {
    const root = getLibraryRoot();
    if (!root) return null;
    const artistMeta = artistRepo.findArtistByName(artistName);
    if (!artistMeta?.images?.[0]?.url) return null;
    return resolveSqliteDbImageObjectUrl(root, artistMeta.images[0].url);
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
          const imageUrl = meta.images?.[0]?.url
            ? await resolveSqliteDbImageObjectUrl(getLibraryRoot() || "", meta.images[0].url)
            : null;
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
          const imageUrl = meta.images?.[0]?.url
            ? await resolveSqliteDbImageObjectUrl(getLibraryRoot() || "", meta.images[0].url)
            : null;
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
      const albums = await loadAllAlbumMetas();
      for (const { meta } of albums) {
        for (const track of meta.tracks) {
          if (!track.path) continue;
          const idWithAlbum = `${ctx.originId}:${meta.name}:${track.path}`;
          const shortId = `${ctx.originId}:${track.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? track.path}`;
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
              relPath = `${meta.artistName}/${meta.name}/${track.path}`;
            }
            let data = await p.readFile(`${root}/${relPath}`);
            if (!data && track.path.includes("/")) {
              const fallbackRel = `${meta.artistName}/${meta.name}/${track.path.split("/").pop()}`;
              data = await p.readFile(`${root}/${fallbackRel}`);
            }
            if (!data) return null;
            const blob = new Blob([data.buffer as ArrayBuffer]);
            return URL.createObjectURL(blob);
          } catch {
            return null;
          }
        }
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
