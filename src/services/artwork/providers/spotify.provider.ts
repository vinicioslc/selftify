import type { ArtworkProvider, ArtworkSearchInput, ArtworkCandidate } from "./types";
import { platformFetch } from "../../platform-fetch";
import { useSettingsStore } from "../../../stores/settings.store";

let cachedToken: { token: string; expiresAt: number } | null = null;

export class SpotifyProvider implements ArtworkProvider {
  readonly name = "spotify";

  private async getToken(): Promise<string | null> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
      return cachedToken.token;
    }

    const settings = useSettingsStore.getState().artworkProviders.spotify;
    const clientId = settings?.apiKey;
    const clientSecret = settings?.apiSecret;
    if (!clientId || !clientSecret) return null;

    try {
      const basic = btoa(`${clientId}:${clientSecret}`);
      const res = await platformFetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      });

      if (!res.ok) {
        console.warn("[spotify] token error:", res.status);
        return null;
      }

      const data = await res.json();
      cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
      };
      return cachedToken.token;
    } catch (err) {
      console.warn("[spotify] token fetch failed:", err);
      return null;
    }
  }

  async search(
    input: ArtworkSearchInput,
    signal?: AbortSignal,
  ): Promise<ArtworkCandidate[]> {
    const token = await this.getToken();
    if (!token) return [];

    const query = `album:${input.album || ""} artist:${input.artist}`.trim();
    if (!query) return [];

    const params = new URLSearchParams({
      q: query,
      type: "album",
      limit: "3",
    });

    const url = `https://api.spotify.com/v1/search?${params}`;
    try {
      const res = await platformFetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`Spotify ${res.status}`);

      const data = await res.json();
      const candidates: ArtworkCandidate[] = [];

      for (const album of data.albums?.items || []) {
        if (!album.images?.length) continue;

        const sorted = [...album.images].sort(
          (a: any, b: any) => (b.width || 0) - (a.width || 0),
        );

        candidates.push({
          provider: this.name,
          url: sorted[0].url,
          thumbnailUrl: sorted[sorted.length - 1]?.url,
          width: sorted[0]?.width,
          height: sorted[0]?.height,
          confidence: 0.87,
          isFrontCover: true,
          sourceReleaseId: album.id,
        });
      }

      return candidates;
    } catch (err: any) {
      console.warn("[spotify] search failed:", err);
      return [];
    }
  }
}
