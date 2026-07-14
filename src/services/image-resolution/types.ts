// Unified image-resolution domain types.
// A single candidate/provider contract shared by album-cover and artist-image
// resolution so that one service, one ranking step and one cache serve both.

export type ImageMode = "album" | "artist";

export type ImageSearchInput = {
  artist: string;
  album?: string;
  title?: string;
  musicbrainzReleaseId?: string | null;
  musicbrainzReleaseGroupId?: string | null;
  musicbrainzArtistId?: string | null;
  isrc?: string;
  durationMs?: number;
};

export type ImageFetchMeta = {
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
};

export type ImageCandidate = {
  provider: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  sourceId?: string | null;
  sourceReleaseId?: string | null;
  confidence: number;
  isFrontCover?: boolean;
  blobUrl?: string | null;
  // Optional metadata persisted via tagImageSource when the blob is fetched.
  meta?: ImageFetchMeta;
};

export interface ImageProvider {
  readonly name: string;
  readonly modes?: readonly ImageMode[];
  search(input: ImageSearchInput, signal?: AbortSignal): Promise<ImageCandidate[]>;
}
