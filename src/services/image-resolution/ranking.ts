import type { ImageCandidate } from "./types";

// Stable priority used as a tie-breaker when candidates share a confidence.
// Lower number = ranked first. Order favours authoritative/official sources.
const PROVIDER_PRIORITY: Record<string, number> = {
  embedded: 0,
  cover_art_archive: 1,
  musicbrainz_release_group: 2,
  discogs: 3,
  fanart_tv: 4,
  spotify: 5,
  deezer: 6,
  itunes: 7,
  wikipedia: 8,
};

// One ranking step for every call site: highest confidence wins, provider
// priority breaks ties. Pure and side-effect free so it can be reused by both
// the auto-resolver and any management UI.
export function rankCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (PROVIDER_PRIORITY[a.provider] ?? 99) - (PROVIDER_PRIORITY[b.provider] ?? 99);
  });
}
