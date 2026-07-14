import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { findImages, recordToBlobUrl } from "../../image-store";

export class EmbeddedProvider implements ArtworkProvider {
  readonly name = "embedded";
  readonly modes = ["album"] as const;

  async search(
    input: ArtworkSearchInput,
    _signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    if (!input.artist) return [];

    const query: { artistName?: string; albumName?: string } = {
      artistName: input.artist.toLowerCase().trim(),
    };
    if (input.album) {
      query.albumName = input.album.toLowerCase().trim();
    }

    try {
      const records = await findImages(query as any);

      if (records.length === 0) return [];

      const candidates: ArtworkCandidate[] = [];
      for (const r of records) {
        let blobUrl: string | null = null;
        try {
          blobUrl = await recordToBlobUrl(r);
        } catch {}
        candidates.push({
          provider: this.name,
          url: blobUrl || r.sourceUrl || "",
          blobUrl,
          confidence: 0.7,
          isFrontCover: true,
          sourceReleaseId: undefined,
        });
      }
      return candidates;
    } catch {
      return [];
    }
  }
}
