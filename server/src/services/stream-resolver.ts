import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { getSettings } from "./settings";

const require = createRequire(import.meta.url);
const youtubedl = require("youtube-dl-exec");
const ffmpegPath: string | null = require("ffmpeg-static") || null;
const ffmpeg = require("fluent-ffmpeg");

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

// ── Types ──

export type ResolveRequest = {
  videoId: string;
  searchQuery: string;
  songName: string;
  artistName: string;
  albumName?: string;
  albumArtistName?: string;
  trackNumber?: number;
  releaseYear?: number;
  genres?: string[];
  coverBytes?: number[] | null;
};

export type ResolveResult = {
  filePath: string;
  coverPath?: string;
};

export interface StreamResolver {
  resolve(request: ResolveRequest): Promise<ResolveResult>;
}

// ── Helpers ──

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

// ── YtDlpStreamResolver ──

export class YtDlpStreamResolver implements StreamResolver {
  isAvailable(): boolean {
    try {
      const bin = youtubedl.execPath;
      return !!bin && fs.existsSync(bin);
    } catch {
      return false;
    }
  }

  private isFfmpegAvailable(): boolean {
    return !!ffmpegPath;
  }

  async resolve(request: ResolveRequest): Promise<ResolveResult> {
    const settings = getSettings();
    const downloadFolder = settings.downloadFolder;
    if (!downloadFolder) {
      throw new Error("No download folder configured on the server");
    }
    if (!this.isFfmpegAvailable()) {
      throw new Error("ffmpeg binary not available for this platform");
    }

    const artistDir = path.join(downloadFolder, sanitize(request.artistName));
    const albumName = request.albumName || `${request.songName} (Single)`;
    const albumDir = request.releaseYear
      ? path.join(artistDir, `${sanitize(albumName)} (${request.releaseYear})`)
      : path.join(artistDir, sanitize(albumName));

    fs.mkdirSync(albumDir, { recursive: true });

    const prefix = request.trackNumber
      ? `${String(request.trackNumber).padStart(2, "0")} - `
      : "";
    const outputTemplate = path.join(
      albumDir,
      `${prefix}${sanitize(request.songName)}.%(ext)s`,
    );
    const finalPath = path.join(
      albumDir,
      `${prefix}${sanitize(request.songName)}.mp3`,
    );
    const coverJpgPath = path.join(albumDir, "cover.jpg");

    try {
      const url = `https://www.youtube.com/watch?v=${request.videoId}`;
      await youtubedl(url, {
        format: "bestaudio[ext=m4a]/bestaudio",
        output: outputTemplate,
        "no-playlist": true,
      });

      const files = fs.readdirSync(albumDir);
      const rawFile = files.find(
        (f) =>
          f.startsWith(`${prefix}${sanitize(request.songName)}`) &&
          !f.endsWith(".mp3") &&
          !f.endsWith(".part"),
      );
      if (!rawFile)
        throw new Error("yt-dlp completed but no audio file found");
      const rawPath = path.join(albumDir, rawFile);

      let hasCover = false;
      if (request.coverBytes && request.coverBytes.length > 0) {
        try {
          fs.writeFileSync(coverJpgPath, Buffer.from(request.coverBytes));
          hasCover = true;
        } catch {
          // non-critical
        }
      }

      const metadataOptions: string[] = [];
      metadataOptions.push(`title=${request.songName}`);
      metadataOptions.push(`artist=${request.artistName}`);
      if (request.albumName)
        metadataOptions.push(`album=${request.albumName}`);
      if (request.trackNumber)
        metadataOptions.push(`track=${request.trackNumber}`);
      if (request.releaseYear)
        metadataOptions.push(`date=${request.releaseYear}`);
      if (request.genres?.length)
        metadataOptions.push(`genre=${request.genres.join("/")}`);

      const outputOptions: string[] = [];
      if (hasCover) {
        outputOptions.push("-map", "0:a", "-map", "1:v");
        outputOptions.push("-c:v", "mjpeg");
        outputOptions.push("-id3v2_version", "3");
        outputOptions.push("-metadata:s:v", "title=Album Cover");
        outputOptions.push("-metadata:s:v", "comment=Cover (front)");
      }
      for (const m of metadataOptions) {
        outputOptions.push("-metadata", m);
      }

      await new Promise<void>((resolve, reject) => {
        let cmd = ffmpeg(rawPath).audioCodec("libmp3lame").audioBitrate(320);
        if (hasCover) {
          cmd = cmd.input(coverJpgPath);
        }
        cmd
          .outputOptions(outputOptions)
          .on("end", () => resolve())
          .on("error", (err: Error) => reject(err))
          .save(finalPath);
      });

      if (!fs.existsSync(finalPath)) {
        throw new Error("ffmpeg conversion produced no output file");
      }

      try {
        fs.unlinkSync(rawPath);
      } catch {
        /* cleanup best-effort */
      }

      return {
        filePath: finalPath,
        coverPath: hasCover ? coverJpgPath : undefined,
      };
    } catch (err) {
      // Cleanup partial artifacts
      try {
        fs.readdirSync(albumDir).forEach((f) => {
          try {
            fs.unlinkSync(path.join(albumDir, f));
          } catch {
            /* best-effort */
          }
        });
      } catch {
        /* best-effort */
      }
      throw err;
    }
  }
}

// ── FakeStreamResolver (for tests) ──

export class FakeStreamResolver implements StreamResolver {
  constructor(private baseDir: string) {}

  async resolve(request: ResolveRequest): Promise<ResolveResult> {
    const artistDir = path.join(this.baseDir, sanitize(request.artistName));
    const albumName = request.albumName || `${request.songName} (Single)`;
    const albumDir = request.releaseYear
      ? path.join(artistDir, `${sanitize(albumName)} (${request.releaseYear})`)
      : path.join(artistDir, sanitize(albumName));

    fs.mkdirSync(albumDir, { recursive: true });

    const prefix = request.trackNumber
      ? `${String(request.trackNumber).padStart(2, "0")} - `
      : "";
    const finalPath = path.join(
      albumDir,
      `${prefix}${sanitize(request.songName)}.mp3`,
    );
    const coverJpgPath = path.join(albumDir, "cover.jpg");

    // Write a fake MP3 file with identifiable content
    const fakeContent = `FAKE STREAM: ${request.songName} by ${request.artistName}`;
    fs.writeFileSync(finalPath, fakeContent, "utf-8");

    let hasCover = false;
    if (request.coverBytes && request.coverBytes.length > 0) {
      try {
        fs.writeFileSync(coverJpgPath, Buffer.from(request.coverBytes));
        hasCover = true;
      } catch {
        /* non-critical */
      }
    }

    return {
      filePath: finalPath,
      coverPath: hasCover ? coverJpgPath : undefined,
    };
  }
}