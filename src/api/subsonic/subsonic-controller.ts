import type { ServerController, ApiContext, SearchResults } from "../controller";
import type { Song, Album, AlbumArtist, Playlist } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";
import { useBackendStore } from "../../stores/backend.store";
import { API_BASE } from "../base";

const API_VERSION = "1.16.1";
const CLIENT_NAME = "selftify";

function authParams(): string {
  const bc = useBackendStore.getState().config;
  const user = bc?.user || "admin";
  const password = bc?.password || "admin";
  // Plaintext password auth (Subsonic spec: prepend "enc:" for hex, otherwise plain)
  return `u=${encodeURIComponent(user)}&p=${encodeURIComponent(password)}&v=${API_VERSION}&c=${CLIENT_NAME}&f=json`;
}

function baseUrl(): string {
  const bc = useBackendStore.getState().config;
  return bc?.url || API_BASE;
}

async function subsonicFetch(endpoint: string, params: string): Promise<any> {
  const url = `${baseUrl()}/rest/${endpoint}.view?${params}&${authParams()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subsonic error: ${res.status}`);
  const json = await res.json();
  const response = json?.["subsonic-response"];
  if (response?.status !== "ok") {
    throw new Error(response?.error?.message || "Subsonic API error");
  }
  return response;
}

function mapSong(item: any, originId: string): Song {
  return {
    id: item.id,
    originId,
    originType: OriginType.LOCAL,
    name: item.title || "Unknown",
    artistName: item.artist || "Unknown Artist",
    artistId: item.artistId,
    albumName: item.album,
    albumId: item.albumId,
    trackNumber: item.track ?? undefined,
    discNumber: item.discNumber ?? undefined,
    duration: item.duration ?? null,
    bitrate: item.bitRate ?? undefined,
    imageUrl: item.coverArt ? `${baseUrl()}/rest/getCoverArt.view?id=${encodeURIComponent(item.coverArt)}&${authParams()}` : null,
    path: item.path,
    genres: item.genre ? [item.genre] : undefined,
    releaseYear: item.year ?? undefined,
  };
}

function mapAlbum(item: any, originId: string): Album {
  return {
    id: item.id,
    originId,
    originType: OriginType.LOCAL,
    name: item.name || item.title || "Unknown",
    albumArtistName: item.artist || "Unknown Artist",
    songCount: item.songCount ?? undefined,
    duration: item.duration ?? undefined,
    imageUrl: item.coverArt ? `${baseUrl()}/rest/getCoverArt.view?id=${encodeURIComponent(item.coverArt)}&${authParams()}` : null,
    releaseYear: item.year ?? undefined,
    genres: item.genre ? [item.genre] : undefined,
  };
}

function mapArtist(item: any, originId: string): AlbumArtist {
  return {
    id: item.id,
    originId,
    originType: OriginType.LOCAL,
    name: item.name || "Unknown",
    albumCount: item.albumCount ?? undefined,
    imageUrl: item.coverArt ? `${baseUrl()}/rest/getCoverArt.view?id=${encodeURIComponent(item.coverArt)}&${authParams()}` : null,
  };
}

function mapPlaylist(item: any, originId: string): Playlist {
  return {
    id: item.id,
    originId,
    originType: OriginType.LOCAL,
    name: item.name || "Unknown",
    owner: item.owner,
    songCount: item.songCount ?? undefined,
    duration: item.duration ?? undefined,
    imageUrl: null,
    public: item.public === true,
  };
}

