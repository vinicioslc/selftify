import { cachedRead, cachedWrite, cachedExists } from "../sqlite-db/sqlite-db-cache";
import { fileIdFromPath } from "../../lib/sqlite-db-helpers";
import type { FileOrganizer, OrganizeContext, OrganizeResult } from "./file-organizer";

export interface OrgTask {
  id: string;
  sourcePath: string;
  status: "pending" | "processing" | "done" | "failed";
  error?: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  trackTitle: string;
  extension: string;
}

export interface OrganizationQueue {
  enqueue(task: Omit<OrgTask, "id" | "status">): Promise<void>;
  processAll(organizer: FileOrganizer): Promise<OrganizeResult[]>;
  load(): Promise<void>;
  persist(): Promise<void>;
  getPending(): OrgTask[];
  getFailed(): OrgTask[];
  getDone(): OrgTask[];
  clear(): Promise<void>;
  size(): number;
}

function queuePath(libraryRoot: string): string {
  return `${libraryRoot}/.selftify/org-queue.json`;
}

export function createOrganizationQueue(libraryRoot: string): OrganizationQueue {
  const tasks: Map<string, OrgTask> = new Map();
  let loaded = false;

  async function persist(): Promise<void> {
    const arr = Array.from(tasks.values());
    const json = JSON.stringify(arr, null, 2);
    await cachedWrite(queuePath(libraryRoot), new TextEncoder().encode(json));
  }

  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const raw = await cachedRead(queuePath(libraryRoot));
    if (!raw) return;
    try {
      const text = new TextDecoder().decode(raw);
      const arr = JSON.parse(text) as OrgTask[];
      for (const t of arr) {
        tasks.set(t.id, t);
      }
    } catch (err) {
      console.warn("[org-queue] failed to load persisted queue:", err);
    }
  }

  async function enqueue(task: Omit<OrgTask, "id" | "status">): Promise<void> {
    await load();
    const id = fileIdFromPath(task.sourcePath);
    if (tasks.has(id)) return;
    tasks.set(id, { ...task, id, status: "pending" });
    await persist();
  }

  async function processAll(organizer: FileOrganizer): Promise<OrganizeResult[]> {
    await load();
    const results: OrganizeResult[] = [];
    const pending = Array.from(tasks.values()).filter((t) => t.status === "pending");

    for (const task of pending) {
      task.status = "processing";
      await persist();

      const ctx: OrganizeContext = {
        libraryRoot,
        sourcePath: task.sourcePath,
        artistName: task.artistName,
        albumName: task.albumName,
        releaseYear: task.releaseYear,
        trackNumber: task.trackNumber,
        discNumber: task.discNumber,
        trackTitle: task.trackTitle,
        extension: task.extension,
      };

      try {
        const result = await organizer.organizeFile(ctx);
        task.status = result.skipped || result.targetPath !== null ? "done" : "failed";
        if (result.error) task.error = result.error;
        results.push(result);
      } catch (err: any) {
        task.status = "failed";
        task.error = err?.message || String(err);
        results.push({
          sourcePath: task.sourcePath,
          targetPath: null,
          targetAlbumRelDir: "",
          targetFileName: "",
          movedSidecars: [],
          createdFiles: [],
          skipped: false,
          error: task.error,
        });
      }

      await persist();
    }

    return results;
  }

  function getPending(): OrgTask[] {
    return Array.from(tasks.values()).filter((t) => t.status === "pending");
  }

  function getFailed(): OrgTask[] {
    return Array.from(tasks.values()).filter((t) => t.status === "failed");
  }

  function getDone(): OrgTask[] {
    return Array.from(tasks.values()).filter((t) => t.status === "done");
  }

  async function clear(): Promise<void> {
    tasks.clear();
    const p = queuePath(libraryRoot);
    const exists = await cachedExists(p);
    if (exists) {
      const { cachedDelete } = await import("../sqlite-db/sqlite-db-cache");
      await cachedDelete(p);
    }
  }

  function size(): number {
    return tasks.size;
  }

  return { enqueue, processAll, load, persist, getPending, getFailed, getDone, clear, size };
}
