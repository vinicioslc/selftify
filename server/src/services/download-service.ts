import { execFile, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { getSettings } from "./settings";

const YT_DLP = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

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
    execFileSync(YT_DLP, ["--version"], { timeout: 10_000, stdio: "ignore" });
    return true;
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

  if (!isYtDlpAvailable()) {
    return { success: false, error: "yt-dlp is not installed or not found in PATH" };
  }

  const artistDir = path.join(downloadFolder, sanitize(req.artistName));
  const albumName = req.albumName || `${req.songName} (Single)`;
  const albumDir = req.releaseYear
    ? path.join(artistDir, `${sanitize(albumName)} (${req.releaseYear})`)
    : path.join(artistDir, sanitize(albumName));

  fs.mkdirSync(albumDir, { recursive: true });

  const prefix = req.trackNumber ? `${String(req.trackNumber).padStart(2, "0")} - ` : "";
  const outputTemplate = path.join(albumDir, `${prefix}%(title)s.%(ext)s`);
  const finalPath = path.join(albumDir, `${prefix}${sanitize(req.songName)}.mp3`);

  return new Promise((resolve) => {
    const args = [
      `https://www.youtube.com/watch?v=${req.videoId}`,
      "--format", "bestaudio[ext=m4a]/bestaudio",
      "--output", outputTemplate,
      "--no-playlist",
      "--print", "filename",
      "--no-warnings",
    ];

    execFile(YT_DLP, args, { cwd: albumDir, timeout: 300_000 }, (error, stdout, _stderr) => {
      if (error) {
        resolve({ success: false, error: `yt-dlp failed: ${error.message}` });
        return;
      }

      const downloadedName = stdout?.toString().trim();
      if (downloadedName && fs.existsSync(downloadedName)) {
        const audioPath = path.resolve(albumDir, downloadedName);
        if (audioPath !== finalPath) {
          try {
            fs.renameSync(audioPath, finalPath);
          } catch {
            resolve({ success: true, filePath: audioPath });
            return;
          }
        }
        resolve({ success: true, filePath: finalPath });
        return;
      }

      const files = fs.readdirSync(albumDir);
      const audioFile = files.find((f) => f.endsWith(".m4a") || f.endsWith(".mp3") || f.endsWith(".webm"));
      if (audioFile) {
        const found = path.join(albumDir, audioFile);
        if (found !== finalPath) {
          try { fs.renameSync(found, finalPath); } catch { /* ignore */ }
        }
        resolve({ success: true, filePath: fs.existsSync(finalPath) ? finalPath : found });
        return;
      }

      resolve({ success: false, error: "Download completed but audio file not found" });
    });
  });
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
