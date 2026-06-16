import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

const LOG = "[iTunes]";

export class ITunesProvider implements ArtworkProvider {
  readonly name = "itunes";

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const query = `${input.artist} ${input.album || input.title || ""}`.trim();
    if (!query) {
      console.warn(`${LOG} empty query (artist="${input.artist}" album="${input.album}")`);
      return [];
    }

    const params = new URLSearchParams({
      term: query,
      entity: "album",
      media: "music",
      limit: "3",
    });

    const url = `https://itunes.apple.com/search?${params}`;
    console.log(`${LOG} searching: term="${query}" url=${url}`);

    const res = await platformFetch(url, { signal });
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        console.warn(`${LOG} HTTP ${res.status} for query "${query}"`);
      } else {
        console.error(`${LOG} HTTP ${res.status} for query "${query}"`);
      }
      throw new Error(`iTunes ${res.status}`);
    }

    const data = await res.json();
    const count = (data.results || []).length;
    console.log(`${LOG} got ${count} result(s) for query "${query}"`);

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
