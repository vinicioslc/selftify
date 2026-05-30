import type { ApiContext, SearchResults, ServerController } from "../controller";
import { createNavidromeApi } from "./navidrome-api";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";

export function createNavidromeController(ctx: ApiContext): ServerController {
  const api = createNavidromeApi(ctx);

  function normalizeSong(raw: any): Song {
    return {
      id: raw.id,
      originId: ctx.originId,
      originType: OriginType.NAVIDROME,
      name: raw.title || "",
      artistName: raw.artist || "",
      artistId: raw.artistId,
      albumName: raw.album,
      albumId: raw.albumId,
      duration: raw.duration ? raw.duration * 1000 : null,
      imageUrl: raw.coverArt ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${raw.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}` : null,
      trackNumber: raw.track,
      releaseYear: raw.year,
      genres: raw.genre ? [raw.genre] : [],
    };
  }

  function normalizeAlbum(raw: any): Album {
    return {
      id: raw.id,
      originId: ctx.originId,
      originType: OriginType.NAVIDROME,
      name: raw.name || raw.title || "",
      albumArtistName: raw.artist || "",
      songCount: raw.songCount,
      duration: raw.duration ? raw.duration * 1000 : undefined,
      imageUrl: raw.coverArt ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${raw.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}` : null,
      releaseYear: raw.year,
      genres: raw.genre ? [raw.genre] : [],
    };
  }

  function normalizeArtist(raw: any): AlbumArtist {
    return {
      id: raw.id,
      originId: ctx.originId,
      originType: OriginType.NAVIDROME,
      name: raw.name || "",
      albumCount: raw.albumCount,
      imageUrl: raw.coverArt ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${raw.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}` : null,
    };
  }

  async function authenticate(url: string, username: string, password: string) {
    const resp = await fetch(`${url.replace(/\/+$/, "")}/rest/ping.view?v=1.16.1&c=ytmusicplayer&f=json&u=${username}&p=${password}`);
    const data = await resp.json();
    const sub = data["subsonic-response"];
    if (sub?.status === "ok") {
      return { token: password, username };
    }
    throw new Error("Authentication failed");
  }

  return {
    authenticate,
    search: async (query, limit = 20) => {
      const res = await api.request<any>("search3", { query, albumCount: String(limit), artistCount: String(limit), songCount: String(limit) });
      const data = res?.searchResult3 || {};
      return {
        songs: (data.song || []).map(normalizeSong),
        albums: (data.album || []).map(normalizeAlbum),
        albumArtists: (data.artist || []).map(normalizeArtist),
      } as SearchResults;
    },
    getAlbumDetail: async (id) => {
      const res = await api.request<any>("getAlbum", { id });
      const raw = res?.album;
      if (!raw) return null;
      return normalizeAlbum(raw);
    },
    getAlbumList: async (offset = 0, limit = 20) => {
      const res = await api.request<any>("getAlbumList2", { type: "newest", offset: String(offset), size: String(limit) });
      return (res?.albumList2?.album || []).map(normalizeAlbum);
    },
    getAlbumArtistDetail: async (id) => {
      const res = await api.request<any>("getArtist", { id });
      const raw = res?.artist;
      if (!raw) return null;
      return normalizeArtist(raw);
    },
    getAlbumArtistList: async (offset = 0, limit = 20) => {
      const res = await api.request<any>("getArtists", {});
      const indexes = res?.artists?.index || [];
      const all = indexes.flatMap((idx: any) => idx.artist || []);
      return all.slice(offset, offset + limit).map(normalizeArtist);
    },
    getSongList: async (offset = 0, limit = 20) => {
      const res = await api.request<any>("getSongList", { offset: String(offset), size: String(limit) });
      return (res?.songList?.entry || []).map(normalizeSong);
    },
    getSongDetail: async (id) => {
      const res = await api.request<any>("getSong", { id });
      const raw = res?.song;
      if (!raw) return null;
      return normalizeSong(raw);
    },
    getPlaylistList: async () => {
      const res = await api.request<any>("getPlaylists", {});
      return (res?.playlists?.playlist || []).map((p: any) => ({
        id: p.id,
        originId: ctx.originId,
        originType: OriginType.NAVIDROME,
        name: p.name || "",
        owner: p.owner,
        songCount: p.songCount,
        duration: p.duration ? p.duration * 1000 : undefined,
        imageUrl: p.coverArt ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${p.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}` : null,
        public: p["public"],
      }));
    },
    getPlaylistDetail: async (id) => {
      const res = await api.request<any>("getPlaylist", { id });
      const raw = res?.playlist;
      if (!raw) return null;
      return {
        id: raw.id,
        originId: ctx.originId,
        originType: OriginType.NAVIDROME,
        name: raw.name || "",
        owner: raw.owner,
        songCount: raw.songCount,
        duration: raw.duration ? raw.duration * 1000 : undefined,
        imageUrl: raw.coverArt ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${raw.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}` : null,
        public: raw["public"],
      };
    },
    getStreamUrl: async (songId) => {
      return `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/stream.view?v=1.16.1&c=ytmusicplayer&f=json&id=${songId}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}`;
    },
    getImageUrl: async (songId) => {
      try {
        const res = await api.request<any>("getSong", { id: songId });
        const raw = res?.song;
        return raw?.coverArt
          ? `${ctx.baseUrl?.replace(/\/+$/, "")}/rest/getCoverArt.view?v=1.16.1&c=ytmusicplayer&f=json&id=${raw.coverArt}&u=user&t=${ctx.credential || ""}&s=${ctx.credential || ""}`
          : null;
      } catch {
        return null;
      }
    },
    getAlbumSongs: async (_albumArtist, _album) => {
      return [];
    },
    getArtistSongs: async (_artist) => {
      return [];
    },
  };
}
