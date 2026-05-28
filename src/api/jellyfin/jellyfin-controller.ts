import type { ApiContext, SearchResults, ServerController } from "../controller";
import { createJellyfinApi, type JellyfinUser } from "./jellyfin-api";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";

export function createJellyfinController(ctx: ApiContext): ServerController {
  const api = createJellyfinApi(ctx);
  const ticksToMs = (ticks: number) => (ticks || 0) / 10000;

  function imageUrl(itemId: string, tag?: string): string | null {
    if (!tag) return null;
    return `${api.baseUrl}/Items/${itemId}/Images/Primary?fillHeight=300&fillWidth=300&quality=90`;
  }

  function normalizeSong(raw: any): Song {
    return {
      id: raw.Id,
      originId: ctx.originId,
      originType: OriginType.JELLYFIN,
      name: raw.Name || "",
      artistName: raw.Artists?.[0]?.Name || raw.Artist || "",
      artistId: raw.Artists?.[0]?.Id,
      albumName: raw.Album,
      albumId: raw.AlbumId,
      albumArtistName: raw.AlbumArtist || raw.AlbumArtists?.[0]?.Name,
      albumArtistId: raw.AlbumArtists?.[0]?.Id,
      duration: raw.RunTimeTicks ? ticksToMs(raw.RunTimeTicks) : null,
      trackNumber: raw.IndexNumber,
      discNumber: raw.ParentIndexNumber,
      imageUrl: imageUrl(raw.AlbumId || raw.Id, raw.AlbumPrimaryImageTag || raw.PrimaryImageTag),
      genres: raw.Genres,
      releaseYear: raw.ProductionYear,
    };
  }

  function normalizeAlbum(raw: any): Album {
    return {
      id: raw.Id,
      originId: ctx.originId,
      originType: OriginType.JELLYFIN,
      name: raw.Name || "",
      albumArtistName: raw.AlbumArtist || raw.AlbumArtists?.[0]?.Name || "",
      songCount: raw.SongCount || raw.ChildCount,
      duration: raw.RunTimeTicks ? ticksToMs(raw.RunTimeTicks) : undefined,
      imageUrl: imageUrl(raw.Id, raw.ImageTags?.Primary || raw.PrimaryImageTag),
      releaseYear: raw.ProductionYear,
      genres: raw.Genres,
    };
  }

  function normalizeArtist(raw: any): AlbumArtist {
    return {
      id: raw.Id,
      originId: ctx.originId,
      originType: OriginType.JELLYFIN,
      name: raw.Name || "",
      albumCount: raw.AlbumCount || raw.ChildCount,
      imageUrl: imageUrl(raw.Id, raw.ImageTags?.Primary || raw.PrimaryImageTag),
      genres: raw.Genres,
    };
  }

  return {
    authenticate: async (url, username, password) => {
      const authApi = createJellyfinApi({ ...ctx, baseUrl: url });
      const users = await authApi.request<JellyfinUser[]>(`/Users/AuthenticateByName`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Username: username, Pw: password }),
      });
      return { token: "", username };
    },
    search: async (query, limit = 20) => {
      const data = await api.request<any>(`/Search/Hints?searchTerm=${encodeURIComponent(query)}&limit=${limit}`);
      const hints = data.SearchHints || [];
      const songs: Song[] = [];
      const albums: Album[] = [];
      const artists: AlbumArtist[] = [];

      hints.forEach((h: any) => {
        if (h.Type === "Audio" || h.MediaType === "Audio") {
          songs.push({
            id: h.ItemId || h.Id,
            originId: ctx.originId,
            originType: OriginType.JELLYFIN,
            name: h.Name || "",
            artistName: h.Artist || h.Artists?.[0]?.Name || "",
            albumName: h.Album,
            duration: h.RunTimeTicks ? ticksToMs(h.RunTimeTicks) : null,
            imageUrl: imageUrl(h.AlbumId || h.ItemId, h.AlbumPrimaryImageTag || h.PrimaryImageTag),
            releaseYear: h.ProductionYear,
          });
        } else if (h.Type === "MusicAlbum" || h.Type === "Album") {
          albums.push({
            id: h.ItemId || h.Id,
            originId: ctx.originId,
            originType: OriginType.JELLYFIN,
            name: h.Name || "",
            albumArtistName: h.Artist || h.AlbumArtist || "",
            songCount: h.SongCount,
            imageUrl: imageUrl(h.ItemId || h.Id, h.PrimaryImageTag),
            releaseYear: h.ProductionYear,
          });
        } else if (h.Type === "MusicArtist" || h.Type === "Artist") {
          artists.push({
            id: h.ItemId || h.Id,
            originId: ctx.originId,
            originType: OriginType.JELLYFIN,
            name: h.Name || "",
            imageUrl: imageUrl(h.ItemId || h.Id, h.PrimaryImageTag),
          });
        }
      });

      return { songs, albums, albumArtists: artists } as SearchResults;
    },
    getAlbumDetail: async (id) => {
      const raw = await api.request<any>(`/Users/me/Items/${id}`);
      if (!raw) return null;
      return normalizeAlbum(raw);
    },
    getAlbumList: async (offset = 0, limit = 20) => {
      const data = await api.request<any>(`/Users/me/Items?ParentId=&IncludeItemTypes=MusicAlbum&Recursive=true&SortBy=SortName&SortOrder=Ascending&StartIndex=${offset}&Limit=${limit}`);
      return (data.Items || []).map(normalizeAlbum);
    },
    getAlbumArtistDetail: async (id) => {
      const raw = await api.request<any>(`/Users/me/Items/${id}`);
      if (!raw) return null;
      return normalizeArtist(raw);
    },
    getAlbumArtistList: async (offset = 0, limit = 20) => {
      const data = await api.request<any>(`/Users/me/Items?ParentId=&IncludeItemTypes=MusicArtist&Recursive=true&SortBy=SortName&SortOrder=Ascending&StartIndex=${offset}&Limit=${limit}`);
      return (data.Items || []).map(normalizeArtist);
    },
    getSongList: async (offset = 0, limit = 20) => {
      const data = await api.request<any>(`/Users/me/Items?ParentId=&IncludeItemTypes=Audio&Recursive=true&SortBy=SortName&SortOrder=Ascending&StartIndex=${offset}&Limit=${limit}`);
      return (data.Items || []).map(normalizeSong);
    },
    getSongDetail: async (id) => {
      const raw = await api.request<any>(`/Users/me/Items/${id}`);
      if (!raw) return null;
      return normalizeSong(raw);
    },
    getPlaylistList: async () => {
      const data = await api.request<any>(`/Users/me/Items?IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&SortOrder=Ascending`);
      return (data.Items || []).map((p: any) => ({
        id: p.Id,
        originId: ctx.originId,
        originType: OriginType.JELLYFIN,
        name: p.Name || "",
        owner: p.Owner || p.CreatedById,
        songCount: p.ChildCount || p.SongCount,
        imageUrl: imageUrl(p.Id, p.ImageTags?.Primary),
        public: p.IsPublic,
      }));
    },
    getPlaylistDetail: async (id) => {
      const raw = await api.request<any>(`/Users/me/Items/${id}`);
      if (!raw) return null;
      return {
        id: raw.Id,
        originId: ctx.originId,
        originType: OriginType.JELLYFIN,
        name: raw.Name || "",
        owner: raw.Owner,
        songCount: raw.ChildCount || raw.SongCount,
        imageUrl: imageUrl(raw.Id, raw.ImageTags?.Primary),
        public: raw.IsPublic,
      };
    },
    getStreamUrl: async (songId) => {
      return `${api.baseUrl}/Audio/${songId}/stream?static=true`;
    },
    getImageUrl: async (songId) => {
      try {
        const raw = await api.request<any>(`/Users/me/Items/${songId}`);
        return imageUrl(raw.AlbumId || raw.Id, raw.AlbumPrimaryImageTag || raw.PrimaryImageTag);
      } catch {
        return null;
      }
    },
  };
}
