// ImageResolutionService — the single seam for all cover/artwork resolution.
//
// Before, album covers and artist images were resolved through four
// overlapping entry points (cover-resolver, artwork/resolve-cover,
// ArtworkResolver, artist-image) each re-implementing provider selection,
// ranking and caching. This service owns:
//   • a single mode-aware provider registry (album + artist)
//   • one ranking step (rankCandidates)
//   • one shared blob cache (image-fetch.fetchImageAsBlobUrl)
//
// Call sites use resolveAlbumCover() / resolveArtistImage() for auto-resolution
// or getCandidates() to browse raw candidates from a single provider (used by
// the interactive management UIs).

import type { ImageMode, ImageSearchInput, ImageCandidate, ImageProvider } from "./types";
import { rankCandidates } from "./ranking";
import { fetchImageAsBlobUrl, tagImageSource } from "../image-fetch";
import { useSettingsStore } from "../../stores/settings.store";
import { artworkQueue } from "../artwork/artwork-queue";

import { EmbeddedProvider } from "../artwork/providers/embedded.provider";
import { CoverArtArchiveProvider } from "../artwork/providers/cover-art-archive.provider";
import { MusicBrainzRGProvider } from "../artwork/providers/musicbrainz-rg.provider";
import { DiscogsProvider } from "../artwork/providers/discogs.provider";
import { ITunesProvider } from "../artwork/providers/itunes.provider";
import { DeezerProvider } from "../artwork/providers/deezer.provider";

import { DeezerArtistProvider } from "../artist-image/providers/deezer.provider";
import { ITunesArtistProvider } from "../artist-image/providers/itunes.provider";
import { WikipediaProvider } from "./providers/wikipedia.provider";

const LOG = "[ImageResolutionService]";

class ImageResolutionService {
  private albumProviders: ImageProvider[];
  private artistProviders: ImageProvider[];

  constructor() {
    // Album-cover sources (registered in stable priority order).
    this.albumProviders = [
      new EmbeddedProvider(),
      new CoverArtArchiveProvider(),
      new MusicBrainzRGProvider(),
      new DiscogsProvider(),
      new ITunesProvider(),
      new DeezerProvider(),
    ];

    // Artist-image sources.
    this.artistProviders = [
      new DeezerArtistProvider(),
      new ITunesArtistProvider(),
      new WikipediaProvider(),
    ];
  }

  listProviders(mode: ImageMode): string[] {
    return this.providersFor(mode).map((p) => p.name);
  }

  getEnabledProviders(mode: ImageMode): ImageProvider[] {
    const settings = useSettingsStore.getState();
    return this.providersFor(mode).filter((p) => settings.isArtworkProviderEnabled(p.name));
  }

  private providersFor(mode: ImageMode): ImageProvider[] {
    return mode === "album" ? this.albumProviders : this.artistProviders;
  }

  /**
   * Raw candidates from a single provider. Used by the management UIs which let
   * the user browse and pick a specific image. Tries the Electron IPC backend
   * first (when available), then falls back to the renderer-side provider.
   */
  async getCandidates(
    providerName: string,
    mode: ImageMode,
    input: ImageSearchInput,
    signal?: AbortSignal,
  ): Promise<ImageCandidate[]> {
    const provider = this.providersFor(mode).find((p) => p.name === providerName);
    if (!provider) {
      console.warn(`${LOG} unknown provider "${providerName}" for mode "${mode}"`);
      return [];
    }

    try {
      if (mode === "album") {
        const paceMs = useSettingsStore.getState().getArtworkPaceMs(providerName);
        return await artworkQueue.enqueue(provider.name, paceMs, (s) =>
          provider.search(input, s),
        );
      }
      return await provider.search(input, signal);
    } catch (err) {
      console.error(`${LOG} "${providerName}" search failed:`, err);
      return [];
    }
  }

  /** Auto-resolve the best album cover across all enabled providers. */
  async resolveAlbumCover(input: ImageSearchInput): Promise<string | null> {
    const candidates = await this.gatherRanked("album", input);
    return this.firstResolvable(candidates);
  }

  /** Auto-resolve the best artist image across all enabled providers. */
  async resolveArtistImage(input: ImageSearchInput): Promise<string | null> {
    const candidates = await this.gatherRanked("artist", input);
    return this.firstResolvable(candidates);
  }

  private async gatherRanked(mode: ImageMode, input: ImageSearchInput): Promise<ImageCandidate[]> {
    const providers = this.getEnabledProviders(mode);
    const results = await Promise.allSettled(
      providers.map((p) => p.search(input)),
    );
    const candidates = results
      .filter((r): r is PromiseFulfilledResult<ImageCandidate[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);
    return rankCandidates(candidates);
  }

  // Walk the ranked candidates and return the first one that actually resolves
  // to a blob URL. Candidates may already carry a blobUrl (e.g. embedded local
  // images); otherwise we fetch via the shared cache.
  private async firstResolvable(candidates: ImageCandidate[]): Promise<string | null> {
    for (const c of candidates) {
      if (c.blobUrl) {
        if (c.meta) await tagImageSource(c.url, c.meta).catch(() => {});
        return c.blobUrl;
      }
      if (!c.url) continue;
      const blobUrl = await fetchImageAsBlobUrl(c.url).catch(() => null);
      if (blobUrl) {
        c.blobUrl = blobUrl;
        if (c.meta) await tagImageSource(c.url, c.meta).catch(() => {});
        return blobUrl;
      }
    }
    return null;
  }
}

export const imageResolutionService = new ImageResolutionService();
