import { artworkQueue } from "./artwork-queue";
import type {
  ArtworkProvider,
  ArtworkSearchInput,
  ArtworkCandidate,
} from "./providers/types";
import { ITunesProvider } from "./providers/itunes.provider";
import { DeezerProvider } from "./providers/deezer.provider";

class ArtworkResolver {
  private providers: ArtworkProvider[];

  constructor() {
    this.providers = [
      new ITunesProvider(),
      new DeezerProvider(),
    ];
  }

  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  async resolveFromProvider(providerName: string, input: ArtworkSearchInput): Promise<ArtworkCandidate[]> {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) return [];
    try {
      return await artworkQueue.enqueue(
        provider.name,
        500,
        async (signal) => provider.search(input, signal),
      );
    } catch {
      return [];
    }
  }
}

export const artworkResolver = new ArtworkResolver();
