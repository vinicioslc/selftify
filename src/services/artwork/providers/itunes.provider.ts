import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { itunesAlbumCandidates } from "../../image-resolution/providers/shared";

const LOG = "[iTunes]";

export class ITunesProvider implements ArtworkProvider {
  readonly name = "itunes";
  readonly modes = ["album"] as const;

  async search(
    input: ArtworkSearchInput,
    _signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    console.log(`${LOG} searching: term="${input.artist} ${input.album}"`);
    const results = await itunesAlbumCandidates(input.artist, input.album || input.title || "");
    console.log(`${LOG} got ${results.length} result(s)`);
    return results;
  }
}
