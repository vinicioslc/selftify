import type { Indexer, IndexerStatus } from "./indexer";
import type { Origin } from "../../types/domain-types";
import { fileIdFromPath, isAudioFile } from "../../lib/sqlite-db-helpers";
import { useStatusStore } from "../../stores/status.store";
import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";
import type { DirEntry, PlatformService } from "../../services/platform/types";
import type { SqliteDbAlbumTrack, SqliteDbAlbumMeta, SqliteDbArtistMeta, SqliteDbImage } from "../../services/sqlite-db/sqlite-db-types";
import { saveSqliteDbImage, sha256Hash } from "../../services/sqlite-db/sqlite-db-image";
import { acquireScanLock, releaseScanLock, cachedReadDirectory, cachedExists } from "../../services/sqlite-db/sqlite-db-cache";
import { getPlatformService } from "../../services/platform/factory";
import { initDatabase, beginTransaction, commitTransaction, flushSave } from "../../services/db/database";
import * as configRepo from "../../services/db/repositories/config-repo";
import * as artistRepo from "../../services/db/repositories/artist-repo";
import * as albumRepo from "../../services/db/repositories/album-repo";
import * as trackRepo from "../../services/db/repositories/track-repo";
import type { OrganizationQueue } from "../../services/organizer/organization-queue";
import { createOrganizationQueue } from "../../services/organizer/organization-queue";
import { createFileOrganizer, sanitizeForPath } from "../../services/organizer";
import { joinPaths, fileNameFromPath } from "../../lib/path-utils";

function publishStatus(text: string, level: "info" | "success" | "warn" | "danger" = "info", source = "Local Scan") {
  try {
    useStatusStore.getState().addMessage(text, level, source);
  } catch (err) {
    console.warn("[indexer] publishStatus error:", err);
  }
}

const DIR_BATCH = 10;
const FILE_BATCH = 5;
const WATCH_INTERVAL = 60000;

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".bmp",
]);

interface AccumulatingAlbum {
  albumDir: string;
  artistDir: string;
  name: string;
  artistName: string;
  albumArtist: string | null;
  releaseYear: number | null;
  genres: Set<string>;
  tracks: SqliteDbAlbumTrack[];
  mbzId: string | null;
  mbzReleaseGroupId: string | null;
  mbzArtistId: string | null;
  coverRelPath: string | null;
}

interface AccumulatingArtist {
  name: string;
  genres: Set<string>;
  mbid: string | null;
}

