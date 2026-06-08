import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

export class ITunesProvider implements ArtworkProvider {
  readonly name = "itunes";

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const query = `${input.artist} ${input.album || input.title || ""}`.trim();
    if (!query) return [];

    const params = new URLSearchParams({
      term: query,
      entity: "album",
      media: "music",
      limit: "3",
    });

    const url = `https://itunes.apple.com/search?${params}`;
    const res = await platformFetch(url, { signal });
    if (!res.ok) throw new Error(`iTunes ${res.status}`);

    const data = await res.json();

    return (data.results || []).map(
      (r: any): ArtworkCandidate => ({
        provider: this.name,
        url: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
        thumbnailUrl: r.artworkUrl60 || r.artworkUrl100,
        confidence: 0.82,
        isFrontCover: true,
      }),
    );
  }
}
