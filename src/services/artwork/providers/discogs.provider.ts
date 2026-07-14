import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";
import { useSettingsStore } from "../../../stores/settings.store";

export class DiscogsProvider implements ArtworkProvider {
  readonly name = "discogs";
  readonly modes = ["album"] as const;

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const token = (useSettingsStore.getState().artworkProviders as Record<string, any>).discogs?.token;
    if (!token) return [];

    const query = `${input.artist} ${input.album || input.title || ""}`.trim();
    if (!query) return [];

    const params = new URLSearchParams({
      q: query,
      type: "release",
      per_page: "5",
    });

    const url = `https://api.discogs.com/database/search?${params}`;
    try {
      const res = await platformFetch(url, {
        headers: {
          "User-Agent": "Selftify/1.0.0",
          Authorization: `Discogs token=${token}`,
        },
        signal,
      });
      if (!res.ok) throw new Error(`Discogs ${res.status}`);

      const data = await res.json();
      const candidates: ArtworkCandidate[] = [];

      for (const r of data.results || []) {
        if (!r.cover_image) continue;
        if (r.cover_image.includes("spacer.gif")) continue;

        candidates.push({
          provider: this.name,
          url: r.cover_image,
          thumbnailUrl: r.thumb,
          confidence: r.type === "master" ? 0.90 : 0.85,
          isFrontCover: true,
          sourceReleaseId: String(r.id),
        });
      }

      return candidates;
    } catch (err: any) {
      console.warn("[discogs] search failed:", err);
      return [];
    }
  }
}
