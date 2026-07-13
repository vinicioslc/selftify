export type CoverInput = {
  artistName?: string | null;
  albumName?: string | null;
  mbzArtistId?: string | null;
  mbzReleaseGroupId?: string | null;
  mbzReleaseId?: string | null;
  imageUrl?: string | null;
};

export type CoverSource = "backend" | "none";

export type CoverResult = {
  source: CoverSource;
  blobUrl: string | null;
};

export async function resolveCover(input: CoverInput): Promise<CoverResult> {
  return { source: "none", blobUrl: null };
}

export async function resolveAlbumCoverLocalOnly(input: CoverInput): Promise<CoverResult> {
  return { source: "none", blobUrl: null };
}

export async function resolveAlbumCover(input: CoverInput): Promise<CoverResult> {
  return { source: "none", blobUrl: null };
}
