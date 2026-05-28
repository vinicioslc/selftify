import type { ApiContext } from "../controller";

export function createJellyfinApi(ctx: ApiContext) {
  const baseUrl = ctx.baseUrl?.replace(/\/+$/, "") || "";

  function authHeader(): Record<string, string> {
    return {
      Authorization: `MediaBrowser Client="YTMusicPlayer", Device="Web", DeviceId="web", Version="1.0.0"`,
      "X-Emby-Token": ctx.credential || "",
    };
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...authHeader(),
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) throw new Error(`Jellyfin API error: ${res.status}`);
    return res.json() as Promise<T>;
  }

  return { request, baseUrl, authHeader };
}

export type JellyfinUser = {
  Name: string;
  Id: string;
  Policy?: Record<string, unknown>;
};

export type JellyfinItem = {
  Id: string;
  Name: string;
  AlbumArtist?: string;
  AlbumArtists?: Array<{ Id: string; Name: string }>;
  AlbumId?: string;
  Album?: string;
  Artists?: Array<{ Id: string; Name: string }>;
  ArtistItems?: Array<{ Id: string; Name: string }>;
  Artist?: string;
  SongCount?: number;
  ChildCount?: number;
  DurationTicks?: number;
  RunTimeTicks?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  Genres?: string[];
  ImageTags?: Record<string, string>;
  AlbumPrimaryImageTag?: string;
  PrimaryImageTag?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  MediaType?: string;
  Type?: string;
  MediaStreams?: Array<{
    Type: string;
    Codec: string;
    BitRate: number;
    Channels: number;
    SampleRate: number;
  }>;
  Path?: string;
};
