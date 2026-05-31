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
import { getImageUrlByTag, storeImage } from "./image-cache";

const BASE_URL = "https://musicbrainz.org/ws/2";
const COVER_ART_URL = "https://coverartarchive.org/release";
const RATE_LIMIT_MS = 1200;
const APP_NAME = "Selftify/1.0.0";

type QueueItem = {
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
  url: string;
  init: RequestInit;
};

let lastRequestTime = 0;
let pendingQueue: QueueItem[] = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (pendingQueue.length > 0) {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    const item = pendingQueue.shift()!;
    lastRequestTime = Date.now();
    try {
      const response = await fetch(item.url, item.init);
      item.resolve(response);
    } catch (err) {
      item.reject(err);
    }
  }
  processing = false;
}

function enqueueRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", APP_NAME);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  return new Promise<Response>((resolve, reject) => {
    pendingQueue.push({ resolve, reject, url, init: { ...init, headers } });
    processQueue();
  });
}

async function apiGet<T>(endpoint: string): Promise<T> {
  const response = await enqueueRequest(`${BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
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
    `/release/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json`,
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
  const tag = `mbz-cover/${releaseMbid}`;
  const cached = await getImageUrlByTag(tag);
  if (cached) return cached;

  try {
    const response = await enqueueRequest(`${COVER_ART_URL}/${releaseMbid}/front-250.jpg`);
    if (!response.ok) return null;

    const blob = await response.blob();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const format = contentType.startsWith("image/png") ? "image/png"
      : contentType.startsWith("image/webp") ? "image/webp"
      : "image/jpeg";

    await storeImage(blob, format, [tag]);
    return getImageUrlByTag(tag);
  } catch {
    return null;
  }
}

export async function getReleaseDetail(releaseMbid: string): Promise<MBRelease | null> {
  const cacheKey = `rel-${releaseMbid}`;

  const cached = await getCachedMetadata<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRelease>(
      `/release/${releaseMbid}?fmt=json&inc=artist-credits+recordings`,
    );
    await setCachedMetadata(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export async function getReleaseByReleaseGroup(rgId: string): Promise<MBRelease | null> {
  const cacheKey = `rel-rg-${rgId}`;

  const cached = await getCachedMetadata<MBRelease>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MusicBrainzResponse<MBRelease>>(
      `/release?release-group=${rgId}&fmt=json&inc=artist-credits+recordings&limit=1`,
    );
    const release = result.releases?.[0] ?? null;
    if (release) await setCachedMetadata(cacheKey, release);
    return release;
  } catch {
    return null;
  }
}

export async function getRecordingDetail(recordingMbid: string): Promise<MBRecording | null> {
  const cacheKey = `rec-${recordingMbid}`;

  const cached = await getCachedMetadata<MBRecording>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBRecording>(
      `/recording/${recordingMbid}?fmt=json&inc=artist-credits+releases`,
    );
    await setCachedMetadata(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export async function getArtistReleaseGroups(
  artistMbid: string,
  limit = 50,
  offset = 0,
): Promise<{ groups: MBReleaseGroup[]; total: number }> {
  const cacheKey = `rg-art-${artistMbid}-${limit}-${offset}`;

  const cached = await getCachedMetadata<MusicBrainzReleaseGroupResponse>(cacheKey);
  if (cached) return { groups: cached["release-groups"] ?? [], total: cached.count ?? 0 };

  try {
    const result = await apiGet<MusicBrainzReleaseGroupResponse>(
      `/release-group?artist=${artistMbid}&fmt=json&limit=${limit}&offset=${offset}`,
    );
    await setCachedMetadata(cacheKey, result);
    return { groups: result["release-groups"] ?? [], total: result.count ?? 0 };
  } catch {
    return { groups: [], total: 0 };
  }
}

export async function getArtistDetail(artistMbid: string): Promise<MBArtist | null> {
  const cacheKey = `art-${artistMbid}`;

  const cached = await getCachedMetadata<MBArtist>(cacheKey);
  if (cached) return cached;

  try {
    const result = await apiGet<MBArtist>(
      `/artist/${artistMbid}?fmt=json&inc=tags`,
    );
    await setCachedMetadata(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
