import type { Song } from "../../types/domain-types";
import type {
  FullLyricsMetadata,
  LyricGetQuery,
  LyricSearchQuery,
  LyricSearchResult,
  LyricSource,
} from "../../types/lyrics-types";
import { parseLrc } from "./lrc-parser";
import { orderSearchResults } from "./lyrics-ranking";
import * as lrclib from "./providers/lrclib-provider";
import * as netease from "./providers/netease-provider";

const MATCH_THRESHOLD = 0.55;

const PROVIDERS = [lrclib, netease] as const;

interface ProviderModule {
  name: LyricSource;
  search(params: LyricSearchQuery): Promise<LyricSearchResult[]>;
  getLyrics(id: string): Promise<string | null>;
}

export async function getLocalLyrics(song: Song): Promise<FullLyricsMetadata | null> {
  // 1. Check embedded lyrics from MP3 tags
  if (song.lyricsEmbedded) {
    const lyrics = parseLrc(song.lyricsEmbedded);
    return {
      artist: song.artistName,
      lyrics,
      name: song.name,
      remote: false,
      source: "Embedded",
    };
  }

  // 2. Check .lrc sidecar file path
  if (song.lyricsPath) {
    try {
      // lyricsPath would need platform service to read file
      // This is a placeholder - actual reading happens at integration layer
      return {
        artist: song.artistName,
        lyrics: song.name,
        name: song.name,
        remote: false,
        source: "LRC File",
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function getRemoteLyrics(song: Song): Promise<FullLyricsMetadata | null> {
  const params: LyricSearchQuery = {
    album: song.albumName || song.name,
    artist: song.artistName || song.albumArtistName || "",
    duration: song.duration ? song.duration / 1000 : undefined,
    name: song.name,
  };

  const sourcesResult = await searchEnabledSources(params);
  if (sourcesResult.length === 0) return null;

  const ranked = orderSearchResults({ params, results: sourcesResult });
  const bestMatch = ranked[0];

  if (!bestMatch || (bestMatch.score ?? 1) > MATCH_THRESHOLD) return null;

  const provider = findProvider(bestMatch.source);
  if (!provider) return null;

  try {
    const rawLyrics = await provider.getLyrics(bestMatch.id);
    if (!rawLyrics) return null;

    const lyrics = parseLrc(rawLyrics);
    return {
      artist: bestMatch.artist,
      lyrics,
      name: bestMatch.name,
      remote: true,
      source: bestMatch.source,
    };
  } catch {
    return null;
  }
}

export async function getLyrics(song: Song): Promise<FullLyricsMetadata | null> {
  // Prefer local if available
  const local = await getLocalLyrics(song);
  if (local) return local;

  // Fall back to remote
  return getRemoteLyrics(song);
}

export async function searchAll(
  params: LyricSearchQuery,
): Promise<Record<string, LyricSearchResult[]>> {
  const results: Record<string, LyricSearchResult[]> = {};

  const searchPromises = PROVIDERS
    .map(async (provider) => {
      try {
        const items = await provider.search(params);
        return { source: provider.name, items };
      } catch {
        return { source: provider.name, items: [] as LyricSearchResult[] };
      }
    });

  const settled = await Promise.allSettled(searchPromises);
  for (const r of settled) {
    if (r.status === "fulfilled") {
      results[r.value.source] = r.value.items;
    }
  }

  return results;
}

async function searchEnabledSources(
  params: LyricSearchQuery,
): Promise<LyricSearchResult[]> {
  const all: LyricSearchResult[] = [];
  const searchPromises = PROVIDERS.map(async (provider) => {
    try {
      return await provider.search(params);
    } catch {
      return [] as LyricSearchResult[];
    }
  });

  const settled = await Promise.allSettled(searchPromises);
  for (const r of settled) {
    if (r.status === "fulfilled") {
      all.push(...r.value);
    }
  }
  return all;
}

export async function getRemoteLyricsById(
  query: LyricGetQuery,
): Promise<string | null> {
  const provider = findProvider(query.remoteSource);
  if (!provider) return null;

  try {
    return await provider.getLyrics(query.remoteSongId);
  } catch {
    return null;
  }
}

function findProvider(source: LyricSource): ProviderModule | null {
  return PROVIDERS.find((p) => p.name === source) ?? null;
}
