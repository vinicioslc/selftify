import type { Indexer, IndexerStatus } from "./indexer";

export function createNoopIndexer(): Indexer {
  let listeners: Array<(status: IndexerStatus) => void> = [];
  let status: IndexerStatus = { status: "idle", progress: { total: 0, done: 0, currentItem: "" } };

  function notify() {
    listeners.forEach((l) => l(status));
  }

  return {
    async start() {
      status = { status: "done", progress: { total: 0, done: 0, currentItem: "" } };
      notify();
    },
    pause() {},
    async resume() {},
    abort() {},
    getStatus() {
      return status;
    },
    onProgress(callback) {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((l) => l !== callback);
      };
    },
  };
}
