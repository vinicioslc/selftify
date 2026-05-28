import { useCallback, useRef, useEffect } from "react";
import { useLocalLibraryStore, isAudioFile, fileIdFromPath } from "../stores/local-library.store";
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
const WATCH_INTERVAL = 10000;

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

export function useLocalScan() {
  const pausedRef = useRef(false);
  const abortRef = useRef(false);
  const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const { setRootFolder, setScanStatus, setScanProgress, setLastScanned, reset: resetStore } =
    useLocalLibraryStore();

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    };
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setScanStatus("paused");
  }, [setScanStatus]);

  const resume = useCallback(async () => {
    pausedRef.current = false;
    abortRef.current = false;
    setScanStatus("scanning");
    processQueue();
  }, [setScanStatus]);

  const startScan = useCallback(
    async (folder: string) => {
      setRootFolder(folder);
      pausedRef.current = false;
      abortRef.current = false;

      await deleteAllSongs();
      await clearQueue();
      await updateScanState({
        root_folder: folder,
        scan_status: "scanning",
        total_files: 0,
        scanned_files: 0,
        current_dir: folder,
        last_scanned_at: null,
      });

      setScanStatus("scanning");
      setScanProgress({ total: 0, done: 0, currentDir: folder });

      enqueueScan([{ type: "dir", path: folder }]);
      processQueue();
    },
    [setRootFolder, setScanStatus, setScanProgress]
  );

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
    if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    updateScanState({ scan_status: "idle" });
    setScanStatus("idle");
  }, [setScanStatus]);

  // Process scan queue (dirs + files)
  async function processQueue() {
    if (abortRef.current || pausedRef.current || !mountedRef.current) return;

    let processed = 0;

    while (processed < DIR_BATCH) {
      const item = await dequeueScan();
      if (!item) break;

      if (item.type === "dir") {
        await processDir(item.path);
      } else if (item.type === "file") {
        await processFile(item.path);
      }

      processed++;
      if (processed % 3 === 0) {
        await yieldToUI();
      }
    }

    if (abortRef.current || !mountedRef.current) return;

    const remaining = await getQueueCount();
    if (remaining === 0) {
      await finishScan();
    } else if (!pausedRef.current) {
      setTimeout(processQueue, 0);
    }
  }

  async function processDir(dirPath: string) {
    if (abortRef.current) return;
    setScanProgress({ currentDir: dirPath });

    try {
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const entries = await fsPlugin.readDir(dirPath);
      const subdirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        if (abortRef.current) return;
        const fullPath = `${dirPath}/${entry.name}`;
        if (entry.children) {
          subdirs.push(fullPath);
        } else if (entry.name) {
          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
          if (AUDIO_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      }

      if (subdirs.length > 0) {
        enqueueScan(subdirs.map((p) => ({ type: "dir", path: p })));
      }
      if (files.length > 0) {
        enqueueScan(files.map((p) => ({ type: "file", path: p })));
      }

      const state = await getScanState();
      await updateScanState({
        scanned_files: (state?.scanned_files || 0) + 1,
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
      const buffer = data.buffer as ArrayBuffer;

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
          new Uint8Array(buffer),
          { path: filePath, mimeType: "audio/mpeg" },
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
          file_size: format.numberOfSamples || 0,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
        };
      } catch {
        // Fallback: metadata from path
        const fileName = filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown";
        const parts = filePath.replace(/\\/g, "/").split("/");
        const relParts = (await getScanState())?.root_folder
          ? filePath.replace((await getScanState())!.root_folder, "").split("/").filter(Boolean)
          : parts.slice(-3);

        metadata = {
          name: fileName,
          artist_name: relParts.length >= 2 ? relParts[relParts.length - 3] || "Unknown Artist" : "Unknown Artist",
          album_name: relParts.length >= 2 ? relParts[relParts.length - 2] : null,
          album_artist: null,
          track_number: null,
          disc_number: null,
          duration: null,
          bitrate: null,
          sample_rate: null,
          genre: null,
          year: null,
          file_size: data.length,
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

      const state = await getScanState();
      await updateScanState({
        scanned_files: (state?.scanned_files || 0) + 1,
      });
    } catch (err) {
      console.warn(`[scan] error processing file ${filePath}:`, err);
    }
  }

  async function finishScan() {
    if (abortRef.current || !mountedRef.current) return;
    const count = await getSongCount();
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
    startWatcher();
  }

  // Directory watcher (polling)
  function startWatcher() {
    if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    scheduleWatch();
  }

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
      if (!root) {
        scheduleWatch();
        return;
      }

      // Quick scan root dir for changes (depth 1)
      const fsPlugin = await import("@tauri-apps/plugin-fs");
      const topEntries = await fsPlugin.readDir(root);

      const newFiles: string[] = [];
      let foundChanges = false;

      for (const entry of topEntries) {
        if (!entry.name) continue;
        const fullPath = `${root}/${entry.name}`;

        if (!entry.children) {
          const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
          if (AUDIO_EXTENSIONS.has(ext)) {
            fsPaths.add(fullPath);
            if (!dbPaths.has(fullPath)) {
              newFiles.push(fullPath);
              foundChanges = true;
            }
          }
        }
      }

      // Check for deleted files (in DB but not on fs)
      for (const dbPath of dbPaths) {
        if (!fsPaths.has(dbPath)) {
          // File was deleted
          const id = fileIdFromPath(dbPath);
          await deleteSong(id);
          foundChanges = true;
        }
      }

      if (newFiles.length > 0) {
        setScanStatus("scanning");
        await updateScanState({ scan_status: "scanning" });
        await enqueueScan(newFiles.map((p) => ({ type: "file", path: p })));
        pausedRef.current = false;
        abortRef.current = false;
        processQueue();
      }
    } catch (err) {
      console.warn("[watcher] error:", err);
    }

    scheduleWatch();
  }

  async function yieldToUI() {
    return new Promise((r) => setTimeout(r, 0));
  }

  async function loadSongs() {
    return getAllSongs();
  }

  return { startScan, pause, resume, abort, rescan, loadSongs };
}
