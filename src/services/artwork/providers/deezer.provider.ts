import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

export class DeezerProvider implements ArtworkProvider {
  readonly name = "deezer";

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const query = encodeURIComponent(`${input.artist} ${input.album || input.title || ""}`);
    const url = `https://api.deezer.com/search/album?q=${query}`;

    const res = await platformFetch(url, { signal });
    if (!res.ok) throw new Error(`Deezer ${res.status}`);

    const data = await res.json();
    if (!data.data?.length) return [];

    const artistLower = input.artist.toLowerCase();
    const albumLower = (input.album || input.title || "").toLowerCase();

    const exact = data.data.find((item: any) => {
      return (
        item.artist?.name?.toLowerCase() === artistLower &&
        item.title?.toLowerCase() === albumLower
      );
    });

    const results = exact ? [exact, ...data.data.filter((r: any) => r !== exact).slice(0, 4)] : data.data.slice(0, 5);

    return results.map(
      (r: any): ArtworkCandidate => ({
        provider: this.name,
        url: r.cover_xl || r.cover_big || r.cover_medium || r.cover,
        thumbnailUrl: r.cover_small || r.cover_medium,
        confidence: r === exact ? 0.95 : 0.78,
        sourceReleaseId: String(r.id),
        isFrontCover: true,
      }),
    );
  }
}
