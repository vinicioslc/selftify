import fs from "fs";
import { createRequire } from "module";
import { YtDlpStreamResolver } from "./stream-resolver";

const require = createRequire(import.meta.url);
const youtubedl = require("youtube-dl-exec");

export type DownloadRequest = {
  videoId: string;
  searchQuery: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumArtistName?: string;
  trackNumber?: number;
  releaseYear?: number;
  genres?: string[];
  imageUrl?: string | null;
  coverBytes?: number[] | null;
};

export type DownloadResult = {
  success: boolean;
  filePath?: string;
  coverPath?: string;
  error?: string;
};

const resolver = new YtDlpStreamResolver();

export function isYtDlpAvailable(): boolean {
  try {
    const bin = youtubedl.execPath;
    return !!bin && fs.existsSync(bin);
  } catch {
    return false;
  }
}

export async function downloadSong(req: DownloadRequest): Promise<DownloadResult> {
  try {
    const result = await resolver.resolve({
      videoId: req.videoId,
      searchQuery: req.searchQuery,
      songName: req.songName,
      artistName: req.artistName,
      albumName: req.albumName,
      albumArtistName: req.albumArtistName,
      trackNumber: req.trackNumber,
      releaseYear: req.releaseYear,
      genres: req.genres,
      coverBytes: req.coverBytes,
    });
    return { success: true, filePath: result.filePath, coverPath: result.coverPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}