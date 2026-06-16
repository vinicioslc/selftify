import type { ArtistProvider, ArtistSearchInput, ArtistCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

const LOG = "[DeezerArtist]";

export class DeezerArtistProvider implements ArtistProvider {
  readonly name = "deezer";

  async search(
    input: ArtistSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtistCandidate[]> {
    const query = encodeURIComponent(input.artist);
    const url = `https://api.deezer.com/search/artist?q=${query}`;

    console.log(`${LOG} searching: artist="${input.artist}" url=${url}`);

    try {
      const res = await platformFetch(url, { signal });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          console.warn(`${LOG} HTTP ${res.status} for "${input.artist}"`);
        } else {
          console.error(`${LOG} HTTP ${res.status} for "${input.artist}"`);
        }
        return [];
      }

      const data = await res.json();
      if (!data.data?.length) {
        console.log(`${LOG} no results for "${input.artist}"`);
        return [];
      }

      const artistLower = input.artist.toLowerCase();
      const exact = data.data.find(
        (item: any) => item.name?.toLowerCase() === artistLower,
      );

      const results = exact ? [exact, ...data.data.filter((r: any) => r !== exact).slice(0, 4)] : data.data.slice(0, 5);

      console.log(`${LOG} got ${results.length} candidate(s) (exact=${!!exact}) for "${input.artist}"`);

      return results.map(
        (r: any): ArtistCandidate => ({
          provider: this.name,
          url: r.picture_xl || r.picture_big || r.picture_medium || r.picture,
          thumbnailUrl: r.picture_medium || r.picture_small || r.picture,
          sourceId: String(r.id),
        }),
      );
    } catch (err) {
      console.warn(`${LOG} search failed for "${input.artist}":`, err);
      return [];
    }
  }
}
