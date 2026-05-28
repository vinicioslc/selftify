import type { Indexer, IndexerStatus } from "./indexer";
import type { Origin } from "../../types/domain-types";
import { fileIdFromPath } from "../../stores/local-library.store";
import {
  getScanState,
  updateScanState,
  batchInsertSongs,
  deleteAllSongs,
  getAllPaths,
  getSongCount,
  deleteSong,
  enqueueScan,
  dequeueScan,
  getQueueCount,
  clearQueue,
  type DbSong,
} from "../../services/local-database";

const DIR_BATCH = 10;
const FILE_BATCH = 5;
const WATCH_INTERVAL = 15000;

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

export function createLocalIndexer(): Indexer {
  let listeners: Array<(status: IndexerStatus) => void> = [];
  let status: IndexerStatus = { status: "idle", progress: { total: 0, done: 0, currentItem: "" } };
  let paused = false;
  let aborted = false;
  let scanning = false;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let scannedCount = 0;

  function notify() {
    const s = { ...status, progress: { ...status.progress } };
    listeners.forEach((l) => l(s));
  }

  function setState(partial: { status?: IndexerStatus["status"]; progress?: Partial<IndexerStatus["progress"]> }) {
    const mergedProgress = { ...status.progress, ...(partial.progress || {}) } as IndexerStatus["progress"];
    status = { ...status, ...partial, progress: mergedProgress } as IndexerStatus;
    notify();
  }

  // ── Public API ──

  async function start(origin: Origin) {
    const folder = origin.url || "";
    if (!folder) return;

    paused = false;
    aborted = false;
    scanning = false;
    scannedCount = 0;

    await deleteAllSongs();
    await clearQueue();
    await updateScanState({
      root_folder: folder,
      scan_status: "scanning",
      total_files: 0,
      scanned_files: 0,
      current_dir: folder,
      last_scanned_at: null,
      watcher_enabled: 0,
    });

    setState({ status: "indexing", progress: { total: 0, done: 0, currentItem: folder } });
    await enqueueScan([{ type: "dir", path: folder }]);
    run();
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
    updateScanState({ scan_status: "idle", watcher_enabled: 0 });
    setState({ status: "idle" });
  }

  function getStatus() {
    return status;
  }

  function onProgress(callback: (s: IndexerStatus) => void) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((l) => l !== callback);
    };
  }

  // ── Scanner engine ──

  async function run() {
    if (aborted || paused || scanning) return;
    scanning = true;
    await processBatch();
    scanning = false;

    if (aborted) return;

    const remaining = await getQueueCount();
    if (remaining === 0) {
      await finish();
    } else if (!paused) {
      setTimeout(run, 0);
    }
  }

  async function processBatch() {
    let dirs = 0;
    let files = 0;

    while (dirs < DIR_BATCH) {
      if (aborted || paused) return;
      const item = await dequeueScan();
      if (!item) break;

      if (item.type === "dir") {
        await processDir(item.path);
        dirs++;
      } else if (item.type === "file") {
        await processFile(item.path);
        files++;
      }

      if ((dirs + files) % 3 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      if (files >= FILE_BATCH && dirs >= 1) break;
    }
  }

  async function processDir(dirPath: string) {
    if (aborted) return;
    setState({ progress: { currentItem: dirPath } });

    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const entries = await fsPlugin.readDir(dirPath);
      const subdirs: string[] = [];
      const audioFiles: string[] = [];

      for (const entry of entries) {
        if (aborted) return;
        if (!entry.name) continue;
        const fullPath = `${dirPath}/${entry.name}`;
        if (entry.children) {
          subdirs.push(fullPath);
        } else {
          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
          if (AUDIO_EXTENSIONS.has(ext)) {
            audioFiles.push(fullPath);
          }
        }
      }

      const batch: { type: string; path: string }[] = [];
      for (const d of subdirs) batch.push({ type: "dir", path: d });
      for (const f of audioFiles) batch.push({ type: "file", path: f });
      if (batch.length > 0) await enqueueScan(batch);

      scannedCount++;
      await updateScanState({ scanned_files: scannedCount, current_dir: dirPath });
    } catch (err) {
      console.warn(`[indexer] error reading dir ${dirPath}:`, err);
    }
  }

  async function processFile(filePath: string) {
    if (aborted) return;
    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const data = await fsPlugin.readFile(filePath);

      let meta: {
        name: string; artist_name: string; album_name: string | null;
        album_artist: string | null; track_number: number | null; disc_number: number | null;
        duration: number | null; bitrate: number | null; sample_rate: number | null;
        genre: string | null; year: number | null; file_size: number;
        file_extension: string; last_modified: number | null;
      };

      try {
        const mm = await import("music-metadata");
        const result = await mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: true });
        const c = result.common;
        const f = result.format;

        meta = {
          name: c.title || filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown",
          artist_name: c.artist || c.albumartist || "Unknown Artist",
          album_name: c.album || null,
          album_artist: c.albumartist || null,
          track_number: c.track?.no || null,
          disc_number: c.disk?.no || null,
          duration: f.duration ? f.duration * 1000 : null,
          bitrate: f.bitrate || null,
          sample_rate: f.sampleRate || null,
          genre: c.genre?.[0] || null,
          year: c.year || null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
        };
      } catch {
        const fileName = filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown";
        const scanState = await getScanState();
        const rootFolder = scanState?.root_folder || "";
        const relPath = rootFolder ? filePath.replace(rootFolder, "").replace(/^\/+/, "") : "";
        const relParts = relPath ? relPath.split("/").filter(Boolean) : [];

        let artist = "Unknown Artist";
        let album: string | null = null;
        if (relParts.length >= 3) { artist = relParts[relParts.length - 3]; album = relParts[relParts.length - 2]; }
        else if (relParts.length === 2) { album = relParts[1]; artist = relParts[0]; }
        else if (relParts.length === 1) { artist = relParts[0]; }

        meta = {
          name: fileName, artist_name: artist, album_name: album,
          album_artist: null, track_number: null, disc_number: null,
          duration: null, bitrate: null, sample_rate: null,
          genre: null, year: null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
        };
      }

      const song: Omit<DbSong, "updated_at"> = {
        id: fileIdFromPath(filePath), path: filePath, name: meta.name,
        artist_name: meta.artist_name, album_name: meta.album_name,
        album_artist: meta.album_artist, track_number: meta.track_number,
        disc_number: meta.disc_number, duration: meta.duration,
        bitrate: meta.bitrate, sample_rate: meta.sample_rate,
        genre: meta.genre, year: meta.year, file_size: meta.file_size,
        file_extension: meta.file_extension, last_modified: meta.last_modified,
        added_at: Date.now(),
      };

      await batchInsertSongs([song]);

      scannedCount++;
      setState({ progress: { done: scannedCount, currentItem: filePath } });
    } catch (err) {
      console.warn(`[indexer] error processing file ${filePath}:`, err);
    }
  }

  async function finish() {
    const count = await getSongCount();
    scannedCount = count;
    await updateScanState({
      scan_status: "done", total_files: count, scanned_files: count,
      current_dir: "", last_scanned_at: Date.now(), watcher_enabled: 1,
    });
    setState({ status: "done", progress: { total: count, done: count, currentItem: "" } });
    scheduleWatch();
  }

  // ── Watcher ──

  function scheduleWatch() {
    watchTimer = setTimeout(checkChanges, WATCH_INTERVAL);
  }

  async function checkChanges() {
    const state = await getScanState();
    if (!state || state.scan_status !== "done" || !state.watcher_enabled) {
      scheduleWatch();
      return;
    }

    try {
      const dbPaths = new Set(await getAllPaths());
      const fsPaths = new Set<string>();
      const root = state.root_folder;
      if (!root) { scheduleWatch(); return; }

      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const pending = [root];
      const visited = new Set<string>();
      const newFiles: string[] = [];

      while (pending.length > 0) {
        const dir = pending.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        if (visited.size > 200) break;

        let entries;
        try { entries = await fsPlugin.readDir(dir); } catch { continue; }
        for (const e of entries) {
          if (!e.name) continue;
          const fp = `${dir}/${e.name}`;
          if (e.children) { pending.push(fp); continue; }
          const ext = e.name.toLowerCase().slice(e.name.lastIndexOf("."));
          if (!AUDIO_EXTENSIONS.has(ext)) continue;
          fsPaths.add(fp);
          if (!dbPaths.has(fp)) newFiles.push(fp);
        }
      }

      let changed = newFiles.length > 0;
      for (const dbPath of dbPaths) {
        if (!fsPaths.has(dbPath)) { await deleteSong(fileIdFromPath(dbPath)); changed = true; }
      }

      if (newFiles.length > 0) {
        setState({ status: "indexing" });
        await updateScanState({ scan_status: "indexing" });
        await enqueueScan(newFiles.map((p) => ({ type: "file", path: p })));
        paused = false; aborted = false;
        run();
      } else if (changed) {
        const count = await getSongCount();
        setState({ progress: { total: count, done: scannedCount } });
      }
    } catch (err) {
      console.warn("[watcher] error:", err);
    }
    scheduleWatch();
  }

  return { start, pause, resume, abort, getStatus, onProgress };
}
