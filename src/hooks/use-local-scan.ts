import { useCallback, useRef, useEffect, useState } from "react";
import { useLocalLibraryStore } from "../stores/local-library.store";
import { getIndexer, type Indexer, type IndexerStatus } from "../api/indexer/indexer";
import { useAuthStore } from "../stores/auth.store";
import { getScanState } from "../services/local-database";

export function useLocalScan() {
  const indexerRef = useRef<Indexer | null>(null);
  const [status, setStatus] = useState<IndexerStatus>({ status: "idle", progress: { total: 0, done: 0, currentItem: "" } });
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const { setRootFolder, setScanStatus, setScanProgress, setLastScanned } =
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
        if (s.status === "done") setLastScanned(Date.now());
      });
    }
    return indexerRef.current!;
  }, [setScanStatus, setScanProgress, setLastScanned]);

  const startScan = useCallback(async (folder: string) => {
    const { addOrigin, currentOrigin } = useAuthStore.getState();
    setRootFolder(folder);

    // Ensure origin exists with this folder
    let origin = currentOrigin;
    if (!origin) {
      origin = { id: crypto.randomUUID(), name: "Local Files", type: "local" as any, url: folder };
      addOrigin(origin);
    }
    const idx = await ensureIndexer();
    await idx.start(origin);
  }, [setRootFolder, ensureIndexer]);

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
  }, []);

  const rescan = useCallback(async () => {
    const state = await getScanState();
    const folder = state?.root_folder;
    if (folder) await startScan(folder);
  }, [startScan]);

  return { startScan, pause, resume, abort, rescan, status };
}
