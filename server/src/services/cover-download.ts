import { resolveAlbumCoverByNames } from "./cover-resolver";

export async function downloadCover(
  artistName: string,
  albumName: string,
  imageUrl?: string | null,
  videoId?: string,
): Promise<number[] | null> {
  try {
    const result = await resolveAlbumCoverByNames(artistName, albumName, { imageUrl, videoId });
    if (result) {
      return Array.from(new Uint8Array(result.data));
    }
  } catch {
    // fall through
  }
  return null;
}