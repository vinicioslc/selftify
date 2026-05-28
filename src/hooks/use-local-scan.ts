import { useCallback, useRef } from "react";
import { useLocalLibraryStore, isAudioFile, fileIdFromPath, guessMetadataFromPath } from "../stores/local-library.store";
import type { LocalLibraryEntry } from "../stores/local-library.store";

const BATCH_SIZE = 50;
const SCAN_DIR_BATCH = 10;

export function useLocalScan() {
  const pausedRef = useRef(false);
  const abortRef = useRef(false);

  const {
    rootFolder,
    scanStatus,
    dirQueue,
    metadataQueue,
    entries,
    setScanStatus,
    setScanProgress,
    setDirQueue,
    appendDirQueue,
    shiftDirQueue,
    addEntries,
    setMetadataQueue,
    setLastScanned,
    updateEntry,
  } = useLocalLibraryStore();

  const pause = useCallback(() => {
    pausedRef.current = true;
    setScanStatus("paused");
  }, [setScanStatus]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    abortRef.current = false;
    const state = useLocalLibraryStore.getState();
    if (state.dirQueue.length > 0) {
      setScanStatus("scanning");
      walkDirBatch();
    } else if (state.metadataQueue.length > 0) {
      setScanStatus("scanning");
      processMetadataBatch();
    }
  }, [setScanStatus]);

  const startScan = useCallback(
    async (folder: string) => {
      const store = useLocalLibraryStore.getState();
      
      // If we have existing data for this folder, resume
      if (store.rootFolder === folder && store.entries.length > 0 && store.scanStatus !== "done") {
        if (store.dirQueue.length > 0) {
          setScanStatus("scanning");
          walkDirBatch();
          return;
        }
        if (store.metadataQueue.length > 0) {
          setScanStatus("scanning");
          processMetadataBatch();
          return;
        }
        setScanStatus("done");
        return;
      }

      // Fresh scan
      useLocalLibraryStore.getState().reset();
      useLocalLibraryStore.setState({
        rootFolder: folder,
        scanStatus: "scanning",
        dirQueue: [folder],
        scanProgress: { total: 0, done: 0, currentDir: folder },
      });

      pausedRef.current = false;
      abortRef.current = false;

      walkDirBatch();
    },
    [setScanStatus, setDirQueue, setScanProgress]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
    pausedRef.current = false;
    setScanStatus("idle");
  }, [setScanStatus]);

  // Phase 1: walk directories recursively, discovering audio files
  async function walkDirBatch() {
    if (abortRef.current) return;
    if (pausedRef.current) return;

    const state = useLocalLibraryStore.getState();
    let dirsProcessed = 0;
    let newFiles: LocalLibraryEntry[] = [];
    let newDirs: string[] = [];

    while (dirsProcessed < SCAN_DIR_BATCH) {
      const dir = state.dirQueue[0];
      if (!dir) break;

      try {
        const fsPlugin = await import("@tauri-apps/plugin-fs");
        const entries = await fsPlugin.readDir(dir);

        for (const entry of entries) {
          if (abortRef.current) return;
          if (entry.children) {
            // It's a directory
            newDirs.push(`${dir}/${entry.name}`);
          } else if (entry.name && isAudioFile(entry.name)) {
            const fullPath = `${dir}/${entry.name}`;
            const relativePath = fullPath.replace(
              useLocalLibraryStore.getState().rootFolder,
              ""
            );
            const meta = guessMetadataFromPath(relativePath);
            newFiles.push({
              id: fileIdFromPath(fullPath),
              path: fullPath,
              name: meta.name,
              artistName: meta.artistName,
              albumName: meta.albumName,
              duration: null,
              imageUrl: null,
              size: null,
              lastModified: null,
              addedAt: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn(`[scan] error reading ${dir}:`, err);
      }

      // Pop the processed dir
      useLocalLibraryStore.getState().shiftDirQueue();
      dirsProcessed++;

      if (newDirs.length > 0) {
        appendDirQueue(newDirs);
        newDirs = [];
      }
      if (newFiles.length > 0) {
        addEntries(newFiles);
        newFiles = [];
      }

      // Persist progress after each dir
      const currentState = useLocalLibraryStore.getState();
      setScanProgress({
        currentDir: dir || "",
        total: currentState.entries.length + currentState.dirQueue.length,
        done: currentState.entries.length,
      });

      // Yield to UI
      await new Promise((r) => setTimeout(r, 0));
    }

    // Check if we're done with phase 1
    const afterState = useLocalLibraryStore.getState();
    if (afterState.dirQueue.length === 0 || abortRef.current) {
      if (abortRef.current) return;
      // Move to phase 2: metadata processing
      const fileIds = afterState.entries
        .filter((e) => e.duration === null)
        .map((e) => e.path);
      setMetadataQueue(fileIds);
      setScanProgress({ currentDir: "(processing metadata)" });
      processMetadataBatch();
    } else if (!pausedRef.current) {
      // Continue next batch
      setTimeout(walkDirBatch, 0);
    }
  }

  // Phase 2: process metadata (duration) for each file
  // This is a best-effort phase that can run in the background
  async function processMetadataBatch() {
    if (abortRef.current) return;
    if (pausedRef.current) return;

    let processed = 0;

    while (processed < BATCH_SIZE) {
      const path = useLocalLibraryStore.getState().shiftMetadataQueue();
      if (!path) break;

      const fileId = fileIdFromPath(path);

      // Try to get file size as basic metadata
      try {
        const fsPlugin = await import("@tauri-apps/plugin-fs");
        if (typeof (fsPlugin as any).stat === "function") {
          const stat = await (fsPlugin as any).stat(path);
          updateEntry(fileId, {
            size: stat.size || null,
            lastModified: stat.mtime || null,
          });
        }
      } catch {
        // stat failed, skip
      }

      processed++;

      if (processed % 10 === 0) {
        const state = useLocalLibraryStore.getState();
        setScanProgress({
          done: state.entries.length - state.metadataQueue.length,
          total: state.entries.length,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const afterState = useLocalLibraryStore.getState();
    if (afterState.metadataQueue.length === 0 || abortRef.current) {
      if (abortRef.current) return;
      setScanStatus("done");
      setLastScanned(Date.now());
      setScanProgress({
        done: afterState.entries.length,
        total: afterState.entries.length,
      });
    } else if (!pausedRef.current) {
      setTimeout(processMetadataBatch, 0);
    }
  }

  return { startScan, pause, resume, abort };
}
