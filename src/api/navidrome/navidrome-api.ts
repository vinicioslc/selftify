import type { ApiContext } from "../controller";

export function createNavidromeApi(ctx: ApiContext) {
  const baseUrl = ctx.baseUrl?.replace(/\/+$/, "") || "";

  async function request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${baseUrl}/rest/${endpoint}`);
    url.searchParams.set("v", "1.16.1");
    url.searchParams.set("c", "ytmusicplayer");
    url.searchParams.set("f", "json");
    url.searchParams.set("u", "user");
    url.searchParams.set("t", ctx.credential || "");
    url.searchParams.set("s", ctx.credential || "");

    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Navidrome API error: ${res.status}`);
    const data = await res.json();
    return data["subsonic-response"] as T;
  }

  return { request };
}

export type NavidromeAuthResponse = {
  status: string;
  serverVersion: string;
  type: string;
  data?: { username?: string; token?: string };
};

export type NavidromeSong = {
  id: string;
  parent?: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  year?: number;
  genre?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  bitRate?: number;
  path?: string;
  isDir?: boolean;
};

export type NavidromeAlbum = {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  genre?: string;
};

export type NavidromeArtist = {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
};

export type NavidromeDirectory = {
  id: string;
  name: string;
  child?: NavidromeSong[];
};

export type NavidromeSearchResult = {
  result: {
    totalHits?: number;
    album?: NavidromeAlbum[];
    artist?: NavidromeArtist[];
    song?: NavidromeSong[];
  };
};
