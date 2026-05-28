import { useCallback, useRef, useEffect } from "react";
import { useLocalLibraryStore, fileIdFromPath } from "../stores/local-library.store";
import {
  getScanState,
  updateScanState,
  batchInsertSongs,
  deleteAllSongs,
  getAllPaths,
  getAllSongs,
  getSongCount,
  deleteSong,
  enqueueScan,
  dequeueScan,
  getQueueCount,
  clearQueue,
  resetDb,
  type DbSong,
} from "../services/local-database";

const DIR_BATCH = 10;
const FILE_BATCH = 5;
const WATCH_INTERVAL = 15000;

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

export function useLocalScan() {
  const pausedRef = useRef(false);
  const abortRef = useRef(false);
  const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);
  const scannedCounter = useRef(0);

  const { setRootFolder, setScanStatus, setScanProgress, setLastScanned } =
    useLocalLibraryStore();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    };
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setScanStatus("paused");
  }, [setScanStatus]);

  const resume = useCallback(() => {
    if (scanningRef.current) return;
    pausedRef.current = false;
    abortRef.current = false;
    setScanStatus("scanning");
    runScanner();
  }, [setScanStatus]);

  const startScan = useCallback(async (folder: string) => {
    setRootFolder(folder);
    pausedRef.current = false;
    abortRef.current = false;
    scanningRef.current = false;
    scannedCounter.current = 0;

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

    setScanStatus("scanning");
    setScanProgress({ total: 0, done: 0, currentDir: folder });

    await enqueueScan([{ type: "dir", path: folder }]);
    runScanner();
  }, [setRootFolder, setScanStatus, setScanProgress]);

  const rescan = useCallback(async () => {
    if (!mountedRef.current) return;
    const state = await getScanState();
    const folder = state?.root_folder;
    if (folder) {
      await startScan(folder);
    }
  }, [startScan]);

  const abort = useCallback(() => {
    abortRef.current = true;
    pausedRef.current = false;
    scanningRef.current = false;
    if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    updateScanState({ scan_status: "idle", watcher_enabled: 0 });
    setScanStatus("idle");
  }, [setScanStatus]);

  async function runScanner() {
    if (abortRef.current || pausedRef.current || !mountedRef.current) return;
    if (scanningRef.current) return;
    scanningRef.current = true;

    await processQueueBatch();

    scanningRef.current = false;

    if (abortRef.current || !mountedRef.current) return;

    const remaining = await getQueueCount();
    if (remaining === 0) {
      await finishScan();
    } else if (!pausedRef.current) {
      setTimeout(runScanner, 0);
    }
  }

  async function processQueueBatch() {
    let dirs = 0;
    let files = 0;

    while (dirs < DIR_BATCH) {
      if (abortRef.current || pausedRef.current) return;
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
    if (abortRef.current) return;
    setScanProgress({ currentDir: dirPath });

    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const entries = await fsPlugin.readDir(dirPath);
      const subdirs: string[] = [];
      const audioFiles: string[] = [];

      for (const entry of entries) {
        if (abortRef.current) return;
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

      if (batch.length > 0) {
        await enqueueScan(batch);
      }

      const currentState = await getScanState();
      const scanned = scannedCounter.current + 1;
      scannedCounter.current = scanned;
      await updateScanState({
        scanned_files: scanned,
        current_dir: dirPath,
      });
    } catch (err) {
      console.warn(`[scan] error reading dir ${dirPath}:`, err);
    }
  }

  async function processFile(filePath: string) {
    if (abortRef.current) return;
    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const data = await fsPlugin.readFile(filePath);

      let metadata: {
        name: string;
        artist_name: string;
        album_name: string | null;
        album_artist: string | null;
        track_number: number | null;
        disc_number: number | null;
        duration: number | null;
        bitrate: number | null;
        sample_rate: number | null;
        genre: string | null;
        year: number | null;
        file_size: number;
        file_extension: string;
        last_modified: number | null;
      };

      try {
        const mm = await import("music-metadata");
        const result = await mm.parseBuffer(
          data,
          { path: filePath },
          { duration: true, skipCovers: true, skipPostHeaders: false }
        );

        const common = result.common;
        const format = result.format;

        metadata = {
          name: common.title || filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown",
          artist_name: common.artist || common.albumartist || "Unknown Artist",
          album_name: common.album || null,
          album_artist: common.albumartist || null,
          track_number: common.track?.no || null,
          disc_number: common.disk?.no || null,
          duration: format.duration ? format.duration * 1000 : null,
          bitrate: format.bitrate || null,
          sample_rate: format.sampleRate || null,
          genre: common.genre?.[0] || null,
          year: common.year || null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
        };
      } catch {
        // Fallback: metadata from path structure
        const fileName = filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown";
        const scanState = await getScanState();
        const rootFolder = scanState?.root_folder || "";
        const relPath = rootFolder
          ? filePath.replace(rootFolder, "").replace(/^\/+/, "")
          : "";
        const relParts = relPath ? relPath.split("/").filter(Boolean) : [];

        let artist = "Unknown Artist";
        let album: string | null = null;

        if (relParts.length >= 3) {
          artist = relParts[relParts.length - 3];
          album = relParts[relParts.length - 2];
        } else if (relParts.length === 2) {
          album = relParts[relParts.length - 2];
          artist = relParts[relParts.length - 3] || "Unknown Artist";
        } else if (relParts.length === 1) {
          artist = relParts[0];
        }

        metadata = {
          name: fileName,
          artist_name: artist,
          album_name: album,
          album_artist: null,
          track_number: null,
          disc_number: null,
          duration: null,
          bitrate: null,
          sample_rate: null,
          genre: null,
          year: null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
        };
      }

      const song: Omit<DbSong, "updated_at"> = {
        id: fileIdFromPath(filePath),
        path: filePath,
        name: metadata.name,
        artist_name: metadata.artist_name,
        album_name: metadata.album_name,
        album_artist: metadata.album_artist,
        track_number: metadata.track_number,
        disc_number: metadata.disc_number,
        duration: metadata.duration,
        bitrate: metadata.bitrate,
        sample_rate: metadata.sample_rate,
        genre: metadata.genre,
        year: metadata.year,
        file_size: metadata.file_size,
        file_extension: metadata.file_extension,
        last_modified: metadata.last_modified,
        added_at: Date.now(),
      };

      await batchInsertSongs([song]);

      const scanned = scannedCounter.current + 1;
      scannedCounter.current = scanned;
      setScanProgress({ done: scanned, currentDir: filePath });
    } catch (err) {
      console.warn(`[scan] error processing file ${filePath}:`, err);
    }
  }

  async function finishScan() {
    if (abortRef.current || !mountedRef.current) return;
    const count = await getSongCount();
    scannedCounter.current = count;
    await updateScanState({
      scan_status: "done",
      total_files: count,
      scanned_files: count,
      current_dir: "",
      last_scanned_at: Date.now(),
      watcher_enabled: 1,
    });
    setScanStatus("done");
    setLastScanned(Date.now());
    setScanProgress({ total: count, done: count, currentDir: "" });
    scheduleWatch();
  }

  // Directory watcher (polling — root level for new dirs, checks all known paths for deletion)
  function scheduleWatch() {
    if (!mountedRef.current) return;
    watchTimerRef.current = setTimeout(checkForChanges, WATCH_INTERVAL);
  }

  async function checkForChanges() {
    if (!mountedRef.current) return;
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

      // Recursively scan root (up to 2 levels deep)
      const pendingDirs = [root];
      const visited = new Set<string>();
      const foundNewFiles: string[] = [];

      while (pendingDirs.length > 0) {
        if (!mountedRef.current) { scheduleWatch(); return; }
        const dir = pendingDirs.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        if (visited.size > 200) break;

        let dirEntries;
        try {
          dirEntries = await fsPlugin.readDir(dir);
        } catch {
          continue;
        }

        for (const entry of dirEntries) {
          if (!entry.name) continue;
          const fullPath = `${dir}/${entry.name}`;

          if (entry.children) {
            pendingDirs.push(fullPath);
            continue;
          }

          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
          if (!AUDIO_EXTENSIONS.has(ext)) continue;

          fsPaths.add(fullPath);
          if (!dbPaths.has(fullPath)) {
            foundNewFiles.push(fullPath);
          }
        }
      }

      // Check for deleted files
      let foundChanges = foundNewFiles.length > 0;
      for (const dbPath of dbPaths) {
        if (!fsPaths.has(dbPath)) {
          await deleteSong(fileIdFromPath(dbPath));
          foundChanges = true;
        }
      }

      if (foundNewFiles.length > 0) {
        setScanStatus("scanning");
        await updateScanState({ scan_status: "scanning" });
        await enqueueScan(foundNewFiles.map((p) => ({ type: "file", path: p })));
        pausedRef.current = false;
        abortRef.current = false;
        runScanner();
      } else if (foundChanges) {
        // Refresh stats if files were deleted
        const count = await getSongCount();
        const scanned = scannedCounter.current;
        setScanProgress({ total: count, done: scanned });
      }
    } catch (err) {
      console.warn("[watcher] error:", err);
    }

    scheduleWatch();
  }

  return {
    startScan,
    pause,
    resume,
    abort,
    rescan,
  };
}
