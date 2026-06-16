export type ArtistSearchInput = {
  artist: string;
  musicbrainzId?: string;
};

export type ArtistCandidate = {
  provider: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  sourceId?: string;
  blobUrl?: string | null;
};

export interface ArtistProvider {
  readonly name: string;
  search(input: ArtistSearchInput, signal?: AbortSignal): Promise<ArtistCandidate[]>;
}

export const ARTIST_PROVIDER_META: Record<string, { label: string; description: string; domain: string }> = {
  deezer: { label: "Deezer", description: "Deezer artist images", domain: "api.deezer.com" },
  itunes: { label: "iTunes Search", description: "Apple Music / iTunes artist images", domain: "itunes.apple.com" },
};
