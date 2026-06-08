import type { ApiContext, SearchResults, ServerController } from "../controller";
import type { Song, Album, AlbumArtist, Playlist } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";
import {
  getAllSongs,
  searchSongs,
  getSongById,
  getAlbumsFromSongs,
  getArtistsFromSongs,
  getSongsByAlbum,
  getSongsByArtist,
} from "../../services/local-database";
import {
  getAllPlaylists,
  getPlaylistById,
} from "../../services/playlist-service";
import { dbSongToSong, dbRowToAlbum, dbRowToAlbumArtist, selftifyPlaylistToPlaylist } from "../../services/dto";
import { findImages, recordToBlobUrl, type ImageRecord } from "../../services/image-store";
import { isElectronImageStore, electronFindImages, electronGetImageByMd5, electronRecordToBlobUrl } from "../../services/electron-image-store";
import { resolveAlbumCover } from "../../services/cover-resolver";

export function createLocalController(ctx: ApiContext): ServerController {
  /**
   * Electron's `find`-family methods return metadata-only records with
   * `blob: new ArrayBuffer(0)`.  This helper fetches the actual binary
   * data before creating the blob URL.
   */
  async function recordToBlobUrlSafe(record: ImageRecord, isElectron: boolean): Promise<string | null> {
    if (isElectron && record.blob.byteLength === 0) {
      const full = await electronGetImageByMd5(record.md5);
      if (full && full.blob.byteLength > 0) return electronRecordToBlobUrl(full);
      return null;
    }
    return recordToBlobUrl(record);
  }

  async function findImage(query: Record<string, string>): Promise<string | null> {
    try {
      const isElectron = await isElectronImageStore();
      const results = await (isElectron ? electronFindImages(query) : findImages(query));
      if (results.length > 0) {
        console.debug("[local-controller] findImage: found", results.length, "results for", query);
        return recordToBlobUrlSafe(results[0], isElectron);
      }
      console.debug("[local-controller] findImage: no results for", query, "isElectron:", isElectron);
      return null;
    } catch (err) {
      console.error("[local-controller] findImage error:", err);
      return null;
    }
  }

  const getImageUrlByTag = async (tag: string): Promise<string | null> => {
    // tag format: "album::{artist}::{album}" or "artist::{artist}"
    // Uses :: as delimiter to avoid issues with artist/album names containing "/"
    const idx1 = tag.indexOf("::");
    if (idx1 < 0) return null;
    const type = tag.substring(0, idx1);
    const rest = tag.substring(idx1 + 2);
    if (type === "album") {
      const idx2 = rest.indexOf("::");
      if (idx2 < 0) return null;
      const artistName = rest.substring(0, idx2).toLowerCase().trim();
      const albumName = rest.substring(idx2 + 2).toLowerCase().trim();
      if (!artistName || !albumName) return null;
      return findImage({ artistName, albumName });
    }
    if (type === "artist") {
      const artistName = rest.toLowerCase().trim();
      if (!artistName) return null;
      return findImage({ artistName });
    }
    return null;
  };

  const resolveImageUrl = async (
    songId: string,
    artistName: string,
    albumName: string | null | undefined,
    mbzArtistId?: string | null,
    mbzReleaseGroupId?: string | null,
    mbzAlbumId?: string | null,
  ): Promise<string | null> => {
    const result = await resolveAlbumCover({ artistName: artistName || undefined, albumName: albumName || undefined, mbzArtistId: mbzArtistId || undefined, mbzReleaseGroupId: mbzReleaseGroupId || undefined, mbzReleaseId: mbzAlbumId || undefined });
    return result.blobUrl;
  };

  async function populateSongImages(songs: Song[]): Promise<Song[]> {
    return Promise.all(
      songs.map(async (song) => ({
        ...song,
        imageUrl: await resolveImageUrl(song.id, song.artistName, song.albumName, song.mbzArtistId, song.mbzReleaseGroupId, song.mbzAlbumId),
      })),
    );
  }

  async function findArtistImage(artistName: string, mbzArtistId?: string | null): Promise<string | null> {
    // Try by artist name — prioritize images without albumName (artist ·img/ folder)
    const isElectron = await isElectronImageStore();
    const byName = isElectron
      ? await electronFindImages({ artistName: artistName.toLowerCase().trim() })
      : await findImages({ artistName: artistName.toLowerCase().trim() });
    if (byName.length > 0) {
      const noAlbum = byName.find((r) => !r.albumName);
      const best = noAlbum || byName[0];
      return recordToBlobUrlSafe(best, isElectron);
    }
    // Fallback by MBZ ID
    if (mbzArtistId) {
      const byMbid = isElectron
        ? await electronFindImages({ mbzArtistId })
        : await findImages({ mbzArtistId });
      if (byMbid.length > 0) {
        const noAlbum = byMbid.find((r) => !r.albumName);
        const best = noAlbum || byMbid[0];
        return recordToBlobUrlSafe(best, isElectron);
      }
    }
    return null;
  }

  async function populateArtistImages(artists: AlbumArtist[]): Promise<AlbumArtist[]> {
    return Promise.all(
      artists.map(async (artist) => {
        if (artist.imageUrl) return artist;
        const url = await findArtistImage(artist.name, artist.mbz);
        return { ...artist, imageUrl: url };
      }),
    );
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local Files" }),

    search: async (query, limit = 50) => {
      const results = await searchSongs(query, limit);
      const songs = await populateSongImages(results.map((row) => dbSongToSong(row as any, ctx.originId)));
      return { songs, albums: [], albumArtists: [] } as SearchResults;
    },

    getAlbumDetail: async (id: string) => {
      const albums = await getAlbumsFromSongs();
      const match = albums.find((a) => {
        const expected = `local-album-${a.artist_name.toLowerCase().replace(/\s+/g, "-")}-${a.name.toLowerCase().replace(/\s+/g, "-")}`;
        return expected === id;
      });
      if (!match) return null;
      const imageUrl = await getImageUrlByTag(
        `album::${match.artist_name.toLowerCase().trim()}::${match.name.toLowerCase().trim()}`,
      );
      return dbRowToAlbum(match, ctx.originId, imageUrl);
    },

    getAlbumList: async (_offset = 0, limit = 100) => {
      const rows = await getAlbumsFromSongs();
      const sliced = rows.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async (row) => {
          const imageUrl = await getImageUrlByTag(
            `album::${row.artist_name.toLowerCase().trim()}::${row.name.toLowerCase().trim()}`,
          );
          return dbRowToAlbum(row, ctx.originId, imageUrl);
        }),
      );
    },

    getAlbumArtistDetail: async (id: string) => {
      const artists = await getArtistsFromSongs();
      const match = artists.find(
        (a) => `local-artist-${a.name.toLowerCase().replace(/\s+/g, "-")}` === id,
      );
      if (!match) return null;
      const imageUrl = await getImageUrlByTag(`artist::${match.name.toLowerCase().trim()}`);
      return dbRowToAlbumArtist(match, ctx.originId, imageUrl);
    },

    getAlbumArtistList: async (_offset = 0, limit = 100) => {
      const rows = await getArtistsFromSongs();
      const sliced = rows.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async (row) => {
          const imageUrl = await getImageUrlByTag(`artist::${row.name.toLowerCase().trim()}`);
          return dbRowToAlbumArtist(row, ctx.originId, imageUrl);
        }),
      );
    },

    getSongList: async (offset = 0, limit = 100) => {
      const all = await getAllSongs();
      const songs = await populateSongImages(all.slice(offset, offset + limit).map((row) => dbSongToSong(row as any, ctx.originId)));
      return songs;
    },

    getSongDetail: async (id) => {
      const row = await getSongById(id);
      if (!row) return null;
      const song = dbSongToSong(row as any, ctx.originId);
      song.imageUrl = await resolveImageUrl(song.id, song.artistName, song.albumName, song.mbzArtistId, song.mbzReleaseGroupId, song.mbzAlbumId);
      return song;
    },

    getPlaylistList: async () => {
      const playlists = await getAllPlaylists();
      return playlists.map(selftifyPlaylistToPlaylist);
    },

    getPlaylistDetail: async (id: string) => {
      const playlist = await getPlaylistById(id);
      if (!playlist) return null;
      return selftifyPlaylistToPlaylist(playlist);
    },

    getStreamUrl: async (songId) => {
      const row = await getSongById(songId);
      if (!row?.path) return null;
      try {
        const { getPlatformService } = await import("../../services/platform/factory");
        const p = await getPlatformService();
        const data = await p.readFile(row.path);
        if (!data) return null;
        const blob = new Blob([data.buffer as ArrayBuffer]);
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error("[local-controller] getStreamUrl error:", err);
        return null;
      }
    },

    getImageUrl: async (songId: string) => {
      const row = await getSongById(songId);
      if (!row) return null;
      return resolveImageUrl(songId, row.artist_name, row.album_name, row.mbz_artist_id, row.mbz_release_group_id, row.mbz_album_id);
    },

    getAlbumSongs: async (albumArtist: string, album: string) => {
      const rows = await getSongsByAlbum(albumArtist, album);
      const songs = rows.map((row) => dbSongToSong(row as any, ctx.originId));
      return populateSongImages(songs);
    },

    getArtistSongs: async (artist: string) => {
      const rows = await getSongsByArtist(artist);
      const songs = rows.map((row) => dbSongToSong(row as any, ctx.originId));
      return populateSongImages(songs);
    },

    populateSongImages,
    populateArtistImages,
  };
}
