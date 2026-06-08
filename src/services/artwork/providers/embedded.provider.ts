import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";

export class EmbeddedProvider implements ArtworkProvider {
  readonly name = "embedded";

  async search(
    _input: ArtworkSearchInput,
    _signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    return [];
  }
}