export function createSubsonicController(ctx: ApiContext): ServerController {
  const originId = ctx.originId;

  return {
    async authenticate(url: string, username: string, password: string) {
      const res = await fetch(`${url}/rest/ping.view?u=${encodeURIComponent(username)}&p=${encodeURIComponent(password)}&v=${API_VERSION}&c=${CLIENT_NAME}&f=json`);
      const json = await res.json();
      const status = json?.["subsonic-response"]?.status;
      if (status !== "ok") throw new Error("Authentication failed");
      return { token: "", username };
    },

    async search(query: string, limit = 20): Promise<SearchResults> {
      const resp = await subsonicFetch("search3", `query=${encodeURIComponent(query)}&artistCount=10&albumCount=10&songCount=${limit}`);
      const data = resp.searchResult3 || {};
      return {
        songs: (data.song || []).map((s: any) => mapSong(s, originId)),
        albums: (data.album || []).map((a: any) => mapAlbum(a, originId)),
        albumArtists: (data.artist || []).map((a: any) => mapArtist(a, originId)),
      };
    },

    async getAlbumDetail(id: string): Promise<Album | null> {
      const resp = await subsonicFetch("getAlbum", `id=${encodeURIComponent(id)}`);
      if (!resp.album) return null;
      return mapAlbum(resp.album, originId);
    },

    async getAlbumDetailByName(albumArtist: string, albumName: string): Promise<Album | null> {
      const resp = await subsonicFetch("search3", `query=${encodeURIComponent(albumName)}&artistCount=0&albumCount=10&songCount=0`);
      const albums = resp.searchResult3?.album || [];
      const match = albums.find((a: any) =>
        a.name?.toLowerCase() === albumName.toLowerCase() &&
        a.artist?.toLowerCase() === albumArtist.toLowerCase()
      );
      return match ? mapAlbum(match, originId) : null;
    },

    async getAlbumList(offset = 0, limit = 100): Promise<Album[]> {
      const resp = await subsonicFetch("getAlbumList2", `type=alphabeticalByName&size=${limit}&offset=${offset}`);
      return (resp.albumList2?.album || []).map((a: any) => mapAlbum(a, originId));
    },

    async getAlbumArtistDetail(id: string): Promise<AlbumArtist | null> {
      const resp = await subsonicFetch("getArtist", `id=${encodeURIComponent(id)}`);
      if (!resp.artist) return null;
      return mapArtist(resp.artist, originId);
    },

    async getAlbumArtistList(_offset = 0, _limit = 100): Promise<AlbumArtist[]> {
      const resp = await subsonicFetch("getArtists", "");
      const indexes = resp.artists?.index || [];
      const artists: AlbumArtist[] = [];
      for (const ix of indexes) {
        for (const a of ix.artist || []) {
          artists.push(mapArtist(a, originId));
        }
      }
      return artists;
    },

    async getSongList(_offset = 0, limit = 10000): Promise<Song[]> {
      const resp = await subsonicFetch("search3", `query=&artistCount=0&albumCount=0&songCount=${limit}`);
      return (resp.searchResult3?.song || []).map((s: any) => mapSong(s, originId));
    },

    async getSongDetail(id: string): Promise<Song | null> {
      const resp = await subsonicFetch("getSong", `id=${encodeURIComponent(id)}`);
      if (!resp.song) return null;
      return mapSong(resp.song, originId);
    },

    async getPlaylistList(): Promise<Playlist[]> {
      const resp = await subsonicFetch("getPlaylists", "");
      return (resp.playlists?.playlist || []).map((p: any) => mapPlaylist(p, originId));
    },

    async getPlaylistDetail(id: string): Promise<Playlist | null> {
      const resp = await subsonicFetch("getPlaylist", `id=${encodeURIComponent(id)}`);
      if (!resp.playlist) return null;
      return mapPlaylist(resp.playlist, originId);
    },

    async getStreamUrl(songId: string): Promise<string | null> {
      return `${baseUrl()}/rest/stream.view?id=${encodeURIComponent(songId)}&${authParams()}`;
    },

    async getImageUrl(songId: string): Promise<string | null> {
      return `${baseUrl()}/rest/getCoverArt.view?id=${encodeURIComponent(songId)}&${authParams()}`;
    },

    async getAlbumSongs(albumArtist: string, album: string): Promise<Song[]> {
      const albumDetail = await this.getAlbumDetailByName(albumArtist, album);
      if (!albumDetail) return [];
      const resp = await subsonicFetch("getAlbum", `id=${encodeURIComponent(albumDetail.id)}`);
      return (resp.album?.song || []).map((s: any) => mapSong(s, originId));
    },

    async getArtistSongs(artist: string): Promise<Song[]> {
      // Search for artist, then get all albums, then get all songs
      const searchResp = await subsonicFetch("search3", `query=${encodeURIComponent(artist)}&artistCount=5&albumCount=50&songCount=0`);
      const albums = searchResp.searchResult3?.album || [];
      const songs: Song[] = [];
      for (const album of albums) {
        const albumResp = await subsonicFetch("getAlbum", `id=${encodeURIComponent(album.id)}`);
        const albumSongs = albumResp.album?.song || [];
        for (const s of albumSongs) {
          songs.push(mapSong(s, originId));
        }
      }
      return songs;
    },

    async populateSongImages(songs: Song[]): Promise<Song[]> {
      return songs.map((s) => ({
        ...s,
        imageUrl: s.imageUrl || (s.albumId ? `${baseUrl()}/rest/getCoverArt.view?id=${encodeURIComponent(s.albumId)}&${authParams()}` : null),
      }));
    },

    async populateArtistImages(artists: AlbumArtist[]): Promise<AlbumArtist[]> {
      return artists;
    },
  };
}
