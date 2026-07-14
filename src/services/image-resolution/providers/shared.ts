// Single source of truth for Deezer and iTunes image search.
//
// Before this module, the Deezer/iTunes album-search was re-implemented in
// five places with subtly different exact-match and confidence logic. This
// file holds the canonical implementations; the album and artist provider
// adapters (in artwork/providers and artist-image/providers) are thin wrappers
// that call into here. One interface, N call sites.

import type { ImageCandidate } from "../types";
import { platformFetch } from "../../platform-fetch";

// ──────────────────────────────────────────────
// Deezer
// ──────────────────────────────────────────────

function deezerExactAlbum(data: any[], artist: string, album: string): any | undefined {
  const artistLower = artist.toLowerCase();
  const albumLower = album.toLowerCase();
  return data.find(
    (item) =>
      item.artist?.name?.toLowerCase() === artistLower &&
      item.title?.toLowerCase() === albumLower,
  );
}

function deezerExactArtist(data: any[], artist: string): any | undefined {
  const artistLower = artist.toLowerCase();
  return data.find((item) => item.name?.toLowerCase() === artistLower);
}

export async function deezerAlbumCandidates(
  artist: string,
  album: string,
): Promise<ImageCandidate[]> {
  const query = encodeURIComponent(`${artist} ${album}`);
  const url = `https://api.deezer.com/search/album?q=${query}`;

  const res = await platformFetch(url);
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const data = await res.json();
  if (!data.data?.length) return [];

  const exact = deezerExactAlbum(data.data, artist, album);
  const results = exact
    ? [exact, ...data.data.filter((r: any) => r !== exact).slice(0, 4)]
    : data.data.slice(0, 5);

  return results.map(
    (r: any): ImageCandidate => ({
      provider: "deezer",
      url: r.cover_xl || r.cover_big || r.cover_medium || r.cover,
      thumbnailUrl: r.cover_small || r.cover_medium,
      confidence: r === exact ? 0.95 : 0.78,
      sourceId: String(r.id),
      isFrontCover: true,
    }),
  );
}

export async function deezerArtistCandidates(artist: string): Promise<ImageCandidate[]> {
  const query = encodeURIComponent(artist);
  const url = `https://api.deezer.com/search/artist?q=${query}`;

  const res = await platformFetch(url);
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const data = await res.json();
  if (!data.data?.length) return [];

  const exact = deezerExactArtist(data.data, artist);
  const results = exact
    ? [exact, ...data.data.filter((r: any) => r !== exact).slice(0, 4)]
    : data.data.slice(0, 5);

  return results.map(
    (r: any): ImageCandidate => ({
      provider: "deezer",
      url: r.picture_xl || r.picture_big || r.picture_medium || r.picture,
      thumbnailUrl: r.picture_medium || r.picture_small || r.picture,
      sourceId: String(r.id),
      confidence: r === exact ? 0.92 : 0.8,
      isFrontCover: true,
    }),
  );
}

// ──────────────────────────────────────────────
// iTunes
// ──────────────────────────────────────────────

export async function itunesAlbumCandidates(
  artist: string,
  album: string,
): Promise<ImageCandidate[]> {
  const query = `${artist} ${album}`.trim();
  if (!query) return [];

  const params = new URLSearchParams({
    term: query,
    entity: "album",
    media: "music",
    limit: "3",
  });
  const url = `https://itunes.apple.com/search?${params}`;

  const res = await platformFetch(url);
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const data = await res.json();

  return (data.results || []).map(
    (r: any): ImageCandidate => ({
      provider: "itunes",
      url: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
      thumbnailUrl: r.artworkUrl60 || r.artworkUrl100,
      confidence: 0.82,
      isFrontCover: true,
    }),
  );
}

export async function itunesArtistCandidates(artist: string): Promise<ImageCandidate[]> {
  const query = artist.trim();
  if (!query) return [];

  // iTunes has no musicArtist artwork entity; search albums and keep the ones
  // whose artist matches exactly.
  const params = new URLSearchParams({
    term: query,
    entity: "album",
    media: "music",
    limit: "10",
  });
  const url = `https://itunes.apple.com/search?${params}`;

  const res = await platformFetch(url);
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const data = await res.json();

  const all = data.results || [];
  const artistLower = artist.toLowerCase();
  const exact = all.filter((r: any) => r.artistName?.toLowerCase() === artistLower);
  const results = exact.length > 0 ? exact : all.slice(0, 3);

  return results
    .map(
      (r: any): ImageCandidate => ({
        provider: "itunes",
        url: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
        thumbnailUrl: r.artworkUrl60 || r.artworkUrl100,
        sourceId: String(r.collectionId || ""),
        confidence: exact.length > 0 ? 0.85 : 0.7,
        isFrontCover: true,
      }),
    )
    .filter((c: ImageCandidate) => c.url);
}