export function createLocalIndexer(): Indexer {
  let listeners: Array<(status: IndexerStatus) => void> = [];
  let status: IndexerStatus = { status: "idle", progress: { total: 0, done: 0, currentItem: "" } };
  let paused = false;
  let aborted = false;
  let scanning = false;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let scannedCount = 0;
  let totalDiscovered = 0;

  let libraryRoot = "";
  let newFilesPaths: string[] = [];
  let fileQueue: string[] = [];
  let fileQueueIndex = 0;
  let lastKnownFileCount = -1;
  const processedPaths = new Set<string>();

  const pendingAlbums = new Map<string, AccumulatingAlbum>();
  const uniqueArtists = new Map<string, AccumulatingArtist>();

  let organizeOnScan = true;
  let organizeDryRun = false;
  let orgQueue: OrganizationQueue | null = null;
  const sourcePathToTrackMap = new Map<string, SqliteDbAlbumTrack>();

  function notify() {
    const s = { ...status, progress: { ...status.progress } };
    listeners.forEach((l) => l(s));
  }

  function setState(partial: { status?: IndexerStatus["status"]; progress?: Partial<IndexerStatus["progress"]> }) {
    const mergedProgress = { ...status.progress, ...(partial.progress || {}) } as IndexerStatus["progress"];
    status = { ...status, ...partial, progress: mergedProgress } as IndexerStatus;
    notify();
  }

  function getAlbumKey(artist: string, album: string | null): string {
    return `${artist.toLowerCase().trim()}|${(album || "").toLowerCase().trim()}`;
  }

  function getRelativePath(root: string, fullPath: string): string {
    const nRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const nFull = fullPath.replace(/\\/g, "/");
    if (!nFull.startsWith(nRoot)) return nFull;
    return nFull.slice(nRoot.length).replace(/^\//, "");
  }

  function getArtistAndAlbumDirs(relPath: string): { artistDir: string; albumDir: string | null } {
    const parts = relPath.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const lastIsFile = /\.[\w]+$/.test(parts[parts.length - 1]);
      if (parts.length === 2 && lastIsFile) {
        return { artistDir: parts[0], albumDir: null };
      }
      return { artistDir: parts[0], albumDir: parts[1] };
    }
    return { artistDir: parts[0] || relPath, albumDir: null };
  }

  function ensureAlbum(artistDir: string, albumDir: string, artistName: string, albumName: string | null): AccumulatingAlbum {
    const key = getAlbumKey(artistName, albumName);
    let existing = pendingAlbums.get(key);
    if (!existing) {
      existing = {
        albumDir,
        artistDir,
        name: albumName || artistName,
        artistName,
        albumArtist: null,
        releaseYear: null,
        genres: new Set(),
        tracks: [],
        mbzId: null,
        mbzReleaseGroupId: null,
        mbzArtistId: null,
        coverRelPath: null,
      };
      pendingAlbums.set(key, existing);
    }
    return existing;
  }

  // ── Public API ──

  async function start(origin: Origin) {
    const folder = origin.folderPath || "";
    if (!folder) return;

    libraryRoot = folder;
    paused = false;
    aborted = false;
    scanning = false;
    scannedCount = 0;
    newFilesPaths = [];
    fileQueue = [];
    fileQueueIndex = 0;
    pendingAlbums.clear();
    uniqueArtists.clear();
    processedPaths.clear();
    sourcePathToTrackMap.clear();

    organizeOnScan = origin.organizeOnScan !== false;
    organizeDryRun = origin.organizeDryRun === true;
    orgQueue = organizeOnScan ? createOrganizationQueue(libraryRoot) : null;

    publishStatus("Starting local library scan\u2026", "info");

    try {
      const locked = await acquireScanLock(libraryRoot);
      if (!locked) {
        publishStatus("Scan already in progress", "warn");
        return;
      }

      await initDatabase(libraryRoot);

      const existingCount = parseInt(configRepo.getConfig("songCount") || "0", 10);

      if (existingCount > 0) {
        await incrementalScan(folder);
      } else {
        totalDiscovered = 0;
        setState({ status: "discovering", progress: { total: 0, done: 0, currentItem: folder } });
        publishStatus("Counting files in music folder\u2026", "info");

        totalDiscovered = await discoverAndEnqueue(folder);

        if (totalDiscovered > 0) {
          setState({ status: "indexing", progress: { total: totalDiscovered, done: 0, currentItem: folder } });
          publishStatus(`Found ${totalDiscovered} audio file${totalDiscovered !== 1 ? "s" : ""} \u2014 extracting metadata\u2026`, "info");
          run();
        } else {
          await finish();
        }
      }
    } catch (err) {
      console.error("[indexer] start failed:", err);
      publishStatus("Scan failed to start. Check logs.", "danger");
      await releaseScanLock(libraryRoot);
      setState({ status: "idle" });
    }
  }

  async function incrementalScan(root: string) {
    try {
      const fsPaths = new Set<string>();
      const pending = [root];
      const visited = new Set<string>();
      const newFiles: string[] = [];

      while (pending.length > 0) {
        if (aborted || paused) return;
        const dir = pending.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        setState({ progress: { currentItem: dir } });

        let entries: DirEntry[];
        try { entries = await (await getPlatformService()).readDirectory(dir); } catch (err) { console.warn("[indexer] readDirectory error:", err); continue; }

        for (const e of entries) {
          if (!e.name) continue;
          if (e.isDirectory) { if (e.name !== ".trash") pending.push(e.path); continue; }
          if (isAudioFile(e.name)) {
            fsPaths.add(e.path);
            newFiles.push(e.path);
          }
        }
      }

      newFilesPaths = newFiles;

      if (newFiles.length > 0) {
        totalDiscovered = newFiles.length;
        setState({ status: "indexing", progress: { total: newFiles.length, done: 0, currentItem: "" } });
        run();
      } else {
        await finish();
      }
    } catch (err) {
      console.error("[indexer] incrementalScan failed:", err);
      publishStatus("Incremental scan failed. Try a full rescan.", "danger");
      await releaseScanLock(libraryRoot);
      setState({ status: "idle" });
    }
  }

  function pause() {
    paused = true;
    setState({ status: "paused" });
  }

  async function resume() {
    if (scanning) return;
    paused = false;
    aborted = false;
    setState({ status: "indexing" });
    run();
  }

  function abort() {
    aborted = true;
    paused = false;
    scanning = false;
    if (watchTimer) clearTimeout(watchTimer);
    setState({ status: "idle" });
  }

  function getStatus() {
    return status;
  }

  async function startWatcher() {
    scheduleWatch();
  }

  function onProgress(callback: (s: IndexerStatus) => void) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((l) => l !== callback);
    };
  }

  // ── Scanner engine ──

  async function discoverAndEnqueue(root: string): Promise<number> {
    const pending = [root];
    const visited = new Set<string>();
    const discovered: string[] = [];
    let count = 0;

    while (pending.length > 0) {
      if (aborted) break;
      const dir = pending.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);

      setState({ progress: { currentItem: dir, done: count } });
      if (visited.size % 20 === 0) {
        publishStatus(`Scanning ${dir}\u2026 (${count} files found)`, "info");
      }

      let entries: DirEntry[];
      try {
        entries = await (await getPlatformService()).readDirectory(dir);
      } catch (err) {
        console.warn("[indexer] discoverAndEnqueue error:", err);
        continue;
      }

      for (const e of entries) {
        if (!e.name) continue;
        if (e.isDirectory) {
          if (e.name !== ".img" && e.name !== ".trash") pending.push(e.path);
        } else if (e.isFile) {
          if (isAudioFile(e.name)) {
            discovered.push(e.path);
            count++;
          }
        }
      }
    }

    fileQueue = discovered;

    if (count > 0) {
      publishStatus(`Found ${count} audio files`, "info");
    } else {
      publishStatus("No audio files found in the selected folder", "warn");
    }

    return count;
  }

  async function run() {
    if (aborted || paused || scanning) return;
    scanning = true;
    try {
      await processBatch();
    } catch (err) {
      console.warn("[indexer] batch error:", err);
    } finally {
      scanning = false;
    }

    if (aborted) return;

    if (scannedCount >= totalDiscovered) {
      await finish();
    } else if (!paused) {
      setTimeout(run, 0);
    }
  }

  async function processBatch() {
    let files = 0;

    // Drain fileQueue (fresh scan) — use index pointer to avoid rescanning
    while (fileQueueIndex < fileQueue.length && files < FILE_BATCH) {
      if (aborted || paused) return;
      const path = fileQueue[fileQueueIndex++];
      if (!path || processedPaths.has(path)) continue;
      processedPaths.add(path);
      await processFile(path);
      files++;
    }

    // Drain newFilesPaths (incremental scan)
    while (newFilesPaths.length > 0 && files < FILE_BATCH) {
      if (aborted || paused) return;
      const path = newFilesPaths.shift()!;
      if (!path || processedPaths.has(path)) continue;
      processedPaths.add(path);
      await processFile(path);
      files++;
    }

    // Fallback tree walk (if no queue and no incremental paths)
    if (fileQueueIndex >= fileQueue.length && newFilesPaths.length === 0) {
      const pending = [libraryRoot];
      const visited = new Set<string>();
      while (pending.length > 0 && files < FILE_BATCH) {
        if (aborted || paused) return;
        const dir = pending.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        let entries: DirEntry[];
        try { entries = await cachedReadDirectory(dir); } catch { continue; }
        for (const e of entries) {
          if (!e.name || aborted) continue;
          if (e.isDirectory) {
            if (e.name !== ".img" && e.name !== ".trash" && e.name !== ".selftify") pending.push(e.path);
          } else if (isAudioFile(e.name)) {
            if (processedPaths.has(e.path)) continue;
            processedPaths.add(e.path);
            await processFile(e.path);
            files++;
            if (files >= FILE_BATCH) break;
          }
        }
      }
    }
  }

  async function processFile(filePath: string) {
    if (aborted) return;
    try {
      const { getPlatformService } = await import("../../services/platform/factory");
      const p = await getPlatformService();
      const data = await p.readFile(filePath);
      if (!data) return;

      const relPath = getRelativePath(libraryRoot, filePath);
      const { artistDir, albumDir } = getArtistAndAlbumDirs(relPath);
      const fileName = fileNameFromPath(filePath).replace(/\.[^/.]+$/, "") || "Unknown";

      let meta: {
        name: string | null; artist: string | null; album: string | null;
        albumArtist: string | null; trackNumber: number | null; discNumber: number | null;
        duration: number | null; bitrate: number | null; genre: string | null; year: number | null;
        mbzRecordingId: string | null; mbzTrackId: string | null;
        mbzAlbumId: string | null; mbzReleaseGroupId: string | null; mbzArtistId: string | null;
        picture: { data: number[]; format: string } | null;
      } | null = null;

      try {
        const api = (window as any).electronApi;
        if (api?.local?.parseFile) {
          const parsed = await Promise.race([
            api.local.parseFile(filePath),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("electronApi.parseFile timeout")), 30000)
            ),
          ]);
          if (parsed && !parsed.error) meta = parsed;
        } else {
          const mm = await import("music-metadata");
          const mmResult = await Promise.race([
            mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("parseBuffer timeout")), 15000)
            ),
          ]);
          if (mmResult) {
            const c = mmResult.common;
            const f = mmResult.format;
            let picture: { data: number[]; format: string } | null = null;
            if (c.picture && c.picture.length > 0) {
              const pic = c.picture[0];
              picture = {
                data: Array.from(new Uint8Array(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength)),
                format: pic.format || "image/jpeg",
              };
            }
            meta = {
              name: c.title || null, artist: c.artist || c.albumartist || null,
              album: c.album || null, albumArtist: c.albumartist || null,
              trackNumber: c.track?.no || null, discNumber: c.disk?.no || null,
              duration: f.duration ? f.duration * 1000 : null,
              bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
              genre: c.genre?.[0] || null, year: c.year || null,
              mbzRecordingId: c.musicbrainz_recordingid || null,
              mbzTrackId: c.musicbrainz_trackid || null,
              mbzAlbumId: c.musicbrainz_albumid || null,
              mbzReleaseGroupId: c.musicbrainz_releasegroupid || null,
              mbzArtistId: c.musicbrainz_artistid?.[0] || null,
              picture,
            };
          }
        }
      } catch { }

      const artistName = meta?.artist || artistDir || "Unknown Artist";
      const albumName = meta?.album || albumDir || null;
      const trackName = meta?.name || fileName;

      const album = ensureAlbum(artistDir, albumDir || artistDir, artistName, albumName);
      if (meta?.albumArtist) album.albumArtist = meta.albumArtist;
      if (meta?.year) album.releaseYear = meta.year;
      if (meta?.genre) album.genres.add(meta.genre);
      if (meta?.mbzAlbumId) album.mbzId = meta.mbzAlbumId;
      if (meta?.mbzReleaseGroupId) album.mbzReleaseGroupId = meta.mbzReleaseGroupId;
      if (meta?.mbzArtistId) album.mbzArtistId = meta.mbzArtistId;

      const track: SqliteDbAlbumTrack = {
        path: getRelativePath(libraryRoot, filePath),
        name: trackName,
        artistName,
        albumName: albumName || null,
        trackNumber: meta?.trackNumber ?? null,
        discNumber: meta?.discNumber ?? null,
        duration: meta?.duration ?? null,
        bitrate: meta?.bitrate ?? undefined,
        genre: meta?.genre ?? null,
        mbzRecordingId: meta?.mbzRecordingId ?? null,
        mbzTrackId: meta?.mbzTrackId ?? null,
      };
      album.tracks.push(track);
      sourcePathToTrackMap.set(filePath, track);

      // Track artist for enrichment
      if (artistName && artistName !== "Unknown Artist") {
        const key = artistName.toLowerCase().trim();
        let existing = uniqueArtists.get(key);
        if (!existing) {
          existing = { name: artistName, genres: new Set(), mbid: meta?.mbzArtistId || null };
          uniqueArtists.set(key, existing);
        }
        if (meta?.mbzArtistId && !existing.mbid) existing.mbid = meta.mbzArtistId;
        if (meta?.genre) existing.genres.add(meta.genre);
      }

      // Store embedded cover art
      if (meta?.picture?.data && meta.picture.data.length > 0 && albumDir) {
        try {
          const buf = new Uint8Array(meta.picture.data).buffer as ArrayBuffer;
          const hash = await sha256Hash(buf);
          const format = meta.picture.format || "image/jpeg";
          const relPath = await saveSqliteDbImage(libraryRoot, "album", hash, new Uint8Array(buf), format);
          album.coverRelPath = relPath;
        } catch (picErr) {
          console.warn("[indexer] Failed to store embedded cover:", picErr);
        }
      }

      scannedCount++;
      setState({ progress: { done: scannedCount, currentItem: filePath } });
    } catch (err) {
      console.warn(`[indexer] error processing file ${filePath}:`, err);
    }
  }

  async function processOrganizationQueue() {
    if (!orgQueue) return;
    publishStatus("Organizing files\u2026", "info", "Local Organizer");
    setState({ progress: { currentItem: "Organizing files\u2026" } });

    const organizer = createFileOrganizer(libraryRoot);
    const results = await orgQueue.processAll(organizer);

    let organizedCount = 0;
    let failedCount = 0;
    const organizedAlbums = new Map<string, string[]>();
    const organizedArtists = new Map<string, string[]>();

    for (const result of results) {
      if (result.skipped || !result.targetPath) {
        if (result.error) failedCount++;
        continue;
      }
      organizedCount++;

      const track = sourcePathToTrackMap.get(result.sourcePath);
      if (track) {
        track.path = joinPaths(result.targetAlbumRelDir, result.targetFileName);
      }

      const albumKey = result.targetAlbumRelDir;
      if (!organizedAlbums.has(albumKey)) {
        organizedAlbums.set(albumKey, []);
      }
      organizedAlbums.get(albumKey)!.push(result.targetPath);

      const artistKey = albumKey.split("/")[0];
      if (!organizedArtists.has(artistKey)) {
        organizedArtists.set(artistKey, []);
      }
      organizedArtists.get(artistKey)!.push(artistKey);
    }

    // Write album artifacts (cover.jpg, album.nfo)
    for (const [albumRelDir, paths] of organizedAlbums) {
      if (aborted) break;
      const artistDir = albumRelDir.split("/")[0];
      const albumDirName = albumRelDir.split("/").slice(1).join("/");

      const albumKey = Array.from(pendingAlbums.keys()).find((k) => {
        const a = pendingAlbums.get(k);
        if (!a) return false;
        const expectedArtist = sanitizeForPath(a.albumArtist || a.artistName);
        const expectedAlbum = sanitizeForPath(a.name);
        return artistDir === expectedArtist && albumDirName.startsWith(expectedAlbum);
      });
      if (!albumKey) continue;
      const album = pendingAlbums.get(albumKey);
      if (!album) continue;

      const targetAlbumDir = joinPaths(libraryRoot, albumRelDir);

      if (!organizeDryRun) {
        try {
          const artifacts = await organizer.writeAlbumArtifacts(targetAlbumDir, {
            libraryRoot,
            albumName: album.name,
            artistName: album.artistName,
            releaseYear: album.releaseYear,
            genres: Array.from(album.genres),
            tracks: album.tracks.map((t) => ({
              title: t.name,
              trackNumber: t.trackNumber,
              duration: t.duration,
              mbzRecordingId: t.mbzRecordingId,
              mbzTrackId: t.mbzTrackId,
              discNumber: t.discNumber,
              artistName: t.artistName,
            })),
            coverRelPath: album.coverRelPath,
            mbzId: album.mbzId,
            mbzReleaseGroupId: album.mbzReleaseGroupId,
            albumArtist: album.albumArtist,
            albumArtistMbid: album.mbzArtistId,
          });

          const artistTargetDir = joinPaths(libraryRoot, artistDir);
          const artistKey = artistDir.toLowerCase().trim();
          const artistEntry = uniqueArtists.get(artistKey);
          await organizer.writeArtistArtifacts(artistTargetDir, {
            artistName: album.artistName,
            genres: artistEntry ? Array.from(artistEntry.genres) : [],
            mbid: artistEntry?.mbid || null,
          });
        } catch (err) {
          console.warn("[indexer] failed to write album artifacts:", err);
        }
      }
    }

    if (organizeDryRun) {
      publishStatus(`[DRY RUN] Would organize ${organizedCount} file${organizedCount !== 1 ? "s" : ""}`, "info", "Local Organizer");
    } else if (organizedCount > 0) {
      publishStatus(`Organized ${organizedCount} file${organizedCount !== 1 ? "s" : ""}`, "success", "Local Organizer");
    }
    if (failedCount > 0) {
      publishStatus(`${failedCount} file${failedCount !== 1 ? "s" : ""} failed to organize`, "warn", "Local Organizer");
    }

    await orgQueue.clear();
  }

  async function finish() {
    try {
      const totalSongs = pendingAlbums.size > 0
        ? Array.from(pendingAlbums.values()).reduce((sum, a) => sum + a.tracks.length, 0)
        : 0;

      beginTransaction();

      // Write albums + tracks
      for (const [, album] of pendingAlbums) {
        if (aborted) break;

        const totalDuration = album.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        const albumMeta: SqliteDbAlbumMeta = {
          $schema: "selftify-album",
          version: 1,
          name: album.name,
          artistName: album.artistName,
          albumArtist: album.albumArtist || null,
          releaseYear: album.releaseYear,
          mbzId: album.mbzId,
          mbzReleaseGroupId: album.mbzReleaseGroupId,
          genres: Array.from(album.genres),
          images: album.coverRelPath ? [{ id: album.coverRelPath, url: album.coverRelPath, width: null, height: null, format: "image/jpeg" }] : [],
          songCount: album.tracks.length,
          duration: totalDuration,
          tracks: album.tracks,
          updatedAt: Date.now(),
          enrichedAt: null,
        };
        albumRepo.upsertAlbum(albumMeta, album.artistName);
      }

      // Write artists
      for (const [, entry] of uniqueArtists) {
        if (aborted) break;
        if (artistRepo.artistExists(entry.name)) continue;

        const artistMeta: SqliteDbArtistMeta = {
          $schema: "selftify-artist",
          version: 1,
          name: entry.name,
          sortName: null,
          mbzId: entry.mbid,
          biography: null,
          genres: Array.from(entry.genres),
          country: null,
          type: null,
          disambiguation: null,
          images: [],
          updatedAt: Date.now(),
          enrichedAt: null,
        };
        artistRepo.upsertArtist(artistMeta);
      }

      commitTransaction();

      // Write config
      configRepo.setConfig("lastScanAt", String(Date.now()));
      configRepo.setConfig("scanStatus", "done");
      configRepo.setConfig("songCount", String(totalSongs));
      configRepo.setConfig("artistCount", String(uniqueArtists.size));
      configRepo.setConfig("albumCount", String(pendingAlbums.size));

      lastKnownFileCount = totalDiscovered > 0 ? totalDiscovered : totalSongs;

      await flushSave();

      setState({ status: "done", progress: { total: totalSongs, done: totalSongs, currentItem: "" } });
      publishStatus(`Local library indexed: ${totalSongs} song${totalSongs !== 1 ? "s" : ""}`, "success");
    } catch (err) {
      console.error("[indexer] finish failed:", err);
      publishStatus("Scan finished with errors. Try rescanning.", "warn");
      setState({ status: "done" });
    } finally {
      await releaseScanLock(libraryRoot);
    }
    scheduleWatch();
  }

  // ── Watcher ──

  function scheduleWatch() {
    watchTimer = setTimeout(checkChanges, WATCH_INTERVAL);
  }

  async function checkChanges() {
    try {
      const root = libraryRoot;
      if (!root) { scheduleWatch(); return; }

      const fsPaths = new Set<string>();
      const pending = [root];
      const visited = new Set<string>();

      while (pending.length > 0) {
        const dir = pending.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        if (visited.size > 200) break;

        let entries: DirEntry[];
        try { entries = await cachedReadDirectory(dir); } catch (err) { console.warn("[indexer] readDirectory (watch) error:", err); continue; }
        for (const e of entries) {
          if (!e.name) continue;
          if (e.isDirectory) { if (e.name !== ".trash" && e.name !== ".selftify") pending.push(e.path); continue; }
          if (isAudioFile(e.name)) fsPaths.add(e.path);
        }
      }

      if (lastKnownFileCount >= 0 && fsPaths.size !== lastKnownFileCount) {
        lastKnownFileCount = fsPaths.size;
        setState({ status: "indexing" });
        paused = false; aborted = false;
        publishStatus("File changes detected. Re-indexing\u2026", "info");
        totalDiscovered = fsPaths.size;
        run();
      }
    } catch (err) {
      console.warn("[watcher] error:", err);
    }
    scheduleWatch();
  }

  return { start, pause, resume, abort, getStatus, onProgress, startWatcher };
}
