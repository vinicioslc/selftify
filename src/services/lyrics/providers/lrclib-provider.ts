import type { LyricSearchQuery, LyricSearchResult } from "../../../types/lyrics-types";
import { LyricSource } from "../../../types/lyrics-types";
import { platformFetch } from "../../platform-fetch";

const SEARCH_URL = "https://lrclib.net/api/search";
const GET_URL = "https://lrclib.net/api/get";
const TIMEOUT_MS = 5000;
const USER_AGENT = "Selftify/1.0 (https://github.com/vinicioslc/selftify)";

export const name = LyricSource.LRCLIB;

export async function search(params: LyricSearchQuery): Promise<LyricSearchResult[]> {
  if (!params.name && !params.artist) return [];

  const query = [params.name, params.artist].filter(Boolean).join(" ");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await platformFetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((song: any) => ({
      artist: song.artistName || "",
      id: String(song.id),
      isSync: song.syncedLyrics ? true : false,
      name: song.name || "",
      source: LyricSource.LRCLIB,
    }));
  } catch {
    return [];
  }
}

export async function getLyrics(id: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await platformFetch(`${GET_URL}/${id}`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (data?.instrumental) return null;

    return data?.syncedLyrics || data?.plainLyrics || null;
  } catch {
    return null;
  }
}
