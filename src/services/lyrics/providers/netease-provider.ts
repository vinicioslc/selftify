import type { LyricSearchQuery, LyricSearchResult } from "../../../types/lyrics-types";
import { LyricSource } from "../../../types/lyrics-types";
import { platformFetch } from "../../platform-fetch";

const SEARCH_URL = "https://music.163.com/api/search/get";
const LYRICS_URL = "https://music.163.com/api/song/lyric";
const TIMEOUT_MS = 5000;

export const name = LyricSource.NETEASE;

const lrcLineRegex = /\[(\d{2}:\d{2}\.\d{2,3})\](.*)/;

export async function search(params: LyricSearchQuery): Promise<LyricSearchResult[]> {
  const query = [params.artist, params.name].filter(Boolean).join(" ");
  if (!query) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await platformFetch(
      `${SEARCH_URL}?limit=5&offset=0&s=${encodeURIComponent(query)}&type=1`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    const songs = data?.result?.songs;
    if (!Array.isArray(songs)) return [];

    return songs.map((song: any) => {
      const artist = song.artists
        ? song.artists.map((a: any) => a.name).join(", ")
        : "";
      return {
        artist,
        id: String(song.id),
        isSync: null,
        name: song.name || "",
        source: LyricSource.NETEASE,
      };
    });
  } catch {
    return [];
  }
}

export async function getLyrics(id: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await platformFetch(
      `${LYRICS_URL}?id=${encodeURIComponent(id)}&kv=-1&lv=-1&tv=-1`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    return data?.lrc?.lyric || null;
  } catch {
    return null;
  }
}

export function mergeNeteaseTranslation(
  original: string | undefined,
  translated: string | undefined,
): string | null {
  if (!original) return null;
  if (!translated) return original;

  const translatedMap = new Map<string, string>();

  translated.split("\n").forEach((line) => {
    const match = line.match(lrcLineRegex);
    if (match) {
      const text = match[2].trim();
      if (text) translatedMap.set(match[1], text);
    }
  });

  if (translatedMap.size === 0) return original;

  const finalLines = original.split("\n").map((line) => {
    const match = line.match(lrcLineRegex);
    if (match) {
      const timestamp = match[1];
      const originalText = match[2].trim();
      const translatedText = translatedMap.get(timestamp);
      if (translatedText && originalText) {
        return `[${timestamp}]${originalText}_BREAK_${translatedText}`;
      }
    }
    return line;
  });

  return finalLines.join("\n");
}

export async function getLyricsWithTranslation(
  id: string,
  enableTranslation: boolean,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await platformFetch(
      `${LYRICS_URL}?id=${encodeURIComponent(id)}&kv=-1&lv=-1&tv=-1`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const originalLrc = data?.lrc?.lyric;

    if (!enableTranslation) return originalLrc || null;

    const translatedLrc = data?.tlyric?.lyric;
    return mergeNeteaseTranslation(originalLrc, translatedLrc);
  } catch {
    return null;
  }
}
