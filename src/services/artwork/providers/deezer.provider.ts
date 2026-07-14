import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { deezerAlbumCandidates } from "../../image-resolution/providers/shared";

const LOG = "[Deezer]";

export class DeezerProvider implements ArtworkProvider {
  readonly name = "deezer";
  readonly modes = ["album"] as const;

  async search(
    input: ArtworkSearchInput,
    _signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    console.log(`${LOG} searching: artist="${input.artist}" album="${input.album}"`);
    const results = await deezerAlbumCandidates(input.artist, input.album || input.title || "");
    console.log(`${LOG} got ${results.length} candidate(s) for "${input.artist}" / "${input.album}"`);
    return results;
  }
}
