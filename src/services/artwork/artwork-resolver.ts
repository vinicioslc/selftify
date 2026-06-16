import { useSettingsStore } from "../../stores/settings.store";
import { artworkQueue } from "./artwork-queue";
import type {
  ArtworkProvider,
  ArtworkSearchInput,
  ArtworkCandidate,
} from "./providers/types";
import { DiscogsProvider } from "./providers/discogs.provider";
import { ITunesProvider } from "./providers/itunes.provider";
import { DeezerProvider } from "./providers/deezer.provider";
import { CoverArtArchiveProvider } from "./providers/cover-art-archive.provider";
import { MusicBrainzRGProvider } from "./providers/musicbrainz-rg.provider";
import { EmbeddedProvider } from "./providers/embedded.provider";

const LOG = "[ArtworkResolver]";

class ArtworkResolver {
  private providers: ArtworkProvider[];

  constructor() {
    this.providers = [
      new CoverArtArchiveProvider(),
      new MusicBrainzRGProvider(),
      new ITunesProvider(),
      new DeezerProvider(),
      new EmbeddedProvider(),
      new DiscogsProvider(),
    ];
  }

  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  getEnabledProviderNames(): string[] {
    const settings = useSettingsStore.getState();
    return this.providers
      .filter((p) => settings.isArtworkProviderEnabled(p.name))
      .map((p) => p.name);
  }

  async resolveFromProvider(providerName: string, input: ArtworkSearchInput): Promise<ArtworkCandidate[]> {
    // Try Electron IPC backend first (main process search)
    const electronApi = (window as any).electronApi;
    if (electronApi?.artworkSearch) {
      console.log(`${LOG} using Electron IPC for "${providerName}"`);
      try {
        const result = await electronApi.artworkSearch(providerName, input);
        if (result.length > 0) {
          console.log(`${LOG} IPC result for "${providerName}": ${result.length} candidate(s)`);
          return result;
        }
        console.log(`${LOG} IPC returned 0 results for "${providerName}", trying renderer fallback`);
      } catch (err) {
        console.warn(`${LOG} IPC search failed for "${providerName}":`, err);
      }
    }

    // Fallback to renderer-side providers
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      console.warn(`${LOG} unknown provider "${providerName}"`);
      return [];
    }

    const settings = useSettingsStore.getState();
    const paceMs = settings.getArtworkPaceMs(providerName);

    console.log(`${LOG} searching "${providerName}" for artist="${input.artist}" album="${input.album}"`);
    try {
      const result = await artworkQueue.enqueue(
        provider.name,
        paceMs,
        async (signal) => provider.search(input, signal),
      );
      console.log(`${LOG} "${providerName}" returned ${result.length} candidate(s)`);
      return result;
    } catch (err) {
      console.error(`${LOG} "${providerName}" search failed:`, err);
      return [];
    }
  }
}

export const artworkResolver = new ArtworkResolver();
