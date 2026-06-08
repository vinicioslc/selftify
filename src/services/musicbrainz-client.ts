import type {
  MusicBrainzResponse,
  MBRecording,
  MBRelease,
  MBArtist,
  MBReleaseGroup,
  MusicBrainzReleaseGroupResponse,
} from "./musicbrainz-types";
import {
  getCachedMetadata,
  setCachedMetadata,
  getCachedSearch,
  setCachedSearch,
  hashSearchQuery,
} from "./musicbrainz-cache";
import { getDiskCache, type MusicBrainzContext } from "./musicbrainz-disk-cache";
// Local image cache removed — fetching cover URLs directly

import { useAuthStore } from "../stores/auth.store";
import { OriginType } from "../types/domain-types";

const BASE_URL = "https://musicbrainz.org/ws/2";
const COVER_ART_URL = "https://coverartarchive.org/release";
const RATE_LIMIT_MS = 1200;
const APP_NAME = "Selftify/1.0.0";

let lastMbRequestAt = 0;

async function musicbrainzFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", APP_NAME);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!headers.has("Authorization")) {
    const token = useAuthStore.getState().currentOrigin?.musicBrainzToken;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  const hasToken = Boolean(headers.get("Authorization"));
  const minGap = hasToken ? 200 : RATE_LIMIT_MS;
  const elapsed = Date.now() - lastMbRequestAt;
  if (elapsed < minGap) {
    await new Promise((r) => setTimeout(r, minGap - elapsed));
  }
  lastMbRequestAt = Date.now();
  return fetch(url, { ...init, headers });
}

async function apiGet<T>(endpoint: string): Promise<T> {
  const response = await musicbrainzFetch(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status}`);
  }
  return response.json();
}

function buildQuery(terms: Record<string, string>): string {
  return Object.entries(terms)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:"${v.replace(/"/g, "")}"`)
    .join(" AND ");
}

export type MusicBrainzSearchOpts = {
  limit?: number;
  offset?: number;
  rawQuery?: string;
};

export async function searchRecordings(
  artist: string,
  recording: string,
  opts: MusicBrainzSearchOpts = {},
): Promise<MusicBrainzResponse<MBRecording>> {
  const query = opts.rawQuery ?? buildQuery({ artist, recording });
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const cacheKey = hashSearchQuery({ type: "recording", rawQuery: opts.rawQuery, artist, recording, limit, offset, inc: "releases+artist-credits" });

  const cached = await getCachedSearch<MusicBrainzResponse<MBRecording>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBRecording>>(
    `/recording/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=releases+artist-credits`,
  );

  await setCachedSearch(cacheKey, result);
  return result;
}

export async function searchReleases(
  artist: string,
  release: string,
  opts: MusicBrainzSearchOpts = {},
): Promise<MusicBrainzResponse<MBRelease>> {
  const query = opts.rawQuery ?? buildQuery({ artist, release });
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const cacheKey = hashSearchQuery({ type: "release", rawQuery: opts.rawQuery, artist, release, limit, offset });

  const cached = await getCachedSearch<MusicBrainzResponse<MBRelease>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBRelease>>(
    `/release/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=release-groups`,
  );

  await setCachedSearch(cacheKey, result);
  return result;
}

export async function searchArtists(
  artist: string,
  opts: MusicBrainzSearchOpts = {},
): Promise<MusicBrainzResponse<MBArtist>> {
  const query = opts.rawQuery ?? buildQuery({ artist });
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const cacheKey = hashSearchQuery({ type: "artist", rawQuery: opts.rawQuery, artist, limit, offset });

  const cached = await getCachedSearch<MusicBrainzResponse<MBArtist>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBArtist>>(
    `/artist/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json`,
  );

  await setCachedSearch(cacheKey, result);
  return result;
}

export async function getCachedCoverUrl(releaseMbid: string): Promise<string | null> {
  try {
    const response = await musicbrainzFetch(`${COVER_ART_URL}/${releaseMbid}/front-250.jpg`);
    if (!response.ok) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("[mb-client] getCachedCoverUrl failed:", err);
    return null;
  }
}

export async function getReleaseDetail(
  releaseMbid: string,
  ctx?: MusicBrainzContext,
): Promise<MBRelease | null> {
  const cacheKey = `rel-${releaseMbid}`;
  const libraryRoot = ctx ? getLibraryRoot() : undefined;

  if (libraryRoot && ctx) {
    const r = await getDiskCache(libraryRoot).get<MBRelease>(ctx.artistName, cacheKey, ctx.artistMbid);
    if (r) return r;
  }

  const cached = await getCachedMetadata<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRelease>(
      `/release/${releaseMbid}?fmt=json&inc=artist-credits+recordings+media`,
    );
    await setCachedMetadata(cacheKey, result);
    if (libraryRoot && ctx) {
      await getDiskCache(libraryRoot).set(ctx.artistName, cacheKey, result, ctx.artistMbid);
    }
    return result;
  } catch (err) {
    console.warn("[mb-client] getReleaseDetail failed:", err);
    return null;
  }
}

