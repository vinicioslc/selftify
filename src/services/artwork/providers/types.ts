export type ArtworkSearchInput = {
  artist: string;
  album?: string;
  title?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  isrc?: string;
  durationMs?: number;
};

export type ArtworkCandidate = {
  provider: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  sourceReleaseId?: string;
  confidence: number;
  isFrontCover: boolean;
  blobUrl?: string | null;
};

export type ArtworkResult = {
  status: "resolved" | "no_providers" | "not_found" | "error";
  candidates: ArtworkCandidate[];
  winner?: string;
  elapsedMs: number;
};

export interface ArtworkProvider {
  readonly name: string;
  search(input: ArtworkSearchInput, signal?: AbortSignal): Promise<ArtworkCandidate[]>;
}
