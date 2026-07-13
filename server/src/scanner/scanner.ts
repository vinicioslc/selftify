import fs from "fs";
import path from "path";
import * as mm from "music-metadata";
import { getDb } from "../db/connection";
import { config } from "../config";

export interface ScanStatus {
  status: "idle" | "discovering" | "indexing" | "done" | "error";
  progress: { total: number; done: number; currentItem: string };
  libraryRoot: string;
  startedAt: number | null;
  finishedAt: number | null;
}

let scanState: ScanStatus = {
  status: "idle",
  progress: { total: 0, done: 0, currentItem: "" },
  libraryRoot: config.libraryRoot,
  startedAt: null,
  finishedAt: null,
};

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".m4a", ".m4b", ".opus", ".wav", ".wma", ".aac", ".aiff",
]);

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function getScanStatus(): ScanStatus {
  return { ...scanState, progress: { ...scanState.progress } };
}

export function resetScanState(): void {
  scanState = {
    status: "idle",
    progress: { total: 0, done: 0, currentItem: "" },
    libraryRoot: config.libraryRoot,
    startedAt: null,
    finishedAt: null,
  };
}

function getRelativePath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, "/");
}

export async function startScan(libraryRoot: string): Promise<void> {
  if (scanState.status === "discovering" || scanState.status === "indexing") {
    throw new Error("Scan already in progress");
  }

  scanState.libraryRoot = libraryRoot;
  scanState.startedAt = Date.now();
  scanState.finishedAt = null;

  // Walk directory and collect audio files
  const allFiles: string[] = [];
  scanState.status = "discovering";
  scanState.progress = { total: 0, done: 0, currentItem: libraryRoot };

  const pending = [libraryRoot];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const dir = pending.shift()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".img" && entry.name !== ".trash" && entry.name !== ".selftify") {
          pending.push(fullPath);
        }
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        allFiles.push(fullPath);
      }
    }
    scanState.progress = { ...scanState.progress, currentItem: dir, done: allFiles.length };
  }

  if (allFiles.length === 0) {
    scanState.status = "done";
    scanState.finishedAt = Date.now();
    scanState.progress = { total: 0, done: 0, currentItem: "" };
    console.log("[scanner] No audio files found");
    return;
  }

  // Indexing phase
  scanState.status = "indexing";
  scanState.progress = { total: allFiles.length, done: 0, currentItem: "" };

  // Process files in batches: parse async, then commit DB sync
  const BATCH_SIZE = 5;
  const db = getDb();
  let hadErrors = false;

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);

    // Parse metadata async
    const parsed = await Promise.allSettled(
      batch.map(async (filePath) => {
        try {
          const meta = await mm.parseFile(filePath, { duration: true, skipCovers: false });
          return { filePath, meta };
        } catch {
          return { filePath, meta: null };
        }
      }),
    );

    // Write to DB synchronously in a transaction
    const writeBatch = db.transaction(() => {
      for (const result of parsed) {
        if (result.status === "rejected") continue;
        const { filePath, meta } = result.value;
        writeFileToDb(filePath, libraryRoot, meta);
      }
    });

    try {
      writeBatch();
    } catch (err) {
      console.warn(`[scanner] DB batch error at ${i}:`, err);
      hadErrors = true;
    }

    const done = Math.min(i + BATCH_SIZE, allFiles.length);
    scanState.progress = { total: allFiles.length, done, currentItem: batch[batch.length - 1] };
  }

  if (hadErrors) {
    scanState.status = "error";
    scanState.finishedAt = Date.now();
    return;
  }

  // Update config table with scan metadata
  try {
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('lastScanAt', ?)`).run(String(Date.now()));
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('scanStatus', 'done')`).run();
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('songCount', ?)`).run(String(allFiles.length));
    const artistCount = (db.prepare(`SELECT COUNT(*) AS c FROM artists`).get() as { c: number }).c;
    const albumCount = (db.prepare(`SELECT COUNT(*) AS c FROM albums`).get() as { c: number }).c;
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('artistCount', ?)`).run(String(artistCount));
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('albumCount', ?)`).run(String(albumCount));
  } catch {
    // config updates are non-critical
  }

  scanState.status = "done";
  scanState.finishedAt = Date.now();
  console.log(`[scanner] Scan complete: ${allFiles.length} files indexed`);
}

function writeFileToDb(filePath: string, libraryRoot: string, meta: mm.IAudioMetadata | null): void {
  const relPath = getRelativePath(libraryRoot, filePath);
  const parts = relPath.split("/");
  const artistDir = parts[0] || "Unknown Artist";
  const albumDir = parts.length >= 2 ? parts[1] : null;
  const fileName = path.basename(filePath).replace(/\.[^/.]+$/, "") || "Unknown";

  const common = meta?.common;
  const format = meta?.format;

  const artistName = common?.artist || common?.albumartist || artistDir || "Unknown Artist";
  const albumName = common?.album || albumDir || null;
  const trackName = common?.title || fileName;
  const year = common?.year || null;
  const genre = common?.genre?.[0] || null;
  const trackNumber = common?.track?.no || null;
  const discNumber = common?.disk?.no || null;
  const duration = format?.duration ? Math.round(format.duration * 1000) : null;
  const bitrate = format?.bitrate ? Math.round(format.bitrate / 1000) : null;
  const mbzRecordingId = (common as any)?.musicbrainz_recordingid || null;
  const mbzTrackId = (common as any)?.musicbrainz_trackid || null;
  const mbzAlbumId = (common as any)?.musicbrainz_albumid || null;
  const mbzReleaseGroupId = (common as any)?.musicbrainz_releasegroupid || null;
  const mbzArtistId =
    (common as any)?.musicbrainz_artistid?.[0] ||
    (common as any)?.musicbrainz_albumartistid?.[0] ||
    null;

  // Handle embedded cover art
  let coverRelPath: string | null = null;
  if (common?.picture && common.picture.length > 0 && albumDir) {
    try {
      const pic = common.picture[0];
      const picDir = path.join(libraryRoot, ".selftify", "images", "album");
      fs.mkdirSync(picDir, { recursive: true });
      const hash = simpleHash(Buffer.from(pic.data));
      const ext = pic.format === "image/png" ? "png" : "jpg";
      const picFileName = `${hash}.${ext}`;
      const picPath = path.join(picDir, picFileName);
      if (!fs.existsSync(picPath)) {
        fs.writeFileSync(picPath, pic.data);
      }
      coverRelPath = `.selftify/images/album/${picFileName}`;
    } catch {
      // non-fatal
    }
  }

  const db = getDb();

  // Upsert artist
  const artistId = generateId("ar", artistName);
  db.prepare(
    `INSERT OR IGNORE INTO artists (id, name, genres, mbz_id, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(artistId, artistName, genre ? JSON.stringify([genre]) : "[]", mbzArtistId, Date.now());
  if (mbzArtistId) {
    db.prepare(
      `UPDATE artists SET mbz_id = ? WHERE id = ? AND (mbz_id IS NULL OR mbz_id = '')`,
    ).run(mbzArtistId, artistId);
  }

  // Upsert album
  const albumId = generateId("al", artistName, albumName || artistName);
  const existingAlbum = db.prepare(`SELECT id, song_count, duration FROM albums WHERE id = ?`).get(albumId) as
    | { id: string; song_count: number; duration: number }
    | undefined;

  if (existingAlbum) {
    db.prepare(
      `UPDATE albums SET song_count = song_count + 1, duration = duration + ?, updated_at = ? WHERE id = ?`,
    ).run(duration || 0, Date.now(), albumId);
  } else {
    db.prepare(
      `INSERT INTO albums (id, artist_id, name, artist_name, album_artist, release_year, genres, images, song_count, duration, mbz_id, mbz_release_group_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(
      albumId,
      artistId,
      albumName || artistName,
      artistName,
      common?.albumartist || null,
      year,
      genre ? JSON.stringify([genre]) : "[]",
      coverRelPath ? JSON.stringify([{ id: coverRelPath, url: coverRelPath, format: "image/jpeg" }]) : "[]",
      duration || 0,
      mbzAlbumId,
      mbzReleaseGroupId,
      Date.now(),
    );
  }
  if (mbzAlbumId || mbzReleaseGroupId) {
    db.prepare(
      `UPDATE albums
         SET mbz_id = COALESCE(NULLIF(mbz_id, ''), ?),
             mbz_release_group_id = COALESCE(NULLIF(mbz_release_group_id, ''), ?)
       WHERE id = ? AND (mbz_id IS NULL OR mbz_id = '' OR mbz_release_group_id IS NULL OR mbz_release_group_id = '')`,
    ).run(mbzAlbumId, mbzReleaseGroupId, albumId);
  }

  // Insert track
  const trackId = generateId("tr", relPath);
  db.prepare(
    `INSERT OR REPLACE INTO tracks (id, album_id, path, name, artist_name, album_name, track_number, disc_number, duration, bitrate, genre, mbz_recording_id, mbz_track_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trackId, albumId, relPath, trackName, artistName, albumName,
    trackNumber, discNumber, duration, bitrate, genre,
    mbzRecordingId, mbzTrackId,
  );
}

function generateId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${simpleHash(parts.join("|")).substring(0, 12)}`;
}

function simpleHash(input: string | Uint8Array | Buffer): string {
  let hash = 0;
  const str = typeof input === "string" ? input : Array.from(input).map((b) => b.toString(16)).join("");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
