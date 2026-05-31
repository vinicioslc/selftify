import type { Origin } from "../../types/domain-types";
import { OriginType } from "../../types/domain-types";

export type IndexerStatus = {
  status: "idle" | "indexing" | "paused" | "done" | "error";
  progress: { total: number; done: number; currentItem: string };
};

export interface Indexer {
  start(origin: Origin): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  abort(): void;
  getStatus(): IndexerStatus;
  onProgress(callback: (status: IndexerStatus) => void): () => void;
  startWatcher(): Promise<void>;
}

export async function getIndexer(origin: Origin): Promise<Indexer> {
  switch (origin.type) {
    case OriginType.LOCAL:
      return (await import("./local-indexer")).createLocalIndexer();
    default:
      return (await import("./noop-indexer")).createNoopIndexer();
  }
}