export async function getReleaseByReleaseGroup(
  rgId: string,
  ctx?: MusicBrainzContext,
): Promise<MBRelease | null> {
  const cacheKey = `rel-rg-${rgId}`;
  const libraryRoot = ctx ? getLibraryRoot() : undefined;

  if (libraryRoot && ctx) {
    const r = await getDiskCache(libraryRoot).get<MBRelease>(ctx.artistName, cacheKey, ctx.artistMbid);
    if (r) return r;
  }

  const cached = await getCachedMetadata<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MusicBrainzResponse<MBRelease>>(
      `/release?release-group=${rgId}&fmt=json&inc=artist-credits+recordings&limit=1`,
    );
    const release = result.releases?.[0] ?? null;
    if (release) {
      await setCachedMetadata(cacheKey, release);
      if (libraryRoot && ctx) {
        await getDiskCache(libraryRoot).set(ctx.artistName, cacheKey, release, ctx.artistMbid);
      }
    }
    return release;
  } catch (err) {
    console.warn("[mb-client] getReleaseByReleaseGroup failed:", err);
    return null;
  }
}

export async function getRecordingDetail(
  recordingMbid: string,
  ctx?: MusicBrainzContext,
): Promise<MBRecording | null> {
  const cacheKey = `rec-${recordingMbid}`;
  const libraryRoot = ctx ? getLibraryRoot() : undefined;

  if (libraryRoot && ctx) {
    const r = await getDiskCache(libraryRoot).get<MBRelease>(ctx.artistName, cacheKey, ctx.artistMbid);
    if (r) return r;
  }

  const cached = await getCachedMetadata<MBRecording>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRecording>(
      `/recording/${recordingMbid}?fmt=json&inc=artist-credits+releases`,
    );
    await setCachedMetadata(cacheKey, result);
    if (libraryRoot && ctx) {
      await getDiskCache(libraryRoot).set(ctx.artistName, cacheKey, result, ctx.artistMbid);
    }
    return result;
  } catch (err) {
    console.warn("[mb-client] getRecordingDetail failed:", err);
    return null;
  }
}

export async function getArtistReleaseGroups(
  artistMbid: string,
  limit = 50,
  offset = 0,
  ctx?: MusicBrainzContext,
): Promise<{ groups: MBReleaseGroup[]; total: number }> {
  const cacheKey = `rg-art-${artistMbid}-${limit}-${offset}`;
  const libraryRoot = ctx ? getLibraryRoot() : undefined;

  if (libraryRoot && ctx) {
    const r = await getDiskCache(libraryRoot).get<MusicBrainzReleaseGroupResponse>(ctx.artistName, cacheKey, ctx.artistMbid);
    if (r) return { groups: r["release-groups"] ?? [], total: r.count ?? 0 };
  }

  const cached = await getCachedMetadata<MusicBrainzReleaseGroupResponse>(cacheKey);
  if (cached) return { groups: cached["release-groups"] ?? [], total: cached.count ?? 0 };

  try {
    const result = await apiGet<MusicBrainzReleaseGroupResponse>(
      `/release-group?artist=${artistMbid}&fmt=json&limit=${limit}&offset=${offset}`,
    );
    await setCachedMetadata(cacheKey, result);
    if (libraryRoot && ctx) {
      await getDiskCache(libraryRoot).set(ctx.artistName, cacheKey, result, ctx.artistMbid);
    }
    return { groups: result["release-groups"] ?? [], total: result.count ?? 0 };
  } catch (err) {
    console.warn("[mb-client] getArtistReleaseGroups failed:", err);
    return { groups: [], total: 0 };
  }
}

export async function getArtistDetail(
  artistMbid: string,
  ctx?: MusicBrainzContext,
): Promise<MBArtist | null> {
  const cacheKey = `art-${artistMbid}`;
  const libraryRoot = ctx ? getLibraryRoot() : undefined;

  if (libraryRoot && ctx) {
    const r = await getDiskCache(libraryRoot).get<MBArtist>(ctx.artistName, cacheKey, ctx.artistMbid);
    if (r) return r;
  }

  const cached = await getCachedMetadata<MBArtist>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBArtist>(
      `/artist/${artistMbid}?fmt=json&inc=tags`,
    );
    await setCachedMetadata(cacheKey, result);
    if (libraryRoot && ctx) {
      await getDiskCache(libraryRoot).set(ctx.artistName, cacheKey, result, ctx.artistMbid);
    }
    return result;
  } catch (err) {
    console.warn("[mb-client] getArtistDetail failed:", err);
    return null;
  }
}

function getLibraryRoot(): string | undefined {
  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  return origin?.folderPath || undefined;
}
