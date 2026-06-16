import type {
  MusicBrainzResponse,
  MBRecording,
  MBRelease,
  MBArtist,
  MBReleaseGroup,
  MusicBrainzReleaseGroupResponse,
} from "./musicbrainz-types";
import type { MusicBrainzContext } from "./musicbrainz-types";
import { getCachedQuery, setCachedQuery, hashQuery } from "./sqlite-db/sqlite-db-query";
import { useAuthStore } from "../stores/auth.store";
import { OriginType } from "../types/domain-types";

const BASE_URL = "https://musicbrainz.org/ws/2";
const COVER_ART_URL = "https://coverartarchive.org/release";
const RATE_LIMIT_MS = 1200;
const APP_NAME = "Selftify/1.0.0";

let lastMbRequestAt = 0;

function hashSearchQuery(params: Record<string, unknown>): string {
  const sorted = Object.keys(params).sort().map((k) => `${k}:${JSON.stringify(params[k])}`).join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const chr = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return "q_" + Math.abs(hash).toString(36);
}

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

  const electronApi = (window as any).electronApi;
  if (electronApi?.mbz?.fetch) {
    try {
      const result = await electronApi.mbz.fetch(url, Object.fromEntries(headers.entries()));
      const body = Array.isArray(result.body) ? new Uint8Array(result.body) : result.body;
      return new Response(body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    } catch (err) {
      console.warn("[mb-client] IPC fetch failed, falling back to direct fetch:", err);
    }
  }

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

function getLibraryRoot(): string | undefined {
  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  return origin?.folderPath || undefined;
}

async function getSqliteDbCached<T>(cacheKey: string): Promise<T | null> {
  const libraryRoot = getLibraryRoot();
  if (!libraryRoot) return null;
  const cached = await getCachedQuery(libraryRoot, "musicbrainz", cacheKey);
  if (cached?.raw?.data) {
    return cached.raw.data as T;
  }
  return null;
}

async function setSqliteDbCached(cacheKey: string, data: unknown): Promise<void> {
  const libraryRoot = getLibraryRoot();
  if (!libraryRoot) return;
  const originId = useAuthStore.getState().currentOrigin?.id || "mb";
  await setCachedQuery(libraryRoot, "musicbrainz", cacheKey, { songs: [], albums: [], albumArtists: [] }, originId, { data });
}

export async function searchRecordings(
  artist: string,
  recording: string,
  opts: MusicBrainzSearchOpts = {},
): Promise<MusicBrainzResponse<MBRecording>> {
  const query = opts.rawQuery ?? buildQuery({ artist, recording });
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const cacheKey = hashSearchQuery({ type: "recording", rawQuery: opts.rawQuery, artist, recording, limit, offset, inc: "releases+artist-credits" });

  const cached = await getSqliteDbCached<MusicBrainzResponse<MBRecording>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBRecording>>(
    `/recording/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=releases+artist-credits`,
  );

  await setSqliteDbCached(cacheKey, result);
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

  const cached = await getSqliteDbCached<MusicBrainzResponse<MBRelease>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBRelease>>(
    `/release/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=release-groups`,
  );

  await setSqliteDbCached(cacheKey, result);
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

  const cached = await getSqliteDbCached<MusicBrainzResponse<MBArtist>>(cacheKey);
  if (cached) return cached;

  const result = await apiGet<MusicBrainzResponse<MBArtist>>(
    `/artist/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json`,
  );

  await setSqliteDbCached(cacheKey, result);
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
  _ctx?: MusicBrainzContext,
): Promise<MBRelease | null> {
  const cacheKey = `rel-${releaseMbid}`;

  const cached = await getSqliteDbCached<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRelease>(
      `/release/${releaseMbid}?fmt=json&inc=artist-credits+recordings+media`,
    );
    await setSqliteDbCached(cacheKey, result);
    return result;
  } catch (err) {
    console.warn("[mb-client] getReleaseDetail failed:", err);
    return null;
  }
}

export async function getReleaseByReleaseGroup(
  rgId: string,
  _ctx?: MusicBrainzContext,
): Promise<MBRelease | null> {
  const cacheKey = `rel-rg-${rgId}`;

  const cached = await getSqliteDbCached<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MusicBrainzResponse<MBRelease>>(
      `/release?release-group=${rgId}&fmt=json&inc=artist-credits+recordings&limit=1`,
    );
    const release = result.releases?.[0] ?? null;
    if (release) {
      await setSqliteDbCached(cacheKey, release);
    }
    return release;
  } catch (err) {
    console.warn("[mb-client] getReleaseByReleaseGroup failed:", err);
    return null;
  }
}

export async function getRecordingDetail(
  recordingMbid: string,
  _ctx?: MusicBrainzContext,
): Promise<MBRecording | null> {
  const cacheKey = `rec-${recordingMbid}`;

  const cached = await getSqliteDbCached<MBRecording>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRecording>(
      `/recording/${recordingMbid}?fmt=json&inc=artist-credits+releases`,
    );
    await setSqliteDbCached(cacheKey, result);
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
  _ctx?: MusicBrainzContext,
): Promise<{ groups: MBReleaseGroup[]; total: number }> {
  const cacheKey = `rg-art-${artistMbid}-${limit}-${offset}`;

  const cached = await getSqliteDbCached<MusicBrainzReleaseGroupResponse>(cacheKey);
  if (cached) {
    return { groups: cached["release-groups"] ?? [], total: cached.count ?? 0 };
  }

  try {
    const result = await apiGet<MusicBrainzReleaseGroupResponse>(
      `/release-group?artist=${artistMbid}&fmt=json&limit=${limit}&offset=${offset}`,
    );
    await setSqliteDbCached(cacheKey, result);
    return { groups: result["release-groups"] ?? [], total: result.count ?? 0 };
  } catch (err) {
    console.warn("[mb-client] getArtistReleaseGroups failed:", err);
    return { groups: [], total: 0 };
  }
}

export async function getArtistDetail(
  artistMbid: string,
  _ctx?: MusicBrainzContext,
): Promise<MBArtist | null> {
  const cacheKey = `art-${artistMbid}`;

  const cached = await getSqliteDbCached<MBArtist>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBArtist>(
      `/artist/${artistMbid}?fmt=json&inc=tags`,
    );
    await setSqliteDbCached(cacheKey, result);
    return result;
  } catch (err) {
    console.warn("[mb-client] getArtistDetail failed:", err);
    return null;
  }
}
