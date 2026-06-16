import type {
  MusicBrainzResponse,
  MBRecording,
  MBRelease,
  MBArtist,
  MBReleaseGroup,
  MusicBrainzReleaseGroupResponse,
} from "./musicbrainz-types";

const BASE_URL = "https://musicbrainz.org/ws/2";

export function hashSearchQuery(params: Record<string, unknown>): string {
  const sorted = Object.keys(params).sort().map((k) => `${k}:${JSON.stringify(params[k])}`).join("|");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const chr = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return "q_" + Math.abs(hash).toString(36);
}

export function buildQuery(terms: Record<string, string>): string {
  return Object.entries(terms)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:"${v.replace(/"/g, "")}"`)
    .join(" AND ");
}

export function buildSearchRecordingsEndpoint(query: string, limit: number, offset: number): string {
  return `/recording/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=releases+artist-credits`;
}

export function buildSearchReleasesEndpoint(query: string, limit: number, offset: number): string {
  return `/release/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json&inc=release-groups`;
}

export function buildSearchArtistsEndpoint(query: string, limit: number, offset: number): string {
  return `/artist/?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&fmt=json`;
}

export function buildReleaseDetailEndpoint(releaseMbid: string): string {
  return `/release/${releaseMbid}?fmt=json&inc=artist-credits+recordings+media`;
}

export function buildReleaseByReleaseGroupEndpoint(rgId: string): string {
  return `/release?release-group=${rgId}&fmt=json&inc=artist-credits+recordings&limit=1`;
}

export function buildRecordingDetailEndpoint(recordingMbid: string): string {
  return `/recording/${recordingMbid}?fmt=json&inc=artist-credits+releases`;
}

export function buildArtistReleaseGroupsEndpoint(artistMbid: string, limit: number, offset: number): string {
  return `/release-group?artist=${artistMbid}&fmt=json&limit=${limit}&offset=${offset}`;
}

export function buildArtistDetailEndpoint(artistMbid: string): string {
  return `/artist/${artistMbid}?fmt=json&inc=tags`;
}

export function buildFullUrl(endpoint: string): string {
  return `${BASE_URL}${endpoint}`;
}

export function normalizeReleaseGroupResponse(
  result: MusicBrainzReleaseGroupResponse,
): { groups: MBReleaseGroup[]; total: number } {
  return { groups: result["release-groups"] ?? [], total: result.count ?? 0 };
}

export function pickFirstRelease<T extends { releases?: { id: string }[] }>(
  result: MusicBrainzResponse<{ id: string }>,
): string | null {
  return result.releases?.[0]?.id ?? null;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status}`);
  }
  return response.json();
}

export type {
  MusicBrainzResponse,
  MBRecording,
  MBRelease,
  MBArtist,
  MBReleaseGroup,
};
