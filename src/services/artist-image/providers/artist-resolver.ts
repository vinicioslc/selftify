import type { ArtistProvider, ArtistSearchInput, ArtistCandidate } from "./types";
import { DeezerArtistProvider } from "./deezer.provider";
import { ITunesArtistProvider } from "./itunes.provider";

const LOG = "[ArtistImageResolver]";

class ArtistImageResolver {
  private providers: ArtistProvider[];

  constructor() {
    this.providers = [
      new DeezerArtistProvider(),
      new ITunesArtistProvider(),
    ];
  }

  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  async search(
    providerName: string,
    input: ArtistSearchInput,
  ): Promise<ArtistCandidate[]> {
    const electronApi = (window as any).electronApi;
    if (electronApi?.artistImageSearch) {
      console.log(`${LOG} using Electron IPC for "${providerName}"`);
      try {
        const result = await electronApi.artistImageSearch(providerName, input);
        if (result.length > 0) {
          console.log(`${LOG} IPC result for "${providerName}": ${result.length} candidate(s)`);
          return result;
        }
        console.log(`${LOG} IPC returned 0 results for "${providerName}", trying renderer fallback`);
      } catch (err) {
        console.warn(`${LOG} IPC search failed for "${providerName}":`, err);
      }
    }

    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      console.warn(`${LOG} unknown provider "${providerName}"`);
      return [];
    }

    console.log(`${LOG} searching "${providerName}" for artist="${input.artist}"`);
    try {
      const result = await provider.search(input);
      console.log(`${LOG} "${providerName}" returned ${result.length} candidate(s)`);
      return result;
    } catch (err) {
      console.error(`${LOG} "${providerName}" search failed:`, err);
      return [];
    }
  }

  async searchAll(input: ArtistSearchInput): Promise<ArtistCandidate[]> {
    const results: ArtistCandidate[] = [];
    for (const provider of this.providers) {
      try {
        const candidates = await provider.search(input);
        results.push(...candidates);
      } catch (err) {
        console.warn(`${LOG} "${provider.name}" search failed:`, err);
      }
    }
    return results;
  }
}

export const artistImageResolver = new ArtistImageResolver();
