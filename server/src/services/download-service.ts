import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { getSettings } from "./settings";

const require = createRequire(import.meta.url);
const youtubedl = require("youtube-dl-exec");
const ffmpegPath: string | null = require("ffmpeg-static") || null;
const ffmpeg = require("fluent-ffmpeg");

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

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
  coverArtData?: number[] | null;
};

export type DownloadResult = {
  success: boolean;
  filePath?: string;
  error?: string;
};

export function isYtDlpAvailable(): boolean {
  try {
    const bin = youtubedl.execPath;
    return !!bin && fs.existsSync(bin);
  } catch {
    return false;
  }
}

export async function downloadSong(req: DownloadRequest): Promise<DownloadResult> {
  const settings = getSettings();
  const downloadFolder = settings.downloadFolder;
  if (!downloadFolder) {
    return { success: false, error: "No download folder configured on the server" };
  }

  if (!ffmpegPath) {
    return { success: false, error: "ffmpeg binary not available for this platform" };
  }

  const artistDir = path.join(downloadFolder, sanitize(req.artistName));
  const albumName = req.albumName || `${req.songName} (Single)`;
  const albumDir = req.releaseYear
    ? path.join(artistDir, `${sanitize(albumName)} (${req.releaseYear})`)
    : path.join(artistDir, sanitize(albumName));

  fs.mkdirSync(albumDir, { recursive: true });

  const prefix = req.trackNumber ? `${String(req.trackNumber).padStart(2, "0")} - ` : "";
  const outputTemplate = path.join(albumDir, `${prefix}${sanitize(req.songName)}.%(ext)s`);
  const finalPath = path.join(albumDir, `${prefix}${sanitize(req.songName)}.mp3`);

  try {
    // Step 1: Download raw audio with bundled yt-dlp (no conversion)
    // yt-dlp saves as m4a (bestaudio with ext=m4a sub-format)
    const url = `https://www.youtube.com/watch?v=${req.videoId}`;
    await youtubedl(url, {
      format: "bestaudio[ext=m4a]/bestaudio",
      output: outputTemplate,
      "no-playlist": true,
    });

    // Find the downloaded file (yt-dlp resolves the extension)
    const files = fs.readdirSync(albumDir);
    const rawFile = files.find(
      (f) => f.startsWith(`${prefix}${sanitize(req.songName)}`) && !f.endsWith(".mp3") && !f.endsWith(".part"),
    );
    if (!rawFile) return { success: false, error: "yt-dlp completed but no audio file found" };
    const rawPath = path.join(albumDir, rawFile);

    // Step 2: Convert to MP3 + embed metadata using bundled ffmpeg
    const metadata: string[] = [];
    metadata.push(`title=${req.songName}`);
    metadata.push(`artist=${req.artistName}`);
    if (req.albumName) metadata.push(`album=${req.albumName}`);
    if (req.trackNumber) metadata.push(`track=${req.trackNumber}`);
    if (req.releaseYear) metadata.push(`date=${req.releaseYear}`);
    if (req.genres?.length) metadata.push(`genre=${req.genres.join("/")}`);

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(rawPath)
        .audioCodec("libmp3lame")
        .audioBitrate(320)
        .outputOptions(metadata.flatMap((m) => ["-metadata", m]));

      cmd.on("end", () => resolve());
      cmd.on("error", (err: Error) => reject(err));
      cmd.save(finalPath);
    });

    if (!fs.existsSync(finalPath)) {
      return { success: false, error: "ffmpeg conversion produced no output file" };
    }

    // Cleanup raw file
    try { fs.unlinkSync(rawPath); } catch { /* ignore */ }

    return { success: true, filePath: finalPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { fs.readdirSync(albumDir).forEach((f) => { try { fs.unlinkSync(path.join(albumDir, f)); } catch { } }); } catch { }
    return { success: false, error: msg };
  }
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
