import type { ApiContext, SearchResults, ServerController } from "../controller";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";
import {
  getAllSongs,
  searchSongs,
  getSongById,
  getAlbumsFromSongs,
  getArtistsFromSongs,
  getSongsByAlbum,
  getSongsByArtist,
} from "../../services/local-database";
import { getImageUrlByTag, getImageUrlsByTagPrefix } from "../../services/image-cache";

export function createLocalController(ctx: ApiContext): ServerController {
  async function resolveImageUrl(
    songId: string,
    artistName: string,
    albumName: string | null | undefined,
  ): Promise<string | null> {
    const songUrl = await getImageUrlByTag(`song/${songId}`);
    if (songUrl) return songUrl;

    const artistNorm = artistName.toLowerCase().trim();
    const albumNorm = (albumName || "").toLowerCase().trim();

    if (albumNorm) {
      const albumUrl = await getImageUrlByTag(`album/${artistNorm}/${albumNorm}`);
      if (albumUrl) return albumUrl;
    }

    const artistUrl = await getImageUrlByTag(`artist/${artistNorm}`);
    if (artistUrl) return artistUrl;

    return null;
  }

  function toSong(row: any): Song {
    return {
      id: row.id,
      originId: ctx.originId,
      originType: OriginType.LOCAL,
      name: row.name,
      artistName: row.artist_name || "Unknown Artist",
      artistId: undefined,
      albumName: row.album_name || undefined,
      albumId: undefined,
      albumArtistName: row.album_artist || undefined,
      trackNumber: row.track_number || undefined,
      discNumber: row.disc_number || undefined,
      duration: row.duration || null,
      imageUrl: row._imageUrl || null,
      path: row.path,
      genres: row.genre ? [row.genre] : [],
      releaseYear: row.year || undefined,
    };
  }

  async function populateSongImages(songs: Song[]): Promise<Song[]> {
    return Promise.all(
      songs.map(async (song) => ({
        ...song,
        imageUrl: await resolveImageUrl(song.id, song.artistName, song.albumName),
      })),
    );
  }

  function toAlbum(
    row: { name: string; artist_name: string; song_count: number; duration: number },
    imageUrl: string | null,
  ): Album {
    return {
      id: `local-album-${row.artist_name.toLowerCase().replace(/\s+/g, "-")}-${row.name.toLowerCase().replace(/\s+/g, "-")}`,
      originId: ctx.originId,
      originType: OriginType.LOCAL,
      name: row.name,
      albumArtistName: row.artist_name,
      songCount: row.song_count,
      duration: row.duration,
      imageUrl,
    };
  }

  function toAlbumArtist(
    row: { name: string; song_count: number; album_count: number },
    imageUrl: string | null,
  ): AlbumArtist {
    return {
      id: `local-artist-${row.name.toLowerCase().replace(/\s+/g, "-")}`,
      originId: ctx.originId,
      originType: OriginType.LOCAL,
      name: row.name,
      songCount: row.song_count,
      albumCount: row.album_count,
      imageUrl,
    };
  }

  return {
    authenticate: async () => ({ token: "local", username: "Local Files" }),

    search: async (query, limit = 50) => {
      const results = await searchSongs(query, limit);
      const songs = await populateSongImages(results.map(toSong));
      return { songs, albums: [], albumArtists: [] } as SearchResults;
    },

    getAlbumDetail: async (id: string) => {
      const parts = id.replace("local-album-", "").split("-");
      const albums = await getAlbumsFromSongs();
      const match = albums.find((a) => {
        const expected = `local-album-${a.artist_name.toLowerCase().replace(/\s+/g, "-")}-${a.name.toLowerCase().replace(/\s+/g, "-")}`;
        return expected === id;
      });
      if (!match) return null;
      const imageUrl = await getImageUrlByTag(
        `album/${match.artist_name.toLowerCase().trim()}/${match.name.toLowerCase().trim()}`,
      );
      return toAlbum(match, imageUrl);
    },

    getAlbumList: async (_offset = 0, limit = 100) => {
      const rows = await getAlbumsFromSongs();
      const sliced = rows.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async (row) => {
          const imageUrl = await getImageUrlByTag(
            `album/${row.artist_name.toLowerCase().trim()}/${row.name.toLowerCase().trim()}`,
          );
          return toAlbum(row, imageUrl);
        }),
      );
    },

    getAlbumArtistDetail: async (id: string) => {
      const artists = await getArtistsFromSongs();
      const match = artists.find(
        (a) => `local-artist-${a.name.toLowerCase().replace(/\s+/g, "-")}` === id,
      );
      if (!match) return null;
      const imageUrl = await getImageUrlByTag(`artist/${match.name.toLowerCase().trim()}`);
      return toAlbumArtist(match, imageUrl);
    },

    getAlbumArtistList: async (_offset = 0, limit = 100) => {
      const rows = await getArtistsFromSongs();
      const sliced = rows.slice(_offset, _offset + limit);
      return Promise.all(
        sliced.map(async (row) => {
          const imageUrl = await getImageUrlByTag(`artist/${row.name.toLowerCase().trim()}`);
          return toAlbumArtist(row, imageUrl);
        }),
      );
    },

    getSongList: async (offset = 0, limit = 100) => {
      const all = await getAllSongs();
      const songs = await populateSongImages(all.slice(offset, offset + limit).map(toSong));
      return songs;
    },

    getSongDetail: async (id) => {
      const row = await getSongById(id);
      if (!row) return null;
      const song = toSong(row);
      song.imageUrl = await resolveImageUrl(song.id, song.artistName, song.albumName);
      return song;
    },

    getPlaylistList: async () => [],
    getPlaylistDetail: async () => null,

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
      } catch {
        return null;
      }
    },

    getImageUrl: async (songId: string) => {
      const row = await getSongById(songId);
      if (!row) return null;
      return resolveImageUrl(songId, row.artist_name, row.album_name);
    },

    getAlbumSongs: async (albumArtist: string, album: string) => {
      const rows = await getSongsByAlbum(albumArtist, album);
      const songs = rows.map(toSong);
      return populateSongImages(songs);
    },

    getArtistSongs: async (artist: string) => {
      const rows = await getSongsByArtist(artist);
      const songs = rows.map(toSong);
      return populateSongImages(songs);
    },
  };
}
