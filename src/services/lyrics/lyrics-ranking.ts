import Fuse, { type FuseResult } from "fuse.js";
import type { LyricSearchQuery, LyricSearchResult } from "../../types/lyrics-types";

export function orderSearchResults(args: {
  params: LyricSearchQuery;
  results: LyricSearchResult[];
}): LyricSearchResult[] {
  const { params, results } = args;

  if (!params.artist && !params.name) {
    return results;
  }

  if (params.artist && params.name) {
    return rankWithBoth(results, params.artist, params.name);
  }

  const fuse = new Fuse(results, {
    includeScore: true,
    keys: [
      ...(params.name ? [{ name: "name" as const, weight: 2 }] : []),
      ...(params.artist ? [{ name: "artist" as const, weight: 2 }] : []),
    ],
    threshold: 0.6,
  });

  const searchTerm = [params.name, params.artist].filter(Boolean).join(" ");
  const fuseResults = fuse.search(searchTerm);

  return sortAndMap(fuseResults);
}

function rankWithBoth(
  results: LyricSearchResult[],
  artist: string,
  name: string,
): LyricSearchResult[] {
  const artistFuse = new Fuse(results, {
    includeScore: true,
    keys: [{ name: "artist" as const }],
    threshold: 0.6,
  });

  const nameFuse = new Fuse(results, {
    includeScore: true,
    keys: [{ name: "name" as const }],
    threshold: 0.6,
  });

  const artistResults = artistFuse.search(artist);
  const nameResults = nameFuse.search(name);

  const artistScores = new Map(artistResults.map((r) => [r.item.id, r.score ?? 1]));
  const nameScores = new Map(nameResults.map((r) => [r.item.id, r.score ?? 1]));

  const combinedMap = new Map<string, { item: LyricSearchResult; score: number }>();

  for (const ar of artistResults) {
    const ns = nameScores.get(ar.item.id);
    if (ns !== undefined) {
      combinedMap.set(ar.item.id, {
        item: ar.item,
        score: Math.max(ar.score ?? 1, ns),
      });
    }
  }

  for (const nr of nameResults) {
    if (!combinedMap.has(nr.item.id)) {
      const as = artistScores.get(nr.item.id);
      if (as !== undefined) {
        combinedMap.set(nr.item.id, {
          item: nr.item,
          score: Math.max(nr.score ?? 1, as),
        });
      }
    }
  }

  const combined = Array.from(combinedMap.values());

  // Sort: synced first, then by score
  combined.sort((a, b) => {
    const aSync = a.item.isSync === true ? 1 : 0;
    const bSync = b.item.isSync === true ? 1 : 0;
    if (aSync !== bSync) return bSync - aSync;
    return (a.score ?? 0) - (b.score ?? 0);
  });

  return combined.map((c) => ({ ...c.item, score: c.score }));
}

function sortAndMap(
  fuseResults: FuseResult<LyricSearchResult>[],
): LyricSearchResult[] {
  const sorted = [...fuseResults].sort((a, b) => {
    const aSync = a.item.isSync === true ? 1 : 0;
    const bSync = b.item.isSync === true ? 1 : 0;
    if (aSync !== bSync) return bSync - aSync;
    return (a.score ?? 0) - (b.score ?? 0);
  });

  return sorted.map((r) => ({ ...r.item, score: r.score }));
}
