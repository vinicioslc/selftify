import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const youtubedl = require("youtube-dl-exec");

export type YoutubeSearchResult = {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
};

export function isSearchAvailable(): boolean {
  try {
    const bin = youtubedl.execPath;
    return !!bin && fs.existsSync(bin);
  } catch {
    return false;
  }
}

export async function searchYouTube(query: string, maxResults = 10): Promise<YoutubeSearchResult | null> {
  try {
    const searchQuery = `ytsearch${maxResults}:${query}`;
    const output: any = await youtubedl(searchQuery, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
    });

    let entries = output?.entries || [];
    if (!entries.length && output?.id) {
      entries = [output];
    }

    const results: YoutubeSearchResult[] = entries
      .filter((e: any) => e?.id)
      .map((e: any) => ({
        id: e.id,
        title: e.title || "",
        uploader: e.uploader || e.channel || e.uploader_id || "",
        duration: e.duration ? Number(e.duration) : undefined,
        thumbnail: e.thumbnail || undefined,
      }));

    if (results.length === 0) return null;
    return results[0];
  } catch (err) {
    console.warn("[youtube-search] search failed:", (err as Error).message);
    return null;
  }
}

export async function searchAllYouTube(query: string, maxResults = 10): Promise<YoutubeSearchResult[]> {
  try {
    const searchQuery = `ytsearch${maxResults}:${query}`;
    const output: any = await youtubedl(searchQuery, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
    });

    const entries = output?.entries || [];
    if (!entries.length && output?.id) {
      return [{
        id: output.id,
        title: output.title || "",
        uploader: output.uploader || output.channel || "",
        duration: output.duration ? Number(output.duration) : undefined,
        thumbnail: output.thumbnail || undefined,
      }];
    }

    return entries
      .filter((e: any) => e?.id)
      .map((e: any) => ({
        id: e.id,
        title: e.title || "",
        uploader: e.uploader || e.channel || e.uploader_id || "",
        duration: e.duration ? Number(e.duration) : undefined,
        thumbnail: e.thumbnail || undefined,
      }));
  } catch (err) {
    console.warn("[youtube-search] searchAll failed:", (err as Error).message);
    return [];
  }
}
