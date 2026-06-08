import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

export class CoverArtArchiveProvider implements ArtworkProvider {
  readonly name = "cover_art_archive";

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    if (!input.musicbrainzReleaseId) return [];

    const url = `https://coverartarchive.org/release/${input.musicbrainzReleaseId}`;
    const res = await platformFetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });

    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`CAA ${res.status}`);

    const data = await res.json();

    return data.images
      .filter(
        (img: any) => img.front || img.types?.includes("Front"),
      )
      .map(
        (img: any): ArtworkCandidate => ({
          provider: this.name,
          url: img.image,
          thumbnailUrl: img.thumbnails?.large || img.thumbnails?.small,
          sourceReleaseId: input.musicbrainzReleaseId,
          confidence: img.approved ? 0.98 : 0.92,
          isFrontCover: true,
        }),
      );
  }
}
