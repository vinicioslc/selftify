import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";

const MB_API = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Selftify/1.0.0 (music-player)";

export class MusicBrainzRGProvider implements ArtworkProvider {
  readonly name = "musicbrainz_release_group";
  readonly modes = ["album"] as const;

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const rgId = input.musicbrainzReleaseGroupId;
    if (!rgId && !input.artist) return [];

    if (rgId) {
      return this.fromReleaseGroup(rgId, signal);
    }

    return this.searchByArtistAlbum(input, signal);
  }

  private async fromReleaseGroup(
    rgId: string,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const releases = await this.fetchReleasesForRG(rgId, signal);
    if (releases.length === 0) return [];

    const results: ArtworkCandidate[] = [];

    for (const release of releases) {
      try {
        const caaUrl = `https://coverartarchive.org/release/${release.id}`;
        const caaRes = await platformFetch(caaUrl, {
          headers: { Accept: "application/json" },
          signal,
        });

        if (caaRes.status === 404) continue;
        if (!caaRes.ok) continue;

        const data = await caaRes.json();
        for (const img of data.images) {
          if (img.front || img.types?.includes("Front")) {
            results.push({
              provider: this.name,
              url: img.image,
              thumbnailUrl: img.thumbnails?.large || img.thumbnails?.small,
              sourceReleaseId: release.id,
              confidence: img.approved ? 0.90 : 0.85,
              isFrontCover: true,
            });
          }
        }
      } catch {
        continue;
      }
    }

    return results;
  }

  private async searchByArtistAlbum(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const query = `artist:"${input.artist}" releasegroup:"${input.album || input.title || ""}"`;
    const params = new URLSearchParams({
      query,
      fmt: "json",
      limit: "5",
    });

    const url = `${MB_API}/release-group?${params}`;
    const res = await platformFetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal,
    });

    if (!res.ok) throw new Error(`MB RG search ${res.status}`);
    const data = await res.json();

    const candidates: ArtworkCandidate[] = [];
    for (const rg of data["release-groups"] || []) {
      const rgResults = await this.fromReleaseGroup(rg.id, signal);
      candidates.push(...rgResults);
      if (candidates.length > 0) break;
    }

    return candidates;
  }

  private async fetchReleasesForRG(
    rgId: string,
    signal?: AbortSignal,
  ): Promise<Array<{ id: string }>> {
    const params = new URLSearchParams({
      "release-group": rgId,
      fmt: "json",
      limit: "10",
    });

    const url = `${MB_API}/release?${params}`;
    const res = await platformFetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal,
    });

    if (!res.ok) throw new Error(`MB releases ${res.status}`);
    const data = await res.json();
    return (data.releases || []).map((r: any) => ({ id: r.id }));
  }
}
