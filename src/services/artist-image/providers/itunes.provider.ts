import type { ArtistProvider, ArtistSearchInput, ArtistCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

const LOG = "[iTunesArtist]";

export class ITunesArtistProvider implements ArtistProvider {
  readonly name = "itunes";

  async search(
    input: ArtistSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtistCandidate[]> {
    const query = input.artist.trim();
    if (!query) {
      console.warn(`${LOG} empty query`);
      return [];
    }

    // iTunes doesn't provide artwork for musicArtist entities.
    // Search albums instead and filter by exact artist name match.
    const params = new URLSearchParams({
      term: query,
      entity: "album",
      media: "music",
      limit: "10",
    });

    const url = `https://itunes.apple.com/search?${params}`;
    console.log(`${LOG} searching: term="${query}" url=${url}`);

    try {
      const res = await platformFetch(url, { signal });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          console.warn(`${LOG} HTTP ${res.status} for query "${query}"`);
        } else {
          console.error(`${LOG} HTTP ${res.status} for query "${query}"`);
        }
        return [];
      }

      const data = await res.json();
      const allResults = data.results || [];
      console.log(`${LOG} got ${allResults.length} raw result(s) for query "${query}"`);

      const artistLower = input.artist.toLowerCase();
      const exact = allResults.filter(
        (r: any) => r.artistName?.toLowerCase() === artistLower,
      );
      const results = exact.length > 0 ? exact : allResults.slice(0, 3);

      console.log(`${LOG} ${exact.length > 0 ? `${exact.length} exact match(es)` : "no exact match, using top results"} for "${input.artist}"`);

      return results.map(
        (r: any): ArtistCandidate => ({
          provider: this.name,
          url: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
          thumbnailUrl: r.artworkUrl60 || r.artworkUrl100,
          sourceId: String(r.collectionId || ""),
        }),
      ).filter((c: ArtistCandidate) => c.url);
    } catch (err) {
      console.warn(`${LOG} search failed for "${input.artist}":`, err);
      return [];
    }
  }
}
