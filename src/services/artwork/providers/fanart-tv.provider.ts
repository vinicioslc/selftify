import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";
import { useSettingsStore } from "../../../stores/settings.store";

export class FanartTvProvider implements ArtworkProvider {
  readonly name = "fanart_tv";

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const apiKey = useSettingsStore.getState().artworkProviders.fanart_tv?.apiKey;
    if (!apiKey) return [];
    if (!input.musicbrainzReleaseGroupId && !input.musicbrainzReleaseId) return [];

    const mbid = input.musicbrainzReleaseGroupId || input.musicbrainzReleaseId;
    const url = `https://webservice.fanart.tv/v3/music/albums/${mbid}?api_key=${apiKey}`;

    try {
      const res = await platformFetch(url, { signal });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`Fanart.tv ${res.status}`);

      const data = await res.json();
      const candidates: ArtworkCandidate[] = [];

      if (data.albumcover) {
        for (const img of data.albumcover) {
          candidates.push({
            provider: this.name,
            url: img.url,
            thumbnailUrl: img.url,
            confidence: (img.likes || 0) > 0 ? 0.95 : 0.88,
            isFrontCover: true,
            sourceReleaseId: mbid,
          });
        }
      }

      return candidates;
    } catch (err: any) {
      if (err?.message?.includes("404")) return [];
      console.warn("[fanart] search failed:", err);
      return [];
    }
  }
}
