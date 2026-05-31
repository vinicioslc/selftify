import { useCallback, useRef, useEffect, useState } from "react";
import { useLocalLibraryStore } from "../stores/local-library.store";
import { getIndexer, type Indexer, type IndexerStatus } from "../api/indexer/indexer";
import { OriginType } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";
import { getScanState, getQueueCount, getSongCount, updateScanState } from "../services/local-database";
import { decideAutoScan } from "./auto-scan-logic";

export function useLocalScan() {
  const indexerRef = useRef<Indexer | null>(null);
  const [status, setStatus] = useState<IndexerStatus>({ status: "idle", progress: { total: 0, done: 0, currentItem: "" } });
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const { setRootFolder, setScanStatus, setScanProgress, setLastScanned, setScanningOriginId } =
    useLocalLibraryStore();

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  const ensureIndexer = useCallback(async () => {
    if (!indexerRef.current) {
      const { currentOrigin } = useAuthStore.getState();
      if (!currentOrigin) throw new Error("No origin selected");
      indexerRef.current = await getIndexer(currentOrigin);
      unsubscribeRef.current = indexerRef.current.onProgress((s) => {
        setStatus(s);
        const mappedStatus = s.status === "indexing" ? "scanning" : s.status;
        setScanStatus(mappedStatus as any);
        setScanProgress({ total: s.progress.total, done: s.progress.done, currentDir: s.progress.currentItem });
        if (s.status === "done") {
          setLastScanned(Date.now());
          setScanningOriginId(null);
        }
      });
    }
    return indexerRef.current!;
  }, [setScanStatus, setScanProgress, setLastScanned]);

  const startScan = useCallback(async (folder: string) => {
    const { addOrigin, currentOrigin } = useAuthStore.getState();
    setRootFolder(folder);

    let origin = currentOrigin;
    if (!origin) {
      const newOrigin = { id: crypto.randomUUID(), name: "Local Files", type: OriginType.LOCAL, folderPath: folder };
      addOrigin(newOrigin);
      origin = newOrigin;
    }
    if (origin) {
      setScanningOriginId(origin.id);
      const idx = await ensureIndexer();
      await idx.start(origin);
    }
  }, [setRootFolder, ensureIndexer, setScanningOriginId]);

  const pause = useCallback(async () => {
    const idx = await ensureIndexer();
    idx.pause();
  }, [ensureIndexer]);

  const resume = useCallback(async () => {
    const idx = await ensureIndexer();
    await idx.resume();
  }, [ensureIndexer]);

  const abort = useCallback(async () => {
    if (indexerRef.current) {
      indexerRef.current.abort();
    }
    setScanningOriginId(null);
  }, [setScanningOriginId]);

  const rescan = useCallback(async () => {
    const state = await getScanState();
    const folder = state?.root_folder;
    if (folder) await startScan(folder);
  }, [startScan]);

  const autoScan = useCallback(async (folder: string): Promise<void> => {
    const state = await getScanState();
    const queueCount = state ? await getQueueCount() : 0;
    const songCount = await getSongCount();
    const action = decideAutoScan({ rootFolder: folder, scanState: state, queueCount, songCount });
    switch (action) {
      case "start":
        await startScan(folder);
        break;
      case "resume":
        resume();
        break;
      case "mark-done":
        await updateScanState({ scan_status: "done", last_scanned_at: Date.now() });
        await startWatcherIfReady();
        break;
      case "skip":
        await startWatcherIfReady();
        break;
    }
  }, [resume, startScan]);

  async function startWatcherIfReady() {
    try {
      const scanState = await getScanState();
      if (!scanState || scanState.scan_status !== "done") return;
      const count = await getSongCount();
      if (count === 0) return;
      const idx = await ensureIndexer();
      await idx.startWatcher();
    } catch {
      // non-local origins have noop indexer — ignore
    }
  }

  return { startScan, pause, resume, abort, rescan, autoScan, status };
}
