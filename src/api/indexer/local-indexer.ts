import type { Indexer, IndexerStatus } from "./indexer";
import type { Origin } from "../../types/domain-types";

export function createLocalIndexer(): Indexer {
  let listeners: Array<(status: IndexerStatus) => void> = [];
  let status: IndexerStatus = { status: "idle", progress: { total: 0, done: 0, currentItem: "" } };
  let aborted = false;
  let paused = false;

  function notify() {
    for (const cb of listeners) cb({ ...status, progress: { ...status.progress } });
  }

  function setState(partial: { status?: IndexerStatus["status"]; progress?: Partial<IndexerStatus["progress"]> }) {
    const mergedProgress = { ...status.progress, ...(partial.progress || {}) } as IndexerStatus["progress"];
    status = { ...status, ...partial, progress: mergedProgress } as IndexerStatus;
  }

  return {
    async start(_origin: Origin) {
      aborted = false;
      paused = false;
      setState({ status: "indexing", progress: { total: 1, done: 0, currentItem: "Triggering backend scan..." } });
      notify();
      try {
        const resp = await fetch("/api/selftify/scan", { method: "POST" });
        if (!resp.ok) throw new Error(`Backend scan returned ${resp.status}`);
        setState({ status: "done", progress: { done: 1, currentItem: "Scan started on server" } });
      } catch (err) {
        console.warn("[local-indexer] backend scan failed:", err);
        setState({ status: "error", progress: { currentItem: "Backend scan failed" } });
      }
      notify();
    },

    pause() {
      paused = true;
      setState({ status: "paused" });
      notify();
    },

    async resume() {
      paused = false;
      setState({ status: "indexing" });
      notify();
    },

    abort() {
      aborted = true;
      paused = false;
      setState({ status: "idle", progress: { total: 0, done: 0, currentItem: "" } });
      notify();
    },

    getStatus() {
      return { ...status, progress: { ...status.progress } };
    },

    onProgress(callback: (s: IndexerStatus) => void) {
      listeners.push(callback);
      callback({ ...status, progress: { ...status.progress } });
      return () => {
        listeners = listeners.filter((l) => l !== callback);
      };
    },

    async startWatcher() {},
  };
}
