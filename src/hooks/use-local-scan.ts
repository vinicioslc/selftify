import { useCallback, useRef, useEffect, useState } from "react";
import { getIndexer, type Indexer, type IndexerStatus } from "../api/indexer/indexer";
import { OriginType } from "../types/domain-types";
import { useAuthStore } from "../stores/auth.store";
import { readConfig, readOrCreateConfig } from "../services/sqlite-db/sqlite-db-config";
import { getLibraryRoot } from "../services/db/ensure-db";

export function useLocalScan() {
  const indexerRef = useRef<Indexer | null>(null);
  const [status, setStatus] = useState<IndexerStatus>({ status: "idle", progress: { total: 0, done: 0, currentItem: "" } });
  const unsubscribeRef = useRef<(() => void) | null>(null);

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
      });
    }
    return indexerRef.current!;
  }, []);

  const startScan = useCallback(async (folder: string) => {
    const { addOrigin, currentOrigin } = useAuthStore.getState();

    let origin = currentOrigin;
    if (!origin) {
      const newOrigin = { id: crypto.randomUUID(), name: "Local Files", type: OriginType.LOCAL, folderPath: folder };
      addOrigin(newOrigin);
      origin = newOrigin;
    }
    if (origin) {
      const idx = await ensureIndexer();
      await idx.start(origin);
    }
  }, [ensureIndexer]);

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
    const root = getLibraryRoot();
    if (root) {
      const config = await readConfig(root);
      if (config) await startScan(root);
    }
  }, [startScan]);

  const autoScan = useCallback(async (folder: string): Promise<void> => {
    const config = await readConfig(folder);
    // Start scan if: no config (fresh library), or scan was interrupted
    if (!config || config.scanStatus !== "done") {
      await startScan(folder);
    }
  }, [startScan]);

  return { startScan, pause, resume, abort, rescan, autoScan, status };
}
