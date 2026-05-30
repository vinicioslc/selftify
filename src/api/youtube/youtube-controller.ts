import type { ApiContext, SearchResults, ServerController } from "../controller";
import { getYouTubeClient, authenticateWithCookies } from "./youtube-api";
import { Song, Album, AlbumArtist, OriginType } from "../../types/domain-types";

export function createYouTubeController(ctx: ApiContext): ServerController {
  function normalizeVideo(raw: any): Song | null {
    if (!raw?.id || !raw?.title) return null;
    const duration = typeof raw.duration === "number"
      ? raw.duration * 1000
      : raw.duration?.seconds
        ? raw.duration.seconds * 1000
        : null;
    return {
      id: raw.id,
      originId: ctx.originId,
      originType: OriginType.YOUTUBE_MUSIC,
      name: raw.title?.toString() || "",
      artistName: raw.artists?.[0]?.name || raw.author?.name || "",
      artistId: raw.artists?.[0]?.channelId || raw.author?.channelId,
      albumName: raw.album?.name,
      albumId: raw.album?.id,
      duration,
      imageUrl: raw.thumbnails?.[0]?.url || null,
      trackNumber: 0,
      genres: raw.isExplicit ? ["Explicit"] : [],
      isVideo: raw.type === "video",
    };
  }

  async function searchYouTube(query: string): Promise<{ songs: Song[]; albums: Album[]; artists: AlbumArtist[] }> {
    try {
      const yt = await getYouTubeClient(ctx);
      const result = await (yt as any).music.search(query);
      const songs: Song[] = [];
      const albums: Album[] = [];
      const artists: AlbumArtist[] = [];

      (result?.videos || []).forEach((v: any) => {
        const song = normalizeVideo(v);
        if (song) songs.push(song);
      });
      (result?.songs || []).forEach((v: any) => {
        const song = normalizeVideo(v);
        if (song) songs.push(song);
      });
      (result?.albums || []).forEach((a: any) => {
        albums.push({
          id: a.id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: a.name || a.title?.toString() || "",
          albumArtistName: a.artists?.[0]?.name || a.author?.name || "",
          imageUrl: a.thumbnails?.[0]?.url || null,
          releaseYear: a.year,
        });
      });
      (result?.artists || []).forEach((a: any) => {
        artists.push({
          id: a.channelId || a.id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: a.name || a.title?.toString() || "",
          imageUrl: a.thumbnails?.[0]?.url || null,
        });
      });

      return { songs, albums, artists };
    } catch (err) {
      console.error("YouTube Music search error:", err);
      return { songs: [], albums: [], artists: [] };
    }
  }

  return {
    authenticate: async (_url, _username, password) => {
      const result = await authenticateWithCookies(password);
      return { token: result.cookie, username: result.username };
    },
    search: async (query, limit = 20) => {
      const result = await searchYouTube(query);
      return {
        songs: result.songs.slice(0, limit),
        albums: result.albums.slice(0, limit),
        albumArtists: result.artists.slice(0, limit),
      } as SearchResults;
    },
    getAlbumDetail: async (id) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const data = await (yt as any).music.getAlbum(id);
        const header = data.header;
        const title = header?.title?.toString?.() || header?.title || "";
        const subtitle = header?.subtitle?.toString?.() || "";
        const parts = subtitle.split("•").map((s: string) => s.trim());
        const artistName = parts[0] || "";
        const year = header?.year || parseInt(parts[1], 10) || null;
        const thumbs = header?.thumbnails || [];
        return {
          id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: title,
          albumArtistName: artistName,
          songCount: data.contents?.length || 0,
          imageUrl: thumbs[0]?.url || null,
          releaseYear: year,
        };
      } catch {
        return null;
      }
    },
    getAlbumList: async (offset = 0, limit = 20) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const data = await (yt as any).music.getHomeFeed();
        const items = data?.sections || [];
        const albums: Album[] = [];
        for (const section of items) {
          const contents = section.contents || [];
          for (const item of contents) {
            if (item.type === "MusicTwoRowItem") {
              const id = item.endpoint?.browseEndpoint?.browseId;
              if (id && item.title) {
                albums.push({
                  id,
                  originId: ctx.originId,
                  originType: OriginType.YOUTUBE_MUSIC,
                  name: item.title?.toString() || "",
                  albumArtistName: item.subtitle?.toString() || "",
                  imageUrl: item.thumbnail?.[0]?.url || null,
                });
              }
            }
          }
        }
        return albums.slice(offset, offset + limit);
      } catch {
        return [];
      }
    },
    getAlbumArtistDetail: async (id) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const data = await (yt as any).music.getArtist(id);
        const header = data.header;
        const title = header?.title?.toString?.() || header?.title || "";
        const thumbs = header?.thumbnail?.thumbnail || header?.thumbnails || [];
        return {
          id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: title,
          imageUrl: thumbs[0]?.url || null,
          biography: header?.description?.toString?.() || "",
        };
      } catch {
        return null;
      }
    },
    getAlbumArtistList: async () => [],
    getSongList: async () => [],
    getSongDetail: async () => null,
    getPlaylistList: async () => {
      try {
        const yt = await getYouTubeClient(ctx);
        const library = await (yt as any).music.getLibraryPlaylists();
        return (library?.items || []).map((p: any) => ({
          id: p.id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: p.title?.toString() || "",
          owner: p.author?.name,
          songCount: p.itemCount,
          imageUrl: p.thumbnails?.[0]?.url || null,
        }));
      } catch {
        return [];
      }
    },
    getPlaylistDetail: async (id) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const data = await (yt as any).music.getPlaylist(id);
        return {
          id,
          originId: ctx.originId,
          originType: OriginType.YOUTUBE_MUSIC,
          name: data.title?.toString() || "",
          owner: data.author?.name,
          songCount: data.content?.length || 0,
          imageUrl: data.thumbnails?.[0]?.url || null,
        };
      } catch {
        return null;
      }
    },
    getStreamUrl: async (songId) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const info = await yt.getBasicInfo(songId);
        const format = info.chooseFormat({ type: "audio", quality: "best" });
        return format?.url || null;
      } catch {
        return null;
      }
    },
    getImageUrl: async (songId) => {
      try {
        const yt = await getYouTubeClient(ctx);
        const info = await yt.getBasicInfo(songId);
        return info.basic_info?.thumbnail?.[0]?.url || null;
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
